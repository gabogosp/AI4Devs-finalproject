import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from '../observability/metrics.service';
import { OrdersHistoryEventsService } from '../observability/orders-history-events.service';
import { OrdersRepository } from '../checkout/orders.repository';
import { OrderNotFoundError } from '../checkout/checkout-errors';
import { OrdersHistoryService } from './orders-history.service';

/**
 * T3.1 — integration contra el Postgres real, mismo estilo que
 * `orders-retention.service.spec.ts`: repos reales, `ConfigService` con
 * valores fijos.
 */
describe('OrdersHistoryService (integration, US-015 T3.1)', () => {
  const prisma = new PrismaService();
  const orders = new OrdersRepository(prisma);
  const config = new ConfigService({ ORDER_RETENTION_MONTHS: 12 }) as ConfigService;
  // Instancias nuevas por test (no compartidas): a diferencia de
  // `orders-retention.service.spec.ts` (donde cada describe toca un evento
  // distinto sin superponerse), acá varios tests del mismo describe llaman a
  // `service.list()`/`service.detail()` y verifican `events.count(...)` en
  // términos absolutos — compartir el contador entre tests lo contaminaría.
  let events: OrdersHistoryEventsService;
  let service: OrdersHistoryService;

  let productoId = '';

  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    events = new OrdersHistoryEventsService(new MetricsService());
    service = new OrdersHistoryService(orders, events, config);
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE orders, order_items, products, categories, customers RESTART IDENTITY CASCADE',
    );
    const cat = await prisma.category.create({
      data: { name: 'Refrigeración', slug: 'refrigeracion' },
    });
    productoId = (
      await prisma.product.create({
        data: {
          sku: 'ORD-HIST-A',
          slug: 'compresor-embraco',
          name: 'Compresor Embraco',
          price_ars_cents: 12_500_000,
          stock: 3,
          status: 'published',
          category_id: cat.id,
        },
      })
    ).id;
  });

  async function crearCliente(sufijo: string) {
    return prisma.customer.create({
      data: {
        email: `cliente-${sufijo}@test.local`,
        password_hash: 'hash-de-prueba',
        name: `Cliente ${sufijo}`,
      },
    });
  }

  async function crearOrdenConfirmadaDe(sufijo: string, customerId: string) {
    const creada = await orders.createPendingOrder({
      accessTokenHash: `h-${sufijo}`,
      buyerName: 'Comprador de Prueba',
      buyerEmail: `comprador-${sufijo}@test.local`,
      buyerPhone: '+54 351 555 0000',
      totalArsCents: 12_500_000,
      consentAcceptedAt: new Date(),
      consentTermsVersion: '2026-06-15',
      lines: [
        {
          productId: productoId,
          quantity: 1,
          unitPriceArsCents: 12_500_000,
          productName: 'Compresor Embraco',
          productSku: 'ORD-HIST-A',
        },
      ],
    });
    await prisma.order.update({ where: { id: creada.id }, data: { customer_id: customerId } });
    return orders.transitionToNewIfPending(creada.id);
  }

  describe('list', () => {
    it('con 0 órdenes, devuelve {data:[], pagination:{total:0,...}} sin lanzar', async () => {
      const cliente = await crearCliente('list-vacio');

      const page = await service.list(cliente.id, { limit: 20, offset: 0 });

      expect(page.data).toEqual([]);
      expect(page.pagination).toEqual({ limit: 20, offset: 0, total: 0 });
    });

    it('emite orders_history.list_viewed', async () => {
      const cliente = await crearCliente('list-evento');

      await service.list(cliente.id, { limit: 20, offset: 0 });

      expect(await events.count('orders_history.list_viewed')).toBe(1);
    });

    it('lista sólo las órdenes propias dentro de retención', async () => {
      const cliente = await crearCliente('list-propias');
      const orden = await crearOrdenConfirmadaDe('list-propias', cliente.id);

      const page = await service.list(cliente.id, { limit: 20, offset: 0 });

      expect(page.pagination.total).toBe(1);
      expect(page.data.map((o) => o.id)).toEqual([orden!.id]);
    });
  });

  describe('detail', () => {
    it('sobre un order_number inexistente, lanza OrderNotFoundError', async () => {
      const cliente = await crearCliente('detalle-inexistente');

      await expect(service.detail(cliente.id, 999_999)).rejects.toBeInstanceOf(
        OrderNotFoundError,
      );
    });

    it('sobre un order_number ajeno, lanza OrderNotFoundError (IDOR-safe)', async () => {
      const propio = await crearCliente('detalle-propio');
      const ajeno = await crearCliente('detalle-ajeno');
      const ordenAjena = await crearOrdenConfirmadaDe('detalle-ajena', ajeno.id);

      await expect(
        service.detail(propio.id, ordenAjena!.order_number),
      ).rejects.toBeInstanceOf(OrderNotFoundError);
    });

    it('sobre un order_number fuera de retención, lanza OrderNotFoundError', async () => {
      const cliente = await crearCliente('detalle-fuera');
      const orden = await crearOrdenConfirmadaDe('detalle-fuera', cliente.id);
      const hace13Meses = new Date();
      hace13Meses.setMonth(hace13Meses.getMonth() - 13);
      await prisma.order.update({
        where: { id: orden!.id },
        data: { created_at: hace13Meses },
      });

      await expect(
        service.detail(cliente.id, orden!.order_number),
      ).rejects.toBeInstanceOf(OrderNotFoundError);
    });

    it('emite orders_history.detail_not_found cuando no encuentra la orden', async () => {
      const cliente = await crearCliente('detalle-evento-miss');

      await expect(service.detail(cliente.id, 999_999)).rejects.toBeInstanceOf(
        OrderNotFoundError,
      );

      expect(await events.count('orders_history.detail_not_found')).toBe(1);
    });

    it('sobre una orden propia dentro de retención, la devuelve con items y emite detail_viewed', async () => {
      const cliente = await crearCliente('detalle-ok');
      const orden = await crearOrdenConfirmadaDe('detalle-ok', cliente.id);

      const detalle = await service.detail(cliente.id, orden!.order_number);

      expect(detalle.id).toBe(orden!.id);
      expect(detalle.items).toHaveLength(1);
      expect(await events.count('orders_history.detail_viewed')).toBe(1);
    });
  });
});
