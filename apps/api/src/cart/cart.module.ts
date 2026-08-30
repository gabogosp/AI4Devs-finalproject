import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ProductsModule } from '../products/products.module';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';
import { CartsRepository } from './carts.repository';
import { CartTokenService } from './cart-token.service';
import { CartCsrfGuard } from './cart-csrf.guard';
import { CartThrottlerGuard } from './cart-throttler.guard';
import { CartEventsService } from '../observability/cart-events.service';

/**
 * Módulo del carrito del invitado (US-007), `CartModule` del E2E §6.1.
 *
 * Importa `ProductsModule` porque `ProductsRepository` sigue siendo el **único**
 * punto de acceso al ORM de `products` (§5): el carrito lee precios y stock por
 * ahí, no con un `prisma.product` propio.
 */
@Module({
  imports: [PrismaModule, ProductsModule],
  controllers: [CartController],
  providers: [
    CartService,
    CartsRepository,
    CartTokenService,
    CartCsrfGuard,
    CartThrottlerGuard,
    CartEventsService,
  ],
  // CartTokenService + CartsRepository exportados para US-008 (T1.3): el
  // checkout resuelve el carrito de la cookie sin duplicar la primitiva del
  // token ni abrir un segundo acceso al ORM de `carts` (§5, AGENTS.md §1.1).
  // CartCsrfGuard se suma en T3.2: CheckoutController lo reusa tal cual
  // (design.md §Approach.3 — la escritura del checkout se autoriza con la
  // misma cookie `dsm_cart`, así que es el mismo guard, no uno nuevo).
  exports: [
    CartEventsService,
    CartTokenService,
    CartsRepository,
    CartCsrfGuard,
  ],
})
export class CartModule {}
