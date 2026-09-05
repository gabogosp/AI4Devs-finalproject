import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { configNumber } from '../enrichment/config-number';
import { PaymentsEventsService } from '../observability/payments-events.service';
import { MercadoPagoClient } from './mercadopago/mercadopago-client';
import { PaymentsRepository } from './payments.repository';

export interface RefundRetryResult {
  attempted: number;
  succeeded: number;
  failed: number;
}

/**
 * Reintento de reembolsos (US-010 AC-4 durable, `design.md` §D8). Sólo
 * `provider='mercadopago'` — el simulado (`no-op` externo) nunca queda
 * `refund_pending` sin resolver. Un fallo en un pago NO aborta el lote: los
 * demás se reintentan igual. **Nunca marca un reembolso fallido definitivo**
 * — la fila queda `refund_pending` para la próxima corrida.
 */
@Injectable()
export class RefundRetryService {
  private readonly logger = new Logger(RefundRetryService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly payments: PaymentsRepository,
    private readonly mercadoPago: MercadoPagoClient,
    private readonly events: PaymentsEventsService,
  ) {}

  async retryPending(): Promise<RefundRetryResult> {
    const batchSize = configNumber(this.config, 'REFUND_RETRY_BATCH_SIZE', 50);
    const pendientes = await this.payments.listRefundPending(batchSize);

    let succeeded = 0;
    for (const pago of pendientes) {
      try {
        if (!pago.external_id) {
          throw new Error('payment sin external_id — no se puede reembolsar');
        }
        await this.mercadoPago.refund(pago.external_id, pago.amount_ars_cents);
        await this.payments.markRefunded(pago.id);
        succeeded += 1;
      } catch (error) {
        this.events.emitRefundFailed(pago.order_id, pago.id);
        this.logger.warn(
          `retryPending() no pudo reembolsar el pago ${pago.id}: ${(error as Error).message}`,
        );
      }
    }

    return {
      attempted: pendientes.length,
      succeeded,
      failed: pendientes.length - succeeded,
    };
  }
}
