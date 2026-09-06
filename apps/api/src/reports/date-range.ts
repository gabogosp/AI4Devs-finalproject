import { ReportsInvalidRangeError } from './reports-errors';

export interface ParsedRange {
  from: Date;
  to: Date;
}

/**
 * Parsea y acota el rango temporal de los 3 datasets (AC-4, AC-9). Función
 * pura, sin DI: `now` viaja como parámetro para que el test controle el
 * reloj — nunca `new Date()` interno. `per design.md §D5`.
 *
 * - Sin `created_at_from`/`created_at_to` → `to = now`, `from = to - 30 días`.
 * - `created_at_from` anterior al piso de retención vigente
 *   (`retentionMonths`) → se acota **silenciosamente** al piso (AC-9: "no
 *   muestra datos más antiguos", no "rechaza"), nunca lanza.
 * - `created_at_from > created_at_to` → `ReportsInvalidRangeError` (422): es
 *   una entrada incoherente del propio dueño, no una ventana que exceda la
 *   retención.
 */
export function parseReportsRange(
  raw: { created_at_from?: string; created_at_to?: string },
  now: Date,
  retentionMonths: number,
): ParsedRange {
  const to = raw.created_at_to ? new Date(raw.created_at_to) : now;
  const requestedFrom = raw.created_at_from
    ? new Date(raw.created_at_from)
    : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

  if (requestedFrom.getTime() > to.getTime()) {
    throw new ReportsInvalidRangeError(raw.created_at_from, raw.created_at_to);
  }

  const floor = new Date(now);
  floor.setMonth(floor.getMonth() - retentionMonths);

  const from = requestedFrom.getTime() < floor.getTime() ? floor : requestedFrom;
  return { from, to };
}
