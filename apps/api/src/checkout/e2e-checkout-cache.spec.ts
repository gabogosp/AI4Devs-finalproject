import { INestApplication } from '@nestjs/common';
import { bootTestApp } from '../../test/e2e-app';
import { ClienteDeCarrito, sembrarProductos } from '../../test/cart-client';
import { ClienteDeCheckout } from '../../test/checkout-client';
import { PrismaService } from '../prisma/prisma.service';
import { CartModule } from '../cart/cart.module';
import { CheckoutModule } from './checkout.module';

/**
 * T3.3 — `Cache-Control: no-store` en TODA la superficie de `/v1/checkout`,
 * incluidos los errores (§7.1). El middleware corre en el borde, antes del
 * routing, así que cubre 403/409/422/429 igual que el 201.
 */
describe('Cache-Control del checkout (e2e-checkout-cache)', () => {
  const LIMITE = Number(process.env.CHECKOUT_RATE_LIMIT_MAX ?? 10);
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.TRUST_PROXY_HOPS = '1';
    app = await bootTestApp([CartModule, CheckoutModule]);
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
      { slug: 'compresor-embraco', price: 12_500_000, stock: 1 },
      { slug: 'gas-r134a', price: 850_000, stock: 1000 },
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

  async function clienteConCarrito(slug = 'compresor-embraco', quantity = 1): Promise<ClienteDeCheckout> {
    const carrito = new ClienteDeCarrito(app);
    await carrito.put(slug, { quantity });
    return new ClienteDeCheckout(app, carrito);
  }

  it('201 lleva no-store', async () => {
    const cliente = await clienteConCarrito();
    const res = await cliente.post(buyerValido());
    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('403 (CSRF) lleva no-store', async () => {
    const cliente = await clienteConCarrito();
    const res = await cliente.post(buyerValido(), { csrf: null });
    expect(res.status).toBe(403);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('409 (carrito con línea sin stock) lleva no-store', async () => {
    const cliente = await clienteConCarrito('compresor-embraco', 1);
    // Bajamos el stock DESPUÉS de armar el carrito, para forzar el 409 sin
    // que el PUT del carrito lo hubiera rechazado antes.
    await prisma.product.update({
      where: { slug: 'compresor-embraco' },
      data: { stock: 0 },
    });

    const res = await cliente.post(buyerValido());

    expect(res.status).toBe(409);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('422 (consent ausente) lleva no-store', async () => {
    const cliente = await clienteConCarrito();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- se descarta a propósito
    const { consent: _consent, ...sinConsent } = buyerValido();
    const res = await cliente.post(sinConsent);
    expect(res.status).toBe(422);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('429 lleva no-store', async () => {
    const cliente = await clienteConCarrito('gas-r134a', 1);
    for (let i = 0; i < LIMITE; i += 1) await cliente.post(buyerValido());

    const excedida = await cliente.post(buyerValido());

    expect(excedida.status).toBe(429);
    expect(excedida.headers['cache-control']).toBe('no-store');
  });
});
