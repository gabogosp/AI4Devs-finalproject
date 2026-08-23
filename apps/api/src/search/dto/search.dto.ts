import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Confidence, ScoredProduct } from '../relevance';
import { SearchOutcome } from '../search.service';

/**
 * Topes del query param, leídos de `process.env` al cargar la clase.
 *
 * Los decoradores de `class-validator` se evalúan al definir la clase, antes de que exista el
 * contenedor, así que no hay `ConfigService` disponible. Zod ya validó estos valores al
 * arrancar (T0.2), así que leerlos acá es leer un valor ya verificado — mismo criterio que el
 * cap del multipart de US-006 y el throttler de US-005.
 */
const MAX_LENGTH = Number(process.env.SEARCH_MAX_LENGTH ?? 200);
const LIMIT_MAX = Number(process.env.SEARCH_LIMIT_MAX ?? 50);
const LIMIT_DEFAULT = Number(process.env.SEARCH_LIMIT_DEFAULT ?? 20);

/**
 * Query de `GET /v1/search`.
 *
 * El `ValidationPipe` global corre con `whitelist` + `forbidNonWhitelisted`, así que un
 * parámetro desconocido es **422** y no algo que se ignore en silencio. En un buscador eso
 * importa más que en otras superficies: `?limite=100` (en español, un typo plausible) sería
 * aceptado como «sin límite» y devolvería el default sin que nadie se enterara de que el
 * parámetro no existe.
 */
export class SearchQueryDto {
  /**
   * El texto del cliente. El mínimo **no** se valida acá sino en el service, sobre la longitud
   * **útil**: `'   a   '` pasa un `@MinLength(2)` y no debería, porque su contenido es una
   * letra. Acá sólo se corta lo que no tiene sentido procesar.
   */
  @IsString()
  q!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(LIMIT_MAX)
  limit: number = LIMIT_DEFAULT;
}

/** Tope de longitud publicado, para que el contrato y el DTO no se desincronicen. */
export const SEARCH_MAX_LENGTH_DTO = MAX_LENGTH;

/**
 * Un resultado, tal como lo ve el cliente.
 *
 * Dos ausencias deliberadas, heredadas de US-002/US-003: **no viaja el `id`** de producto ni de
 * categoría —la identidad pública es el `slug`, que es lo que la URL indexable usa— y **no
 * viaja el vector**. Exponer el embedding sería filtrar el resultado de un trabajo pago y, de
 * paso, permitir reconstruir el catálogo vectorial sin llamar a la búsqueda.
 */
export class SearchResultDto {
  slug!: string;
  name!: string;
  price_ars_cents!: number;
  /**
   * `in_stock` y no `stock`: la cantidad exacta es información del negocio (le dice a un
   * competidor cuánto rota cada producto). El cliente sólo necesita saber si puede comprarlo.
   *
   * Un producto sin stock **aparece** con `false` y no se oculta (AC-7): que exista y esté
   * agotado es información útil, y esconderlo haría que el cliente crea que no lo vendemos.
   */
  in_stock!: boolean;
  image_url!: string | null;
  /** `0..1`. Viaja para que el frontend pueda ordenar y mostrar señal de match. */
  score!: number;

  static from(p: ScoredProduct): SearchResultDto {
    return {
      slug: p.slug,
      name: p.name,
      price_ars_cents: p.price_ars_cents,
      in_stock: p.stock > 0,
      image_url: p.image_url,
      // El score llega de Postgres como número o string según el driver: se normaliza acá para
      // que el contrato prometa un número y lo cumpla.
      score: Number(p.score),
    };
  }
}

/** Respuesta de `GET /v1/search`. */
export class SearchResponseDto {
  results!: SearchResultDto[];
  confidence!: Confidence;
  /** «Buscamos en: Fijaciones, Mechas y brocas», o `null` si no hay de dónde armarlo. */
  interpreted_as!: string | null;
  /**
   * `true` cuando la respuesta salió del camino léxico porque el proveedor de IA no estuvo
   * disponible (AC-4). Viaja **en el cuerpo y con 200**, no como error: el frontend tiene que
   * poder avisar «esto es el plan B» sin tratar la respuesta como una falla.
   */
  degraded!: boolean;
  /** Salida ofrecida cuando la búsqueda no convence. `null` sólo con `confidence: high`. */
  fallback!: { suggested_categories: string[] } | null;

  static from(outcome: SearchOutcome): SearchResponseDto {
    return {
      results: outcome.results.map((r) => SearchResultDto.from(r)),
      confidence: outcome.confidence,
      interpreted_as: outcome.interpreted_as,
      degraded: outcome.degraded,
      fallback: outcome.fallback,
    };
  }
}
