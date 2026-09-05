import { PrismaService } from '../prisma/prisma.service';
import { OrdersRepository } from '../checkout/orders.repository';
import { OrderStatusHistoryRepository } from './order-status-history.repository';

/**
 * T4.1 — integration contra el Postgres real de docker-compose.
 */
describe('OrderStatusHistoryRepository (integration)', () => {
  const prisma = new PrismaService();
  const orders = new OrdersRepository(prisma);
  const repo = new OrderStatusHistoryRepository(prisma);

  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE orders, order_items, order_status_history, products, categories RESTART IDENTITY CASCADE',
    );
    const cat = await prisma.category.create({
      data: { name: 'Refrigeración', slug: 'refrigeracion-osh' },
    });
    await prisma.product.create({
      data: {
        sku: 'OSH-REPO-A',
        slug: 'producto-osh',
        name: 'Producto de prueba',
        price_ars_cents: 100_000,
        stock: 5,
        status: 'published',
        category_id: cat.id,
      },
    });
  });

  async function crearOrden(sufijo: string) {
    return orders.createPendingOrder({
      accessTokenHash: `h-osh-repo-${sufijo}`,
      buyerName: 'Comprador de Prueba',
      buyerEmail: `comprador-osh-repo-${sufijo}@test.local`,
      buyerPhone: '+54 351 555 0000',
      consentAcceptedAt: new Date(),
      consentTermsVersion: '2026-06-15',
      totalArsCents: 100_000,
      lines: [],
    });
  }

  it('insert con fromStatus=null inserta una fila (forward-compat, primer registro)', async () => {
    const orden = await crearOrden('null');

    await repo.insert({
      orderId: orden.id,
      fromStatus: null,
      toStatus: 'new',
      changedBy: null,
    });

    const filas = await repo.listByOrderId(orden.id);
    expect(filas).toHaveLength(1);
    expect(filas[0].from_status).toBeNull();
    expect(filas[0].to_status).toBe('new');
  });

  it('listByOrderId devuelve las filas ordenadas por changed_at ascendente', async () => {
    const orden = await crearOrden('order');

    await repo.insert({ orderId: orden.id, fromStatus: null, toStatus: 'new', changedBy: 'admin' });
    await repo.insert({ orderId: orden.id, fromStatus: 'new', toStatus: 'preparing', changedBy: 'admin' });
    await repo.insert({ orderId: orden.id, fromStatus: 'preparing', toStatus: 'ready', changedBy: 'admin' });

    const filas = await repo.listByOrderId(orden.id);

    expect(filas.map((f) => f.to_status)).toEqual(['new', 'preparing', 'ready']);
  });

  it('insert dentro de una transacción compartida (mismo patrón que updateStatusConditional)', async () => {
    const orden = await crearOrden('tx');

    await prisma.$transaction((tx) =>
      repo.insert({ orderId: orden.id, fromStatus: 'new', toStatus: 'preparing', changedBy: 'admin' }, tx),
    );

    expect(await repo.listByOrderId(orden.id)).toHaveLength(1);
  });
});
