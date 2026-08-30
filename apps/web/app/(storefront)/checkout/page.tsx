import { CheckoutPage } from '@/features/checkout/CheckoutPage';
import { checkoutMetadata } from '@/features/checkout/checkoutMetadata';

/**
 * `/checkout` — sólo compone.
 *
 * Server Component (sin `'use client'`) por la misma razón mecánica que
 * `carrito/page.tsx`: `metadata` sólo se puede exportar desde un Server
 * Component en el App Router, y el `noindex` no es negociable. El trabajo de
 * cliente vive en `CheckoutPage`, la hoja que hidrata.
 *
 * **Sin `loading.tsx`** en esta rama, mismo motivo que `carrito/` (F59): la
 * boundary de Suspense compromete el status 200 antes de tiempo. El esqueleto
 * lo pinta `CheckoutPage` desde su propio estado.
 */
export const metadata = checkoutMetadata;

export default function CheckoutRoutePage() {
  return <CheckoutPage />;
}
