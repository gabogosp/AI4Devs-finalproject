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

/**
 * 409 — un pago automático (`mercadopago`/`simulated_dsm`) se aprobó pero la
 * orden se canceló y compensó por falta de stock (US-010 AC-4). Distinto de
 * `InsufficientStockError` cruda: el llamador (controller) necesita saber
 * que la compensación YA CORRIÓ (reembolso disparado o `refund_pending`),
 * no que el intento simplemente falló como en el camino `manual`.
 */
export class OrderAutoCancelledInsufficientStockError extends DomainError {
  readonly status = 409;
  readonly type = 'dsm:payments/auto-cancelled-insufficient-stock';

  constructor() {
    super(
      'El pago se aprobó pero no había stock suficiente: la orden se canceló y el pago se reembolsó',
    );
  }
}
