import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Order } from '@dsm/db';
import { OrderWithItems } from '../../checkout/orders.repository';
import { AdminOrderItemDto } from './order.dto';

/**
 * Sin `sort` ni `status` parametrizables (design.md §D5): AC-1 fija el orden
 * (`-created_at`) y el filtro (excluir `pending_payment`) como reglas de
 * negocio, no como opciones del cliente — a diferencia de
 * `ListOrdersQueryDto` (admin).
 */
export class ListOrderHistoryQueryDto {
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
}

/**
 * Forma pública del historial del cliente (US-015 AC-1). Sin `id` (UUID
 * interno) ni `buyer_*` (el comprador ya sabe quién es) — a diferencia de
 * `AdminOrderSummaryDto`, que sí los incluye para el panel del dueño.
 */
export class OrderHistorySummaryDto {
  order_number!: number;
  status!: string;
  total_ars_cents!: number;
  created_at!: string;

  static from(o: Order): OrderHistorySummaryDto {
    return {
      order_number: o.order_number,
      status: o.status,
      total_ars_cents: o.total_ars_cents,
      created_at: o.created_at.toISOString(),
    };
  }
}

/**
 * Detalle del historial (US-015 AC-2): suma `fulfillment` + `items`. Reusa
 * `AdminOrderItemDto.from()` (`orders/dto/order.dto.ts`) en vez de duplicar
 * la proyección de ítem — misma forma sirve para el panel admin y para el
 * cliente por igual.
 */
export class OrderHistoryDetailDto extends OrderHistorySummaryDto {
  fulfillment!: string;
  items!: AdminOrderItemDto[];

  static fromDetail(o: OrderWithItems): OrderHistoryDetailDto {
    return {
      ...OrderHistorySummaryDto.from(o),
      fulfillment: o.fulfillment,
      items: o.items.map(AdminOrderItemDto.from),
    };
  }
}
