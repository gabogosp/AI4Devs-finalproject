'use client';

import { useEffect, useRef } from 'react';
import { track } from '@/lib/observability/events';
import type { SearchResponse } from './searchService';

/**
 * Telemetría de la búsqueda (`design.md` D9).
 *
 * **Ningún evento lleva el texto de la consulta.** Es la regla dura: el input es
 * entrada libre y alguien pega ahí su email o su teléfono. Lo que viaja es
 * `query_length`, que mide lo que interesa —si la gente describe su necesidad o
 * tipea dos palabras— sin guardar qué escribió.
 *
 * Los clics en resultados se resuelven con **un** listener por delegación sobre
 * la grilla, y no volviendo cliente cada tarjeta: eso rompería el SSR de los
 * resultados, que es la premisa del ticket, a cambio de un evento.
 */
export function SearchTracker({
  query,
  response,
}: {
  query: string;
  response: SearchResponse;
}) {
  // StrictMode monta dos veces en dev: sin el guard, cada búsqueda contaría
  // doble. La clave incluye la consulta para que cambiarla SÍ cuente como
  // búsqueda nueva — pero es sólo una clave local, no viaja a ningún lado.
  const emitidoPara = useRef<string | null>(null);
  const key = `${query}:${response.results.length}:${response.confidence}`;

  useEffect(() => {
    if (emitidoPara.current === key) return;
    emitidoPara.current = key;
    track('search_performed', {
      confidence: response.confidence,
      degraded: response.degraded,
      results_count: response.results.length,
      query_length: query.length,
      screen_name: 'search',
    });
  }, [key, query, response]);

  return null;
}

/**
 * Delegación de clics sobre la grilla de resultados.
 *
 * Envuelve a los hijos y escucha en el contenedor: al hacer clic, busca el
 * `[data-search-result]` más cercano y lee su `data-position`. Un solo listener
 * para toda la grilla, y las tarjetas siguen siendo Server Components.
 */
export function SearchResultsClickTracker({
  confidence,
  children,
}: {
  confidence: SearchResponse['confidence'];
  children: React.ReactNode;
}) {
  const contenedor = useRef<HTMLDivElement>(null);

  // Listener NATIVO por ref y no un `onClick` de JSX. La diferencia no es de
  // estilo: un `onClick` sobre un `div` es, para las reglas de a11y, un elemento
  // no interactivo que se comporta como botón sin soporte de teclado — y tienen
  // razón en general. Acá lo interactivo son los `<a>` de adentro, que ya son
  // alcanzables por teclado y cuyo Enter dispara un `click` que burbujea hasta
  // este nodo. El listener nativo dice exactamente eso: escucho lo que sube,
  // no me hago pasar por control.
  useEffect(() => {
    const nodo = contenedor.current;
    if (!nodo) return;
    const onClick = (e: Event) => {
      const objetivo = (e.target as HTMLElement).closest<HTMLElement>(
        '[data-search-result]',
      );
      if (!objetivo) return;
      const position = Number(objetivo.dataset.position);
      if (!Number.isFinite(position)) return;
      // La posición del clic es la señal de relevancia real: si los clics caen
      // siempre en el puesto 4, el ranking está mal aunque el arnés pase.
      track('search_result_clicked', { position, confidence, screen_name: 'search' });
    };
    nodo.addEventListener('click', onClick);
    return () => nodo.removeEventListener('click', onClick);
  }, [confidence]);

  return <div ref={contenedor}>{children}</div>;
}

/**
 * Delegación de clics sobre la salida a rubros (AC-3): mide si la red de
 * seguridad salva la visita o el cliente se va igual.
 *
 * Mismo patrón que la grilla y por la misma razón: un listener, y los enlaces
 * siguen renderizando en servidor.
 */
export function SearchFallbackClickTracker({
  children,
}: {
  children: React.ReactNode;
}) {
  const contenedor = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const nodo = contenedor.current;
    if (!nodo) return;
    const onClick = (e: Event) => {
      const objetivo = (e.target as HTMLElement).closest<HTMLElement>(
        '[data-fallback-slug]',
      );
      const slug = objetivo?.dataset.fallbackSlug;
      if (!slug) return;
      track('search_fallback_clicked', {
        category_slug: slug,
        screen_name: 'search',
      });
    };
    nodo.addEventListener('click', onClick);
    return () => nodo.removeEventListener('click', onClick);
  }, []);

  return <div ref={contenedor}>{children}</div>;
}

/**
 * AC-10 desde el lado del cliente: si aparece seguido, el tope está mal
 * calibrado.
 *
 * Es una hoja cliente porque la página que lo renderiza es Server Component y
 * `track` corre en el browser. Sin propiedades más allá de la espera: un
 * discriminador por consulta reintroduciría el texto por la puerta de atrás.
 */
export function SearchRateLimitTracker({
  retryAfterSeconds,
}: {
  retryAfterSeconds?: number;
}) {
  const emitido = useRef(false);
  useEffect(() => {
    if (emitido.current) return;
    emitido.current = true;
    track('search_rate_limited', {
      retry_after_seconds: retryAfterSeconds ?? null,
      screen_name: 'search',
    });
  }, [retryAfterSeconds]);
  return null;
}
