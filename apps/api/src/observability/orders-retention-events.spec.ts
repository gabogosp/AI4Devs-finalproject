import { MetricsService } from './metrics.service';
import {
  OrdersRetentionEventName,
  OrdersRetentionEventsService,
} from './orders-retention-events.service';

/**
 * T2.2 — los 2 eventos de retención/anonimización (design.md §Observabilidad).
 * Lo central acá no es que el contador suba, sino que el payload NUNCA
 * contenga PII, ni siquiera cuando alguien agrega `fields` a futuro.
 */
describe('OrdersRetentionEventsService (orders-retention-events)', () => {
  const LOS_DOS: OrdersRetentionEventName[] = [
    'orders_retention.swept',
    'orders_retention.anonymized_on_request',
  ];

  it('los 2 nombres se emiten y se cuentan por nombre', async () => {
    const metrics = new MetricsService();
    const events = new OrdersRetentionEventsService(metrics);

    for (const nombre of LOS_DOS) events.emit(nombre, 'order-1');

    for (const nombre of LOS_DOS) {
      expect(await events.count(nombre)).toBe(1);
    }
  });

  it('el valor sale por el REGISTRO de Prometheus (dsm_orders_retention_events_total)', async () => {
    const metrics = new MetricsService();
    const events = new OrdersRetentionEventsService(metrics);

    events.emit('orders_retention.swept', null, undefined, { anonymized_count: 3 });

    const expuesto = await metrics.render();

    expect(expuesto).toContain('dsm_orders_retention_events_total');
    expect(expuesto).toMatch(
      /dsm_orders_retention_events_total\{event="orders_retention\.swept"\} 1/,
    );
  });

  it('el log de "swept" lleva event, entity_id, trace_id, anonymized_count — sin ningún dato de contacto', async () => {
    const events = new OrdersRetentionEventsService(new MetricsService());
    const capturado: Array<Record<string, unknown>> = [];
    jest
      .spyOn(events['logger'], 'log')
      .mockImplementation((p: unknown) => void capturado.push(p as Record<string, unknown>));

    events.emit('orders_retention.swept', null, undefined, { anonymized_count: 7 });

    expect(Object.keys(capturado[0]).sort()).toEqual([
      'anonymized_count',
      'entity_id',
      'event',
      'trace_id',
    ]);
    expect(capturado[0]).toMatchObject({
      event: 'orders_retention.swept',
      entity_id: null,
      trace_id: null,
      anonymized_count: 7,
    });

    // Guardián explícito: falla si algún día se cuela una clave de contacto.
    const claves = Object.keys(capturado[0]);
    expect(claves).not.toContain('buyer_name');
    expect(claves).not.toContain('buyer_email');
    expect(claves).not.toContain('buyer_phone');
  });

  it('el log de "anonymized_on_request" lleva sólo event, entity_id, trace_id — sin ningún dato de contacto', async () => {
    const events = new OrdersRetentionEventsService(new MetricsService());
    const capturado: Array<Record<string, unknown>> = [];
    jest
      .spyOn(events['logger'], 'log')
      .mockImplementation((p: unknown) => void capturado.push(p as Record<string, unknown>));

    events.emit('orders_retention.anonymized_on_request', 'order-42', 'trace-abc');

    expect(Object.keys(capturado[0]).sort()).toEqual([
      'entity_id',
      'event',
      'trace_id',
    ]);
    const claves = Object.keys(capturado[0]);
    expect(claves).not.toContain('buyer_name');
    expect(claves).not.toContain('buyer_email');
    expect(claves).not.toContain('buyer_phone');
  });

  it('funciona sin MetricsService: la observabilidad no condiciona instanciar', async () => {
    const events = new OrdersRetentionEventsService();

    expect(() =>
      events.emit('orders_retention.swept', null, undefined, { anonymized_count: 0 }),
    ).not.toThrow();
    expect(await events.count('orders_retention.swept')).toBe(0);
  });
});
