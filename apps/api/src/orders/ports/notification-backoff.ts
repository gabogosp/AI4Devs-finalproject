/**
 * Backoff exponencial con jitter para `ResendNotificationAdapter` (US-011 T3.1)
 * — `backend-node-standards.md` §8.
 *
 * Duplicación chica y deliberada de `payments/mercadopago/backoff.ts`
 * (`design.md` Decisión 1): ese archivo está acoplado a
 * `MercadoPagoTransientError`; generalizarlo tocaría el módulo de pagos, que
 * esta US no tiene por qué modificar.
 */

export interface BackoffOptions {
  /** Espera de la primera reintentona, en ms. */
  baseMs: number;
  /** Techo de la espera, en ms: el exponencial no crece para siempre. */
  capMs: number;
  /** Inyectable para tests deterministas. Por defecto `Math.random`. */
  random?: () => number;
}

/**
 * Espera del intento `attempt` (0 = primer reintento).
 *
 * `min(cap, base * 2^attempt)` con jitter multiplicativo en `[0.5, 1)` — mismo
 * cálculo que `payments/mercadopago/backoff.ts`.
 */
export function backoffDelayMs(
  attempt: number,
  { baseMs, capMs, random = Math.random }: BackoffOptions,
): number {
  const exponencial = Math.min(capMs, baseMs * 2 ** attempt);
  return Math.round(exponencial * (0.5 + random() / 2));
}

/**
 * Clasifica el `statusCode` que el SDK de Resend devuelve en el resultado
 * (`{ error: { statusCode } }`, nunca lanzado) — `null`/`undefined`/`429`/`>=500`
 * son transitorios (reintentables); cualquier otro 4xx es permanente.
 *
 * Resend no lanza tipos propios (confirmado en
 * `node_modules/resend/dist/index.mjs` — devuelve `{ error }` en el
 * resultado), así que la clasificación va por `statusCode` numérico y no por
 * `instanceof`, a diferencia de `MercadoPagoTransientError`.
 */
export function isTransientResendError(statusCode: number | null | undefined): boolean {
  if (statusCode === null || statusCode === undefined) return true;
  if (statusCode === 429) return true;
  if (statusCode >= 500) return true;
  return false;
}
