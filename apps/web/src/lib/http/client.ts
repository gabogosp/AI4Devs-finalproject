import { publicEnv } from '../env';
import { getAuthToken } from './authToken';
import { AppErrorException, mapProblemToAppError, networkError } from './errors';

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
 */

const DEFAULT_TIMEOUT_MS = 15_000;

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
  init: RequestInit = {},
): Promise<T> {
  const absolute = url.startsWith('http')
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
  headers.set('traceparent', traceparent());
  const token = getAuthToken();
  if (token) headers.set('authorization', `Bearer ${token}`);

  let res: Response;
  try {
    res = await fetch(absolute, { ...init, headers, signal: controller.signal });
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
    throw new AppErrorException(mapProblemToAppError(res.status, body));
  }

  const text = [204, 205, 304].includes(res.status) ? '' : await res.text();
  const data = text ? JSON.parse(text) : undefined;
  return { data, status: res.status, headers: res.headers } as T;
}

export default customFetch;
