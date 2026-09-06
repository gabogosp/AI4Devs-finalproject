import { PrismaService } from '../prisma/prisma.service';
import { CustomersRepository } from '../auth/customers.repository';
import { RefreshTokensRepository } from '../auth/refresh-tokens.repository';
import { PasswordResetTokensRepository } from '../auth/password-reset-tokens.repository';
import { CartsRepository } from '../cart/carts.repository';
import { OrdersRepository } from '../checkout/orders.repository';
import { AccountEventsService } from '../observability/account-events.service';
import { AccountDeletionService } from './account-deletion.service';

/**
 * T5.3 — AC-3/AC-8/AC-12: mismo patrón que
 * `checkout/ac2-order-metrics-preserved.spec.ts` (US-021) — agregados
 * calculados ANTES de borrar la cuenta tienen que ser bit-a-bit iguales
 * DESPUÉS. Además: las N órdenes activas quedan con `reason='account_deletion'`,
 * y las M ya anonimizadas por US-021 NO se reanonimizan (AC-8).
 */
describe('AC-3/AC-8/AC-12 — órdenes anonimizadas, métricas intactas (ac3-ac8-ac12-account-orders-preserved)', () => {
  const prisma = new PrismaService();
  const customers = new CustomersRepository(prisma);
  const orders = new OrdersRepository(prisma);
  const HASH = '$2b$12$'.padEnd(60, 'x');
  let service: AccountDeletionService;
  let productoId = '';

  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE orders, order_items, customers, products, categories RESTART IDENTITY CASCADE',
    );
    const cat = await prisma.category.create({
      data: { name: 'Refrigeración', slug: 'refrigeracion-ac3-ac8' },
    });
    productoId = (
      await prisma.product.create({
        data: {
          sku: 'AC3-A',
          slug: 'compresor-ac3',
          name: 'Compresor',
          price_ars_cents: 850_000,
          stock: 10,
          status: 'published',
          category_id: cat.id,
        },
      })
    ).id;
    service = new AccountDeletionService(
      prisma,
      customers,
      new RefreshTokensRepository(prisma),
      new PasswordResetTokensRepository(prisma),
      new CartsRepository(prisma),
      orders,
      new AccountEventsService(),
    );
  });

  async function agregados() {
    const [totales, itemAgg] = await Promise.all([
      prisma.order.aggregate({ _sum: { total_ars_cents: true }, _count: true }),
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

  async function sembrarOrden(customerId: string, sufijo: string, status: string) {
    const orden = await prisma.order.create({
      data: {
        access_token_hash: `h-ac3ac8-${sufijo}`,
        customer_id: customerId,
        buyer_name: 'Comprador de Prueba',
        buyer_email: 'comprador@test.local',
        buyer_phone: '+54 351 555 0000',
        total_ars_cents: 850_000,
        status,
        consent_accepted: true,
        consent_accepted_at: new Date(),
        consent_terms_version: '2026-06-15',
        items: {
          create: [
            {
              product_id: productoId,
              quantity: 1,
              unit_price_ars_cents: 850_000,
              product_name: 'Compresor',
              product_sku: 'AC3-A',
            },
          ],
        },
      },
    });
    return orden;
  }

  it('N órdenes activas quedan con reason=account_deletion; M ya anonimizadas por US-021 no se tocan; agregados bit-a-bit iguales', async () => {
    const cliente = await customers.create({
      email: 'ac3ac8@test.local',
      name: 'Cliente AC3AC8',
      passwordHash: HASH,
    });

    const activa1 = await sembrarOrden(cliente.id, 'activa-1', 'delivered');
    const activa2 = await sembrarOrden(cliente.id, 'activa-2', 'cancelled');
    const yaAnonimizada = await sembrarOrden(cliente.id, 'ya-anon', 'delivered');
    await orders.anonymize(yaAnonimizada.id, 'retention_policy');
    const previa = await prisma.order.findUniqueOrThrow({ where: { id: yaAnonimizada.id } });

    const antes = await agregados();

    await service.deleteAccount(cliente.id);

    const despues = await agregados();
    expect(despues.totalArsCents).toEqual(antes.totalArsCents);
    expect(despues.count).toEqual(antes.count);
    expect(despues.cantidadesPorProducto).toEqual(antes.cantidadesPorProducto);

    const [releidaActiva1, releidaActiva2, releidaYaAnon] = await Promise.all([
      prisma.order.findUniqueOrThrow({ where: { id: activa1.id } }),
      prisma.order.findUniqueOrThrow({ where: { id: activa2.id } }),
      prisma.order.findUniqueOrThrow({ where: { id: yaAnonimizada.id } }),
    ]);
    expect(releidaActiva1.anonymization_reason).toBe('account_deletion');
    expect(releidaActiva2.anonymization_reason).toBe('account_deletion');

    // AC-8 — la ya anonimizada por US-021 no se reanonimiza: mismo reason y
    // mismo anonymized_at que antes del borrado de cuenta.
    expect(releidaYaAnon.anonymization_reason).toBe('retention_policy');
    expect(releidaYaAnon.anonymized_at?.getTime()).toBe(previa.anonymized_at?.getTime());
  });
});
