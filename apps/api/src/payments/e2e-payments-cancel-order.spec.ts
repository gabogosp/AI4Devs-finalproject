import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { adminToken } from '../../test/e2e-app';
import { AppConfigModule } from '../config/config.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CatalogEventsModule } from '../observability/catalog-events.module';
import { configureApp } from '../bootstrap';
import { PrismaService } from '../prisma/prisma.service';
import { CheckoutModule } from '../checkout/checkout.module';
import { StockModule } from '../stock/stock.module';
import { PaymentsModule } from './payments.module';
import { MercadoPagoClient } from './mercadopago/mercadopago-client';

/**
 * T8.1 — capa HTTP que `cancel-order.service.spec.ts` (T5.2) no ejercita:
 * status codes exactos vía `HttpProblemFilter`, shape JSON de la respuesta
 * 200 (incluye `refund`), y que `changedBy` sale del JWT `sub` del token
 * admin de test (no de ningún campo del body — no hay body). Mismo armazón
 * que `e2e-payments-mercadopago-happy.spec.ts`.
 */
describe('e2e-payments-cancel-order (US-013 T8.1)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mercadoPago: jest.Mocked<Pick<MercadoPagoClient, 'refund'>>;
  let categoriaId: string;

  beforeAll(async () => {
    mercadoPago = { refund: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      imports: [
        AppConfigModule,
        PrismaModule,
        CatalogEventsModule,
        CheckoutModule,
        StockModule,
        PaymentsModule,
      ],
    })
      .overrideProvider(MercadoPagoClient)
      .useValue(mercadoPago)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(async () => {
    jest.clearAllMocks();
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE payments, order_status_history, orders, order_items, products, categories RESTART IDENTITY CASCADE',
    );
    categoriaId = (
      await prisma.category.create({ data: { name: 'Refrigeración', slug: 'refrigeracion' } })
    ).id;
  });

  async function sembrarOrdenConEstado(sku: string, qty: number, status: string) {
    const producto = await prisma.product.create({
      data: {
        sku,
        slug: sku.toLowerCase(),
        name: sku,
        price_ars_cents: 100_000,
        stock: 10,
        status: 'published',
        category_id: categoriaId,
      },
    });
    return prisma.order.create({
      data: {
        access_token_hash: `h-${sku}`,
        buyer_name: 'Juana Pérez',
        buyer_email: 'juana@test.local',
        buyer_phone: '+54 351 555 0000',
        total_ars_cents: qty * 100_000,
        status,
        consent_accepted: true,
        consent_accepted_at: new Date(),
        consent_terms_version: '2026-06-15',
        items: {
          create: [
            {
              product_id: producto.id,
              quantity: qty,
              unit_price_ars_cents: 100_000,
              product_name: sku,
              product_sku: sku,
            },
          ],
        },
      },
    });
  }

  it('200 con refund.status correcto en el happy path mercadopago, changedBy sale del JWT admin', async () => {
    const orden = await sembrarOrdenConEstado('E2E-CANC-A', 2, 'new');
    await prisma.payment.create({
      data: {
        order_id: orden.id,
        provider: 'mercadopago',
        status: 'approved',
        external_id: 'mp-e2e-1',
        amount_ars_cents: 200_000,
        idempotency_key: 'mercadopago:mp-e2e-1',
        processed_at: new Date(),
      },
    });

    const res = await request(app.getHttpServer())
      .post(`/v1/admin/orders/${orden.id}/cancel`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
    expect(res.body.refund).toEqual({ status: 'refunded', provider: 'mercadopago' });
    expect(mercadoPago.refund).toHaveBeenCalledWith('mp-e2e-1', 200_000);

    const historial = await prisma.orderStatusHistory.findFirstOrThrow({
      where: { order_id: orden.id },
    });
    expect(historial.changed_by).toBe('admin'); // sub del JWT de test (adminToken())
  });

  it('404 dsm:payments/order-not-found sobre una orden inexistente', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/admin/orders/00000000-0000-0000-0000-000000000000/cancel')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send();

    expect(res.status).toBe(404);
    expect(res.body.type).toBe('dsm:payments/order-not-found');
  });

  it('409 dsm:payments/order-cannot-be-cancelled sobre una orden delivered', async () => {
    const orden = await sembrarOrdenConEstado('E2E-CANC-B', 1, 'delivered');

    const res = await request(app.getHttpServer())
      .post(`/v1/admin/orders/${orden.id}/cancel`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send();

    expect(res.status).toBe(409);
    expect(res.body.type).toBe('dsm:payments/order-cannot-be-cancelled');
  });
});
