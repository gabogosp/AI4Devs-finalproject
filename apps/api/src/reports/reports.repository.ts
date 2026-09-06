import { Injectable } from '@nestjs/common';
import { Prisma } from '@dsm/db';
import { PrismaService } from '../prisma/prisma.service';
import { ParsedRange } from './date-range';

export interface SalesTimeseriesRow {
  period_date: Date;
  orders_count: number;
  total_ars_cents: number;
}

export interface TopProductRow {
  product_id: string;
  product_name: string;
  product_sku: string;
  quantity_sold: number;
  revenue_ars_cents: number;
}

export interface StatusBreakdownRow {
  status: string;
  count: number;
  total_ars_cents: number;
}

export type SalesGranularity = 'day' | 'week' | 'month';

/**
 * Único punto de `$queryRaw` de este change — `per search/search.repository.ts`
 * (único precedente del repo) y `design.md §D6`. Las tres queries comparten el
 * mismo filtro `status IN (...)` (AC-8, "sólo órdenes confirmadas cuentan como
 * venta") y el mismo rango `created_at >= from AND created_at < to` (AC-4,
 * AC-9 — el rango ya viene acotado por `parseReportsRange` antes de llegar
 * acá).
 */
@Injectable()
export class ReportsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Evolución de ventas agrupada por día/semana/mes (AC-1, AC-8).
   *
   * `granularity` ya viene validada por el DTO (`@IsIn`) antes de llegar acá —
   * el switch elige entre 3 literales SQL fijos (con comillas: `date_trunc`
   * exige el segundo argumento como string literal), nunca interpola el
   * string crudo del query param (`security-standards.md §6.2` —
   * parameterized queries ONLY).
   */
  async salesTimeseries(
    range: ParsedRange,
    granularity: SalesGranularity,
  ): Promise<SalesTimeseriesRow[]> {
    const trunc = {
      day: Prisma.sql`'day'`,
      week: Prisma.sql`'week'`,
      month: Prisma.sql`'month'`,
    }[granularity];

    return this.prisma.$queryRaw<SalesTimeseriesRow[]>`
      SELECT date_trunc(${trunc}, o.created_at)::date AS period_date,
             count(*)::int AS orders_count,
             coalesce(sum(o.total_ars_cents), 0)::int AS total_ars_cents
        FROM orders o
       WHERE o.status IN ('new','preparing','ready','delivered')
         AND o.created_at >= ${range.from}
         AND o.created_at <  ${range.to}
       GROUP BY period_date
       ORDER BY period_date ASC`;
  }

  /**
   * Ranking de productos más pedidos por cantidad (AC-2, AC-8).
   *
   * Agrupa por el **snapshot** de `order_items` (`product_name`/`product_sku`
   * al momento de la venta), sin `JOIN` a `products` — `design.md §D6`.
   * Trade-off aceptado: un producto renombrado a mitad de período puede
   * aparecer como dos filas.
   */
  async topProducts(range: ParsedRange, limit: number): Promise<TopProductRow[]> {
    return this.prisma.$queryRaw<TopProductRow[]>`
      SELECT oi.product_id,
             oi.product_name,
             oi.product_sku,
             sum(oi.quantity)::int AS quantity_sold,
             sum(oi.quantity * oi.unit_price_ars_cents)::int AS revenue_ars_cents
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
       WHERE o.status IN ('new','preparing','ready','delivered')
         AND o.created_at >= ${range.from}
         AND o.created_at <  ${range.to}
       GROUP BY oi.product_id, oi.product_name, oi.product_sku
       ORDER BY quantity_sold DESC
       LIMIT ${limit}`;
  }

  /**
   * Desglose de órdenes por estado activo (AC-3, AC-8). Sólo emite filas para
   * estados con al menos una orden en el rango — el zero-fill de los estados
   * ausentes es responsabilidad del `ReportsService` (capas,
   * `backend-node-standards.md §2`).
   */
  async statusBreakdown(range: ParsedRange): Promise<StatusBreakdownRow[]> {
    return this.prisma.$queryRaw<StatusBreakdownRow[]>`
      SELECT o.status,
             count(*)::int AS count,
             coalesce(sum(o.total_ars_cents), 0)::int AS total_ars_cents
        FROM orders o
       WHERE o.status IN ('new','preparing','ready','delivered')
         AND o.created_at >= ${range.from}
         AND o.created_at <  ${range.to}
       GROUP BY o.status`;
  }
}
