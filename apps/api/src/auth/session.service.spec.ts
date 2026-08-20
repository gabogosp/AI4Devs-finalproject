import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { CustomersRepository } from './customers.repository';
import { RefreshTokensRepository } from './refresh-tokens.repository';
import { SessionService, JWT_ISSUER, JWT_AUDIENCE } from './session.service';
import { InvalidRefreshError } from '../common/errors/auth-errors';
import { hashToken } from './tokens/opaque-token';

/**
 * T3.3 — el ciclo completo se prueba contra la base real, no con repos
 * mockeados. La detección de reuso es un invariante **de datos** (qué filas
 * quedan con `revoked_at`), y un mock que devuelva lo que yo le diga no
 * verificaría nada de eso.
 */
describe('SessionService (ADR-0011)', () => {
  const prisma = new PrismaService();
  const refreshTokens = new RefreshTokensRepository(prisma);
  const customers = new CustomersRepository(prisma);
  const config = new ConfigService({
    JWT_SECRET: 'secreto-de-test-suficientemente-largo',
    AUTH_ACCESS_TTL_MIN: 15,
    AUTH_REFRESH_TTL_DAYS: 30,
  }) as ConfigService;
  const jwt = new JwtService({});
  const service = new SessionService(jwt, config, refreshTokens);

  // `ConfigService` da prioridad a `process.env` sobre el objeto del
  // constructor, y el setup de jest define `JWT_SECRET`. El test debe verificar
  // con **el mismo** secreto con el que firmó el servicio, no con el literal de
  // arriba: si no, "invalid signature" oculta el resultado real de la prueba.
  const secret = config.getOrThrow<string>('JWT_SECRET');

  const HASH = '$2b$12$'.padEnd(60, 'x');
  let ana: { id: string; role: string };

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
    const creada = await customers.create({
      email: 'ana@example.com',
      name: 'Ana',
      passwordHash: HASH,
    });
    ana = { id: creada.id, role: creada.role };
  });

  describe('issue', () => {
    it('devuelve access + refresh, y sólo el HASH del refresh toca la base', async () => {
      const sesion = await service.issue(ana);

      expect(sesion.accessToken).toBeTruthy();
      expect(sesion.refreshToken).toBeTruthy();
      expect(sesion.familyId).toBeTruthy();

      const filas = await prisma.refreshToken.findMany();
      expect(filas).toHaveLength(1);
      expect(filas[0].token_hash).toBe(hashToken(sesion.refreshToken));
      // El claro no está en la base por ningún lado.
      expect(filas[0].token_hash).not.toBe(sesion.refreshToken);
    });

    it('el access lleva sub/role/typ/jti/iss/aud y expira en el TTL configurado', async () => {
      const { accessToken, jti } = await service.issue(ana);
      const claims = jwt.verify<Record<string, unknown>>(accessToken, {
        secret,
        algorithms: ['HS256'], // pin de algoritmo (§3.8)
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      });

      expect(claims.sub).toBe(ana.id);
      expect(claims.role).toBe('customer');
      expect(claims.typ).toBe('access');
      expect(claims.jti).toBe(jti);

      const vidaMin = ((claims.exp as number) - (claims.iat as number)) / 60;
      expect(vidaMin).toBe(15);
    });

    it('cada login abre una FAMILIA distinta — cerrar sesión en un dispositivo no cierra el otro', async () => {
      const a = await service.issue(ana);
      const b = await service.issue(ana);
      expect(a.familyId).not.toBe(b.familyId);
    });
  });

  describe('rotate', () => {
    it('el sucesor pertenece a la MISMA familia y el presentado queda rotado', async () => {
      const primera = await service.issue(ana);
      const segunda = await service.rotate(primera.refreshToken);

      expect(segunda.familyId).toBe(primera.familyId);
      expect(segunda.refreshToken).not.toBe(primera.refreshToken);

      const vieja = await refreshTokens.findByHash(
        hashToken(primera.refreshToken),
      );
      expect(vieja?.rotated_at).toBeInstanceOf(Date);
    });

    it('un refresh inexistente lanza InvalidRefreshError', async () => {
      await expect(service.rotate('no-existe')).rejects.toBeInstanceOf(
        InvalidRefreshError,
      );
    });

    it('un refresh vencido lanza el MISMO error que uno inexistente', async () => {
      const sesion = await service.issue(ana);
      await prisma.refreshToken.updateMany({
        where: { token_hash: hashToken(sesion.refreshToken) },
        data: { expires_at: new Date(Date.now() - 1_000) },
      });

      const vencido = await service
        .rotate(sesion.refreshToken)
        .catch((e: Error) => e);
      const inventado = await service.rotate('inventado').catch((e: Error) => e);

      expect(vencido).toBeInstanceOf(InvalidRefreshError);
      expect((vencido as Error).message).toBe((inventado as Error).message);
    });
  });

  describe('detección de reuso — el corazón de ADR-0011', () => {
    it('presentar un token YA rotado revoca la familia entera y lanza', async () => {
      const t1 = await service.issue(ana);
      const t2 = await service.rotate(t1.refreshToken);

      // Un atacante que robó t1 lo replaya después de que el legítimo ya rotó.
      await expect(service.rotate(t1.refreshToken)).rejects.toBeInstanceOf(
        InvalidRefreshError,
      );

      const familia = await prisma.refreshToken.findMany({
        where: { family_id: t1.familyId },
      });
      expect(familia).toHaveLength(2);
      expect(familia.every((f) => f.revoked_at !== null)).toBe(true);

      // Y el efecto que importa: el token VIGENTE de la víctima también murió.
      // Sin esto la detección sería decorativa — el ladrón seguiría dentro.
      await expect(service.rotate(t2.refreshToken)).rejects.toBeInstanceOf(
        InvalidRefreshError,
      );
    });

    it('el reuso NO toca las otras familias del mismo cliente', async () => {
      const movil = await service.issue(ana);
      const escritorio = await service.issue(ana);

      await service.rotate(movil.refreshToken);
      await expect(service.rotate(movil.refreshToken)).rejects.toThrow();

      // La sesión del otro dispositivo sigue viva: se contuvo el robo, no se
      // castigó a la persona.
      await expect(
        service.rotate(escritorio.refreshToken),
      ).resolves.toBeTruthy();
    });
  });

  describe('revokeFamilyOf (logout, AC-3)', () => {
    it('tras el logout el refresh deja de renovar', async () => {
      const sesion = await service.issue(ana);
      await service.revokeFamilyOf(sesion.refreshToken);

      await expect(service.rotate(sesion.refreshToken)).rejects.toBeInstanceOf(
        InvalidRefreshError,
      );
    });

    it('cerrar sesión con una cookie ya vencida no explota', async () => {
      // Un 401 acá dejaría al cliente sin saber si limpiar su estado local.
      await expect(
        service.revokeFamilyOf('cookie-vieja-que-ya-no-existe'),
      ).resolves.toBeUndefined();
    });
  });

  describe('revokeAllForCustomer (reset de contraseña, §3.7)', () => {
    it('se caen TODAS las familias del cliente', async () => {
      const a = await service.issue(ana);
      const b = await service.issue(ana);

      expect(await service.revokeAllForCustomer(ana.id)).toBe(2);

      await expect(service.rotate(a.refreshToken)).rejects.toThrow();
      await expect(service.rotate(b.refreshToken)).rejects.toThrow();
    });
  });

  describe('limpieza oportunista', () => {
    it('emitir barre los refresh vencidos de ESE cliente', async () => {
      await refreshTokens.issue({
        customerId: ana.id,
        tokenHash: 'viejo-vencido',
        familyId: randomUUID(),
        expiresAt: new Date(Date.now() - 1_000),
      });

      await service.issue(ana);

      expect(await refreshTokens.findByHash('viejo-vencido')).toBeNull();
    });
  });
});
