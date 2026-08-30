import { Injectable, Logger, Optional } from '@nestjs/common';
import { MetricsService } from './metrics.service';

export type CheckoutEventName =
  | 'checkout.order_created'
  | 'checkout.rejected_empty_cart'
  | 'checkout.rejected_blocking_issues'
  | 'checkout.rejected_consent'
  | 'checkout.validation_failed';

/**
 * Eventos de negocio del checkout (US §9, E2E §18, design.md §Observabilidad).
 *
 * **Delega el contador en `MetricsService`** (AUDIT-dsm-api-006), igual que
 * `SearchEventsService`: el valor sale por `GET /v1/admin/metrics` como
 * `dsm_checkout_events_total{event="..."}`, no de un `Map` privado que sólo
 * los tests pueden leer.
 *
 * **La firma acepta `orderId | null` y nada más.** No hay parámetro por el
 * que pueda entrar un email, un nombre o un teléfono, **ni hasheados** — un
 * hash de email sigue siendo el dato con un paso extra (misma nota que
 * `AuthEventsService`). `orderId` va sólo al **log**, jamás como etiqueta:
 * una dimensión por orden haría explotar la cardinalidad de la métrica.
 */
@Injectable()
export class CheckoutEventsService {
  private readonly logger = new Logger(CheckoutEventsService.name);

  constructor(
    /** `@Optional()`, precedente de `CatalogEventsService`/`SearchEventsService`. */
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  emit(name: CheckoutEventName, orderId: string | null, traceId?: string): void {
    this.metrics?.increment('checkout', name);

    this.logger.log({
      event: name,
      entity_id: orderId,
      trace_id: traceId ?? null,
    });
  }

  /** Valor del contador, leído del registro real. */
  async count(name: CheckoutEventName): Promise<number> {
    return (await this.metrics?.value('checkout', name)) ?? 0;
  }
}
