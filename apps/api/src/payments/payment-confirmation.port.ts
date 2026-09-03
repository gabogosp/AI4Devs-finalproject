/**
 * Puerto de confirmación de pago (US-023 §10 — extraído del diseño de
 * US-009, que lo nombró primero sin construirlo). `ConfirmOrderService` es
 * el único adaptador hoy (`provider: 'manual'`); US-010 amplía este mismo
 * contrato para el webhook de MercadoPago (`provider: 'mercadopago' |
 * 'simulated_dsm'`, con `externalId` en vez de `confirmedBy`) — sin
 * renombrar nada, per `design.md` §Approach.
 */
export interface ConfirmPaymentInput {
  orderId: string;
  provider: 'manual';
  /** El `sub` del JWT admin que confirmó — uuid de `Customer` o `'admin'` (bootstrap). */
  confirmedBy: string;
}

export interface ConfirmedPayment {
  orderId: string;
  orderNumber: number;
  status: 'new';
  paymentId: string;
}

export interface PaymentConfirmationPort {
  confirm(input: ConfirmPaymentInput): Promise<ConfirmedPayment>;
}
