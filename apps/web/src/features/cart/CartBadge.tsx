'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { useCartContext } from './CartProvider';

/**
 * Acceso al carrito en el top-nav, con la cantidad de **unidades** (OQ-FE-4 —
 * es lo que el comprador argentino espera de MercadoLibre).
 *
 * **Isla cliente** dentro de un layout que sigue siendo Server Component: sólo
 * este subárbol hidrata, `CategoryNav` sigue renderizando en servidor y el SEO de
 * US-002 no se toca (next-standards §2).
 *
 * Mientras no resolvió se renderiza **sin número**, nunca con un `0`: un `0` es
 * una afirmación —«tu carrito está vacío»— que todavía no sabemos si es verdad.
 */
export function CartBadge() {
  const { totalQuantity, reload } = useCartContext();
  const pedido = useRef(false);

  useEffect(() => {
    if (pedido.current) return;
    pedido.current = true;
    void reload();
  }, [reload]);

  return (
    <Link
      href="/carrito"
      aria-label={
        totalQuantity === undefined
          ? 'Ver el carrito'
          : `Ver el carrito (${totalQuantity} ${totalQuantity === 1 ? 'unidad' : 'unidades'})`
      }
      className="relative inline-flex min-h-[44px] items-center gap-2 rounded-md px-2 text-sm font-medium focus:outline-none focus-visible:shadow-focus"
    >
      <span aria-hidden="true">🛒</span>
      <span>Carrito</span>
      {totalQuantity !== undefined && totalQuantity > 0 && (
        <span className="inline-flex min-w-[20px] items-center justify-center rounded-full bg-accent-strong px-1.5 text-xs font-semibold text-white">
          {totalQuantity}
        </span>
      )}
    </Link>
  );
}
