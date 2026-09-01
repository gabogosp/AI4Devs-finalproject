import type { OrderStatus } from './ordersService';

/**
 * Proyección FE, pura, de la FSM del E2E §12 (`design.md` §D4). El backend es
 * la autoridad real (`order-state.ts`) — este módulo sólo decide qué botón
 * *ofrecer*; AC-6 se cumple aunque este mapa tuviera un bug, porque el
 * `PATCH` sigue pudiendo devolver 409.
 */

/** Único paso siguiente válido por estado. `null` = terminal para este panel. */
export const NEXT_STATUS: Record<OrderStatus, OrderStatus | null> = {
  new: 'preparing',
  preparing: 'ready',
  ready: 'delivered',
  delivered: null,
};

export const STATUS_LABEL: Record<OrderStatus, string> = {
  new: 'Nueva',
  preparing: 'Preparando',
  ready: 'Lista para retirar',
  delivered: 'Entregada',
};

/** Copy del botón — sólo existe para el paso siguiente válido. */
export const ACTION_LABEL: Partial<Record<OrderStatus, string>> = {
  preparing: 'Marcar como preparando',
  ready: 'Marcar como lista para retirar',
  delivered: 'Marcar como entregada',
};
