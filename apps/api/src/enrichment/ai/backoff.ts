import { AiTransientError } from '../../common/errors/enrichment-errors';

/**
 * Backoff exponencial con jitter (US-005 T1.3) — `backend-node-standards.md` §8.
 *
 * Función **pura**: recibe el intento y devuelve los ms de espera. Sin librería, sin
 * reloj, sin estado — así el test la ejerce sin fake timers y el decorador de reintentos
 * queda con una sola responsabilidad.
 *
 * El jitter no es adorno: sin él, N corridas que fallan a la vez reintentan a la vez y
 * el proveedor recibe la misma ráfaga que lo tiró (thundering herd). El ±50 % rompe la
 * sincronización.
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
 * `min(cap, base * 2^attempt)` con jitter multiplicativo en `[0.5, 1)`: la espera nunca
 * es menor a la mitad del backoff calculado ni mayor que él.
 */
export function backoffDelayMs(
  attempt: number,
  { baseMs, capMs, random = Math.random }: BackoffOptions,
): number {
  const exponencial = Math.min(capMs, baseMs * 2 ** attempt);
  return Math.round(exponencial * (0.5 + random() / 2));
}

export interface RetryOptions extends BackoffOptions {
  /** Reintentos **además** del intento inicial. */
  maxRetries: number;
  /** Inyectable: en tests avanza los fake timers en vez de dormir de verdad. */
  sleep: (ms: number) => Promise<void>;
}

/**
 * Ejecuta `fn` reintentando **sólo** los fallos transitorios.
 *
 * Dos reglas que importan:
 *
 * 1. **`AiPermanentError` no se reintenta**: una respuesta de 512 dimensiones o un 400
 *    no se arreglan insistiendo, y cinco intentos queman cuota del free tier para nada.
 * 2. **`retryAfterSeconds` del proveedor gana** sobre el backoff calculado. Si el
 *    proveedor dice «volvé en 30 s», esperar 2 s porque nuestra fórmula lo dice es
 *    pedirle otro 429.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  let ultimo: unknown;

  for (let intento = 0; intento <= opts.maxRetries; intento += 1) {
    try {
      return await fn();
    } catch (error) {
      ultimo = error;

      // Permanente ⇒ se propaga sin gastar un intento más.
      if (!(error instanceof AiTransientError)) throw error;
      if (intento === opts.maxRetries) break;

      const sugerida = error.retryAfterSeconds;
      const espera =
        sugerida !== undefined && sugerida > 0
          ? sugerida * 1_000
          : backoffDelayMs(intento, opts);
      await opts.sleep(espera);
    }
  }

  throw ultimo;
}
