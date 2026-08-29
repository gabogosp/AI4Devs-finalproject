/**
 * Único lector de cookies CSRF en toda la app (US-014 T0.5; segundo sujeto en
 * US-007 T0.4).
 *
 * El backend emite varias cookies por sujeto y **sólo la de CSRF es legible por
 * JS**, a propósito: es la mitad del double-submit. Un atacante en otro origen
 * puede lograr que el navegador **mande** la cookie, pero la política de mismo
 * origen le impide **leerla** para poner el header — y sin el header el backend
 * rechaza la escritura.
 *
 * Que haya un solo lector importa: si cada llamada parseara `document.cookie`
 * por su cuenta, el día que cambie el nombre de la cookie habría que encontrar
 * todos los lugares, y el que se olvide falla con un 403 que parece otra cosa.
 *
 * **Dos sujetos, un lector.** El carrito del invitado (US-007) tiene su propia
 * identidad: alguien sin cuenta tiene carrito y no tiene sesión, así que los dos
 * sujetos coexisten y hay que distinguirlos. Lo que se agrega es el **nombre**,
 * no un segundo parser.
 */
export const CSRF_COOKIES = {
  session: 'dsm_csrf',
  cart: 'dsm_cart_csrf',
} as const;

export type CsrfSubject = keyof typeof CSRF_COOKIES;

/**
 * Nombre de la cookie de sesión. Se conserva el export original para no romper a
 * ningún consumidor de US-014.
 */
export const CSRF_COOKIE = CSRF_COOKIES.session;

export function readCsrfToken(subject: CsrfSubject = 'session'): string | null {
  if (typeof document === 'undefined') return null;
  const nombre = CSRF_COOKIES[subject];
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${nombre}=([^;]*)`),
  );
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Métodos que el backend considera escrituras y para los que exige el header.
 * `GET`/`HEAD` no lo llevan: pedirlo ahí rompería a un cliente sin sesión, que
 * es el caso normal de `login` y `register`.
 */
const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function requiereCsrf(method: string | undefined): boolean {
  return !METODOS_SEGUROS.has((method ?? 'GET').toUpperCase());
}
