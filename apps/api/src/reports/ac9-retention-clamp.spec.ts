import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { adminToken, bootTestApp } from '../../test/e2e-app';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsModule } from './reports.module';

/** Mismo cálculo que `date-range.ts`/`orders-retention.service.ts:cutoffDate()`. */
function monthsAgo(months: number): Date {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d;
}

/**
 * T7.4 — AC-9: con `ORDER_RETENTION_MONTHS=12` (default), una orden sembrada
 * a 13 meses (fuera de ventana) y otra a 6 meses (dentro), pedir un
 * `created_at_from` de hace 24 meses **no** devuelve la de 13 meses, y **no**
 * es 422 — el rango se acota, no se rechaza.
 */
describe('AC-9 — retención de 12 meses, acotado no rechazado (e2e-reports)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let productId: string;

  const auth = (req: request.Test) => req.set('Authorization', `Bearer ${adminToken()}`);

  beforeAll(async () => {
    delete process.env.ORDER_RETENTION_MONTHS; // usa el default (12)
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
      data: { name: 'Reports AC9', slug: 'reports-ac9' },
    });
    productId = (
      await prisma.product.create({
        data: {
          sku: 'RPT-AC9',
          slug: 'reports-ac9-producto',
          name: 'Producto de prueba',
          price_ars_cents: 50_000,
          stock: 100,
          status: 'published',
          category_id: cat.id,
        },
      })
    ).id;

    const seed = async (createdAt: Date, totalArsCents: number) => {
      const order = await prisma.order.create({
        data: {
          access_token_hash: `h-reports-ac9-${createdAt.getTime()}`,
          buyer_name: 'Comprador de Prueba',
          buyer_email: `comprador-reports-ac9-${createdAt.getTime()}@test.local`,
          buyer_phone: '+54 351 555 0000',
          total_ars_cents: totalArsCents,
          consent_accepted: true,
          consent_accepted_at: new Date(),
          consent_terms_version: '2026-06-15',
          status: 'pending_payment',
          created_at: createdAt,
          items: {
            create: [
              {
                product_id: productId,
                quantity: 1,
                unit_price_ars_cents: totalArsCents,
                product_name: 'Producto de prueba',
                product_sku: 'RPT-AC9',
              },
            ],
          },
        },
      });
      await prisma.order.update({ where: { id: order.id }, data: { status: 'new' } });
    };

    // Fuera de la ventana de 12 meses.
    await seed(monthsAgo(13), 999_000);
    // Dentro de la ventana.
    await seed(monthsAgo(6), 50_000);
  });

  it('summary: pedir 24 meses atrás sólo incluye la orden de 6 meses, sin 422', async () => {
    const res = await auth(
      request(app.getHttpServer())
        .get('/v1/admin/reports/summary')
        .query({ created_at_from: monthsAgo(24).toISOString() }),
    );

    expect(res.status).toBe(200);
    expect(res.body.orders_count).toBe(1);
    expect(res.body.total_ars_cents).toBe(50_000);
  });

  it('sales: la orden de 13 meses no aparece en ninguna fila', async () => {
    const res = await auth(
      request(app.getHttpServer())
        .get('/v1/admin/reports/sales')
        .query({ created_at_from: monthsAgo(24).toISOString(), granularity: 'month' }),
    );

    expect(res.status).toBe(200);
    const totalGeneral = res.body.data.reduce(
      (acc: number, r: { total_ars_cents: number }) => acc + r.total_ars_cents,
      0,
    );
    expect(totalGeneral).toBe(50_000);
  });

  it('el rango efectivo devuelto (range.from) queda acotado al piso de retención, no al valor pedido', async () => {
    const pedidoFrom = monthsAgo(24);
    const res = await auth(
      request(app.getHttpServer())
        .get('/v1/admin/reports/summary')
        .query({ created_at_from: pedidoFrom.toISOString() }),
    );

    expect(res.status).toBe(200);
    const from = new Date(res.body.range.from);
    // El from efectivo es MÁS RECIENTE que el pedido (se acotó hacia adelante).
    expect(from.getTime()).toBeGreaterThan(pedidoFrom.getTime());
  });
});
