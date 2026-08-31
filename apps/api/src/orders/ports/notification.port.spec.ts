import { LoggingNotificationAdapter } from './logging-notification.adapter';

describe('LoggingNotificationAdapter — NotificationPort (T5.1)', () => {
  it('orderReadyForPickup resuelve y loguea order_id/order_number, sin PII', async () => {
    const adapter = new LoggingNotificationAdapter();
    const capturado: unknown[] = [];
    jest
      .spyOn(adapter['logger'], 'log')
      .mockImplementation((linea: unknown) => void capturado.push(linea));

    const CENTINELA_NOMBRE = 'CENTINELA-NOMBRE-no-debe-aparecer';
    const CENTINELA_EMAIL = 'centinela-email@no-debe-aparecer.test';

    await expect(
      adapter.orderReadyForPickup({
        orderId: 'order-77',
        orderNumber: 1077,
        buyerName: CENTINELA_NOMBRE,
        buyerEmail: CENTINELA_EMAIL,
      }),
    ).resolves.toBeUndefined();

    expect(capturado).toHaveLength(1);
    const lineaDeLog = JSON.stringify(capturado[0]);
    expect(lineaDeLog).toContain('order-77');
    expect(lineaDeLog).toContain('1077');
    expect(lineaDeLog).not.toContain(CENTINELA_NOMBRE);
    expect(lineaDeLog).not.toContain(CENTINELA_EMAIL);
  });
});
