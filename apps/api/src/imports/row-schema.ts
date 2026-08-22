/**
 * T1.3 — validación por fila: función **pura**, sin I/O ni framework.
 *
 * `security-standards.md` §6.1 (allowlist semantics): se define qué ES válido y
 * se rechaza el resto. Y **reject, don't repair** — ninguna celda se "arregla"
 * sola: un precio ambiguo o un nombre con basura binaria vuelve al dueño en el
 * reporte, porque un catálogo con datos reparados a ciegas es un catálogo en el
 * que nadie puede confiar y que nadie sabe que está mal.
 */

/**
 * Catálogo **cerrado** de códigos de error por fila (design.md §Atomicidad).
 * Aparecen tal cual en el JSON del estado y en el CSV del reporte, así que
 * agregar uno es un cambio de contrato: se decide en el plan, no acá.
 *
 * Nota de precisión sobre `name_too_long`: es el código de las violaciones de
 * los campos de TEXTO libre (`nombre`, `descripcion`), y cubre tanto el exceso
 * de longitud como los caracteres no imprimibles. El nombre del código quedó más
 * angosto que su alcance; el `field` y el `motivo` de cada fila sí dicen la
 * verdad exacta. Renombrarlo es un cambio de contrato pendiente de decisión.
 */
export const ROW_ERROR_CODES = [
  'missing_required',
  'invalid_sku',
  'name_too_long',
  'invalid_price',
  'invalid_stock',
  'invalid_category',
  'invalid_image_url',
  'duplicate_sku_in_file',
  'slug_conflict',
  'write_failed',
] as const;

export type RowErrorCode = (typeof ROW_ERROR_CODES)[number];

/** Fila válida, ya normalizada a las unidades y nombres del dominio. */
export interface ParsedRow {
  kind: 'row';
  rowNumber: number;
  sku: string;
  name: string;
  /** `undefined` = la celda vino vacía ⇒ no cambiar el valor persistido (OQ-BE-2). */
  descriptionRaw?: string;
  /** Centavos ARS, entero (api-standards §5.5). */
  priceArsCents: number;
  stock: number;
  categoryName: string;
  /** `undefined` = celda vacía ⇒ no cambiar (OQ-BE-2). */
  imageUrl?: string;
}

/** Fila rechazada. Viaja al reporte tal cual. */
export interface RowError {
  kind: 'error';
  rowNumber: number;
  /** El sku crudo si se pudo leer: es lo que le permite al dueño ubicar la fila. */
  sku?: string;
  field: string;
  errorCode: RowErrorCode;
  errorMessage: string;
}

export type RowResult = ParsedRow | RowError;

export const LIMITES_CAMPO = {
  skuMax: 64,
  nombreMax: 200,
  descripcionMax: 2_000,
  categoriaMax: 120,
  imagenUrlMax: 2_048,
  /**
   * `price_ars_cents` y `stock` son `Int` en Postgres (int4). Un precio con un
   * cero de más tiene que volver como `invalid_price` en el reporte, no como un
   * `write_failed` opaco cuando la base lo rechace.
   */
  int4Max: 2_147_483_647,
} as const;

/** Sólo dígitos y, opcionalmente, UN separador decimal con 1 o 2 decimales. */
const PRECIO_RE = /^\d+(?:[.,]\d{1,2})?$/;
const STOCK_RE = /^\d+$/;
/** C0 + DEL: no tienen lugar en un nombre de producto. */
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

function error(
  rowNumber: number,
  sku: string | undefined,
  field: string,
  errorCode: RowErrorCode,
  errorMessage: string,
): RowError {
  return { kind: 'error', rowNumber, sku, field, errorCode, errorMessage };
}

/**
 * Celda como texto útil, o `undefined` si vino vacía.
 *
 * La distinción entre `''` y `undefined` es la que sostiene OQ-BE-2: en una
 * columna opcional, vacío significa **"no cambiar ese campo"**. Si esto
 * devolviera `''`, el archivo de sólo precios del día 2 borraría las
 * descripciones de todo el catálogo.
 */
function celda(cells: Record<string, string>, columna: string): string | undefined {
  const valor = cells[columna];
  if (valor === undefined) return undefined;
  const limpio = valor.trim();
  return limpio.length === 0 ? undefined : limpio;
}

/**
 * Convierte `"1234,56"` / `"1234.5"` / `"1234"` a centavos con **aritmética
 * entera** (api-standards §5.5). Nunca `parseFloat * 100`: `19.99 * 100` es
 * 1998.9999999999998 en punto flotante, y un catálogo de ferretería no puede
 * tener precios que dependan de eso.
 *
 * @returns centavos, o `null` si el texto no es un precio válido.
 */
export function parsePrecioACentavos(texto: string): number | null {
  if (!PRECIO_RE.test(texto)) return null;
  const [entero, decimales = ''] = texto.split(/[.,]/);
  const centavos = Number(entero) * 100 + Number(decimales.padEnd(2, '0'));
  if (!Number.isSafeInteger(centavos) || centavos <= 0) return null;
  if (centavos > LIMITES_CAMPO.int4Max) return null;
  return centavos;
}

/**
 * Valida una fila leída y la normaliza, o devuelve el primer error encontrado.
 *
 * Se devuelve **un** error por fila (el primero), no la lista completa: el
 * reporte tiene una línea por fila y el dueño arregla y vuelve a subir. Guardar
 * cinco motivos de la misma fila multiplicaría el reporte sin cambiar lo que
 * tiene que hacer.
 */
export function validateRow(
  cells: Record<string, string>,
  rowNumber: number,
): RowResult {
  const sku = celda(cells, 'sku');
  const nombre = celda(cells, 'nombre');
  const precio = celda(cells, 'precio');
  const stockTexto = celda(cells, 'stock');
  const categoria = celda(cells, 'categoria');
  const descripcion = celda(cells, 'descripcion');
  const imagenUrl = celda(cells, 'imagen_url');

  if (sku === undefined) {
    return error(
      rowNumber,
      undefined,
      'sku',
      'missing_required',
      'el sku es obligatorio',
    );
  }
  if (sku.length > LIMITES_CAMPO.skuMax) {
    return error(
      rowNumber,
      sku,
      'sku',
      'invalid_sku',
      `el sku no puede tener más de ${LIMITES_CAMPO.skuMax} caracteres`,
    );
  }
  if (CONTROL_RE.test(sku)) {
    return error(
      rowNumber,
      sku,
      'sku',
      'invalid_sku',
      'el sku tiene caracteres no imprimibles',
    );
  }

  if (nombre === undefined) {
    return error(
      rowNumber,
      sku,
      'nombre',
      'missing_required',
      'el nombre es obligatorio',
    );
  }
  if (nombre.length > LIMITES_CAMPO.nombreMax) {
    return error(
      rowNumber,
      sku,
      'nombre',
      'name_too_long',
      `el nombre no puede tener más de ${LIMITES_CAMPO.nombreMax} caracteres`,
    );
  }
  if (CONTROL_RE.test(nombre)) {
    return error(
      rowNumber,
      sku,
      'nombre',
      'name_too_long',
      'el nombre tiene caracteres no imprimibles',
    );
  }

  if (precio === undefined) {
    return error(
      rowNumber,
      sku,
      'precio',
      'missing_required',
      'el precio es obligatorio',
    );
  }
  const priceArsCents = parsePrecioACentavos(precio);
  if (priceArsCents === null) {
    return error(
      rowNumber,
      sku,
      'precio',
      'invalid_price',
      'el precio tiene que ser un número mayor a 0 con hasta 2 decimales, sin separador de miles (ej. 1234,56)',
    );
  }

  if (stockTexto === undefined) {
    return error(
      rowNumber,
      sku,
      'stock',
      'missing_required',
      'el stock es obligatorio',
    );
  }
  if (!STOCK_RE.test(stockTexto)) {
    return error(
      rowNumber,
      sku,
      'stock',
      'invalid_stock',
      'el stock tiene que ser un número entero de 0 o más',
    );
  }
  const stock = Number(stockTexto);
  if (stock > LIMITES_CAMPO.int4Max) {
    return error(
      rowNumber,
      sku,
      'stock',
      'invalid_stock',
      'el stock es demasiado grande',
    );
  }

  if (categoria === undefined) {
    return error(
      rowNumber,
      sku,
      'categoria',
      'missing_required',
      'la categoría es obligatoria',
    );
  }
  if (categoria.length > LIMITES_CAMPO.categoriaMax) {
    return error(
      rowNumber,
      sku,
      'categoria',
      'invalid_category',
      `la categoría no puede tener más de ${LIMITES_CAMPO.categoriaMax} caracteres`,
    );
  }
  if (CONTROL_RE.test(categoria)) {
    return error(
      rowNumber,
      sku,
      'categoria',
      'invalid_category',
      'la categoría tiene caracteres no imprimibles',
    );
  }

  if (descripcion !== undefined) {
    if (descripcion.length > LIMITES_CAMPO.descripcionMax) {
      return error(
        rowNumber,
        sku,
        'descripcion',
        'name_too_long',
        `la descripción no puede tener más de ${LIMITES_CAMPO.descripcionMax} caracteres`,
      );
    }
    if (CONTROL_RE.test(descripcion)) {
      return error(
        rowNumber,
        sku,
        'descripcion',
        'name_too_long',
        'la descripción tiene caracteres no imprimibles',
      );
    }
  }

  if (imagenUrl !== undefined) {
    if (imagenUrl.length > LIMITES_CAMPO.imagenUrlMax) {
      return error(
        rowNumber,
        sku,
        'imagen_url',
        'invalid_image_url',
        'la URL de la imagen es demasiado larga',
      );
    }
    let parsed: URL;
    try {
      parsed = new URL(imagenUrl);
    } catch {
      return error(
        rowNumber,
        sku,
        'imagen_url',
        'invalid_image_url',
        'la URL de la imagen no es válida',
      );
    }
    // Sólo `https:`. Un `http:` publicado en la ficha rompe la página segura
    // (mixed content) y un `javascript:`/`data:` sería un vector de inyección
    // en el atributo `src` — el allowlist de esquema los descarta a los tres.
    if (parsed.protocol !== 'https:') {
      return error(
        rowNumber,
        sku,
        'imagen_url',
        'invalid_image_url',
        'la URL de la imagen tiene que empezar con https://',
      );
    }
  }

  return {
    kind: 'row',
    rowNumber,
    sku,
    name: nombre,
    descriptionRaw: descripcion,
    priceArsCents,
    stock,
    categoryName: categoria,
    imageUrl: imagenUrl,
  };
}
