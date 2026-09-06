import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, Max, Min } from 'class-validator';

const GRANULARITY_VALUES = ['day', 'week', 'month'] as const;
export type ReportsGranularity = (typeof GRANULARITY_VALUES)[number];

/**
 * Rango temporal compartido por los 3 datasets (AC-4). Fechas ISO 8601
 * (`api-standards.md §5.3`), `_from`/`_to` para rangos (`api-standards.md
 * §7.1`). Un valor que no parsea ISO 8601 → 422 vía `ValidationPipe` global
 * (`design.md §D4/§D6`), sin código de dominio a mano.
 */
export class ReportsRangeQueryDto {
  @IsOptional()
  @IsISO8601()
  created_at_from?: string;

  @IsOptional()
  @IsISO8601()
  created_at_to?: string;
}

/** `GET /v1/admin/reports/sales` (y su `/export`) — AC-1. */
export class SalesQueryDto extends ReportsRangeQueryDto {
  @IsOptional()
  @IsIn(GRANULARITY_VALUES)
  granularity: ReportsGranularity = 'day';
}

/** `GET /v1/admin/reports/top-products` (y su `/export`) — AC-2. */
export class TopProductsQueryDto extends ReportsRangeQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 10;
}
