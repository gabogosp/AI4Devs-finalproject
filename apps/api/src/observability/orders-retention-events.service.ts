import { Injectable, Logger, Optional } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { EventFields } from './catalog-events.service';

export type OrdersRetentionEventName =
  | 'orders_retention.swept'
  | 'orders_retention.anonymized_on_request';

/**
 * Eventos de retención/anonimización de órdenes (US §9, design.md
 * §Observabilidad). Mismo esqueleto que `CheckoutEventsService` — delega el
 * contador en `MetricsService`, `@Optional()` para specs que instancian a
 * mano.
 *
 * **Cero PII en el payload.** La firma NO acepta ningún parámetro por el que
 * pueda entrar un nombre, email o teléfono, ni siquiera hasheado — un hash de
 * email sigue siendo el dato con un paso extra. `orderId` va sólo al log,
 * nunca como etiqueta de métrica (cardinalidad).
 */
@Injectable()
export class OrdersRetentionEventsService {
  private readonly logger = new Logger(OrdersRetentionEventsService.name);

  constructor(
    /** `@Optional()`, precedente de `CheckoutEventsService`/`CatalogEventsService`. */
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  emit(
    name: OrdersRetentionEventName,
    orderId: string | null,
    traceId?: string,
    fields?: EventFields,
  ): void {
    this.metrics?.increment('orders_retention', name);

    this.logger.log({
      event: name,
      entity_id: orderId,
      trace_id: traceId ?? null,
      ...(fields ?? {}),
    });
  }

  /** Valor del contador, leído del registro real. */
  async count(name: OrdersRetentionEventName): Promise<number> {
    return (await this.metrics?.value('orders_retention', name)) ?? 0;
  }
}
