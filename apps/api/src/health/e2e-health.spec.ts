import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { HealthModule } from './health.module';
import { PrismaModule } from '../prisma/prisma.module';

describe('Health (e2e-health)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ??
      'postgresql://dsm:dsm@localhost:55432/dsm?schema=public';
    const mod = await Test.createTestingModule({
      imports: [PrismaModule, HealthModule],
    }).compile();
    app = mod.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /health → 200 (liveness)', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /ready → 200 con la DB arriba (o 503 si down)', async () => {
    const res = await request(app.getHttpServer()).get('/ready');
    expect([200, 503]).toContain(res.status);
  });
});
