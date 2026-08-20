import { INestApplication, Logger } from '@nestjs/common';
import request from 'supertest';
import { bootTestApp, nuevaIpDeTest } from '../../test/e2e-app';
import { AuthModule } from './auth.module';
import { PrismaService } from '../prisma/prisma.service';
import { CSRF_COOKIE } from './cookies';

/**
 * T10.3 — la recuperación completa por HTTP (AC-4, AC-7, AC-11).
 *
 * El token se lee del log del adapter, que es el mismo camino por el que lo
 * obtendría alguien probando en local. Ese log existe **sólo** fuera de
 * producción (T7.1) y es lo que hace ejercitable AC-4 sin un buzón real.
 */
describe('Recuperación de contraseña (e2e-auth-password-reset)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const VIEJA = 'contraseña vieja de la clienta';
  const NUEVA = 'contraseña nueva y bien distinta';
  const EMAIL = 'ana@example.com';
  const ORIGEN = (process.env.CORS_ALLOWED_ORIGINS ?? '').split(',')[0];

  let capturado: string[] = [];
  let ip = '';

  beforeAll(async () => {
    process.env.TRUST_PROXY_HOPS = '1';
    app = await bootTestApp([AuthModule]);
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app?.close();
    delete process.env.TRUST_PROXY_HOPS;
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE customers RESTART IDENTITY CASCADE',
    );
    ip = nuevaIpDeTest();
    capturado = [];
    const capturar = (...args: unknown[]) =>
      capturado.push(args.map((a) => String(a)).join(' '));
    for (const nivel of ['log', 'debug', 'warn'] as const) {
      jest.spyOn(Logger.prototype, nivel).mockImplementation(capturar);
    }
  });
  afterEach(() => jest.restoreAllMocks());

  const http = () => {
    const agente = request(app.getHttpServer());
    return {
      get: (r: string) => agente.get(r).set('X-Forwarded-For', ip),
      post: (r: string) => agente.post(r).set('X-Forwarded-For', ip),
    };
  };

  const registrar = () =>
    http()
      .post('/v1/auth/register')
      .send({ email: EMAIL, name: 'Ana', password: VIEJA });

  const pedirReset = (email = EMAIL) =>
    http().post('/v1/auth/password-reset/request').send({ email });

  const confirmar = (token: string, password: string) =>
    http().post('/v1/auth/password-reset/confirm').send({ token, password });

  const login = (password: string) =>
    http().post('/v1/auth/login').send({ email: EMAIL, password });

  /** Último token en claro que el adapter de log escribió. */
  const ultimoToken = (): string => {
    const linea = capturado.filter((l) => l.includes('password_reset.token')).at(-1);
    return linea!.match(/token=([A-Za-z0-9_-]+)/)![1];
  };

  describe('camino completo (AC-4)', () => {
    it('request → confirm: la vieja deja de servir y la nueva funciona', async () => {
      await registrar().expect(201);
      await pedirReset().expect(202);

      await confirmar(ultimoToken(), NUEVA).expect(200);

      await login(VIEJA).expect(401);
      await login(NUEVA).expect(200);
    });

    it('el confirm NO devuelve sesión: quien cambió su contraseña entra por login', async () => {
      await registrar();
      await pedirReset();
      const res = await confirmar(ultimoToken(), NUEVA).expect(200);
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('las sesiones previas quedan revocadas (§3.7)', async () => {
      // Quien recupera su contraseña sospecha que perdió el control de la
      // cuenta: dejar viva la sesión del atacante haría inútil todo el flujo.
      const alta = await registrar().expect(201);
      const cookies = alta.headers['set-cookie'] as unknown as string[];
      const csrf = cookies
        .find((c) => c.startsWith(`${CSRF_COOKIE}=`))!
        .split(';')[0]
        .split('=')[1];

      await pedirReset();
      await confirmar(ultimoToken(), NUEVA).expect(200);

      await http()
        .post('/v1/auth/refresh')
        .set('Cookie', cookies)
        .set('X-CSRF-Token', csrf)
        .set('Origin', ORIGEN)
        .expect(401);

      const filas = await prisma.refreshToken.findMany();
      expect(filas.every((f) => f.revoked_at !== null)).toBe(true);
    });

    it('la cuenta bloqueada se desbloquea al completar el reset', async () => {
      await registrar();
      for (let i = 0; i < 5; i++) await login('incorrecta');
      await login(VIEJA).expect(401); // bloqueada

      await pedirReset();
      await confirmar(ultimoToken(), NUEVA).expect(200);

      await login(NUEVA).expect(200);
    });
  });

  describe('token inválido — los tres motivos dan lo mismo (AC-7)', () => {
    it('reusar el token da 400 dsm:auth/invalid-reset-token', async () => {
      await registrar();
      await pedirReset();
      const token = ultimoToken();
      await confirmar(token, NUEVA).expect(200);

      const res = await confirmar(token, 'otra contraseña larga').expect(400);
      expect(res.body.type).toBe('dsm:auth/invalid-reset-token');
    });

    it('un token vencido da EL MISMO 400 que uno inventado', async () => {
      await registrar();
      await pedirReset();
      const token = ultimoToken();
      await prisma.passwordResetToken.updateMany({
        data: { expires_at: new Date(Date.now() - 1_000) },
      });

      const vencido = await confirmar(token, NUEVA).expect(400);
      const inventado = await confirmar('token-inventado', NUEVA).expect(400);

      const comparable = (b: Record<string, unknown>) => {
        const copia = { ...b };
        delete copia.instance;
        return copia;
      };
      expect(comparable(vencido.body)).toEqual(comparable(inventado.body));
    });

    it('una contraseña nueva inválida da 422 y NO consume el token', async () => {
      await registrar();
      await pedirReset();
      const token = ultimoToken();

      await confirmar(token, 'password').expect(422);
      // Un error de tipeo no debe obligar a pedir otro mail.
      await confirmar(token, NUEVA).expect(200);
    });
  });

  describe('anti-enumeración (AC-11)', () => {
    it('el pedido para un email inexistente da 202 y no crea nada', async () => {
      await pedirReset('nadie@example.com').expect(202);
      expect(await prisma.passwordResetToken.count()).toBe(0);
    });

    it('el 4.º pedido por cuenta en una hora sigue dando 202 sin emitir token', async () => {
      // El límite por cuenta actúa en silencio: informarlo diría que la cuenta
      // existe, que es justo lo que AC-11 prohíbe.
      await registrar();
      for (let i = 0; i < 3; i++) await pedirReset().expect(202);
      expect(await prisma.passwordResetToken.count()).toBe(3);

      await pedirReset().expect(202);
      expect(await prisma.passwordResetToken.count()).toBe(3);
    });
  });
});
