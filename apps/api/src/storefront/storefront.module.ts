import { Module } from '@nestjs/common';
import { ProductsModule } from '../products/products.module';
import { CategoriesModule } from '../categories/categories.module';
import { StorefrontProductsController } from './storefront.controller';
import { StorefrontCategoriesController } from './storefront-categories.controller';
import { StorefrontService } from './storefront.service';

/**
 * Módulo de la superficie de lectura pública (US-003 ficha + US-002 navegación).
 * Importa los módulos que exportan los repositorios (únicos puntos de acceso al
 * ORM) y registra los controllers públicos + su service. Se cablea en `AppModule`.
 */
@Module({
  imports: [ProductsModule, CategoriesModule],
  controllers: [StorefrontProductsController, StorefrontCategoriesController],
  providers: [StorefrontService],
})
export class StorefrontModule {}
