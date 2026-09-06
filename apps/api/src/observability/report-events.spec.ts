import { MetricsService } from './metrics.service';
import { ReportsDataset, ReportsEventName, ReportsEventsService } from './report-events.service';

/**
 * T4.1 — los 2 eventos del panel de métricas del dueño (design.md §D10).
 *
 * Nota de ejecución (drift documentado — ver el docstring de
 * `report-events.service.ts`): `MetricsService.counterFor` sólo admite la
 * etiqueta `event` (sin tocarlo, per Non-goals de `design.md`) — `dataset` se
 * verifica en el LOG, no como label de Prometheus, siguiendo el mismo
 * precedente que `OrderEventsService`/`SearchEventsService`.
 */
describe('ReportsEventsService (report-events)', () => {
  const LOS_DOS: ReportsEventName[] = ['reports.viewed', 'reports.exported'];

  it('los 2 nombres se emiten y se cuentan por nombre', async () => {
    const metrics = new MetricsService();
    const events = new ReportsEventsService(metrics);

    for (const nombre of LOS_DOS) events.emit(nombre, 'sales');

    for (const nombre of LOS_DOS) {
      expect(await events.count(nombre)).toBe(1);
    }
  });

  it('el valor sale por el REGISTRO de Prometheus como dsm_reports_events_total, legible desde GET /v1/admin/metrics', async () => {
    const metrics = new MetricsService();
    const events = new ReportsEventsService(metrics);

    events.emit('reports.viewed', 'sales');
    events.emit('reports.exported', 'top-products');

    const expuesto = await metrics.render();

    expect(expuesto).toContain('dsm_reports_events_total');
    expect(expuesto).toMatch(/dsm_reports_events_total\{event="reports\.viewed"\} 1/);
    expect(expuesto).toMatch(/dsm_reports_events_total\{event="reports\.exported"\} 1/);
  });

  it('dataset va al log, nunca como dimensión de la métrica', async () => {
    const metrics = new MetricsService();
    const events = new ReportsEventsService(metrics);

    events.emit('reports.viewed', 'summary');
    const expuesto = await metrics.render();

    expect(expuesto).not.toMatch(/dsm_reports_events_total\{[^}]*summary/);
  });

  it('la línea de log lleva EXACTAMENTE event y dataset, nunca PII ni un rango de fechas', async () => {
    const events = new ReportsEventsService(new MetricsService());
    const capturado: Array<Record<string, unknown>> = [];
    jest
      .spyOn(events['logger'], 'log')
      .mockImplementation((p: unknown) => void capturado.push(p as Record<string, unknown>));

    const dataset: ReportsDataset = 'top-products';
    events.emit('reports.exported', dataset);

    expect(Object.keys(capturado[0]).sort()).toEqual(['dataset', 'event']);
    expect(capturado[0]).toMatchObject({ event: 'reports.exported', dataset: 'top-products' });
  });

  it('funciona sin MetricsService: la observabilidad no condiciona instanciar', async () => {
    const events = new ReportsEventsService();

    expect(() => events.emit('reports.viewed', 'sales')).not.toThrow();
    expect(await events.count('reports.viewed')).toBe(0);
  });
});
