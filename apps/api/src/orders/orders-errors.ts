import { DomainError } from '../common/errors/domain-errors';

/**
 * Errores de dominio del panel admin de órdenes (§6, US-012). Extienden
 * `DomainError` igual que catálogo/carrito/checkout — el `HttpProblemFilter`
 * existente los mapea al envelope RFC 7807 sin cambios.
 *
 * `OrderInvalidTransitionError` usa 409, no el 422 de `InvalidTransitionError`
 * (catálogo) — decisión local a `orders` (design.md §D3): RFC 7231 §6.5.8
 * describe 409 como "la solicitud entra en conflicto con el estado actual del
 * recurso", exactamente un salto de FSM inválido. Mismo criterio que
 * `OrderNotPendingPaymentError` de `US-023-pago-manual-offline-backend`.
 */

/** 409 — la orden no puede pasar del estado actual al pedido (AC-6). */
export class OrderInvalidTransitionError extends DomainError {
  readonly status = 409;
  readonly type = 'dsm:orders/invalid-transition';

  constructor(from: string, to: string) {
    super(`No se puede pasar de "${from}" a "${to}"`);
  }
}

/** 404 — la orden no existe, o está `pending_payment` (AC-8: no gestionable acá). */
export class OrderNotFoundError extends DomainError {
  readonly status = 404;
  readonly type = 'dsm:orders/not-found';
}
