import { OrdersAdminService } from './orders-admin.service';
import { OrdersRepository } from '../checkout/orders.repository';
import { OrderStatusHistoryRepository } from './order-status-history.repository';
import { OrderEventsService } from '../observability/order-events.service';
import { NotificationPort } from './ports/notification.port';
import { OrderInvalidTransitionError, OrderNotFoundError } from './orders-errors';
import { PrismaService } from '../prisma/prisma.service';

const FAKE_TX = { marker: 'fake-tx' } as never;

function ordenBase(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    order_number: 1000,
    status: 'new',
    buyer_name: 'Comprador',
    buyer_email: 'comprador@test.local',
    ...overrides,
  };
}

function makeService() {
  const prisma = {
    $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(FAKE_TX)),
  } as unknown as PrismaService;
  const orders = {
    list: jest.fn(),
    findById: jest.fn(),
    updateStatusConditional: jest.fn(),
  } as unknown as OrdersRepository;
  const history = { insert: jest.fn() } as unknown as OrderStatusHistoryRepository;
  const events = { emit: jest.fn() } as unknown as OrderEventsService;
  const notifications = {
    orderReadyForPickup: jest.fn().mockResolvedValue(undefined),
  } as unknown as NotificationPort;

  const service = new OrdersAdminService(prisma, orders, history, events, notifications);
  return { service, prisma, orders, history, events, notifications };
}

describe('OrdersAdminService — list/get (T6.1, AC-1/AC-2/AC-5/AC-8)', () => {
  it('list sin filtro pasa statusIn con los 4 valores activos', async () => {
    const { service, orders } = makeService();
    (orders.list as jest.Mock).mockResolvedValue({ data: [], total: 0 });

    await service.list({ limit: 20, offset: 0, sort: '-created_at' });

    expect(orders.list).toHaveBeenCalledWith(
      expect.objectContaining({ statusIn: ['new', 'preparing', 'ready', 'delivered'] }),
    );
  });

  it("list con status:'preparing' pasa statusIn:['preparing']", async () => {
    const { service, orders } = makeService();
    (orders.list as jest.Mock).mockResolvedValue({ data: [], total: 0 });

    await service.list({ status: 'preparing', limit: 20, offset: 0, sort: '-created_at' });

    expect(orders.list).toHaveBeenCalledWith(expect.objectContaining({ statusIn: ['preparing'] }));
  });

  it('get con repositorio devolviendo pending_payment lanza OrderNotFoundError', async () => {
    const { service, orders } = makeService();
    (orders.findById as jest.Mock).mockResolvedValue(ordenBase({ status: 'pending_payment' }));

    await expect(service.get('order-1')).rejects.toThrow(OrderNotFoundError);
  });

  it('get con cancelled no lanza (OQ-BE-1, defensivo)', async () => {
    const { service, orders } = makeService();
    (orders.findById as jest.Mock).mockResolvedValue(ordenBase({ status: 'cancelled' }));

    await expect(service.get('order-1')).resolves.toMatchObject({ status: 'cancelled' });
  });
});

describe('OrdersAdminService — changeStatus (T6.2, AC-3/AC-4/AC-6/AC-9)', () => {
  it('transición válida → status actualizado, history con changed_by, y ready invoca el puerto UNA vez fuera de la tx', async () => {
    const { service, orders, history, notifications, events } = makeService();
    (orders.findById as jest.Mock).mockResolvedValueOnce(ordenBase({ status: 'preparing' }));
    (orders.updateStatusConditional as jest.Mock).mockResolvedValue(
      ordenBase({ status: 'ready' }),
    );
    // segunda lectura, fuera de la tx, para la respuesta:
    (orders.findById as jest.Mock).mockResolvedValueOnce(ordenBase({ status: 'ready' }));

    await service.changeStatus('order-1', 'ready', 'admin-1');

    expect(orders.updateStatusConditional).toHaveBeenCalledWith(
      'order-1',
      'preparing',
      'ready',
      FAKE_TX,
    );
    expect(history.insert).toHaveBeenCalledWith(
      { orderId: 'order-1', fromStatus: 'preparing', toStatus: 'ready', changedBy: 'admin-1' },
      FAKE_TX,
    );
    expect(notifications.orderReadyForPickup).toHaveBeenCalledTimes(1);
    expect(notifications.orderReadyForPickup).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-1', orderNumber: 1000 }),
    );
    expect(events.emit).toHaveBeenCalledWith('order.status_changed', 'order-1', 'preparing', 'ready');
  });

  it("transición válida a 'preparing'/'delivered' NUNCA invoca el puerto de notificación", async () => {
    const ORIGEN_VALIDO = { preparing: 'new', delivered: 'ready' } as const;
    for (const target of ['preparing', 'delivered'] as const) {
      const { service, orders, notifications } = makeService();
      (orders.findById as jest.Mock)
        .mockResolvedValueOnce(ordenBase({ status: ORIGEN_VALIDO[target] }))
        .mockResolvedValueOnce(ordenBase({ status: target }));
      (orders.updateStatusConditional as jest.Mock).mockResolvedValue(
        ordenBase({ status: target }),
      );

      await service.changeStatus('order-1', target, 'admin-1');

      expect(notifications.orderReadyForPickup).not.toHaveBeenCalled();
    }
  });

  it('transición inválida: OrderInvalidTransitionError, cero cambios, cero invocaciones al puerto, order.transition_rejected emitido', async () => {
    const { service, orders, history, notifications, events } = makeService();
    (orders.findById as jest.Mock).mockResolvedValue(ordenBase({ status: 'new' }));

    await expect(service.changeStatus('order-1', 'delivered', 'admin-1')).rejects.toThrow(
      OrderInvalidTransitionError,
    );

    expect(orders.updateStatusConditional).not.toHaveBeenCalled();
    expect(history.insert).not.toHaveBeenCalled();
    expect(notifications.orderReadyForPickup).not.toHaveBeenCalled();
    expect(events.emit).toHaveBeenCalledWith('order.transition_rejected', 'order-1', 'new', 'delivered');
  });

  it('estado ya igual al pedido: 200 sin re-invocar el puerto ni escribir una segunda fila', async () => {
    const { service, orders, history, notifications, events } = makeService();
    (orders.findById as jest.Mock)
      .mockResolvedValueOnce(ordenBase({ status: 'ready' }))
      // segunda lectura para la respuesta (no-op también re-lee, por diseño):
      .mockResolvedValueOnce(ordenBase({ status: 'ready' }));

    const resultado = await service.changeStatus('order-1', 'ready', 'admin-1');

    expect(resultado.status).toBe('ready');
    expect(orders.updateStatusConditional).not.toHaveBeenCalled();
    expect(history.insert).not.toHaveBeenCalled();
    expect(notifications.orderReadyForPickup).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('orden inexistente → OrderNotFoundError, cero invocaciones', async () => {
    const { service, orders, notifications } = makeService();
    (orders.findById as jest.Mock).mockResolvedValue(null);

    await expect(service.changeStatus('order-x', 'preparing', 'admin-1')).rejects.toThrow(
      OrderNotFoundError,
    );
    expect(notifications.orderReadyForPickup).not.toHaveBeenCalled();
  });

  it('orden pending_payment → OrderNotFoundError (no es gestionable acá)', async () => {
    const { service, orders } = makeService();
    (orders.findById as jest.Mock).mockResolvedValue(ordenBase({ status: 'pending_payment' }));

    await expect(service.changeStatus('order-1', 'preparing', 'admin-1')).rejects.toThrow(
      OrderNotFoundError,
    );
  });
});
