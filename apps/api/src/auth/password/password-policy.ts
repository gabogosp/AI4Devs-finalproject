import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Política de contraseña — `security-standards.md` §3.2.
 *
 * Lo que §3.2 pide **no** hacer es tan importante como lo que pide hacer: nada de
 * reglas de composición (una mayúscula, un dígito, un símbolo). Empujan a la
 * gente hacia `Password1!` — corta, predecible y en cualquier corpus filtrado —
 * mientras rechazan `correo caballo batería grapa`, que es mucho más fuerte. La
 * defensa real es longitud mínima + rechazo contra contraseñas ya filtradas.
 */

/** Longitud mínima (§3.2). */
export const MIN_LENGTH = 8;

/**
 * bcrypt trunca en silencio a 72 **bytes**. Truncar sería peor que rechazar: dos
 * contraseñas distintas que compartan los primeros 72 bytes pasarían a ser la
 * misma, y el usuario nunca se entera de que su cola no cuenta. Se rechaza (§3.1).
 *
 * En bytes, no en caracteres: 'ñ' ocupa 2 en UTF-8 y un emoji hasta 4, así que
 * medir por `.length` dejaría pasar contraseñas que bcrypt sí trunca.
 */
export const MAX_BYTES = 72;

export type PasswordViolation =
  | 'too_short'
  | 'too_long_bytes'
  | 'breached'
  | 'empty';

let corpus: Set<string> | null = null;

/** Carga perezosa y única: ~10 000 entradas, ~80 KB residentes. */
function getCorpus(): Set<string> {
  if (corpus) return corpus;
  const ruta = join(__dirname, 'breached-passwords.txt');
  const lineas = readFileSync(ruta, 'utf-8').split('\n');
  corpus = new Set(
    lineas
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#')),
  );
  return corpus;
}

/**
 * Devuelve la lista de violaciones — vacía si la contraseña es aceptable.
 *
 * Se devuelven **todas** las que aplican, no la primera: quien recibe el error
 * puede arreglar todo de una vez en lugar de descubrir un problema por intento.
 */
export function validatePassword(plain: string): PasswordViolation[] {
  const violaciones: PasswordViolation[] = [];

  if (plain.length === 0) {
    return ['empty'];
  }
  if (plain.length < MIN_LENGTH) {
    violaciones.push('too_short');
  }
  if (Buffer.byteLength(plain, 'utf8') > MAX_BYTES) {
    violaciones.push('too_long_bytes');
  }
  // Comparación en minúsculas: 'Password' está tan filtrada como 'password', y
  // el corpus se normalizó al construirlo.
  if (getCorpus().has(plain.toLowerCase())) {
    violaciones.push('breached');
  }

  return violaciones;
}

/** Tamaño del corpus cargado — para el test de cobertura y la observabilidad. */
export function corpusSize(): number {
  return getCorpus().size;
}
