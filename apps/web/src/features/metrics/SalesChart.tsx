'use client';

import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import type { AsyncState } from '@/lib/async';
import { AppErrorException, networkError } from '@/lib/http/errors';
import { Button } from '@/components/ui/Button';
import { formatArs } from '@/lib/format/currency';
import { downloadCsv } from '@/lib/http/downloadCsv';
import { track } from '@/lib/observability/events';
import { metricsService, type DateRange, type SalesTimeseries, type SalesGranularity } from './metricsService';
import { describeClamp } from './rangeClampNote';
import { formatPeriod } from './formatPeriod';
import { ChartSkeleton } from './charts/ChartSkeleton';

const SalesComposedChart = dynamic(
  () => import('./charts/SalesComposedChart').then((m) => m.SalesComposedChart),
  { ssr: false, loading: () => <ChartSkeleton /> },
);

const GRANULARITY_OPTIONS: Array<{ value: SalesGranularity; label: string }> = [
  { value: 'day', label: 'Día' },
  { value: 'week', label: 'Semana' },
  { value: 'month', label: 'Mes' },
];

export interface SalesChartProps {
  range: DateRange;
}

/**
 * Evolución de ventas en el tiempo (AC-1, AC-4, AC-5, AC-6, AC-9). Propio
 * `AsyncState` — una falla acá no afecta a `TopProductsTable`/`SummaryCards`
 * (`design.md` Decisión 8).
 */
export function SalesChart({ range }: SalesChartProps) {
  const [granularity, setGranularity] = useState<SalesGranularity>('day');
  const [state, setState] = useState<AsyncState<SalesTimeseries>>({ status: 'idle' });

  const load = useCallback(
    async (nextRange: DateRange, nextGranularity: SalesGranularity) => {
      setState({ status: 'loading' });
      try {
        const data = await metricsService.getSales(nextRange, nextGranularity);
        setState({ status: 'success', data });
      } catch (err) {
        setState({
          status: 'error',
          error: err instanceof AppErrorException ? err.appError : networkError(),
        });
      }
    },
    [],
  );

  useEffect(() => {
    void load(range, granularity);
  }, [load, range, granularity]);

  async function handleExport() {
    const { csv, filename } = await metricsService.exportSales(range, granularity);
    downloadCsv(csv, filename);
    track('metrics_export_downloaded', { dataset: 'sales' });
  }

  if (state.status === 'idle' || state.status === 'loading') {
    return (
      <section aria-labelledby="sales-chart-heading" className="flex flex-col gap-3">
        <h2 id="sales-chart-heading" className="text-lg font-medium">
          Evolución de ventas
        </h2>
        <p role="status" aria-live="polite" className="text-sm text-muted">
          Cargando evolución de ventas…
        </p>
        <ChartSkeleton />
      </section>
    );
  }

  if (state.status === 'error') {
    return (
      <section aria-labelledby="sales-chart-heading" className="flex flex-col gap-2">
        <h2 id="sales-chart-heading" className="text-lg font-medium">
          Evolución de ventas
        </h2>
        <div role="alert" className="flex flex-col gap-2">
          <p>No se pudo cargar la evolución de ventas.</p>
          <Button variant="secondary" onClick={() => void load(range, granularity)}>
            Reintentar
          </Button>
        </div>
      </section>
    );
  }

  const { data } = state;
  const nota = describeClamp(range.from, data.range.from);

  return (
    <section aria-labelledby="sales-chart-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="sales-chart-heading" className="text-lg font-medium">
          Evolución de ventas
        </h2>
        <label className="flex items-center gap-2 text-sm">
          Agrupar por:
          <select
            value={granularity}
            onChange={(e) => setGranularity(e.target.value as SalesGranularity)}
            className="rounded border border-border p-1"
          >
            {GRANULARITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {nota && <p className="text-sm text-muted">{nota}</p>}

      {data.data.length === 0 ? (
        <p data-testid="sales-empty-state">
          No hay ventas registradas en este período.
        </p>
      ) : (
        <>
          <SalesComposedChart rows={data.data} granularity={data.granularity} />
          <details>
            <summary>Ver datos en tabla</summary>
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Evolución de ventas por período</caption>
              <thead>
                <tr>
                  <th className="p-2 font-medium text-muted">Período</th>
                  <th className="p-2 font-medium text-muted">Órdenes</th>
                  <th className="p-2 font-medium text-muted">Monto facturado</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((row) => (
                  <tr key={row.period_date} className="border-t border-border">
                    <td className="p-2">{formatPeriod(row.period_date, data.granularity)}</td>
                    <td className="p-2">{row.orders_count}</td>
                    <td className="p-2">{formatArs(row.total_ars_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}

      <Button variant="secondary" onClick={() => void handleExport()}>
        Descargar CSV
      </Button>
    </section>
  );
}
