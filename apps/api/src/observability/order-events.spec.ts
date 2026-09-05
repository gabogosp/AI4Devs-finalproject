import { MetricsService } from './metrics.service';
import { OrderEventName, OrderEventsService } from './order-events.service';

/**
 * T5.2 — los 2 eventos del panel admin de órdenes (design.md §D8).
 */
describe('OrderEventsService (order-events)', () => {
  const LOS_DOS: OrderEventName[] = ['order.status_changed', 'order.transition_rejected'];

  it('los 2 nombres se emiten y se cuentan por nombre', async () => {
    const metrics = new MetricsService();
    const events = new OrderEventsService(metrics);

    for (const nombre of LOS_DOS) events.emit(nombre, 'order-1', 'new', 'preparing');

    for (const nombre of LOS_DOS) {
      expect(await events.count(nombre)).toBe(1);
    }
  });

  it('el valor sale por el REGISTRO de Prometheus como dsm_orders_events_total', async () => {
    const metrics = new MetricsService();
    const events = new OrderEventsService(metrics);

    events.emit('order.status_changed', 'order-1', 'new', 'preparing');
    events.emit('order.transition_rejected', 'order-2', 'new', 'delivered');

    const expuesto = await metrics.render();

    expect(expuesto).toContain('dsm_orders_events_total');
    expect(expuesto).toMatch(
      /dsm_orders_events_total\{event="order\.status_changed"\} 1/,
    );
    expect(expuesto).toMatch(
      /dsm_orders_events_total\{event="order\.transition_rejected"\} 1/,
    );
  });

  it('from_status/to_status van al log, nunca como dimensión de la métrica', async () => {
    const metrics = new MetricsService();
    const events = new OrderEventsService(metrics);

    events.emit('order.status_changed', 'order-1', 'preparing', 'ready');
    const expuesto = await metrics.render();

    // La línea de la métrica sólo lleva la label `event` — ni preparing ni
    // ready aparecen como parte de una serie/label de Prometheus.
    expect(expuesto).not.toMatch(/dsm_orders_events_total\{[^}]*preparing/);
    expect(expuesto).not.toMatch(/dsm_orders_events_total\{[^}]*ready/);
  });

  it('la línea de log lleva EXACTAMENTE event, entity_id, from_status, to_status', async () => {
    const events = new OrderEventsService(new MetricsService());
    const capturado: Array<Record<string, unknown>> = [];
    jest
      .spyOn(events['logger'], 'log')
      .mockImplementation((p: unknown) => void capturado.push(p as Record<string, unknown>));

    events.emit('order.status_changed', 'order-42', 'new', 'preparing');

    expect(Object.keys(capturado[0]).sort()).toEqual([
      'entity_id',
      'event',
      'from_status',
      'to_status',
    ]);
    expect(capturado[0]).toMatchObject({
      event: 'order.status_changed',
      entity_id: 'order-42',
      from_status: 'new',
      to_status: 'preparing',
    });
  });

  it('funciona sin MetricsService: la observabilidad no condiciona instanciar', async () => {
    const events = new OrderEventsService();

    expect(() => events.emit('order.status_changed', 'order-1', 'new', 'preparing')).not.toThrow();
    expect(await events.count('order.status_changed')).toBe(0);
  });
});
