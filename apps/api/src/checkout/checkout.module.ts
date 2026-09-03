import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ProductsModule } from '../products/products.module';
import { CartModule } from '../cart/cart.module';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';
import { OrdersRepository } from './orders.repository';
import { OrderTokenService } from './order-token.service';
import { CheckoutThrottlerGuard } from './checkout-throttler.guard';
import { CheckoutEventsService } from '../observability/checkout-events.service';

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
  imports: [PrismaModule, ProductsModule, CartModule],
  controllers: [CheckoutController],
  providers: [
    CheckoutService,
    OrdersRepository,
    OrderTokenService,
    CheckoutThrottlerGuard,
    CheckoutEventsService,
  ],
  // Exportado para que otros módulos (panel admin de US-012, pagos de US-023)
  // inyecten el repositorio sin re-declararlo como provider propio (§5). No
  // cambia el contrato público del módulo: `CheckoutController` sigue siendo
  // el único endpoint expuesto.
  exports: [OrdersRepository],
})
export class CheckoutModule {}
