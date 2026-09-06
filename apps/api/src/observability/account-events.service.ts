import { Injectable, Logger, Optional } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { EventFields } from './catalog-events.service';

export type AccountEventName = 'account.deleted' | 'account.deletion_blocked';

/**
 * Eventos del borrado de cuenta (US-020, design.md §Approach —
 * "Observabilidad"). Mismo esqueleto que `OrdersHistoryEventsService`/
 * `AuthEventsService` — delega el contador en `MetricsService`, `@Optional()`
 * para specs que instancian a mano.
 *
 * **Cero PII en el payload.** La firma no acepta ningún parámetro por el que
 * pueda entrar `name`/`email`/`phone` — `per observability-standards.md §9`.
 * `customerId` (pseudónimo interno) va sólo al **log** (`entity_id`), nunca
 * como dimensión de `MetricsService.increment()`.
 */
@Injectable()
export class AccountEventsService {
  private readonly logger = new Logger(AccountEventsService.name);

  constructor(
    /** `@Optional()`, precedente de `OrdersHistoryEventsService`. */
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  emit(
    name: AccountEventName,
    customerId: string | null,
    traceId?: string,
    fields?: EventFields,
  ): void {
    this.metrics?.increment('account', name);

    this.logger.log({
      event: name,
      entity_id: customerId,
      trace_id: traceId ?? null,
      ...(fields ?? {}),
    });
  }

  /** Valor del contador, leído del registro real. */
  async count(name: AccountEventName): Promise<number> {
    return (await this.metrics?.value('account', name)) ?? 0;
  }
}
