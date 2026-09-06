import { PrismaService } from '../prisma/prisma.service';
import { ReportsRepository } from './reports.repository';

/**
 * T3.1/T3.2/T3.3 — las 3 queries de agregación contra Postgres real
 * (integration): lo que puede fallar acá es SQL (el `GROUP BY`, el filtro de
 * estado, el `JOIN`), un doble de Prisma no probaría nada de eso — mismo
 * criterio que `search/search.repository.spec.ts`.
 */
describe('ReportsRepository (integration)', () => {
  const prisma = new PrismaService();
  const repo = new ReportsRepository(prisma);

  let categoryId: string;
  let productAId: string;
  let productBId: string;

  const limpiar = () =>
    prisma.$executeRawUnsafe(
      'TRUNCATE TABLE orders, order_items, order_status_history, products, categories RESTART IDENTITY CASCADE',
    );

  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await limpiar();
    categoryId = (
      await prisma.category.create({
        data: { name: 'Reports fixtures', slug: 'reports-fixtures' },
      })
    ).id;
    productAId = (
      await prisma.product.create({
        data: {
          sku: 'RPT-A',
          slug: 'reports-producto-a',
          name: 'Producto A',
          price_ars_cents: 10_000,
          stock: 100,
          status: 'published',
          category_id: categoryId,
        },
      })
    ).id;
    productBId = (
      await prisma.product.create({
        data: {
          sku: 'RPT-B',
          slug: 'reports-producto-b',
          name: 'Producto B',
          price_ars_cents: 20_000,
          stock: 100,
          status: 'published',
          category_id: categoryId,
        },
      })
    ).id;
  });

  interface SeedOrderOpts {
    status: string;
    createdAt: Date;
    totalArsCents: number;
    items: { productId: string; productSku: string; productName: string; quantity: number; unitPriceArsCents: number }[];
  }

  async function seedOrder({ status, createdAt, totalArsCents, items }: SeedOrderOpts): Promise<string> {
    const order = await prisma.order.create({
      data: {
        access_token_hash: `h-${Math.random().toString(36).slice(2)}`,
        buyer_name: 'Comprador de Prueba',
        buyer_email: `comprador-${Math.random().toString(36).slice(2)}@test.local`,
        buyer_phone: '+54 351 555 0000',
        total_ars_cents: totalArsCents,
        consent_accepted: true,
        consent_accepted_at: new Date(),
        consent_terms_version: '2026-06-15',
        status: 'pending_payment',
        created_at: createdAt,
        items: {
          create: items.map((i) => ({
            product_id: i.productId,
            quantity: i.quantity,
            unit_price_ars_cents: i.unitPriceArsCents,
            product_name: i.productName,
            product_sku: i.productSku,
          })),
        },
      },
    });
    if (status !== 'pending_payment') {
      await prisma.order.update({ where: { id: order.id }, data: { status } });
    }
    return order.id;
  }

  const RANGE = {
    from: new Date('2026-08-01T00:00:00.000Z'),
    to: new Date('2026-09-01T00:00:00.000Z'),
  };

  describe('salesTimeseries', () => {
    it('agrupa por día, ordena ascendente, y excluye pending_payment/cancelled', async () => {
      await seedOrder({
        status: 'new',
        createdAt: new Date('2026-08-05T10:00:00.000Z'),
        totalArsCents: 10_000,
        items: [{ productId: productAId, productSku: 'RPT-A', productName: 'Producto A', quantity: 1, unitPriceArsCents: 10_000 }],
      });
      await seedOrder({
        status: 'delivered',
        createdAt: new Date('2026-08-10T10:00:00.000Z'),
        totalArsCents: 20_000,
        items: [{ productId: productAId, productSku: 'RPT-A', productName: 'Producto A', quantity: 1, unitPriceArsCents: 20_000 }],
      });
      await seedOrder({
        status: 'preparing',
        createdAt: new Date('2026-08-20T10:00:00.000Z'),
        totalArsCents: 30_000,
        items: [{ productId: productAId, productSku: 'RPT-A', productName: 'Producto A', quantity: 1, unitPriceArsCents: 30_000 }],
      });
      // Excluidas: no deben aparecer en ninguna fila.
      await seedOrder({
        status: 'pending_payment',
        createdAt: new Date('2026-08-15T10:00:00.000Z'),
        totalArsCents: 999_000,
        items: [{ productId: productAId, productSku: 'RPT-A', productName: 'Producto A', quantity: 1, unitPriceArsCents: 999_000 }],
      });
      await seedOrder({
        status: 'cancelled',
        createdAt: new Date('2026-08-16T10:00:00.000Z'),
        totalArsCents: 999_000,
        items: [{ productId: productAId, productSku: 'RPT-A', productName: 'Producto A', quantity: 1, unitPriceArsCents: 999_000 }],
      });

      const rows = await repo.salesTimeseries(RANGE, 'day');

      expect(rows).toHaveLength(3);
      const periodos = rows.map((r) => new Date(r.period_date).toISOString().slice(0, 10));
      expect(periodos).toEqual(['2026-08-05', '2026-08-10', '2026-08-20']);
      expect(rows[0].orders_count).toBe(1);
      expect(rows[0].total_ars_cents).toBe(10_000);
      const totalGeneral = rows.reduce((acc, r) => acc + r.total_ars_cents, 0);
      expect(totalGeneral).toBe(60_000);
    });

    it('rango sin ninguna orden devuelve array vacío, sin lanzar', async () => {
      const rows = await repo.salesTimeseries(RANGE, 'day');
      expect(rows).toEqual([]);
    });

    it('granularity=month agrupa 2 órdenes del mismo mes en una sola fila', async () => {
      await seedOrder({
        status: 'new',
        createdAt: new Date('2026-08-01T10:00:00.000Z'),
        totalArsCents: 10_000,
        items: [{ productId: productAId, productSku: 'RPT-A', productName: 'Producto A', quantity: 1, unitPriceArsCents: 10_000 }],
      });
      await seedOrder({
        status: 'new',
        createdAt: new Date('2026-08-25T10:00:00.000Z'),
        totalArsCents: 15_000,
        items: [{ productId: productAId, productSku: 'RPT-A', productName: 'Producto A', quantity: 1, unitPriceArsCents: 15_000 }],
      });

      const rows = await repo.salesTimeseries(RANGE, 'month');

      expect(rows).toHaveLength(1);
      expect(rows[0].orders_count).toBe(2);
      expect(rows[0].total_ars_cents).toBe(25_000);
    });
  });

  describe('topProducts', () => {
    it('ordena por cantidad vendida desc y respeta limit; una línea pending_payment no suma', async () => {
      // Producto A: 5 unidades en 2 órdenes (new + delivered).
      await seedOrder({
        status: 'new',
        createdAt: new Date('2026-08-05T10:00:00.000Z'),
        totalArsCents: 30_000,
        items: [{ productId: productAId, productSku: 'RPT-A', productName: 'Producto A', quantity: 3, unitPriceArsCents: 10_000 }],
      });
      await seedOrder({
        status: 'delivered',
        createdAt: new Date('2026-08-10T10:00:00.000Z'),
        totalArsCents: 20_000,
        items: [{ productId: productAId, productSku: 'RPT-A', productName: 'Producto A', quantity: 2, unitPriceArsCents: 10_000 }],
      });
      // Producto B: 2 unidades en 1 orden delivered.
      await seedOrder({
        status: 'delivered',
        createdAt: new Date('2026-08-12T10:00:00.000Z'),
        totalArsCents: 40_000,
        items: [{ productId: productBId, productSku: 'RPT-B', productName: 'Producto B', quantity: 2, unitPriceArsCents: 20_000 }],
      });
      // No debe sumar: la orden queda pending_payment.
      await seedOrder({
        status: 'pending_payment',
        createdAt: new Date('2026-08-14T10:00:00.000Z'),
        totalArsCents: 999_000,
        items: [{ productId: productBId, productSku: 'RPT-B', productName: 'Producto B', quantity: 50, unitPriceArsCents: 20_000 }],
      });

      const rows = await repo.topProducts(RANGE, 10);

      expect(rows).toHaveLength(2);
      expect(rows[0].product_id).toBe(productAId);
      expect(rows[0].quantity_sold).toBe(5);
      expect(rows[0].revenue_ars_cents).toBe(50_000);
      expect(rows[1].product_id).toBe(productBId);
      expect(rows[1].quantity_sold).toBe(2);
      expect(rows[1].revenue_ars_cents).toBe(40_000);

      const limitados = await repo.topProducts(RANGE, 1);
      expect(limitados).toHaveLength(1);
      expect(limitados[0].product_id).toBe(productAId);
    });
  });

  describe('statusBreakdown', () => {
    it('emite sólo filas de estados con al menos una orden en el rango (sin zero-fill)', async () => {
      await seedOrder({
        status: 'new',
        createdAt: new Date('2026-08-05T10:00:00.000Z'),
        totalArsCents: 10_000,
        items: [{ productId: productAId, productSku: 'RPT-A', productName: 'Producto A', quantity: 1, unitPriceArsCents: 10_000 }],
      });
      await seedOrder({
        status: 'delivered',
        createdAt: new Date('2026-08-10T10:00:00.000Z'),
        totalArsCents: 20_000,
        items: [{ productId: productAId, productSku: 'RPT-A', productName: 'Producto A', quantity: 1, unitPriceArsCents: 20_000 }],
      });
      // Fuera de la allowlist — no debe contarse ni aparecer.
      await seedOrder({
        status: 'cancelled',
        createdAt: new Date('2026-08-11T10:00:00.000Z'),
        totalArsCents: 999_000,
        items: [{ productId: productAId, productSku: 'RPT-A', productName: 'Producto A', quantity: 1, unitPriceArsCents: 999_000 }],
      });

      const rows = await repo.statusBreakdown(RANGE);

      expect(rows).toHaveLength(2);
      const totalCount = rows.reduce((acc, r) => acc + r.count, 0);
      expect(totalCount).toBe(2);
    });
  });
});
