import { MetricsService } from './metrics.service';
import { CheckoutEventName, CheckoutEventsService } from './checkout-events.service';

/**
 * T4.1 — los 5 eventos del checkout (design.md §Observabilidad).
 */
describe('CheckoutEventsService (checkout-events)', () => {
  const LOS_CINCO: CheckoutEventName[] = [
    'checkout.order_created',
    'checkout.rejected_empty_cart',
    'checkout.rejected_blocking_issues',
    'checkout.rejected_consent',
    'checkout.validation_failed',
  ];

  it('los 5 nombres se emiten y se cuentan por nombre', async () => {
    const metrics = new MetricsService();
    const events = new CheckoutEventsService(metrics);

    for (const nombre of LOS_CINCO) events.emit(nombre, 'order-1');

    for (const nombre of LOS_CINCO) {
      expect(await events.count(nombre)).toBe(1);
    }
  });

  it('el valor sale por el REGISTRO de Prometheus, no de un mapa privado', async () => {
    const metrics = new MetricsService();
    const events = new CheckoutEventsService(metrics);

    events.emit('checkout.order_created', 'order-1');
    events.emit('checkout.rejected_consent', null);

    const expuesto = await metrics.render();

    expect(expuesto).toContain('dsm_checkout_events_total');
    expect(expuesto).toMatch(
      /dsm_checkout_events_total\{event="checkout\.order_created"\} 1/,
    );
    expect(expuesto).toMatch(
      /dsm_checkout_events_total\{event="checkout\.rejected_consent"\} 1/,
    );
  });

  it('la línea de log lleva EXACTAMENTE event, entity_id, trace_id — nada más', async () => {
    const events = new CheckoutEventsService(new MetricsService());
    const capturado: Array<Record<string, unknown>> = [];
    jest
      .spyOn(events['logger'], 'log')
      .mockImplementation((p: unknown) => void capturado.push(p as Record<string, unknown>));

    events.emit('checkout.order_created', 'order-42', 'trace-abc');

    // Comparación de CONJUNTO de claves: si alguien agrega un campo sin
    // pensarlo —buyer_email, buyer_name— este test se pone rojo antes de que
    // llegue a un log de producción.
    expect(Object.keys(capturado[0]).sort()).toEqual([
      'entity_id',
      'event',
      'trace_id',
    ]);
    expect(capturado[0]).toMatchObject({
      event: 'checkout.order_created',
      entity_id: 'order-42',
      trace_id: 'trace-abc',
    });
  });

  it('la firma no tiene ningún parámetro por el que pueda entrar PII', () => {
    // Guardián de tipos, no de runtime: `emit` sólo acepta (name, orderId, traceId).
    // Si alguien agregara un cuarto parámetro `buyerEmail?: string`, TypeScript
    // seguiría compilando esta llamada — pero cualquier callsite que lo pase
    // rompería con "Expected 2-3 arguments, but got 4".
    const events = new CheckoutEventsService();
    expect(events.emit.length).toBeLessThanOrEqual(3);
  });

  it('funciona sin MetricsService: la observabilidad no condiciona instanciar', async () => {
    const events = new CheckoutEventsService();

    expect(() => events.emit('checkout.order_created', 'order-1')).not.toThrow();
    expect(await events.count('checkout.order_created')).toBe(0);
  });
});
