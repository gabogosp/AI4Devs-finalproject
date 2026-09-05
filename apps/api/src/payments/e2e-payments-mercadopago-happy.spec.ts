import { createHmac } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppConfigModule } from '../config/config.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CatalogEventsModule } from '../observability/catalog-events.module';
import { configureApp } from '../bootstrap';
import { PrismaService } from '../prisma/prisma.service';
import { CheckoutModule } from '../checkout/checkout.module';
import { StockModule } from '../stock/stock.module';
import { PaymentsModule } from './payments.module';
import { MercadoPagoClient } from './mercadopago/mercadopago-client';

const SECRET = 'SECRETO-DE-TEST-NO-REAL';

/**
 * T14.1 — secuencia COMPLETA contra Postgres real: webhook con firma válida
 * + `getPayment` mockeado `approved` sobre una orden `pending_payment` con
 * stock suficiente. AC-1.
 */
describe('e2e-payments-mercadopago-happy', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mercadoPago: jest.Mocked<Pick<MercadoPagoClient, 'getPayment' | 'refund'>>;

  beforeAll(async () => {
    process.env.MP_WEBHOOK_SECRET = SECRET;
    mercadoPago = { getPayment: jest.fn(), refund: jest.fn() };

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
    delete process.env.MP_WEBHOOK_SECRET;
  });
  beforeEach(async () => {
    jest.clearAllMocks();
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE payments, orders, order_items, products, categories RESTART IDENTITY CASCADE',
    );
  });

  function headersValidos(dataId: string) {
    const ts = String(Math.floor(Date.now() / 1000));
    const requestId = 'req-happy';
    const manifiesto = `id:${dataId};request-id:${requestId};ts:${ts};`;
    const v1 = createHmac('sha256', SECRET).update(manifiesto).digest('hex');
    return { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId };
  }

  it('confirma la orden, decrementa stock, y el pago queda approved con idempotency_key correcto', async () => {
    const categoria = await prisma.category.create({
      data: { name: 'Refrigeración', slug: 'refrigeracion' },
    });
    const producto = await prisma.product.create({
      data: {
        sku: 'HAPPY-A',
        slug: 'happy-a',
        name: 'HAPPY-A',
        price_ars_cents: 100_000,
        stock: 10,
        status: 'published',
        category_id: categoria.id,
      },
    });
    const orden = await prisma.order.create({
      data: {
        access_token_hash: 'h-happy-a',
        buyer_name: 'Juana Pérez',
        buyer_email: 'juana@test.local',
        buyer_phone: '+54 351 555 0000',
        total_ars_cents: 300_000,
        consent_accepted: true,
        consent_accepted_at: new Date(),
        consent_terms_version: '2026-06-15',
        items: {
          create: [
            {
              product_id: producto.id,
              quantity: 3,
              unit_price_ars_cents: 100_000,
              product_name: 'HAPPY-A',
              product_sku: 'HAPPY-A',
            },
          ],
        },
      },
    });
    mercadoPago.getPayment.mockResolvedValue({
      id: 'mp-happy-1',
      status: 'approved',
      amountArsCents: 300_000,
      externalReference: orden.id,
    });

    await request(app.getHttpServer())
      .post('/v1/webhooks/mercadopago')
      .set(headersValidos('mp-happy-1'))
      .send({ type: 'payment', data: { id: 'mp-happy-1' } })
      .expect(200, { received: true });

    const ordenEnBase = await prisma.order.findUniqueOrThrow({ where: { id: orden.id } });
    expect(ordenEnBase.status).toBe('new');
    expect(ordenEnBase.confirmed_at).not.toBeNull();

    const productoEnBase = await prisma.product.findUniqueOrThrow({ where: { id: producto.id } });
    expect(productoEnBase.stock).toBe(7);

    const pago = await prisma.payment.findFirstOrThrow({ where: { order_id: orden.id } });
    expect(pago.provider).toBe('mercadopago');
    expect(pago.status).toBe('approved');
    expect(pago.idempotency_key).toBe('mercadopago:mp-happy-1');
  });
});
