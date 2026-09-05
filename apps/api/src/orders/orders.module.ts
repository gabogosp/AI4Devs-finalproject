import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { CheckoutModule } from '../checkout/checkout.module';
import { OrdersController } from './orders.controller';
import { OrdersAdminService } from './orders-admin.service';
import { OrderStatusHistoryRepository } from './order-status-history.repository';
import { OrderEventsService } from '../observability/order-events.service';
import { NOTIFICATION_PORT } from './ports/notification.port';
import { LoggingNotificationAdapter } from './ports/logging-notification.adapter';

/**
 * Panel admin de órdenes (US-012, design.md §D1). Importa `CheckoutModule`
 * para inyectar `OrdersRepository` (T3.2 lo exportó) y `AuthModule` para
 * `AdminGuard`/`JwtService` — dirección acíclica, sin referencias diferidas
 * (`orders → checkout`, `checkout` no conoce `orders`).
 */
@Module({
  imports: [PrismaModule, AuthModule, CheckoutModule],
  controllers: [OrdersController],
  providers: [
    OrdersAdminService,
    OrderStatusHistoryRepository,
    OrderEventsService,
    { provide: NOTIFICATION_PORT, useClass: LoggingNotificationAdapter },
  ],
})
export class OrdersModule {}
