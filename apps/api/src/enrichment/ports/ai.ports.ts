/**
 * Puertos de IA del enriquecimiento (US-005 T1.1) — `backend-node-standards.md` §3:
 * el dominio depende de **interfaces y tokens**, no de clases concretas.
 *
 * Ni una sola firma de acá menciona Gemini, `fetch`, headers ni JSON del proveedor. Es
 * lo que hace que cambiar de proveedor sea escribir otro adapter en `ai/` y no tocar el
 * servicio, y lo que permite que los tests inyecten un doble determinista sin red.
 *
 * Mismo patrón que el puerto de mailer de US-014 (`password-reset-mailer.ts`): interfaz
 * + `Symbol` como token de inyección.
 */

/** Token de DI del enriquecedor de texto. */
export const AI_ENRICHER = Symbol('AI_ENRICHER');

/** Token de DI del generador de embeddings. */
export const AI_EMBEDDER = Symbol('AI_EMBEDDER');

/**
 * Entrada del enriquecedor. Es dato de catálogo, no un prompt: el prompt lo arma el
 * adapter, así que el dominio no sabe nada de ingeniería de prompts.
 */
export interface EnrichInput {
  /** Nombre del producto tal como lo cargó el dueño. */
  name: string;
  /** Nombre del rubro/subrubro — sin él, «Mecha widia 8» es casi ruido (D3). */
  categoryName: string;
  /** Texto base del que se parte: curado, enriquecido previo o `description_raw`. */
  baseText: string | null;
}

/**
 * ¿Hay un proveedor con el que efectivamente se puede trabajar?
 *
 * Lo declara el **adapter**, no el caso de uso: si el runner re-derivara la condición
 * leyendo configuración, tendría una copia de la regla del factory que puede desincronizarse
 * — y una corrida contra un adapter deshabilitado dejaría rastro durable de fallo (intentos,
 * `error_code`, backoff) en un catálogo que no tiene nada de malo.
 */
export interface AiAvailability {
  /** `false` en el adapter que sólo sabe rechazar (sin credenciales o apagado por config). */
  readonly available: boolean;
}

/** Enriquecedor de descripciones (LLM). */
export interface AiEnricher extends AiAvailability {
  /**
   * Devuelve el texto enriquecido, ya recortado al tope de caracteres configurado.
   * Lanza `AiTransientError` (reintentable) o `AiPermanentError` (no reintentable).
   */
  enrich(input: EnrichInput): Promise<string>;
}

/** Generador de embeddings. */
export interface AiEmbedder extends AiAvailability {
  /**
   * Devuelve el vector del texto. La dimensión la valida el adapter contra la del
   * esquema (768): un vector de otra dimensión es un error permanente, no algo que
   * la base deba descubrir.
   */
  embed(text: string): Promise<number[]>;
  /** Modelo que generó los vectores — se persiste en `product_embeddings` (AC-8). */
  readonly modelVersion: string;
}
