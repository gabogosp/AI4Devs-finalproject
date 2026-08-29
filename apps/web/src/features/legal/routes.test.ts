import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONSENT_COPY, LEGAL_ROUTES } from './routes';

describe('LEGAL_ROUTES (AC-1, AC-2)', () => {
  it('las dos rutas viven bajo /legales/', () => {
    expect(LEGAL_ROUTES.privacidad).toBe('/legales/privacidad');
    expect(LEGAL_ROUTES.terminos).toBe('/legales/terminos');
  });
});

describe('CONSENT_COPY (AC-4 — seam para el checkout de US-008)', () => {
  it('los dos enlaces apuntan a las rutas reales, no a "#"', () => {
    // El copy del design-system trae `(#)` porque las páginas no existían. Un
    // enlace legal a `#` en producción es peor que no tenerlo (Ley 25.326).
    for (const link of CONSENT_COPY.links) {
      expect(link.href).not.toBe('#');
      expect(link.href.length).toBeGreaterThan(0);
      expect(link.href.startsWith('/legales/')).toBe(true);
    }
  });

  it('nombra la ley y explica la finalidad, no sólo pide aceptar', () => {
    expect(CONSENT_COPY.trailing).toContain('25.326');
  });
});

/** Archivos de código de la app, sin tests ni artefactos. */
function archivosDeLaApp(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === 'generated') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      archivosDeLaApp(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.|\.spec\./.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

describe('fuente única: nadie más escribe la ruta legal como literal', () => {
  it('el literal "/legales/" sólo aparece en routes.ts', () => {
    const raiz = path.resolve(__dirname, '../../..');
    const archivos = [
      ...archivosDeLaApp(path.join(raiz, 'src')),
      ...archivosDeLaApp(path.join(raiz, 'app')),
    ];

    const infractores = archivos.filter((f) => {
      if (f.endsWith(path.join('features', 'legal', 'routes.ts'))) return false;
      return readFileSync(f, 'utf8').includes("'/legales/");
    });

    // El día que el checkout de US-008 copie la ruta en vez de importarla, este
    // guard falla — que es antes de que las dos copias diverjan, no después.
    expect(
      infractores.map((f) => path.relative(raiz, f)),
      'estos archivos escriben la ruta legal en vez de importarla de routes.ts',
    ).toEqual([]);
  });
});
