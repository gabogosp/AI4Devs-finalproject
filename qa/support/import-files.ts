import ExcelJS from 'exceljs';

/**
 * Generadores deterministas de archivos de import (US-006, `design.md` §2).
 *
 * Nada binario en git: cada función fabrica el `Buffer` en memoria. El xlsx se
 * arma con `exceljs@4.4.0` — la MISMA versión que usa el parser del API
 * (`apps/api/package.json`) — porque si el escritor de la suite se adelanta al
 * lector de producción, el test empieza a probar el escritor y no el parser.
 *
 * Columnas del contrato (`row-schema.ts`): sku, nombre, precio, stock,
 * categoria, descripcion, imagen_url. `sku` es la única obligatoria en TODAS
 * las filas; el resto vacío significa "no cambiar ese campo" (OQ-BE-2).
 */

const COLUMNAS = ['sku', 'nombre', 'precio', 'stock', 'categoria', 'descripcion', 'imagen_url'] as const;

export interface FilaCsv {
  sku?: string;
  nombre?: string;
  precio?: string;
  stock?: string;
  categoria?: string;
  descripcion?: string;
  imagen_url?: string;
}

/** Encabezado + una línea por fila, en el orden fijo del contrato. `undefined` → celda vacía. */
function aCsv(filas: FilaCsv[]): Buffer {
  const lineas = [
    COLUMNAS.join(','),
    ...filas.map((fila) =>
      COLUMNAS.map((columna) => escaparCelda(fila[columna] ?? '')).join(','),
    ),
  ];
  return Buffer.from(lineas.join('\r\n') + '\r\n', 'utf8');
}

/** Comillado mínimo: sólo si la celda trae la coma, una comilla o un salto de línea. */
function escaparCelda(valor: string): string {
  if (/[",\r\n]/.test(valor)) {
    return `"${valor.replace(/"/g, '""')}"`;
  }
  return valor;
}

/**
 * `filas` altas limpias, cada una con su propio SKU/categoría únicos por
 * corrida (via `sufijo`, que el llamador controla para no colisionar entre
 * escenarios que comparten proceso).
 */
export function csvValido({
  filas = 3,
  sufijo = `${Date.now()}`,
  categoria = `Categoría import ${sufijo}`,
}: { filas?: number; sufijo?: string; categoria?: string } = {}): {
  buffer: Buffer;
  skus: string[];
} {
  const skus = Array.from({ length: filas }, (_, i) => `IMP-${sufijo}-${i + 1}`);
  const buffer = aCsv(
    skus.map((sku, i) => ({
      sku,
      nombre: `Producto import ${sufijo}-${i + 1}`,
      precio: '1500,50',
      stock: '10',
      categoria,
    })),
  );
  return { buffer, skus };
}

/**
 * Válidas + una fila por cada `error_code` que un archivo puede provocar por sí
 * solo (sin tocar la base): `missing_required` (sku vacío), `invalid_price`,
 * `invalid_stock`, `duplicate_sku_in_file`. Los demás códigos (`invalid_category`,
 * `invalid_sku`, `invalid_text`, `invalid_image_url`) tienen su propio generador
 * dedicado porque cada uno necesita una celda distinta al límite.
 */
export function csvMixto(sufijo = `${Date.now()}`): {
  buffer: Buffer;
  validos: string[];
  categoria: string;
} {
  const categoria = `Categoría mixto ${sufijo}`;
  const validos = [`MIX-${sufijo}-OK1`, `MIX-${sufijo}-OK2`, `MIX-${sufijo}-OK3`];
  const filas: FilaCsv[] = [
    { sku: validos[0], nombre: 'Válido uno', precio: '100', stock: '1', categoria },
    { sku: validos[1], nombre: 'Válido dos', precio: '200', stock: '2', categoria },
    { sku: validos[2], nombre: 'Válido tres', precio: '300', stock: '3', categoria },
    // missing_required: sku vacío.
    { sku: '', nombre: 'Sin sku', precio: '100', stock: '1', categoria },
    // invalid_price: no matchea el patrón de precio.
    {
      sku: `MIX-${sufijo}-BADPRICE`,
      nombre: 'Precio inválido',
      precio: 'gratis',
      stock: '1',
      categoria,
    },
    // invalid_stock: no es un entero ≥ 0.
    {
      sku: `MIX-${sufijo}-BADSTOCK`,
      nombre: 'Stock inválido',
      precio: '100',
      stock: '-5',
      categoria,
    },
    // duplicate_sku_in_file: repite validos[0] dentro del MISMO archivo.
    { sku: validos[0], nombre: 'Duplicado', precio: '999', stock: '9', categoria },
  ];
  return { buffer: aCsv(filas), validos, categoria };
}

/** Falta la columna indicada en el encabezado entero → 422 missing-columns. */
export function csvSinColumna(columna: (typeof COLUMNAS)[number]): Buffer {
  const resto = COLUMNAS.filter((c) => c !== columna);
  const fila = resto.map(() => 'x').join(',');
  return Buffer.from(`${resto.join(',')}\r\n${fila}\r\n`, 'utf8');
}

/**
 * El archivo "día 2": sólo `sku` + `precio`, el resto vacío. Es el caso real de
 * AC-4 (ajuste de precios por inflación) — actualiza precio y conserva todo lo
 * demás porque las celdas vacías significan "no cambiar" (OQ-BE-2).
 */
export function csvSoloPrecios(skus: string[], precioNuevo = '1800'): Buffer {
  return aCsv(skus.map((sku) => ({ sku, precio: precioNuevo })));
}

/** El mismo sku dos veces en el archivo → la segunda es `duplicate_sku_in_file`. */
export function csvDuplicado(sku: string, sufijo = `${Date.now()}`): Buffer {
  const categoria = `Categoría duplicado ${sufijo}`;
  return aCsv([
    { sku, nombre: 'Primera aparición', precio: '100', stock: '1', categoria },
    { sku, nombre: 'Segunda aparición', precio: '200', stock: '2', categoria },
  ]);
}

/** Un renglón por encima del tope de filas (`IMPORT_MAX_ROWS`, default 5000). */
export function csvFilas(cantidad: number): Buffer {
  const categoria = 'Categoría filas';
  const lineas = [COLUMNAS.join(',')];
  for (let i = 1; i <= cantidad; i += 1) {
    lineas.push(`FILA-${i},Producto ${i},100,1,${categoria},,`);
  }
  return Buffer.from(lineas.join('\r\n') + '\r\n', 'utf8');
}

/** Un archivo de exactamente `bytes` bytes (relleno en un campo de texto libre). */
export function csvDeTamanio(bytes: number): Buffer {
  const encabezado = Buffer.from(`${COLUMNAS.join(',')}\r\n`, 'utf8');
  const prefijoFila = Buffer.from('PADSKU,Producto,100,1,Categoría,', 'utf8');
  const sufijoFila = Buffer.from(',\r\n', 'utf8');
  const relleno = Math.max(0, bytes - encabezado.length - prefijoFila.length - sufijoFila.length);
  return Buffer.concat([encabezado, prefijoFila, Buffer.alloc(relleno, 'a'), sufijoFila]);
}

/**
 * "Refrigeración" guardado en Latin-1 (ISO-8859-1), no UTF-8 → 422
 * invalid-encoding. Los bytes no forman una secuencia UTF-8 válida porque las
 * tildes ocupan 1 byte en Latin-1 y 2 en UTF-8.
 */
export function csvLatin1(): Buffer {
  const texto = 'sku,nombre,precio,stock,categoria,descripcion,imagen_url\r\nLAT-1,Refrigeración,100,1,Categoría,,\r\n';
  return Buffer.from(texto, 'latin1');
}

/** Workbook real vía `exceljs`, mismas columnas y una fila válida. */
export async function xlsxValido(sufijo = `${Date.now()}`): Promise<{
  buffer: Buffer;
  sku: string;
}> {
  const sku = `XLS-${sufijo}`;
  const wb = new ExcelJS.Workbook();
  const hoja = wb.addWorksheet('productos');
  hoja.addRow([...COLUMNAS]);
  hoja.addRow([sku, `Producto excel ${sufijo}`, '2500', '7', `Categoría excel ${sufijo}`, '', '']);
  const arrayBuffer = await wb.xlsx.writeBuffer();
  return { buffer: Buffer.from(arrayBuffer), sku };
}
