import { OrdersRepository } from '../checkout/orders.repository';
import { OrderStatusHistoryRepository } from '../orders/order-status-history.repository';
import { NotificationPort } from '../orders/ports/notification.port';
import { PaymentsEventsService } from '../observability/payments-events.service';
import { PrismaService } from '../prisma/prisma.service';
import { StockRepository } from '../stock/stock.repository';
import { CancelOrderService } from './cancel-order.service';
import { MercadoPagoClient } from './mercadopago/mercadopago-client';
import { OrderCannotBeCancelledError, OrderNotFoundError } from './payment-confirmation-errors';
import { PaymentsRepository } from './payments.repository';

/**
 * T5.2 — integración contra Postgres real, mismo estilo que
 * `confirm-order.service.spec.ts`: las propiedades que un mock no podría
 * demostrar (reintegro DE VERDAD, idempotencia estructural DE VERDAD) más
 * los 7 escenarios obligatorios del plan (`tasks.md` T5.2).
 */
describe('CancelOrderService.cancel (US-013)', () => {
  const prisma = new PrismaService();
  const orders = new OrdersRepository(prisma);
  const stock = new StockRepository(prisma);
  const payments = new PaymentsRepository(prisma);
  const history = new OrderStatusHistoryRepository(prisma);

  let categoriaId = '';
  let mercadoPago: jest.Mocked<Pick<MercadoPagoClient, 'refund'>>;
  let notifications: jest.Mocked<NotificationPort>;
  let service: CancelOrderService;

  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE payments, order_status_history, orders, order_items, products, categories RESTART IDENTITY CASCADE',
    );
    categoriaId = (
      await prisma.category.create({ data: { name: 'Refrigeración', slug: 'refrigeracion' } })
    ).id;

    mercadoPago = { refund: jest.fn().mockResolvedValue(undefined) };
    notifications = {
      orderReadyForPickup: jest.fn().mockResolvedValue(undefined),
      orderConfirmed: jest.fn().mockResolvedValue(undefined),
      ownerNewOrder: jest.fn().mockResolvedValue(undefined),
      orderCancelledNoStock: jest.fn().mockResolvedValue(undefined),
      orderCancelledByOwner: jest.fn().mockResolvedValue(undefined),
    };
    service = new CancelOrderService(
      prisma,
      orders,
      stock,
      payments,
      history,
      new PaymentsEventsService(),
      notifications,
      mercadoPago as unknown as MercadoPagoClient,
    );
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

  async function crearOrdenConEstado(
    lineas: { productId: string; quantity: number }[],
    status: string,
  ) {
    return prisma.order.create({
      data: {
        access_token_hash: `h-${Math.random()}`,
        buyer_name: 'Comprador de Prueba',
        buyer_email: 'comprador@test.local',
        buyer_phone: '+54 351 555 0000',
        total_ars_cents: lineas.length * 100_000,
        status,
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

  async function crearPagoAprobado(
    orderId: string,
    provider: 'mercadopago' | 'simulated_dsm',
    externalId: string,
  ) {
    return payments.createApprovedPayment({
      orderId,
      provider,
      externalId,
      amountArsCents: 100_000,
    });
  }

  it('escenario 1 — happy path mercadopago: cancela, reintegra stock, refund llamado, refunded, historial, notifica (AC-1,AC-2,AC-3,AC-4,AC-10)', async () => {
    const producto = await crearProducto('CANC-A', 7);
    const orden = await crearOrdenConEstado([{ productId: producto.id, quantity: 3 }], 'new');
    const pago = await crearPagoAprobado(orden.id, 'mercadopago', 'mp-cancel-1');

    const resultado = await service.cancel(orden.id, 'admin-1');

    expect(resultado.order.status).toBe('cancelled');
    expect(resultado.refund.status).toBe('refunded');
    expect(resultado.refund.provider).toBe('mercadopago');

    const productoEnBase = await prisma.product.findUniqueOrThrow({ where: { id: producto.id } });
    expect(productoEnBase.stock).toBe(10); // 7 + 3 reintegrado

    expect(mercadoPago.refund).toHaveBeenCalledWith(pago.external_id, pago.amount_ars_cents);

    const pagoEnBase = await prisma.payment.findUniqueOrThrow({ where: { id: pago.id } });
    expect(pagoEnBase.status).toBe('refunded');

    const historial = await prisma.orderStatusHistory.findMany({ where: { order_id: orden.id } });
    expect(historial).toHaveLength(1);
    expect(historial[0].to_status).toBe('cancelled');
    expect(historial[0].changed_by).toBe('admin-1');

    expect(notifications.orderCancelledByOwner).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: orden.id }),
    );
  });

  it('escenario 2 — provider=simulated_dsm: cancela, refunded SIN llamar mercadoPago.refund (AC-5)', async () => {
    const producto = await crearProducto('CANC-B', 5);
    const orden = await crearOrdenConEstado([{ productId: producto.id, quantity: 2 }], 'preparing');
    const pago = await crearPagoAprobado(orden.id, 'simulated_dsm', 'sim-cancel-1');

    const resultado = await service.cancel(orden.id, 'admin-1');

    expect(resultado.refund.status).toBe('refunded');
    expect(resultado.refund.provider).toBe('simulated_dsm');
    expect(mercadoPago.refund).not.toHaveBeenCalled();

    const pagoEnBase = await prisma.payment.findUniqueOrThrow({ where: { id: pago.id } });
    expect(pagoEnBase.status).toBe('refunded');
  });

  it('escenario 3 — provider=manual: mismo no-op externo que simulated_dsm (design.md D3)', async () => {
    const producto = await crearProducto('CANC-C', 5);
    const orden = await crearOrdenConEstado([{ productId: producto.id, quantity: 1 }], 'ready');
    const pago = await payments.createManualPayment({
      orderId: orden.id,
      amountArsCents: 100_000,
      confirmedBy: 'admin-0',
    });

    const resultado = await service.cancel(orden.id, 'admin-1');

    expect(resultado.refund.status).toBe('refunded');
    expect(resultado.refund.provider).toBe('manual');
    expect(mercadoPago.refund).not.toHaveBeenCalled();

    const pagoEnBase = await prisma.payment.findUniqueOrThrow({ where: { id: pago.id } });
    expect(pagoEnBase.status).toBe('refunded');
  });

  it('escenario 4 — AC-7: orden delivered → OrderCannotBeCancelledError (409), stock y historial sin tocar', async () => {
    const producto = await crearProducto('CANC-D', 5);
    const orden = await crearOrdenConEstado(
      [{ productId: producto.id, quantity: 2 }],
      'delivered',
    );

    await expect(service.cancel(orden.id, 'admin-1')).rejects.toBeInstanceOf(
      OrderCannotBeCancelledError,
    );

    const productoEnBase = await prisma.product.findUniqueOrThrow({ where: { id: producto.id } });
    expect(productoEnBase.stock).toBe(5); // sin tocar

    expect(
      await prisma.orderStatusHistory.count({ where: { order_id: orden.id } }),
    ).toBe(0);
  });

  it('escenario 5 — AC-8: cancelar dos veces es idempotente (sin doble reintegro, doble refund ni doble notificación)', async () => {
    const producto = await crearProducto('CANC-E', 5);
    const orden = await crearOrdenConEstado([{ productId: producto.id, quantity: 2 }], 'new');
    await crearPagoAprobado(orden.id, 'mercadopago', 'mp-cancel-idem');

    const primera = await service.cancel(orden.id, 'admin-1');
    const segunda = await service.cancel(orden.id, 'admin-1');

    expect(primera.order.status).toBe('cancelled');
    expect(segunda.order.status).toBe('cancelled');

    const productoEnBase = await prisma.product.findUniqueOrThrow({ where: { id: producto.id } });
    expect(productoEnBase.stock).toBe(7); // 5 + 2, reintegrado UNA sola vez

    expect(mercadoPago.refund).toHaveBeenCalledTimes(1);
    expect(notifications.orderCancelledByOwner).toHaveBeenCalledTimes(1);
    expect(
      await prisma.orderStatusHistory.count({ where: { order_id: orden.id } }),
    ).toBe(1);
  });

  it('escenario 6 — el reembolso falla: el pago queda refund_pending, nunca refunded ni "fallido definitivo"', async () => {
    mercadoPago.refund.mockRejectedValue(new Error('mercadopago timeout'));
    const producto = await crearProducto('CANC-F', 5);
    const orden = await crearOrdenConEstado([{ productId: producto.id, quantity: 1 }], 'new');
    const pago = await crearPagoAprobado(orden.id, 'mercadopago', 'mp-cancel-fail');

    const resultado = await service.cancel(orden.id, 'admin-1');

    expect(resultado.order.status).toBe('cancelled'); // la cancelación en sí no revierte
    expect(resultado.refund.status).toBe('refund_pending');

    const pagoEnBase = await prisma.payment.findUniqueOrThrow({ where: { id: pago.id } });
    expect(pagoEnBase.status).toBe('refund_pending');
  });

  it('escenario 7 — orden pending_payment → OrderNotFoundError (404), fuera de alcance de esta acción', async () => {
    const producto = await crearProducto('CANC-G', 5);
    const orden = await crearOrdenConEstado(
      [{ productId: producto.id, quantity: 1 }],
      'pending_payment',
    );

    await expect(service.cancel(orden.id, 'admin-1')).rejects.toBeInstanceOf(OrderNotFoundError);

    const productoEnBase = await prisma.product.findUniqueOrThrow({ where: { id: producto.id } });
    expect(productoEnBase.stock).toBe(5); // sin tocar
  });
});
