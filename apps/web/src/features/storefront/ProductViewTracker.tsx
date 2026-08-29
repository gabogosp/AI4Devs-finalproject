'use client';

import { useEffect, useRef } from 'react';
import { track } from '@/lib/observability/events';

/**
 * Emite `pdp_shown` cuando la ficha se monta en el browser (US §9 → insumo del
 * panel de métricas de US-016).
 *
 * Por qué en el cliente y no sólo en el backend: la ficha se cachea por tag, así
 * que el origen sólo ve los re-fetches posteriores a una invalidación — su
 * `product.viewed` subcuenta las visitas reales (OQ-FE-5).
 *
 * Sin PII: es una lectura anónima; sólo viajan identificadores de producto.
 */
export function ProductViewTracker({
  slug,
  sku,
  inStock,
}: {
  slug: string;
  sku: string;
  inStock: boolean;
}) {
  // React 18+ monta dos veces en StrictMode (dev): sin este guard, cada visita
  // contaría doble.
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    track('pdp_shown', { slug, sku, in_stock: inStock, screen_name: 'pdp' });
  }, [slug, sku, inStock]);

  return null;
}
