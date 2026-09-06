import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import {
  NotificationPort,
  OrderCancelledByOwnerPayload,
  OrderCancelledNoStockPayload,
  OrderConfirmedPayload,
  OrderReadyForPickupPayload,
  OwnerNewOrderPayload,
} from './notification.port';
import { backoffDelayMs, isTransientResendError } from './notification-backoff';
import {
  orderCancelledByOwnerHtml,
  orderCancelledByOwnerText,
  orderCancelledNoStockHtml,
  orderCancelledNoStockText,
  orderConfirmedHtml,
  orderConfirmedText,
  orderReadyForPickupHtml,
  orderReadyForPickupText,
  ownerNewOrderHtml,
  ownerNewOrderText,
} from './notification-templates';
import { NotificationEventsService, NotificationType } from '../../observability/notification-events.service';

interface EnvioParams {
  type: NotificationType;
  orderId: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Adapter de producción del `NotificationPort` (US-011 T6.1) — envía los 5
 * emails del puerto vía Resend (el 5°, `orderCancelledByOwner`, lo agregó
 * US-013 durante el rebase de este change). Mismo contrato que
 * `ResendPasswordResetMailer`: nunca propaga, timeout acotado por intento,
 * sin PII en logs.
 *
 * Reintento con backoff DENTRO de esta misma llamada síncrona — sin cola,
 * ver `design.md` "Decisión 1". Clasifica transitorio/permanente por
 * `statusCode` (`notification-backoff.ts`); agotados los reintentos, nunca
 * lanza — loguea vía `NotificationEventsService.emitFailed` y resuelve
 * `undefined` (AC-5).
 *
 * `Idempotency-Key` determinística (`{tipo}:{orderId}`) — defensa en
 * profundidad de AC-7 contra el caso "timeout cliente, éxito servidor"
 * (`design.md` Decisión 2).
 */
@Injectable()
export class ResendNotificationAdapter implements NotificationPort {
  private readonly logger = new Logger(ResendNotificationAdapter.name);

  constructor(
    private readonly resend: Resend,
    private readonly config: ConfigService,
    private readonly events: NotificationEventsService,
  ) {}

  async orderConfirmed(payload: OrderConfirmedPayload): Promise<void> {
    await this.enviarConReintentos({
      type: 'order_confirmed',
      orderId: payload.orderId,
      to: payload.buyerEmail,
      subject: `¡Tu compra #${payload.orderNumber} está confirmada!`,
      text: orderConfirmedText(payload),
      html: orderConfirmedHtml(payload),
    });
  }

  async ownerNewOrder(payload: OwnerNewOrderPayload): Promise<void> {
    await this.enviarConReintentos({
      type: 'owner_new_order',
      orderId: payload.orderId,
      to: this.config.getOrThrow<string>('OWNER_NOTIFICATION_EMAIL'),
      subject: `Nueva orden #${payload.orderNumber}`,
      text: ownerNewOrderText(payload),
      html: ownerNewOrderHtml(payload),
    });
  }

  async orderReadyForPickup(payload: OrderReadyForPickupPayload): Promise<void> {
    await this.enviarConReintentos({
      type: 'order_ready_for_pickup',
      orderId: payload.orderId,
      to: payload.buyerEmail,
      subject: `Tu pedido #${payload.orderNumber} está listo para retirar`,
      text: orderReadyForPickupText(payload),
      html: orderReadyForPickupHtml(payload),
    });
  }

  async orderCancelledNoStock(payload: OrderCancelledNoStockPayload): Promise<void> {
    await this.enviarConReintentos({
      type: 'order_cancelled_no_stock',
      orderId: payload.orderId,
      to: payload.buyerEmail,
      subject: `Tu orden #${payload.orderNumber} se canceló`,
      text: orderCancelledNoStockText(payload),
      html: orderCancelledNoStockHtml(payload),
    });
  }

  /** US-013 AC-4 — el dueño canceló manualmente una orden pagada no entregada. */
  async orderCancelledByOwner(payload: OrderCancelledByOwnerPayload): Promise<void> {
    await this.enviarConReintentos({
      type: 'order_cancelled_by_owner',
      orderId: payload.orderId,
      to: payload.buyerEmail,
      subject: `Tu orden #${payload.orderNumber} fue cancelada`,
      text: orderCancelledByOwnerText(payload),
      html: orderCancelledByOwnerHtml(payload),
    });
  }

  /**
   * 1 intento inicial + `NOTIFICATION_RETRY_MAX_ATTEMPTS` reintentos. Cada
   * intento acotado por `RESEND_TIMEOUT_MS` (`conTimeout`). Reintenta sólo si
   * `isTransientResendError` — un error permanente (o el último intento
   * transitorio) dispara `emitFailed` sin esperar backoff. Nunca propaga.
   */
  private async enviarConReintentos(params: EnvioParams): Promise<void> {
    const from = this.config.getOrThrow<string>('ORDER_NOTIFICATIONS_FROM');
    const maxRetries = this.config.get<number>('NOTIFICATION_RETRY_MAX_ATTEMPTS', 2);
    const baseMs = this.config.get<number>('NOTIFICATION_RETRY_BASE_MS', 300);
    const capMs = this.config.get<number>('NOTIFICATION_RETRY_CAP_MS', 2_000);
    const idempotencyKey = `${params.type}:${params.orderId}`;

    for (let intento = 0; intento <= maxRetries; intento += 1) {
      let statusCode: number | null | undefined;
      let mensajeError: string | undefined;

      try {
        const { error } = await this.conTimeout(
          this.resend.emails.send(
            {
              from,
              to: params.to,
              subject: params.subject,
              text: params.text,
              html: params.html,
            },
            { idempotencyKey },
          ),
        );

        if (!error) {
          this.events.emitSent(params.type, params.orderId, intento + 1);
          return;
        }
        // El SDK de Resend devuelve el error en el resultado en vez de lanzarlo.
        statusCode = error.statusCode;
        mensajeError = `${error.name}: ${error.message}`;
      } catch (error) {
        // Excepción de red (timeout de `conTimeout`, ECONNRESET, etc.) — sin
        // `statusCode`, se trata como transitorio (`isTransientResendError`).
        statusCode = null;
        mensajeError = error instanceof Error ? error.message : String(error);
      }

      const esUltimoIntento = intento === maxRetries;
      if (!isTransientResendError(statusCode) || esUltimoIntento) {
        this.logger.error(
          `notification.dispatch_failed order_id=${params.orderId} type=${params.type} attempts=${intento + 1} provider=resend: ${mensajeError}`,
        );
        this.events.emitFailed(params.type, params.orderId, intento + 1);
        return;
      }

      await this.sleep(backoffDelayMs(intento, { baseMs, capMs }));
    }
  }

  /** Duplicado a propósito de `ResendPasswordResetMailer.conTimeout` — ver ese archivo. */
  private async conTimeout<T>(promesa: Promise<T>): Promise<T> {
    const ms = this.config.get<number>('RESEND_TIMEOUT_MS', 5_000);
    let temporizador: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promesa,
        new Promise<never>((_, reject) => {
          temporizador = setTimeout(
            () => reject(new Error(`resend_timeout_after_${ms}ms`)),
            ms,
          );
        }),
      ]);
    } finally {
      if (temporizador) clearTimeout(temporizador);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
