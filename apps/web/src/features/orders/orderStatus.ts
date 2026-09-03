import type { FulfillmentStatus, FulfillmentTarget } from './ordersService';

/**
 * Proyección FE, pura, de la FSM del E2E §12 (`design.md` §D4). El backend es
 * la autoridad real (`order-state.ts`) — este módulo sólo decide qué botón
 * *ofrecer*; AC-6 se cumple aunque este mapa tuviera un bug, porque el
 * `PATCH` sigue pudiendo devolver 409.
 *
 * Sobre `FulfillmentStatus` (4 valores activos), no `OrderStatus` (5, incluye
 * `cancelled`) — esta FSM nunca ofrece una transición hacia/desde `cancelled`
 * (US-013), así que un `Record<OrderStatus, …>` obligaría una entrada sin
 * sentido de dominio acá.
 */

/**
 * Único paso siguiente válido por estado. `null` = terminal para este panel.
 * Tipado como `FulfillmentTarget | null` (no `FulfillmentStatus`): el valor
 * nunca es `'new'` (nada transiciona HACIA `new` en esta FSM) — mismo tipo
 * que espera `ordersService.updateStatus`, sin necesitar un cast en el caller.
 */
export const NEXT_STATUS: Record<FulfillmentStatus, FulfillmentTarget | null> = {
  new: 'preparing',
  preparing: 'ready',
  ready: 'delivered',
  delivered: null,
};

export const STATUS_LABEL: Record<FulfillmentStatus, string> = {
  new: 'Nueva',
  preparing: 'Preparando',
  ready: 'Lista para retirar',
  delivered: 'Entregada',
};

/** Copy del botón — sólo existe para el paso siguiente válido. */
export const ACTION_LABEL: Partial<Record<FulfillmentStatus, string>> = {
  preparing: 'Marcar como preparando',
  ready: 'Marcar como lista para retirar',
  delivered: 'Marcar como entregada',
};
