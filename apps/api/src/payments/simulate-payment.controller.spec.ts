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

const LIMITE = Number(process.env.PAYMENTS_SIMULATE_RATE_LIMIT_MAX ?? 10);

/**
 * T7.1-T7.3 — `POST /v1/checkout/simulate-payment`, contra Postgres real.
 * Nunca llama a `MercadoPagoClient` (provider siempre `simulated_dsm`) — no
 * hace falta overridearlo.
 *
 * `ConfigService` se overridea con una instancia propia (mismo criterio que
 * `ai.providers.spec.ts`): `AppConfigModule` valida `process.env` una única
 * vez por proceso de Jest, en el `import` (decorador `@Module`, evaluado al
 * cargar el archivo) — no en cada `Test.createTestingModule().compile()`.
 * Mutar `process.env.PAYMENTS_SIMULATED_ENABLED` en un `beforeAll` llega
 * tarde: el snapshot validado ya quedó congelado con el valor que tenía la
 * PRIMERA vez que `config.module.ts` se importó en este worker.
 *
 * `new ConfigService({...process.env})` a secas NO alcanza: `ConfigService.get()`
 * revisa el `process.env` VIVO (prioridad 2) antes que el `internalConfig` de la
 * instancia (prioridad 3) — y ese `process.env` vivo ya quedó contaminado con los
 * valores validados de OTROS tests, pero como STRING crudo (`assignVariablesToProcess`,
 * ver `configNumber`). `_PROCESS_ENV_VALIDATED` es la clave interna que
 * `ConfigModule.forRoot()` usa para la prioridad 1 (`getFromValidatedEnv`, la que
 * siempre gana) — se llena a mano con el resultado de `validateEnv` propio, con la
 * misma coerción (`z.coerce.number()`, etc.) que produciría el arranque real.
 */
function crearConfig(overrides: Record<string, string>): ConfigService {
  const validado = validateEnv({ ...process.env, ...overrides });
  return new ConfigService({ _PROCESS_ENV_VALIDATED: validado }) as ConfigService;
}

async function bootConVariante(flagOn: boolean): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppConfigModule, PrismaModule, CatalogEventsModule, CheckoutModule, StockModule, PaymentsModule],
  })
    .overrideProvider(ConfigService)
    .useValue(crearConfig({ PAYMENTS_SIMULATED_ENABLED: flagOn ? 'true' : 'false' }))
    .compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}

describe('POST /v1/checkout/simulate-payment (simulate-payment.controller)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let categoriaId: string;

  beforeAll(async () => {
    process.env.TRUST_PROXY_HOPS = '1';
    app = await bootConVariante(true);
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app?.close();
    delete process.env.TRUST_PROXY_HOPS;
  });
  beforeEach(async () => {
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
    return { orden, token };
  }

  it('order_token válido de una pending_payment → 200, confirma y decrementa stock (AC-9)', async () => {
    const { orden, token } = await sembrarOrdenPendiente('SIM-A', 10, 2);

    const res = await request(app.getHttpServer())
      .post('/v1/checkout/simulate-payment')
      .send({ order_token: token });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('new');

    const ordenEnBase = await prisma.order.findUniqueOrThrow({ where: { id: orden.id } });
    expect(ordenEnBase.status).toBe('new');
    const productoEnBase = await prisma.product.findFirstOrThrow({ where: { sku: 'SIM-A' } });
    expect(productoEnBase.stock).toBe(8);
    const pago = await prisma.payment.findFirstOrThrow({ where: { order_id: orden.id } });
    expect(pago.provider).toBe('simulated_dsm');
  });

  it('order_token que no matchea ninguna orden → 404', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/checkout/simulate-payment')
      .send({ order_token: 'a'.repeat(64) });

    expect(res.status).toBe(404);
  });

  it('order_token con formato inválido → 422 (DTO)', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/checkout/simulate-payment')
      .send({ order_token: 'no-es-hex' });

    expect(res.status).toBe(422);
  });
});

describe('POST /v1/checkout/simulate-payment — rate limit (T7.3)', () => {
  // App PROPIA: el throttler cuenta por (IP + ruta) dentro de la ventana, y
  // compartir la instancia con otros tests consumiría presupuesto antes de
  // que este test arranque su propio conteo — mismo criterio que
  // `e2e-checkout-ratelimit.spec.ts`.
  let app: INestApplication;

  beforeAll(async () => {
    app = await bootConVariante(true);
  });
  afterAll(async () => {
    await app?.close();
  });

  it(`la ${LIMITE + 1}ª petición dentro de la ventana → 429`, async () => {
    for (let i = 0; i < LIMITE; i += 1) {
      const res = await request(app.getHttpServer())
        .post('/v1/checkout/simulate-payment')
        .send({ order_token: 'b'.repeat(64) });
      expect(res.status).not.toBe(429);
    }

    const excedida = await request(app.getHttpServer())
      .post('/v1/checkout/simulate-payment')
      .send({ order_token: 'b'.repeat(64) });

    expect(excedida.status).toBe(429);
    expect(excedida.headers['retry-after']).toBeDefined();
  });
});

describe('POST /v1/checkout/simulate-payment — flag apagado (T7.2)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await bootConVariante(false);
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

  it('con PAYMENTS_SIMULATED_ENABLED=false, responde 404 sin tocar la base', async () => {
    const categoria = await prisma.category.create({
      data: { name: 'Refrigeración', slug: 'refrigeracion' },
    });
    const producto = await prisma.product.create({
      data: {
        sku: 'SIM-OFF',
        slug: 'sim-off',
        name: 'SIM-OFF',
        price_ars_cents: 100_000,
        stock: 5,
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
              product_name: 'SIM-OFF',
              product_sku: 'SIM-OFF',
            },
          ],
        },
      },
    });

    const res = await request(app.getHttpServer())
      .post('/v1/checkout/simulate-payment')
      .send({ order_token: token });

    expect(res.status).toBe(404);
    const ordenEnBase = await prisma.order.findUniqueOrThrow({ where: { id: orden.id } });
    expect(ordenEnBase.status).toBe('pending_payment');
  });
});
