import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { adminToken, bootTestApp } from '../../test/e2e-app';
import { PrismaService } from '../prisma/prisma.service';
import { CheckoutModule } from '../checkout/checkout.module';
import { StockModule } from '../stock/stock.module';
import { PaymentsModule } from './payments.module';

/**
 * T9.2 — `POST /v1/admin/payments/reconcile`, contra Postgres real (sin
 * MercadoPagoClient overrideado: sin órdenes viejas que reconciliar, nunca
 * llama a `fetch`).
 */
describe('POST /v1/admin/payments/reconcile (admin-jobs.controller)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await bootTestApp([CheckoutModule, StockModule, PaymentsModule]);
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE payments, orders, order_items, products, categories RESTART IDENTITY CASCADE',
    );
  });

  it('sin token admin → 401', async () => {
    await request(app.getHttpServer()).post('/v1/admin/payments/reconcile').expect(401);
  });

  it('con token admin → 200, resumen {scanned, confirmed, stillPending} (sin candidatas)', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/admin/payments/reconcile')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ scanned: 0, confirmed: 0, stillPending: 0 });
  });
});

describe('POST /v1/admin/orders/cleanup-abandoned (admin-jobs.controller, T10.2)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await bootTestApp([CheckoutModule, StockModule, PaymentsModule]);
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE payments, orders, order_items, products, categories RESTART IDENTITY CASCADE',
    );
  });

  it('sin token admin → 401', async () => {
    await request(app.getHttpServer()).post('/v1/admin/orders/cleanup-abandoned').expect(401);
  });

  it('con token admin → 200, {cancelled: N} con el conteo real de filas afectadas', async () => {
    const categoria = await prisma.category.create({
      data: { name: 'Refrigeración', slug: 'refrigeracion' },
    });
    const producto = await prisma.product.create({
      data: {
        sku: 'ADMJ-A',
        slug: 'admj-a',
        name: 'ADMJ-A',
        price_ars_cents: 100_000,
        stock: 5,
        status: 'published',
        category_id: categoria.id,
      },
    });
    const orden = await prisma.order.create({
      data: {
        access_token_hash: 'h-admj-a',
        buyer_name: 'Juana Pérez',
        buyer_email: 'juana@test.local',
        buyer_phone: '+54 351 555 0000',
        total_ars_cents: 100_000,
        consent_accepted: true,
        consent_accepted_at: new Date(),
        consent_terms_version: '2026-06-15',
        items: {
          create: [
            {
              product_id: producto.id,
              quantity: 1,
              unit_price_ars_cents: 100_000,
              product_name: 'ADMJ-A',
              product_sku: 'ADMJ-A',
            },
          ],
        },
      },
    });
    await prisma.order.update({
      where: { id: orden.id },
      data: { created_at: new Date(Date.now() - 49 * 3_600_000) }, // 49h > default 48h
    });

    const res = await request(app.getHttpServer())
      .post('/v1/admin/orders/cleanup-abandoned')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ cancelled: 1 });
    const ordenEnBase = await prisma.order.findUniqueOrThrow({ where: { id: orden.id } });
    expect(ordenEnBase.status).toBe('cancelled');
  });
});

describe('POST /v1/admin/payments/retry-refunds (admin-jobs.controller, T11.2)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await bootTestApp([CheckoutModule, StockModule, PaymentsModule]);
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE payments, orders, order_items, products, categories RESTART IDENTITY CASCADE',
    );
  });

  it('sin token admin → 401', async () => {
    await request(app.getHttpServer()).post('/v1/admin/payments/retry-refunds').expect(401);
  });

  it('con token admin → 200, {attempted, succeeded, failed} reflejando el resultado real (sin candidatos)', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/admin/payments/retry-refunds')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ attempted: 0, succeeded: 0, failed: 0 });
  });
});
