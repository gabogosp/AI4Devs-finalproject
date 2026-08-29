import type { AppError } from '@/lib/http/errors';
import type { Customer } from './accountService';

/**
 * Estado de la sesión del cliente como **unión discriminada**, no como
 * `customer: Customer | null` más un `loading: boolean`
 * (`frontend-standards` §11.4).
 *
 * La diferencia no es estética: con dos booleanos existen combinaciones que no
 * significan nada (`loading` y `customer` a la vez) y, sobre todo, **`error` y
 * `anonymous` colapsan**. Un fallo de red no es lo mismo que "no hay sesión":
 * mostrar "Ingresar" cuando en realidad no pudimos preguntar le dice al cliente
 * que su sesión se cayó, y lo manda a loguearse de nuevo sin motivo.
 */
export type SessionState =
  /** Todavía no se resolvió. Se renderiza un placeholder, no "Ingresar". */
  | { kind: 'unknown' }
  /** No hay sesión. Es una respuesta, no una ausencia de respuesta. */
  | { kind: 'anonymous' }
  | { kind: 'authenticating' }
  | { kind: 'authenticated'; customer: Customer }
  /** No pudimos saberlo. Distinto de `anonymous` a propósito. */
  | { kind: 'error'; error: AppError };

/**
 * Marca **no secreta** de que hubo sesión (OQ-FE-4, opción (a)).
 *
 * No es autoridad ni credencial: el backend sigue decidiendo, y la cookie de
 * sesión es HttpOnly y no se toca desde acá. Su único trabajo es evitar que
 * **todo visitante anónimo** —que es la enorme mayoría— pague un `GET /auth/me`
 * y un 401 en cada carga, con el parpadeo de "Ingresar → tu nombre" incluido.
 *
 * Que alguien la escriba a mano en su navegador no le da nada: la siguiente
 * llamada al backend responde 401 y el estado cae a `anonymous`.
 */
export const SESSION_HINT_KEY = 'dsm.session';

export function hasSessionHint(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(SESSION_HINT_KEY) === '1';
  } catch {
    // Safari en modo privado y algunas políticas de cookies lanzan al leer.
    // Sin marca legible, el peor caso es un `/auth/me` de más, no un error.
    return false;
  }
}

export function setSessionHint(present: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (present) window.localStorage.setItem(SESSION_HINT_KEY, '1');
    else window.localStorage.removeItem(SESSION_HINT_KEY);
  } catch {
    /* idem: la marca es una optimización, no un requisito */
  }
}
