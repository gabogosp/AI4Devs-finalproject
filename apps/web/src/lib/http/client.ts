import { publicEnv } from '../env';
import { getAuthToken } from './authToken';
import { AppErrorException, mapProblemToAppError, networkError } from './errors';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
}

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
 * Único punto de red del panel (frontend-standards §8). Inyecta Authorization
 * cuando hay sesión, propaga `traceparent`, aplica timeout, y traduce el envelope
 * RFC 7807 a `AppErrorException`. Ningún componente llama `fetch` directo.
 */
export async function httpRequest<T>(
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const url = `${publicEnv.NEXT_PUBLIC_API_BASE_URL}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15000);
  if (opts.signal) {
    opts.signal.addEventListener('abort', () => controller.abort());
  }

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    traceparent: traceparent(),
  };
  const token = getAuthToken();
  if (token) headers.authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
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
    throw new AppErrorException(mapProblemToAppError(res.status, body));
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
