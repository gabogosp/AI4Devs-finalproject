import { Readable } from 'node:stream';
import { parse } from 'csv-parse';
import ExcelJS from 'exceljs';
import { slugify } from '../common/slug';
import { decodeCsv, ImportFormat } from './detect-format';
import { MissingColumnsError, RowLimitExceededError, UnsupportedFormatError } from './import-errors';

/**
 * T1.2 — lectura en streaming del archivo con caps de filas y de expansión.
 *
 * Dos decisiones gobiernan este módulo:
 *
 * 1. **Se lee de a una fila, no el archivo entero en memoria** (§6.6). El xlsx va
 *    por `WorkbookReader` (streaming) y el CSV por el parser en modo lazy: cuando
 *    el consumidor corta, el parser deja de trabajar. Sin esto, el cap de filas
 *    sería decorativo — habríamos pagado el costo de leer todo antes de decidir
 *    que el archivo era demasiado grande.
 * 2. **El cap de expansión se chequea antes de descomprimir** (zip bomb). Un
 *    xlsx de 100 KiB puede declarar gigabytes de contenido; el que descomprime
 *    primero y mide después ya perdió.
 */

/** Esquema de columnas v1 (US §4). Fijo: el mapeo configurable es post-v1. */
export const COLUMNAS_REQUERIDAS = [
  'sku',
  'nombre',
  'precio',
  'stock',
  'categoria',
] as const;

/** Opcionales reconocidas. Todo lo demás en el encabezado se ignora. */
export const COLUMNAS_OPCIONALES = ['descripcion', 'imagen_url'] as const;

const COLUMNAS_CONOCIDAS: ReadonlySet<string> = new Set<string>([
  ...COLUMNAS_REQUERIDAS,
  ...COLUMNAS_OPCIONALES,
]);

export interface ImportLimits {
  /** Tope de filas de datos (el encabezado no cuenta). */
  maxRows: number;
  /** Tope de bytes descomprimidos de un xlsx. */
  maxUncompressedBytes: number;
}

export interface ImportRow {
  /** 1-based sobre las filas de DATOS: la primera fila de producto es la 1. */
  rowNumber: number;
  /** Celdas por columna canónica. Las columnas desconocidas no llegan acá. */
  cells: Record<string, string>;
}

/**
 * Normaliza un encabezado a su columna canónica reusando la `slugify()` del
 * catálogo (una regla, un lugar): `"Descripción"`, `"DESCRIPCION"` y
 * `"descripcion"` colapsan a la misma clave.
 *
 * El `replace` final existe porque las columnas canónicas son snake_case
 * (`imagen_url`) y `slugify` produce kebab (`imagen-url`). Normalizar el guión
 * al underscore acá evita tener dos convenciones de nombre en el proyecto.
 */
export function normalizeHeader(raw: string): string {
  return slugify(raw).replace(/-/g, '_');
}

/**
 * Convierte el encabezado leído en la lista de columnas de csv-parse: canónicas
 * las conocidas, `null` (columna descartada) las desconocidas. Valida acá mismo
 * que estén las 5 requeridas, que es el único momento en que se conoce el
 * encabezado completo y todavía no se escribió nada (AC-6).
 */
function resolverColumnas(header: string[]): (string | null)[] {
  const canonicas = header.map(normalizeHeader);
  const presentes = new Set(canonicas);
  const faltantes = COLUMNAS_REQUERIDAS.filter((c) => !presentes.has(c));
  if (faltantes.length > 0) {
    // Los nombres que se devuelven son los del ARCHIVO (`precio`), nunca los de
    // la base (`price_ars_cents`): el dueño tiene que poder arreglar su planilla.
    throw new MissingColumnsError([...faltantes]);
  }
  return canonicas.map((c) => (COLUMNAS_CONOCIDAS.has(c) ? c : null));
}

/**
 * Suma los tamaños DESCOMPRIMIDOS que declara el directorio central del zip.
 *
 * Se lee el central directory (`PK\x01\x02`) y no las cabeceras locales porque
 * los escritores en streaming dejan el tamaño en 0 en la cabecera local y lo
 * publican después, en el data descriptor.
 */
export function declaredUncompressedBytes(buffer: Buffer): number {
  let total = 0;
  for (let i = 0; i + 28 <= buffer.length; i += 1) {
    if (
      buffer[i] === 0x50 &&
      buffer[i + 1] === 0x4b &&
      buffer[i + 2] === 0x01 &&
      buffer[i + 3] === 0x02
    ) {
      total += buffer.readUInt32LE(i + 24);
    }
  }
  return total;
}

/** Texto de una celda de exceljs, cualquiera sea su forma interna. */
function celdaATexto(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'string') return valor.trim();
  if (typeof valor === 'number' || typeof valor === 'boolean') {
    return String(valor);
  }
  if (valor instanceof Date) return valor.toISOString();
  if (typeof valor === 'object') {
    const v = valor as {
      text?: unknown;
      result?: unknown;
      richText?: { text?: string }[];
      hyperlink?: unknown;
    };
    if (Array.isArray(v.richText)) {
      return v.richText.map((t) => t.text ?? '').join('').trim();
    }
    if (v.result !== undefined) return celdaATexto(v.result);
    if (v.text !== undefined) return celdaATexto(v.text);
    if (v.hyperlink !== undefined) return celdaATexto(v.hyperlink);
  }
  return '';
}

async function* leerCsv(
  buffer: Buffer,
  limits: ImportLimits,
): AsyncGenerator<ImportRow> {
  const parser = parse(decodeCsv(buffer), {
    bom: true,
    columns: resolverColumnas,
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
  });

  let rowNumber = 0;
  for await (const record of parser) {
    rowNumber += 1;
    if (rowNumber > limits.maxRows) {
      // Cortar acá es el punto: el `throw` destruye el parser y las filas que
      // siguen no se leen nunca.
      parser.destroy();
      throw new RowLimitExceededError(limits.maxRows);
    }
    yield { rowNumber, cells: record as Record<string, string> };
  }
}

async function* leerXlsx(
  buffer: Buffer,
  limits: ImportLimits,
): AsyncGenerator<ImportRow> {
  const declarado = declaredUncompressedBytes(buffer);
  if (declarado > limits.maxUncompressedBytes) {
    // Antes de descomprimir un solo byte. Es un 415 y no un 413 porque lo que
    // rechazamos es la FORMA del archivo, no su tamaño subido (que pasó el cap).
    throw new UnsupportedFormatError(
      'El Excel declara más contenido del que se puede procesar. Exportalo como CSV o dividilo.',
    );
  }

  // La fuente se conserva en una variable propia porque hay que poder
  // destruirla (ver el `finally`) y el tipo público de `WorkbookReader` no
  // expone el stream que guarda internamente.
  const fuente = Readable.from(buffer);
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(fuente, {
    entries: 'emit',
    sharedStrings: 'cache',
    worksheets: 'emit',
  });

  let columnas: (string | null)[] | null = null;
  let rowNumber = 0;
  let bytesConsumidos = 0;

  // Se toma la PRIMERA hoja y nada más, con un iterador explícito en vez de un
  // `for await`. Dos razones, las dos aprendidas del comportamiento real de
  // exceljs 4.4 y no de su documentación:
  //   1. Un archivo con varias hojas de catálogo sería una ambigüedad que el
  //      esquema v1 no define.
  //   2. Pedirle la hoja siguiente, o abandonar la iteración sin destruir el
  //      stream, hace que el reader siga parseando por su cuenta y explote con
  //      un `TypeError` interno que TAPA nuestro error de dominio: el 422 del
  //      dueño se convertiría en un 500. El `finally` destruye la fuente antes
  //      de que nuestra excepción termine de propagar.
  const hojas = reader[Symbol.asyncIterator]();
  try {
    const primera = await hojas.next();
    if (primera.done) {
      throw new MissingColumnsError([...COLUMNAS_REQUERIDAS]);
    }

    for await (const row of primera.value) {
      const valores = row.values as unknown[];
      // `row.values` es 1-based con un hueco en 0.
      const celdas = valores.slice(1).map(celdaATexto);
      bytesConsumidos += celdas.reduce((acc, c) => acc + c.length, 0);
      if (bytesConsumidos > limits.maxUncompressedBytes) {
        throw new UnsupportedFormatError(
          'El Excel declara más contenido del que se puede procesar. Exportalo como CSV o dividilo.',
        );
      }

      if (columnas === null) {
        columnas = resolverColumnas(celdas);
        continue;
      }

      // Una fila enteramente vacía es ruido de planilla (Excel arrastra filas
      // formateadas sin contenido), no una fila de producto inválida.
      if (celdas.every((c) => c === '')) continue;

      rowNumber += 1;
      if (rowNumber > limits.maxRows) {
        throw new RowLimitExceededError(limits.maxRows);
      }

      const cells: Record<string, string> = {};
      columnas.forEach((col, i) => {
        if (col !== null) cells[col] = celdas[i] ?? '';
      });
      yield { rowNumber, cells };
    }

    if (columnas === null) {
      // Un xlsx sin ninguna fila: no hay encabezado, así que faltan las 5.
      throw new MissingColumnsError([...COLUMNAS_REQUERIDAS]);
    }
  } finally {
    // Orden deliberado: primero se corta la fuente, después se cierra el
    // iterador de hojas. Si se deja abierto, exceljs reanuda su parseo por su
    // cuenta y termina lanzando un `TypeError` interno de forma asíncrona, que
    // en el mejor caso ensucia el test de otro caso y en el peor se convierte en
    // un 500 para el dueño. El error de cierre se descarta a propósito: acá ya
    // decidimos qué le devolvemos al usuario.
    fuente.destroy();
    try {
      await hojas.return?.(undefined as never);
    } catch {
      /* el reader ya no importa: la respuesta la define nuestro error de dominio */
    }
  }
}

/**
 * Itera las filas de datos del archivo. Lanza antes de emitir nada si el
 * encabezado no sirve (AC-6) y corta en cuanto se supera un cap (AC-11).
 */
export function readRows(
  buffer: Buffer,
  format: ImportFormat,
  limits: ImportLimits,
): AsyncGenerator<ImportRow> {
  return format === 'xlsx'
    ? leerXlsx(buffer, limits)
    : leerCsv(buffer, limits);
}
