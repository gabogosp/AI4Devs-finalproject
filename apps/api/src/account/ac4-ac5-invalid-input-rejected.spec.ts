import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bootTestApp, nuevaIpDeTest } from '../../test/e2e-app';
import { AuthModule } from '../auth/auth.module';
import { AccountModule } from './account.module';
import { PrismaService } from '../prisma/prisma.service';
import { CSRF_COOKIE } from '../auth/cookies';
import { parseCorsOrigins } from '../config/env.validation';

/**
 * T6 (US-024) — AC-4 (nombre vacío rechazado) y AC-5 (URL inválida
 * rechazada): 422, y la fila no cambia.
 */
describe('AC-4/AC-5 — input inválido rechazado (ac4-ac5-invalid-input-rejected)', () => {
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

  it('AC-4: nombre vacío → 422, el nombre anterior se mantiene', async () => {
    const sesion = await registrar('ana@example.com', 'Ana Original');

    await patch(sesion, { name: '', avatar_url: null }).expect(422);

    const fila = await prisma.customer.findFirstOrThrow({
      where: { email: 'ana@example.com' },
    });
    expect(fila.name).toBe('Ana Original');
  });

  it('AC-4: nombre sólo espacios → 422', async () => {
    const sesion = await registrar('ana@example.com', 'Ana Original');

    await patch(sesion, { name: '     ', avatar_url: null }).expect(422);
  });

  it('AC-5: "no-es-url" → 422, el avatar anterior se mantiene', async () => {
    const sesion = await registrar('ana@example.com', 'Ana');
    await patch(sesion, { name: 'Ana', avatar_url: 'https://cdn.example.com/ana.jpg' }).expect(
      200,
    );

    await patch(sesion, { name: 'Ana', avatar_url: 'no-es-url' }).expect(422);

    const fila = await prisma.customer.findFirstOrThrow({
      where: { email: 'ana@example.com' },
    });
    expect(fila.avatar_url).toBe('https://cdn.example.com/ana.jpg');
  });

  it('AC-5: esquema distinto de http/https → 422', async () => {
    const sesion = await registrar('ana@example.com', 'Ana');

    await patch(sesion, { name: 'Ana', avatar_url: 'ftp://cdn.example.com/ana.jpg' }).expect(
      422,
    );
  });
});
