'use client';

import Link from 'next/link';

export type CheckoutBlockedReason = 'empty' | 'not_purchasable';

const MENSAJES: Record<CheckoutBlockedReason, string> = {
  empty: 'Tu carrito está vacío. Agregá productos para poder pagar.',
  not_purchasable:
    'Hay líneas de tu carrito que ya no se pueden comprar. Revisalas antes de continuar.',
};

export interface CheckoutBlockedProps {
  reason: CheckoutBlockedReason;
}

/**
 * Entrada bloqueada al checkout (AC-5, mitad de entrada) — componente puro,
 * mismo criterio que `CartEmptyState.tsx` (US-007 §10.1). El detalle por línea
 * ya lo muestra `/carrito` (D5 — no se duplica acá).
 */
export function CheckoutBlocked({ reason }: CheckoutBlockedProps) {
  return (
    <div className="flex flex-col items-start gap-4 py-12">
      <h1 className="text-2xl font-semibold">No podés continuar todavía</h1>
      <p className="text-sm text-muted">{MENSAJES[reason]}</p>
      <Link
        href="/carrito"
        className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-dark focus:outline-none focus-visible:shadow-focus"
      >
        Volver al carrito
      </Link>
    </div>
  );
}
