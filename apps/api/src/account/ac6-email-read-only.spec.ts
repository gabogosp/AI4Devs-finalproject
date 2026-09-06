import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bootTestApp, nuevaIpDeTest } from '../../test/e2e-app';
import { AuthModule } from '../auth/auth.module';
import { AccountModule } from './account.module';
import { PrismaService } from '../prisma/prisma.service';
import { CSRF_COOKIE } from '../auth/cookies';
import { parseCorsOrigins } from '../config/env.validation';

/**
 * T6 (US-024) — AC-6 (negative-space): el email NO es editable por
 * `PATCH /v1/me`. El DTO no declara `email`; con `forbidNonWhitelisted:
 * true` global, enviarlo es 422, no un campo ignorado en silencio.
 */
describe('AC-6 — email de sólo lectura (ac6-email-read-only)', () => {
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

  it('enviar email en el body: 422, la fila no cambia', async () => {
    const sesion = await registrar('ana@example.com', 'Ana');

    await request(app.getHttpServer())
      .patch('/v1/me')
      .set('Cookie', sesion.cookies)
      .set('X-CSRF-Token', sesion.csrf)
      .set('Origin', ORIGEN)
      .send({ name: 'Ana', avatar_url: null, email: 'otro@example.com' })
      .expect(422);

    const fila = await prisma.customer.findFirstOrThrow({
      where: { email: 'ana@example.com' },
    });
    expect(fila.email).toBe('ana@example.com');
  });
});
