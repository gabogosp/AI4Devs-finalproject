'use client';

import { useEffect, useRef } from 'react';
import { track } from '@/lib/observability/events';

/**
 * Emite `category_shown` cuando una página de categoría se monta en el browser
 * (US §9 → insumo del panel de métricas de US-016).
 *
 * Por qué en el cliente: el listado se cachea por tag, así que el origen sólo
 * ve los re-fetches posteriores a una invalidación — su `category.viewed`
 * subcuenta las visitas reales (mismo razonamiento que `pdp_shown`).
 *
 * Sin PII: es una lectura anónima; sólo viajan identificadores de catálogo.
 */
export function CategoryViewTracker({
  slug,
  isRubro,
  page,
  productCount,
}: {
  slug: string;
  isRubro: boolean;
  page: number;
  productCount: number;
}) {
  // StrictMode monta dos veces en dev: sin el guard, cada visita contaría
  // doble. Se re-arma al cambiar de página, que SÍ es una vista nueva.
  const sentFor = useRef<string | null>(null);
  const key = `${slug}:${page}`;

  useEffect(() => {
    if (sentFor.current === key) return;
    sentFor.current = key;
    track('category_shown', {
      slug,
      is_rubro: isRubro,
      page,
      product_count: productCount,
      screen_name: 'category',
    });
  }, [key, slug, isRubro, page, productCount]);

  return null;
}
