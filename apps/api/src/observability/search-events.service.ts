import { Injectable, Logger, Optional } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { Confidence } from '../search/relevance';

export type SearchEventName =
  | 'search.performed'
  | 'search.no_results'
  | 'search.low_confidence'
  | 'search.degraded'
  | 'search.cache_hit'
  | 'search.rate_limited';

/** Lo que acompaña a un evento de búsqueda. Ninguno de estos campos es una etiqueta. */
export interface SearchEventFields {
  /** El texto que escribió el cliente. Va al LOG, nunca a la métrica. */
  query?: string;
  resultCount?: number;
  confidence?: Confidence;
  degraded?: boolean;
}

/**
 * Eventos de negocio de la búsqueda (US-004 D10, E2E §18).
 *
 * **Delega el contador en `MetricsService`** en vez de abrir otro `Map` privado. Esa decisión
 * es la corrección de AUDIT-dsm-api-006: los cuatro servicios de eventos previos contaban en un
 * mapa que **nadie podía leer desde afuera** —sólo los tests—, así que los «contadores app» que
 * el E2E promete eran invisibles en producción. Acá el valor sale por
 * `GET /v1/admin/metrics` como `dsm_search_events_total{event="..."}`.
 *
 * **El texto de la consulta va al log y NUNCA como etiqueta de métrica.** Las dos mitades de esa
 * frase importan:
 *
 * - **Al log sí**, y es una decisión explícita del PO (OQ-BE-5): las consultas son la única
 *   fuente del KPI de relevancia y de la **demanda no cubierta** —qué busca la gente que el
 *   catálogo no tiene—, que es información que el negocio hoy no tiene de ninguna forma. En una
 *   ferretería una consulta no es PII.
 * - **Como etiqueta jamás**: cada consulta distinta sería una serie temporal nueva. Un buscador
 *   genera consultas ilimitadas por definición, así que eso no es «alta cardinalidad», es
 *   cardinalidad **infinita**, y tumba el backend de métricas mucho antes que el tráfico real.
 */
@Injectable()
export class SearchEventsService {
  private readonly logger = new Logger(SearchEventsService.name);

  constructor(
    /**
     * `@Optional()` sigue el precedente de `CatalogEventsService`: permite construir el
     * servicio a mano en un unit test sin arrastrar el contenedor. `MetricsModule` es
     * `@Global`, así que en la app siempre está.
     */
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  emit(name: SearchEventName, fields: SearchEventFields = {}, traceId?: string): void {
    // La ÚNICA etiqueta es `event`. El resto de los campos viaja al log.
    this.metrics?.increment('search', name);

    this.logger.log({
      event: name,
      query: fields.query ?? null,
      result_count: fields.resultCount ?? null,
      confidence: fields.confidence ?? null,
      degraded: fields.degraded ?? null,
      trace_id: traceId ?? null,
    });
  }

  /** Valor del contador, leído del registro real (no de un mapa paralelo). */
  async count(name: SearchEventName): Promise<number> {
    return (await this.metrics?.value('search', name)) ?? 0;
  }
}
