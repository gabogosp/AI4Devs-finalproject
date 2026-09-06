import { Injectable, Logger, Optional } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { EventFields } from './catalog-events.service';

export type OrdersHistoryEventName =
  | 'orders_history.list_viewed'
  | 'orders_history.detail_viewed'
  | 'orders_history.detail_not_found';

/**
 * Eventos del historial de compras del cliente (US §9, design.md §D6). Mismo
 * esqueleto que `CheckoutEventsService`/`OrdersRetentionEventsService` —
 * delega el contador en `MetricsService`, `@Optional()` para specs que
 * instancian a mano.
 *
 * **Cero PII en el payload.** La firma no acepta ningún parámetro por el que
 * pueda entrar email/nombre/teléfono. `customerId` (pseudónimo interno, no
 * PII per `observability-standards.md` §9) va sólo al **log** (`entity_id`),
 * nunca como dimensión de `MetricsService.increment()` — evita la
 * cardinalidad de una serie por cliente.
 */
@Injectable()
export class OrdersHistoryEventsService {
  private readonly logger = new Logger(OrdersHistoryEventsService.name);

  constructor(
    /** `@Optional()`, precedente de `CheckoutEventsService`/`CatalogEventsService`. */
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  emit(
    name: OrdersHistoryEventName,
    customerId: string | null,
    traceId?: string,
    fields?: EventFields,
  ): void {
    this.metrics?.increment('orders_history', name);

    this.logger.log({
      event: name,
      entity_id: customerId,
      trace_id: traceId ?? null,
      ...(fields ?? {}),
    });
  }

  /** Valor del contador, leído del registro real. */
  async count(name: OrdersHistoryEventName): Promise<number> {
    return (await this.metrics?.value('orders_history', name)) ?? 0;
  }
}
