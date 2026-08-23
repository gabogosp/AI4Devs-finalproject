import { QA_API_BASE_URL } from './qa-env';

const API = QA_API_BASE_URL;

/**
 * Llamada autenticada a la API admin para los seeds de la suite cross-stack.
 *
 * Falla **ruidoso** ante cualquier status no-2xx: un seed que degrada en
 * silencio produce tests que pasan contra datos que no existen, que es peor que
 * no tener el test.
 */
export async function apiCall<T>(
  path: string,
  method: string,
  token: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`${method} ${path} → ${res.status} ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}
