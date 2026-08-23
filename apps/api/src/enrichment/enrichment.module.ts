import { Module } from '@nestjs/common';
import { aiProviders } from './ai/ai.providers';
import { EnrichmentRepository } from './enrichment.repository';
import { EnrichmentRunner } from './enrichment.runner';
import { EnrichmentService } from './enrichment.service';
import { ENRICHMENT_QUEUE, NudgeEnrichmentQueue } from './ports/enrichment-queue.port';

/**
 * Módulo del enriquecimiento IA + embeddings (US-005).
 *
 * Los proveedores de IA se registran **por token** (`AI_ENRICHER` / `AI_EMBEDDER`): sin
 * `GEMINI_API_KEY` el factory resuelve al adapter deshabilitado, así que la app arranca sin
 * clave y el runner queda `disabled` en vez de fallar en cada llamada (D6). Los tests
 * sustituyen el fake por el mismo token, sin tocar el caso de uso.
 *
 * Exporta el runner y el puerto de cola porque el import (US-006) empuja el enriquecimiento
 * tras escribir el catálogo — depende del **token**, no de esta clase.
 */
@Module({
  providers: [
    EnrichmentRepository,
    EnrichmentService,
    EnrichmentRunner,
    ...aiProviders,
    { provide: ENRICHMENT_QUEUE, useClass: NudgeEnrichmentQueue },
  ],
  exports: [
    EnrichmentRepository,
    EnrichmentService,
    EnrichmentRunner,
    ENRICHMENT_QUEUE,
  ],
})
export class EnrichmentModule {}
