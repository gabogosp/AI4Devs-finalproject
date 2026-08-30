import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bootTestApp } from '../../test/e2e-app';
import { ClienteDeCarrito, sembrarProductos } from '../../test/cart-client';
import { ClienteDeCheckout } from '../../test/checkout-client';
import { PrismaService } from '../prisma/prisma.service';
import { CartModule } from '../cart/cart.module';
import { CheckoutModule } from './checkout.module';
import { AuthModule } from '../auth/auth.module';
import { StorefrontModule } from '../storefront/storefront.module';

/**
 * T3.2 — presupuesto del checkout (§7.3) y contrato de cabeceras (§12).
 *
 * Un solo endpoint: el `limit` de acá ES el real (`CHECKOUT_RATE_LIMIT_MAX`,
 * 10/10min), sin override de test — no hay lectura que separar como en el
 * carrito.
 */
describe('Rate limit del checkout (e2e-checkout-ratelimit)', () => {
  const LIMITE = Number(process.env.CHECKOUT_RATE_LIMIT_MAX ?? 10);
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.TRUST_PROXY_HOPS = '1';
    app = await bootTestApp([CartModule, CheckoutModule, AuthModule, StorefrontModule]);
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app?.close();
    delete process.env.TRUST_PROXY_HOPS;
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE orders, order_items, carts, cart_items, products, categories RESTART IDENTITY CASCADE',
    );
    await sembrarProductos(prisma, [
      { slug: 'compresor-embraco', price: 12_500_000, stock: 1000 },
    ]);
  });

  const buyerValido = () => ({
    buyer: {
      name: 'Comprador de Prueba',
      email: 'comprador@test.local',
      phone: '+54 351 555 0000',
    },
    consent: true,
    fulfillment: 'pickup' as const,
  });

  async function clienteConCarrito(): Promise<ClienteDeCheckout> {
    const carrito = new ClienteDeCarrito(app);
    await carrito.put('compresor-embraco', { quantity: 1 });
    return new ClienteDeCheckout(app, carrito);
  }

  it(`la ${LIMITE + 1}ª petición → 429 con las 4 cabeceras y Retry-After numérico > 0`, async () => {
    const cliente = await clienteConCarrito();

    for (let i = 0; i < LIMITE; i += 1) {
      const res = await cliente.post(buyerValido());
      expect(res.status).toBe(201);
    }

    const excedida = await cliente.post(buyerValido());

    expect(excedida.status).toBe(429);
    expect(excedida.headers['content-type']).toContain('application/problem+json');
    expect(excedida.headers['retry-after']).toBeDefined();
    expect(Number(excedida.headers['retry-after'])).toBeGreaterThan(0);
    expect(excedida.headers['ratelimit-limit']).toBe(String(LIMITE));
    expect(excedida.headers['ratelimit-remaining']).toBe('0');
    expect(excedida.headers['ratelimit-reset']).toBeDefined();
  });

  it('agotado el presupuesto del checkout, login/carrito/catálogo siguen respondiendo NO-429', async () => {
    const cliente = await clienteConCarrito();
    for (let i = 0; i <= LIMITE; i += 1) await cliente.post(buyerValido());
    expect((await cliente.post(buyerValido())).status).toBe(429);

    const login = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: 'nadie@test.local', password: 'x' });
    const carrito = await new ClienteDeCarrito(app).get();
    const ficha = await request(app.getHttpServer()).get(
      '/v1/products/compresor-embraco',
    );

    expect(login.status).not.toBe(429);
    expect(carrito.status).not.toBe(429);
    expect(ficha.status).not.toBe(429);
  });
});
