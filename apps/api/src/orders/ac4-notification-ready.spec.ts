import { OrdersAdminService } from './orders-admin.service';
import { OrdersRepository } from '../checkout/orders.repository';
import { OrderStatusHistoryRepository } from './order-status-history.repository';
import { OrderEventsService } from '../observability/order-events.service';
import { LoggingNotificationAdapter } from './ports/logging-notification.adapter';
import { PrismaService } from '../prisma/prisma.service';

/**
 * T8.3 — AC-4: `orderReadyForPickup` recibe los datos reales de la orden, y
 * ningún log de TODO el flujo (adapter de notificación + `OrderEventsService`)
 * contiene el nombre o el email del comprador. Usa las implementaciones
 * REALES de ambos loggers (no dobles) — lo que hay que probar es lo que un
 * archivo de log de producción realmente contendría.
 */
const FAKE_TX = { marker: 'fake-tx' } as never;

describe('AC-4 — orderReadyForPickup con payload real, sin PII en ningún log', () => {
  it('invoca el puerto con orderId/orderNumber/buyerName/buyerEmail reales, y ningún log del flujo contiene nombre o email', async () => {
    const CENTINELA_NOMBRE = 'CENTINELA-NOMBRE-Comprador-Real';
    const CENTINELA_EMAIL = 'centinela-comprador-real@no-debe-loguearse.test';

    const orden = {
      id: 'order-ac4',
      order_number: 4004,
      status: 'preparing',
      buyer_name: CENTINELA_NOMBRE,
      buyer_email: CENTINELA_EMAIL,
    };

    const prisma = {
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(FAKE_TX)),
    } as unknown as PrismaService;
    const orders = {
      findById: jest
        .fn()
        .mockResolvedValueOnce(orden)
        .mockResolvedValueOnce({ ...orden, status: 'ready' }),
      updateStatusConditional: jest.fn().mockResolvedValue({ ...orden, status: 'ready' }),
    } as unknown as OrdersRepository;
    const history = { insert: jest.fn() } as unknown as OrderStatusHistoryRepository;

    const notifications = new LoggingNotificationAdapter();
    const events = new OrderEventsService();

    const lineasCapturadas: unknown[] = [];
    jest
      .spyOn(notifications['logger'], 'log')
      .mockImplementation((l: unknown) => void lineasCapturadas.push(l));
    jest
      .spyOn(events['logger'], 'log')
      .mockImplementation((l: unknown) => void lineasCapturadas.push(l));
    const spyNotify = jest.spyOn(notifications, 'orderReadyForPickup');

    const service = new OrdersAdminService(prisma, orders, history, events, notifications);
    await service.changeStatus('order-ac4', 'ready', 'admin-1');

    expect(spyNotify).toHaveBeenCalledWith({
      orderId: 'order-ac4',
      orderNumber: 4004,
      buyerName: CENTINELA_NOMBRE,
      buyerEmail: CENTINELA_EMAIL,
    });

    expect(lineasCapturadas.length).toBeGreaterThan(0);
    const todasLasLineas = JSON.stringify(lineasCapturadas);
    expect(todasLasLineas).not.toContain(CENTINELA_NOMBRE);
    expect(todasLasLineas).not.toContain(CENTINELA_EMAIL);
  });
});
