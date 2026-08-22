import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ProductsModule } from '../products/products.module';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';
import { CartsRepository } from './carts.repository';
import { CartTokenService } from './cart-token.service';
import { CartCsrfGuard } from './cart-csrf.guard';
import { CartThrottlerGuard } from './cart-throttler.guard';

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
  ],
})
export class CartModule {}
