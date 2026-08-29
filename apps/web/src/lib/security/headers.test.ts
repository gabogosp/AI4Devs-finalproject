import { describe, expect, it } from 'vitest';

/**
 * US-014 T5.2 — se **importa** la config y se ejecuta `headers()`, en vez de
 * greppear el archivo: un `form-action` escrito dentro de un comentario pondría
 * verde a un grep sin que la política lo lleve (F50).
 */
const config = (await import('../../../next.config.mjs')).default;

type Cabecera = { key: string; value: string };
type Grupo = { source: string; headers: Cabecera[] };

/** Falla con un mensaje que dice qué faltaba, en vez de un `undefined` opaco. */
function exigir<T>(valor: T | undefined, que: string): T {
  if (valor === undefined) throw new Error(`No se encontró ${que}`);
  return valor;
}

async function grupoDe(source: string): Promise<Grupo> {
  const grupos = (await config.headers!()) as Grupo[];
  return exigir(
    grupos.find((g) => g.source === source),
    `el grupo de headers de ${source}`,
  );
}

async function politica(): Promise<string> {
  const global = await grupoDe('/:path*');
  return exigir(
    global.headers.find((h) =>
      h.key.toLowerCase().startsWith('content-security-policy'),
    ),
    'la cabecera de CSP',
  ).value;
}

describe('Security headers (T5.2)', () => {
  it('la CSP declara form-action self', async () => {
    expect(await politica()).toContain("form-action 'self'");
  });

  it('las demás directivas quedan intactas', async () => {
    const csp = await politica();
    // No se toca `connect-src`: con el rewrite, la superficie de sesión es
    // same-origin y ya la cubre `'self'`.
    for (const directiva of [
      "default-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      'connect-src',
    ]) {
      expect(csp).toContain(directiva);
    }
  });

  it('el rewrite de la superficie de sesión existe y apunta a /v1/auth', async () => {
    const rewrites = (await config.rewrites!()) as Array<{
      source: string;
      destination: string;
    }>;
    const auth = exigir(
      rewrites.find((r) => r.source.startsWith('/v1/auth')),
      'el rewrite de /v1/auth',
    );
    expect(auth.destination).toContain('/v1/auth/:path*');
  });

  it('el panel conserva su noindex', async () => {
    const admin = await grupoDe('/admin/:path*');
    expect(admin.headers[0].value).toContain('noindex');
  });
});
