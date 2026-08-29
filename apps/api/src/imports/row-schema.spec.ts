import {
  CAMPOS_REQUERIDOS_PARA_ALTA,
  faltantesParaAlta,
  LIMITES_CAMPO,
  ParsedRow,
  parsePrecioACentavos,
  RowError,
  validateRow,
} from './row-schema';

/**
 * T1.3 — tabla de casos de la validación por fila. El centro del spec es el
 * precio: es el campo donde una interpretación "amable" (adivinar el separador
 * de miles, redondear con punto flotante) se traduce en plata mal cobrada.
 */
const FILA_OK: Record<string, string> = {
  sku: 'REF-1',
  nombre: 'Heladera exhibidora',
  precio: '1234,56',
  stock: '3',
  categoria: 'Refrigeración',
};

function validar(parcial: Record<string, string>, rowNumber = 1) {
  return validateRow({ ...FILA_OK, ...parcial }, rowNumber);
}

function comoError(r: ReturnType<typeof validar>): RowError {
  expect(r.kind).toBe('error');
  return r as RowError;
}

function comoFila(r: ReturnType<typeof validar>): ParsedRow {
  expect(r.kind).toBe('row');
  return r as ParsedRow;
}

describe('parsePrecioACentavos — aritmética entera', () => {
  it.each([
    ['1234,56', 123456],
    ['1234.56', 123456],
    ['1234.5', 123450],
    ['1234,5', 123450],
    ['1234', 123400],
    ['0,01', 1],
    ['19.99', 1999],
  ])('convierte %s a %i centavos', (texto, esperado) => {
    expect(parsePrecioACentavos(texto)).toBe(esperado);
  });

  it('no arrastra el error de punto flotante de 19.99 * 100', () => {
    // parseFloat('19.99') * 100 === 1998.9999999999998
    expect(parsePrecioACentavos('19.99')).toBe(1999);
    expect(Number.isInteger(parsePrecioACentavos('19.99'))).toBe(true);
  });

  it.each([
    ['1.234', 'separador de miles ambiguo'],
    ['1,234', 'separador de miles ambiguo'],
    ['1234,567', 'tres decimales'],
    ['0', 'cero'],
    ['0,00', 'cero con decimales'],
    ['-10', 'negativo'],
    ['12,3,4', 'dos separadores'],
    ['1 234', 'espacio'],
    ['$1234', 'símbolo de moneda'],
    ['abc', 'texto'],
    ['1e3', 'notación científica'],
    ['', 'vacío'],
  ])('rechaza %s (%s)', (texto) => {
    expect(parsePrecioACentavos(texto)).toBeNull();
  });

  it('rechaza un precio que no cabe en int4 en vez de dejarlo explotar en la base', () => {
    expect(parsePrecioACentavos('99999999')).toBeNull();
    expect(parsePrecioACentavos('21474836,47')).toBe(LIMITES_CAMPO.int4Max);
  });
});

describe('validateRow — fila válida', () => {
  it('normaliza a las unidades del dominio', () => {
    const fila = comoFila(
      validateRow(
        {
          sku: ' REF-1 ',
          nombre: ' Heladera ',
          precio: '1234,56',
          stock: '3',
          categoria: ' Refrigeración ',
          descripcion: 'Fría de verdad',
          imagen_url: 'https://cdn.example.com/h.jpg',
        },
        7,
      ),
    );

    expect(fila).toEqual({
      kind: 'row',
      rowNumber: 7,
      sku: 'REF-1',
      name: 'Heladera',
      descriptionRaw: 'Fría de verdad',
      priceArsCents: 123456,
      stock: 3,
      categoryName: 'Refrigeración',
      imageUrl: 'https://cdn.example.com/h.jpg',
    });
  });

  it('stock 0 es válido: un producto agotado sigue siendo un producto', () => {
    expect(comoFila(validar({ stock: '0' })).stock).toBe(0);
  });

  it('una celda opcional vacía produce undefined, NO cadena vacía', () => {
    // Es la semántica "no cambiar ese campo" (OQ-BE-2). Con `''` acá, el archivo
    // de sólo precios del día 2 borraría las descripciones del catálogo entero.
    const fila = comoFila(validar({ descripcion: '', imagen_url: '   ' }));
    expect(fila.descriptionRaw).toBeUndefined();
    expect(fila.imageUrl).toBeUndefined();
    expect(fila).not.toHaveProperty('descriptionRaw', '');
  });

  it('una columna opcional ausente también produce undefined', () => {
    const fila = comoFila(validateRow({ ...FILA_OK }, 1));
    expect(fila.descriptionRaw).toBeUndefined();
    expect(fila.imageUrl).toBeUndefined();
  });

  it('acepta los máximos exactos de cada campo de texto', () => {
    const fila = comoFila(
      validar({
        sku: 'S'.repeat(LIMITES_CAMPO.skuMax),
        nombre: 'N'.repeat(LIMITES_CAMPO.nombreMax),
        categoria: 'C'.repeat(LIMITES_CAMPO.categoriaMax),
        descripcion: 'D'.repeat(LIMITES_CAMPO.descripcionMax),
      }),
    );
    expect(fila.sku).toHaveLength(LIMITES_CAMPO.skuMax);
  });
});

describe('validateRow — filas rechazadas', () => {
  it.each([
    ['vacío', { sku: '' }],
    ['sólo espacios', { sku: '   ' }],
  ])('un sku %s es missing_required: es la clave, no se puede omitir', (_caso, parcial) => {
    const err = comoError(validar(parcial as Record<string, string>));
    expect(err.errorCode).toBe('missing_required');
    expect(err.field).toBe('sku');
  });

  it.each([
    ['nombre', { nombre: '' }],
    ['precio', { precio: '' }],
    ['stock', { stock: '' }],
    ['categoria', { categoria: '' }],
  ])(
    'una celda requerida vacía (%s) NO invalida la fila acá: puede ser un update',
    (_campo, parcial) => {
      // La decisión "falta un dato obligatorio" necesita saber si el SKU existe,
      // y eso sólo lo sabe el service (OQ-8). Acá la fila pasa con el campo en
      // undefined = "no cambiar".
      const fila = comoFila(validar(parcial as Record<string, string>));
      expect(fila.sku).toBe('REF-1');
    },
  );

  it('sku demasiado largo es invalid_sku', () => {
    const err = comoError(
      validar({ sku: 'S'.repeat(LIMITES_CAMPO.skuMax + 1) }),
    );
    expect(err.errorCode).toBe('invalid_sku');
    expect(err.field).toBe('sku');
  });

  it('nombre de 201 caracteres es invalid_text', () => {
    const err = comoError(
      validar({ nombre: 'N'.repeat(LIMITES_CAMPO.nombreMax + 1) }),
    );
    expect(err.errorCode).toBe('invalid_text');
    expect(err.field).toBe('nombre');
    // El sku viaja en el error: es lo que le permite al dueño ubicar la fila.
    expect(err.sku).toBe('REF-1');
  });

  it('nombre con un caracter de control se rechaza (no se limpia)', () => {
    const err = comoError(validar({ nombre: 'Hela\u0000dera' }));
    expect(err.field).toBe('nombre');
    expect(err.errorMessage).toContain('no imprimibles');
  });

  it.each([
    ['1.234', 'separador de miles'],
    ['1234,567', '3 decimales'],
    ['0', 'cero'],
    ['-5', 'negativo'],
    ['abc', 'no numérico'],
  ])('precio %s es invalid_price (%s)', (precio) => {
    const err = comoError(validar({ precio }));
    expect(err.errorCode).toBe('invalid_price');
    expect(err.field).toBe('precio');
  });

  it('el motivo del precio le dice al dueño cómo escribirlo', () => {
    const err = comoError(validar({ precio: '1.234' }));
    expect(err.errorMessage).toContain('1234,56');
    // Nada de nombres de la base en el motivo que ve el dueño.
    expect(err.errorMessage).not.toContain('price_ars_cents');
  });

  it.each([
    ['-1', 'negativo'],
    ['1,5', 'decimal'],
    ['3.0', 'decimal con punto'],
    ['dos', 'texto'],
  ])('stock %s es invalid_stock (%s)', (stock) => {
    const err = comoError(validar({ stock }));
    expect(err.errorCode).toBe('invalid_stock');
    expect(err.field).toBe('stock');
  });

  it('categoría demasiado larga es invalid_category', () => {
    const err = comoError(
      validar({ categoria: 'C'.repeat(LIMITES_CAMPO.categoriaMax + 1) }),
    );
    expect(err.errorCode).toBe('invalid_category');
  });

  it.each([
    ['http://x.com/a.jpg', 'http'],
    ['javascript:alert(1)', 'javascript'],
    ['data:image/png;base64,AAA', 'data'],
    ['ftp://x.com/a.jpg', 'ftp'],
    ['no-es-una-url', 'sin esquema'],
  ])('imagen_url %s es invalid_image_url (%s)', (url) => {
    const err = comoError(validar({ imagen_url: url }));
    expect(err.errorCode).toBe('invalid_image_url');
    expect(err.field).toBe('imagen_url');
  });

  it('imagen_url https válida no rechaza la fila', () => {
    expect(
      comoFila(validar({ imagen_url: 'https://cdn.example.com/a.jpg' }))
        .imageUrl,
    ).toBe('https://cdn.example.com/a.jpg');
  });

  it('descripción de más de 2000 caracteres se rechaza', () => {
    const err = comoError(
      validar({ descripcion: 'D'.repeat(LIMITES_CAMPO.descripcionMax + 1) }),
    );
    expect(err.field).toBe('descripcion');
  });

  it('conserva el rowNumber para que el reporte apunte a la fila real', () => {
    const err = comoError(validar({ precio: '0' }, 137));
    expect(err.rowNumber).toBe(137);
  });
});

describe('faltantesParaAlta (completitud del alta, OQ-8)', () => {
  const fila = (over: Partial<ParsedRow> = {}): ParsedRow => ({
    kind: 'row',
    rowNumber: 1,
    sku: 'REF-1',
    name: 'Heladera',
    priceArsCents: 100000,
    stock: 3,
    categoryName: 'Refrigeración',
    ...over,
  });

  it('una fila completa no le falta nada', () => {
    expect(faltantesParaAlta(fila())).toEqual([]);
  });

  it('enumera los cuatro campos cuando sólo vino el sku', () => {
    // Es el archivo de sólo precios aplicado a un SKU que NO existe: ahí sí es
    // una fila inválida, y el motivo tiene que decir qué falta.
    const soloSku: ParsedRow = { kind: 'row', rowNumber: 1, sku: 'REF-1' };
    expect(faltantesParaAlta(soloSku)).toEqual([...CAMPOS_REQUERIDOS_PARA_ALTA]);
  });

  it.each([
    ['nombre', { name: undefined }],
    ['precio', { priceArsCents: undefined }],
    ['stock', { stock: undefined }],
    ['categoria', { categoryName: undefined }],
  ])('detecta que falta %s', (campo, over) => {
    expect(faltantesParaAlta(fila(over as Partial<ParsedRow>))).toEqual([campo]);
  });

  it('stock 0 y precio mínimo cuentan como presentes (no son falsy para esto)', () => {
    // El bug clásico de `!valor`: un producto agotado tiene stock 0 y sigue
    // siendo un alta completa.
    expect(faltantesParaAlta(fila({ stock: 0, priceArsCents: 1 }))).toEqual([]);
  });

  it('las columnas opcionales nunca son faltantes', () => {
    expect(
      faltantesParaAlta(fila({ descriptionRaw: undefined, imageUrl: undefined })),
    ).toEqual([]);
  });
});
