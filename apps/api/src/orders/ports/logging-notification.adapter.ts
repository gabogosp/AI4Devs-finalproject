import { Injectable, Logger } from '@nestjs/common';
import {
  NotificationPort,
  OrderCancelledByOwnerPayload,
  OrderCancelledNoStockPayload,
  OrderConfirmedPayload,
  OrderReadyForPickupPayload,
  OrderReceivedPayload,
  OwnerNewOrderPayload,
} from './notification.port';

/**
 * Adapter de **desarrollo y test** del `NotificationPort` — no manda ningún
 * email, escribe en el log. Desde US-011, es el fallback que
 * `notification.provider.ts` resuelve cuando `RESEND_API_KEY` no está
 * presente (local/CI sin credenciales); en producción el binding real es
 * `ResendNotificationAdapter`.
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

  async orderConfirmed(payload: OrderConfirmedPayload): Promise<void> {
    this.logger.log(
      `order.confirmed order_id=${payload.orderId} order_number=${payload.orderNumber}`,
    );
  }

  async ownerNewOrder(payload: OwnerNewOrderPayload): Promise<void> {
    this.logger.log(
      `order.owner_new_order order_id=${payload.orderId} order_number=${payload.orderNumber}`,
    );
  }

  async orderCancelledNoStock(payload: OrderCancelledNoStockPayload): Promise<void> {
    this.logger.log(
      `order.cancelled_no_stock order_id=${payload.orderId} order_number=${payload.orderNumber}`,
    );
  }

  async orderCancelledByOwner(payload: OrderCancelledByOwnerPayload): Promise<void> {
    this.logger.log(
      `order.cancelled_by_owner order_id=${payload.orderId} order_number=${payload.orderNumber}`,
    );
  }

  async orderReceived(payload: OrderReceivedPayload): Promise<void> {
    this.logger.log(
      `order.received order_id=${payload.orderId} order_number=${payload.orderNumber}`,
    );
  }

  async ownerOrderReceived(payload: OwnerNewOrderPayload): Promise<void> {
    this.logger.log(
      `order.owner_order_received order_id=${payload.orderId} order_number=${payload.orderNumber}`,
    );
  }
}
