import { Injectable, Logger } from '@nestjs/common';
import { NotificationPort, OrderReadyForPickupPayload } from './notification.port';

/**
 * Adapter de **desarrollo y test** del `NotificationPort` — no manda ningún
 * email, escribe en el log. El adapter real (Resend) es responsabilidad de
 * US-011; este change sólo garantiza que el trigger se invoca en el momento
 * correcto (AC-4), sin acoplar el panel a un proveedor de mail que todavía no
 * existe.
 *
 * TODO(US-011): reemplazar por el adapter de Resend cuando esa US aterrice —
 * mismo seam que `PasswordResetMailer`/`LoggingPasswordResetMailer`.
 *
 * `buyerName`/`buyerEmail` NUNCA se loguean — a diferencia del token de reset
 * de password, acá no hay ninguna razón operativa para necesitarlos en el log
 * (el `order_id`/`order_number` ya alcanzan para correlacionar).
 */
@Injectable()
export class LoggingNotificationAdapter implements NotificationPort {
  private readonly logger = new Logger(LoggingNotificationAdapter.name);

  async orderReadyForPickup(payload: OrderReadyForPickupPayload): Promise<void> {
    this.logger.log(
      `order.ready_for_pickup order_id=${payload.orderId} order_number=${payload.orderNumber}`,
    );
  }
}
