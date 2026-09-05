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
 * T14.3 — el mismo webhook (mismo `data.id`) llega dos veces, y también
 * "tarde" (después de que la orden ya está `new`). Sólo la PRIMERA
 * aplicación efectiva cambia el estado. AC-5/AC-6.
 */
describe('e2e-payments-webhook-duplicate', () => {
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

  function headersValidos(dataId: string, requestId: string) {
    const ts = String(Math.floor(Date.now() / 1000));
    const manifiesto = `id:${dataId};request-id:${requestId};ts:${ts};`;
    const v1 = createHmac('sha256', SECRET).update(manifiesto).digest('hex');
    return { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId };
  }

  async function sembrarOrden(sku: string) {
    const categoria = await prisma.category.create({
      data: { name: `Cat-${sku}`, slug: `cat-${sku.toLowerCase()}` },
    });
    const producto = await prisma.product.create({
      data: {
        sku,
        slug: sku.toLowerCase(),
        name: sku,
        price_ars_cents: 100_000,
        stock: 10,
        status: 'published',
        category_id: categoria.id,
      },
    });
    const orden = await prisma.order.create({
      data: {
        access_token_hash: `h-${sku}`,
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
              product_name: sku,
              product_sku: sku,
            },
          ],
        },
      },
    });
    return { orden, producto };
  }

  it('el mismo webhook enviado DOS veces sólo decrementa stock una vez, una sola fila en payments', async () => {
    const { orden, producto } = await sembrarOrden('DUP-A');
    mercadoPago.getPayment.mockResolvedValue({
      id: 'mp-dup-1',
      status: 'approved',
      amountArsCents: 100_000,
      externalReference: orden.id,
    });

    for (let i = 0; i < 2; i += 1) {
      await request(app.getHttpServer())
        .post('/v1/webhooks/mercadopago')
        .set(headersValidos('mp-dup-1', `req-dup-${i}`))
        .send({ type: 'payment', data: { id: 'mp-dup-1' } })
        .expect(200, { received: true });
    }

    const productoEnBase = await prisma.product.findUniqueOrThrow({ where: { id: producto.id } });
    expect(productoEnBase.stock).toBe(9); // decrementó UNA sola vez

    const pagos = await prisma.payment.findMany({ where: { order_id: orden.id } });
    expect(pagos).toHaveLength(1);
    expect(pagos[0].idempotency_key).toBe('mercadopago:mp-dup-1');
  });

  it('un webhook "tardío" tras la confirmación real no reabre ni modifica nada (AC-6)', async () => {
    const { orden, producto } = await sembrarOrden('DUP-B');
    mercadoPago.getPayment.mockResolvedValue({
      id: 'mp-dup-2',
      status: 'approved',
      amountArsCents: 100_000,
      externalReference: orden.id,
    });

    // Primer webhook: confirma de verdad.
    await request(app.getHttpServer())
      .post('/v1/webhooks/mercadopago')
      .set(headersValidos('mp-dup-2', 'req-first'))
      .send({ type: 'payment', data: { id: 'mp-dup-2' } })
      .expect(200);

    const productoTrasPrimero = await prisma.product.findUniqueOrThrow({
      where: { id: producto.id },
    });
    expect(productoTrasPrimero.stock).toBe(9);

    // Webhook "tardío": llega después, mismo pago — no debe volver a tocar nada.
    await request(app.getHttpServer())
      .post('/v1/webhooks/mercadopago')
      .set(headersValidos('mp-dup-2', 'req-late'))
      .send({ type: 'payment', data: { id: 'mp-dup-2' } })
      .expect(200, { received: true });

    const productoEnBase = await prisma.product.findUniqueOrThrow({ where: { id: producto.id } });
    expect(productoEnBase.stock).toBe(9); // sin cambios respecto al primero
    const ordenEnBase = await prisma.order.findUniqueOrThrow({ where: { id: orden.id } });
    expect(ordenEnBase.status).toBe('new'); // sin reabrir
  });
});
