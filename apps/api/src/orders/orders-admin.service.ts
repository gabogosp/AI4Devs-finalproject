import { Inject, Injectable } from '@nestjs/common';
import { Order } from '@dsm/db';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersRepository, OrderWithItems } from '../checkout/orders.repository';
import { OrderStatusHistoryRepository } from './order-status-history.repository';
import { OrderInvalidTransitionError, OrderNotFoundError } from './orders-errors';
import { canTransition, FulfillmentStatus } from './order-state';
import { NOTIFICATION_PORT, NotificationPort } from './ports/notification.port';
import { OrderEventsService } from '../observability/order-events.service';

/** AC-8: allowlist cerrada — `pending_payment`/`cancelled` nunca entran, sin importar el filtro (OQ-BE-2). */
const ACTIVE_STATUSES: FulfillmentStatus[] = ['new', 'preparing', 'ready', 'delivered'];

export interface ListOrdersQuery {
  status?: FulfillmentStatus;
  limit: number;
  offset: number;
  /** Uno de los 6 valores del enum cerrado — ya validado por el DTO (T7.1, design.md §D5). */
  sort: string;
}

export interface AdminOrdersPage {
  data: Order[];
  pagination: { limit: number; offset: number; total: number };
}

/** `sort` → `{sortField, sortDesc}` para el repositorio. Sin rama de error: el DTO ya garantizó el enum. */
function parseSort(sort: string): {
  sortField: 'order_number' | 'created_at' | 'total_ars_cents';
  sortDesc: boolean;
} {
  const sortDesc = sort.startsWith('-');
  const sortField = (sortDesc ? sort.slice(1) : sort) as
    | 'order_number'
    | 'created_at'
    | 'total_ars_cents';
  return { sortField, sortDesc };
}

/**
 * Caso de uso del panel admin de órdenes (US-012). `changeStatus` es
 * idempotente por estructura, no por clave (design.md §D4) — reusa el patrón
 * cross-repositorio que `ConfirmOrderService` de US-023 introdujo primero en
 * el repo: una transacción que cruza `OrdersRepository`/
 * `OrderStatusHistoryRepository`, con la notificación y los eventos DESPUÉS
 * del commit (nunca dentro — un fallo del `NotificationPort` no debe
 * revertir una transición que el dueño ya confirmó).
 */
@Injectable()
export class OrdersAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersRepository,
    private readonly history: OrderStatusHistoryRepository,
    private readonly events: OrderEventsService,
    @Inject(NOTIFICATION_PORT) private readonly notifications: NotificationPort,
  ) {}

  async list(query: ListOrdersQuery): Promise<AdminOrdersPage> {
    const statusIn: string[] = query.status ? [query.status] : ACTIVE_STATUSES;
    const { sortField, sortDesc } = parseSort(query.sort);

    const { data, total } = await this.orders.list({
      statusIn,
      sortField,
      sortDesc,
      limit: query.limit,
      offset: query.offset,
    });

    return { data, pagination: { limit: query.limit, offset: query.offset, total } };
  }

  /** AC-8: `pending_payment` nunca es "encontrable" acá. `cancelled` sí se devuelve (OQ-BE-1, defensivo). */
  async get(id: string): Promise<OrderWithItems> {
    const order = await this.orders.findById(id);
    if (!order || order.status === 'pending_payment') {
      throw new OrderNotFoundError('La orden no existe');
    }
    return order;
  }

  async changeStatus(
    id: string,
    target: FulfillmentStatus,
    changedBy: string | null,
  ): Promise<OrderWithItems> {
    const result = await this.prisma.$transaction(async (tx) => {
      const current = await this.orders.findById(id, tx);
      if (!current || current.status === 'pending_payment') {
        throw new OrderNotFoundError('La orden no existe');
      }
      if (current.status === target) {
        // No-op: reintento de red o doble click — no re-dispara nada.
        return { order: current, transitioned: false as const };
      }
      if (!canTransition(current.status, target)) {
        this.events.emit('order.transition_rejected', id, current.status, target);
        throw new OrderInvalidTransitionError(current.status, target);
      }

      const updated = await this.orders.updateStatusConditional(
        id,
        current.status,
        target,
        tx,
      );
      if (!updated) {
        // Carrera: otra transición ganó entre la lectura y el UPDATE condicional.
        const now = await this.orders.findById(id, tx);
        if (now?.status === target) {
          return { order: now, transitioned: false as const };
        }
        this.events.emit('order.transition_rejected', id, current.status, target);
        throw new OrderInvalidTransitionError(current.status, target);
      }

      await this.history.insert(
        { orderId: id, fromStatus: current.status, toStatus: target, changedBy },
        tx,
      );

      return { order: updated, transitioned: true as const, from: current.status };
    });

    if (!result.transitioned) {
      return this.orders.findById(id) as Promise<OrderWithItems>;
    }

    // Fuera de la transacción, tras el commit: un fallo acá no revierte la transición.
    if (target === 'ready') {
      await this.notifications.orderReadyForPickup({
        orderId: id,
        orderNumber: result.order.order_number,
        buyerName: result.order.buyer_name,
        buyerEmail: result.order.buyer_email,
      });
    }
    this.events.emit('order.status_changed', id, result.from, target);

    return this.orders.findById(id) as Promise<OrderWithItems>;
  }
}
