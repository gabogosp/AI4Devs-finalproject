'use client';

import { useEffect, useRef } from 'react';
import { track } from '@/lib/observability/events';

/**
 * Emite `home_featured_shown` cuando una sección de destacados del home
 * ("Novedades"/"Más vendidos") se monta en el browser (US-026 §9 → insumo del
 * panel de métricas de US-016), mismo mecanismo que `CategoryViewTracker`.
 *
 * Por qué en el cliente: igual que `category_shown`, el home se cachea por
 * tag, así que el backend sólo ve los re-fetches posteriores a una
 * invalidación — su métrica de vistas subcuenta las visitas reales.
 *
 * Sin PII: es una lectura anónima; sólo viajan agregados de la sección
 * (`sectionId`, `itemCount`), nunca el slug de un item individual.
 */
export function HomeFeaturedViewTracker({
  sectionId,
  itemCount,
}: {
  sectionId: string;
  itemCount: number;
}) {
  // StrictMode monta dos veces en dev: sin el guard, cada visita contaría
  // doble. Se re-arma si cambia la identidad de la sección o su cantidad de
  // items, que sí es una vista nueva.
  const sentFor = useRef<string | null>(null);
  const key = `${sectionId}:${itemCount}`;

  useEffect(() => {
    if (sentFor.current === key) return;
    sentFor.current = key;
    track('home_featured_shown', {
      section: sectionId,
      item_count: itemCount,
      screen_name: 'home',
    });
  }, [key, sectionId, itemCount]);

  return null;
}
