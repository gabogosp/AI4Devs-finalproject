/**
 * Único lector de la cookie `dsm_csrf` en toda la app (US-014 T0.5).
 *
 * El backend emite tres cookies de sesión y **sólo ésta es legible por JS**, a
 * propósito: es la mitad del double-submit. Un atacante en otro origen puede
 * lograr que el navegador **mande** la cookie, pero la política de mismo origen
 * le impide **leerla** para poner el header — y sin el header el backend
 * rechaza la escritura.
 *
 * Que haya un solo lector importa: si cada llamada parseara `document.cookie`
 * por su cuenta, el día que cambie el nombre de la cookie habría que encontrar
 * todos los lugares, y el que se olvide falla con un 403 que parece otra cosa.
 */
export const CSRF_COOKIE = 'dsm_csrf';

export function readCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${CSRF_COOKIE}=([^;]*)`),
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
