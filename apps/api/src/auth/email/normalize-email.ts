/**
 * Normalización de email — `security-standards.md` §6.
 *
 * Vive en **un solo lugar** y es la única forma en que un email llega a la base.
 * Si el DTO normalizara de una manera y el repositorio de otra, el índice UNIQUE
 * dejaría entrar duplicados que la aplicación considera el mismo usuario — y ese
 * bug se manifiesta como "no puedo entrar con mi cuenta", meses después.
 *
 * Tres pasos, y ninguno más:
 *
 * - `trim()` — un espacio pegado al copiar no debería crear una cuenta distinta.
 * - `normalize('NFKC')` — Unicode permite escribir el mismo texto de varias
 *   formas (una 'é' precompuesta o 'e' + acento combinante). Sin normalizar,
 *   dos strings visualmente idénticos son claves distintas para el UNIQUE, y eso
 *   habilita registrar un homógrafo del email de otro.
 * - `toLowerCase()` — el dominio es case-insensitive por RFC 1035, y en la
 *   práctica ningún proveedor real distingue mayúsculas en la parte local.
 *
 * Lo que **no** se hace, deliberadamente: quitar puntos ni sufijos `+tag`. Es
 * tentador (Gmail los ignora) pero cambia la identidad del buzón, y no todos los
 * proveedores se comportan igual. Quitar el punto de `juan.perez@midominio.com`
 * lo convertiría en la cuenta de otra persona en cualquier servidor que sí los
 * distinga.
 */
export function normalizeEmail(email: string): string {
  return email.trim().normalize('NFKC').toLowerCase();
}
