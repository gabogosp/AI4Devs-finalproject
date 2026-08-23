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
