import { IncomingHttpHeaders } from 'node:http';
import { CsrfError } from '../errors/auth-errors';

/**
 * Verificación de `Origin` de una escritura autenticada por cookie —
 * `security-standards.md` §7.5.
 *
 * Extraída de `CsrfGuard` (US-007 T1.2) porque desde el carrito hay **dos**
 * guards que la necesitan: el de la sesión de cliente (deriva el double-submit
 * del `jti` del access) y el del carrito del invitado (lo deriva del token de
 * `dsm_cart`). Lo único que comparten es esto, y duplicarlo garantizaba que un
 * endurecimiento futuro se aplicara a uno solo.
 *
 * Es TS plano, sin tipos de framework: recibe los headers y la allowlist, y
 * lanza. Así se puede ejercer cada caso de rechazo sin levantar HTTP.
 *
 * Reglas, en orden:
 *
 * 1. Con `Origin`: igualdad **exacta** contra la allowlist. Nada de sufijos ni
 *    regex, porque `https://dsm.com.ar.evil.net` termina en el dominio bueno.
 * 2. Sin `Origin`, se acepta `Referer` como respaldo comparando **sólo su
 *    origen** (no la ruta): algunos navegadores no mandan `Origin` en ciertos
 *    flujos.
 * 3. Sin ninguno de los dos: no verificable ⇒ rechazo (§3.8, fail closed).
 */
export function verifyRequestOrigin(
  req: { headers: IncomingHttpHeaders },
  allowedOrigins: string[],
): void {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin.length > 0) {
    if (!allowedOrigins.includes(origin)) throw new CsrfError();
    return;
  }

  const referer = req.headers.referer;
  if (typeof referer === 'string' && referer.length > 0) {
    try {
      const { origin: origenDelReferer } = new URL(referer);
      if (!allowedOrigins.includes(origenDelReferer)) throw new CsrfError();
      return;
    } catch (error) {
      // Un Referer que no parsea no es evidencia de nada.
      if (error instanceof CsrfError) throw error;
      throw new CsrfError();
    }
  }

  throw new CsrfError();
}
