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
import { NotificationsModule } from './ports/notifications.module';

/**
 * Panel admin de órdenes (US-012, design.md §D1) + historial de compras del
 * cliente (US-015, design.md §D5) — dos audiencias distintas sobre las mismas
 * tablas. Importa `CheckoutModule` para inyectar `OrdersRepository` (T3.2 lo
 * exportó) y `AuthModule` para `AdminGuard`/`CustomerGuard`/`JwtService` —
 * dirección acíclica, sin referencias diferidas (`orders → checkout`,
 * `checkout` no conoce `orders`). US-015 no agrega ningún import nuevo: los
 * dos ya estaban acá.
 *
 * `NOTIFICATION_PORT` (US-011 T7.2) vive en `NotificationsModule` (extraído
 * de acá — email de bienvenida/resumen de compra US-026-emails): resuelve
 * por entorno, con `RESEND_API_KEY` presente al adapter real de Resend, sin
 * ella al de log. `OrdersModule` re-exporta `NotificationsModule` para que
 * `PaymentsModule` (que ya importa `OrdersModule`) siga resolviendo el
 * token sin cambiar su forma de inyectarlo.
 */
@Module({
  imports: [PrismaModule, AuthModule, CheckoutModule, NotificationsModule],
  controllers: [OrdersController, OrdersHistoryController],
  providers: [
    OrdersAdminService,
    OrdersHistoryService,
    OrdersHistoryThrottlerGuard,
    OrderStatusHistoryRepository,
    OrderEventsService,
    OrdersHistoryEventsService,
  ],
  // US-010 T8.1: PaymentsModule inyecta NOTIFICATION_PORT (nuevo edge
  // payments → orders, acíclico — orders no importa payments). US-013 T4.1:
  // agrega un segundo export al mismo edge, ningún import nuevo de módulo.
  exports: [NotificationsModule, OrderStatusHistoryRepository],
})
export class OrdersModule {}
