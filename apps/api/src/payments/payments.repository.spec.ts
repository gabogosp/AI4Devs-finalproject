import { PrismaService } from '../prisma/prisma.service';
import { OrderNotPendingPaymentError } from './payment-confirmation-errors';
import { PaymentsRepository } from './payments.repository';

/**
 * T3.1 — integración contra Postgres real: lo que hay que probar es que el
 * `idempotency_key` determinístico realmente actúa como guard (AC-5) — un
 * mock nunca ejercería la constraint UNIQUE real.
 */
describe('PaymentsRepository.createManualPayment', () => {
  const prisma = new PrismaService();
  const payments = new PaymentsRepository(prisma);
  let categoriaId = '';
  let productoId = '';
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
    productoId = (
      await prisma.product.create({
        data: {
          sku: 'PAY-A',
          slug: 'pay-a',
          name: 'Compresor',
          price_ars_cents: 100_000,
          stock: 10,
          status: 'published',
          category_id: categoriaId,
        },
      })
    ).id;
    ordenId = (
      await prisma.order.create({
        data: {
          access_token_hash: 'h-pay-a',
          buyer_name: 'Comprador de Prueba',
          buyer_email: 'comprador@test.local',
          buyer_phone: '+54 351 555 0000',
          total_ars_cents: 100_000,
          consent_accepted: true,
          consent_accepted_at: new Date(),
          consent_terms_version: '2026-06-15',
          items: {
            create: [
              {
                product_id: productoId,
                quantity: 1,
                unit_price_ars_cents: 100_000,
                product_name: 'Compresor',
                product_sku: 'PAY-A',
              },
            ],
          },
        },
      })
    ).id;
  });

  it('crea una fila provider=manual con los campos esperados', async () => {
    const pago = await payments.createManualPayment({
      orderId: ordenId,
      amountArsCents: 100_000,
      confirmedBy: 'admin',
    });

    expect(pago.provider).toBe('manual');
    expect(pago.status).toBe('approved');
    expect(pago.external_id).toBeNull();
    expect(pago.idempotency_key).toBe(`manual:${ordenId}`);
    expect(pago.confirmed_by).toBe('admin');
    expect(pago.processed_at).not.toBeNull();
  });

  it('una segunda llamada sobre la misma orden lanza OrderNotPendingPaymentError, no un P2002 crudo (AC-5)', async () => {
    await payments.createManualPayment({
      orderId: ordenId,
      amountArsCents: 100_000,
      confirmedBy: 'admin',
    });

    await expect(
      payments.createManualPayment({
        orderId: ordenId,
        amountArsCents: 100_000,
        confirmedBy: 'admin',
      }),
    ).rejects.toBeInstanceOf(OrderNotPendingPaymentError);

    expect(await prisma.payment.count({ where: { order_id: ordenId } })).toBe(1);
  });
});
