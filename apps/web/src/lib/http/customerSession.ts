/**
 * Renovación de la sesión del cliente (US-014 T0.6, G-2).
 *
 * El backend rota el refresh token y es de un solo uso, con detección de reuso
 * (ADR-0011): presentar uno ya rotado revoca **toda la familia**. Por eso dos
 * refresh en paralelo no son un desperdicio sino un bug — el segundo llega con
 * el token viejo, el backend lo lee como robo y desloguea a la persona
 * legítima. Todo el módulo existe para que eso no pase.
 *
 * Se coalescen en dos niveles: dentro de la pestaña con una promesa compartida,
 * y entre pestañas con un Web Lock por origen. Sin el segundo, tres pestañas
 * abiertas producen tres refresh concurrentes y el mismo problema.
 */

let inFlight: Promise<void> | null = null;

/** Se inyecta desde el módulo de sesión para no acoplar esto al estado de React. */
type OnSessionLost = () => void;
let onSessionLost: OnSessionLost = () => {};

export function setOnSessionLost(handler: OnSessionLost): void {
  onSessionLost = handler;
}

/**
 * Sanea el destino post-login: sólo rutas **relativas del mismo origen**.
 *
 * Un `next=https://evil.tld` en la URL convierte el login en un open redirect,
 * que es una primitiva de phishing: el usuario ve el dominio real, se
 * autentica, y termina en el sitio del atacante creyendo que sigue en el
 * nuestro. `//evil.tld` cuenta como absoluta aunque no lleve esquema.
 */
export function sanitizeNext(next: string | null | undefined): string {
  if (!next) return '/';
  if (!next.startsWith('/') || next.startsWith('//')) return '/';
  return next;
}

/** Endpoint de renovación. Same-origin: lo resuelve el rewrite (ADR-0013). */
const REFRESH_URL = '/v1/auth/refresh';

async function doRefresh(): Promise<void> {
  const { readCsrfToken } = await import('./csrf');
  const csrf = readCsrfToken();
  const headers: Record<string, string> = {};
  if (csrf) headers['x-csrf-token'] = csrf;

  // Sin reintento ante error de red, a propósito: reintentar un token de un
  // solo uso es exactamente el patrón que el backend lee como reuso.
  const res = await fetch(REFRESH_URL, {
    method: 'POST',
    credentials: 'include',
    headers,
  });

  if (!res.ok) {
    onSessionLost();
    throw new Error(`refresh-failed:${res.status}`);
  }
}

/**
 * Un solo refresh en vuelo por origen. Las llamadas concurrentes esperan al
 * mismo, no disparan el suyo.
 */
export function refreshOnce(): Promise<void> {
  if (inFlight) return inFlight;

  const run = () => doRefresh();

  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  inFlight = (
    locks ? locks.request('dsm-auth-refresh', run) : run()
  ).finally(() => {
    inFlight = null;
  }) as Promise<void>;

  return inFlight;
}

/** Sólo para los tests: descarta el refresh en vuelo entre casos. */
export function resetRefreshState(): void {
  inFlight = null;
}
