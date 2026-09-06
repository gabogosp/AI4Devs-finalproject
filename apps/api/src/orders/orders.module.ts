import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { CheckoutModule } from '../checkout/checkout.module';
import { OrdersController } from './orders.controller';
import { OrdersHistoryController } from './orders-history.controller';
import { OrdersAdminService } from './orders-admin.service';
import { OrdersHistoryService } from './orders-history.service';
import { OrdersHistoryThrottlerGuard } from './orders-history-throttler.guard';
import { OrderStatusHistoryRepository } from './order-status-history.repository';
import { OrderEventsService } from '../observability/order-events.service';
import { OrdersHistoryEventsService } from '../observability/orders-history-events.service';
import { NotificationEventsService } from '../observability/notification-events.service';
import { NOTIFICATION_PORT } from './ports/notification.port';
import { notificationPortProvider } from './ports/notification.provider';

/**
 * Panel admin de órdenes (US-012, design.md §D1) + historial de compras del
 * cliente (US-015, design.md §D5) — dos audiencias distintas sobre las mismas
 * tablas. Importa `CheckoutModule` para inyectar `OrdersRepository` (T3.2 lo
 * exportó) y `AuthModule` para `AdminGuard`/`CustomerGuard`/`JwtService` —
 * dirección acíclica, sin referencias diferidas (`orders → checkout`,
 * `checkout` no conoce `orders`). US-015 no agrega ningún import nuevo: los
 * dos ya estaban acá.
 *
 * `NOTIFICATION_PORT` resuelve por entorno (US-011 T7.2, `notification.provider.ts`)
 * — con `RESEND_API_KEY` presente, al adapter real de Resend; sin ella, al de
 * log (local/CI sin credenciales). Mismo patrón que
 * `passwordResetMailerProvider` en `AuthModule`.
 */
@Module({
  imports: [PrismaModule, AuthModule, CheckoutModule],
  controllers: [OrdersController, OrdersHistoryController],
  providers: [
    OrdersAdminService,
    OrdersHistoryService,
    OrdersHistoryThrottlerGuard,
    OrderStatusHistoryRepository,
    OrderEventsService,
    OrdersHistoryEventsService,
    NotificationEventsService,
    notificationPortProvider,
  ],
  // US-010 T8.1: PaymentsModule inyecta NOTIFICATION_PORT (nuevo edge
  // payments → orders, acíclico — orders no importa payments). US-013 T4.1:
  // agrega un segundo export al mismo edge, ningún import nuevo de módulo.
  exports: [NOTIFICATION_PORT, OrderStatusHistoryRepository],
})
export class OrdersModule {}
