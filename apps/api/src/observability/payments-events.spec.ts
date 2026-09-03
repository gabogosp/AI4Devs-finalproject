import { MetricsService } from './metrics.service';
import { PaymentsEventsService } from './payments-events.service';

/**
 * T6.1 — los dos eventos de la confirmación de pago manual (`design.md`
 * §Observability).
 */
describe('PaymentsEventsService (payments-events)', () => {
  it('emitConfirmed se cuenta por el REGISTRO de Prometheus', async () => {
    const metrics = new MetricsService();
    const events = new PaymentsEventsService(metrics);

    events.emitConfirmed('order-1');

    expect(await events.countConfirmed()).toBe(1);
    const expuesto = await metrics.render();
    expect(expuesto).toMatch(
      /dsm_payments_events_total\{event="payments\.manual_confirmed"\} 1/,
    );
  });

  it('emitRejected se cuenta POR MOTIVO por separado', async () => {
    const metrics = new MetricsService();
    const events = new PaymentsEventsService(metrics);

    events.emitRejected('order-1', 'not-pending-payment');
    events.emitRejected('order-2', 'insufficient-stock');
    events.emitRejected('order-3', 'insufficient-stock');

    expect(await events.countRejected('not-pending-payment')).toBe(1);
    expect(await events.countRejected('insufficient-stock')).toBe(2);
  });

  it('la línea de log de emitConfirmed lleva EXACTAMENTE event, entity_id — nada más', () => {
    const events = new PaymentsEventsService(new MetricsService());
    const capturado: Array<Record<string, unknown>> = [];
    jest
      .spyOn(events['logger'], 'log')
      .mockImplementation((p: unknown) => void capturado.push(p as Record<string, unknown>));

    events.emitConfirmed('order-42');

    expect(Object.keys(capturado[0]).sort()).toEqual(['entity_id', 'event']);
  });

  it('la línea de log de emitRejected lleva EXACTAMENTE event, entity_id, reason — nada más', () => {
    const events = new PaymentsEventsService(new MetricsService());
    const capturado: Array<Record<string, unknown>> = [];
    jest
      .spyOn(events['logger'], 'log')
      .mockImplementation((p: unknown) => void capturado.push(p as Record<string, unknown>));

    events.emitRejected('order-42', 'insufficient-stock');

    expect(Object.keys(capturado[0]).sort()).toEqual(['entity_id', 'event', 'reason']);
  });

  it('ninguna firma acepta un string libre por el que pueda entrar PII', () => {
    // Guardián de tipos: emitConfirmed(orderId) y emitRejected(orderId, reason
    // enum) — sin un tercer parámetro de texto libre.
    const events = new PaymentsEventsService();
    expect(events.emitConfirmed.length).toBe(1);
    expect(events.emitRejected.length).toBe(2);
  });

  it('funciona sin MetricsService: la observabilidad no condiciona instanciar', async () => {
    const events = new PaymentsEventsService();

    expect(() => events.emitConfirmed('order-1')).not.toThrow();
    expect(await events.countConfirmed()).toBe(0);
  });
});
