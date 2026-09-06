import { Injectable, Logger, Optional } from '@nestjs/common';
import { MetricsService } from './metrics.service';

export type ReportsDataset = 'sales' | 'top-products' | 'summary';
export type ReportsEventName = 'reports.viewed' | 'reports.exported';

/**
 * Eventos de negocio del panel de métricas del dueño (US-016 §9, `design.md`
 * §D10) — mismo esqueleto que `OrderEventsService`: delega el contador en
 * `MetricsService` (`@Optional()`, el de `observability/`, sin colisión de
 * nombre porque esta clase no se llama `MetricsService`).
 *
 * **Desviación documentada respecto a la letra de `design.md` §D10/T4.1**: el
 * design describe el contador como `dsm_reports_events_total{event="...",
 * dataset="..."}` (dos labels). `MetricsService.counterFor` (sin tocar, per
 * `proposal.md`/`design.md` Non-goals: "no toca MetricsModule/MetricsService/
 * MetricsController de observability/") declara el contador con
 * `labelNames: ['event']` — **una sola etiqueta**, la misma convención que
 * `OrderEventsService` (`fromStatus`/`toStatus` sólo al log) y
 * `SearchEventsService` (`confidence`, un enum acotado, también sólo al log:
 * "La ÚNICA etiqueta es `event`. El resto de los campos viaja al log.").
 * Añadir `dataset` como segunda label exigiría modificar
 * `MetricsService.counterFor` — el archivo que el propio plan declara
 * fuera de alcance. Se resuelve siguiendo el precedente ya establecido en
 * TODOS los servicios de eventos existentes: `dataset` viaja al **log**,
 * nunca como dimensión de la métrica — consistente con
 * `observability-standards.md` §9 y sin abrir una excepción a la convención
 * del resto de la app.
 */
@Injectable()
export class ReportsEventsService {
  private readonly logger = new Logger(ReportsEventsService.name);

  constructor(
    /** `@Optional()`, mismo precedente que `OrderEventsService`. */
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  emit(name: ReportsEventName, dataset: ReportsDataset): void {
    this.metrics?.increment('reports', name);

    this.logger.log({
      event: name,
      dataset,
    });
  }

  /** Valor del contador, leído del registro real. */
  async count(name: ReportsEventName): Promise<number> {
    return (await this.metrics?.value('reports', name)) ?? 0;
  }
}
