import { ConfigService } from '@nestjs/config';

/**
 * Lectura **numérica** de configuración (US-005).
 *
 * Existe por un bug real que un test cazó: `ConfigService.get()` consulta `process.env`
 * **antes** que su config interna, y ahí todo valor es `string` — incluso los que `envSchema`
 * validó como número, porque Nest escribe los valores validados de vuelta como texto. Con
 * `get<number>(...)` TypeScript cree que tiene un número y el runtime tiene un string.
 *
 * El síntoma no fue un error, fue algo peor: `i += concurrencia` con `concurrencia = '2'`
 * concatenaba (`0 + '2' === '02'`) y el segundo tramo del lote disparaba **todo el resto del
 * lote de una vez** en lugar de dos productos. El tope de concurrencia existía en la config y
 * no existía en la práctica: en producción eso revienta el límite de RPM del proveedor.
 *
 * Por eso toda lectura numérica de este módulo pasa por acá.
 */
export function configNumber(
  config: ConfigService,
  key: string,
  porDefecto: number,
): number {
  const crudo = config.get<unknown>(key);
  if (crudo === undefined || crudo === null || crudo === '') return porDefecto;
  const n = Number(crudo);
  return Number.isFinite(n) ? n : porDefecto;
}
