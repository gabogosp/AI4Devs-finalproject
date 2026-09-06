import { csvCell } from '../../common/csv/csv-cell';
import { SalesTimeseriesRow, TopProductRow } from '../reports.repository';

export type ReportsDataset = 'sales' | 'top-products' | 'summary';

function ymd(date: Date): string {
  return new Date(date).toISOString().slice(0, 10);
}

/**
 * Nombre del archivo descargable — `design.md §D4`:
 * `reports-{dataset}-{from}-{to}.csv`. Server-generated: nunca datos del
 * cliente (`security-standards.md §6.4`, mismo criterio que
 * `imports/report-csv.ts:reportFilename`).
 */
export function reportsFilename(dataset: ReportsDataset, from: Date, to: Date): string {
  return `reports-${dataset}-${ymd(from)}-${ymd(to)}.csv`;
}

/** CSV de `GET /v1/admin/reports/sales/export` — misma fila que el JSON hermano. */
export function buildSalesCsv(rows: SalesTimeseriesRow[]): string {
  const lineas = ['period_date,orders_count,total_ars_cents'];
  for (const row of rows) {
    lineas.push(
      [ymd(row.period_date), String(row.orders_count), String(row.total_ars_cents)].join(','),
    );
  }
  return lineas.join('\n') + '\n';
}

/**
 * CSV de `GET /v1/admin/reports/top-products/export` — `product_name`/
 * `product_sku` son texto libre cargado por el dueño (panel de catálogo o
 * import masivo): pasan por `csvCell` contra inyección de fórmulas
 * (`design.md §D3/§D9`, `security-standards.md §6.3`).
 */
export function buildTopProductsCsv(rows: TopProductRow[]): string {
  const lineas = ['product_id,product_name,product_sku,quantity_sold,revenue_ars_cents'];
  for (const row of rows) {
    lineas.push(
      [
        row.product_id,
        csvCell(row.product_name),
        csvCell(row.product_sku),
        String(row.quantity_sold),
        String(row.revenue_ars_cents),
      ].join(','),
    );
  }
  return lineas.join('\n') + '\n';
}

export interface SummaryCsvInput {
  orders_count: number;
  total_ars_cents: number;
  breakdown_by_status: Record<string, { count: number; total_ars_cents: number }>;
}

/** CSV de `GET /v1/admin/reports/summary/export` — una fila por estado + el total del período. */
export function buildSummaryCsv(summary: SummaryCsvInput): string {
  const lineas = ['status,count,total_ars_cents'];
  for (const [status, v] of Object.entries(summary.breakdown_by_status)) {
    lineas.push([status, String(v.count), String(v.total_ars_cents)].join(','));
  }
  lineas.push(['total', String(summary.orders_count), String(summary.total_ars_cents)].join(','));
  return lineas.join('\n') + '\n';
}
