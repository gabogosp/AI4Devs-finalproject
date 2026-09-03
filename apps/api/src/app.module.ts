import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { AppLoggingModule } from './common/logging/logging.module';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { MetricsModule } from './observability/metrics.module';
import { CatalogEventsModule } from './observability/catalog-events.module';
import { CategoriesModule } from './categories/categories.module';
import { ProductsModule } from './products/products.module';
import { StorefrontModule } from './storefront/storefront.module';
import { AuthModule } from './auth/auth.module';
import { CartModule } from './cart/cart.module';
import { ImportsModule } from './imports/imports.module';
import { EnrichmentModule } from './enrichment/enrichment.module';
import { SearchModule } from './search/search.module';
import { CheckoutModule } from './checkout/checkout.module';
import { OrdersModule } from './orders/orders.module';
import { StockModule } from './stock/stock.module';
import { PaymentsModule } from './payments/payments.module';

/**
 * Módulo raíz de `@dsm/api`. Cross-cutting (config validado, logging pino,
 * Prisma, health) + los módulos de dominio (Categories, Products) que llegan en
 * las Fases 4-7. `AuthModule` expone además la ruta del seam de login (Fase 9).
 * `CartModule` (US-007) es la primera superficie pública de **escritura**.
 * `ImportsModule` (US-006) trae la carga masiva del catálogo, con su ejecutor
 * in-process (ADR-0012) y el barrido de trabajos huérfanos al arrancar.
 * `EnrichmentModule` (US-005) enriquece y vectoriza el catálogo con su propio ejecutor
 * in-process (ADR-0014); sin `GEMINI_API_KEY` queda `disabled` y la app arranca igual.
 * `SearchModule` (US-004) expone `GET /v1/search`, el diferenciador del producto: superficie
 * PÚBLICA que consume los vectores de US-005 y degrada a full-text cuando el proveedor no
 * responde, sin romper la navegación.
 * `CheckoutModule` (US-008) expone `POST /v1/checkout`: convierte el carrito en una orden
 * `pending_payment`, con el `order_token` que US-009 consume para iniciar el pago.
 * `OrdersModule` (US-012) expone `GET/PATCH /v1/admin/orders`: el panel del dueño gestiona
 * las 4 transiciones activas de fulfillment (`new→preparing→ready→delivered`).
 * `StockModule` (US-023) es el único escritor de `products.stock`. `PaymentsModule`
 * (US-023) implementa `PaymentConfirmationPort` con su primer adaptador (`manual`):
 * el dueño confirma el pago sin depender de MercadoPago (US-009, `Blocked`).
 */
@Module({
  imports: [
    AppConfigModule,
    AppLoggingModule,
    PrismaModule,
    HealthModule,
    MetricsModule,
    CatalogEventsModule,
    AuthModule,
    CategoriesModule,
    ProductsModule,
    StorefrontModule,
    CartModule,
    ImportsModule,
    EnrichmentModule,
    SearchModule,
    CheckoutModule,
    OrdersModule,
    StockModule,
    PaymentsModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
