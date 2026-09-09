import { Module } from '@nestjs/common';
import { NotificationEventsService } from '../../observability/notification-events.service';
import { NOTIFICATION_PORT } from './notification.port';
import { notificationPortProvider } from './notification.provider';

/**
 * Módulo dedicado de `NOTIFICATION_PORT` — extraído de `OrdersModule` para
 * que `CheckoutModule` pueda inyectarlo sin crear un ciclo.
 *
 * `OrdersModule` importa `CheckoutModule` (para `OrdersRepository`, §5),
 * dirección acíclica documentada en `orders.module.ts`. Si `CheckoutModule`
 * importara `OrdersModule` de vuelta (para `NOTIFICATION_PORT`, necesario
 * desde `CheckoutService.createOrder` — resumen de compra al cliente +
 * aviso al dueño en el momento real de disparo, MercadoPago diferido) sería
 * un ciclo. Este módulo no importa ni `CheckoutModule` ni `OrdersModule`,
 * así que ambos pueden importarlo sin problema (diamante, no ciclo).
 *
 * `PaymentsModule` sigue resolviendo `NOTIFICATION_PORT` a través de
 * `OrdersModule` (que ahora importa y re-exporta este módulo) — ningún
 * consumidor existente cambia su forma de inyectarlo.
 */
@Module({
  providers: [NotificationEventsService, notificationPortProvider],
  exports: [NOTIFICATION_PORT, NotificationEventsService],
})
export class NotificationsModule {}
