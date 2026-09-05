import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CheckoutModule } from '../checkout/checkout.module';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsEventsService } from '../observability/payments-events.service';
import { PrismaModule } from '../prisma/prisma.module';
import { StockModule } from '../stock/stock.module';
import { ConfirmOrderService } from './confirm-order.service';
import { PaymentConfirmationController } from './payment-confirmation.controller';
import { PaymentsRepository } from './payments.repository';

/**
 * `design.md` §Approach — dirección de dependencias acíclica: `payments ->
 * checkout` (por `OrdersRepository`), `payments -> stock`, `payments ->
 * orders` (US-010 T8.2, por `NOTIFICATION_PORT` — `orders` no importa
 * `payments`, verificado). Sin `forwardRef`.
 * Importa `AuthModule` por `AdminGuard` + `JwtModule` re-exportado (para
 * decodificar el `sub` sin re-verificar, mismo patrón que `ProductsModule`).
 */
@Module({
  imports: [PrismaModule, AuthModule, CheckoutModule, StockModule, OrdersModule],
  controllers: [PaymentConfirmationController],
  providers: [ConfirmOrderService, PaymentsRepository, PaymentsEventsService],
  exports: [ConfirmOrderService],
})
export class PaymentsModule {}
