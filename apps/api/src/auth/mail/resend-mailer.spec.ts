import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import type { Resend } from 'resend';
import { ResendPasswordResetMailer } from './resend-password-reset-mailer';
import { LoggingPasswordResetMailer } from './logging-password-reset-mailer';
import { passwordResetMailerProvider } from './password-reset-mailer.provider';
import { PasswordResetEmail } from './password-reset-mailer';
import { validateEnv } from '../../config/env.validation';

/** Doble del SDK: registra lo enviado y permite forzar el fallo. */
function resendFalso(resultado: { error: unknown } | Record<string, never> = {}) {
  const enviados: Array<Record<string, unknown>> = [];
  const send = jest.fn(async (payload: Record<string, unknown>) => {
    enviados.push(payload);
    return resultado as never;
  });
  return { cliente: { emails: { send } } as unknown as Resend, enviados, send };
}

const EMAIL: PasswordResetEmail = {
  to: 'ana@example.com',
  customerId: 'cust-123',
  rawToken: 'TOKEN-abc_123',
  ttlMinutes: 60,
};

const configResend = new ConfigService({
  PASSWORD_RESET_FROM: 'no-responder@dsmferreteria.com.ar',
  PASSWORD_RESET_URL_BASE: 'https://dsmferreteria.com.ar',
}) as ConfigService;

describe('ResendPasswordResetMailer (T7.2)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('envía una vez, al destinatario, con el enlace de reset en el cuerpo', async () => {
    const { cliente, enviados, send } = resendFalso();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});

    await new ResendPasswordResetMailer(cliente, configResend).send(EMAIL);

    expect(send).toHaveBeenCalledTimes(1);
    expect(enviados[0].to).toBe('ana@example.com');
    expect(enviados[0].from).toBe('no-responder@dsmferreteria.com.ar');
    expect(String(enviados[0].text)).toContain(
      'https://dsmferreteria.com.ar/recuperar/confirmar?token=TOKEN-abc_123',
    );
    expect(String(enviados[0].html)).toContain('TOKEN-abc_123');
    // El TTL se le dice a la persona: un enlace que falla sin explicación
    // manda a la gente a pedir otro y otro.
    expect(String(enviados[0].text)).toContain('60 minutos');
  });

  it('un error DEVUELTO por el SDK no pasa por envío exitoso', async () => {
    // Resend no lanza: devuelve `{ error }`. Sin chequearlo, un rechazo del
    // proveedor quedaría registrado como despacho correcto y el fallo sería
    // invisible hasta que un cliente se queje.
    const { cliente } = resendFalso({
      error: { name: 'validation_error', message: 'dominio no verificado' },
    });
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});

    await new ResendPasswordResetMailer(cliente, configResend).send(EMAIL);

    expect(error).toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('un cliente que revienta NO propaga — el contrato del puerto se mantiene', async () => {
    const cliente = {
      emails: {
        send: jest.fn().mockRejectedValue(new Error('ECONNRESET')),
      },
    } as unknown as Resend;
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

    await expect(
      new ResendPasswordResetMailer(cliente, configResend).send(EMAIL),
    ).resolves.toBeUndefined();
  });

  it('nunca loguea el token ni el email, ni al fallar', async () => {
    const cliente = {
      emails: { send: jest.fn().mockRejectedValue(new Error('boom')) },
    } as unknown as Resend;
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});

    await new ResendPasswordResetMailer(cliente, configResend).send(EMAIL);

    const capturado = error.mock.calls.flat().join(' ');
    expect(capturado).toContain('cust-123');
    expect(capturado).not.toContain('TOKEN-abc_123');
    expect(capturado).not.toContain('ana@example.com');
  });
});

describe('selección del adapter por entorno (T7.2)', () => {
  const factory = passwordResetMailerProvider as {
    useFactory: (c: ConfigService) => unknown;
  };
  afterEach(() => jest.restoreAllMocks());

  it('con RESEND_API_KEY resuelve al adapter de Resend', () => {
    const mailer = factory.useFactory(
      new ConfigService({
        RESEND_API_KEY: 're_test_key',
        PASSWORD_RESET_FROM: 'no-responder@dsmferreteria.com.ar',
        PASSWORD_RESET_URL_BASE: 'https://dsmferreteria.com.ar',
      }) as ConfigService,
    );
    expect(mailer).toBeInstanceOf(ResendPasswordResetMailer);
  });

  it('sin la key resuelve al de log, y AVISA que no se envían emails', () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});

    const mailer = factory.useFactory(
      new ConfigService({ RESEND_API_KEY: undefined }) as ConfigService,
    );

    expect(mailer).toBeInstanceOf(LoggingPasswordResetMailer);
    expect(warn.mock.calls.flat().join(' ')).toMatch(/NO se envían/i);
  });
});

describe('fail-fast de producción (§7)', () => {
  const base = {
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    JWT_SECRET: 'secreto',
  };

  it('en producción, faltar RESEND_API_KEY hace FALLAR el arranque', () => {
    // El punto de la salvaguarda: sin ella, un deploy mal configurado caería al
    // adapter de log y el reset "funcionaría" sin enviar un solo email. Nadie se
    // entera hasta que un cliente no puede recuperar su cuenta.
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        PASSWORD_RESET_FROM: 'no-responder@dsmferreteria.com.ar',
        PASSWORD_RESET_URL_BASE: 'https://dsmferreteria.com.ar',
      }),
    ).toThrow(/RESEND_API_KEY/);
  });

  it('en producción también exige el remitente y la base del enlace', () => {
    expect(() =>
      validateEnv({ ...base, NODE_ENV: 'production', RESEND_API_KEY: 're_x' }),
    ).toThrow(/PASSWORD_RESET_FROM/);
  });

  it('en producción con las tres presentes, arranca', () => {
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        RESEND_API_KEY: 're_x',
        PASSWORD_RESET_FROM: 'no-responder@dsmferreteria.com.ar',
        PASSWORD_RESET_URL_BASE: 'https://dsmferreteria.com.ar',
        // US-005 sumó su propia exigencia de producción por el mismo criterio que las tres
        // de arriba (una feature que "funciona" sin hacer nada es peor que un arranque
        // roto): sin `GEMINI_API_KEY` el enriquecimiento queda `disabled` y la búsqueda
        // semántica no tendría vectores. Un entorno de producción válido las incluye todas.
        GEMINI_API_KEY: 'g_x',
      }),
    ).not.toThrow();
  });

  it('fuera de producción NO las exige — local y CI corren sin credenciales', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'development' })).not.toThrow();
    expect(() => validateEnv({ ...base, NODE_ENV: 'test' })).not.toThrow();
  });

  it('un remitente que no es email válido falla aunque no sea producción', () => {
    expect(() =>
      validateEnv({ ...base, PASSWORD_RESET_FROM: 'no-es-un-email' }),
    ).toThrow(/PASSWORD_RESET_FROM/);
  });
});
