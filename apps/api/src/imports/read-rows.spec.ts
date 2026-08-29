import ExcelJS from 'exceljs';
import {
  COLUMNAS_REQUERIDAS,
  declaredUncompressedBytes,
  ImportLimits,
  ImportRow,
  normalizeHeader,
  readRows,
} from './read-rows';
import { MissingColumnsError, RowLimitExceededError, UnsupportedFormatError } from './import-errors';

/**
 * T1.2 — el lector corta temprano. Los tests que importan no son los del camino
 * feliz: son los que prueben que un archivo demasiado grande NO se lee entero
 * antes de rechazarlo, y que un xlsx que declara una expansión enorme se rechaza
 * sin descomprimirla.
 */
const LIMITES: ImportLimits = {
  maxRows: 5_000,
  maxUncompressedBytes: 33_554_432,
};

function csv(lineas: string[]): Buffer {
  return Buffer.from(lineas.join('\n') + '\n', 'utf8');
}

async function juntar(
  it: AsyncGenerator<ImportRow>,
): Promise<ImportRow[]> {
  const filas: ImportRow[] = [];
  for await (const f of it) filas.push(f);
  return filas;
}

async function xlsx(
  filas: unknown[][],
  nombreHoja = 'catalogo',
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const hoja = wb.addWorksheet(nombreHoja);
  filas.forEach((f) => hoja.addRow(f));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('normalizeHeader', () => {
  it('colapsa acentos, mayúsculas y espacios a la columna canónica', () => {
    expect(normalizeHeader('Descripción')).toBe('descripcion');
    expect(normalizeHeader('DESCRIPCION')).toBe('descripcion');
    expect(normalizeHeader('  descripcion  ')).toBe('descripcion');
    expect(normalizeHeader('Categoría')).toBe('categoria');
  });

  it('devuelve snake_case para las columnas compuestas', () => {
    // `slugify` produce kebab; las columnas canónicas son snake_case.
    expect(normalizeHeader('imagen_url')).toBe('imagen_url');
    expect(normalizeHeader('Imagen URL')).toBe('imagen_url');
  });
});

describe('readRows — CSV', () => {
  it('normaliza los encabezados y numera las filas de datos desde 1', async () => {
    const filas = await juntar(
      readRows(
        csv([
          'SKU,Nombre,PRECIO,Stock,Categoría,Descripción',
          'REF-1,Heladera,1234.56,3,Refrigeración,Fría',
          'REF-2,Mecha,900,10,Herramientas,',
        ]),
        'csv',
        LIMITES,
      ),
    );

    expect(filas).toHaveLength(2);
    expect(filas[0].rowNumber).toBe(1); // el encabezado NO cuenta
    expect(filas[1].rowNumber).toBe(2);
    expect(filas[0].cells).toEqual({
      sku: 'REF-1',
      nombre: 'Heladera',
      precio: '1234.56',
      stock: '3',
      categoria: 'Refrigeración',
      descripcion: 'Fría',
    });
  });

  it('ignora las columnas desconocidas y lee el resto', async () => {
    const filas = await juntar(
      readRows(
        csv([
          'sku,nombre,precio,stock,categoria,notas',
          'REF-1,Heladera,10,1,Refrigeración,ojo con el flete',
        ]),
        'csv',
        LIMITES,
      ),
    );

    expect(filas[0].cells).not.toHaveProperty('notas');
    expect(filas[0].cells.sku).toBe('REF-1');
  });

  it('sin una columna requerida lanza MissingColumnsError nombrándola', async () => {
    const it = readRows(
      csv(['sku,nombre,stock,categoria', 'REF-1,Heladera,3,Refrigeración']),
      'csv',
      LIMITES,
    );

    await expect(juntar(it)).rejects.toThrow(MissingColumnsError);

    let capturado: MissingColumnsError | null = null;
    try {
      await juntar(
        readRows(
          csv(['sku,nombre,stock,categoria', 'REF-1,Heladera,3,Refrigeración']),
          'csv',
          LIMITES,
        ),
      );
    } catch (e) {
      capturado = e as MissingColumnsError;
    }

    expect(capturado?.message).toContain('precio');
    // El error habla el idioma del archivo del dueño, no el de la base.
    expect(capturado?.message).not.toContain('price_ars_cents');
    expect(capturado?.message).not.toContain('products');
    expect(capturado?.fieldErrors).toEqual([
      { field: 'precio', message: 'columna requerida ausente en el encabezado' },
    ]);
  });

  it('un archivo sin ninguna columna requerida las enumera todas', async () => {
    let capturado: MissingColumnsError | null = null;
    try {
      await juntar(readRows(csv(['a,b,c', '1,2,3']), 'csv', LIMITES));
    } catch (e) {
      capturado = e as MissingColumnsError;
    }
    expect(capturado?.fieldErrors?.map((f) => f.field)).toEqual([
      ...COLUMNAS_REQUERIDAS,
    ]);
  });

  it('valida el encabezado aunque el archivo no tenga ni una fila de datos', async () => {
    // El rechazo del archivo (AC-6) no puede depender de que haya datos.
    await expect(
      juntar(readRows(csv(['sku,nombre,stock,categoria']), 'csv', LIMITES)),
    ).rejects.toThrow(MissingColumnsError);
  });

  it('supera el cap de filas y CORTA sin leer el archivo entero', async () => {
    const TOTAL = 100;
    const limites: ImportLimits = { ...LIMITES, maxRows: 10 };
    const lineas = ['sku,nombre,precio,stock,categoria'];
    for (let i = 0; i < TOTAL; i += 1) {
      lineas.push(`REF-${i},Producto ${i},10,1,Varios`);
    }

    const it = readRows(csv(lineas), 'csv', limites);
    let leidas = 0;
    let error: unknown = null;
    try {
      for await (const _fila of it) {
        void _fila;
        leidas += 1;
      }
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(RowLimitExceededError);
    // La prueba del corte temprano: se consumieron 10 filas de 100, no 100.
    expect(leidas).toBe(limites.maxRows);
    expect(leidas).toBeLessThan(TOTAL);
    expect((error as RowLimitExceededError).message).toContain('10');
  });

  it('acepta exactamente el cap de filas sin lanzar', async () => {
    const limites: ImportLimits = { ...LIMITES, maxRows: 3 };
    const filas = await juntar(
      readRows(
        csv([
          'sku,nombre,precio,stock,categoria',
          'A,1,10,1,V',
          'B,2,10,1,V',
          'C,3,10,1,V',
        ]),
        'csv',
        limites,
      ),
    );
    expect(filas).toHaveLength(3);
  });

  it('tolera filas con menos columnas que el encabezado (relax_column_count)', async () => {
    const filas = await juntar(
      readRows(
        csv([
          'sku,nombre,precio,stock,categoria,descripcion',
          'REF-1,Heladera,10,1,Refrigeración',
        ]),
        'csv',
        LIMITES,
      ),
    );
    expect(filas).toHaveLength(1);
    expect(filas[0].cells.descripcion).toBeUndefined();
  });
});

describe('readRows — XLSX', () => {
  it('lee un xlsx real con encabezados normalizados', async () => {
    const buffer = await xlsx([
      ['SKU', 'Nombre', 'Precio', 'Stock', 'Categoría'],
      ['REF-1', 'Heladera', '1234,56', 3, 'Refrigeración'],
    ]);

    const filas = await juntar(readRows(buffer, 'xlsx', LIMITES));
    expect(filas).toHaveLength(1);
    expect(filas[0].rowNumber).toBe(1);
    expect(filas[0].cells).toEqual({
      sku: 'REF-1',
      nombre: 'Heladera',
      precio: '1234,56',
      stock: '3', // el número de la planilla llega como texto
      categoria: 'Refrigeración',
    });
  });

  it('ignora las filas completamente vacías que arrastra Excel', async () => {
    const buffer = await xlsx([
      ['sku', 'nombre', 'precio', 'stock', 'categoria'],
      ['REF-1', 'Heladera', '10', 1, 'Refrigeración'],
      ['', '', '', '', ''],
      ['REF-2', 'Mecha', '20', 2, 'Herramientas'],
    ]);

    const filas = await juntar(readRows(buffer, 'xlsx', LIMITES));
    expect(filas.map((f) => f.cells.sku)).toEqual(['REF-1', 'REF-2']);
    // La fila vacía no consume un `rowNumber`: los números que ve el dueño en el
    // reporte tienen que corresponder a filas con contenido.
    expect(filas.map((f) => f.rowNumber)).toEqual([1, 2]);
  });

  it('sin columna requerida lanza MissingColumnsError', async () => {
    const buffer = await xlsx([
      ['sku', 'nombre', 'stock', 'categoria'],
      ['REF-1', 'Heladera', 1, 'Refrigeración'],
    ]);
    await expect(juntar(readRows(buffer, 'xlsx', LIMITES))).rejects.toThrow(
      MissingColumnsError,
    );
  });

  it('rechaza el xlsx que declara más expansión que el cap SIN descomprimirlo', async () => {
    const filas: unknown[][] = [
      ['sku', 'nombre', 'precio', 'stock', 'categoria'],
    ];
    const relleno = 'X'.repeat(500);
    for (let i = 0; i < 2_000; i += 1) {
      filas.push([`REF-${i}`, relleno, '10', 1, 'Varios']);
    }
    const buffer = await xlsx(filas);

    const declarado = declaredUncompressedBytes(buffer);
    const limites: ImportLimits = { ...LIMITES, maxUncompressedBytes: 50_000 };
    // El zip comprime muy bien el relleno repetido: eso es justamente la forma
    // de una zip bomb — chico al subirlo, enorme al abrirlo.
    expect(declarado).toBeGreaterThan(limites.maxUncompressedBytes);
    expect(buffer.length).toBeLessThan(declarado);

    const heapAntes = process.memoryUsage().heapUsed;
    let leidas = 0;
    let error: unknown = null;
    try {
      for await (const _fila of readRows(buffer, 'xlsx', limites)) {
        void _fila;
        leidas += 1;
      }
    } catch (e) {
      error = e;
    }
    const crecimiento = process.memoryUsage().heapUsed - heapAntes;

    expect(error).toBeInstanceOf(UnsupportedFormatError);
    expect((error as UnsupportedFormatError).status).toBe(415);
    expect(leidas).toBe(0);
    // No se expandió nada: el heap no creció ni lo que el archivo declaraba.
    expect(crecimiento).toBeLessThan(declarado);
  });

  it('lee el MISMO archivo varias veces en el mismo proceso (regresión del bug de exceljs)', async () => {
    // No es un test redundante: leer dos xlsx seguidos en un proceso fallaba el
    // ~50 % de las veces por un `this.model` sin guardia dentro de exceljs, y el
    // camino real hace exactamente eso (preflight del POST + lectura del runner).
    const buffer = await xlsx([
      ['sku', 'nombre', 'precio', 'stock', 'categoria'],
      ['REF-1', 'Heladera', '1000,50', 2, 'Refrigeración'],
      ['REF-2', 'Mecha', '900', 5, 'Herramientas'],
    ]);

    for (let intento = 0; intento < 5; intento += 1) {
      const filas = await juntar(readRows(buffer, 'xlsx', LIMITES));
      expect(filas).toHaveLength(2);
      expect(filas[0].cells.sku).toBe('REF-1');
    }
  });

  it('supera el cap de filas y corta', async () => {
    const filas: unknown[][] = [
      ['sku', 'nombre', 'precio', 'stock', 'categoria'],
    ];
    for (let i = 0; i < 50; i += 1) {
      filas.push([`REF-${i}`, `P${i}`, '10', 1, 'Varios']);
    }
    const buffer = await xlsx(filas);
    const limites: ImportLimits = { ...LIMITES, maxRows: 5 };

    let leidas = 0;
    let error: unknown = null;
    try {
      for await (const _fila of readRows(buffer, 'xlsx', limites)) {
        void _fila;
        leidas += 1;
      }
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(RowLimitExceededError);
    expect(leidas).toBe(5);
  });
});
