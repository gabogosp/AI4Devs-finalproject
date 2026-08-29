/**
 * Errores de dominio en TS plano (sin tipos de framework) — backend-node-standards §6.
 * El `HttpProblemFilter` los mapea al envelope RFC 7807. Nunca se expone un error
 * crudo de Prisma/infra: los repositorios traducen los códigos Prisma a estos.
 */
export interface FieldError {
  field: string;
  message: string;
}

export abstract class DomainError extends Error {
  abstract readonly status: number;
  abstract readonly type: string;
  readonly fieldErrors?: FieldError[];
  /**
   * **Extension members** de RFC 7807 §3.2 — datos estructurados propios del
   * problema, que el filtro esparce como campos de primer nivel del cuerpo.
   *
   * Existe para que un dato como `available_quantity` (el 409 de stock del
   * carrito, US-007) viaje como número y no incrustado en una frase del `detail`
   * que el frontend tenga que parsear con una regex. Cambio aditivo: un error que
   * no las declara produce exactamente el mismo cuerpo que antes.
   */
  readonly extensions?: Record<string, unknown>;

  constructor(
    message: string,
    fieldErrors?: FieldError[],
    extensions?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
    this.fieldErrors = fieldErrors;
    this.extensions = extensions;
  }
}

export class NotFoundError extends DomainError {
  readonly status = 404;
  readonly type = 'dsm:catalog/not-found';
}

export class ConflictError extends DomainError {
  readonly status = 409;
  readonly type = 'dsm:catalog/conflict';
}

export class ValidationError extends DomainError {
  readonly status = 422;
  readonly type = 'dsm:catalog/validation';
}

export class InvalidTransitionError extends DomainError {
  readonly status = 422;
  readonly type = 'dsm:catalog/invalid-transition';
}
