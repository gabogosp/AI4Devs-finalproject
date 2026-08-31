import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Order, OrderItem, OrderStatusHistory } from '@dsm/db';
import { OrderWithItems } from '../../checkout/orders.repository';
import { FulfillmentStatus } from '../order-state';

const ACTIVE_STATUSES = ['new', 'preparing', 'ready', 'delivered'] as const;
const SORT_VALUES = [
  'order_number',
  '-order_number',
  'created_at',
  '-created_at',
  'total_ars_cents',
  '-total_ars_cents',
] as const;

/**
 * `status` sólo admite los 4 estados activos (AC-8, allowlist cerrada —
 * `pending_payment`/`cancelled` no son opciones de tipo válidas, ni
 * expresables). `sort` es un enum cerrado de 6 valores, no un parser custom
 * (design.md §D5).
 */
export class ListOrdersQueryDto {
  @IsOptional()
  @IsIn(ACTIVE_STATUSES)
  status?: FulfillmentStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset: number = 0;

  @IsOptional()
  @IsIn(SORT_VALUES)
  sort: string = '-created_at';
}

/** "cancelled" NUNCA es un valor de tipo válido acá (US-013, ruta distinta). */
export class UpdateOrderStatusDto {
  @IsIn(['preparing', 'ready', 'delivered'])
  status!: 'preparing' | 'ready' | 'delivered';
}

/** Forma de respuesta per design.md §D3 — mismo shape que el listado del panel de productos. */
export class AdminOrderSummaryDto {
  id!: string;
  order_number!: number;
  buyer_name!: string;
  total_ars_cents!: number;
  status!: string;
  created_at!: string;

  static from(o: Order): AdminOrderSummaryDto {
    return {
      id: o.id,
      order_number: o.order_number,
      buyer_name: o.buyer_name,
      total_ars_cents: o.total_ars_cents,
      status: o.status,
      created_at: o.created_at.toISOString(),
    };
  }
}

export class AdminOrderItemDto {
  product_name!: string;
  product_sku!: string;
  quantity!: number;
  unit_price_ars_cents!: number;
  subtotal_ars_cents!: number;

  static from(item: OrderItem): AdminOrderItemDto {
    return {
      product_name: item.product_name,
      product_sku: item.product_sku,
      quantity: item.quantity,
      unit_price_ars_cents: item.unit_price_ars_cents,
      subtotal_ars_cents: item.quantity * item.unit_price_ars_cents,
    };
  }
}

export class AdminOrderStatusChangeDto {
  from_status!: string | null;
  to_status!: string;
  changed_by!: string | null;
  changed_at!: string;

  static from(h: OrderStatusHistory): AdminOrderStatusChangeDto {
    return {
      from_status: h.from_status,
      to_status: h.to_status,
      changed_by: h.changed_by,
      changed_at: h.changed_at.toISOString(),
    };
  }
}

export class AdminOrderDetailDto extends AdminOrderSummaryDto {
  buyer_email!: string;
  buyer_phone!: string;
  fulfillment!: string;
  items!: AdminOrderItemDto[];
  status_history!: AdminOrderStatusChangeDto[];

  static fromWithHistory(
    o: OrderWithItems,
    history: OrderStatusHistory[],
  ): AdminOrderDetailDto {
    return {
      ...AdminOrderSummaryDto.from(o),
      buyer_email: o.buyer_email,
      buyer_phone: o.buyer_phone,
      fulfillment: o.fulfillment,
      items: o.items.map(AdminOrderItemDto.from),
      status_history: history.map(AdminOrderStatusChangeDto.from),
    };
  }
}
