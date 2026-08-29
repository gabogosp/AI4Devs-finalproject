import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

/**
 * `@Global` por el mismo motivo que `CatalogEventsModule`: los servicios de eventos
 * de cada dominio lo inyectan y no tiene sentido que cada módulo lo importe.
 *
 * Importa `AuthModule` porque el controller va detrás de `AdminGuard`, que depende de
 * `JwtService` — mismo patrón que `ProductsModule` y `CategoriesModule`. Sin esto el
 * contenedor no puede construir el guard y **toda** ruta admin del barrido de
 * `e2e-rbac` falla, no sólo la de métricas (así lo detectó ese spec).
 *
 * Es el punto único donde aterrizan los contadores de negocio. Los planes de
 * US-004, US-008, US-009 y US-010 declaran sus propios servicios de eventos: todos
 * deben delegar acá en vez de abrir un `Map` privado nuevo (era el patrón que
 * AUDIT-dsm-api-006 encontró repetido cuatro veces).
 */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [MetricsController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
