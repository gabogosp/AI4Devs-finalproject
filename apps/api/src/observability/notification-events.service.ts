import { Injectable, Logger, Optional } from '@nestjs/common';
import { MetricsService } from './metrics.service';

export type NotificationType =
  | 'order_confirmed'
  | 'owner_new_order'
  | 'order_ready_for_pickup'
  | 'order_cancelled_no_stock';

/**
 * Eventos de negocio del envío de notificaciones por email (US-011,
 * `design.md` §Observabilidad). Mismo esqueleto que `PaymentsEventsService`/
 * `OrderEventsService`: delega el contador en `MetricsService` — el valor
 * sale por `GET /v1/admin/metrics` como
 * `dsm_notifications_events_total{event="..."}`.
 *
 * `type` es la única label además de `event` (cardinalidad acotada: 4
 * valores). `orderId`/`attempts` van al **log**, nunca a la métrica.
 *
 * Cero PII: ni `buyerName` ni `buyerEmail` llegan nunca a este servicio.
 */
@Injectable()
export class NotificationEventsService {
  private readonly logger = new Logger(NotificationEventsService.name);

  constructor(
    /** `@Optional()`, mismo precedente que `PaymentsEventsService`. */
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  emitSent(type: NotificationType, orderId: string, attempts: number): void {
    this.metrics?.increment('notifications', `notification.sent.${type}`);
    this.logger.log({ event: 'notification.sent', type, entity_id: orderId, attempts });
  }

  emitFailed(type: NotificationType, orderId: string, attempts: number): void {
    this.metrics?.increment('notifications', `notification.failed.${type}`);
    this.logger.log({ event: 'notification.failed', type, entity_id: orderId, attempts });
  }

  /** Valor del contador, leído del registro real — para tests. */
  async countSent(type: NotificationType): Promise<number> {
    return (await this.metrics?.value('notifications', `notification.sent.${type}`)) ?? 0;
  }

  async countFailed(type: NotificationType): Promise<number> {
    return (await this.metrics?.value('notifications', `notification.failed.${type}`)) ?? 0;
  }
}
