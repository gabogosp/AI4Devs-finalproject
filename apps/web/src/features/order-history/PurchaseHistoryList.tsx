'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { AsyncState } from '@/lib/async';
import { AppErrorException, networkError } from '@/lib/http/errors';
import { Button } from '@/components/ui/Button';
import { formatArs } from '@/lib/format/currency';
import { formatDateTime } from '@/lib/format/datetime';
import { OrderStatusBadge } from '@/features/orders/OrderStatusBadge';
import { orderHistoryService, type OrderHistorySummary } from './orderHistoryService';
import { PurchaseHistoryEmptyState } from './PurchaseHistoryEmptyState';

const PAGE_SIZE = 20;

/**
 * Listado del historial (AC-1) — composición explícita de estados
 * (`frontend-standards.md` §11.4/§11.9), mismo esqueleto que
 * `OrdersList`/`OrderDetail` pero SIN TanStack Table (`design.md` §Trade-offs
 * Decisión 1: design-system §7.9 es explícitamente panel del dueño) y con
 * acumulación incremental ("Cargar más") en vez de paginación por offset
 * visible.
 *
 * El orden de renderizado es el que devuelve la API — nunca se hace `sort()`
 * acá (AC-1 lo fija como regla de negocio del backend).
 */
export function PurchaseHistoryList() {
  const [state, setState] = useState<
    AsyncState<{ items: OrderHistorySummary[]; total: number }>
  >({ status: 'idle' });
  const [offset, setOffset] = useState(0);

  const load = useCallback(async (nextOffset: number, append: boolean) => {
    setState((prev) => (append && prev.status === 'success' ? prev : { status: 'loading' }));
    try {
      const page = await orderHistoryService.list({ limit: PAGE_SIZE, offset: nextOffset });
      setState((prev) => ({
        status: 'success',
        data: {
          items:
            append && prev.status === 'success' ? [...prev.data.items, ...page.data] : page.data,
          total: page.pagination.total,
        },
      }));
    } catch (err) {
      setState({
        status: 'error',
        error: err instanceof AppErrorException ? err.appError : networkError(),
      });
    }
  }, []);

  useEffect(() => {
    void load(0, false);
  }, [load]);

  if (state.status === 'idle' || state.status === 'loading') {
    return (
      <p role="status" aria-live="polite" aria-busy="true">
        Cargando tus compras…
      </p>
    );
  }

  if (state.status === 'error') {
    return (
      <div role="alert" className="flex flex-col gap-2">
        <p>No pudimos cargar tus compras.</p>
        <Button variant="secondary" onClick={() => void load(offset, false)}>
          Reintentar
        </Button>
      </div>
    );
  }

  if (state.data.items.length === 0) {
    return <PurchaseHistoryEmptyState />;
  }

  const puedeCargarMas = state.data.items.length < state.data.total;

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col divide-y divide-border">
        {state.data.items.map((order) => (
          <li key={order.order_number}>
            <Link
              href={`/mi-cuenta/compras/${order.order_number}`}
              className="flex items-center justify-between gap-3 py-3 focus:outline-none focus-visible:shadow-focus"
            >
              <div className="flex flex-col">
                <span className="font-medium">Pedido #{order.order_number}</span>
                <span className="text-sm text-muted">{formatDateTime(order.created_at)}</span>
              </div>
              <div className="flex items-center gap-3">
                <OrderStatusBadge status={order.status} />
                <span className="font-medium tabular-nums">
                  {formatArs(order.total_ars_cents)}
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
      {puedeCargarMas && (
        <Button
          variant="secondary"
          onClick={() => {
            const next = offset + PAGE_SIZE;
            setOffset(next);
            void load(next, true);
          }}
        >
          Cargar más
        </Button>
      )}
    </div>
  );
}
