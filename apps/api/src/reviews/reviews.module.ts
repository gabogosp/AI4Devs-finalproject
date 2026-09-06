import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ProductsModule } from '../products/products.module';
import { CheckoutModule } from '../checkout/checkout.module';
import { AuthModule } from '../auth/auth.module';
import { ReviewsRepository } from './reviews.repository';
import { ReviewsService } from './reviews.service';
import { CustomerReviewsController } from './customer-reviews.controller';
import { AdminReviewsController } from './admin-reviews.controller';
import { ReviewEventsService } from '../observability/review-events.service';

/**
 * Módulo de reseñas de producto (US-025, design.md §Context). Importa
 * `ProductsModule` (resolver `slug` → producto publicado, mismo criterio
 * 404 que la ficha), `CheckoutModule` (`OrdersRepository.
 * hasDeliveredOrderWithProduct` — único punto de acceso a `orders`/
 * `order_items`, §5) y `AuthModule` (`CustomerGuard`/`CsrfGuard`/
 * `AdminGuard`). Dirección acíclica: ninguno de los tres importa
 * `ReviewsModule` de vuelta. `StorefrontModule` importa este módulo para
 * exponer `GET /v1/products/:slug/reviews` desde
 * `StorefrontProductsController` ya existente (design.md §D3).
 */
@Module({
  imports: [PrismaModule, ProductsModule, CheckoutModule, AuthModule],
  controllers: [CustomerReviewsController, AdminReviewsController],
  providers: [ReviewsRepository, ReviewsService, ReviewEventsService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
