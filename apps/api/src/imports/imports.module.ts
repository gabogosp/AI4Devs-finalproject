import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CategoriesModule } from '../categories/categories.module';
import { EnrichmentModule } from '../enrichment/enrichment.module';
import { ProductsModule } from '../products/products.module';
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
 * El puerto `ENRICHMENT_QUEUE` lo provee `EnrichmentModule`, que lo resuelve al adapter que
 * empuja el ejecutor in-process (ADR-0014). El import depende del **token**: cuando el
 * encolado pase a BullMQ (US-019), este módulo no se toca.
 */
@Module({
  imports: [AuthModule, ProductsModule, CategoriesModule, EnrichmentModule],
  controllers: [ImportsController],
  providers: [ImportsService, ImportJobsRepository, ImportRunner],
  exports: [ImportsService, ImportJobsRepository],
})
export class ImportsModule {}
