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

describe('PaymentsEventsService — eventos nuevos (US-010 T12.1)', () => {
  it('emitProviderConfirmed cuenta por provider, distinguible de emitConfirmed', async () => {
    const metrics = new MetricsService();
    const events = new PaymentsEventsService(metrics);

    events.emitProviderConfirmed('order-1', 'mercadopago');
    events.emitProviderConfirmed('order-2', 'simulated_dsm');
    events.emitConfirmed('order-3');

    expect(await metrics.value('payments', 'payments.provider_confirmed.mercadopago')).toBe(1);
    expect(await metrics.value('payments', 'payments.provider_confirmed.simulated_dsm')).toBe(1);
    expect(await events.countConfirmed()).toBe(1); // sin mezclarse con los de provider
  });

  it('emitAutoCancelled incrementa su propio contador', async () => {
    const metrics = new MetricsService();
    const events = new PaymentsEventsService(metrics);

    events.emitAutoCancelled('order-1');

    expect(await metrics.value('payments', 'payments.auto_cancelled')).toBe(1);
  });

  it('emitRefundFailed incrementa su propio contador y loguea order_id/payment_id', async () => {
    const metrics = new MetricsService();
    const events = new PaymentsEventsService(metrics);
    const capturado: Array<Record<string, unknown>> = [];
    jest
      .spyOn(events['logger'], 'log')
      .mockImplementation((p: unknown) => void capturado.push(p as Record<string, unknown>));

    events.emitRefundFailed('order-1', 'payment-1');

    expect(await metrics.value('payments', 'payments.refund_failed')).toBe(1);
    expect(capturado[0]).toEqual({
      event: 'payments.refund_failed',
      entity_id: 'order-1',
      payment_id: 'payment-1',
    });
  });

  it('emitWebhookReceived incrementa su propio contador', async () => {
    const metrics = new MetricsService();
    const events = new PaymentsEventsService(metrics);

    events.emitWebhookReceived('payment-1');

    expect(await metrics.value('payments', 'payments.webhook_received')).toBe(1);
  });

  it('emitSignatureRejected incrementa su propio contador, sin ningún id (el body no es de confiar)', async () => {
    const metrics = new MetricsService();
    const events = new PaymentsEventsService(metrics);

    events.emitSignatureRejected();

    expect(await metrics.value('payments', 'payments.webhook_signature_rejected')).toBe(1);
    expect(events.emitSignatureRejected.length).toBe(0);
  });

  it('emitReconcileRecovered incrementa su propio contador', async () => {
    const metrics = new MetricsService();
    const events = new PaymentsEventsService(metrics);

    events.emitReconcileRecovered('order-1');

    expect(await metrics.value('payments', 'payments.reconcile_recovered')).toBe(1);
  });

  it('emitCleanupCancelled incrementa su propio contador y loguea el count', async () => {
    const metrics = new MetricsService();
    const events = new PaymentsEventsService(metrics);
    const capturado: Array<Record<string, unknown>> = [];
    jest
      .spyOn(events['logger'], 'log')
      .mockImplementation((p: unknown) => void capturado.push(p as Record<string, unknown>));

    events.emitCleanupCancelled(3);

    expect(await metrics.value('payments', 'payments.cleanup_cancelled')).toBe(1);
    expect(capturado[0]).toEqual({ event: 'payments.cleanup_cancelled', count: 3 });
  });

  it('ningún evento nuevo acepta buyerName/buyerEmail/amountArsCents (sólo IDs y counts)', () => {
    const events = new PaymentsEventsService();
    expect(events.emitProviderConfirmed.length).toBe(2);
    expect(events.emitAutoCancelled.length).toBe(1);
    expect(events.emitRefundFailed.length).toBe(2);
    expect(events.emitWebhookReceived.length).toBe(1);
    expect(events.emitReconcileRecovered.length).toBe(1);
    expect(events.emitCleanupCancelled.length).toBe(1);
  });
});
