/**
 * Copys de auth como **constantes**, nunca derivados de `error.message`
 * (US-014 design.md D9).
 *
 * El motivo es de seguridad, no de estilo: si el texto saliera del error del
 * backend, cualquier cambio de mensaje del lado del servidor —o un detalle que
 * se cuele en un `detail`— se convertiría en una diferencia observable entre
 * "cuenta inexistente", "contraseña incorrecta" y "cuenta bloqueada". Con una
 * constante, los tres casos son literalmente el mismo string y no hay forma de
 * que diverjan por accidente.
 */

/** AC-5: los tres fallos de login comparten exactamente este texto. */
export const COPY_LOGIN_401 = 'Email o contraseña incorrectos.';

/**
 * AC-6: el registro con email existente no confirma que exista. "Ese email ya
 * está registrado" convertiría el formulario en un verificador de cuentas.
 */
export const COPY_REGISTER_409 = 'No pudimos crear la cuenta con esos datos.';

/** AC-11: idéntico exista o no la cuenta. */
export const COPY_RESET_REQUESTED =
  'Si el email está registrado, te enviamos un link para recuperar tu contraseña.';

/** AC-7: vencido, usado e inexistente son indistinguibles. */
export const COPY_RESET_TOKEN_INVALIDO =
  'El enlace no es válido o ya se usó. Pedí uno nuevo.';

export const COPY_RED = 'No pudimos conectar. Revisá tu conexión y probá de nuevo.';

export const COPY_GENERICO = 'Algo salió mal. Probá de nuevo en un momento.';

/**
 * AC-10. Si el backend no mandó `Retry-After`, el copy es genérico en vez de
 * inventar un número: decirle al cliente "esperá 30 segundos" cuando no lo
 * sabemos es peor que no decir nada.
 */
export function copyRateLimited(retryAfterSeconds?: number): string {
  if (!retryAfterSeconds || retryAfterSeconds <= 0) {
    return 'Demasiados intentos. Esperá un momento y probá de nuevo.';
  }
  const minutos = Math.ceil(retryAfterSeconds / 60);
  return retryAfterSeconds < 60
    ? `Demasiados intentos. Probá de nuevo en ${retryAfterSeconds} segundos.`
    : `Demasiados intentos. Probá de nuevo en ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}.`;
}
