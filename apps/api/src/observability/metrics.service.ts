import { Injectable } from '@nestjs/common';
import { Counter, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * Registro ÚNICO de métricas de aplicación (AUDIT-dsm-api-006).
 *
 * El problema que resuelve no era que faltaran contadores: `AuthEventsService`,
 * `CatalogEventsService`, `CartEventsService` y el de enriquecimiento ya contaban
 * eventos. El problema era que cada uno guardaba su cuenta en un `Map` privado que
 * **nadie podía leer desde afuera** — sólo los tests. En producción, los «contadores
 * app» que el E2E §18 promete eran invisibles.
 *
 * Acá viven en un `Registry` de Prometheus, expuesto por `GET /v1/admin/metrics`.
 *
 * **Qué NO hace, para que nadie se confunda leyendo el E2E §18**: no hay ningún
 * scraper todavía. Railway no scrapea y el proyecto descartó operar Grafana propio
 * (nota de ADR-0001). Hasta que exista uno, el valor es que el operador puede leer el
 * endpoint a mano —los runbooks de §18.5 referencian justamente estas señales— y que
 * el día que haya scraper es configuración, no código.
 *
 * **Cardinalidad**: la única etiqueta permitida es `event`, con nombres de un conjunto
 * cerrado. Nunca un id de orden, de cliente ni el texto de una búsqueda: una etiqueta
 * por entidad hace explotar el número de series y tumba el backend de métricas mucho
 * antes que el tráfico real (`observability-standards.md` §9).
 */
@Injectable()
export class MetricsService {
  private readonly registry = new Registry();

  /** Un contador por familia (`dsm_auth_events_total`, `dsm_cart_events_total`, …). */
  private readonly counters = new Map<string, Counter<'event'>>();

  constructor() {
    // CPU, memoria, event-loop lag y GC del proceso. Es lo que permite ver si el
    // contenedor está ahogado sin depender de las métricas de Railway.
    collectDefaultMetrics({ register: this.registry, prefix: 'dsm_api_' });
  }

  /**
   * Incrementa `dsm_{family}_events_total{event="..."}`, creando la familia la
   * primera vez.
   *
   * El nombre de la familia lo pone el servicio de eventos que llama (`auth`,
   * `catalog`, `cart`, …), y `event` es el nombre del evento de negocio. Así los
   * cuatro servicios existentes —y los que vengan con US-004/008/009/010— comparten
   * un solo mecanismo en vez de sumar un `Map` más cada uno.
   */
  increment(family: string, event: string): void {
    this.counterFor(family).inc({ event });
  }

  /** Valor actual de un evento. Existe para los tests, igual que los `count()` previos. */
  async value(family: string, event: string): Promise<number> {
    const metric = await this.counterFor(family).get();
    const found = metric.values.find((v) => v.labels.event === event);
    return found?.value ?? 0;
  }

  /** Exposición en formato de texto de Prometheus. */
  async render(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }

  /** Sólo para tests: deja el registro en cero sin perder las familias declaradas. */
  reset(): void {
    this.registry.resetMetrics();
  }

  private counterFor(family: string): Counter<'event'> {
    const existing = this.counters.get(family);
    if (existing) return existing;

    const counter = new Counter({
      name: `dsm_${family}_events_total`,
      help: `Eventos de negocio de la superficie ${family}`,
      labelNames: ['event'] as const,
      registers: [this.registry],
    });
    this.counters.set(family, counter);
    return counter;
  }
}
