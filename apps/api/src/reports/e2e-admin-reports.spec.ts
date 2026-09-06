import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { adminToken, bootTestApp } from '../../test/e2e-app';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsModule } from './reports.module';
import { MetricsModule } from '../observability/metrics.module';

/**
 * T6.2 — los 6 endpoints, mediante supertest contra Postgres real. Cubre
 * también la garantía "sin colisión de ruta" con el scrape de Prometheus
 * (`design.md §D1`).
 */
describe('ReportsController — 6 endpoints (e2e-admin-reports)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const auth = (req: request.Test) => req.set('Authorization', `Bearer ${adminToken()}`);

  const limpiar = () =>
    prisma.$executeRawUnsafe(
      'TRUNCATE TABLE orders, order_items, order_status_history, products, categories RESTART IDENTITY CASCADE',
    );

  beforeAll(async () => {
    app = await bootTestApp([ReportsModule]);
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(async () => {
    await limpiar();
  });

  it('GET /v1/admin/reports/sales → 200 con el shape esperado', async () => {
    const res = await auth(request(app.getHttpServer()).get('/v1/admin/reports/sales'));

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('range.from');
    expect(res.body).toHaveProperty('range.to');
    expect(res.body.granularity).toBe('day');
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('GET /v1/admin/reports/sales/export → 200, text/csv, attachment', async () => {
    const res = await auth(request(app.getHttpServer()).get('/v1/admin/reports/sales/export'));

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="reports-sales-/);
  });

  it('GET /v1/admin/reports/top-products → 200 con el shape esperado', async () => {
    const res = await auth(request(app.getHttpServer()).get('/v1/admin/reports/top-products'));

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('range.from');
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('GET /v1/admin/reports/top-products/export → 200, text/csv, attachment', async () => {
    const res = await auth(
      request(app.getHttpServer()).get('/v1/admin/reports/top-products/export'),
    );

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="reports-top-products-/,
    );
  });

  it('GET /v1/admin/reports/summary → 200 con el shape esperado', async () => {
    const res = await auth(request(app.getHttpServer()).get('/v1/admin/reports/summary'));

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('orders_count');
    expect(res.body).toHaveProperty('total_ars_cents');
    expect(Object.keys(res.body.breakdown_by_status).sort()).toEqual(
      ['delivered', 'new', 'preparing', 'ready'].sort(),
    );
  });

  it('GET /v1/admin/reports/summary/export → 200, text/csv, attachment', async () => {
    const res = await auth(request(app.getHttpServer()).get('/v1/admin/reports/summary/export'));

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="reports-summary-/);
  });

  it('created_at_from > created_at_to → 422 (dsm:reports/invalid-range)', async () => {
    const res = await auth(
      request(app.getHttpServer())
        .get('/v1/admin/reports/sales')
        .query({ created_at_from: '2026-08-31T00:00:00.000Z', created_at_to: '2026-08-01T00:00:00.000Z' }),
    );

    expect(res.status).toBe(422);
    expect(res.body.type).toBe('dsm:reports/invalid-range');
  });
});

/**
 * Garantía de no-colisión: el scrape existente de `observability/` sigue
 * devolviendo `text/plain` cuando se monta EN AISLAMIENTO, sin `ReportsModule`
 * presente — `design.md §D1`, verification suite-level.
 */
describe('GET /v1/admin/metrics — sin ReportsModule presente, sin regresión de ruta', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await bootTestApp([MetricsModule]);
  });
  afterAll(async () => {
    await app?.close();
  });

  it('sigue siendo el scrape Prometheus (text/plain), no un endpoint de reports', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/admin/metrics')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/plain; charset=utf-8; version=0.0.4');
  });
});
