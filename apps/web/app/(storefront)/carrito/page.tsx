import { CartPage } from '@/features/cart/CartPage';
import { cartMetadata } from '@/features/cart/cartMetadata';

/**
 * `/carrito` — sólo compone.
 *
 * Este archivo **es Server Component** (no lleva `'use client'`) por una razón
 * mecánica: en el App Router `metadata` sólo se puede exportar desde un Server
 * Component, y el `noindex` no es negociable. El trabajo de cliente vive en
 * `CartPage`, que es la hoja que hidrata — la misma frontera que usa el layout
 * del storefront (next-standards §2).
 *
 * **Sin `loading.tsx`** en esta rama: la boundary de Suspense transmite el shell
 * con el status 200 ya comprometido (US-003 `design.md` D1.bis, gap F59). El
 * esqueleto lo pinta `CartPage` desde su propio estado, que además es el único que
 * sabe si el carrito está cargando.
 */
export const metadata = cartMetadata;

export default function CarritoPage() {
  return <CartPage />;
}
