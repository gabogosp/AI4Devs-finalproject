const ARS = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
});

/**
 * Formatea centavos ARS a `$` sin decimales (IVA incluido). Puro y compartido
 * por Server y Client Components (sin hydration mismatch). 1250000 → "$ 12.500".
 */
export function formatArs(cents: number): string {
  return ARS.format(Math.round(cents / 100));
}
