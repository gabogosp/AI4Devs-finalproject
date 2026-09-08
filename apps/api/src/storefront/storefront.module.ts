import { Module } from '@nestjs/common';
import { ProductsModule } from '../products/products.module';
import { CategoriesModule } from '../categories/categories.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { CheckoutModule } from '../checkout/checkout.module';
import { StorefrontProductsController } from './storefront.controller';
import { StorefrontCategoriesController } from './storefront-categories.controller';
import { StorefrontService } from './storefront.service';

/**
 * Módulo de la superficie de lectura pública (US-003 ficha + US-002 navegación
 * + US-025 reseñas públicas + US-026 destacados del home). Importa los
 * módulos que exportan los repositorios (únicos puntos de acceso al ORM) y
 * registra los controllers públicos + su service. Se cablea en `AppModule`.
 *
 * `CheckoutModule` (US-026): `ReviewsModule` YA lo importa, pero Nest no
 * re-exporta transitivamente lo que un módulo importado a su vez importa —
 * hace falta importarlo acá TAMBIÉN para que `StorefrontService` pueda
 * inyectar `OrdersRepository` (`mostSold`, único punto de acceso a
 * `orders`/`order_items`, §5). Diamante, no ciclo: `CheckoutModule` no
 * importa `StorefrontModule` de vuelta.
 */
@Module({
  imports: [ProductsModule, CategoriesModule, ReviewsModule, CheckoutModule],
  controllers: [StorefrontProductsController, StorefrontCategoriesController],
  providers: [StorefrontService],
})
export class StorefrontModule {}
