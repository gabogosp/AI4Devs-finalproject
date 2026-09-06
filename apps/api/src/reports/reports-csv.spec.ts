import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { adminToken, bootTestApp } from '../../test/e2e-app';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsModule } from './reports.module';
import { buildSalesCsv, buildSummaryCsv, buildTopProductsCsv, reportsFilename } from './csv/reports-csv';

/**
 * T7.5 — AC-6/AC-9: `GET /v1/admin/reports/top-products/export` con un
 * `order_items.product_name` que empieza con `=` nunca llega crudo al CSV
 * (`design.md §D3/§D9`, mismo vector que `security-standards.md §6.3`).
 */
describe('AC-6 — CSV neutralizado contra inyección de fórmulas (e2e-reports)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const auth = (req: request.Test) => req.set('Authorization', `Bearer ${adminToken()}`);
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
  });

  it("un product_name que empieza con '=' se escribe con comilla, nunca crudo", async () => {
    const cat = await prisma.category.create({
      data: { name: 'Reports CSV', slug: 'reports-csv-injection' },
    });
    const producto = await prisma.product.create({
      data: {
        sku: 'RPT-CSV',
        slug: 'reports-csv-producto',
        name: "=cmd|'/c calc'!A1",
        price_ars_cents: 10_000,
        stock: 10,
        status: 'published',
        category_id: cat.id,
      },
    });
    const order = await prisma.order.create({
      data: {
        access_token_hash: 'h-reports-csv-injection',
        buyer_name: 'Comprador de Prueba',
        buyer_email: 'comprador-reports-csv@test.local',
        buyer_phone: '+54 351 555 0000',
        total_ars_cents: 10_000,
        consent_accepted: true,
        consent_accepted_at: new Date(),
        consent_terms_version: '2026-06-15',
        status: 'pending_payment',
        created_at: new Date('2026-08-15T10:00:00.000Z'),
        items: {
          create: [
            {
              product_id: producto.id,
              quantity: 1,
              unit_price_ars_cents: 10_000,
              product_name: "=cmd|'/c calc'!A1",
              product_sku: 'RPT-CSV',
            },
          ],
        },
      },
    });
    await prisma.order.update({ where: { id: order.id }, data: { status: 'new' } });

    const res = await auth(
      request(app.getHttpServer()).get('/v1/admin/reports/top-products/export').query(RANGE),
    );

    expect(res.status).toBe(200);
    expect(res.text).toContain("'=cmd|'/c calc'!A1");
    const arrancaConFormula = res.text
      .split('\n')
      .slice(1)
      .filter((linea) => linea.length > 0)
      .some((linea) => /^[=+@]/.test(linea));
    expect(arrancaConFormula).toBe(false);
  });
});

/** Unit — los 3 builders CSV, formateo y filename (`design.md §D4`). */
describe('reports-csv builders (unit)', () => {
  it('buildSalesCsv: header + una fila por período', () => {
    const csv = buildSalesCsv([
      { period_date: new Date('2026-08-05T00:00:00.000Z'), orders_count: 2, total_ars_cents: 5000 },
    ]);
    expect(csv).toBe('period_date,orders_count,total_ars_cents\n2026-08-05,2,5000\n');
  });

  it('buildTopProductsCsv: neutraliza product_name/product_sku contra fórmulas', () => {
    const csv = buildTopProductsCsv([
      {
        product_id: 'p1',
        product_name: '=1+1',
        product_sku: '@SKU',
        quantity_sold: 3,
        revenue_ars_cents: 9000,
      },
    ]);
    expect(csv).toContain("p1,'=1+1,'@SKU,3,9000");
  });

  it('buildSummaryCsv: una fila por estado + fila total', () => {
    const csv = buildSummaryCsv({
      orders_count: 1,
      total_ars_cents: 100,
      breakdown_by_status: {
        new: { count: 1, total_ars_cents: 100 },
        preparing: { count: 0, total_ars_cents: 0 },
        ready: { count: 0, total_ars_cents: 0 },
        delivered: { count: 0, total_ars_cents: 0 },
      },
    });
    expect(csv.split('\n')).toEqual([
      'status,count,total_ars_cents',
      'new,1,100',
      'preparing,0,0',
      'ready,0,0',
      'delivered,0,0',
      'total,1,100',
      '',
    ]);
  });

  it('reportsFilename: reports-{dataset}-{from}-{to}.csv', () => {
    expect(
      reportsFilename('sales', new Date('2026-08-01T00:00:00.000Z'), new Date('2026-08-31T00:00:00.000Z')),
    ).toBe('reports-sales-2026-08-01-2026-08-31.csv');
  });
});
