import { Module } from '@nestjs/common';
import { ProductsModule } from '../products/products.module';
import { StorefrontProductsController } from './storefront.controller';
import { StorefrontService } from './storefront.service';

/**
 * Módulo de la superficie de lectura pública (US-003). Importa `ProductsModule`
 * (que exporta `ProductsRepository`, único punto de acceso al ORM de products) y
 * registra el controller público + su service. Se cablea en `AppModule`.
 */
@Module({
  imports: [ProductsModule],
  controllers: [StorefrontProductsController],
  providers: [StorefrontService],
})
export class StorefrontModule {}
