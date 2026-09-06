import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bootTestApp, nuevaIpDeTest } from '../../test/e2e-app';
import { AuthModule } from '../auth/auth.module';
import { AccountModule } from './account.module';
import { PrismaService } from '../prisma/prisma.service';
import { CSRF_COOKIE } from '../auth/cookies';
import { parseCorsOrigins } from '../config/env.validation';

/**
 * T6 (US-024) — AC-1 (editar nombre), AC-2 (setear avatar), AC-3 (quitar
 * avatar). Mismo estilo que `ac13-only-owner-deletes.spec.ts`: supertest
 * contra Postgres real, sin mocks.
 */
describe('AC-1/AC-2/AC-3 — editar nombre y avatar (ac1-ac2-ac3-edit-profile)', () => {
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

  const patch = (
    sesion: { cookies: string[]; csrf: string },
    body: Record<string, unknown>,
  ) =>
    request(app.getHttpServer())
      .patch('/v1/me')
      .set('Cookie', sesion.cookies)
      .set('X-CSRF-Token', sesion.csrf)
      .set('Origin', ORIGEN)
      .send(body);

  it('AC-1: cambia el nombre y se refleja de inmediato en la respuesta', async () => {
    const sesion = await registrar('ana@example.com', 'Ana');

    const res = await patch(sesion, { name: 'Ana María Pérez', avatar_url: null }).expect(
      200,
    );

    expect(res.body.name).toBe('Ana María Pérez');
    const fila = await prisma.customer.findFirstOrThrow({
      where: { email: 'ana@example.com' },
    });
    expect(fila.name).toBe('Ana María Pérez');
  });

  it('AC-2: pega una URL de imagen válida y el avatar se actualiza', async () => {
    const sesion = await registrar('ana@example.com', 'Ana');

    const res = await patch(sesion, {
      name: 'Ana',
      avatar_url: 'https://cdn.example.com/ana.jpg',
    }).expect(200);

    expect(res.body.avatar_url).toBe('https://cdn.example.com/ana.jpg');
  });

  it('AC-3: borra la URL y el avatar vuelve al placeholder (null)', async () => {
    const sesion = await registrar('ana@example.com', 'Ana');
    await patch(sesion, { name: 'Ana', avatar_url: 'https://cdn.example.com/ana.jpg' }).expect(
      200,
    );

    const res = await patch(sesion, { name: 'Ana', avatar_url: null }).expect(200);

    expect(res.body.avatar_url).toBeNull();
  });
});
