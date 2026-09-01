'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AsyncState } from '@/lib/async';
import { AppErrorException, networkError } from '@/lib/http/errors';
import { Button } from '@/components/ui/Button';
import { formatArs } from '@/lib/format/currency';
import { OrderStatusBadge } from './OrderStatusBadge';
import { ordersService, type OrderDetail as Order } from './ordersService';

/**
 * Vista de detalle (AC-2). `OrderStatusActions` (Fase 6) y `OrderStatusHistory`
 * (Fase 7) todavía no existen — el slot queda marcado acá, se integran en sus
 * propias tasks.
 */
export function OrderDetail({ id }: { id: string }) {
  const [state, setState] = useState<AsyncState<Order>>({ status: 'idle' });

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const order = await ordersService.get(id);
      setState({ status: 'success', data: order });
    } catch (err) {
      setState({
        status: 'error',
        error: err instanceof AppErrorException ? err.appError : networkError(),
      });
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.status === 'idle' || state.status === 'loading') {
    return (
      <p role="status" aria-live="polite" aria-busy="true">
        Cargando orden…
      </p>
    );
  }

  if (state.status === 'error') {
    return (
      <div role="alert" className="flex flex-col gap-2">
        <p>No se pudo cargar la orden.</p>
        <Button variant="secondary" onClick={() => void load()}>
          Reintentar
        </Button>
      </div>
    );
  }

  const order = state.data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <h2 className="text-xl font-semibold">Orden #{order.order_number}</h2>
        <OrderStatusBadge status={order.status} />
      </div>

      {/* Slot: OrderStatusActions (T6.1) */}

      <section aria-labelledby="orden-items-heading">
        <h3 id="orden-items-heading" className="font-medium">
          Ítems
        </h3>
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              <th className="p-2 font-medium text-muted">Producto</th>
              <th className="p-2 font-medium text-muted">SKU</th>
              <th className="p-2 font-medium text-muted">Cantidad</th>
              <th className="p-2 font-medium text-muted">Precio unitario</th>
              <th className="p-2 font-medium text-muted">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item, i) => (
              <tr key={`${item.product_sku}-${i}`} className="border-t border-border">
                <td className="p-2">{item.product_name}</td>
                <td className="p-2">{item.product_sku}</td>
                <td className="p-2">{item.quantity}</td>
                <td className="p-2">{formatArs(item.unit_price_ars_cents)}</td>
                <td className="p-2">{formatArs(item.subtotal_ars_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-right font-medium">Total: {formatArs(order.total_ars_cents)}</p>
      </section>

      <section aria-labelledby="orden-contacto-heading">
        <h3 id="orden-contacto-heading" className="font-medium">
          Datos de contacto
        </h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted">Nombre</dt>
          <dd>{order.buyer_name}</dd>
          <dt className="text-muted">Email</dt>
          <dd>{order.buyer_email}</dd>
          <dt className="text-muted">Teléfono</dt>
          <dd>{order.buyer_phone}</dd>
          <dt className="text-muted">Retiro</dt>
          <dd>{order.fulfillment === 'pickup' ? 'Retiro en sucursal' : order.fulfillment}</dd>
        </dl>
      </section>

      {/* Slot: OrderStatusHistory (T7.1) */}
    </div>
  );
}
