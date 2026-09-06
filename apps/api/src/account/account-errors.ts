import { DomainError } from '../common/errors/domain-errors';
import { OrderHistorySummaryDto } from '../orders/dto/order-history.dto';

/**
 * 409 — el cliente tiene al menos una orden en curso (US-020, decisión §10.5:
 * `pending_payment`/`new`/`preparing`/`ready` bloquean; `delivered`/`cancelled`
 * no). Usa `extensions` (mismo mecanismo que el 409 de stock del carrito) para
 * llevar `blocking_orders` con el mismo shape que `OrderHistorySummaryDto`
 * (US-015) — así el frontend puede listar las órdenes sin un segundo request.
 */
export class AccountHasActiveOrdersError extends DomainError {
  readonly status = 409;
  readonly type = 'dsm:account/active-orders';

  constructor(blockingOrders: OrderHistorySummaryDto[]) {
    super(
      'La cuenta tiene órdenes en curso: no se puede borrar hasta que se cierren',
      undefined,
      { blocking_orders: blockingOrders },
    );
  }
}
