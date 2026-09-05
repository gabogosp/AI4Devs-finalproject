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
 * T5.2-T5.6 — la rama `provider !== 'manual'` de `ConfirmOrderService.confirm`,
 * contra Postgres real. La rama `manual` (US-023) tiene su propia suite
 * congelada en `confirm-order.service.spec.ts`, sin tocar.
 */
describe('ConfirmOrderService.confirm — providers automáticos (US-010)', () => {
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

  async function crearProducto(sku: string, stockInicial: number) {
    return prisma.product.create({
      data: {
        sku,
        slug: sku.toLowerCase(),
        name: sku,
        price_ars_cents: 100_000,
        stock: stockInicial,
        status: 'published',
        category_id: categoriaId,
      },
    });
  }

  async function crearOrdenPendiente(lineas: { productId: string; quantity: number }[]) {
    return prisma.order.create({
      data: {
        access_token_hash: `h-${Math.random()}`,
        buyer_name: 'Comprador de Prueba',
        buyer_email: 'comprador@test.local',
        buyer_phone: '+54 351 555 0000',
        total_ars_cents: lineas.length * 100_000,
        consent_accepted: true,
        consent_accepted_at: new Date(),
        consent_terms_version: '2026-06-15',
        items: {
          create: lineas.map((l) => ({
            product_id: l.productId,
            quantity: l.quantity,
            unit_price_ars_cents: 100_000,
            product_name: 'x',
            product_sku: 'x',
          })),
        },
      },
      include: { items: true },
    });
  }

  function notificationsMock(): jest.Mocked<NotificationPort> {
    return {
      orderReadyForPickup: jest.fn().mockResolvedValue(undefined),
      orderConfirmed: jest.fn().mockResolvedValue(undefined),
      ownerNewOrder: jest.fn().mockResolvedValue(undefined),
      orderCancelledNoStock: jest.fn().mockResolvedValue(undefined),
    };
  }

  function mercadoPagoMock(): jest.Mocked<Pick<MercadoPagoClient, 'refund'>> {
    return { refund: jest.fn().mockResolvedValue(undefined) };
  }

  function servicio(opts: {
    notifications?: jest.Mocked<NotificationPort>;
    mercadoPago?: jest.Mocked<Pick<MercadoPagoClient, 'refund'>>;
    events?: PaymentsEventsService;
  } = {}) {
    return new ConfirmOrderService(
      prisma,
      orders,
      stock,
      payments,
      opts.events ?? new PaymentsEventsService(),
      opts.notifications,
      opts.mercadoPago as unknown as MercadoPagoClient,
    );
  }

  describe('happy path (T5.1-T5.3)', () => {
    it('mercadopago: pasa a new, stock decrementado, payments con provider=mercadopago (AC-1, AC-9)', async () => {
      const producto = await crearProducto('CONF-MP-A', 10);
      const orden = await crearOrdenPendiente([{ productId: producto.id, quantity: 3 }]);
      const notifications = notificationsMock();
      const service = servicio({ notifications });

      const resultado = await service.confirm({
        orderId: orden.id,
        provider: 'mercadopago',
        externalId: 'mp-ext-1',
        amountArsCents: 300_000,
      });

      expect(resultado.status).toBe('new');
      const pago = await prisma.payment.findUniqueOrThrow({ where: { id: resultado.paymentId } });
      expect(pago.provider).toBe('mercadopago');
      expect(pago.status).toBe('approved');
      expect(pago.idempotency_key).toBe('mercadopago:mp-ext-1');
      expect(pago.confirmed_by).toBeNull();
    });

    it('simulated_dsm pasa por el MISMO camino que mercadopago (AC-9 estructural)', async () => {
      const producto = await crearProducto('CONF-SIM-A', 10);
      const orden = await crearOrdenPendiente([{ productId: producto.id, quantity: 1 }]);
      const service = servicio({ notifications: notificationsMock() });

      const resultado = await service.confirm({
        orderId: orden.id,
        provider: 'simulated_dsm',
        externalId: 'sim-ext-1',
        amountArsCents: 100_000,
      });

      const pago = await prisma.payment.findUniqueOrThrow({ where: { id: resultado.paymentId } });
      expect(pago.provider).toBe('simulated_dsm');
      expect(pago.status).toBe('approved');
    });

    it('emite payments.provider_confirmed, NUNCA payments.manual_confirmed (T5.2)', async () => {
      const producto = await crearProducto('CONF-MP-EV', 10);
      const orden = await crearOrdenPendiente([{ productId: producto.id, quantity: 1 }]);
      const events = new PaymentsEventsService();
      const emitConfirmedSpy = jest.spyOn(events, 'emitConfirmed');
      const emitProviderConfirmedSpy = jest.spyOn(events, 'emitProviderConfirmed');
      const service = servicio({ notifications: notificationsMock(), events });

      await service.confirm({
        orderId: orden.id,
        provider: 'mercadopago',
        externalId: 'mp-ext-ev',
        amountArsCents: 100_000,
      });

      expect(emitProviderConfirmedSpy).toHaveBeenCalledWith(orden.id, 'mercadopago');
      expect(emitConfirmedSpy).not.toHaveBeenCalled();
    });

    it('notifica orderConfirmed + ownerNewOrder tras el commit (T5.3)', async () => {
      const producto = await crearProducto('CONF-MP-NOTIF', 10);
      const orden = await crearOrdenPendiente([{ productId: producto.id, quantity: 1 }]);
      const notifications = notificationsMock();
      const service = servicio({ notifications });

      await service.confirm({
        orderId: orden.id,
        provider: 'mercadopago',
        externalId: 'mp-ext-notif',
        amountArsCents: 100_000,
      });

      expect(notifications.orderConfirmed).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: orden.id, buyerName: 'Comprador de Prueba' }),
      );
      expect(notifications.ownerNewOrder).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: orden.id, totalArsCents: orden.total_ars_cents }),
      );
    });

    it('un NotificationPort que lanza NO revierte la confirmación ya comiteada (T5.3 Exit criterion)', async () => {
      const producto = await crearProducto('CONF-MP-NOTIF-FAIL', 10);
      const orden = await crearOrdenPendiente([{ productId: producto.id, quantity: 1 }]);
      const notifications = notificationsMock();
      notifications.orderConfirmed.mockRejectedValue(new Error('boom'));
      const service = servicio({ notifications });

      const resultado = await service.confirm({
        orderId: orden.id,
        provider: 'mercadopago',
        externalId: 'mp-ext-fail-notif',
        amountArsCents: 100_000,
      });

      expect(resultado.status).toBe('new');
      const ordenEnBase = await prisma.order.findUniqueOrThrow({ where: { id: orden.id } });
      expect(ordenEnBase.status).toBe('new');
    });
  });

  describe('stock insuficiente — compensación (T5.4-T5.6)', () => {
    it('mercadopago: cancela, refund_pending, llama MercadoPagoClient.refund, éxito → refunded (AC-4)', async () => {
      const producto = await crearProducto('CONF-MP-NOSTOCK', 1);
      const orden = await crearOrdenPendiente([{ productId: producto.id, quantity: 5 }]);
      const notifications = notificationsMock();
      const mercadoPago = mercadoPagoMock();
      const service = servicio({ notifications, mercadoPago });

      await expect(
        service.confirm({
          orderId: orden.id,
          provider: 'mercadopago',
          externalId: 'mp-ext-nostock',
          amountArsCents: 500_000,
        }),
      ).rejects.toBeInstanceOf(OrderAutoCancelledInsufficientStockError);

      const ordenEnBase = await prisma.order.findUniqueOrThrow({ where: { id: orden.id } });
      expect(ordenEnBase.status).toBe('cancelled');
      expect(ordenEnBase.cancelled_at).not.toBeNull();

      const productoEnBase = await prisma.product.findUniqueOrThrow({ where: { id: producto.id } });
      expect(productoEnBase.stock).toBe(1); // rollback completo, nunca decrementó

      expect(mercadoPago.refund).toHaveBeenCalledWith('mp-ext-nostock', 500_000);
      const pago = await prisma.payment.findFirstOrThrow({ where: { order_id: orden.id } });
      expect(pago.status).toBe('refunded');
      expect(notifications.orderCancelledNoStock).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: orden.id }),
      );
    });

    it('simulated_dsm: markRefunded directo, SIN llamar a MercadoPagoClient.refund', async () => {
      const producto = await crearProducto('CONF-SIM-NOSTOCK', 1);
      const orden = await crearOrdenPendiente([{ productId: producto.id, quantity: 5 }]);
      const mercadoPago = mercadoPagoMock();
      const service = servicio({ notifications: notificationsMock(), mercadoPago });

      await expect(
        service.confirm({
          orderId: orden.id,
          provider: 'simulated_dsm',
          externalId: 'sim-ext-nostock',
          amountArsCents: 500_000,
        }),
      ).rejects.toBeInstanceOf(OrderAutoCancelledInsufficientStockError);

      expect(mercadoPago.refund).not.toHaveBeenCalled();
      const pago = await prisma.payment.findFirstOrThrow({ where: { order_id: orden.id } });
      expect(pago.status).toBe('refunded');
    });

    it('si MercadoPagoClient.refund falla, la fila QUEDA refund_pending (nunca fallido definitivo, AC-4 durable)', async () => {
      const producto = await crearProducto('CONF-MP-REFUND-FAIL', 1);
      const orden = await crearOrdenPendiente([{ productId: producto.id, quantity: 5 }]);
      const mercadoPago = mercadoPagoMock();
      mercadoPago.refund.mockRejectedValue(new Error('MP caído'));
      const events = new PaymentsEventsService();
      const emitRefundFailedSpy = jest.spyOn(events, 'emitRefundFailed');
      const service = servicio({ notifications: notificationsMock(), mercadoPago, events });

      await expect(
        service.confirm({
          orderId: orden.id,
          provider: 'mercadopago',
          externalId: 'mp-ext-refund-fail',
          amountArsCents: 500_000,
        }),
      ).rejects.toBeInstanceOf(OrderAutoCancelledInsufficientStockError);

      const pago = await prisma.payment.findFirstOrThrow({ where: { order_id: orden.id } });
      expect(pago.status).toBe('refund_pending');
      expect(emitRefundFailedSpy).toHaveBeenCalledWith(orden.id, pago.id);
    });
  });
});
