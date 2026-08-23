import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiEmbedder } from '../ai/ports/ai.ports';
import { configNumber } from '../enrichment/config-number';
import { QUERY_VECTOR_CACHE, QueryVectorCache } from './query-vector.cache';
import { SEARCH_EMBEDDER } from './search-embedder.provider';

/**
 * Por qué no hay vector para esta consulta. Es un **valor**, no una excepción.
 *
 * `unavailable` = no hay proveedor (sin clave, o sin cuota asignada a la búsqueda).
 * `timeout` = el proveedor no contestó dentro del presupuesto.
 * `provider_error` = contestó, pero mal (4xx/5xx, vector inválido).
 */
export type DegradationReason = 'unavailable' | 'timeout' | 'provider_error';

export type QueryEmbedding =
  | { ok: true; vector: number[]; model: string; cached: boolean }
  | { ok: false; reason: DegradationReason };

/**
 * Embedding de la consulta del cliente, con el presupuesto del camino interactivo
 * (US-004 T1.2).
 *
 * **La decisión de diseño que gobierna este archivo**: la degradación es un valor de retorno,
 * no una excepción. Si esto lanzara, el `catch` quedaría en el service y alguien tendría que
 * acordarse de traducirlo a `degraded: true` en cada camino nuevo; devolviendo
 * `{ ok: false, reason }` el compilador obliga a tratar el caso. Es lo que hace que AC-4 no
 * sea una rama excepcional sino el comportamiento por defecto cuando el presupuesto se agota
 * (D1).
 *
 * **El deadline se aplica acá y no sólo en el adapter.** El adapter con perfil `interactive`
 * ya usa `GEMINI_SEARCH_TIMEOUT_MS` en su `AbortSignal`, pero el **puerto** no promete
 * timeout: un doble de prueba, o un adapter futuro, pueden colgarse. Poner el reloj en el
 * consumidor convierte el presupuesto en una garantía del sistema en vez de una cortesía del
 * proveedor.
 */
@Injectable()
export class QueryEmbedder {
  private readonly logger = new Logger(QueryEmbedder.name);

  constructor(
    @Inject(SEARCH_EMBEDDER) private readonly embedder: AiEmbedder,
    private readonly config: ConfigService,
    /**
     * Caché **del vector**. Opcional para que los tests que miden el presupuesto de tasa no
     * tengan que armarlo, pero en la app siempre está: con el free tier es lo único que hace
     * tolerable el techo de RPM.
     */
    @Optional() @Inject(QUERY_VECTOR_CACHE) private readonly cache?: QueryVectorCache,
  ) {}

  /** El modelo con el que se generan los vectores de consulta (parte de la clave del caché). */
  get model(): string {
    return this.config.get<string>('GEMINI_EMBED_MODEL', 'text-embedding-004');
  }

  /** `false` cuando no hay proveedor: el service degrada sin intentar la llamada. */
  get available(): boolean {
    return this.embedder.available;
  }

  async embedQuery(consulta: string): Promise<QueryEmbedding> {
    const model = this.model;

    // El caché se consulta ANTES de mirar la disponibilidad del proveedor: un vector ya pagado
    // sigue sirviendo aunque en este momento no haya cuota o no haya clave. Al revés —chequear
    // disponibilidad primero— se degradaría a full-text teniendo el vector en la mano, que es
    // regalar trabajo ya comprado justo cuando el recurso escasea.
    const enCache = this.cache?.get(consulta, model);
    if (enCache) {
      return { ok: true, vector: enCache, model, cached: true };
    }

    if (!this.embedder.available) {
      return { ok: false, reason: 'unavailable' };
    }

    const presupuesto = configNumber(this.config, 'GEMINI_SEARCH_TIMEOUT_MS', 900);

    // Centinela por identidad: un `Symbol` no puede confundirse con un valor legítimo del
    // proveedor, a diferencia de `null` o de un vector vacío.
    const VENCIDO = Symbol('deadline');
    let cancelarReloj: (() => void) | undefined;
    const reloj = new Promise<typeof VENCIDO>((resolve) => {
      const t = setTimeout(() => resolve(VENCIDO), presupuesto);
      // `unref` donde exista: un timer pendiente no debe mantener vivo el proceso ni colgar
      // el runner de tests después de que la respuesta ya salió.
      (t as unknown as { unref?: () => void }).unref?.();
      cancelarReloj = () => clearTimeout(t);
    });

    try {
      const resultado = await Promise.race([this.embedder.embed(consulta), reloj]);

      if (resultado === VENCIDO) {
        // Se ABANDONA la llamada: no se espera al proveedor ni se propaga un 5xx. La promesa
        // en vuelo queda huérfana a propósito — su resultado ya no le sirve a nadie, y
        // esperarla sería gastar el presupuesto que se acaba de declarar agotado.
        this.logger.warn(
          `el embedding de la consulta no llegó en ${presupuesto} ms: se responde por full-text (degradado)`,
        );
        return { ok: false, reason: 'timeout' };
      }

      this.cache?.set(consulta, model, resultado);
      return { ok: true, vector: resultado, model, cached: false };
    } catch (error) {
      // El mensaje del error NO se propaga al cliente: puede traer el status del proveedor y
      // eso es diagnóstico interno. Al cliente le alcanza saber que la respuesta es degradada.
      this.logger.warn(
        `el proveedor falló al embeddear la consulta: se responde por full-text (degradado): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { ok: false, reason: 'provider_error' };
    } finally {
      cancelarReloj?.();
    }
  }
}
