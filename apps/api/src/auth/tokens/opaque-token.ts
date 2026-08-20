import { createHash, randomBytes } from 'node:crypto';

/**
 * Tokens opacos de un solo uso — `security-standards.md` §3.7.
 *
 * Los usan el refresh (rotación + detección de reuso, ADR-0011) y el reset de
 * contraseña. Son **opacos** a propósito: no llevan claims ni estructura, así que
 * no hay nada que un atacante pueda leer ni manipular. Toda su autoridad viene de
 * existir en la tabla; no de estar firmados.
 *
 * Dos propiedades sostienen el diseño:
 *
 * - **CSPRNG, no `Math.random()`**: el generador de JavaScript es predecible a
 *   partir de suficientes salidas. Un token de sesión predecible es una sesión
 *   ajena.
 * - **Sólo se guarda el hash**. Una filtración de la base entrega hashes, no
 *   sesiones usables. Es la misma razón por la que no guardamos contraseñas en
 *   claro, aplicada al token — y es lo que hace que ADR-0011 sea seguro y no sólo
 *   conveniente.
 *
 * SHA-256 a secas, sin bcrypt: acá no hace falta un hash lento. bcrypt protege
 * contra fuerza bruta sobre secretos de baja entropía (contraseñas que la gente
 * elige). Estos tokens traen 256 bits de un CSPRNG: no hay diccionario que
 * recorrer, y encarecer el hash sólo agregaría latencia a cada refresh.
 */

/** 32 bytes = 256 bits, muy por encima del mínimo de 128 que pide §3.7. */
const TOKEN_BYTES = 32;

/** Genera el token en claro. Se devuelve al llamador y **nunca** se persiste. */
export function newToken(): string {
  // base64url: seguro en cookies, URLs y headers sin escapar nada.
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/** Hash de reposo: determinista, 64 hex. Es lo único que toca la base. */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}
