import { DomainError } from '../common/errors/domain-errors';

/**
 * 409 — la orden no está `pending_payment`. Unifica dos casos que un cliente
 * observa igual (`design.md` §Approach): la orden ya está en otro estado
 * (`new`, `cancelled`, …) o ya fue confirmada antes (doble click / reintento
 * — AC-4 y AC-5 comparten este único camino).
 */
export class OrderNotPendingPaymentError extends DomainError {
  readonly status = 409;
  readonly type = 'dsm:payments/order-not-pending-payment';

  constructor(currentStatus?: string) {
    super(
      currentStatus
        ? `La orden ya está en estado "${currentStatus}"`
        : 'La orden no está pendiente de pago',
    );
  }
}

/** 404 — no existe una orden con ese id. */
export class OrderNotFoundError extends DomainError {
  readonly status = 404;
  readonly type = 'dsm:payments/order-not-found';

  constructor() {
    super('Orden no encontrada');
  }
}
