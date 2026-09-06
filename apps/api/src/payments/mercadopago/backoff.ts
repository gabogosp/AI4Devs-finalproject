import { DomainError } from '../../common/errors/domain-errors';

/**
 * Backoff exponencial con jitter para `MercadoPagoClient` (US-010 T3.1) —
 * `backend-node-standards.md` §8.
 *
 * Duplicación chica y deliberada de `enrichment/ai/backoff.ts` (`design.md`
 * Trade-offs): ese archivo está acoplado a `AiTransientError`; generalizarlo
 * tocaría un módulo que esta US no tiene por qué modificar. Con su propio
 * `MercadoPagoTransientError`/`MercadoPagoPermanentError`.
 */

/**
 * 503 — MercadoPago falló de forma **reintentable**: 429, 5xx o timeout.
 * `retryAfterSeconds` viene del header `Retry-After` cuando MP lo manda —
 * gana sobre el backoff calculado.
 */
export class MercadoPagoTransientError extends DomainError {
  readonly status = 503;
  readonly type = 'dsm:payments/mercadopago-transient';
  readonly retryAfterSeconds?: number;

  constructor(message = 'MercadoPago no respondió', retryAfterSeconds?: number) {
    super(message);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * 502 — MercadoPago respondió algo que no se arregla reintentando (4xx
 * salvo 429, o un body inesperado).
 */
export class MercadoPagoPermanentError extends DomainError {
  readonly status = 502;
  readonly type = 'dsm:payments/mercadopago-permanent';
}

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
 * `min(cap, base * 2^attempt)` con jitter multiplicativo en `[0.5, 1)`: la
 * espera nunca es menor a la mitad del backoff calculado ni mayor que él —
 * sin jitter, N corridas que fallan juntas reintentan juntas y repiten la
 * ráfaga que tiró al proveedor.
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
  /** Inyectable: en tests avanza el tiempo simulado en vez de dormir de verdad. */
  sleep: (ms: number) => Promise<void>;
}

/**
 * Ejecuta `fn` reintentando **sólo** `MercadoPagoTransientError`.
 * `MercadoPagoPermanentError` (y cualquier otro error) se propaga sin
 * gastar un intento más.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  let ultimo: unknown;

  for (let intento = 0; intento <= opts.maxRetries; intento += 1) {
    try {
      return await fn();
    } catch (error) {
      ultimo = error;

      if (!(error instanceof MercadoPagoTransientError)) throw error;
      if (intento === opts.maxRetries) break;

      const sugerida = error.retryAfterSeconds;
      const espera =
        sugerida !== undefined && sugerida > 0 ? sugerida * 1_000 : backoffDelayMs(intento, opts);
      await opts.sleep(espera);
    }
  }

  throw ultimo;
}
