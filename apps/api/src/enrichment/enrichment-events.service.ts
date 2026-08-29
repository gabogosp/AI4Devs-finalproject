import { Injectable, Logger } from '@nestjs/common';

export type EnrichmentEventName =
  | 'enrichment.run_started'
  | 'enrichment.product_enriched'
  | 'enrichment.embedding_generated'
  | 'enrichment.skipped_unchanged'
  | 'enrichment.skipped_curated'
  | 'enrichment.retried'
  | 'enrichment.abandoned'
  | 'enrichment.provider_unavailable'
  | 'enrichment.run_finished';

/** Campos extra del evento, ya clasificados como no sensibles. */
export type EnrichmentEventFields = Record<
  string,
  string | number | boolean | null | undefined
>;

/**
 * Eventos de negocio del enriquecimiento IA (US-005 T5.1) — espejo de
 * `CatalogEventsService`: log pino estructurado + `Map` de contadores como stand-in de
 * métrica.
 *
 * Dos reglas que este archivo hace cumplir, y las dos existen por una razón que se paga:
 *
 * 1. **Cardinalidad acotada** (`observability-standards` §9): el contador se lleva por
 *    **nombre de evento**, nunca por producto. El `product_id` va al log, que es donde se
 *    investiga un caso puntual. Si el `product_id` fuera dimensión de métrica, un catálogo de
 *    5.000 productos crearía 5.000 series temporales y el backend de métricas costaría más
 *    que el enriquecimiento.
 * 2. **Longitudes, no contenidos**. `product_enriched` lleva `prompt_chars` y
 *    `response_chars`: alcanza para estimar el gasto sin instrumentar tokens (que la API no
 *    siempre devuelve), y evita que los logs se conviertan en una copia parcial del catálogo
 *    del cliente. La clave, la URL del proveedor y los textos completos **no entran acá**.
 */
@Injectable()
export class EnrichmentEventsService {
  private readonly logger = new Logger(EnrichmentEventsService.name);
  private readonly counters = new Map<EnrichmentEventName, number>();

  /**
   * Emite el evento y suma su contador.
   *
   * `productId` es `null` en los eventos de la **corrida** (`run_started`, `run_finished`,
   * `provider_unavailable`): son del trabajo, no de una fila, y poner un id falso ahí haría
   * que una consulta por producto devuelva ruido.
   */
  emit(
    name: EnrichmentEventName,
    productId: string | null,
    fields?: EnrichmentEventFields,
  ): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + 1);
    this.logger.log({
      event: name,
      product_id: productId,
      ...(fields ?? {}),
    });
  }

  /** Valor del contador (stand-in de una métrica Prometheus). */
  count(name: EnrichmentEventName): number {
    return this.counters.get(name) ?? 0;
  }

  /** Cuántas claves distintas tiene el mapa de contadores — la cardinalidad real. */
  get cardinalidad(): number {
    return this.counters.size;
  }

  /** Sólo para tests: olvida los contadores. */
  reset(): void {
    this.counters.clear();
  }
}
