import { DomainError } from '../common/errors/domain-errors';

/**
 * 409 — un ítem de la orden se quedó sin stock suficiente entre el checkout y
 * la confirmación del pago (ADR-0008). Vive en `payments/` conceptualmente
 * (el consumidor es `ConfirmOrderService`), pero el `type` es
 * `dsm:payments/insufficient-stock` — declarado acá porque el archivo lo
 * lanza, per `design.md` §Approach.
 */
export class InsufficientStockError extends DomainError {
  readonly status = 409;
  readonly type = 'dsm:payments/insufficient-stock';

  constructor(productId: string) {
    super('Uno o más productos de la orden se quedaron sin stock suficiente', undefined, {
      product_id: productId,
    });
  }
}
