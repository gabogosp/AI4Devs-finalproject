import { initObservability } from '@/lib/observability/sentry';

/**
 * Punto de entrada de instrumentación del navegador (convención de Next 15: este
 * archivo se carga automáticamente antes de hidratar).
 *
 * Cierra **AUDIT-DSM-WEB-011**: `initObservability()` existía desde US-001 y **nadie
 * la llamaba**, así que el sink de eventos nunca se configuraba y el SDK nunca
 * arrancaba. Va acá y no en `app/layout.tsx` a propósito: el layout raíz es un Server
 * Component —lo necesita el SSR indexable del storefront— y convertirlo en cliente
 * para meter un `useEffect` habría arrastrado todo el árbol al bundle del navegador
 * por una llamada de inicialización.
 *
 * Sin `NEXT_PUBLIC_SENTRY_DSN` esto es un no-op: ver la nota en `sentry.ts`.
 */
initObservability();
