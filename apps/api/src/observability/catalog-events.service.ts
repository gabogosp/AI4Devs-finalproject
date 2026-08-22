import { Injectable, Logger } from '@nestjs/common';

export type CatalogEventName =
  | 'product.created'
  | 'product.published'
  | 'product.archived'
  | 'product.viewed'
  | 'category.created'
  | 'category.viewed'
  // US-006 — import masivo. Son eventos del TRABAJO, no de la fila: ver la nota
  // de cardinalidad en `emit`.
  | 'import.started'
  | 'import.completed'
  | 'import.failed';

/** Campos extra del evento, ya clasificados como no sensibles. */
export type EventFields = Record<string, string | number | boolean | null>;

/**
 * Eventos de negocio del catálogo (E2E §18, KPI PRD §1.4). Se emiten como log
 * pino estructurado + contador de métrica. `admin_user_id` es pseudónimo (un
 * solo admin en US-001); sin PII de comprador (no aplica en catálogo).
 */
@Injectable()
export class CatalogEventsService {
  private readonly logger = new Logger(CatalogEventsService.name);
  private readonly counters = new Map<CatalogEventName, number>();

  emit(
    name: CatalogEventName,
    entityId: string,
    // `null` para eventos de superficie pública anónima (US-003 `product.viewed`):
    // no hay actor admin, así que NO se registra un `'admin'` falso ni PII.
    adminUserId: string | null = 'admin',
    traceId?: string,
    /**
     * Campos extra que van al **log** (US-006 T6.1).
     *
     * Al log y no a la métrica: `observability-patterns` §3.3 — el id va al log,
     * NUNCA como dimensión de métrica. El contador se lleva sólo por nombre de
     * evento, así que 500 imports no crean 500 series temporales.
     *
     * Lo que se pasa acá son contadores y códigos, nunca contenido del archivo:
     * un nombre de producto o un sku en el log convertiría los logs en una copia
     * parcial del catálogo del cliente.
     */
    fields?: EventFields,
  ): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + 1);
    this.logger.log({
      event: name,
      entity_id: entityId,
      admin_user_id: adminUserId,
      trace_id: traceId,
      ...(fields ?? {}),
    });
  }

  /** Valor del contador (stand-in de una métrica Prometheus). */
  count(name: CatalogEventName): number {
    return this.counters.get(name) ?? 0;
  }
}
