'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import type { AsyncState } from '@/lib/async';
import { AppErrorException, networkError } from '@/lib/http/errors';
import { Button } from '@/components/ui/Button';
import { formatArs } from '@/lib/format/currency';
import { track } from '@/lib/observability/events';
import { OrderStatusBadge } from './OrderStatusBadge';
import { ordersService, type FulfillmentStatus, type OrderSummary } from './ordersService';
import type { ListAdminOrdersSort } from '@/api/generated/model';

const PAGE_SIZE = 20;

const STATUS_FILTER_OPTIONS: Array<{ value: FulfillmentStatus | ''; label: string }> = [
  { value: '', label: 'Todas' },
  { value: 'new', label: 'Nueva' },
  { value: 'preparing', label: 'Preparando' },
  { value: 'ready', label: 'Lista para retirar' },
  { value: 'delivered', label: 'Entregada' },
];

const ARIA_SORT: Record<string, 'ascending' | 'descending' | 'none'> = {
  asc: 'ascending',
  desc: 'descending',
  false: 'none',
};

/**
 * Listado del panel de fulfillment (AC-1, AC-5, AC-8; `design.md` §D5).
 * `manualSorting` restringido a las 3 columnas que el enum cerrado del
 * backend permite — `enableSorting: false` en cliente/estado. Cambiar filtro
 * u orden resetea `offset` a 0.
 */
export function OrdersList() {
  const [statusFilter, setStatusFilter] = useState<FulfillmentStatus | ''>('');
  const [sorting, setSorting] = useState<SortingState>([{ id: 'created_at', desc: true }]);
  const [offset, setOffset] = useState(0);
  const [state, setState] = useState<AsyncState<{ data: OrderSummary[]; total: number }>>({
    status: 'idle',
  });

  const load = useCallback(
    async (nextOffset: number, nextStatus: FulfillmentStatus | '', nextSorting: SortingState) => {
      setState({ status: 'loading' });
      const sort = `${nextSorting[0]?.desc ? '-' : ''}${nextSorting[0]?.id}` as ListAdminOrdersSort;
      try {
        const page = await ordersService.list({
          status: nextStatus || undefined,
          limit: PAGE_SIZE,
          offset: nextOffset,
          sort,
        });
        setState({
          status: 'success',
          data: { data: page.data, total: page.pagination.total },
        });
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
    void load(offset, statusFilter, sorting);
  }, [load, offset, statusFilter, sorting]);

  const rows = state.status === 'success' ? state.data.data : [];
  const total = state.status === 'success' ? state.data.total : 0;

  const columns = useMemo<ColumnDef<OrderSummary>[]>(
    () => [
      { id: 'order_number', accessorKey: 'order_number', header: 'Nº de orden' },
      {
        id: 'buyer_name',
        accessorKey: 'buyer_name',
        header: 'Cliente',
        enableSorting: false,
      },
      {
        id: 'total_ars_cents',
        accessorKey: 'total_ars_cents',
        header: 'Total',
        cell: (info) => formatArs(info.getValue<number>()),
      },
      {
        id: 'status',
        accessorKey: 'status',
        header: 'Estado',
        enableSorting: false,
        cell: (info) => <OrderStatusBadge status={info.getValue<OrderSummary['status']>()} />,
      },
      { id: 'created_at', accessorKey: 'created_at', header: 'Fecha' },
    ],
    [],
  );

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    enableSortingRemoval: false,
    onSortingChange: (updater) => {
      setSorting(updater);
      setOffset(0);
    },
    state: { sorting },
    rowCount: total,
  });

  function onStatusChange(value: FulfillmentStatus | '') {
    setStatusFilter(value);
    setOffset(0);
    track('orders_filtered', { status: value || 'all' });
  }

  if (state.status === 'idle' || state.status === 'loading') {
    return (
      <div className="flex flex-col gap-3">
        <p role="status" aria-live="polite" className="text-sm text-muted">
          Cargando órdenes…
        </p>
        <div aria-hidden="true" className="flex flex-col gap-2">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="h-8 w-full animate-pulse rounded bg-gray-100" />
          ))}
        </div>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div role="alert" className="flex flex-col gap-2">
        <p>No se pudieron cargar las órdenes.</p>
        <Button variant="secondary" onClick={() => void load(offset, statusFilter, sorting)}>
          Reintentar
        </Button>
      </div>
    );
  }

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-2 text-sm">
        Estado:
        <select
          value={statusFilter}
          onChange={(e) => onStatusChange(e.target.value as FulfillmentStatus | '')}
          className="rounded border border-border p-1"
        >
          {STATUS_FILTER_OPTIONS.map((opt) => (
            <option key={opt.value || 'todas'} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      {rows.length === 0 ? (
        <div className="flex flex-col gap-2">
          <p>No hay órdenes con ese filtro.</p>
          {statusFilter && (
            <Button variant="secondary" onClick={() => onStatusChange('')}>
              Volver a Todas
            </Button>
          )}
        </div>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const sortable = h.column.getCanSort();
                  return (
                    <th
                      key={h.id}
                      className="p-2 font-medium text-muted"
                      aria-sort={sortable ? ARIA_SORT[String(h.column.getIsSorted())] : undefined}
                    >
                      {sortable ? (
                        <button
                          type="button"
                          className="font-medium"
                          onClick={h.column.getToggleSortingHandler()}
                        >
                          {flexRender(h.column.columnDef.header, h.getContext())}
                        </button>
                      ) : (
                        flexRender(h.column.columnDef.header, h.getContext())
                      )}
                    </th>
                  );
                })}
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

      <div className="flex items-center justify-between">
        <span className="text-sm text-muted">{total} órdenes</span>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            Anterior
          </Button>
          <span className="text-sm" aria-live="polite">
            Página {page} de {pageCount}
          </span>
          <Button
            variant="secondary"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            Siguiente
          </Button>
        </div>
      </div>
    </div>
  );
}
