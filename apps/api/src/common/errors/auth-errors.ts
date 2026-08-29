import { DomainError } from './domain-errors';

/**
 * Errores de dominio de auth (§6). Los mapea el `HttpProblemFilter` existente al
 * envelope RFC 7807, igual que los de catálogo — por eso extienden `DomainError`
 * y no traen nada de NestJS.
 *
 * El catálogo es **cerrado**: estos son todos los `type` que la superficie de
 * auth puede devolver, y el contrato OpenAPI (T11.1) los declara uno por uno.
 *
 * Regla que gobierna los mensajes de acá: **ninguno revela si una cuenta
 * existe**. `InvalidCredentialsError` es el mismo objeto tanto si el email no
 * está registrado como si la contraseña es incorrecta como si la cuenta está
 * bloqueada. Un mensaje más útil ("ese email no existe") convierte el login en un
 * oráculo de enumeración, y ahí se pierde AC-5.
 */

/** 401 — credenciales inválidas. Deliberadamente indistinguible entre causas. */
export class InvalidCredentialsError extends DomainError {
  readonly status = 401;
  readonly type = 'dsm:auth/invalid-credentials';

  constructor() {
    super('Email o contraseña incorrectos');
  }
}

/** 401 — no hay sesión válida (falta el access, venció o no valida). */
export class UnauthenticatedError extends DomainError {
  readonly status = 401;
  readonly type = 'dsm:auth/unauthenticated';

  constructor(message = 'Sesión no válida') {
    super(message);
  }
}

/**
 * 401 — el refresh no sirve: ausente, desconocido, vencido, revocado o **ya
 * rotado** (reuso, ADR-0011). El caso de reuso revoca la familia entera antes de
 * llegar acá, pero la respuesta es la misma: si el error distinguiera "token
 * robado" de "token vencido", le confirmaría al atacante que su réplica llegó.
 */
export class InvalidRefreshError extends DomainError {
  readonly status = 401;
  readonly type = 'dsm:auth/invalid-refresh';

  constructor(message = 'Sesión expirada') {
    super(message);
  }
}

/** 403 — falta el double-submit de CSRF, no coincide, o el `Origin` no es de la allowlist (§7.5). */
export class CsrfError extends DomainError {
  readonly status = 403;
  readonly type = 'dsm:auth/csrf';

  constructor(message = 'Petición no verificable') {
    super(message);
  }
}

/**
 * 409 — el alta no pudo completarse.
 *
 * El nombre es genérico a propósito, y el mensaje también: AC-6 pide informar sin
 * confirmar que el email ya está registrado. La alternativa honesta ("ese email
 * ya tiene cuenta") le regala a cualquiera un verificador de qué direcciones
 * están en la base. El límite está documentado en OQ-BE-5: un atacante todavía
 * puede inferirlo por el hecho de que el alta falle, pero no se lo confirma.
 */
export class RegistrationFailedError extends DomainError {
  readonly status = 409;
  readonly type = 'dsm:auth/registration-failed';

  constructor() {
    super('No se pudo completar el registro con esos datos');
  }
}

/**
 * 400 — el token de reset no sirve: inexistente, vencido o ya usado (AC-7).
 *
 * Los tres casos comparten error a propósito. Distinguir "vencido" de "ya usado"
 * le diría a quien tenga el token si alguien más lo consumió.
 */
export class InvalidResetTokenError extends DomainError {
  readonly status = 400;
  readonly type = 'dsm:auth/invalid-reset-token';

  constructor() {
    super('El enlace de recuperación no es válido o ya fue utilizado');
  }
}
