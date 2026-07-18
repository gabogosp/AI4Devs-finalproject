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

  constructor(message: string, fieldErrors?: FieldError[]) {
    super(message);
    this.name = new.target.name;
    this.fieldErrors = fieldErrors;
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
