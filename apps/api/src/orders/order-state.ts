/**
 * FSM propia del panel de fulfillment (US-012 AC-3, AC-6) — sólo los 4 estados
 * activos que este panel gestiona, no los 6 de la FSM completa de la orden
 * (design.md §Non-goals). `pending_payment → new` es responsabilidad de
 * `payments/` (US-023); `* → cancelled` es de US-013. Ninguna transición hacia
 * o desde esos dos estados existe acá.
 */
export type FulfillmentStatus = 'new' | 'preparing' | 'ready' | 'delivered';

const VALID_TRANSITIONS: Record<FulfillmentStatus, FulfillmentStatus[]> = {
  new: ['preparing'],
  preparing: ['ready'],
  ready: ['delivered'],
  delivered: [], // terminal
};

export function canTransition(from: string, to: FulfillmentStatus): boolean {
  return (
    (VALID_TRANSITIONS as Record<string, FulfillmentStatus[]>)[from]?.includes(to) ?? false
  );
}
