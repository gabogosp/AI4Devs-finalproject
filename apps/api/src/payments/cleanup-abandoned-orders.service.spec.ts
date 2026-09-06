import { ConfigService } from '@nestjs/config';
import { OrdersRepository } from '../checkout/orders.repository';
import { PrismaService } from '../prisma/prisma.service';
import { CleanupAbandonedOrdersService } from './cleanup-abandoned-orders.service';

/**
 * T10.1 — contra Postgres real. `ORDER_ABANDON_HOURS=48`: una orden de hace
 * 49h queda cancelada, una de hace 47h no se toca.
 */
describe('CleanupAbandonedOrdersService.cleanupAbandoned (US-010 T10.1)', () => {
  const prisma = new PrismaService();
  const orders = new OrdersRepository(prisma);
  const config = new ConfigService({ ORDER_ABANDON_HOURS: 48 }) as ConfigService;
  const service = new CleanupAbandonedOrdersService(config, orders);

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

  async function sembrarOrdenConEdad(sku: string, horasDeAntiguedad: number) {
    const producto = await prisma.product.create({
      data: {
        sku,
        slug: sku.toLowerCase(),
        name: sku,
        price_ars_cents: 100_000,
        stock: 5,
        status: 'published',
        category_id: categoriaId,
      },
    });
    const orden = await prisma.order.create({
      data: {
        access_token_hash: `h-${sku}`,
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
              product_name: sku,
              product_sku: sku,
            },
          ],
        },
      },
    });
    await prisma.order.update({
      where: { id: orden.id },
      data: { created_at: new Date(Date.now() - horasDeAntiguedad * 3_600_000) },
    });
    return orden;
  }

  it('una orden de hace 49h (ORDER_ABANDON_HOURS=48) queda cancelled', async () => {
    const orden = await sembrarOrdenConEdad('CLEAN-A', 49);

    const resultado = await service.cleanupAbandoned();

    expect(resultado).toEqual({ cancelled: 1 });
    const ordenEnBase = await prisma.order.findUniqueOrThrow({ where: { id: orden.id } });
    expect(ordenEnBase.status).toBe('cancelled');
    expect(ordenEnBase.cancelled_at).not.toBeNull();
  });

  it('una orden de hace 47h NO se toca', async () => {
    const orden = await sembrarOrdenConEdad('CLEAN-B', 47);

    const resultado = await service.cleanupAbandoned();

    expect(resultado).toEqual({ cancelled: 0 });
    const ordenEnBase = await prisma.order.findUniqueOrThrow({ where: { id: orden.id } });
    expect(ordenEnBase.status).toBe('pending_payment');
    expect(ordenEnBase.cancelled_at).toBeNull();
  });

  it('el conteo devuelto refleja exactamente las filas afectadas, con órdenes mixtas', async () => {
    await sembrarOrdenConEdad('CLEAN-C', 72);
    await sembrarOrdenConEdad('CLEAN-D', 60);
    await sembrarOrdenConEdad('CLEAN-E', 1);

    const resultado = await service.cleanupAbandoned();

    expect(resultado).toEqual({ cancelled: 2 });
  });
});
