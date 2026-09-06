import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ReportsRepository, SalesGranularity } from './reports.repository';
import { ReportsEventsService } from '../observability/report-events.service';
import { parseReportsRange, ParsedRange } from './date-range';
import { SALE_STATUSES } from './sale-statuses';
import { buildSalesCsv, buildSummaryCsv, buildTopProductsCsv, reportsFilename } from './csv/reports-csv';

export interface RangeQuery {
  created_at_from?: string;
  created_at_to?: string;
}

export interface SalesQuery extends RangeQuery {
  granularity: SalesGranularity;
}

export interface TopProductsQuery extends RangeQuery {
  limit: number;
}

export interface IsoRange {
  from: string;
  to: string;
}

export interface SalesRow {
  period_date: string;
  orders_count: number;
  total_ars_cents: number;
}

export interface SalesResponse {
  range: IsoRange;
  granularity: SalesGranularity;
  data: SalesRow[];
}

export interface TopProductsRow {
  product_id: string;
  product_name: string;
  product_sku: string;
  quantity_sold: number;
  revenue_ars_cents: number;
}

export interface TopProductsResponse {
  range: IsoRange;
  data: TopProductsRow[];
}

export type StatusBreakdown = Record<
  (typeof SALE_STATUSES)[number],
  { count: number; total_ars_cents: number }
>;

export interface SummaryResponse {
  range: IsoRange;
  orders_count: number;
  total_ars_cents: number;
  breakdown_by_status: StatusBreakdown;
}

export interface CsvFile {
  filename: string;
  body: string;
}

function toIsoRange(range: ParsedRange): IsoRange {
  return { from: range.from.toISOString(), to: range.to.toISOString() };
}

/**
 * Caso de uso de los 3 datasets de agregación + sus export CSV — `design.md
 * §D7`. Cada `get*Csv` reusa el `get*` interno correspondiente: no hay una
 * segunda query ni una segunda fuente de verdad para los números exportados.
 */
@Injectable()
export class ReportsService {
  private readonly retentionMonths: number;

  constructor(
    private readonly repo: ReportsRepository,
    private readonly events: ReportsEventsService,
    config: ConfigService,
  ) {
    this.retentionMonths = config.get<number>('ORDER_RETENTION_MONTHS') ?? 12;
  }

  private range(query: RangeQuery): ParsedRange {
    return parseReportsRange(query, new Date(), this.retentionMonths);
  }

  async getSalesTimeseries(query: SalesQuery): Promise<SalesResponse> {
    const range = this.range(query);
    const rows = await this.repo.salesTimeseries(range, query.granularity);
    this.events.emit('reports.viewed', 'sales');
    return {
      range: toIsoRange(range),
      granularity: query.granularity,
      data: rows.map((r) => ({
        period_date: new Date(r.period_date).toISOString().slice(0, 10),
        orders_count: r.orders_count,
        total_ars_cents: r.total_ars_cents,
      })),
    };
  }

  async getSalesTimeseriesCsv(query: SalesQuery): Promise<CsvFile> {
    const range = this.range(query);
    const rows = await this.repo.salesTimeseries(range, query.granularity);
    this.events.emit('reports.exported', 'sales');
    return {
      filename: reportsFilename('sales', range.from, range.to),
      body: buildSalesCsv(rows),
    };
  }

  async getTopProducts(query: TopProductsQuery): Promise<TopProductsResponse> {
    const range = this.range(query);
    const rows = await this.repo.topProducts(range, query.limit);
    this.events.emit('reports.viewed', 'top-products');
    return { range: toIsoRange(range), data: rows };
  }

  async getTopProductsCsv(query: TopProductsQuery): Promise<CsvFile> {
    const range = this.range(query);
    const rows = await this.repo.topProducts(range, query.limit);
    this.events.emit('reports.exported', 'top-products');
    return {
      filename: reportsFilename('top-products', range.from, range.to),
      body: buildTopProductsCsv(rows),
    };
  }

  private async summaryFor(query: RangeQuery): Promise<{ range: ParsedRange; summary: SummaryResponse }> {
    const range = this.range(query);
    const rows = await this.repo.statusBreakdown(range);

    const breakdown = Object.fromEntries(
      SALE_STATUSES.map((status) => [status, { count: 0, total_ars_cents: 0 }]),
    ) as StatusBreakdown;
    for (const row of rows) {
      if ((SALE_STATUSES as readonly string[]).includes(row.status)) {
        (breakdown as Record<string, { count: number; total_ars_cents: number }>)[row.status] = {
          count: row.count,
          total_ars_cents: row.total_ars_cents,
        };
      }
    }

    const orders_count = Object.values(breakdown).reduce((acc, v) => acc + v.count, 0);
    const total_ars_cents = Object.values(breakdown).reduce((acc, v) => acc + v.total_ars_cents, 0);

    return {
      range,
      summary: { range: toIsoRange(range), orders_count, total_ars_cents, breakdown_by_status: breakdown },
    };
  }

  async getSummary(query: RangeQuery): Promise<SummaryResponse> {
    const { summary } = await this.summaryFor(query);
    this.events.emit('reports.viewed', 'summary');
    return summary;
  }

  async getSummaryCsv(query: RangeQuery): Promise<CsvFile> {
    const { range, summary } = await this.summaryFor(query);
    this.events.emit('reports.exported', 'summary');
    return {
      filename: reportsFilename('summary', range.from, range.to),
      body: buildSummaryCsv(summary),
    };
  }
}
