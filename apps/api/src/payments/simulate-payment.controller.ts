import { randomUUID } from 'node:crypto';
import { Body, Controller, HttpCode, NotFoundException, Post, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { hashToken } from '../auth/tokens/opaque-token';
import { OrdersRepository } from '../checkout/orders.repository';
import { ConfirmOrderService } from './confirm-order.service';
import { PaymentConfirmedDto } from './dto/payment-confirmed.dto';
import { SimulatePaymentDto } from './dto/simulate-payment.dto';
import { OrderNotFoundError } from './payment-confirmation-errors';
import { PaymentsSimulateThrottlerGuard } from './payments-simulate-throttler.guard';

/**
 * `POST /v1/checkout/simulate-payment` (US-010 T7.1-T7.3, `design.md` §D7,
 * ADR-0006). Medio simulado: NUNCA llama a MercadoPago — su única razón de
 * ser es saltarlo. AC-9 estructural: pasa por el MISMO
 * `ConfirmOrderService.confirm()` que el webhook real.
 *
 * Autorización igual que el contrato ya declarado para `POST /v1/payments`
 * (US-009): el `order_token` (hex de 64) viaja en el CUERPO, no en una
 * cookie — nunca `AdminGuard`/`CartCsrfGuard`.
 *
 * Cuando `PAYMENTS_SIMULATED_ENABLED` está apagado (default, obligatorio en
 * producción — `env.validation.ts` superRefine), responde 404: no hay razón
 * para confirmarle a quien prueba en producción que la ruta existe.
 */
@Controller('v1/checkout')
@UseGuards(PaymentsSimulateThrottlerGuard)
@SkipThrottle({ auth: true, storefront: true, cart: true, enrichment: true, search: true, checkout: true })
export class SimulatePaymentController {
  constructor(
    private readonly config: ConfigService,
    private readonly orders: OrdersRepository,
    private readonly confirmOrder: ConfirmOrderService,
  ) {}

  @Post('simulate-payment')
  @HttpCode(200)
  @Throttle({
    payments_simulate: {
      limit: Number(process.env.PAYMENTS_SIMULATE_RATE_LIMIT_MAX ?? 10),
    },
  })
  async simulate(@Body() body: SimulatePaymentDto): Promise<PaymentConfirmedDto> {
    if (this.config.get<string>('PAYMENTS_SIMULATED_ENABLED') !== 'true') {
      throw new NotFoundException();
    }

    const orden = await this.orders.findByTokenHash(hashToken(body.order_token));
    if (!orden) {
      throw new OrderNotFoundError();
    }

    const confirmado = await this.confirmOrder.confirm({
      orderId: orden.id,
      provider: 'simulated_dsm',
      externalId: `sim_${randomUUID()}`,
      amountArsCents: orden.total_ars_cents,
    });
    return PaymentConfirmedDto.from(confirmado);
  }
}
