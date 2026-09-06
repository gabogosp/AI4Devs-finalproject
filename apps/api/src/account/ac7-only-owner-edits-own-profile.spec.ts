import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { bootTestApp, nuevaIpDeTest } from '../../test/e2e-app';
import { AuthModule } from '../auth/auth.module';
import { AccountModule } from './account.module';
import { PrismaService } from '../prisma/prisma.service';
import { ACCESS_COOKIE, CSRF_COOKIE } from '../auth/cookies';
import { JWT_AUDIENCE, JWT_ISSUER } from '../auth/session.service';
import { parseCorsOrigins } from '../config/env.validation';

/**
 * T6 (US-024) — AC-7: `PATCH /v1/me` no acepta NINGÚN parámetro de
 * identidad (ni body, ni path, ni query) — el `customerId` sale
 * exclusivamente de `req.customerId` (sesión). Mismo criterio que
 * `ac13-only-owner-deletes.spec.ts` (US-020).
 */
describe('AC-7 — sólo el titular edita su propio perfil (ac7-only-owner-edits-own-profile)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const ORIGEN = parseCorsOrigins(process.env.CORS_ALLOWED_ORIGINS ?? '')[0];
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
      'TRUNCATE TABLE customers RESTART IDENTITY CASCADE',
    );
    ip = nuevaIpDeTest();
  });

  const leerCsrf = (cookies: string[]): string =>
    cookies
      .find((c) => c.startsWith(`${CSRF_COOKIE}=`))!
      .split(';')[0]
      .split('=')[1];

  async function registrar(email: string, name: string) {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .set('X-Forwarded-For', ip)
      .send({ email, name, password: 'correo caballo batería grapa' })
      .expect(201);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    return { cookies, csrf: leerCsrf(cookies) };
  }

  it('sin sesión de cliente: 401, ninguna fila cambia', async () => {
    await registrar('titular@example.com', 'Titular');

    await request(app.getHttpServer())
      .patch('/v1/me')
      .set('X-Forwarded-For', ip)
      .set('Origin', ORIGEN)
      .send({ name: 'Intruso', avatar_url: null })
      .expect(401);

    const fila = await prisma.customer.findFirstOrThrow({
      where: { email: 'titular@example.com' },
    });
    expect(fila.name).toBe('Titular');
  });

  it('la sesión de "Otro" sólo edita su propia fila — "Titular" no cambia', async () => {
    await registrar('titular@example.com', 'Titular');
    const otro = await registrar('otro@example.com', 'Otro');

    await request(app.getHttpServer())
      .patch('/v1/me')
      .set('Cookie', otro.cookies)
      .set('X-CSRF-Token', otro.csrf)
      .set('Origin', ORIGEN)
      .send({ name: 'Otro Editado', avatar_url: null })
      .expect(200);

    const filaOtro = await prisma.customer.findFirstOrThrow({
      where: { email: 'otro@example.com' },
    });
    expect(filaOtro.name).toBe('Otro Editado');

    const filaTitular = await prisma.customer.findFirstOrThrow({
      where: { email: 'titular@example.com' },
    });
    expect(filaTitular.name).toBe('Titular');
  });

  it('no hay ningún parámetro de ruta/query que acepte un customer_id ajeno', async () => {
    const titular = await registrar('titular@example.com', 'Titular');
    await registrar('otro@example.com', 'Otro');
    const filaOtroAntes = await prisma.customer.findFirstOrThrow({
      where: { email: 'otro@example.com' },
    });

    // Ni /v1/me/{id}, ni ?customer_id=, ni un body con id — nada de esto
    // existe como ruta ni se lee: se envía igual para dejar constancia de
    // que NINGUNA variante cambia la fila de "Otro" usando la sesión de
    // "Titular".
    await request(app.getHttpServer())
      .patch(`/v1/me/${filaOtroAntes.id}`)
      .set('Cookie', titular.cookies)
      .set('X-CSRF-Token', titular.csrf)
      .set('Origin', ORIGEN)
      .send({ name: 'Hackeado', avatar_url: null })
      .expect(404);

    await request(app.getHttpServer())
      .patch(`/v1/me?customer_id=${filaOtroAntes.id}`)
      .set('Cookie', titular.cookies)
      .set('X-CSRF-Token', titular.csrf)
      .set('Origin', ORIGEN)
      .send({ name: 'Hackeado', avatar_url: null })
      .expect(200); // el query param se ignora — actualiza al TITULAR, no a "Otro"

    const filaOtroDespues = await prisma.customer.findFirstOrThrow({
      where: { email: 'otro@example.com' },
    });
    expect(filaOtroDespues.name).toBe('Otro');

    const filaTitular = await prisma.customer.findFirstOrThrow({
      where: { email: 'titular@example.com' },
    });
    expect(filaTitular.name).toBe('Hackeado');
  });

  it('con un JWT admin (role=admin) en la cookie de access: 401 — la ruta exige role=customer', async () => {
    const jwt = new JwtService({});
    const tokenAdmin = jwt.sign(
      { sub: 'admin-1', role: 'admin', typ: 'access', jti: 'jti-admin-1' },
      { secret: process.env.JWT_SECRET, issuer: JWT_ISSUER, audience: JWT_AUDIENCE },
    );

    await request(app.getHttpServer())
      .patch('/v1/me')
      .set('Cookie', [`${ACCESS_COOKIE}=${tokenAdmin}`])
      .set('Origin', ORIGEN)
      .send({ name: 'Admin Intento', avatar_url: null })
      .expect(401);
  });
});
