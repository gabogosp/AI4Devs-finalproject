'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { useCart, type UseCart } from './useCart';

const CartContext = createContext<UseCart | null>(null);

/**
 * Contexto del carrito: la página y el badge del top-nav comparten **un solo**
 * estado, así que agregar desde la ficha actualiza el badge sin recargar.
 *
 * Un store global (Zustand/Redux) sería infraestructura para un problema que no
 * existe: los consumidores son dos y el servidor devuelve el carrito completo en
 * cada mutación (`base-standards.md` §1 — YAGNI). Si mañana hay cinco
 * consumidores, ahí conviene migrar.
 *
 * Es un Client Component **hoja**: se monta dentro del layout del storefront, que
 * sigue siendo Server Component porque `CategoryNav` lo necesita para el SEO de
 * US-002 (next-standards §2 — la frontera vive en las hojas).
 */
export function CartProvider({ children }: { children: ReactNode }) {
  // `autoload: false` a propósito: el layout envuelve TODA página pública, y no
  // corresponde pedir el carrito en cada visita a una ficha indexable. Lo carga
  // quien lo necesita — el badge al montar, la página al abrirse.
  const cart = useCart({ autoload: false });

  return <CartContext.Provider value={cart}>{children}</CartContext.Provider>;
}

/**
 * Acceso al carrito compartido. Lanza si se usa fuera del provider: es un error
 * de programación, y fallar fuerte acá es mejor que un carrito fantasma que no
 * se sincroniza con el badge.
 */
export function useCartContext(): UseCart {
  const ctx = useContext(CartContext);
  if (!ctx) {
    throw new Error('useCartContext requiere <CartProvider> (layout del storefront)');
  }
  return ctx;
}
