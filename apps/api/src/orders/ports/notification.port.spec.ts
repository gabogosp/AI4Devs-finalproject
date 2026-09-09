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

  const CENTINELA_NOMBRE = 'CENTINELA-NOMBRE-no-debe-aparecer';
  const CENTINELA_EMAIL = 'centinela-email@no-debe-aparecer.test';

  it('orderConfirmed (US-010 T8.1) loguea order_id/order_number, sin PII', async () => {
    const adapter = new LoggingNotificationAdapter();
    const capturado: unknown[] = [];
    jest
      .spyOn(adapter['logger'], 'log')
      .mockImplementation((linea: unknown) => void capturado.push(linea));

    await adapter.orderConfirmed({
      orderId: 'order-1',
      orderNumber: 1001,
      buyerName: CENTINELA_NOMBRE,
      buyerEmail: CENTINELA_EMAIL,
      items: [{ productName: 'Tornillo', quantity: 2, unitPriceArsCents: 500 }],
      totalArsCents: 1_000,
    });

    const lineaDeLog = JSON.stringify(capturado[0]);
    expect(lineaDeLog).toContain('order-1');
    expect(lineaDeLog).toContain('1001');
    expect(lineaDeLog).not.toContain(CENTINELA_NOMBRE);
    expect(lineaDeLog).not.toContain(CENTINELA_EMAIL);
  });

  it('ownerNewOrder (US-010 T8.1) loguea order_id/order_number', async () => {
    const adapter = new LoggingNotificationAdapter();
    const capturado: unknown[] = [];
    jest
      .spyOn(adapter['logger'], 'log')
      .mockImplementation((linea: unknown) => void capturado.push(linea));

    await adapter.ownerNewOrder({ orderId: 'order-2', orderNumber: 1002, totalArsCents: 100_000 });

    const lineaDeLog = JSON.stringify(capturado[0]);
    expect(lineaDeLog).toContain('order-2');
    expect(lineaDeLog).toContain('1002');
  });

  it('orderCancelledNoStock (US-010 T8.1) loguea order_id/order_number, sin PII', async () => {
    const adapter = new LoggingNotificationAdapter();
    const capturado: unknown[] = [];
    jest
      .spyOn(adapter['logger'], 'log')
      .mockImplementation((linea: unknown) => void capturado.push(linea));

    await adapter.orderCancelledNoStock({
      orderId: 'order-3',
      orderNumber: 1003,
      buyerName: CENTINELA_NOMBRE,
      buyerEmail: CENTINELA_EMAIL,
    });

    const lineaDeLog = JSON.stringify(capturado[0]);
    expect(lineaDeLog).toContain('order-3');
    expect(lineaDeLog).toContain('1003');
    expect(lineaDeLog).not.toContain(CENTINELA_NOMBRE);
    expect(lineaDeLog).not.toContain(CENTINELA_EMAIL);
  });

  it('orderCancelledByOwner (US-013 T3.1) loguea order_id/order_number, sin PII', async () => {
    const adapter = new LoggingNotificationAdapter();
    const capturado: unknown[] = [];
    jest
      .spyOn(adapter['logger'], 'log')
      .mockImplementation((linea: unknown) => void capturado.push(linea));

    await adapter.orderCancelledByOwner({
      orderId: 'order-4',
      orderNumber: 1004,
      buyerName: CENTINELA_NOMBRE,
      buyerEmail: CENTINELA_EMAIL,
    });

    const lineaDeLog = JSON.stringify(capturado[0]);
    expect(lineaDeLog).toContain('order-4');
    expect(lineaDeLog).toContain('1004');
    expect(lineaDeLog).not.toContain(CENTINELA_NOMBRE);
    expect(lineaDeLog).not.toContain(CENTINELA_EMAIL);
  });

  it('orderReceived loguea order_id/order_number, sin PII', async () => {
    const adapter = new LoggingNotificationAdapter();
    const capturado: unknown[] = [];
    jest
      .spyOn(adapter['logger'], 'log')
      .mockImplementation((linea: unknown) => void capturado.push(linea));

    await adapter.orderReceived({
      orderId: 'order-5',
      orderNumber: 1005,
      buyerName: CENTINELA_NOMBRE,
      buyerEmail: CENTINELA_EMAIL,
      items: [{ productName: 'Tornillo', quantity: 1, unitPriceArsCents: 500 }],
      totalArsCents: 500,
    });

    const lineaDeLog = JSON.stringify(capturado[0]);
    expect(lineaDeLog).toContain('order-5');
    expect(lineaDeLog).toContain('1005');
    expect(lineaDeLog).not.toContain(CENTINELA_NOMBRE);
    expect(lineaDeLog).not.toContain(CENTINELA_EMAIL);
  });

  it('ownerOrderReceived loguea order_id/order_number', async () => {
    const adapter = new LoggingNotificationAdapter();
    const capturado: unknown[] = [];
    jest
      .spyOn(adapter['logger'], 'log')
      .mockImplementation((linea: unknown) => void capturado.push(linea));

    await adapter.ownerOrderReceived({ orderId: 'order-6', orderNumber: 1006, totalArsCents: 200_000 });

    const lineaDeLog = JSON.stringify(capturado[0]);
    expect(lineaDeLog).toContain('order-6');
    expect(lineaDeLog).toContain('1006');
  });
});
