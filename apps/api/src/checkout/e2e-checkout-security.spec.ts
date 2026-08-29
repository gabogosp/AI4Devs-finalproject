import { INestApplication } from '@nestjs/common';
import { bootTestApp } from '../../test/e2e-app';
import { ClienteDeCarrito, sembrarProductos } from '../../test/cart-client';
import { ClienteDeCheckout } from '../../test/checkout-client';
import { PrismaService } from '../prisma/prisma.service';
import { CartModule } from '../cart/cart.module';
import { CheckoutModule } from './checkout.module';

/**
 * T3.2 — CSRF del checkout: reusa `CartCsrfGuard` tal cual (la escritura se
 * autoriza con la cookie `dsm_cart`, credencial ambiente).
 */
describe('Seguridad del checkout (e2e-checkout-security)', () => {
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
      { slug: 'compresor-embraco', price: 12_500_000, stock: 5 },
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

  it('con cookie, header correcto y Origin permitido → 201', async () => {
    const cliente = await clienteConCarrito();
    const res = await cliente.post(buyerValido());
    expect(res.status).toBe(201);
  });

  it('con la cookie del carrito pero SIN X-CSRF-Token → 403 dsm:auth/csrf', async () => {
    const cliente = await clienteConCarrito();
    const res = await cliente.post(buyerValido(), { csrf: null });
    expect(res.status).toBe(403);
    expect(res.body.type).toBe('dsm:auth/csrf');
  });

  it('con Origin fuera de la allowlist → 403', async () => {
    const cliente = await clienteConCarrito();
    const res = await cliente.post(buyerValido(), {
      origin: 'http://evil.example',
    });
    expect(res.status).toBe(403);
  });

  it('con el X-CSRF-Token de OTRO carrito → 403', async () => {
    const victima = await clienteConCarrito();
    const atacante = await clienteConCarrito();

    const res = await victima.post(buyerValido(), {
      csrf: atacante.cookie('dsm_cart_csrf'),
    });

    expect(res.status).toBe(403);
  });

  it('un 403 de CSRF no crea ninguna orden', async () => {
    const cliente = await clienteConCarrito();

    await cliente.post(buyerValido(), { csrf: null });

    expect(await prisma.order.count()).toBe(0);
  });
});
