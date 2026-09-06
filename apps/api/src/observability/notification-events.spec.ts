import { MetricsService } from './metrics.service';
import { NotificationEventsService } from './notification-events.service';

describe('NotificationEventsService (US-011 T5.1)', () => {
  it('emitSent incrementa dsm_notifications_events_total{event="notification.sent.order_confirmed"}', async () => {
    const metrics = new MetricsService();
    const events = new NotificationEventsService(metrics);

    events.emitSent('order_confirmed', 'ord-1', 1);

    expect(await events.countSent('order_confirmed')).toBe(1);
    const expuesto = await metrics.render();
    expect(expuesto).toContain(
      'dsm_notifications_events_total{event="notification.sent.order_confirmed"} 1',
    );
  });

  it('emitFailed incrementa dsm_notifications_events_total{event="notification.failed.owner_new_order"}', async () => {
    const metrics = new MetricsService();
    const events = new NotificationEventsService(metrics);

    events.emitFailed('owner_new_order', 'ord-2', 3);

    expect(await events.countFailed('owner_new_order')).toBe(1);
  });

  it('el log emitido no contiene buyerName ni buyerEmail', () => {
    const events = new NotificationEventsService();
    const capturado: unknown[] = [];
    jest
      .spyOn(events['logger'], 'log')
      .mockImplementation((linea: unknown) => void capturado.push(linea));

    events.emitSent('order_confirmed', 'ord-1', 1);

    const lineaDeLog = JSON.stringify(capturado[0]);
    expect(lineaDeLog).not.toContain('buyerName');
    expect(lineaDeLog).not.toContain('buyerEmail');
  });

  it('sin MetricsService (@Optional ausente) no revienta', () => {
    const events = new NotificationEventsService();
    expect(() => events.emitSent('order_ready_for_pickup', 'ord-3', 1)).not.toThrow();
  });
});
