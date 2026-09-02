import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersRepository } from './orders.repository';
import { MetricsService } from '../observability/metrics.service';
import { OrdersRetentionEventsService } from '../observability/orders-retention-events.service';
import { OrdersRetentionService } from './orders-retention.service';

/**
 * T5.4 — AC-6 (negative-space): el barrido de retención NUNCA borra una
 * orden ni sus ítems, aunque estén vencidos.
 */
describe('AC-6: ninguna orden ni ítem se borra al anonimizar (ac6-order-not-deleted)', () => {
  const prisma = new PrismaService();
  const orders = new OrdersRepository(prisma);
  const events = new OrdersRetentionEventsService(new MetricsService());
  const config = new ConfigService({ ORDER_RETENTION_MONTHS: 12 }) as ConfigService;
  const service = new OrdersRetentionService(orders, events, config);

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

  it('el conteo de filas de orders y order_items es idéntico antes y después del barrido', async () => {
    const cat = await prisma.category.create({
      data: { name: 'Refrigeración', slug: 'refrigeracion-ac6' },
    });
    const producto = await prisma.product.create({
      data: {
        sku: 'AC6-A',
        slug: 'compresor-ac6',
        name: 'Compresor Embraco',
        price_ars_cents: 12_500_000,
        stock: 5,
        status: 'published',
        category_id: cat.id,
      },
    });

    async function sembrarOrden(sufijo: string) {
      return prisma.order.create({
        data: {
          access_token_hash: `h-ac6-${sufijo}`,
          buyer_name: `Comprador ${sufijo}`,
          buyer_email: `comprador-${sufijo}@test.local`,
          buyer_phone: '+54 351 555 0000',
          total_ars_cents: 12_500_000,
          consent_accepted: true,
          consent_accepted_at: new Date(),
          consent_terms_version: '2026-06-15',
          items: {
            create: [
              {
                product_id: producto.id,
                quantity: 1,
                unit_price_ars_cents: 12_500_000,
                product_name: 'Compresor Embraco',
                product_sku: 'AC6-A',
              },
            ],
          },
        },
      });
    }

    const vencida1 = await sembrarOrden('vencida-1');
    const vencida2 = await sembrarOrden('vencida-2');
    await sembrarOrden('reciente');

    const hace13Meses = new Date();
    hace13Meses.setMonth(hace13Meses.getMonth() - 13);
    await prisma.order.update({ where: { id: vencida1.id }, data: { created_at: hace13Meses } });
    await prisma.order.update({ where: { id: vencida2.id }, data: { created_at: hace13Meses } });

    const ordersAntes = await prisma.order.count();
    const itemsAntes = await prisma.orderItem.count();

    const anonimizadas = await service.runRetentionSweep();

    const ordersDespues = await prisma.order.count();
    const itemsDespues = await prisma.orderItem.count();

    expect(anonimizadas).toBe(2);
    expect(ordersDespues).toBe(ordersAntes);
    expect(itemsDespues).toBe(itemsAntes);
  });
});
