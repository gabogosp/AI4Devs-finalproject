import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import type { Resend } from 'resend';
import { ResendWelcomeMailer } from './resend-welcome-mailer';
import { LoggingWelcomeMailer } from './logging-welcome-mailer';
import { welcomeMailerProvider } from './welcome-mailer.provider';
import { WelcomeEmail } from './welcome-mailer';

/** Doble del SDK: registra lo enviado y permite forzar el fallo. */
function resendFalso(resultado: { error: unknown } | Record<string, never> = {}) {
  const enviados: Array<Record<string, unknown>> = [];
  const send = jest.fn(async (payload: Record<string, unknown>) => {
    enviados.push(payload);
    return resultado as never;
  });
  return { cliente: { emails: { send } } as unknown as Resend, enviados, send };
}

const EMAIL: WelcomeEmail = {
  to: 'ana@example.com',
  name: 'Ana Pérez',
  customerId: 'cust-123',
};

const configResend = new ConfigService({
  ORDER_NOTIFICATIONS_FROM: 'pedidos@dsmferreteria.com.ar',
}) as ConfigService;

describe('ResendWelcomeMailer', () => {
  afterEach(() => jest.restoreAllMocks());

  it('envía una vez, al destinatario, con el nombre en el cuerpo', async () => {
    const { cliente, enviados, send } = resendFalso();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});

    await new ResendWelcomeMailer(cliente, configResend).send(EMAIL);

    expect(send).toHaveBeenCalledTimes(1);
    expect(enviados[0].to).toBe('ana@example.com');
    expect(enviados[0].from).toBe('pedidos@dsmferreteria.com.ar');
    expect(String(enviados[0].text)).toContain('Hola Ana Pérez,');
    expect(String(enviados[0].html)).toContain('Ana Pérez');
  });

  it('escapa un nombre con markup en el HTML', async () => {
    const { cliente } = resendFalso();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});

    await new ResendWelcomeMailer(cliente, configResend).send({
      ...EMAIL,
      name: '<script>x</script>',
    });

    const enviado = (cliente.emails.send as jest.Mock).mock.calls[0][0];
    expect(String(enviado.html)).not.toContain('<script>x</script>');
    expect(String(enviado.html)).toContain('&lt;script&gt;');
  });

  it('un error DEVUELTO por el SDK no pasa por envío exitoso', async () => {
    const { cliente } = resendFalso({
      error: { name: 'validation_error', message: 'dominio no verificado' },
    });
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

    await new ResendWelcomeMailer(cliente, configResend).send(EMAIL);

    expect(error).toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('un cliente que revienta NO propaga — el contrato del puerto se mantiene', async () => {
    const cliente = {
      emails: { send: jest.fn().mockRejectedValue(new Error('ECONNRESET')) },
    } as unknown as Resend;
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

    await expect(
      new ResendWelcomeMailer(cliente, configResend).send(EMAIL),
    ).resolves.toBeUndefined();
  });

  it('nunca loguea el nombre ni el email, ni al fallar', async () => {
    const cliente = {
      emails: { send: jest.fn().mockRejectedValue(new Error('boom')) },
    } as unknown as Resend;
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

    await new ResendWelcomeMailer(cliente, configResend).send(EMAIL);

    const capturado = error.mock.calls.flat().join(' ');
    expect(capturado).toContain('cust-123');
    expect(capturado).not.toContain('Ana Pérez');
    expect(capturado).not.toContain('ana@example.com');
  });
});

describe('selección del adapter por entorno', () => {
  const factory = welcomeMailerProvider as { useFactory: (c: ConfigService) => unknown };
  afterEach(() => jest.restoreAllMocks());

  it('con RESEND_API_KEY resuelve al adapter de Resend', () => {
    const mailer = factory.useFactory(
      new ConfigService({
        RESEND_API_KEY: 're_test_key',
        ORDER_NOTIFICATIONS_FROM: 'pedidos@dsmferreteria.com.ar',
      }) as ConfigService,
    );
    expect(mailer).toBeInstanceOf(ResendWelcomeMailer);
  });

  it('sin la key resuelve al de log, y AVISA que no se envía el email', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

    const mailer = factory.useFactory(
      new ConfigService({ RESEND_API_KEY: undefined }) as ConfigService,
    );

    expect(mailer).toBeInstanceOf(LoggingWelcomeMailer);
    expect(warn.mock.calls.flat().join(' ')).toMatch(/NO se envía/i);
  });
});
