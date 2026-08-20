import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CustomersRepository } from './customers.repository';
import { PasswordResetTokensRepository } from './password-reset-tokens.repository';
import { RefreshTokensRepository } from './refresh-tokens.repository';
import { PasswordHasher } from './password/password-hasher';
import { CredentialsService } from './credentials.service';
import { SessionService } from './session.service';
import { PasswordResetService } from './password-reset.service';
import { LoggingPasswordResetMailer } from './mail/logging-password-reset-mailer';
import {
  PasswordResetEmail,
  PasswordResetMailer,
} from './mail/password-reset-mailer';
import { InvalidResetTokenError, InvalidCredentialsError } from '../common/errors/auth-errors';
import { ValidationError } from '../common/errors/domain-errors';

/** Mailer de prueba que captura lo despachado. */
class MailerEspia implements PasswordResetMailer {
  readonly enviados: PasswordResetEmail[] = [];
  async send(input: PasswordResetEmail): Promise<void> {
    this.enviados.push(input);
  }
}

/** Mailer que siempre falla — el proveedor caído (T7.1). */
class MailerRoto implements PasswordResetMailer {
  async send(): Promise<void> {
    throw new Error('Resend devolvió 503');
  }
}

describe('PasswordResetService (AC-4, AC-7, AC-11)', () => {
  const prisma = new PrismaService();
  const customers = new CustomersRepository(prisma);
  const tokens = new PasswordResetTokensRepository(prisma);
  const refreshTokens = new RefreshTokensRepository(prisma);
  const config = new ConfigService({
    BCRYPT_COST: 4,
    PASSWORD_RESET_TTL_MIN: 60,
    PASSWORD_RESET_MAX_PER_HOUR: 3,
    AUTH_ACCESS_TTL_MIN: 15,
    AUTH_REFRESH_TTL_DAYS: 30,
  }) as ConfigService;
  const hasher = new PasswordHasher(config);
  const sessions = new SessionService(new JwtService({}), config, refreshTokens);
  const credentials = new CredentialsService(customers, hasher, config);

  const VIEJA = 'contraseña vieja del cliente';
  const NUEVA = 'contraseña nueva y distinta';

  let mailer: MailerEspia;
  let service: PasswordResetService;
  let anaId: string;

  const construir = (m: PasswordResetMailer) =>
    new PasswordResetService(customers, tokens, hasher, sessions, config, m);

  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE customers RESTART IDENTITY CASCADE',
    );
    mailer = new MailerEspia();
    service = construir(mailer);
    anaId = (
      await customers.create({
        email: 'ana@example.com',
        name: 'Ana',
        passwordHash: await hasher.hash(VIEJA),
      })
    ).id;
  });

  describe('request — anti-enumeración (AC-11)', () => {
    it('un email inexistente no lanza y devuelve lo mismo que uno existente', async () => {
      await expect(
        service.request('nadie@example.com'),
      ).resolves.toBeUndefined();
      await expect(service.request('ana@example.com')).resolves.toBeUndefined();
    });

    it('el email inexistente no crea fila ni despacha nada', async () => {
      await service.request('nadie@example.com');
      expect(await prisma.passwordResetToken.count()).toBe(0);
      expect(mailer.enviados).toHaveLength(0);
    });

    it('el email existente emite token y despacha', async () => {
      await service.request('ana@example.com');
      expect(await prisma.passwordResetToken.count()).toBe(1);
      expect(mailer.enviados).toHaveLength(1);
      expect(mailer.enviados[0].to).toBe('ana@example.com');
      expect(mailer.enviados[0].ttlMinutes).toBe(60);
    });

    it('sólo el HASH toca la base: el claro únicamente viaja al buzón', async () => {
      await service.request('ana@example.com');
      const fila = await prisma.passwordResetToken.findFirstOrThrow();
      const raw = mailer.enviados[0].rawToken;
      expect(fila.token_hash).not.toBe(raw);
      expect(fila.token_hash).toHaveLength(64);
    });

    it('un mailer que revienta NO altera la respuesta (el proveedor caído no enumera)', async () => {
      // Si un 503 de Resend cambiara el código o el tiempo de respuesta,
      // delataría qué direcciones existen.
      const conMailerRoto = construir(new MailerRoto());
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

      await expect(
        conMailerRoto.request('ana@example.com'),
      ).resolves.toBeUndefined();
      // El token igual quedó emitido: el usuario puede pedirlo de nuevo.
      expect(await prisma.passwordResetToken.count()).toBe(1);
      jest.restoreAllMocks();
    });

    it('el 4.º pedido en una hora no crea fila pero TAMPOCO lanza', async () => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
      for (let i = 0; i < 3; i++) await service.request('ana@example.com');
      expect(await prisma.passwordResetToken.count()).toBe(3);

      await expect(service.request('ana@example.com')).resolves.toBeUndefined();
      expect(await prisma.passwordResetToken.count()).toBe(3);
      expect(mailer.enviados).toHaveLength(3);
      jest.restoreAllMocks();
    });

    it('el email se normaliza también acá', async () => {
      await service.request('  ANA@Example.COM ');
      expect(mailer.enviados).toHaveLength(1);
    });
  });

  describe('confirm — camino feliz (AC-4)', () => {
    const pedirToken = async (): Promise<string> => {
      await service.request('ana@example.com');
      return mailer.enviados.at(-1)!.rawToken;
    };

    it('cambia la contraseña: la vieja falla y la nueva funciona', async () => {
      const token = await pedirToken();
      await service.confirm(token, NUEVA);

      await expect(
        credentials.verify('ana@example.com', VIEJA),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
      await expect(
        credentials.verify('ana@example.com', NUEVA),
      ).resolves.toBeTruthy();
    });

    it('revoca TODAS las sesiones previas de la cuenta (§3.7)', async () => {
      // Quien recupera su contraseña sospecha que perdió el control de la
      // cuenta. Dejar viva la sesión del atacante haría inútil el reset.
      const movil = await sessions.issue({ id: anaId, role: 'customer' });
      const escritorio = await sessions.issue({ id: anaId, role: 'customer' });

      await service.confirm(await pedirToken(), NUEVA);

      await expect(sessions.rotate(movil.refreshToken)).rejects.toThrow();
      await expect(sessions.rotate(escritorio.refreshToken)).rejects.toThrow();
    });

    it('borra los demás tokens pendientes de la cuenta', async () => {
      // Un enlace viejo que sobreviviera al cambio es el camino por el que un
      // atacante que pidió un reset antes recupera el acceso.
      const primero = await pedirToken();
      const segundo = await pedirToken();

      await service.confirm(segundo, NUEVA);

      expect(await prisma.passwordResetToken.count()).toBe(0);
      await expect(service.confirm(primero, 'otra distinta más')).rejects.toBeInstanceOf(
        InvalidResetTokenError,
      );
    });

    it('desbloquea la cuenta: el reset no puede ser un camino sin salida', async () => {
      await customers.lockUntil(anaId, new Date(Date.now() + 3_600_000), 1);
      await service.confirm(await pedirToken(), NUEVA);

      await expect(
        credentials.verify('ana@example.com', NUEVA),
      ).resolves.toBeTruthy();
    });

    it('sella password_changed_at', async () => {
      const antes = (
        await prisma.customer.findUniqueOrThrow({ where: { id: anaId } })
      ).password_changed_at;
      await new Promise((r) => setTimeout(r, 5));
      await service.confirm(await pedirToken(), NUEVA);

      const despues = (
        await prisma.customer.findUniqueOrThrow({ where: { id: anaId } })
      ).password_changed_at;
      expect(despues.getTime()).toBeGreaterThan(antes.getTime());
    });
  });

  describe('confirm — los tres modos de fallo dan el MISMO error (AC-7)', () => {
    it('token reusado, vencido e inventado son indistinguibles', async () => {
      await service.request('ana@example.com');
      const token = mailer.enviados[0].rawToken;
      await service.confirm(token, NUEVA);
      const reusado = await service
        .confirm(token, 'otra contraseña larga')
        .catch((e: Error) => e);

      await service.request('ana@example.com');
      const paraVencer = mailer.enviados.at(-1)!.rawToken;
      await prisma.passwordResetToken.updateMany({
        data: { expires_at: new Date(Date.now() - 1_000) },
      });
      const vencido = await service
        .confirm(paraVencer, 'otra contraseña larga')
        .catch((e: Error) => e);

      const inventado = await service
        .confirm('token-inventado', 'otra contraseña larga')
        .catch((e: Error) => e);

      for (const e of [reusado, vencido, inventado]) {
        expect(e).toBeInstanceOf(InvalidResetTokenError);
      }
      expect((reusado as Error).message).toBe((vencido as Error).message);
      expect((vencido as Error).message).toBe((inventado as Error).message);
      expect((reusado as InvalidResetTokenError).type).toBe(
        (inventado as InvalidResetTokenError).type,
      );
    });

    it('una contraseña nueva que viola la política da 422 y NO consume el token', async () => {
      await service.request('ana@example.com');
      const token = mailer.enviados[0].rawToken;

      await expect(service.confirm(token, 'password')).rejects.toBeInstanceOf(
        ValidationError,
      );
      // El token sigue vivo: un error de tipeo no debe obligar a pedir otro mail.
      await expect(service.confirm(token, NUEVA)).resolves.toBeUndefined();
    });
  });

  describe('LoggingPasswordResetMailer (T7.1)', () => {
    const email: PasswordResetEmail = {
      to: 'ana@example.com',
      customerId: 'cust-123',
      rawToken: 'TOKEN-EN-CLARO-abc123',
      ttlMinutes: 60,
    };
    const nodeEnvOriginal = process.env.NODE_ENV;
    afterEach(() => {
      process.env.NODE_ENV = nodeEnvOriginal;
      jest.restoreAllMocks();
    });

    it('nunca loguea el email del destinatario', async () => {
      const log = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => {});
      jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});

      await new LoggingPasswordResetMailer().send(email);

      const capturado = log.mock.calls.flat().join(' ');
      expect(capturado).toContain('cust-123');
      expect(capturado).not.toContain('ana@example.com');
    });

    it('fuera de producción SÍ escribe el token — es lo que permite ejercer AC-4 en local', async () => {
      process.env.NODE_ENV = 'test';
      jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
      const debug = jest
        .spyOn(Logger.prototype, 'debug')
        .mockImplementation(() => {});

      await new LoggingPasswordResetMailer().send(email);

      expect(debug.mock.calls.flat().join(' ')).toContain('TOKEN-EN-CLARO-abc123');
    });

    it('en producción NO escribe el token ni el email en ningún nivel', async () => {
      process.env.NODE_ENV = 'production';
      const log = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => {});
      const debug = jest
        .spyOn(Logger.prototype, 'debug')
        .mockImplementation(() => {});

      await new LoggingPasswordResetMailer().send(email);

      const todo = [...log.mock.calls, ...debug.mock.calls].flat().join(' ');
      expect(todo).not.toContain('TOKEN-EN-CLARO-abc123');
      expect(todo).not.toContain('ana@example.com');
    });

    it('no propaga: cumple el contrato del puerto', async () => {
      jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
      jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});
      await expect(
        new LoggingPasswordResetMailer().send(email),
      ).resolves.toBeUndefined();
    });
  });
});
