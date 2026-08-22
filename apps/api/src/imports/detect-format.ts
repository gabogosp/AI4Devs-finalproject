import { InvalidEncodingError, UnsupportedFormatError } from './import-errors';

/**
 * T1.1 — detección de formato por **contenido** y decodificación estricta.
 *
 * `security-standards.md` §6.4: el formato se decide por content sniffing (magic
 * bytes), no por la extensión ni por el `Content-Type` del request. Los dos los
 * elige quien sube el archivo, así que ninguno es evidencia de nada. El
 * `filename` sólo se conserva como metadata para mostrárselo al dueño: no
 * decide el formato y **nunca** se usa como ruta (no se escribe a disco).
 */
export type ImportFormat = 'csv' | 'xlsx';

/** Firma local de un zip — todo .xlsx es un zip, así que empieza con esto. */
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // "PK\x03\x04"

/** BOM de UTF-8. Excel lo escribe siempre; el parser no debe verlo. */
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/**
 * ¿El byte es un control de C0/DEL que un archivo de texto no tendría?
 *
 * Tabulador (0x09), LF (0x0a) y CR (0x0d) son legítimos en un CSV; el resto de
 * los controles no aparecen en texto real. Sin este chequeo, un binario como un
 * ELF (`7f 45 4c 46`) pasaría el decodificador UTF-8 —`0x7f` es UTF-8 válido— y
 * lo trataríamos como un CSV renombrado, que es exactamente el ataque de §6.4.
 */
function esByteDeControl(byte: number): boolean {
  if (byte === 0x09 || byte === 0x0a || byte === 0x0d) return false;
  return byte < 0x20 || byte === 0x7f;
}

/** Quita el BOM si está. Devuelve el mismo buffer si no. */
function sinBom(buffer: Buffer): Buffer {
  return buffer.subarray(0, 3).equals(UTF8_BOM) ? buffer.subarray(3) : buffer;
}

/**
 * Decodifica el buffer como UTF-8 **estricto** y sin BOM.
 *
 * `fatal: true` es la decisión importante: el default de `TextDecoder` sustituye
 * cada secuencia inválida por U+FFFD (`�`) y devuelve una cadena "exitosa". Eso
 * convertiría un archivo en windows-1252 (lo que exporta Excel en español por
 * defecto) en un catálogo con nombres corruptos que nadie revisa hasta que un
 * cliente los ve en el storefront. Preferimos el 422.
 */
export function decodeCsv(buffer: Buffer): string {
  const cuerpo = sinBom(buffer);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(cuerpo);
  } catch {
    throw new InvalidEncodingError();
  }
}

/**
 * Decide el formato del archivo subido a partir de su contenido.
 *
 * @param buffer contenido completo del archivo (ya acotado por el cap de tamaño).
 * @param filename nombre original — **sólo metadata**, no participa de la decisión.
 * @throws UnsupportedFormatError si no es un xlsx ni texto (415).
 * @throws InvalidEncodingError si es texto pero no UTF-8 (422).
 */
export function detectFormat(buffer: Buffer, filename: string): ImportFormat {
  // `filename` se acepta para que la firma documente que existe y se ignora a
  // propósito: dejarlo fuera invitaría a "usarlo un poquito" más adelante.
  void filename;

  if (buffer.subarray(0, ZIP_MAGIC.length).equals(ZIP_MAGIC)) {
    return 'xlsx';
  }

  const cuerpo = sinBom(buffer);
  for (const byte of cuerpo) {
    if (esByteDeControl(byte)) {
      throw new UnsupportedFormatError();
    }
  }

  // Decodifica y descarta: acá sólo interesa que el archivo SEA decodificable.
  // Quien necesite el texto llama `decodeCsv` (el lector de filas, T1.2).
  decodeCsv(buffer);
  return 'csv';
}
