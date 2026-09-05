import { PrismaService } from '../prisma/prisma.service';
import { OrdersRepository } from './orders.repository';

/**
 * T5.3 — AC-2: el valor comercial y las métricas de US-016 se preservan al
 * anonimizar. Se siembran N órdenes con ítems, importes y fechas conocidas,
 * se calculan agregados ANTES de anonimizar, se anonimiza todo el conjunto,
 * y se recalculan los mismos agregados: tienen que ser bit-a-bit iguales.
 */
describe('AC-2: el valor comercial no cambia al anonimizar (ac2-order-metrics-preserved)', () => {
  const prisma = new PrismaService();
  const orders = new OrdersRepository(prisma);

  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE orders, order_items, products, categories RESTART IDENTITY CASCADE',
    );
  });

  async function agregados() {
    const [totales, itemAgg] = await Promise.all([
      prisma.order.aggregate({
        _sum: { total_ars_cents: true },
        _count: true,
      }),
      prisma.orderItem.groupBy({
        by: ['product_id'],
        _sum: { quantity: true },
        orderBy: { product_id: 'asc' },
      }),
    ]);
    return {
      totalArsCents: totales._sum.total_ars_cents,
      count: totales._count,
      cantidadesPorProducto: itemAgg.map((r) => ({
        productId: r.product_id,
        cantidad: r._sum.quantity,
      })),
    };
  }

  it('sum(total), count(*) y sum(quantity) por producto son idénticos antes y después de anonimizar el conjunto', async () => {
    const cat = await prisma.category.create({
      data: { name: 'Refrigeración', slug: 'refrigeracion-ac2' },
    });
    const productoA = await prisma.product.create({
      data: {
        sku: 'AC2-A',
        slug: 'compresor-ac2',
        name: 'Compresor Embraco',
        price_ars_cents: 12_500_000,
        stock: 10,
        status: 'published',
        category_id: cat.id,
      },
    });
    const productoB = await prisma.product.create({
      data: {
        sku: 'AC2-B',
        slug: 'gas-ac2',
        name: 'Gas R134a',
        price_ars_cents: 850_000,
        stock: 20,
        status: 'published',
        category_id: cat.id,
      },
    });

    async function sembrarOrden(sufijo: string, cantidadA: number, cantidadB: number) {
      return prisma.order.create({
        data: {
          access_token_hash: `h-ac2-${sufijo}`,
          buyer_name: `Comprador ${sufijo}`,
          buyer_email: `comprador-${sufijo}@test.local`,
          buyer_phone: '+54 351 555 0000',
          total_ars_cents: cantidadA * 12_500_000 + cantidadB * 850_000,
          consent_accepted: true,
          consent_accepted_at: new Date(),
          consent_terms_version: '2026-06-15',
          items: {
            create: [
              ...(cantidadA > 0
                ? [
                    {
                      product_id: productoA.id,
                      quantity: cantidadA,
                      unit_price_ars_cents: 12_500_000,
                      product_name: 'Compresor Embraco',
                      product_sku: 'AC2-A',
                    },
                  ]
                : []),
              ...(cantidadB > 0
                ? [
                    {
                      product_id: productoB.id,
                      quantity: cantidadB,
                      unit_price_ars_cents: 850_000,
                      product_name: 'Gas R134a',
                      product_sku: 'AC2-B',
                    },
                  ]
                : []),
            ],
          },
        },
      });
    }

    const orden1 = await sembrarOrden('1', 1, 2);
    const orden2 = await sembrarOrden('2', 0, 3);
    const orden3 = await sembrarOrden('3', 2, 0);

    const antes = await agregados();

    await orders.anonymize(orden1.id, 'requested');
    await orders.anonymize(orden2.id, 'requested');
    await orders.anonymize(orden3.id, 'retention_policy');

    const despues = await agregados();

    expect(despues.totalArsCents).toEqual(antes.totalArsCents);
    expect(despues.count).toEqual(antes.count);
    expect(despues.cantidadesPorProducto).toEqual(antes.cantidadesPorProducto);
  });
});
