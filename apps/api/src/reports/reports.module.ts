import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ReportsRepository } from './reports.repository';
import { ReportsEventsService } from '../observability/report-events.service';

/**
 * Módulo nuevo y angosto (`design.md §D1`). Importa `AuthModule` (para
 * `AdminGuard`, mismo patrón que `MetricsModule`/`ProductsModule`) y
 * `PrismaModule` (para `$queryRaw`). **No** importa `CheckoutModule` ni
 * `OrdersModule`: todo pasa por `$queryRaw` en `ReportsRepository`, que
 * inyecta `PrismaService` directo — no hay escritura ni lectura por Prisma
 * Client tipado de `orders`/`order_items`.
 */
@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [ReportsController],
  providers: [ReportsService, ReportsRepository, ReportsEventsService],
})
export class ReportsModule {}
