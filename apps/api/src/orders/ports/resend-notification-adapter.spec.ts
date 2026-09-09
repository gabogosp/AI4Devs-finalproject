import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import type { Resend } from 'resend';
import { ResendNotificationAdapter } from './resend-notification.adapter';
import { LoggingNotificationAdapter } from './logging-notification.adapter';
import { notificationPortProvider } from './notification.provider';
import { NotificationEventsService } from '../../observability/notification-events.service';
import { OrderConfirmedPayload } from './notification.port';

type EnvioResultado = { error: unknown } | Record<string, never> | 'throw';

/** Doble del SDK: registra lo enviado (payload + options) y permite forzar secuencias de fallo. */
function resendFalso(respuestas: EnvioResultado[]) {
  let llamada = 0;
  const enviados: Array<Record<string, unknown>> = [];
  const opciones: Array<Record<string, unknown> | undefined> = [];
  const send = jest.fn(
    async (payload: Record<string, unknown>, options?: Record<string, unknown>) => {
      enviados.push(payload);
      opciones.push(options);
      const respuesta = respuestas[Math.min(llamada, respuestas.length - 1)];
      llamada += 1;
      if (respuesta === 'throw') {
        throw new Error('ECONNRESET');
      }
      return respuesta as never;
    },
  );
  return { cliente: { emails: { send } } as unknown as Resend, enviados, opciones, send };
}

const CONFIG = new ConfigService({
  ORDER_NOTIFICATIONS_FROM: 'pedidos@dsmferreteria.com.ar',
  OWNER_NOTIFICATION_EMAIL: 'dueno@dsmferreteria.com.ar',
  NOTIFICATION_RETRY_MAX_ATTEMPTS: 2,
  NOTIFICATION_RETRY_BASE_MS: 1,
  NOTIFICATION_RETRY_CAP_MS: 1,
  RESEND_TIMEOUT_MS: 200,
}) as ConfigService;

const CENTINELA_NOMBRE = 'CENTINELA-NOMBRE-no-debe-aparecer';
const CENTINELA_EMAIL = 'centinela-email@no-debe-aparecer.test';

const PAYLOAD: OrderConfirmedPayload = {
  orderId: 'order-1',
  orderNumber: 1001,
  buyerName: CENTINELA_NOMBRE,
  buyerEmail: CENTINELA_EMAIL,
  items: [{ productName: 'Tornillo', quantity: 1, unitPriceArsCents: 1_000 }],
  totalArsCents: 1_000,
};

describe('ResendNotificationAdapter (US-011 T6.1)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('(a) éxito al primer intento: 1 llamada con Idempotency-Key, emitSent con attempts=1', async () => {
    const { cliente, send, opciones } = resendFalso([{}]);
    const events = new NotificationEventsService();
    const emitSent = jest.spyOn(events, 'emitSent');
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});

    await new ResendNotificationAdapter(cliente, CONFIG, events).orderConfirmed(PAYLOAD);

    expect(send).toHaveBeenCalledTimes(1);
    expect(opciones[0]).toEqual({ idempotencyKey: 'order_confirmed:order-1' });
    expect(emitSent).toHaveBeenCalledWith('order_confirmed', 'order-1', 1);
  });

  it('(b) transitorio en el 1er intento, éxito en el 2do: 2 llamadas, emitSent con attempts=2', async () => {
    const { cliente, send } = resendFalso([{ error: { name: 'x', message: 'boom', statusCode: 500 } }, {}]);
    const events = new NotificationEventsService();
    const emitSent = jest.spyOn(events, 'emitSent');
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

    await new ResendNotificationAdapter(cliente, CONFIG, events).orderConfirmed(PAYLOAD);

    expect(send).toHaveBeenCalledTimes(2);
    expect(emitSent).toHaveBeenCalledWith('order_confirmed', 'order-1', 2);
  });

  it('(c) error permanente (400): 1 sola llamada, emitFailed inmediato sin esperar backoff', async () => {
    const { cliente, send } = resendFalso([
      { error: { name: 'validation_error', message: 'malo', statusCode: 400 } },
    ]);
    const events = new NotificationEventsService();
    const emitFailed = jest.spyOn(events, 'emitFailed');
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

    const inicio = Date.now();
    await new ResendNotificationAdapter(cliente, CONFIG, events).orderConfirmed(PAYLOAD);
    const duracionMs = Date.now() - inicio;

    expect(send).toHaveBeenCalledTimes(1);
    expect(emitFailed).toHaveBeenCalledWith('order_confirmed', 'order-1', 1);
    // Sin backoff de por medio: mucho menos que cualquier espera perceptible.
    expect(duracionMs).toBeLessThan(100);
  });

  it('(d) fallo transitorio en TODOS los intentos: 1+maxRetries llamadas, emitFailed, resuelve undefined', async () => {
    const { cliente, send } = resendFalso([
      { error: { name: 'x', message: 'boom', statusCode: 500 } },
    ]);
    const events = new NotificationEventsService();
    const emitFailed = jest.spyOn(events, 'emitFailed');
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

    await expect(
      new ResendNotificationAdapter(cliente, CONFIG, events).orderConfirmed(PAYLOAD),
    ).resolves.toBeUndefined();

    expect(send).toHaveBeenCalledTimes(3); // 1 inicial + 2 reintentos (NOTIFICATION_RETRY_MAX_ATTEMPTS)
    expect(emitFailed).toHaveBeenCalledWith('order_confirmed', 'order-1', 3);
  });

  it('(e) un send que LANZA (ECONNRESET) se trata como transitorio y reintenta', async () => {
    const { cliente, send } = resendFalso(['throw', {}]);
    const events = new NotificationEventsService();
    const emitSent = jest.spyOn(events, 'emitSent');
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

    await new ResendNotificationAdapter(cliente, CONFIG, events).orderConfirmed(PAYLOAD);

    expect(send).toHaveBeenCalledTimes(2);
    expect(emitSent).toHaveBeenCalledWith('order_confirmed', 'order-1', 2);
  });

  it('(f) ningún log del adapter contiene buyerName ni buyerEmail', async () => {
    const { cliente } = resendFalso([{ error: { name: 'x', message: 'boom', statusCode: 400 } }]);
    const events = new NotificationEventsService();
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

    await new ResendNotificationAdapter(cliente, CONFIG, events).orderConfirmed(PAYLOAD);

    const capturado = error.mock.calls.flat().join(' ');
    expect(capturado).not.toContain(CENTINELA_NOMBRE);
    expect(capturado).not.toContain(CENTINELA_EMAIL);
  });

  it('ownerNewOrder usa OWNER_NOTIFICATION_EMAIL como destinatario, no buyerEmail', async () => {
    const { cliente, enviados } = resendFalso([{}]);
    const events = new NotificationEventsService();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});

    await new ResendNotificationAdapter(cliente, CONFIG, events).ownerNewOrder({
      orderId: 'order-2',
      orderNumber: 1002,
      totalArsCents: 50_000,
    });

    expect(enviados[0].to).toBe('dueno@dsmferreteria.com.ar');
    expect(enviados[0].from).toBe('pedidos@dsmferreteria.com.ar');
  });

  it('orderCancelledByOwner (US-013 AC-4) envía al comprador con Idempotency-Key propia', async () => {
    const { cliente, send, opciones } = resendFalso([{}]);
    const events = new NotificationEventsService();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});

    await new ResendNotificationAdapter(cliente, CONFIG, events).orderCancelledByOwner({
      orderId: 'order-3',
      orderNumber: 1003,
      buyerName: CENTINELA_NOMBRE,
      buyerEmail: CENTINELA_EMAIL,
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(opciones[0]).toEqual({ idempotencyKey: 'order_cancelled_by_owner:order-3' });
  });

  it('orderReceived envía al comprador con Idempotency-Key propia (resumen de compra al crear la orden)', async () => {
    const { cliente, send, enviados, opciones } = resendFalso([{}]);
    const events = new NotificationEventsService();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});

    await new ResendNotificationAdapter(cliente, CONFIG, events).orderReceived(PAYLOAD);

    expect(send).toHaveBeenCalledTimes(1);
    expect(enviados[0].to).toBe(CENTINELA_EMAIL);
    expect(opciones[0]).toEqual({ idempotencyKey: 'order_received:order-1' });
  });

  it('ownerOrderReceived envía al dueño con Idempotency-Key propia (mismo momento que orderReceived)', async () => {
    const { cliente, send, enviados, opciones } = resendFalso([{}]);
    const events = new NotificationEventsService();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});

    await new ResendNotificationAdapter(cliente, CONFIG, events).ownerOrderReceived({
      orderId: 'order-2',
      orderNumber: 1002,
      totalArsCents: 50_000,
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(enviados[0].to).toBe('dueno@dsmferreteria.com.ar');
    expect(opciones[0]).toEqual({ idempotencyKey: 'owner_order_received:order-2' });
  });
});

describe('selección del adapter por entorno (US-011 T7.1)', () => {
  const factory = notificationPortProvider as {
    useFactory: (config: ConfigService, events: NotificationEventsService) => unknown;
  };
  afterEach(() => jest.restoreAllMocks());

  it('con RESEND_API_KEY resuelve al adapter de Resend', () => {
    const adapter = factory.useFactory(
      new ConfigService({
        RESEND_API_KEY: 're_test_key',
        ORDER_NOTIFICATIONS_FROM: 'pedidos@dsmferreteria.com.ar',
        OWNER_NOTIFICATION_EMAIL: 'dueno@dsmferreteria.com.ar',
      }) as ConfigService,
      new NotificationEventsService(),
    );
    expect(adapter).toBeInstanceOf(ResendNotificationAdapter);
  });

  it('sin la key resuelve al de log, y AVISA que no se envían los avisos', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

    const adapter = factory.useFactory(
      new ConfigService({ RESEND_API_KEY: undefined }) as ConfigService,
      new NotificationEventsService(),
    );

    expect(adapter).toBeInstanceOf(LoggingNotificationAdapter);
    expect(warn.mock.calls.flat().join(' ')).toMatch(/NO se envían/i);
  });
});
