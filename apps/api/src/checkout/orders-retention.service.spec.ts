import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from '../observability/metrics.service';
import { OrdersRetentionEventsService } from '../observability/orders-retention-events.service';
import { OrderNotFoundError } from './checkout-errors';
import { OrdersRepository } from './orders.repository';
import { OrdersRetentionService } from './orders-retention.service';

/**
 * T3.1-T3.2 — integration contra el Postgres real, mismo estilo que
 * `checkout.service.spec.ts`: repos reales, `ConfigService` con valores fijos.
 */
describe('OrdersRetentionService (integration)', () => {
  const prisma = new PrismaService();
  const orders = new OrdersRepository(prisma);
  const metrics = new MetricsService();
  const events = new OrdersRetentionEventsService(metrics);
  const config = new ConfigService({ ORDER_RETENTION_MONTHS: 12 }) as ConfigService;
  const service = new OrdersRetentionService(orders, events, config);

  let productoId = '';

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
    const cat = await prisma.category.create({
      data: { name: 'Refrigeración', slug: 'refrigeracion' },
    });
    productoId = (
      await prisma.product.create({
        data: {
          sku: 'ORD-RET-A',
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

  async function crearOrden(sufijo: string) {
    return orders.createPendingOrder({
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
          productSku: 'ORD-RET-A',
        },
      ],
    });
  }

  describe('anonymizeOnRequest (US-021 T3.1, AC-3/AC-4/AC-9-en-espíritu)', () => {
    it('sobre un id existente sin anonimizar, anonimiza y emite el evento', async () => {
      const orden = await crearOrden('req-happy');

      const resultado = await service.anonymizeOnRequest(orden.id);

      expect(resultado.anonymizationReason).toBe('requested');
      expect(await events.count('orders_retention.anonymized_on_request')).toBe(1);
    });

    it('sobre un id ya anonimizado, devuelve el mismo resultado sin lanzar y SIN un segundo evento', async () => {
      const orden = await crearOrden('req-noop');

      const primera = await service.anonymizeOnRequest(orden.id);
      const antes = await events.count('orders_retention.anonymized_on_request');
      const segunda = await service.anonymizeOnRequest(orden.id);
      const despues = await events.count('orders_retention.anonymized_on_request');

      expect(segunda.anonymizedAt).toEqual(primera.anonymizedAt);
      expect(despues).toBe(antes); // sin segundo evento
    });

    it('sobre un id inexistente, lanza OrderNotFoundError', async () => {
      const inexistente = '00000000-0000-0000-0000-000000000000';
      await expect(service.anonymizeOnRequest(inexistente)).rejects.toBeInstanceOf(
        OrderNotFoundError,
      );
    });
  });

  describe('runRetentionSweep (US-021 T3.2, AC-1/AC-4)', () => {
    it('con el config default (12 meses), anonimiza lo vencido y no toca lo reciente', async () => {
      const vencida = await crearOrden('sweep-old');
      const reciente = await crearOrden('sweep-new');

      const hace13Meses = new Date();
      hace13Meses.setMonth(hace13Meses.getMonth() - 13);
      const hace6Meses = new Date();
      hace6Meses.setMonth(hace6Meses.getMonth() - 6);

      await prisma.order.update({ where: { id: vencida.id }, data: { created_at: hace13Meses } });
      await prisma.order.update({ where: { id: reciente.id }, data: { created_at: hace6Meses } });

      const count = await service.runRetentionSweep();

      expect(count).toBe(1);
      const vencidaReleida = await prisma.order.findUniqueOrThrow({ where: { id: vencida.id } });
      const recienteReleida = await prisma.order.findUniqueOrThrow({ where: { id: reciente.id } });
      expect(vencidaReleida.anonymized_at).not.toBeNull();
      expect(vencidaReleida.anonymization_reason).toBe('retention_policy');
      expect(recienteReleida.anonymized_at).toBeNull();
    });

    it('el evento agregado lleva el conteo correcto en fields.anonymized_count, incluso count=0', async () => {
      const capturado: Array<Record<string, unknown>> = [];
      jest
        .spyOn(events['logger'], 'log')
        .mockImplementation((p: unknown) => void capturado.push(p as Record<string, unknown>));

      const count = await service.runRetentionSweep();

      expect(count).toBe(0);
      expect(capturado[capturado.length - 1]).toMatchObject({
        event: 'orders_retention.swept',
        anonymized_count: 0,
      });
    });
  });
});
