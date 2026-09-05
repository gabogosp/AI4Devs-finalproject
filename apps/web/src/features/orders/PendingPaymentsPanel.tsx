'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AsyncState } from '@/lib/async';
import { AppErrorException, isAppError, networkError } from '@/lib/http/errors';
import { Button } from '@/components/ui/Button';
import { formatArs } from '@/lib/format/currency';
import { track } from '@/lib/observability/events';
import { pendingPaymentsService, type PendingPaymentOrder } from './pendingPaymentsService';

/**
 * Vista separada de `OrdersList` para confirmar pagos manuales/offline
 * (`design.md` §D9, backend hermano `US-023-pago-manual-offline-backend`).
 * Refetch-on-success — NO UI optimista (deviación explícita de D7): esta
 * acción no tiene la carrera entre pestañas que justifica esa máquina en
 * `OrderStatusActions`.
 */
export function PendingPaymentsPanel() {
  const [state, setState] = useState<AsyncState<PendingPaymentOrder[]>>({ status: 'idle' });
  const [confirming, setConfirming] = useState<ReadonlySet<string>>(new Set());
  const [rowErrors, setRowErrors] = useState<Readonly<Record<string, string>>>({});

  const load = useCallback(async (signal?: AbortSignal) => {
    setState({ status: 'loading' });
    try {
      const data = await pendingPaymentsService.list(signal);
      setState({ status: 'success', data });
    } catch (err) {
      setState({
        status: 'error',
        error: err instanceof AppErrorException ? err.appError : networkError(),
      });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function onConfirm(orderId: string) {
    setConfirming((prev) => new Set(prev).add(orderId));
    setRowErrors((prev) => {
      const { [orderId]: _omit, ...rest } = prev;
      return rest;
    });
    try {
      await pendingPaymentsService.confirm(orderId);
      track('pending_payment_confirmed', { order_id: orderId });
      await load();
    } catch (err) {
      setRowErrors((prev) => ({
        ...prev,
        [orderId]: isAppError(err, 'conflict')
          ? 'La orden ya no está pendiente de pago (probablemente ya se confirmó). Recargá para ver el estado actual.'
          : 'No se pudo confirmar el pago. Reintentá.',
      }));
    } finally {
      setConfirming((prev) => {
        const next = new Set(prev);
        next.delete(orderId);
        return next;
      });
    }
  }

  if (state.status === 'idle' || state.status === 'loading') {
    return (
      <div className="flex flex-col gap-3">
        <p role="status" aria-live="polite" className="text-sm text-muted">
          Cargando pagos pendientes…
        </p>
        <div aria-hidden="true" className="flex flex-col gap-2">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="h-8 w-full animate-pulse rounded bg-gray-100" />
          ))}
        </div>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div role="alert" className="flex flex-col gap-2">
        <p>No se pudieron cargar los pagos pendientes.</p>
        <Button variant="secondary" onClick={() => void load()}>
          Reintentar
        </Button>
      </div>
    );
  }

  const rows = state.data;

  if (rows.length === 0) {
    return <p>No hay pagos pendientes de confirmar.</p>;
  }

  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr>
          <th className="p-2 font-medium text-muted">Nº de orden</th>
          <th className="p-2 font-medium text-muted">Cliente</th>
          <th className="p-2 font-medium text-muted">Total</th>
          <th className="p-2 font-medium text-muted">Fecha</th>
          <th className="p-2 font-medium text-muted">
            <span className="sr-only">Acciones</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((order) => (
          <tr key={order.id} className="border-t border-border align-top">
            <td className="p-2">{order.order_number}</td>
            <td className="p-2">{order.buyer_name}</td>
            <td className="p-2">{formatArs(order.total_ars_cents)}</td>
            <td className="p-2">{order.created_at}</td>
            <td className="p-2">
              <div className="flex flex-col gap-1">
                <Button
                  variant="secondary"
                  loading={confirming.has(order.id)}
                  onClick={() => void onConfirm(order.id)}
                >
                  Confirmar pago
                </Button>
                {rowErrors[order.id] && <div role="alert">{rowErrors[order.id]}</div>}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
