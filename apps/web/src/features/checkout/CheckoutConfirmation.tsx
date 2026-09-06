'use client';

import { useEffect, useRef } from 'react';
import { formatArs } from '@/lib/format/currency';
import { WhatsAppLink } from '@/features/contact/WhatsAppLink';
import { WHATSAPP_MESSAGES } from '@/features/contact/whatsapp';
import type { CheckoutCreated } from './checkoutService';
import { saveOrderToken } from './orderToken';

export interface CheckoutConfirmationProps {
  order: CheckoutCreated;
}

/**
 * Pantalla post-201 (D8 — in-place, sin ruta nueva). Persiste el `order_token`
 * (T2.3) al montar.
 *
 * El pago de DSM es manual/offline (US-023): no hay pasarela online que
 * "continuar al pago" pudiera abrir — US-009 (MercadoPago) sigue `Blocked`
 * sin credenciales. El cierre real del loop es coordinar por WhatsApp
 * (US-018), con el número de pedido en el mensaje: es el dato que el dueño
 * necesita para ubicar la orden y confirmarla desde `PendingPaymentsPanel`
 * (US-012/US-023). Reemplaza el botón deshabilitado que dejó pendiente
 * `Deferred: US-009 — owner: FE` — esa pantalla de pago nunca existió porque
 * el medio real terminó siendo otro, no MercadoPago.
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
      <div className="flex flex-col gap-2">
        <WhatsAppLink
          label="Coordinar el pago por WhatsApp"
          message={WHATSAPP_MESSAGES.order(order.order_number)}
        />
        <p className="text-xs text-muted">
          Te contactamos por WhatsApp para coordinar transferencia o efectivo.
        </p>
      </div>
    </div>
  );
}
