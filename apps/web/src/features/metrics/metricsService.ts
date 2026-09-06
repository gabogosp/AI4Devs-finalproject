import { parseContract } from '@/lib/http/contract';
import { filenameFromContentDisposition } from '@/lib/http/contentDisposition';
import {
  getAdminReportsSales,
  exportAdminReportsSales,
  getAdminReportsTopProducts,
  exportAdminReportsTopProducts,
  getAdminReportsSummary,
  exportAdminReportsSummary,
} from '@/api/generated/endpoints';
import {
  GetAdminReportsSalesResponse,
  GetAdminReportsTopProductsResponse,
  GetAdminReportsSummaryResponse,
} from '@/api/generated/zod';
import type {
  AdminReportsSales,
  AdminReportsSalesRow,
  AdminReportsTopProducts,
  AdminReportsTopProductsRow,
  AdminReportsSummary,
  AdminReportsRange,
  AdminReportsStatusBreakdownEntry,
  AdminReportsSummaryBreakdownByStatus,
  GetAdminReportsSalesGranularity,
} from '@/api/generated/model';

/**
 * Tipos DERIVADOS DEL CONTRATO — generados desde `apps/api/docs/api/openapi.yaml`
 * (`frontend-standards.md` §3.1/§3.2). Se re-exportan con los nombres de dominio
 * que usa el panel; nunca se declaran a mano.
 */
export type { AdminReportsSalesRow as SalesRow };
export type { AdminReportsTopProductsRow as TopProductsRow };
export type { AdminReportsRange as ReportsRange };
export type { AdminReportsStatusBreakdownEntry as StatusBreakdownEntry };
export type { AdminReportsSummaryBreakdownByStatus as SummaryBreakdownByStatus };
export type SalesTimeseries = AdminReportsSales;
export type TopProductsRanking = AdminReportsTopProducts;
export type PeriodSummary = AdminReportsSummary;
export type SalesGranularity = GetAdminReportsSalesGranularity;

/** Un rango pedido por el dueño; ambos extremos son opcionales (backend acota). */
export interface DateRange {
  from?: string;
  to?: string;
}

export interface CsvExport {
  /** Contenido del CSV, tal como lo generó el servidor. */
  csv: string;
  /**
   * Nombre que el **servidor** eligió (`Content-Disposition`). No se construye
   * en el cliente: `security-standards.md` §6.4 — server-generated storage names.
   */
  filename: string;
}

function toCsvExport(
  res: { data: unknown; headers: Headers },
  fallback: string,
): CsvExport {
  const csv = typeof res.data === 'string' ? res.data : String(res.data ?? '');
  return { csv, filename: filenameFromContentDisposition(res.headers, fallback) };
}

/**
 * Lógica de servicio del panel de métricas (US-016, `design.md` Decisión 1).
 * La red va por las **operaciones generadas** (F48): toda llamada sale del
 * cliente generado a partir del contrato `admin-reports`, cero `fetch` propio.
 * La respuesta se valida en el borde con los schemas Zod generados; los 3
 * `export*` devuelven `{ csv, filename }` — mismo patrón que
 * `importsService.downloadReport` (Extract Method compartido, T2.1).
 */
export const metricsService = {
  async getSales(
    range: DateRange,
    granularity?: SalesGranularity,
    signal?: AbortSignal,
  ): Promise<SalesTimeseries> {
    const res = await getAdminReportsSales(
      {
        created_at_from: range.from,
        created_at_to: range.to,
        granularity,
      },
      { signal },
    );
    return parseContract(GetAdminReportsSalesResponse, res.data);
  },

  async exportSales(
    range: DateRange,
    granularity?: SalesGranularity,
    signal?: AbortSignal,
  ): Promise<CsvExport> {
    const res = await exportAdminReportsSales(
      {
        created_at_from: range.from,
        created_at_to: range.to,
        granularity,
      },
      { signal },
    );
    return toCsvExport(res, 'ventas.csv');
  },

  async getTopProducts(
    range: DateRange,
    signal?: AbortSignal,
  ): Promise<TopProductsRanking> {
    const res = await getAdminReportsTopProducts(
      { created_at_from: range.from, created_at_to: range.to },
      { signal },
    );
    return parseContract(GetAdminReportsTopProductsResponse, res.data);
  },

  async exportTopProducts(
    range: DateRange,
    signal?: AbortSignal,
  ): Promise<CsvExport> {
    const res = await exportAdminReportsTopProducts(
      { created_at_from: range.from, created_at_to: range.to },
      { signal },
    );
    return toCsvExport(res, 'productos-mas-pedidos.csv');
  },

  async getSummary(
    range: DateRange,
    signal?: AbortSignal,
  ): Promise<PeriodSummary> {
    const res = await getAdminReportsSummary(
      { created_at_from: range.from, created_at_to: range.to },
      { signal },
    );
    return parseContract(GetAdminReportsSummaryResponse, res.data);
  },

  async exportSummary(range: DateRange, signal?: AbortSignal): Promise<CsvExport> {
    const res = await exportAdminReportsSummary(
      { created_at_from: range.from, created_at_to: range.to },
      { signal },
    );
    return toCsvExport(res, 'resumen.csv');
  },
};
