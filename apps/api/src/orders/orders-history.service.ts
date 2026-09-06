import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Order } from '@dsm/db';
import { OrdersRepository, OrderWithItems } from '../checkout/orders.repository';
import { computeRetentionCutoff } from '../checkout/retention-cutoff';
import { OrderNotFoundError } from '../checkout/checkout-errors';
import { OrdersHistoryEventsService } from '../observability/orders-history-events.service';

export interface ListOrderHistoryQuery {
  limit: number;
  offset: number;
}

export interface OrderHistoryPage {
  data: Order[];
  pagination: { limit: number; offset: number; total: number };
}

/**
 * Caso de uso del historial de compras del cliente autenticado (US-015,
 * design.md §Approach). El orden (`-created_at`) y el filtro (excluir
 * `pending_payment`) son reglas de negocio fijas — no hay `sort`/`status`
 * parametrizables por el cliente (design.md §D5), a diferencia del panel
 * admin de US-012.
 */
@Injectable()
export class OrdersHistoryService {
  private readonly retentionMonths: number;

  constructor(
    private readonly orders: OrdersRepository,
    private readonly events: OrdersHistoryEventsService,
    config: ConfigService,
  ) {
    this.retentionMonths = config.get<number>('ORDER_RETENTION_MONTHS') ?? 12;
  }

  async list(customerId: string, query: ListOrderHistoryQuery): Promise<OrderHistoryPage> {
    const cutoff = computeRetentionCutoff(this.retentionMonths);
    const { data, total } = await this.orders.listByCustomer(customerId, {
      cutoff,
      limit: query.limit,
      offset: query.offset,
    });
    this.events.emit('orders_history.list_viewed', customerId);
    return { data, pagination: { limit: query.limit, offset: query.offset, total } };
  }

  /**
   * `orderNumber` inexistente, ajeno, `pending_payment`, o fuera de la
   * ventana de retención: los cuatro colapsan al MISMO
   * `OrderNotFoundError` — el repositorio ya los hace indistinguibles en la
   * query (design.md §D3, IDOR).
   */
  async detail(customerId: string, orderNumber: number): Promise<OrderWithItems> {
    const cutoff = computeRetentionCutoff(this.retentionMonths);
    const order = await this.orders.findByOrderNumberForCustomer(
      orderNumber,
      customerId,
      cutoff,
    );
    if (!order) {
      this.events.emit('orders_history.detail_not_found', customerId);
      throw new OrderNotFoundError();
    }
    this.events.emit('orders_history.detail_viewed', customerId);
    return order;
  }
}
