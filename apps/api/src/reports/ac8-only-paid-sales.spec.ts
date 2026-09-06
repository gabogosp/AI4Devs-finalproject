import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { adminToken, bootTestApp } from '../../test/e2e-app';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsModule } from './reports.module';

/**
 * T7.3 — AC-8, probado end-to-end contra los 6 valores del enum de `status`,
 * sembrados directo con `prisma.order.create` — mismo criterio que
 * `orders/ac8-only-paid-orders.spec.ts` (sin depender de un flujo real de
 * pago para llegar a cada estado).
 */
describe('AC-8 — sólo pagadas, con los 6 estados sembrados (e2e-reports)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let productId: string;

  const auth = (req: request.Test) => req.set('Authorization', `Bearer ${adminToken()}`);

  const TODOS_LOS_ESTADOS = [
    'pending_payment',
    'new',
    'preparing',
    'ready',
    'delivered',
    'cancelled',
  ] as const;

  const RANGE = {
    created_at_from: '2026-08-01T00:00:00.000Z',
    created_at_to: '2026-09-01T00:00:00.000Z',
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
    const cat = await prisma.category.create({
      data: { name: 'Reports AC8', slug: 'reports-ac8' },
    });
    productId = (
      await prisma.product.create({
        data: {
          sku: 'RPT-AC8',
          slug: 'reports-ac8-producto',
          name: 'Producto de prueba',
          price_ars_cents: 100_000,
          stock: 100,
          status: 'published',
          category_id: cat.id,
        },
      })
    ).id;

    for (const status of TODOS_LOS_ESTADOS) {
      const orden = await prisma.order.create({
        data: {
          access_token_hash: `h-reports-ac8-${status}`,
          buyer_name: 'Comprador de Prueba',
          buyer_email: `comprador-reports-ac8-${status}@test.local`,
          buyer_phone: '+54 351 555 0000',
          total_ars_cents: 100_000,
          consent_accepted: true,
          consent_accepted_at: new Date(),
          consent_terms_version: '2026-06-15',
          status: 'pending_payment',
          created_at: new Date('2026-08-15T10:00:00.000Z'),
          items: {
            create: [
              {
                product_id: productId,
                quantity: 1,
                unit_price_ars_cents: 100_000,
                product_name: 'Producto de prueba',
                product_sku: 'RPT-AC8',
              },
            ],
          },
        },
      });
      if (status !== 'pending_payment') {
        await prisma.order.update({ where: { id: orden.id }, data: { status } });
      }
    }
  });

  it('/summary.orders_count = 4 (no 6), la suma de breakdown_by_status = 4', async () => {
    const res = await auth(
      request(app.getHttpServer()).get('/v1/admin/reports/summary').query(RANGE),
    );

    expect(res.status).toBe(200);
    expect(res.body.orders_count).toBe(4);
    const suma = Object.values(res.body.breakdown_by_status as Record<string, { count: number }>).reduce(
      (acc, v) => acc + v.count,
      0,
    );
    expect(suma).toBe(4);
  });

  it('/sales sólo suma total_ars_cents de las 4 activas (400.000, no 600.000)', async () => {
    const res = await auth(request(app.getHttpServer()).get('/v1/admin/reports/sales').query(RANGE));

    expect(res.status).toBe(200);
    const totalGeneral = res.body.data.reduce(
      (acc: number, r: { total_ars_cents: number }) => acc + r.total_ars_cents,
      0,
    );
    expect(totalGeneral).toBe(400_000);
  });

  it('/top-products sólo cuenta líneas de las 4 órdenes activas (quantity_sold = 4)', async () => {
    const res = await auth(
      request(app.getHttpServer()).get('/v1/admin/reports/top-products').query(RANGE),
    );

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].quantity_sold).toBe(4);
  });
});
