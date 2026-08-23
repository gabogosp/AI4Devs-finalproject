import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { configNumber } from '../enrichment/config-number';
import { normalizeQuery, usefulLength } from './normalize-query';
import { QueryEmbedder } from './query-embedder';
import {
  blend,
  classify,
  Confidence,
  interpretedAs,
  ScoredProduct,
  suggestedCategories,
} from './relevance';
import { QueryTooLongError, QueryTooShortError } from './search-errors';
import { SearchRepository } from './search.repository';

/** Resultado de una búsqueda, antes del DTO. */
export interface SearchOutcome {
  results: ScoredProduct[];
  confidence: Confidence;
  /** «Buscamos en: Fijaciones, Mechas y brocas» — o `null` si no hay de dónde armarlo. */
  interpreted_as: string | null;
  /** Presente cuando la respuesta no convence (AC-3). Nunca con lista vacía. */
  fallback: { suggested_categories: string[] } | null;
  /** `true` cuando la respuesta salió del camino léxico por no tener vector (AC-4). */
  degraded: boolean;
  /** Insumo de observabilidad: si el vector vino del caché no se pagó una llamada. */
  cached: boolean;
}

/**
 * Orquestación de la búsqueda (US-004 T2.4).
 *
 * El camino feliz es **caché → embed → kNN → clasificar → DTO**, y el degradado es el mismo
 * camino con `fullText` en lugar del kNN. Que sean el mismo camino es el punto: la degradación
 * no es una rama de emergencia que alguien tenga que recordar mantener, es el valor que toma
 * una decisión que se toma siempre.
 *
 * **Nada de esto lanza cuando el proveedor falla.** Un 5xx ante un timeout de Gemini
 * convertiría un problema de un tercero en una caída de la tienda; devolver 200 con
 * `degraded: true` deja al cliente comprando y al frontend informado (AC-4).
 */
@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly repo: SearchRepository,
    private readonly embedder: QueryEmbedder,
    private readonly config: ConfigService,
  ) {}

  async search(consultaCruda: string, limitPedido?: number): Promise<SearchOutcome> {
    const minimo = configNumber(this.config, 'SEARCH_MIN_LENGTH', 2);
    const maximo = configNumber(this.config, 'SEARCH_MAX_LENGTH', 200);
    const utiles = usefulLength(consultaCruda);

    // Las dos validaciones van ANTES del caché y del proveedor: una consulta inválida no puede
    // costar una llamada paga ni una entrada de caché (AC-5). Se mide sobre la longitud ÚTIL,
    // así que llenar de espacios no evade el mínimo.
    if (utiles < minimo) throw new QueryTooShortError(minimo);
    if (utiles > maximo) throw new QueryTooLongError(maximo);

    const consulta = normalizeQuery(consultaCruda);
    const limit = this.limitEfectivo(limitPedido);

    const embedding = await this.embedder.embedQuery(consulta);

    if (!embedding.ok) {
      // Degradación (AC-4). El motivo va al log, no a la respuesta: al cliente le alcanza saber
      // que está viendo el plan B.
      this.logger.warn(
        `búsqueda degradada a full-text (motivo: ${embedding.reason}); la navegación no se interrumpe`,
      );
      const lexicos = await this.repo.fullText(consulta, limit);
      return this.componer(lexicos, { degraded: true, cached: false });
    }

    const vectoriales = await this.repo.knn(embedding.vector, limit);
    const peso = configNumber(this.config, 'SEARCH_LEXICAL_WEIGHT', 0);

    // Con peso 0 —el default— no se consulta el camino léxico en absoluto: sería una query de
    // más por resultado que se descarta. La perilla se paga sólo cuando se usa.
    const resultados =
      peso > 0
        ? blend(vectoriales, await this.repo.fullText(consulta, limit), peso).slice(0, limit)
        : vectoriales;

    return this.componer(resultados, {
      degraded: false,
      cached: embedding.cached,
    });
  }

  /**
   * Clasifica, arma la interpretación y decide el fallback. Es común a los dos caminos **a
   * propósito**: si el degradado tuviera su propia composición, un cambio de política en uno se
   * olvidaría en el otro.
   */
  private async componer(
    resultados: ScoredProduct[],
    señales: { degraded: boolean; cached: boolean },
  ): Promise<SearchOutcome> {
    const minScore = Number(this.config.get('SEARCH_MIN_SCORE') ?? 0.55);
    const confidence = classify(resultados, minScore);

    // El fallback se ofrece en `low` y en `none`: en los dos casos el cliente puede quedarse sin
    // saber qué hacer, y ahí es donde se va del sitio (AC-3).
    const necesitaSalida = confidence !== 'high';
    const fallback = necesitaSalida
      ? {
          suggested_categories: suggestedCategories(
            resultados,
            await this.repo.rootCategoriesByVolume(3),
          ),
        }
      : null;

    return {
      results: resultados,
      confidence,
      interpreted_as: interpretedAs(resultados),
      fallback,
      degraded: señales.degraded,
      cached: señales.cached,
    };
  }

  /** El `limit` pedido, acotado por `SEARCH_LIMIT_MAX`; sin pedido, el default. */
  private limitEfectivo(pedido?: number): number {
    const porDefecto = configNumber(this.config, 'SEARCH_LIMIT_DEFAULT', 20);
    const tope = configNumber(this.config, 'SEARCH_LIMIT_MAX', 50);
    if (pedido === undefined) return porDefecto;
    // Se acota en silencio en vez de rechazar: pedir 500 resultados no es un error del cliente,
    // es una expectativa que el servidor no va a cumplir. El DTO igual valida el rango.
    return Math.min(Math.max(1, Math.trunc(pedido)), tope);
  }
}
