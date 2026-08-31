import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
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
