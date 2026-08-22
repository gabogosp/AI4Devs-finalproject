import { publicEnv } from '../env';
import { getAuthToken } from './authToken';
import { AppErrorException, mapProblemToAppError, networkError } from './errors';
import { readCsrfToken, requiereCsrf } from './csrf';

/**
 * **Mutator del cliente generado** (orval `override.mutator`) y único punto de
 * red del panel (`frontend-standards` §8).
 *
 * Por qué es el mutator y no un cliente paralelo (F48): el cliente **generado**
 * es un artefacto del contrato, así que no puede nombrar un endpoint que el
 * contrato no declara. Enrutando todo por él, una ruta fuera de contrato se
 * vuelve estructuralmente imposible — que es exactamente cómo se coló
 * `POST /v1/admin/auth/login` cuando el backend no lo exponía. Las operaciones
 * generadas delegan acá, así que los cross-cutting (Authorization, traceparent,
 * timeout, traducción RFC 7807) se conservan intactos.
 *
 * Éste es el ÚNICO `fetch` crudo del frontend y está declarado como tal en
 * `.consumer-contract-allow`.
 *
 * **Isomorfo** (US-003): el storefront lo ejecuta también desde Server
 * Components. En servidor no se inyectan `authorization` (superficie pública)
 * ni `traceparent`: un header aleatorio por render entra en la clave de la Data
 * Cache de Next y anularía `revalidate`/`tags`. Las opciones de caché del caller
 * (`next`, `cache`) se reenvían al `fetch` subyacente — la política de caché la
 * declara cada servicio, nunca este mutator (next-standards §3).
 */

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * `RequestInit` + las extensiones de caché de Next. Es el tipo que ve el cliente
 * generado (`options?: Parameters<typeof customFetch>[1]`), así que un servicio
 * puede declarar `{ next: { revalidate, tags } }` con tipos.
 */
export type FetchInit = RequestInit & {
  next?: { revalidate?: number | false; tags?: string[] };
  /**
   * Marca la llamada como parte de la **sesión del cliente** (US-014).
   *
   * Son dos modelos de auth que conviven en un solo choke point: el panel usa
   * `Bearer` desde memoria, el cliente usa cookies que el navegador maneja
   * solo. Sin esta marca el comportamiento es exactamente el de antes.
   */
  session?: 'customer';
};

function hex(len: number): string {
  let out = '';
  for (let i = 0; i < len; i += 1) {
    out += Math.floor(Math.random() * 16).toString(16);
  }
  return out;
}

/** W3C traceparent para correlación cliente↔backend. */
function traceparent(): string {
  return `00-${hex(32)}-${hex(16)}-01`;
}

/**
 * Mutator: recibe la URL que construyó el cliente generado (siempre derivada
 * del contrato) y ejecuta la llamada con los cross-cutting del panel.
 *
 * `T` es el **sobre completo** que declara la operación generada
 * (`{ data, status }`), no sólo el payload — por eso se construye y castea acá.
 */
export async function customFetch<T>(
  url: string,
  init: FetchInit = {},
): Promise<T> {
  const isServer = typeof window === 'undefined';

  // La sesión del cliente es **sólo de navegador** (design.md D3): las cookies
  // las maneja el navegador, y un Server Component que renderizara contenido
  // personalizado lo metería en la Data Cache de Next — cacheado y servido a
  // otra persona. Lanzar acá lo vuelve imposible por accidente, no por
  // disciplina.
  if (init.session === 'customer' && isServer) {
    throw new AppErrorException({
      kind: 'server',
      message: 'La sesión del cliente es sólo de navegador (design.md D3)',
    });
  }

  // Same-origin a propósito (ADR-0013): el rewrite de Next lleva la llamada al
  // API, y así la cookie aterriza en el dominio del sitio y vuelve. Una URL
  // absoluta al API rompería la topología entera.
  const absolute =
    init.session === 'customer'
      ? url
      : url.startsWith('http')
        ? url
        : `${publicEnv.NEXT_PUBLIC_API_BASE_URL}${url}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  if (init.signal) {
    init.signal.addEventListener('abort', () => controller.abort());
  }

  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  // Sólo en el browser: el token es de la sesión del panel y el traceparent es
  // aleatorio por llamada — en servidor rompería la clave de la Data Cache.
  if (!isServer) {
    headers.set('traceparent', traceparent());
    const token = getAuthToken();
    if (token) headers.set('authorization', `Bearer ${token}`);
  }

  // Double-submit sólo donde el backend lo exige: escrituras de la sesión del
  // cliente. Si la cookie no está, la llamada sale SIN header y el 403 se
  // propaga — fail closed. Inventar un valor sólo cambiaría el 403 por un
  // error más confuso.
  if (init.session === 'customer' && requiereCsrf(init.method)) {
    const csrf = readCsrfToken();
    if (csrf) headers.set('x-csrf-token', csrf);
  }

  let res: Response;
  try {
    res = await fetch(absolute, {
      ...init,
      headers,
      signal: controller.signal,
      // Sin `include` el navegador no manda las cookies ni guarda las que
      // vuelven, aunque el rewrite esté bien: la topología no alcanza sola.
      ...(init.session === 'customer' ? { credentials: 'include' as const } : {}),
    });
  } catch {
    throw new AppErrorException(networkError());
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = undefined;
    }
    // El backend manda `Retry-After` en los 429; sin leerlo acá se pierde y la
    // UI no puede decirle al cliente cuánto esperar.
    const retryAfter = Number(res.headers.get('retry-after'));
    throw new AppErrorException(
      mapProblemToAppError(
        res.status,
        body,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
      ),
    );
  }

  const text = [204, 205, 304].includes(res.status) ? '' : await res.text();
  const data = text ? JSON.parse(text) : undefined;
  return { data, status: res.status, headers: res.headers } as T;
}

export default customFetch;
