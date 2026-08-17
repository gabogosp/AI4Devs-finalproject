import { Injectable, Logger } from '@nestjs/common';

export type CatalogEventName =
  | 'product.created'
  | 'product.published'
  | 'product.archived'
  | 'product.viewed'
  | 'category.created'
  | 'category.viewed';

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
  ): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + 1);
    this.logger.log({
      event: name,
      entity_id: entityId,
      admin_user_id: adminUserId,
      trace_id: traceId,
    });
  }

  /** Valor del contador (stand-in de una métrica Prometheus). */
  count(name: CatalogEventName): number {
    return this.counters.get(name) ?? 0;
  }
}
