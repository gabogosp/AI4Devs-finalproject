import * as fs from 'node:fs';
import * as path from 'node:path';
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
 * T5.1 — AC-6: el checkout **lee** stock para validar y no lo escribe (ADR-0008).
 * No es una propiedad que "hoy es verdad" — queda atornillada acá contra la
 * próxima edición.
 */
describe('AC-6: el checkout no toca el stock (ac6-stock-untouched)', () => {
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

  const buyer = () => ({
    buyerName: 'Comprador de Prueba',
    buyerEmail: 'comprador@test.local',
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

  it('recorrido completo con 3 líneas (una con stock EXACTAMENTE la cantidad pedida): products.stock idéntico antes y después', async () => {
    const p1 = await prisma.product.create({
      data: {
        sku: 'AC6-A',
        slug: 'ac6-a',
        name: 'Compresor',
        price_ars_cents: 100_000,
        stock: 10,
        status: 'published',
        category_id: categoriaId,
      },
    });
    const p2 = await prisma.product.create({
      data: {
        sku: 'AC6-B',
        slug: 'ac6-b',
        name: 'Gas',
        price_ars_cents: 50_000,
        stock: 5,
        status: 'published',
        category_id: categoriaId,
      },
    });
    // Stock JUSTO: si una reserva accidental descontara algo, acá se notaría
    // — la línea siguiente ya no cerraría por falta de stock.
    const p3 = await prisma.product.create({
      data: {
        sku: 'AC6-C',
        slug: 'ac6-c',
        name: 'Cable',
        price_ars_cents: 20_000,
        stock: 3,
        status: 'published',
        category_id: categoriaId,
      },
    });

    const { token } = await cartToken.ensure(fakeReq(), fakeRes());
    const req = fakeReq({ [CART_COOKIE]: token });
    const session = await cartToken.resolve(req);
    for (const [producto, qty] of [
      [p1, 2],
      [p2, 1],
      [p3, 3], // exactamente el stock disponible
    ] as const) {
      await carts.upsertItemAndTouch(
        {
          cartId: session!.cart.id,
          productId: producto.id,
          quantity: qty,
          unitPriceArsCents: producto.price_ars_cents,
        },
        cartToken.nextExpiration(),
      );
    }

    const antes = await prisma.$queryRawUnsafe<Array<{ id: string; stock: number }>>(
      'SELECT id, stock FROM products ORDER BY id',
    );

    const resultado = await service.createOrder(req, buyer());
    expect(resultado.status).toBe('pending_payment');
    expect(resultado.itemsCount).toBe(3);

    const despues = await prisma.$queryRawUnsafe<Array<{ id: string; stock: number }>>(
      'SELECT id, stock FROM products ORDER BY id',
    );

    expect(despues).toEqual(antes);
    // El stock justo (p3) sigue siendo 3 — ni descontado ni reservado.
    const p3Despues = despues.find((p) => p.id === p3.id);
    expect(p3Despues?.stock).toBe(3);
  });

  it('no existe en checkout/ ninguna sentencia de escritura sobre products', () => {
    // Equivalente en Node puro del `rg` del Verify (`rg` no es un binario
    // instalado en este sistema — sólo existe como función de shell del
    // entorno interactivo, así que un `execSync` lo daría por ausente y el
    // catch lo volvería un verde falso). Recorre cada .ts no-spec de
    // checkout/, ignora comentarios, y busca una línea con "stock" que
    // también contenga una palabra de escritura.
    const dir = path.join(__dirname);
    const sospechosas: string[] = [];

    for (const archivo of fs.readdirSync(dir)) {
      if (!archivo.endsWith('.ts') || archivo.endsWith('.spec.ts')) continue;
      const contenido = fs.readFileSync(path.join(dir, archivo), 'utf8');
      for (const linea of contenido.split('\n')) {
        const trimmed = linea.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
        if (!/stock/i.test(linea)) continue;
        if (/\b(update|decrement|set)\b/i.test(linea)) {
          sospechosas.push(`${archivo}: ${trimmed}`);
        }
      }
    }

    expect(sospechosas).toEqual([]);
  });
});
