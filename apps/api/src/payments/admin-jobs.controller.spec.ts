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
