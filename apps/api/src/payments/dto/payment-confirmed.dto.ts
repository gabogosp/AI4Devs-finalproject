import { ConfirmedPayment } from '../payment-confirmation.port';

/** Respuesta de `POST /v1/admin/orders/{orderId}/confirm-payment` (AC-1). */
export class PaymentConfirmedDto {
  order_number!: number;
  status!: 'new';

  static from(confirmado: ConfirmedPayment): PaymentConfirmedDto {
    return {
      order_number: confirmado.orderNumber,
      status: confirmado.status,
    };
  }
}
