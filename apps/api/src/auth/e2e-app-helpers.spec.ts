import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bootTestApp, customerAccessCookie } from '../../test/e2e-app';
import { PrismaService } from '../prisma/prisma.service';
import { AuthModule } from './auth.module';

/**
 * T5.4 — smoke del helper `customerAccessCookie()`: una request e2e con esta
 * cookie tiene que pasar `CustomerGuard` de verdad, contra un endpoint ya
 * gateado por ese guard (`GET /v1/auth/me`, sin tocar) — la prueba de que el
 * helper firma un token completo (`typ`/`jti`), a diferencia de
 * `customerToken()`, que los omite a propósito para probar el rechazo del
 * header.
 */
describe('customerAccessCookie() (test/e2e-app, US-015 T5.4)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await bootTestApp([AuthModule]);
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE customers RESTART IDENTITY CASCADE');
  });

  it('pasa CustomerGuard en GET /v1/auth/me (endpoint ya existente, gateado por el mismo guard)', async () => {
    const cliente = await prisma.customer.create({
      data: {
        email: 'helper-e2e-app@test.local',
        password_hash: 'hash-de-prueba',
        name: 'Cliente Helper',
      },
    });

    const res = await request(app.getHttpServer())
      .get('/v1/auth/me')
      .set('Cookie', customerAccessCookie(cliente.id));

    expect(res.status).toBe(200);
    expect(res.body.email).toBe('helper-e2e-app@test.local');
  });
});
