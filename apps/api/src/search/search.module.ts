import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SearchEventsService } from '../observability/search-events.service';
import { QUERY_VECTOR_CACHE, InMemoryQueryVectorCache } from './query-vector.cache';
import { QueryEmbedder } from './query-embedder';
import { searchEmbedderProvider } from './search-embedder.provider';
import { SearchController } from './search.controller';
import { SearchRepository } from './search.repository';
import { SearchService } from './search.service';
import { SearchThrottlerGuard } from './search-throttler.guard';

/**
 * Módulo de la búsqueda semántica (US-004) — el diferenciador del producto.
 *
 * `AuthModule` se importa por el `ThrottlerModule` global que registra ahí sus throttlers
 * nombrados (incluido `search`), no por autenticación: **este endpoint es público**.
 *
 * El caché de vectores entra por token (`QUERY_VECTOR_CACHE`) y no como clase concreta: cuando
 * US-019 provisione Redis, un adapter entra por el mismo token y ni el service ni el embedder
 * se tocan.
 */
@Module({
  imports: [AuthModule],
  controllers: [SearchController],
  providers: [
    SearchService,
    SearchRepository,
    SearchEventsService,
    QueryEmbedder,
    SearchThrottlerGuard,
    searchEmbedderProvider,
    { provide: QUERY_VECTOR_CACHE, useClass: InMemoryQueryVectorCache },
  ],
  exports: [SearchService, SearchRepository],
})
export class SearchModule {}
