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
 * Cookies del carrito del invitado (US-007). Viven acá y no en un módulo propio
 * por la misma razón que las de sesión: los atributos §7.4 tienen **un** hogar.
 * Un `res.cookie('dsm_cart', …)` suelto en el controller del carrito es
 * exactamente el modo de perder el `HttpOnly` en la próxima ruta que alguien
 * agregue.
 *
 * `dsm_cart` **es** la identidad del carrito: no hay id en la URL ni chequeo de
 * propiedad que se pueda olvidar. Por eso lleva el token opaco (256 bits) y
 * nunca sale en un cuerpo de respuesta — sólo como `Set-Cookie`.
 */
export const CART_COOKIE = 'dsm_cart';
export const CART_CSRF_COOKIE = 'dsm_cart_csrf';

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

export interface CartCookies {
  /** Token opaco del carrito, en claro. En base sólo vive su hash. */
  token: string;
  /** Double-submit del carrito: `deriveCsrfToken(token, JWT_SECRET)`. */
  csrfToken: string;
}

export interface CartCookieOptions {
  /** `CART_TTL_DAYS` — el MISMO valor del que se deriva `carts.expires_at`. */
  ttlDays: number;
  /** `AUTH_COOKIE_SECURE` — se reusa; no hay una segunda variable del carrito. */
  secure: boolean;
}

/**
 * Emite las dos cookies del carrito del invitado (US-007 T1.1).
 *
 * `Path=/` en las dos: el carrito se toca desde `/v1/cart` pero el FE necesita
 * leer el valor CSRF desde cualquier página (la ficha, el listado), así que
 * acotar el path como se hace con el refresh sería contraproducente acá.
 *
 * El `maxAge` sale del **mismo** `CART_TTL_DAYS` que fija `carts.expires_at`.
 * Que los dos se deriven del mismo número es lo que evita el peor de los casos:
 * una cookie viva apuntando a una fila vencida, es decir un carrito que
 * "desaparece" sin explicación.
 */
export function setCartCookies(
  res: Response,
  tokens: CartCookies,
  opts: CartCookieOptions,
): void {
  const { secure } = opts;
  const maxAge = opts.ttlDays * 24 * 60 * 60_000;

  res.cookie(CART_COOKIE, tokens.token, {
    httpOnly: true, // un XSS en el storefront no se lleva carritos
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge,
  });

  res.cookie(CART_CSRF_COOKIE, tokens.csrfToken, {
    httpOnly: false, // el frontend la lee para armar el header X-CSRF-Token
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge,
  });
}

/** Borra las dos cookies del carrito con el MISMO `Path` de emisión. */
export function clearCartCookies(res: Response, secure: boolean): void {
  const comunes = { secure, sameSite: 'lax' as const, path: '/' };

  res.clearCookie(CART_COOKIE, { ...comunes, httpOnly: true });
  res.clearCookie(CART_CSRF_COOKIE, { ...comunes, httpOnly: false });
}
