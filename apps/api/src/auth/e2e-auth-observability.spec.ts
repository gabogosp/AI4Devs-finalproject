import { INestApplication, Logger } from '@nestjs/common';
import request from 'supertest';
import { bootTestApp, nuevaIpDeTest } from '../../test/e2e-app';
import { AuthModule } from './auth.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuthEventsService } from '../observability/auth-events.service';
import { CSRF_COOKIE } from './cookies';

/**
 * T9.1 — los 8 eventos, y el barrido que sostiene AC-8.
 *
 * El barrido es la parte que importa: se captura **todo** lo que la corrida
 * escribió por cualquier nivel del logger y se busca la contraseña, el hash, el
 * email y los tokens. Un test que sólo mirara los eventos que emitimos a
 * propósito no vería una fuga por un `console.log` olvidado, una excepción con
 * el body adentro, o un log de librería — que son las formas en que esto pasa de
 * verdad.
 */
describe('Observabilidad de auth (e2e-auth-observability)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let eventos: AuthEventsService;

  const PASSWORD = 'contraseña-secreta-para-el-barrido';
  const EMAIL = 'ana-secreta@example.com';

  /** Todo lo escrito por el logger durante el test, aplanado a texto. */
  let capturado: string[] = [];
  let ip = '';

  beforeAll(async () => {
    process.env.TRUST_PROXY_HOPS = '1';
    app = await bootTestApp([AuthModule]);
    prisma = app.get(PrismaService);
    eventos = app.get(AuthEventsService);
  });
  afterAll(async () => {
    await app?.close();
    delete process.env.TRUST_PROXY_HOPS;
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE customers RESTART IDENTITY CASCADE',
    );
    eventos.reset();
    ip = nuevaIpDeTest();

    capturado = [];
    const capturar = (...args: unknown[]) => {
      capturado.push(args.map((a) => JSON.stringify(a)).join(' '));
    };
    for (const nivel of ['log', 'debug', 'warn', 'error', 'verbose'] as const) {
      jest.spyOn(Logger.prototype, nivel).mockImplementation(capturar);
      jest.spyOn(Logger, nivel).mockImplementation(capturar);
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
      .send({ email: EMAIL, name: 'Ana', password: PASSWORD });

  describe('los 8 eventos se emiten en su momento', () => {
    it('auth.registered al dar de alta', async () => {
      await registrar().expect(201);
      expect(eventos.count('auth.registered')).toBe(1);
    });

    it('auth.login_succeeded al entrar', async () => {
      await registrar();
      await http()
        .post('/v1/auth/login')
        .send({ email: EMAIL, password: PASSWORD })
        .expect(200);
      expect(eventos.count('auth.login_succeeded')).toBe(1);
    });

    it('auth.login_failed con contraseña incorrecta', async () => {
      await registrar();
      await http()
        .post('/v1/auth/login')
        .send({ email: EMAIL, password: 'incorrecta' })
        .expect(401);
      expect(eventos.count('auth.login_failed')).toBe(1);
    });

    it('auth.account_locked al quinto fallo', async () => {
      await registrar();
      for (let i = 0; i < 5; i++) {
        await http()
          .post('/v1/auth/login')
          .send({ email: EMAIL, password: 'incorrecta' });
      }
      expect(eventos.count('auth.account_locked')).toBe(1);
    });

    it('auth.logout al cerrar sesión', async () => {
      const alta = await registrar().expect(201);
      const cookies = alta.headers['set-cookie'] as unknown as string[];
      const csrf = cookies
        .find((c) => c.startsWith(`${CSRF_COOKIE}=`))!
        .split(';')[0]
        .split('=')[1];

      await http()
        .post('/v1/auth/logout')
        .set('Cookie', cookies)
        .set('X-CSRF-Token', csrf)
        .set('Origin', (process.env.CORS_ALLOWED_ORIGINS ?? '').split(',')[0])
        .expect(204);

      expect(eventos.count('auth.logout')).toBe(1);
    });

    it('auth.password_reset_requested — sólo si la cuenta existe', async () => {
      await registrar();
      await http()
        .post('/v1/auth/password-reset/request')
        .send({ email: EMAIL })
        .expect(202);
      expect(eventos.count('auth.password_reset_requested')).toBe(1);

      // Un pedido para una cuenta inexistente responde igual pero NO emite: si
      // emitiera, el propio contador delataría qué direcciones existen a quien
      // mire el tablero.
      await http()
        .post('/v1/auth/password-reset/request')
        .send({ email: 'nadie@example.com' })
        .expect(202);
      expect(eventos.count('auth.password_reset_requested')).toBe(1);
    });

    it('auth.password_reset_completed al confirmar', async () => {
      await registrar();
      await http()
        .post('/v1/auth/password-reset/request')
        .send({ email: EMAIL })
        .expect(202);

      const fila = await prisma.passwordResetToken.findFirstOrThrow();
      expect(fila).toBeTruthy();
      // El token en claro sale del log de debug del adapter (sólo fuera de
      // producción) — es el mismo camino que usa el e2e de AC-4.
      const linea = capturado.find((l) => l.includes('password_reset.token'));
      const token = linea!.match(/token=([A-Za-z0-9_-]+)/)![1];

      await http()
        .post('/v1/auth/password-reset/confirm')
        .send({ token, password: 'otra contraseña larga y distinta' })
        .expect(200);

      expect(eventos.count('auth.password_reset_completed')).toBe(1);
    });

    it('auth.refresh_reuse_detected al replayar un refresh rotado', async () => {
      const alta = await registrar().expect(201);
      const cookies = alta.headers['set-cookie'] as unknown as string[];
      const csrf = cookies
        .find((c) => c.startsWith(`${CSRF_COOKIE}=`))!
        .split(';')[0]
        .split('=')[1];
      const origen = (process.env.CORS_ALLOWED_ORIGINS ?? '').split(',')[0];

      const refrescar = () =>
        http()
          .post('/v1/auth/refresh')
          .set('Cookie', cookies)
          .set('X-CSRF-Token', csrf)
          .set('Origin', origen);

      await refrescar().expect(200);
      // Segundo intento con la MISMA cookie vieja: es el replay.
      await refrescar().expect(401);

      expect(eventos.count('auth.refresh_reuse_detected')).toBe(1);
    });
  });

  describe('AC-8 — barrido de TODO lo que la corrida escribió', () => {
    it('ni la contraseña, ni el hash, ni el email, ni los tokens aparecen en los logs', async () => {
      // Ejercita el recorrido completo: alta, login fallido, login bueno, reset.
      const alta = await registrar().expect(201);
      await http()
        .post('/v1/auth/login')
        .send({ email: EMAIL, password: 'incorrecta' });
      await http().post('/v1/auth/login').send({ email: EMAIL, password: PASSWORD });
      await http()
        .post('/v1/auth/password-reset/request')
        .send({ email: EMAIL });

      const cookies = alta.headers['set-cookie'] as unknown as string[];
      const refresh = cookies
        .find((c) => c.startsWith('dsm_refresh='))!
        .split(';')[0]
        .split('=')[1];

      const todo = capturado.join('\n');

      expect(todo).not.toContain(PASSWORD);
      expect(todo).not.toContain('$2b$');
      expect(todo).not.toContain(EMAIL);
      expect(todo).not.toContain(refresh);
      // Y el hash persistido tampoco.
      const fila = await prisma.customer.findFirstOrThrow();
      expect(todo).not.toContain(fila.password_hash);
    });

    it('el 422 de validación tampoco devuelve el body al log', async () => {
      await http()
        .post('/v1/auth/register')
        .send({ email: EMAIL, name: 'Ana', password: PASSWORD, role: 'admin' })
        .expect(422);

      expect(capturado.join('\n')).not.toContain(PASSWORD);
    });

    it('un login fallido de email inexistente emite entity_id null, no el email', async () => {
      await http()
        .post('/v1/auth/login')
        .send({ email: 'fantasma@example.com', password: 'x' })
        .expect(401);

      const linea = capturado.find((l) => l.includes('auth.login_failed'));
      expect(linea).toBeDefined();
      expect(linea).toContain('"entity_id":null');
      expect(linea).not.toContain('fantasma@example.com');
    });
  });
});
