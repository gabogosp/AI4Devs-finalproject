import { createHmac } from 'node:crypto';
import { Response } from 'express';

/**
 * Cookies de sesión — `security-standards.md` §7.4.
 *
 * Los atributos viven **acá y en ningún otro lado**. Un `res.cookie()` suelto en
 * un controller es como se pierden estas garantías: alguien agrega una ruta,
 * copia la línea sin el `httpOnly`, y el token pasa a ser legible por cualquier
 * script inyectado. Si hay que emitir una cookie de sesión, se hace por esta
 * función.
 */

export const ACCESS_COOKIE = 'dsm_access';
export const REFRESH_COOKIE = 'dsm_refresh';
export const CSRF_COOKIE = 'dsm_csrf';

/**
 * El refresh se acota a `/v1/auth`. No es cosmético: es la única cookie que
 * puede reabrir una sesión, y limitar su `path` significa que no viaja en cada
 * petición al catálogo. Menos superficie por la que filtrarse en un log de
 * proxy, un error de CDN o un header volcado a una traza.
 */
export const REFRESH_COOKIE_PATH = '/v1/auth';

export interface CookieOptions {
  accessTtlMin: number;
  refreshTtlDays: number;
  /** `AUTH_COOKIE_SECURE` — `true` por default; sólo `false` en local sin TLS. */
  secure: boolean;
}

export interface SessionCookies {
  accessToken: string;
  refreshToken: string;
  /** Valor del double-submit, derivado del `jti` (T4.4). */
  csrfToken: string;
}

/**
 * Deriva el token CSRF del `jti` del access con HMAC del secreto del servidor.
 *
 * Derivado y no aleatorio: así el guard puede **recalcularlo** desde el token
 * presentado y compararlo, sin guardar nada. Sin `JWT_SECRET` no se puede forjar,
 * que es lo que lo hace útil como segunda capa sobre `SameSite`.
 */
export function deriveCsrfToken(jti: string, secret: string): string {
  return createHmac('sha256', secret).update(jti).digest('base64url');
}

/**
 * Emite las tres cookies de sesión.
 *
 * `dsm_csrf` es la única **sin** `httpOnly`, y tiene que ser así: el frontend
 * necesita leerla para reenviarla en el header `X-CSRF-Token`. Ahí está el
 * double-submit — un atacante en otro origen puede provocar que el navegador
 * mande la cookie, pero no puede leerla para poner el header, porque la política
 * de mismo origen se lo impide.
 */
export function setSessionCookies(
  res: Response,
  tokens: SessionCookies,
  opts: CookieOptions,
): void {
  const { secure } = opts;

  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: opts.accessTtlMin * 60_000,
  });

  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
    maxAge: opts.refreshTtlDays * 24 * 60 * 60_000,
  });

  res.cookie(CSRF_COOKIE, tokens.csrfToken, {
    httpOnly: false, // el frontend la lee para armar el header
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: opts.accessTtlMin * 60_000,
  });
}

/**
 * Borra las tres cookies.
 *
 * El `path` tiene que coincidir **exactamente** con el de emisión: un navegador
 * trata `dsm_refresh` en `/` y en `/v1/auth` como cookies distintas. Borrar sin
 * el path correcto deja viva justo la que puede reabrir la sesión — un logout
 * que parece exitoso y no revoca nada del lado del cliente.
 */
export function clearSessionCookies(res: Response, secure: boolean): void {
  const comunes = { httpOnly: true, secure, sameSite: 'lax' as const };

  res.clearCookie(ACCESS_COOKIE, { ...comunes, path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...comunes, path: REFRESH_COOKIE_PATH });
  res.clearCookie(CSRF_COOKIE, { ...comunes, httpOnly: false, path: '/' });
}
