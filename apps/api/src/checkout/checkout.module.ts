import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ProductsModule } from '../products/products.module';
import { CartModule } from '../cart/cart.module';
import { AuthModule } from '../auth/auth.module';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';
import { OrdersRepository } from './orders.repository';
import { OrderTokenService } from './order-token.service';
import { CheckoutThrottlerGuard } from './checkout-throttler.guard';
import { CheckoutEventsService } from '../observability/checkout-events.service';
import { OrdersRetentionController } from './orders-retention.controller';
import { OrdersRetentionService } from './orders-retention.service';
import { OrdersRetentionRunner } from './orders-retention.runner';
import { OrdersRetentionEventsService } from '../observability/orders-retention-events.service';

/**
 * Módulo del checkout guest (US-008), `CheckoutModule` del E2E §6.1 —
 * componente separado de `CartModule` (design.md §Trade-offs).
 *
 * Importa `CartModule` para consumir `CartTokenService` + `CartsRepository`
 * (T1.3) y `CartCsrfGuard` (T3.2) — nunca `prisma.cart`/`prisma.cartItem`
 * directo. Importa `ProductsModule` por la misma razón que el carrito:
 * `ProductsRepository` sigue siendo el único punto de ORM de `products` (§5).
 */
@Module({
  imports: [PrismaModule, ProductsModule, CartModule, AuthModule],
  controllers: [CheckoutController, OrdersRetentionController],
  providers: [
    CheckoutService,
    OrdersRepository,
    OrderTokenService,
    CheckoutThrottlerGuard,
    CheckoutEventsService,
    // US-021 — retención/anonimización de PII de órdenes. Vive acá por
    // ausencia de un módulo de órdenes admin dedicado (US-012 sigue sin
    // backend) — ver checkout/README.md.
    OrdersRetentionService,
    OrdersRetentionRunner,
    OrdersRetentionEventsService,
  ],
})
export class CheckoutModule {}
