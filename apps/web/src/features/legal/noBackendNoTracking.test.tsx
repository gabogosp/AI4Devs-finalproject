import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { LegalDocument } from './LegalDocument';
import { LEGAL_DOCUMENTS } from './content';

/**
 * US-017 T4.2 — AC-6, AC-7 y US §9 como **invariantes**, no como propiedades
 * verdaderas-hoy.
 *
 * Las dos páginas legales existen para cumplir una obligación de la Ley 25.326. De ahí las
 * tres prohibiciones que este archivo custodia, y ninguna es estética:
 *
 * 1. **Sin backend.** Una página que cumple una obligación legal no puede dejar de estar
 *    disponible porque la API esté caída. Si mañana alguien mete el cliente HTTP acá, el sitio
 *    queda en incumplimiento cada vez que el backend falle.
 * 2. **Sin telemetría** (US §9). Registrar quién leyó la política de privacidad es
 *    precisamente el tipo de tratamiento que esa política tiene que declarar. Es la
 *    contradicción más incómoda posible.
 * 3. **Server Components puros.** Sin JS de cliente: son páginas de texto que existen para ser
 *    indexadas y para abrirse siempre.
 *
 * Se verifica de las **dos** formas, porque cada una tapa el agujero de la otra: el chequeo
 * estático ve lo que un espía no puede (un import de telemetría que todavía no se dispara), y
 * el espía en runtime ve lo que un grep no puede (un servicio importado que por dentro llama a
 * `customFetch`) — la lección que dejó el guard de US-018 T3.1.
 */

/**
 * Rutas resueltas desde `__dirname` y no relativas al cwd: vitest corre con `apps/web`
 * como cwd, así que un path relativo funciona hoy y se rompe el día que alguien invoque
 * la suite desde la raíz del monorepo. Es el mismo criterio que usa el guard de
 * `routes.test.ts`.
 */
const RAIZ_APP = resolve(__dirname, '../../..');
const RAICES = [
  join(RAIZ_APP, 'src/features/legal'),
  join(RAIZ_APP, 'app/(storefront)/legales'),
];

/** Fuentes del feature, **sin comentarios**. */
function fuentesSinComentarios(): Array<{ archivo: string; codigo: string }> {
  const salida: Array<{ archivo: string; codigo: string }> = [];

  const recorrer = (dir: string): void => {
    for (const entrada of readdirSync(dir)) {
      const ruta = join(dir, entrada);
      if (statSync(ruta).isDirectory()) {
        recorrer(ruta);
        continue;
      }
      if (!/\.tsx?$/.test(entrada) || /\.test\.tsx?$/.test(entrada)) continue;
      const bruto = readFileSync(ruta, 'utf8');
      // Se quitan comentarios ANTES de buscar. Es la lección que dejó T1.1: un guard
      // que matchea la mención y no el uso se pone rojo contra el propio comentario
      // que explica por qué el código NO hace eso — rojo permanente e inarreglable
      // salvo borrando la explicación.
      const codigo = bruto
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      salida.push({ archivo: ruta, codigo });
    }
  };

  for (const raiz of RAICES) recorrer(raiz);
  return salida;
}

describe('T4.2 — chequeo estático: el feature legal no puede tocar red ni telemetría', () => {
  const fuentes = fuentesSinComentarios();

  it('encuentra los archivos del feature (el guard no puede pasar por vacío)', () => {
    // Sin este assert, un cambio de rutas dejaría el guard verde recorriendo cero
    // archivos — el modo de falla clásico de un test de este tipo.
    expect(fuentes.length).toBeGreaterThanOrEqual(6);
    expect(fuentes.some((f) => f.archivo.includes('legales'))).toBe(true);
  });

  it.each(fuentesSinComentarios())(
    'ni cliente HTTP, ni fetch, ni telemetría, ni cliente generado en $archivo',
    ({ codigo }) => {
      expect(codigo).not.toMatch(/from\s+['"]@\/lib\/http/);
      expect(codigo).not.toMatch(/from\s+['"]@\/lib\/observability/);
      expect(codigo).not.toMatch(/from\s+['"]@\/api\/generated/);
      expect(codigo).not.toMatch(/\bfetch\s*\(/);
      expect(codigo).not.toMatch(/\btrack\s*\(/);
    },
  );

  it.each(fuentesSinComentarios())(
    '$archivo es Server Component (sin `use client`)',
    ({ codigo }) => {
      // Se busca la DIRECTIVA —primera sentencia del archivo, que es donde Next la
      // reconoce— y no la mención en cualquier lugar.
      const primera = codigo.trim().split('\n')[0]?.trim() ?? '';
      expect(primera).not.toMatch(/^['"]use client['"]/);
    },
  );

  it('tampoco se cuela `dangerouslySetInnerHTML` como atributo JSX', () => {
    // Anclado al `=` del atributo, no a la palabra: el comentario de LegalDocument
    // explica por qué no lo usa, y un guard sobre la mención se pondría rojo contra
    // esa explicación (T1.1 AS-BUILT).
    for (const { codigo } of fuentes) {
      expect(codigo).not.toMatch(/dangerouslySetInnerHTML\s*=/);
    }
  });
});

describe('T4.2 — chequeo en runtime: renderizar las páginas no sale a la red', () => {
  afterEach(() => vi.restoreAllMocks());

  it('ninguno de los dos documentos dispara un request', () => {
    // Espía por DEBAJO de `customFetch`, que es el único punto de red del repo (F48).
    // Tapa el caso que el grep no ve: un servicio importado que por dentro llama al
    // cliente centralizado.
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    render(<LegalDocument doc={LEGAL_DOCUMENTS.privacidad} />);
    render(<LegalDocument doc={LEGAL_DOCUMENTS.terminos} />);

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
