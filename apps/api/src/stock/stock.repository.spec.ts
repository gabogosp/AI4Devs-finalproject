import { PrismaService } from '../prisma/prisma.service';
import { InsufficientStockError } from './stock-errors';
import { StockRepository } from './stock.repository';

/**
 * T1.1 — integración contra Postgres real (no un doble): lo que hay que
 * probar es que el `UPDATE ... WHERE stock >= qty` decrementa exacto y que,
 * envuelto en la transacción del caller, un corte a mitad de camino revierte
 * TODO lo ya escrito — no sólo la línea que falló (F50, `design.md` §Approach).
 */
describe('StockRepository.decrementForOrder', () => {
  const prisma = new PrismaService();
  const stock = new StockRepository(prisma);
  let categoriaId = '';

  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE orders, order_items, payments, carts, cart_items, products, categories RESTART IDENTITY CASCADE',
    );
    categoriaId = (
      await prisma.category.create({
        data: { name: 'Refrigeración', slug: 'refrigeracion' },
      })
    ).id;
  });

  it('decrementa exactamente la cantidad pedida cuando el stock alcanza', async () => {
    const producto = await prisma.product.create({
      data: {
        sku: 'ST-A',
        slug: 'st-a',
        name: 'Compresor',
        price_ars_cents: 100_000,
        stock: 10,
        status: 'published',
        category_id: categoriaId,
      },
    });

    await stock.decrementForOrder([{ productId: producto.id, quantity: 3 }]);

    const actualizado = await prisma.product.findUniqueOrThrow({
      where: { id: producto.id },
    });
    expect(actualizado.stock).toBe(7);
  });

  it('corta y lanza InsufficientStockError si una línea no tiene stock suficiente', async () => {
    const producto = await prisma.product.create({
      data: {
        sku: 'ST-B',
        slug: 'st-b',
        name: 'Gas',
        price_ars_cents: 50_000,
        stock: 2,
        status: 'published',
        category_id: categoriaId,
      },
    });

    await expect(
      stock.decrementForOrder([{ productId: producto.id, quantity: 5 }]),
    ).rejects.toBeInstanceOf(InsufficientStockError);

    const sinTocar = await prisma.product.findUniqueOrThrow({
      where: { id: producto.id },
    });
    expect(sinTocar.stock).toBe(2);
  });

  it('dentro de una transacción compartida, un corte revierte TAMBIÉN las líneas ya decrementadas antes', async () => {
    const p1 = await prisma.product.create({
      data: {
        sku: 'ST-C1',
        slug: 'st-c1',
        name: 'Cable',
        price_ars_cents: 20_000,
        stock: 10,
        status: 'published',
        category_id: categoriaId,
      },
    });
    const p2 = await prisma.product.create({
      data: {
        sku: 'ST-C2',
        slug: 'st-c2',
        name: 'Terminal',
        price_ars_cents: 5_000,
        stock: 1,
        status: 'published',
        category_id: categoriaId,
      },
    });

    await expect(
      prisma.$transaction(async (tx) => {
        // p1 alcanza y se decrementa primero; p2 no alcanza y corta la transacción.
        await stock.decrementForOrder([{ productId: p1.id, quantity: 4 }], tx);
        await stock.decrementForOrder([{ productId: p2.id, quantity: 3 }], tx);
      }),
    ).rejects.toBeInstanceOf(InsufficientStockError);

    const p1Despues = await prisma.product.findUniqueOrThrow({ where: { id: p1.id } });
    const p2Despues = await prisma.product.findUniqueOrThrow({ where: { id: p2.id } });
    // p1 se había decrementado DENTRO de la transacción que después abortó: revierte.
    expect(p1Despues.stock).toBe(10);
    expect(p2Despues.stock).toBe(1);
  });
});

/**
 * T2.1 — US-013 AC-2/AC-8: el reintegro es el inverso simétrico del
 * decremento, sin guard de cantidad posible (un incremento nunca falla).
 */
describe('StockRepository.incrementForOrder', () => {
  const prisma = new PrismaService();
  const stock = new StockRepository(prisma);
  let categoriaId = '';

  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE orders, order_items, payments, carts, cart_items, products, categories RESTART IDENTITY CASCADE',
    );
    categoriaId = (
      await prisma.category.create({
        data: { name: 'Refrigeración', slug: 'refrigeracion' },
      })
    ).id;
  });

  it('incrementa exactamente la cantidad pedida', async () => {
    const producto = await prisma.product.create({
      data: {
        sku: 'ST-D',
        slug: 'st-d',
        name: 'Válvula',
        price_ars_cents: 30_000,
        stock: 5,
        status: 'published',
        category_id: categoriaId,
      },
    });

    await stock.incrementForOrder([{ productId: producto.id, quantity: 3 }]);

    const actualizado = await prisma.product.findUniqueOrThrow({
      where: { id: producto.id },
    });
    expect(actualizado.stock).toBe(8);
  });

  it('incrementa múltiples líneas en una sola llamada', async () => {
    const p1 = await prisma.product.create({
      data: {
        sku: 'ST-E1',
        slug: 'st-e1',
        name: 'Manómetro',
        price_ars_cents: 15_000,
        stock: 0,
        status: 'published',
        category_id: categoriaId,
      },
    });
    const p2 = await prisma.product.create({
      data: {
        sku: 'ST-E2',
        slug: 'st-e2',
        name: 'Filtro',
        price_ars_cents: 8_000,
        stock: 2,
        status: 'published',
        category_id: categoriaId,
      },
    });

    await stock.incrementForOrder([
      { productId: p1.id, quantity: 4 },
      { productId: p2.id, quantity: 1 },
    ]);

    const p1Despues = await prisma.product.findUniqueOrThrow({ where: { id: p1.id } });
    const p2Despues = await prisma.product.findUniqueOrThrow({ where: { id: p2.id } });
    expect(p1Despues.stock).toBe(4);
    expect(p2Despues.stock).toBe(3);
  });
});
