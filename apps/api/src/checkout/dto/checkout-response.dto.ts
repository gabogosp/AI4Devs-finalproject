import { CreatedOrder } from '../checkout.service';

/**
 * Respuesta de `POST /v1/checkout` (T3.1) — construida **campo por campo**,
 * igual que `cart.dto.ts`: nada de `{ ...orden }`. El `order_id` UUID interno
 * **no** se expone (US-002/US-003 ya fijaron que los identificadores internos
 * no salen a la red) — la identidad pública de la orden es `order_token`
 * (autoriza, US-009 la consume) y `order_number` (legible, para el comprador).
 */
export class CheckoutResponseDto {
  /** Claro del token de acceso. Se devuelve **una sola vez**, acá. */
  order_token!: string;
  /** Entero legible («Pedido #1042»), desde la `SEQUENCE` (arranca en 1000). */
  order_number!: number;
  status!: string;
  total_ars_cents!: number;
  items_count!: number;

  static from(orden: CreatedOrder): CheckoutResponseDto {
    return {
      order_token: orden.orderToken,
      order_number: orden.orderNumber,
      status: orden.status,
      total_ars_cents: orden.totalArsCents,
      items_count: orden.itemsCount,
    };
  }
}
