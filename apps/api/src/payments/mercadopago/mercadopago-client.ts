import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { configNumber } from '../../enrichment/config-number';
import { MercadoPagoPermanentError, MercadoPagoTransientError, withRetry } from './backoff';

/** Base de la API REST de MercadoPago. Inyectable para apuntarla a un stub en tests. */
export const MP_BASE_URL = 'https://api.mercadopago.com';

export interface MercadoPagoPayment {
  id: string;
  status: string;
  amountArsCents: number;
  externalReference?: string;
}

interface RespuestaPayment {
  id?: unknown;
  status?: unknown;
  transaction_amount?: unknown;
  external_reference?: unknown;
}

interface RespuestaSearch {
  results?: RespuestaPayment[];
}

/**
 * Costuras de tiempo + del breaker, inyectables para tests (US-010 T3.2) —
 * mismo criterio que `GeminiTimingSeams` de `enrichment/ai/gemini-http.client.ts`.
 */
export interface MercadoPagoClientSeams {
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
  /** Fallos consecutivos antes de abrir el breaker. */
  breakerThreshold?: number;
  /** Cuánto dura el breaker abierto, en ms. */
  breakerCooldownMs?: number;
  now?: () => number;
}

/**
 * Adapter REST de MercadoPago (US-010 T3.2) — alcance mínimo: `getPayment`,
 * `searchByExternalReference`, `refund`. **Sin `createPreference`** — eso
 * sigue siendo de `US-009` (bloqueada, sin credenciales).
 *
 * Mismas cuatro reglas que `GeminiHttpClient` (`design.md` §Approach, calcado
 * a propósito):
 *
 * 1. **El token va en el header `Authorization: Bearer`, nunca en la URL**
 *    (`security-standards.md` §5).
 * 2. **Timeout explícito** con `AbortSignal.timeout`.
 * 3. **La respuesta se valida antes de devolverse** — un `transaction_amount`
 *    ausente o no numérico es basura que no se arregla reintentando.
 * 4. **Ningún error incluye el `MP_ACCESS_TOKEN`.**
 *
 * Circuit-breaker in-process (mismo estilo que `EnrichmentRunner`): tras
 * `breakerThreshold` fallos CONSECUTIVOS, las llamadas siguientes fallan
 * rápido sin tocar `fetch` hasta que pase `breakerCooldownMs` — un proveedor
 * caído no debe convertir cada webhook en un timeout de 4s adicional.
 */
@Injectable()
export class MercadoPagoClient {
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRetries: number;
  private readonly breakerThreshold: number;
  private readonly breakerCooldownMs: number;
  private readonly now: () => number;
  private fallosConsecutivos = 0;
  private cooldownHasta = 0;

  constructor(
    private readonly config: ConfigService,
    private readonly baseUrl: string = MP_BASE_URL,
    seams: MercadoPagoClientSeams = {},
  ) {
    this.sleep = seams.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
    this.maxRetries = seams.maxRetries ?? configNumber(this.config, 'MP_MAX_RETRIES', 2);
    this.breakerThreshold = seams.breakerThreshold ?? 5;
    this.breakerCooldownMs = seams.breakerCooldownMs ?? 60_000;
    this.now = seams.now ?? (() => Date.now());
  }

  private get accessToken(): string {
    return this.config.getOrThrow<string>('MP_ACCESS_TOKEN');
  }

  private get timeoutMs(): number {
    return configNumber(this.config, 'MP_HTTP_TIMEOUT_MS', 4_000);
  }

  async getPayment(paymentId: string): Promise<MercadoPagoPayment> {
    const json = await this.get<RespuestaPayment>(`${this.baseUrl}/v1/payments/${paymentId}`);
    return this.mapPayment(json);
  }

  async searchByExternalReference(orderId: string): Promise<MercadoPagoPayment[]> {
    const json = await this.get<RespuestaSearch>(
      `${this.baseUrl}/v1/payments/search?external_reference=${encodeURIComponent(orderId)}`,
    );
    return (json.results ?? []).map((r) => this.mapPayment(r));
  }

  async refund(paymentId: string, amountArsCents?: number): Promise<void> {
    await this.request<unknown>(`${this.baseUrl}/v1/payments/${paymentId}/refunds`, {
      method: 'POST',
      body:
        amountArsCents !== undefined ? JSON.stringify({ amount: amountArsCents / 100 }) : undefined,
    });
  }

  private mapPayment(json: RespuestaPayment): MercadoPagoPayment {
    if (typeof json.id !== 'string' && typeof json.id !== 'number') {
      throw new MercadoPagoPermanentError('la respuesta de MercadoPago no trae un id de pago');
    }
    if (typeof json.status !== 'string') {
      throw new MercadoPagoPermanentError('la respuesta de MercadoPago no trae status');
    }
    const monto = Number(json.transaction_amount);
    if (!Number.isFinite(monto)) {
      throw new MercadoPagoPermanentError(
        'la respuesta de MercadoPago no trae un transaction_amount numérico',
      );
    }
    return {
      id: String(json.id),
      status: json.status,
      amountArsCents: Math.round(monto * 100),
      externalReference:
        typeof json.external_reference === 'string' ? json.external_reference : undefined,
    };
  }

  private async get<T>(url: string): Promise<T> {
    return this.request<T>(url, { method: 'GET' });
  }

  /** Reintentos + breaker, cableados donde se paga el costo — mismo criterio que `GeminiHttpClient.post`. */
  private async request<T>(url: string, init: { method: string; body?: string }): Promise<T> {
    if (this.now() < this.cooldownHasta) {
      throw new MercadoPagoTransientError(
        `MercadoPago en cooldown tras ${this.fallosConsecutivos} fallos consecutivos`,
      );
    }

    try {
      const resultado = await withRetry(() => this.requestDirecto<T>(url, init), {
        maxRetries: this.maxRetries,
        baseMs: 1_000,
        capMs: 30_000,
        sleep: this.sleep,
      });
      this.fallosConsecutivos = 0;
      return resultado;
    } catch (error) {
      if (error instanceof MercadoPagoTransientError) {
        this.fallosConsecutivos += 1;
        if (this.fallosConsecutivos >= this.breakerThreshold) {
          this.cooldownHasta = this.now() + this.breakerCooldownMs;
        }
      }
      throw error;
    }
  }

  /** La llamada HTTP en crudo, sin política de reintento ni de breaker. */
  private async requestDirecto<T>(
    url: string,
    init: { method: string; body?: string },
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetch(url, {
        method: init.method,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.accessToken}`, // NUNCA en la URL
        },
        body: init.body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const esTimeout =
        error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
      throw new MercadoPagoTransientError(
        esTimeout ? `MercadoPago no respondió en ${this.timeoutMs} ms` : 'no se pudo contactar a MercadoPago',
      );
    }

    if (!res.ok) {
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get('retry-after'));
        throw new MercadoPagoTransientError(
          `MercadoPago respondió ${res.status}`,
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
        );
      }
      throw new MercadoPagoPermanentError(`MercadoPago respondió ${res.status}`);
    }

    if (res.status === 204) return undefined as T;
    try {
      return (await res.json()) as T;
    } catch {
      throw new MercadoPagoPermanentError('la respuesta de MercadoPago no es JSON válido');
    }
  }
}
