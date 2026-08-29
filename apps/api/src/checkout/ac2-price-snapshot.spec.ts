import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { CART_COOKIE } from '../auth/cookies';
import { PrismaService } from '../prisma/prisma.service';
import { CartTokenService } from '../cart/cart-token.service';
import { CartsRepository } from '../cart/carts.repository';
import { ProductsRepository } from '../products/products.repository';
import { CheckoutEventsService } from '../observability/checkout-events.service';
import { CheckoutService } from './checkout.service';
import { OrderTokenService } from './order-token.service';
import { OrdersRepository } from './orders.repository';

/**
 * T5.4 — AC-2: cambiar el precio del catálogo no altera una venta pasada. Es
 * el invariante que US-001 fijó en su AC-10, verificado del lado de la orden
 * y de forma **independiente de `buildCartView`**: se lee `order_items`
 * directo de Postgres, no la vista del carrito.
 */
describe('AC-2: cambiar el precio del catálogo no altera una venta pasada (ac2-price-snapshot)', () => {
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
  const service = new CheckoutService(
    cartToken,
    products,
    orders,
    orderToken,
    config,
    new CheckoutEventsService(),
  );

  const fakeReq = (cookies: Record<string, string> = {}) =>
    ({ cookies }) as unknown as Request;
  function fakeRes() {
    const res = { cookie: () => res };
    return res as unknown as Response;
  }

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

  it('duplicar el precio y renombrar el producto DESPUÉS de la venta no altera la orden', async () => {
    const producto = await prisma.product.create({
      data: {
        sku: 'AC2-A',
        slug: 'ac2-a',
        name: 'Compresor Original',
        price_ars_cents: 100_000,
        stock: 5,
        status: 'published',
        category_id: categoriaId,
      },
    });
    const { token } = await cartToken.ensure(fakeReq(), fakeRes());
    const req = fakeReq({ [CART_COOKIE]: token });
    const session = await cartToken.resolve(req);
    await carts.upsertItemAndTouch(
      { cartId: session!.cart.id, productId: producto.id, quantity: 2, unitPriceArsCents: 100_000 },
      cartToken.nextExpiration(),
    );

    const resultado = await service.createOrder(req, {
      buyerName: 'Comprador de Prueba',
      buyerEmail: 'comprador@test.local',
      buyerPhone: '+54 351 555 0000',
    });

    // Snapshot ANTES del cambio, leído directo de Postgres — no de la vista
    // del carrito ni de la respuesta del checkout.
    const itemsAntes = await prisma.orderItem.findMany({
      where: { product_id: producto.id },
      orderBy: { id: 'asc' },
    });
    const ordenAntes = await prisma.order.findUnique({
      where: { order_number: resultado.orderNumber },
    });

    // El catálogo cambia DESPUÉS de la venta: precio duplicado, nombre nuevo.
    await prisma.product.update({
      where: { id: producto.id },
      data: { price_ars_cents: 200_000, name: 'Compresor Renombrado' },
    });

    const itemsDespues = await prisma.orderItem.findMany({
      where: { product_id: producto.id },
      orderBy: { id: 'asc' },
    });
    const ordenDespues = await prisma.order.findUnique({
      where: { order_number: resultado.orderNumber },
    });

    expect(itemsDespues).toEqual(itemsAntes);
    expect(itemsDespues[0].unit_price_ars_cents).toBe(100_000);
    expect(itemsDespues[0].product_name).toBe('Compresor Original');
    expect(itemsDespues[0].product_sku).toBe('AC2-A');
    expect(ordenDespues?.total_ars_cents).toBe(ordenAntes?.total_ars_cents);
    expect(ordenDespues?.total_ars_cents).toBe(200_000); // 2 × 100_000, no 2 × 200_000

    // Y el total sigue siendo la suma exacta de sus líneas (aritméticamente
    // cerrada sobre sí misma, no sobre el catálogo vigente).
    const sumaLineas = itemsDespues.reduce(
      (suma, item) => suma + item.quantity * item.unit_price_ars_cents,
      0,
    );
    expect(ordenDespues?.total_ars_cents).toBe(sumaLineas);
  });
});
