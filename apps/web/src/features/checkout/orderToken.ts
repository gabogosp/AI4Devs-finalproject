/**
 * Persistencia del `order_token` entre la confirmación del checkout y el inicio
 * del pago. `Deferred: US-009 — owner: FE` — hoy nada lo lee.
 *
 * `sessionStorage`, NUNCA la URL (`design.md` D7): el `order_token` es la
 * credencial de la orden, no un identificador — un querystring queda en el
 * historial, en logs de proxies intermedios y en el `Referer` que el navegador
 * manda al salir del sitio (mismo razonamiento que el backend aplicó para no
 * exponer `order_id` en la URL).
 */
const KEY = 'dsm_order_token';

export function saveOrderToken(token: string): void {
  sessionStorage.setItem(KEY, token);
}
