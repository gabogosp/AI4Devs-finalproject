import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { adminToken, bootTestApp } from '../../test/e2e-app';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsModule } from './reports.module';

/**
 * T7.1 — AC-5: un período sin datos nunca es un error, en los 3 datasets y
 * sus 3 exports. Se fuerza pidiendo un rango en el futuro (mañana en
 * adelante) sobre una base vacía — garantiza cero filas sin depender de
 * limpiar entre tests.
 */
describe('AC-5 — período sin datos (e2e-reports)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const auth = (req: request.Test) => req.set('Authorization', `Bearer ${adminToken()}`);
  // Rango enteramente en el futuro (from < to, ambos posteriores a "hoy"): ninguna
  // orden sembrada por otro test puede caer ahí, y from < to evita el 422 de rango
  // inválido.
  const query = {
    created_at_from: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    created_at_to: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
  };

  beforeAll(async () => {
    app = await bootTestApp([ReportsModule]);
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE orders, order_items, order_status_history, products, categories RESTART IDENTITY CASCADE',
    );
  });

  it('GET /sales → 200 con data: []', async () => {
    const res = await auth(
      request(app.getHttpServer()).get('/v1/admin/reports/sales').query(query),
    );
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('GET /top-products → 200 con data: []', async () => {
    const res = await auth(
      request(app.getHttpServer())
        .get('/v1/admin/reports/top-products')
        .query(query),
    );
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('GET /summary → 200 con ceros y las 4 claves del breakdown', async () => {
    const res = await auth(
      request(app.getHttpServer())
        .get('/v1/admin/reports/summary')
        .query(query),
    );
    expect(res.status).toBe(200);
    expect(res.body.orders_count).toBe(0);
    expect(res.body.total_ars_cents).toBe(0);
    expect(res.body.breakdown_by_status).toEqual({
      new: { count: 0, total_ars_cents: 0 },
      preparing: { count: 0, total_ars_cents: 0 },
      ready: { count: 0, total_ars_cents: 0 },
      delivered: { count: 0, total_ars_cents: 0 },
    });
  });

  it('GET /sales/export → 200, CSV con sólo el encabezado', async () => {
    const res = await auth(
      request(app.getHttpServer())
        .get('/v1/admin/reports/sales/export')
        .query(query),
    );
    expect(res.status).toBe(200);
    expect(res.text.trim().split('\n')).toEqual(['period_date,orders_count,total_ars_cents']);
  });

  it('GET /top-products/export → 200, CSV con sólo el encabezado', async () => {
    const res = await auth(
      request(app.getHttpServer())
        .get('/v1/admin/reports/top-products/export')
        .query(query),
    );
    expect(res.status).toBe(200);
    expect(res.text.trim().split('\n')).toEqual([
      'product_id,product_name,product_sku,quantity_sold,revenue_ars_cents',
    ]);
  });

  it('GET /summary/export → 200, CSV con el resumen en ceros', async () => {
    const res = await auth(
      request(app.getHttpServer())
        .get('/v1/admin/reports/summary/export')
        .query(query),
    );
    expect(res.status).toBe(200);
    const lineas = res.text.trim().split('\n');
    expect(lineas[0]).toBe('status,count,total_ars_cents');
    expect(lineas).toContain('total,0,0');
  });
});
