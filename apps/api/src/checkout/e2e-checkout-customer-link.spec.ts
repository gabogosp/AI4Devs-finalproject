import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { bootTestApp } from '../../test/e2e-app';
import { ClienteDeCarrito, sembrarProductos } from '../../test/cart-client';
import { ClienteDeCheckout } from '../../test/checkout-client';
import { PrismaService } from '../prisma/prisma.service';
import { ACCESS_COOKIE } from '../auth/cookies';
import { JWT_AUDIENCE, JWT_ISSUER } from '../auth/session.service';
import { CartModule } from '../cart/cart.module';
import { AuthModule } from '../auth/auth.module';
import { CheckoutModule } from './checkout.module';

/**
 * T5.6 — checkout con sesión de cliente vincula `customer_id` (design.md
 * §D2). `bootTestApp([CheckoutModule, AuthModule])` monta el guard opcional
 * de verdad (`AuthModule` exporta `OptionalCustomerGuard`).
 */
describe('Checkout con sesión de cliente vincula customer_id (e2e-checkout-customer-link, US-015 T5.6)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const jwt = new JwtService({});

  beforeAll(async () => {
    process.env.TRUST_PROXY_HOPS = '1';
    app = await bootTestApp([CartModule, AuthModule, CheckoutModule]);
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app?.close();
    delete process.env.TRUST_PROXY_HOPS;
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE orders, order_items, carts, cart_items, products, categories, customers RESTART IDENTITY CASCADE',
    );
    await sembrarProductos(prisma, [
      { slug: 'compresor-embraco', price: 12_500_000, stock: 1 },
    ]);
  });

  function accessCookie(customerId: string): string {
    return jwt.sign(
      { sub: customerId, role: 'customer', typ: 'access', jti: randomUUID() },
      { secret: process.env.JWT_SECRET, issuer: JWT_ISSUER, audience: JWT_AUDIENCE },
    );
  }

  const buyerValido = () => ({
    buyer: {
      name: 'Comprador de Prueba',
      email: 'comprador@test.local',
      phone: '+54 351 555 0000',
    },
    consent: true,
    fulfillment: 'pickup' as const,
  });

  it('con cookie de cliente válida, la orden creada tiene customer_id = sub del token, y el 201 NO lo expone', async () => {
    const cliente = await prisma.customer.create({
      data: {
        email: 'con-sesion@test.local',
        password_hash: 'hash-de-prueba',
        name: 'Cliente Con Sesión',
      },
    });

    const carrito = new ClienteDeCarrito(app);
    carrito.conCookies({ [ACCESS_COOKIE]: accessCookie(cliente.id) });
    await carrito.put('compresor-embraco', { quantity: 1 });

    const checkout = new ClienteDeCheckout(app, carrito);
    const res = await checkout.post(buyerValido());

    expect(res.status).toBe(201);
    expect(Object.keys(res.body)).not.toContain('customer_id');

    const orderNumber = (res.body as unknown as { order_number: number }).order_number;
    const orden = await prisma.order.findUniqueOrThrow({
      where: { order_number: orderNumber },
    });
    expect(orden.customer_id).toBe(cliente.id);
  });
});
