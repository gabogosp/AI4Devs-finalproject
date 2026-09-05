import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { CheckoutModule } from '../checkout/checkout.module';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsEventsService } from '../observability/payments-events.service';
import { PrismaModule } from '../prisma/prisma.module';
import { StockModule } from '../stock/stock.module';
import { AdminJobsController } from './admin-jobs.controller';
import { ConfirmOrderService } from './confirm-order.service';
import { MercadoPagoClient } from './mercadopago/mercadopago-client';
import { PaymentConfirmationController } from './payment-confirmation.controller';
import { PaymentsRepository } from './payments.repository';
import { PaymentsSimulateThrottlerGuard } from './payments-simulate-throttler.guard';
import { ReconcilePaymentsService } from './reconcile-payments.service';
import { SimulatePaymentController } from './simulate-payment.controller';
import { MercadoPagoWebhookController } from './webhooks/mercadopago-webhook.controller';

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
  controllers: [
    PaymentConfirmationController,
    MercadoPagoWebhookController,
    SimulatePaymentController,
    AdminJobsController,
  ],
  providers: [
    ConfirmOrderService,
    PaymentsRepository,
    PaymentsEventsService,
    PaymentsSimulateThrottlerGuard,
    ReconcilePaymentsService,
    // Factory (no `providers: [MercadoPagoClient]` directo): el constructor tiene
    // `baseUrl`/`seams` con default — Nest no puede resolverlos por reflexión de
    // tipos (string/object no son tokens), mismo patrón que `ai.providers.ts`
    // (GeminiHttpClient) para el mismo problema.
    {
      provide: MercadoPagoClient,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => new MercadoPagoClient(config),
    },
  ],
  exports: [ConfirmOrderService],
})
export class PaymentsModule {}
