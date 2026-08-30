'use client';

import { useEffect, useRef } from 'react';
import { formatArs } from '@/lib/format/currency';
import type { CheckoutCreated } from './checkoutService';
import { saveOrderToken } from './orderToken';

export interface CheckoutConfirmationProps {
  order: CheckoutCreated;
}

/**
 * Pantalla post-201 (D8 — in-place, sin ruta nueva). Persiste el `order_token`
 * (T2.3) al montar. CTA "Continuar al pago" **deshabilitado** con el motivo
 * visible: `Deferred: US-009 — owner: FE`. Cuando exista la pantalla de pago,
 * este botón deja de estar disabled y navega/llama a `POST /v1/payments`.
 */
export function CheckoutConfirmation({ order }: CheckoutConfirmationProps) {
  const guardado = useRef(false);

  useEffect(() => {
    if (guardado.current) return;
    guardado.current = true;
    saveOrderToken(order.order_token);
  }, [order.order_token]);

  return (
    <div className="flex flex-col gap-4 py-8">
      <h1 className="text-2xl font-semibold">¡Listo! Tu pedido quedó registrado</h1>
      <p className="text-sm">
        Pedido <strong>#{order.order_number}</strong>
      </p>
      <p className="text-sm">
        Total: <strong>{formatArs(order.total_ars_cents)}</strong>
      </p>
      <div>
        <button
          type="button"
          disabled
          className="inline-flex min-h-[44px] items-center rounded-md bg-accent-strong px-4 text-sm font-medium text-white opacity-60"
        >
          Continuar al pago
        </button>
        <p className="mt-2 text-xs text-muted">El pago se habilita en la próxima entrega.</p>
      </div>
    </div>
  );
}
