import { Order } from '@dsm/db';

/**
 * Fila de `GET /v1/admin/orders/pending-payment` (AC-2). `id` es obligatorio
 * — es el UUID que espera el path de `POST /confirm-payment`; sin él ningún
 * consumidor podría construir esa URL desde este listado (hallazgo del
 * co-desarrollo con US-012-panel-ordenes-dueno, 2026-08-30). Campo por
 * campo, igual que `CheckoutResponseDto`: **sin** `buyer_email`/`buyer_phone`
 * (`design.md` §Threat model, Info disclosure).
 */
export class PendingPaymentOrderDto {
  id!: string;
  order_number!: number;
  buyer_name!: string;
  total_ars_cents!: number;
  created_at!: Date;

  static from(orden: Order): PendingPaymentOrderDto {
    return {
      id: orden.id,
      order_number: orden.order_number,
      buyer_name: orden.buyer_name,
      total_ars_cents: orden.total_ars_cents,
      created_at: orden.created_at,
    };
  }
}
