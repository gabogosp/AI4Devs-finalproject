import { Injectable, Logger, Optional } from '@nestjs/common';
import { MetricsService } from './metrics.service';

export type PaymentsRejectedReason = 'not-pending-payment' | 'insufficient-stock';

export type PaymentsProvider = 'mercadopago' | 'simulated_dsm';

export type PaymentsEventName =
  | 'payments.manual_confirmed'
  | 'payments.manual_confirm_rejected'
  | 'payments.provider_confirmed'
  | 'payments.auto_cancelled'
  | 'payments.refund_failed'
  | 'payments.webhook_received'
  | 'payments.webhook_signature_rejected'
  | 'payments.reconcile_recovered'
  | 'payments.cleanup_cancelled';

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

  /** Pago confirmado por un provider automático (US-010 AC-1/AC-9) — nunca `emitConfirmed`. */
  emitProviderConfirmed(orderId: string, provider: PaymentsProvider): void {
    this.metrics?.increment('payments', `payments.provider_confirmed.${provider}`);
    this.logger.log({ event: 'payments.provider_confirmed', entity_id: orderId, provider });
  }

  /** Cancelación automática por falta de stock tras un pago aprobado (US-010 AC-4). */
  emitAutoCancelled(orderId: string): void {
    this.metrics?.increment('payments', 'payments.auto_cancelled');
    this.logger.log({ event: 'payments.auto_cancelled', entity_id: orderId });
  }

  /** El reembolso falló y la fila queda `refund_pending` (US-010 AC-4 durable). */
  emitRefundFailed(orderId: string, paymentId: string): void {
    this.metrics?.increment('payments', 'payments.refund_failed');
    this.logger.log({ event: 'payments.refund_failed', entity_id: orderId, payment_id: paymentId });
  }

  /** Webhook recibido, ANTES de verificar la firma (US-010 D11). */
  emitWebhookReceived(paymentId: string): void {
    this.metrics?.increment('payments', 'payments.webhook_received');
    this.logger.log({ event: 'payments.webhook_received', entity_id: paymentId });
  }

  /** Firma inválida — sin `paymentId`: el body no es de confiar todavía (US-010 D11). */
  emitSignatureRejected(): void {
    this.metrics?.increment('payments', 'payments.webhook_signature_rejected');
    this.logger.log({ event: 'payments.webhook_signature_rejected' });
  }

  /** La reconciliación recuperó un pago aprobado que el webhook nunca confirmó (US-010 AC-10). */
  emitReconcileRecovered(orderId: string): void {
    this.metrics?.increment('payments', 'payments.reconcile_recovered');
    this.logger.log({ event: 'payments.reconcile_recovered', entity_id: orderId });
  }

  /** La limpieza canceló `count` órdenes abandonadas en una corrida (US-010 AC-11). */
  emitCleanupCancelled(count: number): void {
    this.metrics?.increment('payments', 'payments.cleanup_cancelled');
    this.logger.log({ event: 'payments.cleanup_cancelled', count });
  }
}
