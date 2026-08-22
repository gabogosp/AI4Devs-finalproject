import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CategoriesModule } from '../categories/categories.module';
import { ProductsModule } from '../products/products.module';
import { ENRICHMENT_QUEUE, LoggingEnrichmentQueue } from './enrichment-queue';
import { ImportJobsRepository } from './import-jobs.repository';
import { ImportRunner } from './import-runner';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';

/**
 * Módulo del import masivo (US-006).
 *
 * Reusa los repositorios de `products` y `categories` en vez de instanciar los
 * suyos: el import escribe en el **mismo** catálogo y tiene que pasar por el
 * mismo único punto de ORM (§5), con sus traducciones de error incluidas.
 *
 * El puerto de enriquecimiento se registra por token: hoy resuelve al adapter que
 * sólo registra el conteo. `Deferred: adapter BullMQ — US-005 / US-019`.
 */
@Module({
  imports: [AuthModule, ProductsModule, CategoriesModule],
  controllers: [ImportsController],
  providers: [
    ImportsService,
    ImportJobsRepository,
    ImportRunner,
    { provide: ENRICHMENT_QUEUE, useClass: LoggingEnrichmentQueue },
  ],
  exports: [ImportsService, ImportJobsRepository],
})
export class ImportsModule {}
