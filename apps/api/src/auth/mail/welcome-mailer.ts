/**
 * Puerto del email de bienvenida al registrarse (§3 — depender del token de
 * inyección, no de la clase concreta). Mismo criterio que
 * `PasswordResetMailer`: dos adapters (log en dev/test, Resend en
 * producción), selección por entorno en el módulo.
 *
 * `send` **nunca propaga**: el registro (AC-1 de cuentas, "alta + sesión en
 * la misma operación") no puede fallar porque el proveedor de email esté
 * caído — el email de bienvenida es un best-effort, no parte del contrato
 * del endpoint.
 */
export interface WelcomeMailer {
  send(input: WelcomeEmail): Promise<void>;
}

export interface WelcomeEmail {
  /** Destinatario. Ya normalizado (mismo email que `customers.email`). */
  to: string;
  /** Nombre para personalizar el saludo. */
  name: string;
  /** Pseudónimo para los logs — se registra esto, nunca el email. */
  customerId: string;
}

/** Token de inyección del puerto. */
export const WELCOME_MAILER = Symbol('WELCOME_MAILER');
