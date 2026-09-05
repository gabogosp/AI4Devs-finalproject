import { Matches } from 'class-validator';

/**
 * Entrada de `POST /v1/checkout/simulate-payment` (US-010 T7.1, `design.md`
 * §D7). `order_token` es el mismo formato que el contrato ya declarado para
 * `POST /v1/payments` de US-009 (todavía sin construir): hex de 64
 * caracteres (32 bytes de CSPRNG, `checkout/order-token.service.ts`) — nunca
 * base64url, que es lo que usan refresh/reset/carrito.
 */
export class SimulatePaymentDto {
  @Matches(/^[0-9a-f]{64}$/, { message: 'order_token debe ser hex de 64 caracteres' })
  order_token!: string;
}
