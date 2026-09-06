'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { AsyncState } from '@/lib/async';
import { AppErrorException, networkError } from '@/lib/http/errors';
import { Button } from '@/components/ui/Button';
import { formatArs } from '@/lib/format/currency';
import { OrderStatusBadge } from '@/features/orders/OrderStatusBadge';
import { orderHistoryService, type OrderHistoryDetail } from './orderHistoryService';

/**
 * Detalle de una compra propia (AC-2). Mismo esqueleto de `AsyncState` +
 * foco gestionado al cargar que `OrderDetail` (admin), sin ninguna de las
 * acciones mutantes del panel admin (cancelar/anonimizar/cambiar estado —
 * `design.md` §Non-goals).
 *
 * `order_number` no numérico (`NaN`) se trata igual que un 404: las tres
 * causas que el backend ya colapsa a propósito (inexistente / ajena / fuera
 * de retención, AC-4/AC-6/AC-7) no deben distinguirse de un segmento
 * inválido — hacerlo sería una cuarta fuga sobre la forma esperada del
 * identificador.
 */
export function PurchaseDetail({ orderNumber }: { orderNumber: string }) {
  const parsed = Number(orderNumber);
  const [state, setState] = useState<AsyncState<OrderHistoryDetail>>({ status: 'idle' });
  const headingRef = useRef<HTMLHeadingElement>(null);

  const load = useCallback(async () => {
    if (!Number.isInteger(parsed)) {
      setState({ status: 'error', error: { kind: 'notFound', message: 'Pedido no encontrado' } });
      return;
    }
    setState({ status: 'loading' });
    try {
      const order = await orderHistoryService.get(parsed);
      setState({ status: 'success', data: order });
    } catch (err) {
      setState({
        status: 'error',
        error: err instanceof AppErrorException ? err.appError : networkError(),
      });
    }
  }, [parsed]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (state.status === 'success') headingRef.current?.focus();
  }, [state.status]);

  if (state.status === 'idle' || state.status === 'loading') {
    return (
      <p role="status" aria-live="polite" aria-busy="true">
        Cargando pedido…
      </p>
    );
  }

  if (state.status === 'error') {
    const noEncontrado = state.error.kind === 'notFound';
    return (
      <div role="alert" className="flex flex-col gap-2">
        <p>{noEncontrado ? 'No encontramos ese pedido.' : 'No pudimos cargar el pedido.'}</p>
        {!noEncontrado && (
          <Button variant="secondary" onClick={() => void load()}>
            Reintentar
          </Button>
        )}
        <Link href="/mi-cuenta/compras" className="text-sm underline">
          Volver a mis compras
        </Link>
      </div>
    );
  }

  const order = state.data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="text-xl font-semibold focus:outline-none focus-visible:shadow-focus"
        >
          Pedido #{order.order_number}
        </h1>
        <OrderStatusBadge status={order.status} />
      </div>

      <section aria-labelledby="pedido-items-heading">
        <h2 id="pedido-items-heading" className="font-medium">
          Ítems
        </h2>
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              <th className="p-2 font-medium text-muted">Producto</th>
              <th className="p-2 font-medium text-muted">Cantidad</th>
              <th className="p-2 font-medium text-muted">Precio unitario</th>
              <th className="p-2 font-medium text-muted">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item, i) => (
              <tr key={`${item.product_sku}-${i}`} className="border-t border-border">
                <td className="p-2">{item.product_name}</td>
                <td className="p-2">{item.quantity}</td>
                <td className="p-2">{formatArs(item.unit_price_ars_cents)}</td>
                <td className="p-2">{formatArs(item.subtotal_ars_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-right font-medium">Total: {formatArs(order.total_ars_cents)}</p>
      </section>

      <section aria-labelledby="pedido-retiro-heading">
        <h2 id="pedido-retiro-heading" className="font-medium">
          Retiro
        </h2>
        <p className="text-sm">
          {order.fulfillment === 'pickup' ? 'Retiro en sucursal' : order.fulfillment}
        </p>
      </section>
    </div>
  );
}
