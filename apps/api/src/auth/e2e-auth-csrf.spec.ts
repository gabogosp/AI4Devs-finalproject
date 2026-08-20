import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bootTestApp } from '../../test/e2e-app';
import { AuthModule } from './auth.module';
import { PrismaService } from '../prisma/prisma.service';
import { parseCorsOrigins } from '../config/env.validation';
import { CSRF_COOKIE } from './cookies';

/**
 * T4.4 + T5.3 — CSRF y CORS sobre las rutas autenticadas por cookie (§7.5, §7.2).
 */
describe('CSRF y CORS del seam de cliente (e2e-auth-csrf)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const PASSWORD = 'correo caballo batería grapa';
  const EMAIL = 'ana@example.com';
  const ORIGEN_OK = parseCorsOrigins(process.env.CORS_ALLOWED_ORIGINS ?? '')[0];

  beforeAll(async () => {
    app = await bootTestApp([AuthModule]);
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE customers RESTART IDENTITY CASCADE',
    );
  });

  const http = () => request(app.getHttpServer());

  /** Alta + extracción de cookies y del valor de CSRF que emitió el servidor. */
  async function sesion(): Promise<{ cookies: string[]; csrf: string }> {
    const res = await http()
      .post('/v1/auth/register')
      .send({ email: EMAIL, name: 'Ana', password: PASSWORD })
      .expect(201);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    const csrf = cookies
      .find((c) => c.startsWith(`${CSRF_COOKIE}=`))!
      .split(';')[0]
      .split('=')[1];
    return { cookies, csrf };
  }

  describe('POST /v1/auth/logout', () => {
    it('con cookie + header + Origin permitido → 204', async () => {
      const { cookies, csrf } = await sesion();
      await http()
        .post('/v1/auth/logout')
        .set('Cookie', cookies)
        .set('X-CSRF-Token', csrf)
        .set('Origin', ORIGEN_OK)
        .expect(204);
    });

    it('sin el header X-CSRF-Token → 403 dsm:auth/csrf', async () => {
      const { cookies } = await sesion();
      const res = await http()
        .post('/v1/auth/logout')
        .set('Cookie', cookies)
        .set('Origin', ORIGEN_OK)
        .expect(403);
      expect(res.body.type).toBe('dsm:auth/csrf');
    });

    it('con el CSRF de OTRA sesión → 403', async () => {
      const { cookies } = await sesion();
      await prisma.$executeRawUnsafe(
        'TRUNCATE TABLE customers RESTART IDENTITY CASCADE',
      );
      const otra = await http()
        .post('/v1/auth/register')
        .send({ email: 'beto@example.com', name: 'Beto', password: PASSWORD })
        .expect(201);
      const csrfAjeno = (otra.headers['set-cookie'] as unknown as string[])
        .find((c) => c.startsWith(`${CSRF_COOKIE}=`))!
        .split(';')[0]
        .split('=')[1];

      await http()
        .post('/v1/auth/logout')
        .set('Cookie', cookies)
        .set('X-CSRF-Token', csrfAjeno)
        .set('Origin', ORIGEN_OK)
        .expect(403);
    });

    it('SIN Origin → 403 (una escritura por cookie sin origen no es verificable)', async () => {
      const { cookies, csrf } = await sesion();
      await http()
        .post('/v1/auth/logout')
        .set('Cookie', cookies)
        .set('X-CSRF-Token', csrf)
        .expect(403);
    });

    it('con Origin fuera de la allowlist → 403', async () => {
      const { cookies, csrf } = await sesion();
      await http()
        .post('/v1/auth/logout')
        .set('Cookie', cookies)
        .set('X-CSRF-Token', csrf)
        .set('Origin', 'http://evil.example')
        .expect(403);
    });

    it('sin sesión → 401 antes que el CSRF: el guard de auth corre primero', async () => {
      await http()
        .post('/v1/auth/logout')
        .set('Origin', ORIGEN_OK)
        .expect(401);
    });
  });

  describe('las rutas NO autenticadas no exigen CSRF', () => {
    it('POST /v1/auth/login sin header ni Origin → 200', async () => {
      await sesion();
      await http()
        .post('/v1/auth/login')
        .send({ email: EMAIL, password: PASSWORD })
        .expect(200);
    });

    it('POST /v1/auth/register sin header ni Origin → 201', async () => {
      await http()
        .post('/v1/auth/register')
        .send({ email: 'nuevo@example.com', name: 'Nuevo', password: PASSWORD })
        .expect(201);
    });

    it('POST /v1/auth/password-reset/request sin CSRF → 202', async () => {
      await http()
        .post('/v1/auth/password-reset/request')
        .send({ email: 'quien-sea@example.com' })
        .expect(202);
    });
  });

  describe('CORS (T5.3, §7.2)', () => {
    it('el preflight desde el origen permitido declara X-CSRF-Token y credenciales', async () => {
      const res = await http()
        .options('/v1/auth/logout')
        .set('Origin', ORIGEN_OK)
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'x-csrf-token');

      expect(res.headers['access-control-allow-headers']?.toLowerCase()).toContain(
        'x-csrf-token',
      );
      expect(res.headers['access-control-allow-credentials']).toBe('true');
      expect(res.headers['access-control-allow-origin']).toBe(ORIGEN_OK);
    });

    it('un origen fuera de la allowlist NO recibe Allow-Origin', async () => {
      const res = await http()
        .options('/v1/auth/logout')
        .set('Origin', 'http://evil.example')
        .set('Access-Control-Request-Method', 'POST');

      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('nunca aparece el comodín con credenciales', async () => {
      const res = await http()
        .options('/v1/auth/logout')
        .set('Origin', ORIGEN_OK)
        .set('Access-Control-Request-Method', 'POST');
      expect(res.headers['access-control-allow-origin']).not.toBe('*');
    });
  });
});
