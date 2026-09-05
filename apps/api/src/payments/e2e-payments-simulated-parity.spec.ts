import { createHmac } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppConfigModule } from '../config/config.module';
import { validateEnv } from '../config/env.validation';
import { PrismaModule } from '../prisma/prisma.module';
import { CatalogEventsModule } from '../observability/catalog-events.module';
import { configureApp } from '../bootstrap';
import { PrismaService } from '../prisma/prisma.service';
import { CheckoutModule } from '../checkout/checkout.module';
import { StockModule } from '../stock/stock.module';
import { OrderTokenService } from '../checkout/order-token.service';
import { PaymentsModule } from './payments.module';
import { MercadoPagoClient } from './mercadopago/mercadopago-client';

const SECRET = 'SECRETO-DE-TEST-NO-REAL';

/**
 * T14.5 — corre el MISMO caso (happy path) una vez con `provider:
 * 'mercadopago'` (webhook, `MercadoPagoClient` mockeado) y otra con
 * `provider: 'simulated_dsm'` (`POST /v1/checkout/simulate-payment`
 * end-to-end, SIN ningún mock de red) y compara el resultado final —
 * prueba, no supone, que AC-9 es real.
 */
describe('e2e-payments-simulated-parity', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mercadoPago: jest.Mocked<Pick<MercadoPagoClient, 'getPayment' | 'refund'>>;

  function crearConfig(overrides: Record<string, string>): ConfigService {
    const validado = validateEnv({ ...process.env, ...overrides });
    return new ConfigService({ _PROCESS_ENV_VALIDATED: validado }) as ConfigService;
  }

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
      .overrideProvider(ConfigService)
      .useValue(crearConfig({ PAYMENTS_SIMULATED_ENABLED: 'true' }))
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

  async function sembrarOrdenPendiente(sku: string, stockInicial: number, qty: number) {
    const categoria = await prisma.category.create({
      data: { name: `Cat-${sku}`, slug: `cat-${sku.toLowerCase()}` },
    });
    const producto = await prisma.product.create({
      data: {
        sku,
        slug: sku.toLowerCase(),
        name: sku,
        price_ars_cents: 100_000,
        stock: stockInicial,
        status: 'published',
        category_id: categoria.id,
      },
    });
    const tokens = new OrderTokenService();
    const { token, tokenHash } = tokens.issue();
    const orden = await prisma.order.create({
      data: {
        access_token_hash: tokenHash,
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
    return { orden, producto, token };
  }

  function headersValidos(dataId: string) {
    const ts = String(Math.floor(Date.now() / 1000));
    const requestId = 'req-parity';
    const manifiesto = `id:${dataId};request-id:${requestId};ts:${ts};`;
    const v1 = createHmac('sha256', SECRET).update(manifiesto).digest('hex');
    return { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId };
  }

  it('mercadopago (webhook) y simulated_dsm (simulate-payment) llegan al MISMO resultado estructural', async () => {
    // --- Camino mercadopago ---
    const mp = await sembrarOrdenPendiente('PARITY-MP', 10, 2);
    mercadoPago.getPayment.mockResolvedValue({
      id: 'mp-parity-1',
      status: 'approved',
      amountArsCents: 200_000,
      externalReference: mp.orden.id,
    });
    await request(app.getHttpServer())
      .post('/v1/webhooks/mercadopago')
      .set(headersValidos('mp-parity-1'))
      .send({ type: 'payment', data: { id: 'mp-parity-1' } })
      .expect(200);

    // --- Camino simulated_dsm (misma forma de orden, sin ningún mock de red) ---
    const sim = await sembrarOrdenPendiente('PARITY-SIM', 10, 2);
    await request(app.getHttpServer())
      .post('/v1/checkout/simulate-payment')
      .send({ order_token: sim.token })
      .expect(200);

    const ordenMp = await prisma.order.findUniqueOrThrow({ where: { id: mp.orden.id } });
    const ordenSim = await prisma.order.findUniqueOrThrow({ where: { id: sim.orden.id } });
    expect(ordenMp.status).toBe(ordenSim.status);
    expect(ordenMp.status).toBe('new');
    expect(ordenMp.confirmed_at).not.toBeNull();
    expect(ordenSim.confirmed_at).not.toBeNull();

    const productoMp = await prisma.product.findUniqueOrThrow({ where: { id: mp.producto.id } });
    const productoSim = await prisma.product.findUniqueOrThrow({ where: { id: sim.producto.id } });
    expect(productoMp.stock).toBe(productoSim.stock);
    expect(productoMp.stock).toBe(8);

    const pagoMp = await prisma.payment.findFirstOrThrow({ where: { order_id: mp.orden.id } });
    const pagoSim = await prisma.payment.findFirstOrThrow({ where: { order_id: sim.orden.id } });
    expect(pagoMp.status).toBe(pagoSim.status);
    expect(pagoMp.status).toBe('approved');
    expect(pagoMp.provider).toBe('mercadopago');
    expect(pagoSim.provider).toBe('simulated_dsm'); // única diferencia estructural esperada
  });

  it('insuficiente-stock: mercadopago y simulated_dsm llegan al MISMO resultado (cancelled + refund_pending→refunded)', async () => {
    const mp = await sembrarOrdenPendiente('PARITY-MP-NS', 1, 2); // pide 2, hay 1
    mercadoPago.getPayment.mockResolvedValue({
      id: 'mp-parity-2',
      status: 'approved',
      amountArsCents: 200_000,
      externalReference: mp.orden.id,
    });
    mercadoPago.refund.mockResolvedValue(undefined);
    await request(app.getHttpServer())
      .post('/v1/webhooks/mercadopago')
      .set(headersValidos('mp-parity-2'))
      .send({ type: 'payment', data: { id: 'mp-parity-2' } })
      .expect(200);

    const sim = await sembrarOrdenPendiente('PARITY-SIM-NS', 1, 2);
    await request(app.getHttpServer())
      .post('/v1/checkout/simulate-payment')
      .send({ order_token: sim.token })
      .expect(409);

    const ordenMp = await prisma.order.findUniqueOrThrow({ where: { id: mp.orden.id } });
    const ordenSim = await prisma.order.findUniqueOrThrow({ where: { id: sim.orden.id } });
    expect(ordenMp.status).toBe('cancelled');
    expect(ordenSim.status).toBe('cancelled');

    const pagoMp = await prisma.payment.findFirstOrThrow({ where: { order_id: mp.orden.id } });
    const pagoSim = await prisma.payment.findFirstOrThrow({ where: { order_id: sim.orden.id } });
    expect(pagoMp.status).toBe('refunded'); // mock de refund exitoso
    expect(pagoSim.status).toBe('refunded'); // simulated_dsm: markRefunded directo, sin red
  });
});
