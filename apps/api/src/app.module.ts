import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { AppLoggingModule } from './common/logging/logging.module';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { CatalogEventsModule } from './observability/catalog-events.module';
import { CategoriesModule } from './categories/categories.module';
import { ProductsModule } from './products/products.module';
import { StorefrontModule } from './storefront/storefront.module';
import { AuthModule } from './auth/auth.module';
import { CartModule } from './cart/cart.module';

/**
 * Módulo raíz de `@dsm/api`. Cross-cutting (config validado, logging pino,
 * Prisma, health) + los módulos de dominio (Categories, Products) que llegan en
 * las Fases 4-7. `AuthModule` expone además la ruta del seam de login (Fase 9).
 * `CartModule` (US-007) es la primera superficie pública de **escritura**.
 */
@Module({
  imports: [
    AppConfigModule,
    AppLoggingModule,
    PrismaModule,
    HealthModule,
    CatalogEventsModule,
    AuthModule,
    CategoriesModule,
    ProductsModule,
    StorefrontModule,
    CartModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
