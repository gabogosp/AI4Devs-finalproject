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

  describe('createApprovedPayment (US-010 T2.3)', () => {
    it('crea una fila approved con idempotency_key {provider}:{externalId}', async () => {
      const pago = await payments.createApprovedPayment({
        orderId: ordenId,
        provider: 'mercadopago',
        externalId: 'mp-123',
        amountArsCents: 100_000,
      });

      expect(pago.provider).toBe('mercadopago');
      expect(pago.status).toBe('approved');
      expect(pago.external_id).toBe('mp-123');
      expect(pago.idempotency_key).toBe('mercadopago:mp-123');
      expect(pago.confirmed_by).toBeNull();
    });

    it('un segundo pago con el mismo {provider, externalId} lanza OrderNotPendingPaymentError (AC-5/AC-6)', async () => {
      await payments.createApprovedPayment({
        orderId: ordenId,
        provider: 'mercadopago',
        externalId: 'mp-dup',
        amountArsCents: 100_000,
      });

      await expect(
        payments.createApprovedPayment({
          orderId: ordenId,
          provider: 'mercadopago',
          externalId: 'mp-dup',
          amountArsCents: 100_000,
        }),
      ).rejects.toBeInstanceOf(OrderNotPendingPaymentError);
    });
  });

  describe('createRefundPendingPayment (US-010 T2.3)', () => {
    it('crea una fila refund_pending con idempotency_key {provider}:{externalId}:refund', async () => {
      const pago = await payments.createRefundPendingPayment({
        orderId: ordenId,
        provider: 'mercadopago',
        externalId: 'mp-refund-1',
        amountArsCents: 100_000,
      });

      expect(pago.status).toBe('refund_pending');
      expect(pago.idempotency_key).toBe('mercadopago:mp-refund-1:refund');
    });
  });

  describe('markRefunded (US-010 T2.3)', () => {
    it('sobre una fila refund_pending, la marca refunded', async () => {
      const pago = await payments.createRefundPendingPayment({
        orderId: ordenId,
        provider: 'mercadopago',
        externalId: 'mp-refund-2',
        amountArsCents: 100_000,
      });

      const resultado = await payments.markRefunded(pago.id);

      expect(resultado?.status).toBe('refunded');
    });

    it('sobre una fila que NO está refund_pending, devuelve null y no la toca (guardado)', async () => {
      const pago = await payments.createApprovedPayment({
        orderId: ordenId,
        provider: 'mercadopago',
        externalId: 'mp-not-pending',
        amountArsCents: 100_000,
      });

      const resultado = await payments.markRefunded(pago.id);

      expect(resultado).toBeNull();
      const enBase = await prisma.payment.findUniqueOrThrow({ where: { id: pago.id } });
      expect(enBase.status).toBe('approved');
    });
  });

  describe('listRefundPending (US-010 T11.1)', () => {
    it('sólo trae provider=mercadopago en refund_pending, más viejas primero', async () => {
      const mp = await payments.createRefundPendingPayment({
        orderId: ordenId,
        provider: 'mercadopago',
        externalId: 'mp-list-1',
        amountArsCents: 100_000,
      });
      // simulated_dsm nunca se atasca — no debe aparecer en la lista.
      await payments.createRefundPendingPayment({
        orderId: ordenId,
        provider: 'simulated_dsm',
        externalId: 'sim-list-1',
        amountArsCents: 100_000,
      });
      // ya refunded — no debe aparecer.
      const yaRefunded = await payments.createRefundPendingPayment({
        orderId: ordenId,
        provider: 'mercadopago',
        externalId: 'mp-list-2',
        amountArsCents: 100_000,
      });
      await payments.markRefunded(yaRefunded.id);

      const lista = await payments.listRefundPending(10);

      expect(lista.map((p) => p.id)).toEqual([mp.id]);
    });

    it('respeta el límite', async () => {
      for (let i = 0; i < 3; i += 1) {
        await payments.createRefundPendingPayment({
          orderId: ordenId,
          provider: 'mercadopago',
          externalId: `mp-limit-${i}`,
          amountArsCents: 100_000,
        });
      }

      const lista = await payments.listRefundPending(2);

      expect(lista).toHaveLength(2);
    });
  });
});
