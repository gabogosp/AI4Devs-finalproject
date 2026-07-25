import { setEventSink } from './events';

/**
 * Inicialización de observabilidad FE (E2E §18): errores + Web Vitals + eventos
 * de negocio. Backend previsto: Sentry. Sin DSN configurado → no-op seguro.
 *
 * NOTA (deviación consciente): el SDK `@sentry/nextjs` no se cablea en US-001
 * para no acoplar el bundle a una config de proyecto/DSN que aún no existe. Este
 * módulo es la costura: cuando el proyecto tenga DSN, `initObservability` hace
 * `Sentry.init(...)` y apunta el sink de eventos a `Sentry.addBreadcrumb`. La
 * arquitectura de eventos (events.ts) ya está lista y testeada.
 */
export function initObservability(): void {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  // Cuando se agregue @sentry/nextjs:
  //   Sentry.init({ dsn, tracesSampleRate, integrations: [browserTracingIntegration()] });
  //   setEventSink((event, props) => Sentry.addBreadcrumb({ category: 'business', message: event, data: props }));
  setEventSink(() => {});
}

export function captureError(error: unknown): void {
  // Sentry.captureException(error) cuando el SDK esté cableado.
  void error;
}

export { track } from './events';
