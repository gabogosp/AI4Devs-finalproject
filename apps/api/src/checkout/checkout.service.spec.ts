import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { CART_COOKIE } from '../auth/cookies';
import { PrismaService } from '../prisma/prisma.service';
import { CartTokenService } from '../cart/cart-token.service';
import { CartsRepository } from '../cart/carts.repository';
import { ProductsRepository } from '../products/products.repository';
import { CartEmptyError, CartNotPurchasableError } from './checkout-errors';
import { CheckoutService } from './checkout.service';
import { OrderTokenService } from './order-token.service';
import { OrdersRepository } from './orders.repository';

/**
 * T2.3 — integration contra el Postgres real. `checkout.service.spec.ts`,
 * espejo de `cart-token.service.spec.ts`: repos reales, `ConfigService` con
 * valores fijos, sin NestJS testing module.
 */
describe('CheckoutService (integration)', () => {
  const prisma = new PrismaService();
  const carts = new CartsRepository(prisma);
  const products = new ProductsRepository(prisma);
  const orders = new OrdersRepository(prisma);
  const orderToken = new OrderTokenService();
  const config = new ConfigService({
    CART_TTL_DAYS: 7,
    CART_MAX_QTY_PER_LINE: 99,
    AUTH_COOKIE_SECURE: 'false',
    LEGAL_TERMS_VERSION: '2026-06-15',
  }) as ConfigService;
  const cartToken = new CartTokenService(carts, config);
  const service = new CheckoutService(cartToken, products, orders, orderToken, config);

  const fakeReq = (cookies: Record<string, string> = {}) =>
    ({ cookies }) as unknown as Request;
  function fakeRes() {
    const res = { cookie: () => res };
    return res as unknown as Response;
  }

  const buyer = () => ({
    buyerName: 'Comprador de Prueba',
    buyerEmail: 'Comprador@Test.LOCAL',
    buyerPhone: '+54 351 555 0000',
  });

  let categoriaId = '';

  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE orders, order_items, carts, cart_items, products, categories RESTART IDENTITY CASCADE',
    );
    categoriaId = (
      await prisma.category.create({
        data: { name: 'Refrigeración', slug: 'refrigeracion' },
      })
    ).id;
  });

  async function productoDePrueba(
    sufijo: string,
    over: Partial<{ stock: number; status: string; price_ars_cents: number }> = {},
  ) {
    return prisma.product.create({
      data: {
        sku: `CHK-${sufijo}`,
        slug: `producto-${sufijo}`,
        name: `Producto ${sufijo}`,
        price_ars_cents: over.price_ars_cents ?? 100_000,
        stock: over.stock ?? 10,
        status: over.status ?? 'published',
        category_id: categoriaId,
      },
    });
  }

  /** Carrito con una línea, cookie lista para pasarle al checkout. */
  async function carritoConLinea(productId: string, quantity = 1, unitPrice = 100_000) {
    const { token } = await cartToken.ensure(fakeReq(), fakeRes());
    const req = fakeReq({ [CART_COOKIE]: token });
    const session = await cartToken.resolve(req);
    await carts.upsertItemAndTouch(
      {
        cartId: session!.cart.id,
        productId,
        quantity,
        unitPriceArsCents: unitPrice,
      },
      cartToken.nextExpiration(),
    );
    return req;
  }

  it('happy path: orden pending_payment con el total, las líneas y el email en minúsculas', async () => {
    const p1 = await productoDePrueba('a', { price_ars_cents: 100_000 });
    const p2 = await productoDePrueba('b', { price_ars_cents: 250_000 });
    const { token } = await cartToken.ensure(fakeReq(), fakeRes());
    const req = fakeReq({ [CART_COOKIE]: token });
    const session = await cartToken.resolve(req);
    await carts.upsertItemAndTouch(
      { cartId: session!.cart.id, productId: p1.id, quantity: 2, unitPriceArsCents: 100_000 },
      cartToken.nextExpiration(),
    );
    await carts.upsertItemAndTouch(
      { cartId: session!.cart.id, productId: p2.id, quantity: 1, unitPriceArsCents: 250_000 },
      cartToken.nextExpiration(),
    );

    const resultado = await service.createOrder(req, buyer());

    expect(resultado.status).toBe('pending_payment');
    expect(resultado.totalArsCents).toBe(2 * 100_000 + 250_000);
    expect(resultado.itemsCount).toBe(2);
    expect(resultado.orderToken).toMatch(/^[0-9a-f]{64}$/);

    const enBase = await prisma.order.findUnique({
      where: { order_number: resultado.orderNumber },
    });
    expect(enBase?.buyer_email).toBe('comprador@test.local');
    expect(enBase?.status).toBe('pending_payment');
  });

  it('carrito sin cookie: CartEmptyError', async () => {
    await expect(service.createOrder(fakeReq(), buyer())).rejects.toBeInstanceOf(
      CartEmptyError,
    );
  });

  it('carrito con una línea insufficient_stock: CartNotPurchasableError nombra ESE slug', async () => {
    const producto = await productoDePrueba('sinstock', { stock: 1 });
    const req = await carritoConLinea(producto.id, 5);

    let capturado: unknown;
    try {
      await service.createOrder(req, buyer());
    } catch (error) {
      capturado = error;
    }

    expect(capturado).toBeInstanceOf(CartNotPurchasableError);
    const err = capturado as CartNotPurchasableError;
    expect(err.fieldErrors?.map((f) => f.field)).toEqual([producto.slug]);
  });

  it('carrito con un producto despublicado: CartNotPurchasableError nombra ESE slug', async () => {
    const producto = await productoDePrueba('despub', { status: 'draft' });
    const req = await carritoConLinea(producto.id, 1);

    let capturado: unknown;
    try {
      await service.createOrder(req, buyer());
    } catch (error) {
      capturado = error;
    }

    expect(capturado).toBeInstanceOf(CartNotPurchasableError);
    const err = capturado as CartNotPurchasableError;
    expect(err.fieldErrors?.map((f) => f.field)).toEqual([producto.slug]);
  });

  it('en los 4 escenarios, stock y cart_items quedan IDÉNTICOS antes y después', async () => {
    const p1 = await productoDePrueba('inv-happy', { stock: 10 });
    const p2 = await productoDePrueba('inv-sinstock', { stock: 1 });
    const p3 = await productoDePrueba('inv-despub', { status: 'draft' });

    const reqs = [
      await carritoConLinea(p1.id, 2),
      fakeReq(), // sin cookie
      await carritoConLinea(p2.id, 5),
      await carritoConLinea(p3.id, 1),
    ];

    const antes = await prisma.$queryRawUnsafe<Array<{ id: string; stock: number }>>(
      'SELECT id, stock FROM products ORDER BY id',
    );
    const cartItemsAntes = await prisma.cartItem.count();

    for (const req of reqs) {
      await service.createOrder(req, buyer()).catch(() => undefined);
    }

    const despues = await prisma.$queryRawUnsafe<Array<{ id: string; stock: number }>>(
      'SELECT id, stock FROM products ORDER BY id',
    );
    const cartItemsDespues = await prisma.cartItem.count();

    expect(despues).toEqual(antes);
    expect(cartItemsDespues).toBe(cartItemsAntes);
  });
});
