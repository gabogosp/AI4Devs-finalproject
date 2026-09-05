import { Body, Controller, HttpCode, Logger, Post, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { configNumber } from '../../enrichment/config-number';
import { PaymentsEventsService } from '../../observability/payments-events.service';
import { ConfirmOrderService } from '../confirm-order.service';
import { MercadoPagoWebhookBodyDto } from '../dto/mercadopago-webhook-body.dto';
import { MercadoPagoClient } from '../mercadopago/mercadopago-client';
import { parseSignatureHeader, verifyWebhookSignature } from '../mercadopago/webhook-signature';
import { WebhookUnverifiedError } from '../payment-confirmation-errors';

/**
 * `POST /v1/webhooks/mercadopago` (US-010 T6.1-T6.3, `design.md` §D2/§D11).
 *
 * Sin `@UseGuards` de ningún throttler — decisión explícita (§D5): limitar
 * por IP la puerta de entrada de dinero descartaría pagos legítimos cuando
 * MercadoPago reintenta en ráfaga. La protección es la firma (rechazarla
 * cuesta un HMAC) y que nada no verificado toca la base.
 *
 * Responde **siempre 200 salvo firma inválida** (401) — MercadoPago reintenta
 * ante cualquier respuesta que no sea 2xx, así que un 500 por un bug nuestro
 * desataría una tormenta de reintentos justo cuando el sistema está mal. Un
 * fallo transitorio queda para la reconciliación (AC-10).
 */
@Controller('v1/webhooks/mercadopago')
export class MercadoPagoWebhookController {
  private readonly logger = new Logger(MercadoPagoWebhookController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly mercadoPago: MercadoPagoClient,
    private readonly confirmOrder: ConfirmOrderService,
    private readonly events: PaymentsEventsService,
  ) {}

  @Post()
  @HttpCode(200)
  async recibirWebhook(
    @Body() body: MercadoPagoWebhookBodyDto,
    @Req() req: Request,
  ): Promise<{ received: boolean }> {
    const parsed = parseSignatureHeader(req.headers['x-signature'] as string | undefined);
    const requestId = req.headers['x-request-id'] as string | undefined;

    const valida =
      !!parsed &&
      !!requestId &&
      verifyWebhookSignature({
        dataId: body.data.id,
        requestId,
        ts: parsed.ts,
        v1: parsed.v1,
        secret: this.config.get<string>('MP_WEBHOOK_SECRET') ?? '',
        toleranceSec: configNumber(this.config, 'MP_WEBHOOK_TOLERANCE_SEC', 300),
        now: Math.floor(Date.now() / 1000),
      });

    if (!valida) {
      // AC-7: cero escrituras, cero llamada a MercadoPago — la firma es la
      // única puerta antes de creerle algo al payload.
      this.events.emitSignatureRejected();
      throw new WebhookUnverifiedError();
    }

    this.events.emitWebhookReceived(body.data.id);

    const pago = await this.mercadoPago.getPayment(body.data.id);
    if (pago.status !== 'approved') {
      // AC-3: pago rechazado/pendiente — no-op, nunca toca la orden.
      return { received: true };
    }

    if (!pago.externalReference) {
      // Anomalía: MercadoPago aprobó un pago sin `external_reference` — no hay
      // orden a la que confirmar. Se loguea y se responde 200 (nunca 5xx).
      this.logger.warn(
        `payment ${pago.id} approved sin external_reference — no se puede confirmar ninguna orden`,
      );
      return { received: true };
    }

    try {
      await this.confirmOrder.confirm({
        orderId: pago.externalReference,
        provider: 'mercadopago',
        externalId: pago.id,
        amountArsCents: pago.amountArsCents,
      });
    } catch (error) {
      // T6.2 — cualquier error (orden inexistente, ya confirmada, sin stock
      // ya compensada, o lo que sea) responde 200 igual. Cada rama ya emitió
      // su propio evento dentro de ConfirmOrderService.
      this.logger.warn(
        `confirm() falló para orden ${pago.externalReference} (payment ${pago.id}): ${(error as Error).message}`,
      );
    }
    return { received: true };
  }
}
