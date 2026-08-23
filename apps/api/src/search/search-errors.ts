import { DomainError } from '../common/errors/domain-errors';

/**
 * 422 — la consulta es más corta que `SEARCH_MIN_LENGTH` (AC-5).
 *
 * Se lanza **antes** de tocar el caché o el proveedor: una consulta de un carácter no puede
 * costar una llamada paga. El mensaje dice el mínimo con número porque un «consulta inválida»
 * sin el umbral obliga al cliente a adivinar.
 */
export class QueryTooShortError extends DomainError {
  readonly status = 422;
  readonly type = 'dsm:search/query-too-short';

  constructor(minimo: number) {
    super(
      `La consulta es demasiado corta: escribí al menos ${minimo} caracteres.`,
      [{ field: 'q', message: `mínimo ${minimo} caracteres` }],
      { min_length: minimo },
    );
  }
}

/**
 * 422 — la consulta excede `SEARCH_MAX_LENGTH`.
 *
 * El tope no es estético: el texto viaja al proveedor y se cobra por tamaño, así que un cuerpo
 * de 50 kB en el buscador es un ataque de costo con forma de consulta.
 */
export class QueryTooLongError extends DomainError {
  readonly status = 422;
  readonly type = 'dsm:search/query-too-long';

  constructor(maximo: number) {
    super(
      `La consulta es demasiado larga: el máximo es ${maximo} caracteres.`,
      [{ field: 'q', message: `máximo ${maximo} caracteres` }],
      { max_length: maximo },
    );
  }
}

/**
 * 503 — la búsqueda no puede responder por un fallo de **infraestructura propia** (Postgres).
 *
 * Existe para un solo caso y conviene decir cuál **no** es: **no** hay error de dominio para el
 * fallo del proveedor de IA. Si Gemini no contesta, la respuesta es un **200 degradado** con
 * `degraded: true` (AC-4), porque el catálogo sigue siendo buscable por texto y la tienda sigue
 * vendiendo. Convertir eso en un 5xx haría que un problema de un tercero se vea como una caída
 * nuestra, y el cliente que ve un error no vuelve a intentar.
 *
 * Un fallo de Postgres es distinto: sin base no hay ni resultados ni fallback que ofrecer, y
 * mentir con un `results: []` haría creer que el catálogo no tiene lo que se buscó.
 */
export class SearchUnavailableError extends DomainError {
  readonly status = 503;
  readonly type = 'dsm:search/unavailable';

  constructor() {
    super(
      'La búsqueda no está disponible en este momento. Podés navegar el catálogo por categorías mientras se restablece.',
    );
  }
}
