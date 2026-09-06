import { OrderStatusHistory } from '@dsm/db';
import { OrderWithItems } from '../../checkout/orders.repository';
import { AdminOrderDetailDto } from '../../orders/dto/order.dto';
import { RefundInfo } from '../cancel-order.service';

/**
 * Composición (no herencia) sobre `AdminOrderDetailDto` (US-013,
 * `design.md` §D6) — reusa `fromWithHistory` importándolo de `orders/`, sin
 * abrir un edge de módulo nuevo (clase plana sin DI). El schema OpenAPI
 * (`CancelOrderResponse` en `pagos/contracts/openapi.yaml`) declara sus
 * propios campos en vez de un `$ref` cruzado — ver `design.md` §D6 para el
 * porqué de la duplicación deliberada.
 */
export class CancelOrderResponseDto {
  static from(
    order: OrderWithItems,
    history: OrderStatusHistory[],
    refund: RefundInfo,
  ): AdminOrderDetailDto & { refund: RefundInfo } {
    return { ...AdminOrderDetailDto.fromWithHistory(order, history), refund };
  }
}
