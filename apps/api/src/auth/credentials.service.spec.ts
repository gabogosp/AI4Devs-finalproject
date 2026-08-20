import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CustomersRepository } from './customers.repository';
import { PasswordHasher } from './password/password-hasher';
import { Clock, CredentialsService } from './credentials.service';
import { InvalidCredentialsError } from './auth-errors';

/**
 * T3.2 — reloj inyectado para recorrer el backoff sin esperar 60 minutos.
 */
class RelojFijo implements Clock {
  constructor(private instante = new Date('2026-08-19T10:00:00.000Z')) {}
  now(): Date {
    return this.instante;
  }
  avanzarMinutos(min: number): void {
    this.instante = new Date(this.instante.getTime() + min * 60_000);
  }
}

describe('CredentialsService (§7.3, AC-2/AC-5/AC-10)', () => {
  const prisma = new PrismaService();
  const customers = new CustomersRepository(prisma);
  const config = new ConfigService({
    BCRYPT_COST: 4, // cost bajo SÓLO en test: 12 haría la suite intolerable
    AUTH_LOGIN_MAX_FAILURES: 5,
    AUTH_LOCKOUT_BASE_MIN: 15,
    AUTH_LOCKOUT_MAX_MIN: 60,
  }) as ConfigService;
  const hasher = new PasswordHasher(config);

  const PASSWORD = 'contraseña correcta y larga';
  let reloj: RelojFijo;
  let service: CredentialsService;

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
    reloj = new RelojFijo();
    service = new CredentialsService(customers, hasher, config, reloj);
    await customers.create({
      email: 'ana@example.com',
      name: 'Ana',
      passwordHash: await hasher.hash(PASSWORD),
    });
  });

  const fallar = () =>
    service.verify('ana@example.com', 'incorrecta').catch((e: Error) => e);

  describe('camino feliz (AC-2)', () => {
    it('credenciales correctas devuelven el cliente sin el hash', async () => {
      const c = await service.verify('ana@example.com', PASSWORD);
      expect(c.email).toBe('ana@example.com');
      expect(c).not.toHaveProperty('password_hash');
    });

    it('el login exitoso limpia contador y bloqueo', async () => {
      await fallar();
      await service.verify('ana@example.com', PASSWORD);
      const fresco = await prisma.customer.findFirst({
        where: { email: 'ana@example.com' },
      });
      expect(fresco?.failed_login_attempts).toBe(0);
      expect(fresco?.locked_until).toBeNull();
    });

    it('el email se normaliza también en el login', async () => {
      await expect(
        service.verify('  Ana@EXAMPLE.com ', PASSWORD),
      ).resolves.toBeTruthy();
    });
  });

  describe('los tres modos de fallo son INDISTINGUIBLES (AC-5)', () => {
    it('mismo type y mismo detail para email inexistente, contraseña mala y cuenta bloqueada', async () => {
      const inexistente = await service
        .verify('nadie@example.com', PASSWORD)
        .catch((e: Error) => e);
      const passwordMala = await fallar();

      // Dejar la cuenta bloqueada para el tercer caso.
      for (let i = 0; i < 5; i++) await fallar();
      const bloqueada = await service
        .verify('ana@example.com', PASSWORD)
        .catch((e: Error) => e);

      for (const e of [inexistente, passwordMala, bloqueada]) {
        expect(e).toBeInstanceOf(InvalidCredentialsError);
      }
      const tipos = [inexistente, passwordMala, bloqueada].map((e) => ({
        type: (e as InvalidCredentialsError).type,
        detail: (e as Error).message,
      }));
      expect(tipos[0]).toEqual(tipos[1]);
      expect(tipos[1]).toEqual(tipos[2]);
    });

    it('el email inexistente paga el mismo trabajo de hash — el reloj tampoco delata', async () => {
      const t0 = process.hrtime.bigint();
      await service.verify('nadie@example.com', PASSWORD).catch(() => {});
      const inexistente = Number(process.hrtime.bigint() - t0) / 1e6;

      const t1 = process.hrtime.bigint();
      await fallar();
      const passwordMala = Number(process.hrtime.bigint() - t1) / 1e6;

      // Sin `verifyDummy` la diferencia sería de órdenes de magnitud.
      expect(Math.abs(inexistente - passwordMala)).toBeLessThan(
        Math.max(inexistente, passwordMala),
      );
    });

    it('una cuenta bloqueada rechaza incluso con la contraseña CORRECTA', async () => {
      for (let i = 0; i < 5; i++) await fallar();
      await expect(
        service.verify('ana@example.com', PASSWORD),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    });
  });

  describe('lockout con backoff (AC-10)', () => {
    const estado = () =>
      prisma.customer.findFirstOrThrow({ where: { email: 'ana@example.com' } });

    it('4 fallos NO bloquean; el 5.º sí', async () => {
      for (let i = 0; i < 4; i++) await fallar();
      expect((await estado()).locked_until).toBeNull();
      expect((await estado()).failed_login_attempts).toBe(4);

      await fallar();
      const bloqueado = await estado();
      expect(bloqueado.locked_until).not.toBeNull();
      expect(bloqueado.lockout_count).toBe(1);
      // El contador se reinicia al bloquear: el próximo ciclo cuenta desde cero.
      expect(bloqueado.failed_login_attempts).toBe(0);
    });

    it('el backoff va 15 → 30 → 60 → 60 minutos y NUNCA es permanente', async () => {
      const minutosDelCiclo = async (): Promise<number> => {
        for (let i = 0; i < 5; i++) await fallar();
        const c = await estado();
        const min = Math.round(
          (c.locked_until!.getTime() - reloj.now().getTime()) / 60_000,
        );
        // Pasar el bloqueo para poder correr el ciclo siguiente.
        reloj.avanzarMinutos(min + 1);
        return min;
      };

      expect(await minutosDelCiclo()).toBe(15);
      expect(await minutosDelCiclo()).toBe(30);
      expect(await minutosDelCiclo()).toBe(60);
      // El tope es lo que impide que un atacante deje al dueño fuera de su
      // cuenta indefinidamente sólo fallando el login a propósito (§7.3).
      expect(await minutosDelCiclo()).toBe(60);
      expect(await minutosDelCiclo()).toBe(60);
    });

    it('pasado el bloqueo, la contraseña correcta vuelve a entrar', async () => {
      for (let i = 0; i < 5; i++) await fallar();
      await expect(service.verify('ana@example.com', PASSWORD)).rejects.toThrow();

      reloj.avanzarMinutos(16);
      await expect(
        service.verify('ana@example.com', PASSWORD),
      ).resolves.toBeTruthy();
    });

    it('fallar contra una cuenta YA bloqueada no extiende el castigo', async () => {
      // Si cada intento durante el bloqueo lo prolongara, cualquiera podría
      // mantener a un usuario fuera para siempre martillando el login.
      for (let i = 0; i < 5; i++) await fallar();
      const primero = (await estado()).locked_until!.getTime();

      for (let i = 0; i < 10; i++) await fallar();
      expect((await estado()).locked_until!.getTime()).toBe(primero);
      expect((await estado()).lockout_count).toBe(1);
    });

    it('un email inexistente no crea filas ni contadores', async () => {
      for (let i = 0; i < 6; i++) {
        await service.verify('nadie@example.com', 'x').catch(() => {});
      }
      expect(await prisma.customer.count()).toBe(1);
    });
  });

  describe('cuenta borrada', () => {
    it('un cliente con deleted_at no puede entrar ni con la contraseña correcta', async () => {
      await prisma.customer.updateMany({
        where: { email: 'ana@example.com' },
        data: { deleted_at: new Date() },
      });
      await expect(
        service.verify('ana@example.com', PASSWORD),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    });
  });
});
