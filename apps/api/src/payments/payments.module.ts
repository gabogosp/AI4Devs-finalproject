import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CheckoutModule } from '../checkout/checkout.module';
import { PaymentsEventsService } from '../observability/payments-events.service';
import { PrismaModule } from '../prisma/prisma.module';
import { StockModule } from '../stock/stock.module';
import { ConfirmOrderService } from './confirm-order.service';
import { PaymentConfirmationController } from './payment-confirmation.controller';
import { PaymentsRepository } from './payments.repository';

/**
 * `design.md` §Approach — dirección de dependencias acíclica: `payments ->
 * checkout` (por `OrdersRepository`), `payments -> stock`. Sin `forwardRef`.
 * Importa `AuthModule` por `AdminGuard` + `JwtModule` re-exportado (para
 * decodificar el `sub` sin re-verificar, mismo patrón que `ProductsModule`).
 */
@Module({
  imports: [PrismaModule, AuthModule, CheckoutModule, StockModule],
  controllers: [PaymentConfirmationController],
  providers: [ConfirmOrderService, PaymentsRepository, PaymentsEventsService],
  exports: [ConfirmOrderService],
})
export class PaymentsModule {}
