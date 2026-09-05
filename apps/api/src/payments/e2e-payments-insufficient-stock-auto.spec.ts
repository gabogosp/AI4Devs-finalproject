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
import { NOTIFICATION_PORT, NotificationPort } from '../orders/ports/notification.port';
import { PaymentsModule } from './payments.module';
import { MercadoPagoClient } from './mercadopago/mercadopago-client';

const SECRET = 'SECRETO-DE-TEST-NO-REAL';

/**
 * T14.2 — mismo flujo que T14.1, pero con stock insuficiente en un ítem.
 * Prueba explícitamente que NINGÚN ítem decrementó (rollback completo, no
 * sólo el que falló). AC-4.
 */
describe('e2e-payments-insufficient-stock-auto', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mercadoPago: jest.Mocked<Pick<MercadoPagoClient, 'getPayment' | 'refund'>>;
  let notifications: jest.Mocked<NotificationPort>;

  beforeAll(async () => {
    process.env.MP_WEBHOOK_SECRET = SECRET;
    mercadoPago = {
      getPayment: jest.fn(),
      refund: jest.fn().mockResolvedValue(undefined),
    };
    notifications = {
      orderReadyForPickup: jest.fn().mockResolvedValue(undefined),
      orderConfirmed: jest.fn().mockResolvedValue(undefined),
      ownerNewOrder: jest.fn().mockResolvedValue(undefined),
      orderCancelledNoStock: jest.fn().mockResolvedValue(undefined),
    };

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
      .overrideProvider(NOTIFICATION_PORT)
      .useValue(notifications)
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
    const requestId = 'req-nostock';
    const manifiesto = `id:${dataId};request-id:${requestId};ts:${ts};`;
    const v1 = createHmac('sha256', SECRET).update(manifiesto).digest('hex');
    return { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId };
  }

  it('cancela la orden, refund_pending → refunded, orderCancelledNoStock una vez, NINGÚN ítem decrementó', async () => {
    const categoria = await prisma.category.create({
      data: { name: 'Refrigeración', slug: 'refrigeracion' },
    });
    // A tiene stock de sobra; B tiene sólo 1 unidad y la orden pide 2 —
    // el ítem QUE FALLA es B, pero A no debe quedar decrementado tampoco.
    const productoA = await prisma.product.create({
      data: {
        sku: 'NOSTOCK-A',
        slug: 'nostock-a',
        name: 'NOSTOCK-A',
        price_ars_cents: 100_000,
        stock: 10,
        status: 'published',
        category_id: categoria.id,
      },
    });
    const productoB = await prisma.product.create({
      data: {
        sku: 'NOSTOCK-B',
        slug: 'nostock-b',
        name: 'NOSTOCK-B',
        price_ars_cents: 100_000,
        stock: 1,
        status: 'published',
        category_id: categoria.id,
      },
    });
    const orden = await prisma.order.create({
      data: {
        access_token_hash: 'h-nostock',
        buyer_name: 'Juana Pérez',
        buyer_email: 'juana@test.local',
        buyer_phone: '+54 351 555 0000',
        total_ars_cents: 400_000,
        consent_accepted: true,
        consent_accepted_at: new Date(),
        consent_terms_version: '2026-06-15',
        items: {
          create: [
            {
              product_id: productoA.id,
              quantity: 2,
              unit_price_ars_cents: 100_000,
              product_name: 'NOSTOCK-A',
              product_sku: 'NOSTOCK-A',
            },
            {
              product_id: productoB.id,
              quantity: 2, // pide 2, sólo hay 1 — falla acá
              unit_price_ars_cents: 100_000,
              product_name: 'NOSTOCK-B',
              product_sku: 'NOSTOCK-B',
            },
          ],
        },
      },
    });
    mercadoPago.getPayment.mockResolvedValue({
      id: 'mp-nostock-1',
      status: 'approved',
      amountArsCents: 400_000,
      externalReference: orden.id,
    });

    await request(app.getHttpServer())
      .post('/v1/webhooks/mercadopago')
      .set(headersValidos('mp-nostock-1'))
      .send({ type: 'payment', data: { id: 'mp-nostock-1' } })
      .expect(200, { received: true });

    const ordenEnBase = await prisma.order.findUniqueOrThrow({ where: { id: orden.id } });
    expect(ordenEnBase.status).toBe('cancelled');
    expect(ordenEnBase.cancelled_at).not.toBeNull();

    const productoAEnBase = await prisma.product.findUniqueOrThrow({ where: { id: productoA.id } });
    const productoBEnBase = await prisma.product.findUniqueOrThrow({ where: { id: productoB.id } });
    expect(productoAEnBase.stock).toBe(10); // el que NO falló tampoco decrementó
    expect(productoBEnBase.stock).toBe(1);

    const pago = await prisma.payment.findFirstOrThrow({ where: { order_id: orden.id } });
    expect(pago.status).toBe('refunded'); // refund_pending → refunded (mock exitoso)

    expect(notifications.orderCancelledNoStock).toHaveBeenCalledTimes(1);
    expect(notifications.orderCancelledNoStock).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: orden.id }),
    );
  });
});
