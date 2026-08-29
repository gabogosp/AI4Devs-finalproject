/**
 * Puerto de envío del email de recuperación (§3 — depender del token de
 * inyección, no de la clase concreta).
 *
 * El puerto existe porque el servicio de reset no debería saber **cómo** se
 * entrega un email. Hay dos adapters: el de log (desarrollo y test) y el de
 * Resend (producción), y la selección se hace por entorno en el módulo. Si en
 * algún momento hiciera falta tocar el servicio para enchufar un tercero, el
 * puerto estaría mal diseñado.
 *
 * Contrato que **todo** adapter debe cumplir, y que no es negociable:
 *
 * - `send` **nunca propaga**. El controller responde 202 exista o no la cuenta
 *   (AC-11), y si un fallo del proveedor de email cambiara la respuesta, el
 *   tiempo o el código de estado delatarían qué direcciones están registradas —
 *   se perdería la anti-enumeración por la puerta de atrás.
 * - El token en claro **no se persiste ni se loguea en producción**. Quien lee
 *   los logs no debe poder tomar la cuenta de nadie.
 */
export interface PasswordResetMailer {
  /**
   * Despacha el enlace de recuperación. No devuelve si tuvo éxito: el llamador
   * no puede actuar distinto según el resultado sin romper AC-11.
   */
  send(input: PasswordResetEmail): Promise<void>;
}

export interface PasswordResetEmail {
  /** Destinatario. Sale de la base, ya normalizado. */
  to: string;
  /** Pseudónimo para los logs — se registra esto, nunca el email. */
  customerId: string;
  /** Token en claro. Sólo viaja al buzón del dueño. */
  rawToken: string;
  /** Minutos de validez, para poder decírselo a la persona en el cuerpo. */
  ttlMinutes: number;
}

/** Token de inyección del puerto. */
export const PASSWORD_RESET_MAILER = Symbol('PASSWORD_RESET_MAILER');
