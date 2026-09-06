import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bootTestApp, nuevaIpDeTest } from '../../test/e2e-app';
import { AuthModule } from '../auth/auth.module';
import { AccountModule } from './account.module';
import { PrismaService } from '../prisma/prisma.service';
import { ACCESS_COOKIE, CSRF_COOKIE, REFRESH_COOKIE } from '../auth/cookies';

/**
 * T5.1 — AC-1: happy path e2e del borrado de cuenta (sesión cerrada, cookies
 * limpias), mismo estilo que `e2e-auth-session.spec.ts`.
 */
describe('AC-1 — happy path e2e del borrado de cuenta (e2e-account-deletion)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const PASSWORD = 'correo caballo batería grapa';
  const EMAIL = 'ana@example.com';
  const ORIGEN = (process.env.CORS_ALLOWED_ORIGINS ?? '').split(',')[0];

  let ip = '';

  beforeAll(async () => {
    process.env.TRUST_PROXY_HOPS = '1';
    app = await bootTestApp([AuthModule, AccountModule]);
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app?.close();
    delete process.env.TRUST_PROXY_HOPS;
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE orders, order_items, carts, cart_items, customers RESTART IDENTITY CASCADE',
    );
    ip = nuevaIpDeTest();
  });

  const http = () => {
    const agente = request(app.getHttpServer());
    return {
      get: (r: string) => agente.get(r).set('X-Forwarded-For', ip),
      post: (r: string) => agente.post(r).set('X-Forwarded-For', ip),
      del: (r: string) => agente.delete(r).set('X-Forwarded-For', ip),
    };
  };

  const leerCsrf = (cookies: string[]): string =>
    cookies
      .find((c) => c.startsWith(`${CSRF_COOKIE}=`))!
      .split(';')[0]
      .split('=')[1];

  async function abrirSesion() {
    const res = await http()
      .post('/v1/auth/register')
      .send({ email: EMAIL, name: 'Ana', password: PASSWORD })
      .expect(201);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    return { cookies, csrf: leerCsrf(cookies) };
  }

  it('DELETE /v1/me con sesión válida y sin órdenes bloqueantes: 204, cookies limpias, y GET /v1/auth/me con el access viejo responde 401 en el acto', async () => {
    const sesion = await abrirSesion();

    const res = await http()
      .del('/v1/me')
      .set('Cookie', sesion.cookies)
      .set('X-CSRF-Token', sesion.csrf)
      .set('Origin', ORIGEN)
      .expect(204);

    const borradas = res.headers['set-cookie'] as unknown as string[];
    expect(borradas.some((c) => c.startsWith(`${ACCESS_COOKIE}=`) && /Max-Age=0|Expires=Thu, 01 Jan 1970/.test(c))).toBe(true);
    expect(borradas.some((c) => c.startsWith(`${REFRESH_COOKIE}=`) && /Max-Age=0|Expires=Thu, 01 Jan 1970/.test(c))).toBe(true);
    expect(borradas.some((c) => c.startsWith(`${CSRF_COOKIE}=`) && /Max-Age=0|Expires=Thu, 01 Jan 1970/.test(c))).toBe(true);

    // Distinto del residual de logout (e2e-auth-session.spec.ts): acá la
    // cuenta quedó `deleted_at` no-nulo, así que `findActiveById` ya no la
    // encuentra y `/me` responde 401 aunque el JWT no haya vencido.
    await http().get('/v1/auth/me').set('Cookie', sesion.cookies).expect(401);
  });
});
