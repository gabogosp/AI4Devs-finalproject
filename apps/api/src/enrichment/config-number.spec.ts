import { readdirSync, readFileSync } from 'node:fs';
import { ConfigService } from '@nestjs/config';
import { configNumber } from './config-number';

/**
 * Guardarraíl del bug que este módulo ya tuvo una vez (US-005 T3.4).
 *
 * `ConfigService.get()` consulta `process.env` **antes** que su config interna, y ahí todo
 * valor es `string` — incluidos los que `envSchema` validó como número, porque Nest escribe
 * los validados de vuelta como texto. Con `get<number>()`, TypeScript cree que tiene un
 * número y el runtime tiene un string.
 *
 * El síntoma no fue una excepción, fue algo peor: `i += concurrencia` con `'2'` concatenaba
 * (`0 + '2' === '02'`) y el segundo tramo del lote disparaba **todo el resto de una vez** en
 * lugar de dos productos. El tope de concurrencia figuraba en la config y no existía en la
 * práctica: en producción eso revienta el límite de RPM del proveedor y el perfil de memoria.
 */
describe('configNumber', () => {
  const original = process.env.ENRICHMENT_CONCURRENCY;
  afterEach(() => {
    if (original === undefined) delete process.env.ENRICHMENT_CONCURRENCY;
    else process.env.ENRICHMENT_CONCURRENCY = original;
  });

  it('devuelve NÚMERO cuando el valor de process.env es un string', () => {
    process.env.ENRICHMENT_CONCURRENCY = '4';
    const config = new ConfigService({}) as ConfigService;

    const n = configNumber(config, 'ENRICHMENT_CONCURRENCY', 2);

    expect(n).toBe(4);
    expect(typeof n).toBe('number');
  });

  it('el valor devuelto SUMA, no concatena (el bug original)', () => {
    process.env.ENRICHMENT_CONCURRENCY = '2';
    const config = new ConfigService({}) as ConfigService;

    const n = configNumber(config, 'ENRICHMENT_CONCURRENCY', 2);

    expect(0 + n).toBe(2);
    // Con la lectura sin coerción, esto valía '02' y rompía el recorrido del lote.
    expect(String(0 + n)).not.toBe('02');
  });

  it('cae al default cuando la variable no está, está vacía o no es numérica', () => {
    delete process.env.ENRICHMENT_CONCURRENCY;
    const config = new ConfigService({}) as ConfigService;
    expect(configNumber(config, 'ENRICHMENT_CONCURRENCY', 2)).toBe(2);

    process.env.ENRICHMENT_CONCURRENCY = '';
    expect(configNumber(new ConfigService({}) as ConfigService, 'ENRICHMENT_CONCURRENCY', 2)).toBe(2);

    process.env.ENRICHMENT_CONCURRENCY = 'dos';
    expect(configNumber(new ConfigService({}) as ConfigService, 'ENRICHMENT_CONCURRENCY', 2)).toBe(2);
  });

  it('respeta el 0 explícito de la config interna sin confundirlo con ausencia', () => {
    delete process.env.ENRICHMENT_CONCURRENCY;
    const config = new ConfigService({ ENRICHMENT_CONCURRENCY: 0 }) as ConfigService;

    // 0 es un valor, no «falta»: el fail-fast de envSchema es quien lo rechaza, no esto.
    expect(configNumber(config, 'ENRICHMENT_CONCURRENCY', 2)).toBe(0);
  });

  it('ninguna lectura numérica del módulo usa get<number> directo', () => {
    // Es la barrera contra la reaparición del bug en otra variable.
    const archivos = [
      ...readdirSync('src/enrichment').map((f) => `src/enrichment/${f}`),
      ...readdirSync('src/enrichment/ai').map((f) => `src/enrichment/ai/${f}`),
    ].filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'));

    for (const f of archivos) {
      expect(readFileSync(f, 'utf8')).not.toMatch(/config\.get<number>/);
    }
  });
});
