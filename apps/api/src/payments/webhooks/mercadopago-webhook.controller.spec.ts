import { createHmac } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppConfigModule } from '../../config/config.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { CatalogEventsModule } from '../../observability/catalog-events.module';
import { configureApp } from '../../bootstrap';
import { PrismaService } from '../../prisma/prisma.service';
import { CheckoutModule } from '../../checkout/checkout.module';
import { StockModule } from '../../stock/stock.module';
import { PaymentsModule } from '../payments.module';
import { MercadoPagoClient } from '../mercadopago/mercadopago-client';

const SECRET = 'SECRETO-DE-TEST-NO-REAL';

/**
 * T6.1-T6.3 — el webhook por HTTP, contra Postgres real. `MercadoPagoClient`
 * se overridea con un mock (`getPayment`/`refund`): lo que se prueba es el
 * comportamiento del CONTROLLER (firma, dispatch, siempre-200), no que
 * MercadoPago funcione — eso ya lo prueba `mercadopago-client.spec.ts`.
 */
describe('POST /v1/webhooks/mercadopago (mercadopago-webhook.controller)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mercadoPago: jest.Mocked<Pick<MercadoPagoClient, 'getPayment' | 'refund'>>;
  let categoriaId: string;

  beforeAll(async () => {
    process.env.MP_WEBHOOK_SECRET = SECRET;

    mercadoPago = { getPayment: jest.fn(), refund: jest.fn().mockResolvedValue(undefined) };

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
    categoriaId = (
      await prisma.category.create({ data: { name: 'Refrigeración', slug: 'refrigeracion' } })
    ).id;
  });

  async function sembrarOrdenPendiente(sku: string, stockInicial: number, qty: number) {
    const producto = await prisma.product.create({
      data: {
        sku,
        slug: sku.toLowerCase(),
        name: sku,
        price_ars_cents: 100_000,
        stock: stockInicial,
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

  function firmar(dataId: string, requestId: string, ts: string): string {
    const manifiesto = `id:${dataId};request-id:${requestId};ts:${ts};`;
    return createHmac('sha256', SECRET).update(manifiesto).digest('hex');
  }

  function headersValidos(dataId: string, requestId = 'req-1') {
    const ts = String(Math.floor(Date.now() / 1000));
    const v1 = firmar(dataId, requestId, ts);
    return { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId };
  }

  it('firma inválida → 401, cero queries de escritura (AC-7)', async () => {
    const orden = await sembrarOrdenPendiente('WH-A', 10, 1);

    const antes = await prisma.order.findUniqueOrThrow({ where: { id: orden.id } });

    await request(app.getHttpServer())
      .post('/v1/webhooks/mercadopago')
      .set({ 'x-signature': 'ts=1700000000,v1=firma-invalida', 'x-request-id': 'req-x' })
      .send({ type: 'payment', data: { id: 'mp-1' } })
      .expect(401);

    expect(mercadoPago.getPayment).not.toHaveBeenCalled();
    const despues = await prisma.order.findUniqueOrThrow({ where: { id: orden.id } });
    expect(despues.status).toBe(antes.status);
    expect(despues.updated_at).toEqual(antes.updated_at);
  });

  it('header de firma ausente → 401, cero llamada a MercadoPago', async () => {
    await request(app.getHttpServer())
      .post('/v1/webhooks/mercadopago')
      .send({ type: 'payment', data: { id: 'mp-1' } })
      .expect(401);

    expect(mercadoPago.getPayment).not.toHaveBeenCalled();
  });

  it('pago rechazado (status !== approved) → 200 no-op, orden sigue pending_payment (AC-3)', async () => {
    const orden = await sembrarOrdenPendiente('WH-B', 10, 1);
    mercadoPago.getPayment.mockResolvedValue({
      id: 'mp-2',
      status: 'rejected',
      amountArsCents: 100_000,
      externalReference: orden.id,
    });

    await request(app.getHttpServer())
      .post('/v1/webhooks/mercadopago')
      .set(headersValidos('mp-2'))
      .send({ type: 'payment', data: { id: 'mp-2' } })
      .expect(200, { received: true });

    const ordenEnBase = await prisma.order.findUniqueOrThrow({ where: { id: orden.id } });
    expect(ordenEnBase.status).toBe('pending_payment');
    const productoEnBase = await prisma.product.findFirstOrThrow({ where: { sku: 'WH-B' } });
    expect(productoEnBase.stock).toBe(10);
  });

  it('pago aprobado → confirma la orden, decrementa stock, responde 200 (AC-1)', async () => {
    const orden = await sembrarOrdenPendiente('WH-C', 10, 3);
    mercadoPago.getPayment.mockResolvedValue({
      id: 'mp-3',
      status: 'approved',
      amountArsCents: 300_000,
      externalReference: orden.id,
    });

    await request(app.getHttpServer())
      .post('/v1/webhooks/mercadopago')
      .set(headersValidos('mp-3'))
      .send({ type: 'payment', data: { id: 'mp-3' } })
      .expect(200, { received: true });

    const ordenEnBase = await prisma.order.findUniqueOrThrow({ where: { id: orden.id } });
    expect(ordenEnBase.status).toBe('new');
    const productoEnBase = await prisma.product.findFirstOrThrow({ where: { sku: 'WH-C' } });
    expect(productoEnBase.stock).toBe(7);
    const pago = await prisma.payment.findFirstOrThrow({ where: { order_id: orden.id } });
    expect(pago.provider).toBe('mercadopago');
  });

  it('webhook duplicado (orden ya new) → 200, NO modifica stock ni estado (T6.2)', async () => {
    const orden = await sembrarOrdenPendiente('WH-D', 10, 2);
    mercadoPago.getPayment.mockResolvedValue({
      id: 'mp-4',
      status: 'approved',
      amountArsCents: 200_000,
      externalReference: orden.id,
    });

    await request(app.getHttpServer())
      .post('/v1/webhooks/mercadopago')
      .set(headersValidos('mp-4'))
      .send({ type: 'payment', data: { id: 'mp-4' } })
      .expect(200);

    // segundo webhook, mismo pago ya confirmado (duplicado/reintento de MP)
    await request(app.getHttpServer())
      .post('/v1/webhooks/mercadopago')
      .set(headersValidos('mp-4', 'req-2'))
      .send({ type: 'payment', data: { id: 'mp-4' } })
      .expect(200, { received: true });

    const productoEnBase = await prisma.product.findFirstOrThrow({ where: { sku: 'WH-D' } });
    expect(productoEnBase.stock).toBe(8); // sólo decrementó UNA vez
  });

  it('external_reference inexistente → 200, no crashea (anomalía logueada, T6.2)', async () => {
    mercadoPago.getPayment.mockResolvedValue({
      id: 'mp-5',
      status: 'approved',
      amountArsCents: 100_000,
      externalReference: '00000000-0000-0000-0000-000000000000',
    });

    await request(app.getHttpServer())
      .post('/v1/webhooks/mercadopago')
      .set(headersValidos('mp-5'))
      .send({ type: 'payment', data: { id: 'mp-5' } })
      .expect(200, { received: true });
  });

  it('sin ningún throttler: N+1 requests rápidas no devuelven 429', async () => {
    mercadoPago.getPayment.mockResolvedValue({
      id: 'mp-6',
      status: 'rejected',
      amountArsCents: 100_000,
    });

    for (let i = 0; i < 15; i += 1) {
      await request(app.getHttpServer())
        .post('/v1/webhooks/mercadopago')
        .set(headersValidos('mp-6', `req-burst-${i}`))
        .send({ type: 'payment', data: { id: 'mp-6' } })
        .expect(200);
    }
  });
});
