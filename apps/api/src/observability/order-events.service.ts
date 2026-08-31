import { Injectable, Logger, Optional } from '@nestjs/common';
import { MetricsService } from './metrics.service';

export type OrderEventName = 'order.status_changed' | 'order.transition_rejected';

/**
 * Eventos de negocio del panel admin de órdenes (US-012, design.md §D8).
 * Mismo esqueleto que `CheckoutEventsService` (§Observabilidad).
 *
 * **Delega el contador en `MetricsService`** — el valor sale por
 * `GET /v1/admin/metrics` como `dsm_orders_events_total{event="..."}`, no de
 * un `Map` privado.
 *
 * `fromStatus`/`toStatus` van al **log**, nunca como dimensión de la métrica
 * (cardinalidad: 4 estados × 4 estados no es un problema, pero el criterio es
 * el mismo que `CheckoutEventsService` — sólo `orderId` identifica la
 * entidad, el resto de contexto queda fuera de las labels de Prometheus).
 */
@Injectable()
export class OrderEventsService {
  private readonly logger = new Logger(OrderEventsService.name);

  constructor(
    /** `@Optional()`, mismo precedente que `CheckoutEventsService`. */
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  emit(
    name: OrderEventName,
    orderId: string | null,
    fromStatus?: string,
    toStatus?: string,
  ): void {
    this.metrics?.increment('orders', name);

    this.logger.log({
      event: name,
      entity_id: orderId,
      from_status: fromStatus ?? null,
      to_status: toStatus ?? null,
    });
  }

  /** Valor del contador, leído del registro real. */
  async count(name: OrderEventName): Promise<number> {
    return (await this.metrics?.value('orders', name)) ?? 0;
  }
}
