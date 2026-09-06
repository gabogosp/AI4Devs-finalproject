/**
 * Nota de transparencia cuando el backend acota el `from` pedido a la
 * retención vigente (AC-9, `design.md` Decisión 5).
 *
 * `null` cuando no hay nada que señalar: sin `from` pedido (el dueño no tocó
 * el filtro), o cuando el `from` efectivo coincide con el pedido. Se calcula
 * por widget con el `range.from` que ESE widget recibió — los 3 datasets
 * comparten el mismo cálculo de clamp en el backend, pero cada widget puede
 * cargar/fallar de forma independiente (Decisión 8), así que no hay un
 * estado compartido del que leer.
 */
export function describeClamp(
  requested: string | undefined,
  effective: string,
): string | null {
  if (!requested) {
    return null;
  }

  const requestedTime = new Date(requested).getTime();
  const effectiveTime = new Date(effective).getTime();

  if (Number.isNaN(requestedTime) || Number.isNaN(effectiveTime)) {
    return null;
  }

  if (requestedTime >= effectiveTime) {
    return null;
  }

  const fecha = new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(effective));

  return `Mostrando desde ${fecha} — no hay datos más antiguos por la política de retención.`;
}
