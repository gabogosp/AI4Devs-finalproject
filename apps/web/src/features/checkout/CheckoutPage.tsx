'use client';

import { useEffect, useRef, useState } from 'react';
import { useCartContext } from '@/features/cart/CartProvider';
import { track } from '@/lib/observability/events';
import type { CheckoutCreated } from './checkoutService';
import { CheckoutBlocked, type CheckoutBlockedReason } from './CheckoutBlocked';
import { CheckoutConfirmation } from './CheckoutConfirmation';
import { CheckoutForm } from './CheckoutForm';
import { OrderSummary } from './OrderSummary';

/**
 * Composición de los **cuatro** estados de entrada (`design.md` D4/D8,
 * `frontend-standards.md` §11.9): nunca un `if (cart)` que los cubra a todos.
 *
 * Reusa `useCartContext()` — el mismo estado que ve `/carrito`, sin una segunda
 * fuente de verdad. Al montar hace `reload()` (OQ-FE-22), igual que `CartPage`.
 */
export function CheckoutPage() {
  const { state, reload } = useCartContext();
  const [order, setOrder] = useState<CheckoutCreated | null>(null);
  const bloqueoRegistrado = useRef(false);

  useEffect(() => {
    void reload();
  }, [reload]);

  const cart = state.kind === 'ready' ? state.cart : undefined;
  const bloqueado =
    cart !== undefined && (cart.items.length === 0 || cart.has_blocking_issues);

  useEffect(() => {
    if (!bloqueado || bloqueoRegistrado.current) return;
    bloqueoRegistrado.current = true;
    const reason: CheckoutBlockedReason = cart?.items.length === 0 ? 'empty' : 'not_purchasable';
    track('checkout_blocked', { reason });
  }, [bloqueado, cart]);

  if (order) {
    return (
      <div className="mx-auto max-w-2xl p-4">
        <CheckoutConfirmation order={order} />
      </div>
    );
  }

  if (state.kind === 'idle' || state.kind === 'loading') {
    return (
      <div className="mx-auto max-w-2xl p-4">
        <h1 className="text-2xl font-semibold">Checkout</h1>
        <div aria-busy="true" aria-live="polite" className="mt-6 flex flex-col gap-4">
          <span className="sr-only">Cargando tu carrito…</span>
          <div className="h-24 animate-pulse rounded-md bg-gray-100" />
        </div>
      </div>
    );
  }

  if (bloqueado) {
    return (
      <div className="mx-auto max-w-2xl p-4">
        <CheckoutBlocked reason={cart?.items.length === 0 ? 'empty' : 'not_purchasable'} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-4">
      <h1 className="text-2xl font-semibold">Checkout</h1>
      <div className="mt-6 grid gap-8 md:grid-cols-[2fr_1fr]">
        <CheckoutForm onSuccess={setOrder} />
        {cart && <OrderSummary cart={cart} />}
      </div>
    </div>
  );
}
