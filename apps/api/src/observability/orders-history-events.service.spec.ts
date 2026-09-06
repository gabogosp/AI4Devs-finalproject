import { MetricsService } from './metrics.service';
import {
  OrdersHistoryEventName,
  OrdersHistoryEventsService,
} from './orders-history-events.service';

/**
 * T3.3 — los 3 eventos del historial de compras (design.md §D6). Igual que
 * `orders-retention-events.spec.ts`: lo central es que el payload NUNCA
 * contenga PII y que `customerId` nunca sea dimensión de métrica.
 */
describe('OrdersHistoryEventsService (orders-history-events)', () => {
  const LOS_TRES: OrdersHistoryEventName[] = [
    'orders_history.list_viewed',
    'orders_history.detail_viewed',
    'orders_history.detail_not_found',
  ];

  it('los 3 nombres se emiten y se cuentan por nombre', async () => {
    const metrics = new MetricsService();
    const events = new OrdersHistoryEventsService(metrics);

    for (const nombre of LOS_TRES) events.emit(nombre, 'cust-1');

    for (const nombre of LOS_TRES) {
      expect(await events.count(nombre)).toBe(1);
    }
  });

  it('el valor sale por el REGISTRO de Prometheus (dsm_orders_history_events_total)', async () => {
    const metrics = new MetricsService();
    const events = new OrdersHistoryEventsService(metrics);

    events.emit('orders_history.list_viewed', 'cust-1');

    const expuesto = await metrics.render();

    expect(expuesto).toContain('dsm_orders_history_events_total');
    expect(expuesto).toMatch(
      /dsm_orders_history_events_total\{event="orders_history\.list_viewed"\} 1/,
    );
  });

  it('el log lleva event, entity_id, trace_id — sin ningún dato de contacto, y customerId sólo va al log', async () => {
    const events = new OrdersHistoryEventsService(new MetricsService());
    const capturado: Array<Record<string, unknown>> = [];
    jest
      .spyOn(events['logger'], 'log')
      .mockImplementation((p: unknown) => void capturado.push(p as Record<string, unknown>));

    events.emit('orders_history.detail_viewed', 'cust-42', 'trace-abc');

    expect(Object.keys(capturado[0]).sort()).toEqual(['entity_id', 'event', 'trace_id']);
    expect(capturado[0]).toMatchObject({
      event: 'orders_history.detail_viewed',
      entity_id: 'cust-42',
      trace_id: 'trace-abc',
    });

    // Guardián explícito: falla si algún día se cuela un campo de PII directa.
    const claves = Object.keys(capturado[0]);
    expect(claves).not.toContain('email');
    expect(claves).not.toContain('buyer_name');
    expect(claves).not.toContain('buyer_email');
    expect(claves).not.toContain('buyer_phone');
  });

  it('funciona sin MetricsService: la observabilidad no condiciona instanciar', async () => {
    const events = new OrdersHistoryEventsService();

    expect(() => events.emit('orders_history.list_viewed', 'cust-1')).not.toThrow();
    expect(await events.count('orders_history.list_viewed')).toBe(0);
  });
});
