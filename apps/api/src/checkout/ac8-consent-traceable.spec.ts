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
 * T5.3 — AC-8: el consentimiento es trazable (marca temporal + versión) y no
 * se puede eludir. La parte estructural —el `CHECK` de la base— es lo que
 * hace que AC-4/AC-8 no dependan de que el código valide.
 */
describe('AC-8: el consentimiento es trazable y no se puede eludir (ac8-consent-traceable)', () => {
  const prisma = new PrismaService();
  const carts = new CartsRepository(prisma);
  const products = new ProductsRepository(prisma);
  const orders = new OrdersRepository(prisma);
  const orderToken = new OrderTokenService();
  const LEGAL_TERMS_VERSION = '2026-06-15';
  const config = new ConfigService({
    CART_TTL_DAYS: 7,
    CART_MAX_QTY_PER_LINE: 99,
    AUTH_COOKIE_SECURE: 'false',
    LEGAL_TERMS_VERSION,
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

  it('la orden creada tiene las 3 columnas de consentimiento correctas', async () => {
    const producto = await prisma.product.create({
      data: {
        sku: 'AC8-A',
        slug: 'ac8-a',
        name: 'Compresor',
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
      { cartId: session!.cart.id, productId: producto.id, quantity: 1, unitPriceArsCents: 100_000 },
      cartToken.nextExpiration(),
    );

    const antes = Date.now();
    const resultado = await service.createOrder(req, {
      buyerName: 'Comprador de Prueba',
      buyerEmail: 'comprador@test.local',
      buyerPhone: '+54 351 555 0000',
    });
    const despues = Date.now();

    const orden = await prisma.order.findUnique({
      where: { order_number: resultado.orderNumber },
    });

    expect(orden?.consent_accepted).toBe(true);
    expect(orden?.consent_terms_version).toBe(LEGAL_TERMS_VERSION);
    const marca = orden!.consent_accepted_at.getTime();
    // Dentro de los 5 s del request (Exit criterion), con margen amplio
    // sobre la ventana real de la prueba (antes/después son ms).
    expect(marca).toBeGreaterThanOrEqual(antes - 5_000);
    expect(marca).toBeLessThanOrEqual(despues + 5_000);
  });

  it('CHECK estructural: un INSERT directo con consent_accepted = false FALLA por la base', async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO orders (id, order_number, access_token_hash, buyer_name, buyer_email,
          buyer_phone, total_ars_cents, consent_accepted, consent_accepted_at,
          consent_terms_version)
         VALUES (gen_random_uuid(), DEFAULT, 'h-ac8-insert', 'x', 'x@test.local', '+54',
          100, false, now(), $1)`,
        LEGAL_TERMS_VERSION,
      ),
    ).rejects.toThrow(/orders_consent_check/);
  });

  it('CHECK estructural: un UPDATE que ponga false en una orden existente también FALLA', async () => {
    const producto = await prisma.product.create({
      data: {
        sku: 'AC8-B',
        slug: 'ac8-b',
        name: 'Gas',
        price_ars_cents: 50_000,
        stock: 5,
        status: 'published',
        category_id: categoriaId,
      },
    });
    const { token } = await cartToken.ensure(fakeReq(), fakeRes());
    const req = fakeReq({ [CART_COOKIE]: token });
    const session = await cartToken.resolve(req);
    await carts.upsertItemAndTouch(
      { cartId: session!.cart.id, productId: producto.id, quantity: 1, unitPriceArsCents: 50_000 },
      cartToken.nextExpiration(),
    );
    const resultado = await service.createOrder(req, {
      buyerName: 'Comprador de Prueba',
      buyerEmail: 'comprador2@test.local',
      buyerPhone: '+54 351 555 0001',
    });

    await expect(
      prisma.$executeRawUnsafe(
        'UPDATE orders SET consent_accepted = false WHERE order_number = $1',
        resultado.orderNumber,
      ),
    ).rejects.toThrow(/orders_consent_check/);

    // Y la orden sigue con el consentimiento intacto — el UPDATE no dejó un
    // estado intermedio.
    const orden = await prisma.order.findUnique({
      where: { order_number: resultado.orderNumber },
    });
    expect(orden?.consent_accepted).toBe(true);
  });
});
