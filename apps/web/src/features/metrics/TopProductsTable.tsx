'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import type { AsyncState } from '@/lib/async';
import { AppErrorException, networkError } from '@/lib/http/errors';
import { Button } from '@/components/ui/Button';
import { formatArs } from '@/lib/format/currency';
import { downloadCsv } from '@/lib/http/downloadCsv';
import { track } from '@/lib/observability/events';
import {
  metricsService,
  type DateRange,
  type TopProductsRanking,
  type TopProductsRow,
} from './metricsService';
import { describeClamp } from './rangeClampNote';

export interface TopProductsTableProps {
  range: DateRange;
}

/**
 * Ranking de productos más pedidos (AC-2, AC-4, AC-5, AC-6, AC-9). Propio
 * `AsyncState` — TanStack Table, mismo esqueleto que `OrdersList`
 * (`frontend-standards.md` §11.bis.7). Filas ordenadas por `quantity_sold`
 * desc tal como las devuelve el backend — sin re-ordenarlas en cliente.
 */
export function TopProductsTable({ range }: TopProductsTableProps) {
  const [state, setState] = useState<AsyncState<TopProductsRanking>>({ status: 'idle' });

  const load = useCallback(async (nextRange: DateRange) => {
    setState({ status: 'loading' });
    try {
      const data = await metricsService.getTopProducts(nextRange);
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
    const { csv, filename } = await metricsService.exportTopProducts(range);
    downloadCsv(csv, filename);
    track('metrics_export_downloaded', { dataset: 'top-products' });
  }

  const columns = useMemo<ColumnDef<TopProductsRow>[]>(
    () => [
      { id: 'product_name', accessorKey: 'product_name', header: 'Producto' },
      { id: 'product_sku', accessorKey: 'product_sku', header: 'SKU' },
      { id: 'quantity_sold', accessorKey: 'quantity_sold', header: 'Cantidad vendida' },
      {
        id: 'revenue_ars_cents',
        accessorKey: 'revenue_ars_cents',
        header: 'Monto',
        cell: (info) => formatArs(info.getValue<number>()),
      },
    ],
    [],
  );

  const rows = state.status === 'success' ? state.data.data : [];

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  if (state.status === 'idle' || state.status === 'loading') {
    return (
      <section aria-labelledby="top-products-heading" className="flex flex-col gap-3">
        <h2 id="top-products-heading" className="text-lg font-medium">
          Productos más pedidos
        </h2>
        <p role="status" aria-live="polite" className="text-sm text-muted">
          Cargando ranking de productos…
        </p>
        <div aria-hidden="true" className="flex flex-col gap-2">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="h-8 w-full animate-pulse rounded bg-gray-100" />
          ))}
        </div>
      </section>
    );
  }

  if (state.status === 'error') {
    return (
      <section aria-labelledby="top-products-heading" className="flex flex-col gap-2">
        <h2 id="top-products-heading" className="text-lg font-medium">
          Productos más pedidos
        </h2>
        <div role="alert" className="flex flex-col gap-2">
          <p>No se pudo cargar el ranking de productos.</p>
          <Button variant="secondary" onClick={() => void load(range)}>
            Reintentar
          </Button>
        </div>
      </section>
    );
  }

  const nota = describeClamp(range.from, state.data.range.from);

  return (
    <section aria-labelledby="top-products-heading" className="flex flex-col gap-3">
      <h2 id="top-products-heading" className="text-lg font-medium">
        Productos más pedidos
      </h2>

      {nota && <p className="text-sm text-muted">{nota}</p>}

      {rows.length === 0 ? (
        <p data-testid="top-products-empty-state">
          No hay productos pedidos en este período.
        </p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th key={h.id} className="p-2 font-medium text-muted">
                    {flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="border-t border-border">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="p-2">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Button variant="secondary" onClick={() => void handleExport()}>
        Descargar CSV
      </Button>
    </section>
  );
}
