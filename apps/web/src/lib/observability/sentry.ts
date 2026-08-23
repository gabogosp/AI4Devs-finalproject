import * as Sentry from '@sentry/nextjs';
import { setEventSink } from './events';

/**
 * Inicialización de observabilidad FE (E2E §18): errores + eventos de negocio.
 *
 * **Sin `NEXT_PUBLIC_SENTRY_DSN` es un no-op seguro** y eso es deliberado: en local y
 * en los tests no hay DSN, y arrancar el SDK ahí sólo generaría ruido y latencia. La
 * ausencia de DSN no es un error de configuración — es el caso normal fuera de los
 * ambientes desplegados.
 *
 * Cableado el 2026-08-23 (AUDIT-DSM-WEB-003 + AUDIT-DSM-WEB-011). Hasta entonces
 * `captureError` era un no-op **aunque hubiera llamadores reales**
 * (`revalidateSafely`, `CategoryNav`, los error boundaries de cada segmento): los
 * errores se tragaban en silencio y el plan de observabilidad del E2E §18 existía sólo
 * en el papel.
 */
export function initObservability(): void {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) {
    // Sink vacío para que `track()` no acumule eventos en memoria sin consumidor.
    setEventSink(() => {});
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_ENV ?? process.env.NODE_ENV,
    /**
     * Muestreo al 10%: el free tier son 5k eventos/mes, y las trazas se consumen
     * mucho más rápido que los errores. Los errores NO se muestrean (van al 100%);
     * esto es sólo performance.
     */
    tracesSampleRate: 0.1,
    /**
     * `sendDefaultPii: false` es el default del SDK, pero se declara explícito porque
     * acá importa: el storefront maneja datos del comprador (US-008) y una IP o una
     * cookie en el evento de error contradiría la disciplina de PII del proyecto
     * (`observability-standards.md` §9).
     */
    sendDefaultPii: false,
  });

  // Los eventos de negocio de `events.ts` viajan como breadcrumbs, no como eventos
  // propios: son contexto para entender un error, no telemetría de producto. Con 5k
  // eventos/mes, mandar cada `track()` como evento agotaría la cuota en días.
  setEventSink((event, props) => {
    Sentry.addBreadcrumb({ category: 'business', message: event, data: props });
  });
}

export function captureError(error: unknown): void {
  Sentry.captureException(error);
}

export { track } from './events';
