'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import type { AsyncState } from '@/lib/async';
import { AppErrorException, networkError } from '@/lib/http/errors';
import { Button } from '@/components/ui/Button';
import { formatArs } from '@/lib/format/currency';
import { StatusBadge } from './StatusBadge';
import { productsService, type Product } from './productsService';

const PAGE_SIZE = 20;
const column = createColumnHelper<Product>();

/**
 * Listado del panel con TanStack Table en `manualPagination` cableada a
 * limit/offset de la API (OQ-FE-3, NFR ≥5.000 SKUs). Badge de estado texto+color.
 */
export function ProductList() {
  const [offset, setOffset] = useState(0);
  const [state, setState] = useState<
    AsyncState<{ data: Product[]; total: number }>
  >({ status: 'idle' });

  const load = useCallback(async (nextOffset: number) => {
    setState({ status: 'loading' });
    try {
      const page = await productsService.list({
        limit: PAGE_SIZE,
        offset: nextOffset,
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
  }, []);

  useEffect(() => {
    void load(offset);
  }, [load, offset]);

  const rows = state.status === 'success' ? state.data.data : [];
  const total = state.status === 'success' ? state.data.total : 0;

  const columns = useMemo(
    () => [
      column.accessor('name', { header: 'Nombre' }),
      column.accessor('sku', { header: 'SKU' }),
      column.accessor('price_ars_cents', {
        header: 'Precio',
        cell: (info) => formatArs(info.getValue()),
      }),
      column.accessor('stock', { header: 'Stock' }),
      column.accessor('status', {
        header: 'Estado',
        cell: (info) => <StatusBadge status={info.getValue()} />,
      }),
    ],
    [],
  );

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    rowCount: total,
  });

  if (state.status === 'idle' || state.status === 'loading') {
    return (
      <div role="status" aria-busy="true" aria-live="polite">
        Cargando productos…
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div role="alert" className="flex flex-col gap-2">
        <p>No se pudieron cargar los productos.</p>
        <Button variant="secondary" onClick={() => void load(offset)}>
          Reintentar
        </Button>
      </div>
    );
  }

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-3">
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

      <div className="flex items-center justify-between">
        <span className="text-sm text-muted">{total} productos</span>
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
