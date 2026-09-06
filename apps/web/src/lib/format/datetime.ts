// `dateStyle`/`timeStyle` no se pueden combinar con `timeZoneName` (error real
// en runtime: "Invalid option : option" — Intl.DateTimeFormat lo rechaza).
// Componentes explícitos en su lugar — mismo resultado visual, con el huso
// horario visible (`frontend-standards.md` §11.bis.1 "Always show timezone").
const formatter = new Intl.DateTimeFormat('es-AR', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Argentina/Buenos_Aires',
  timeZoneName: 'short',
});

/**
 * Formatea un timestamp ISO a `es-AR` con huso horario visible. Puro y
 * compartido por Server y Client Components (sin hydration mismatch) — mismo
 * criterio que `formatArs` en `lib/format/currency.ts`. Único punto de
 * definición: `OrderStatusHistory` (historial de estado) y la sección de
 * contacto anonimizada de `OrderDetail` (US-021) usan este mismo formatter en
 * vez de declarar cada uno el suyo.
 */
export function formatDateTime(iso: string): string {
  return formatter.format(new Date(iso));
}
