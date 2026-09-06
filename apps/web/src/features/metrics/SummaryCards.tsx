'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AsyncState } from '@/lib/async';
import { AppErrorException, networkError } from '@/lib/http/errors';
import { Button } from '@/components/ui/Button';
import { formatArs } from '@/lib/format/currency';
import { downloadCsv } from '@/lib/http/downloadCsv';
import { track } from '@/lib/observability/events';
import { metricsService, type DateRange, type PeriodSummary } from './metricsService';
import { describeClamp } from './rangeClampNote';

export interface SummaryCardsProps {
  range: DateRange;
}

const STATUS_LABELS = {
  new: 'Nueva',
  preparing: 'Preparando',
  ready: 'Lista para retirar',
  delivered: 'Entregada',
} as const;

/**
 * Totales del período (AC-3, AC-4, AC-5, AC-6, AC-8, AC-9). 4 tarjetas
 * (órdenes, monto, desglose por estado) + caption fijo de transparencia
 * operativa (AC-8 — no es un filtro adicional, sólo información).
 */
export function SummaryCards({ range }: SummaryCardsProps) {
  const [state, setState] = useState<AsyncState<PeriodSummary>>({ status: 'idle' });

  const load = useCallback(async (nextRange: DateRange) => {
    setState({ status: 'loading' });
    try {
      const data = await metricsService.getSummary(nextRange);
      setState({ status: 'success', data });
    } catch (err) {
      setState({
        status: 'error',
        error: err instanceof AppErrorException ? err.appError : networkError(),
      });
    }
  }, []);

  useEffect(() => {
    void load(range);
  }, [load, range]);

  async function handleExport() {
    const { csv, filename } = await metricsService.exportSummary(range);
    downloadCsv(csv, filename);
    track('metrics_export_downloaded', { dataset: 'summary' });
  }

  if (state.status === 'idle' || state.status === 'loading') {
    return (
      <section aria-labelledby="summary-cards-heading" className="flex flex-col gap-3">
        <h2 id="summary-cards-heading" className="text-lg font-medium">
          Resumen del período
        </h2>
        <p role="status" aria-live="polite" className="text-sm text-muted">
          Cargando resumen del período…
        </p>
        <div aria-hidden="true" className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-20 w-full animate-pulse rounded bg-gray-100" />
          ))}
        </div>
      </section>
    );
  }

  if (state.status === 'error') {
    return (
      <section aria-labelledby="summary-cards-heading" className="flex flex-col gap-2">
        <h2 id="summary-cards-heading" className="text-lg font-medium">
          Resumen del período
        </h2>
        <div role="alert" className="flex flex-col gap-2">
          <p>No se pudo cargar el resumen del período.</p>
          <Button variant="secondary" onClick={() => void load(range)}>
            Reintentar
          </Button>
        </div>
      </section>
    );
  }

  const { data } = state;
  const nota = describeClamp(range.from, data.range.from);

  return (
    <section aria-labelledby="summary-cards-heading" className="flex flex-col gap-3">
      <h2 id="summary-cards-heading" className="text-lg font-medium">
        Resumen del período
      </h2>

      {nota && <p className="text-sm text-muted">{nota}</p>}

      <p className="text-sm text-muted">
        Sólo se cuentan órdenes confirmadas por pago aprobado.
      </p>

      {data.orders_count === 0 ? (
        <p data-testid="summary-empty-state">
          No hay órdenes registradas en este período.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-border p-3">
            <p className="text-sm text-muted">Órdenes</p>
            <p className="text-xl font-medium">{data.orders_count}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-sm text-muted">Monto facturado</p>
            <p className="text-xl font-medium">{formatArs(data.total_ars_cents)}</p>
          </div>
          {(Object.keys(STATUS_LABELS) as Array<keyof typeof STATUS_LABELS>).map((status) => (
            <div key={status} className="rounded-lg border border-border p-3">
              <p className="text-sm text-muted">{STATUS_LABELS[status]}</p>
              <p className="text-xl font-medium">{data.breakdown_by_status[status].count}</p>
              <p className="text-sm text-muted">
                {formatArs(data.breakdown_by_status[status].total_ars_cents)}
              </p>
            </div>
          ))}
        </div>
      )}

      <Button variant="secondary" onClick={() => void handleExport()}>
        Descargar CSV
      </Button>
    </section>
  );
}
