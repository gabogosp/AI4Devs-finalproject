/**
 * Corte de retención: `now - N meses` (US-021, design.md §D4).
 *
 * Extraído (Extract Method, `refactoring-discipline`) de
 * `OrdersRetentionService.cutoffDate()` para que el historial de compras
 * (US-015) NO reimplemente la misma aritmética de fechas — si el cálculo
 * cambia (por ejemplo, a días en vez de meses), cambia acá y ambos
 * consumidores lo heredan.
 */
export function computeRetentionCutoff(months: number, now: Date = new Date()): Date {
  const d = new Date(now);
  d.setMonth(d.getMonth() - months);
  return d;
}
