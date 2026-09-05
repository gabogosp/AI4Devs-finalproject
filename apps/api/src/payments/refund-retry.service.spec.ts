import { ConfigService } from '@nestjs/config';
import { PaymentsEventsService } from '../observability/payments-events.service';
import { PrismaService } from '../prisma/prisma.service';
import { MercadoPagoClient } from './mercadopago/mercadopago-client';
import { PaymentsRepository } from './payments.repository';
import { RefundRetryService } from './refund-retry.service';

/**
 * T11.1 — contra Postgres real. `MercadoPagoClient.refund` mockeado: lo que
 * se prueba es que un fallo en UN pago no aborta el lote, y que ninguna
 * fila queda marcada fallida definitiva.
 */
describe('RefundRetryService.retryPending (US-010 T11.1)', () => {
  const prisma = new PrismaService();
  const payments = new PaymentsRepository(prisma);
  const config = new ConfigService({ REFUND_RETRY_BATCH_SIZE: 50 }) as ConfigService;

  let categoriaId = '';
  let ordenId = '';

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
    const producto = await prisma.product.create({
      data: {
        sku: 'RR-A',
        slug: 'rr-a',
        name: 'RR-A',
        price_ars_cents: 100_000,
        stock: 5,
        status: 'published',
        category_id: categoriaId,
      },
    });
    ordenId = (
      await prisma.order.create({
        data: {
          access_token_hash: 'h-rr-a',
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
                product_name: 'RR-A',
                product_sku: 'RR-A',
              },
            ],
          },
        },
      })
    ).id;
  });

  function servicio(mercadoPago: Partial<MercadoPagoClient>) {
    return new RefundRetryService(
      config,
      payments,
      mercadoPago as MercadoPagoClient,
      new PaymentsEventsService(),
    );
  }

  it('de 3 refund_pending, si el segundo falla, el 1º y 3º quedan refunded y el 2º sigue refund_pending', async () => {
    const p1 = await payments.createRefundPendingPayment({
      orderId: ordenId,
      provider: 'mercadopago',
      externalId: 'mp-rr-1',
      amountArsCents: 100_000,
    });
    const p2 = await payments.createRefundPendingPayment({
      orderId: ordenId,
      provider: 'mercadopago',
      externalId: 'mp-rr-2',
      amountArsCents: 100_000,
    });
    const p3 = await payments.createRefundPendingPayment({
      orderId: ordenId,
      provider: 'mercadopago',
      externalId: 'mp-rr-3',
      amountArsCents: 100_000,
    });

    const refund = jest.fn().mockImplementation((externalId: string) => {
      if (externalId === 'mp-rr-2') return Promise.reject(new Error('MP caído'));
      return Promise.resolve(undefined);
    });
    const servicioRetry = servicio({ refund });

    const resultado = await servicioRetry.retryPending();

    expect(resultado).toEqual({ attempted: 3, succeeded: 2, failed: 1 });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: p1.id } })).status).toBe(
      'refunded',
    );
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: p2.id } })).status).toBe(
      'refund_pending',
    );
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: p3.id } })).status).toBe(
      'refunded',
    );
  });

  it('sin ningún refund_pending, devuelve el resultado en cero', async () => {
    const servicioRetry = servicio({ refund: jest.fn() });

    const resultado = await servicioRetry.retryPending();

    expect(resultado).toEqual({ attempted: 0, succeeded: 0, failed: 0 });
  });
});
