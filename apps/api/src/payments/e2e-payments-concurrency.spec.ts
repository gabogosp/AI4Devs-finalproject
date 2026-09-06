import { OrdersRepository } from '../checkout/orders.repository';
import { NotificationPort } from '../orders/ports/notification.port';
import { PaymentsEventsService } from '../observability/payments-events.service';
import { PrismaService } from '../prisma/prisma.service';
import { StockRepository } from '../stock/stock.repository';
import { ConfirmOrderService } from './confirm-order.service';
import { MercadoPagoClient } from './mercadopago/mercadopago-client';
import { OrderAutoCancelledInsufficientStockError } from './payment-confirmation-errors';
import { PaymentsRepository } from './payments.repository';

/**
 * T14.4 — `Promise.all` sobre llamadas REALES a `ConfirmOrderService.confirm()`
 * contra Postgres real (no mock del repositorio, `qa-backend-standards.md`
 * §14). 10 órdenes distintas comparten un producto con stock=1: exactamente
 * UNA confirma, `products.stock` termina en 0 (nunca negativo). AC-8.
 */
describe('e2e-payments-concurrency', () => {
  const prisma = new PrismaService();
  const orders = new OrdersRepository(prisma);
  const stock = new StockRepository(prisma);
  const payments = new PaymentsRepository(prisma);

  let categoriaId = '';

  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE payments, orders, order_items, products, categories RESTART IDENTITY CASCADE',
    );
    categoriaId = (
      await prisma.category.create({ data: { name: 'Refrigeración', slug: 'refrigeracion' } })
    ).id;
  });

  it('10 órdenes concurrentes por 1 unidad de stock: UNA confirma, stock termina en 0 (nunca negativo)', async () => {
    const producto = await prisma.product.create({
      data: {
        sku: 'CONC-A',
        slug: 'conc-a',
        name: 'CONC-A',
        price_ars_cents: 100_000,
        stock: 1,
        status: 'published',
        category_id: categoriaId,
      },
    });

    const N = 10;
    const ordenes = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        prisma.order.create({
          data: {
            access_token_hash: `h-conc-${i}`,
            buyer_name: 'Juana Pérez',
            buyer_email: 'juana@test.local',
            buyer_phone: '+54 351 555 0000',
            total_ars_cents: 100_000,
            consent_accepted: true,
            consent_accepted_at: new Date(),
            consent_terms_version: '2026-06-15',
            items: {
              create: [
                {
                  product_id: producto.id,
                  quantity: 1,
                  unit_price_ars_cents: 100_000,
                  product_name: 'CONC-A',
                  product_sku: 'CONC-A',
                },
              ],
            },
          },
        }),
      ),
    );

    const notifications: NotificationPort = {
      orderReadyForPickup: async () => undefined,
      orderConfirmed: async () => undefined,
      ownerNewOrder: async () => undefined,
      orderCancelledNoStock: async () => undefined,
    };
    const mercadoPago = { refund: async () => undefined } as unknown as MercadoPagoClient;
    const service = new ConfirmOrderService(
      prisma,
      orders,
      stock,
      payments,
      new PaymentsEventsService(),
      notifications,
      mercadoPago,
    );

    const resultados = await Promise.allSettled(
      ordenes.map((orden, i) =>
        service.confirm({
          orderId: orden.id,
          provider: 'mercadopago',
          externalId: `mp-conc-${i}`,
          amountArsCents: 100_000,
        }),
      ),
    );

    const confirmadas = resultados.filter((r) => r.status === 'fulfilled');
    const rechazadas = resultados.filter((r) => r.status === 'rejected');
    expect(confirmadas).toHaveLength(1);
    expect(rechazadas).toHaveLength(N - 1);
    for (const r of rechazadas as PromiseRejectedResult[]) {
      expect(r.reason).toBeInstanceOf(OrderAutoCancelledInsufficientStockError);
    }

    const productoEnBase = await prisma.product.findUniqueOrThrow({ where: { id: producto.id } });
    expect(productoEnBase.stock).toBe(0); // nunca negativo

    const ordenesEnBase = await prisma.order.findMany({
      where: { id: { in: ordenes.map((o) => o.id) } },
    });
    expect(ordenesEnBase.filter((o) => o.status === 'new')).toHaveLength(1);
    expect(ordenesEnBase.filter((o) => o.status === 'cancelled')).toHaveLength(N - 1);
  });
});
