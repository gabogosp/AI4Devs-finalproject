import { Injectable, Logger, Optional } from '@nestjs/common';
import { MetricsService } from './metrics.service';

export type PaymentsRejectedReason = 'not-pending-payment' | 'insufficient-stock';

export type PaymentsEventName =
  | 'payments.manual_confirmed'
  | 'payments.manual_confirm_rejected';

/**
 * Eventos de negocio de la confirmación de pago manual (US-023, `design.md`
 * §Observability). Mismo esqueleto que `CheckoutEventsService`: delega el
 * contador en `MetricsService` (`GET /v1/admin/metrics`), nunca PII en la
 * firma — sólo `orderId` al log, jamás como label de métrica (cardinalidad).
 */
@Injectable()
export class PaymentsEventsService {
  private readonly logger = new Logger(PaymentsEventsService.name);

  constructor(
    /** `@Optional()`, precedente de `CheckoutEventsService`. */
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  emitConfirmed(orderId: string): void {
    this.metrics?.increment('payments', 'payments.manual_confirmed');
    this.logger.log({ event: 'payments.manual_confirmed', entity_id: orderId });
  }

  emitRejected(orderId: string | null, reason: PaymentsRejectedReason): void {
    this.metrics?.increment('payments', `payments.manual_confirm_rejected.${reason}`);
    this.logger.log({
      event: 'payments.manual_confirm_rejected',
      entity_id: orderId,
      reason,
    });
  }

  /** Valor del contador, leído del registro real (precedente: `CheckoutEventsService`). */
  async countConfirmed(): Promise<number> {
    return (await this.metrics?.value('payments', 'payments.manual_confirmed')) ?? 0;
  }

  async countRejected(reason: PaymentsRejectedReason): Promise<number> {
    return (
      (await this.metrics?.value('payments', `payments.manual_confirm_rejected.${reason}`)) ?? 0
    );
  }
}
