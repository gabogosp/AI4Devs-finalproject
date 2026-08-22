import { mapErrorToProblem } from '../common/filters/http-problem.filter';
import {
  FileTooLargeError,
  ImportAlreadyRunningError,
  ImportNotFoundError,
  InvalidEncodingError,
  MissingColumnsError,
  RowLimitExceededError,
  UnsupportedFormatError,
} from './import-errors';

/**
 * T5.1 — el catálogo de errores de import es **cerrado** y se mapea al envelope
 * RFC 7807 con el filtro que ya existe, sin un solo `HttpException` ad-hoc.
 *
 * Hay dos cosas que este spec cuida y que se rompen fácil: que el `title` de
 * 413/415 no vuelva al genérico `'Error'`, y que ningún `detail` le cuente al
 * mundo cómo se llaman las tablas y columnas de la base.
 */
const INSTANCE = '/v1/admin/imports';

describe('errores dsm:import/* → RFC 7807', () => {
  it.each([
    [new UnsupportedFormatError(), 415, 'dsm:import/unsupported-format', 'Unsupported Media Type'],
    [new FileTooLargeError(4_194_304), 413, 'dsm:import/file-too-large', 'Payload Too Large'],
    [new MissingColumnsError(['precio']), 422, 'dsm:import/missing-columns', 'Unprocessable Entity'],
    [new RowLimitExceededError(5_000), 422, 'dsm:import/row-limit-exceeded', 'Unprocessable Entity'],
    [new InvalidEncodingError(), 422, 'dsm:import/invalid-encoding', 'Unprocessable Entity'],
    [new ImportAlreadyRunningError(), 409, 'dsm:import/already-running', 'Conflict'],
    [new ImportNotFoundError(), 404, 'dsm:import/not-found', 'Not Found'],
  ])('%s produce status/type/title del contrato', (error, status, type, title) => {
    const problem = mapErrorToProblem(error, INSTANCE);
    expect(problem.status).toBe(status);
    expect(problem.type).toBe(type);
    expect(problem.title).toBe(title);
    expect(problem.instance).toBe(INSTANCE);
    expect(problem.detail).toBeTruthy();
  });

  it('los 7 type son distintos entre sí (catálogo cerrado, sin colisiones)', () => {
    const types = [
      new UnsupportedFormatError(),
      new FileTooLargeError(1),
      new MissingColumnsError(['precio']),
      new RowLimitExceededError(1),
      new InvalidEncodingError(),
      new ImportAlreadyRunningError(),
      new ImportNotFoundError(),
    ].map((e) => mapErrorToProblem(e, INSTANCE).type);

    expect(new Set(types).size).toBe(7);
    expect(types.every((t) => t.startsWith('dsm:import/'))).toBe(true);
  });

  it('413 y 415 dejaron de caer al title genérico', () => {
    // Antes de T5.1, TITLES no los tenía y el cliente recibía 'Error'.
    expect(mapErrorToProblem(new FileTooLargeError(1), INSTANCE).title).not.toBe(
      'Error',
    );
    expect(
      mapErrorToProblem(new UnsupportedFormatError(), INSTANCE).title,
    ).not.toBe('Error');
  });

  it('MissingColumnsError enumera las columnas del ARCHIVO, no las de la base', () => {
    const problem = mapErrorToProblem(
      new MissingColumnsError(['precio']),
      INSTANCE,
    );

    expect(problem.errors).toEqual([
      { field: 'precio', message: 'columna requerida ausente en el encabezado' },
    ]);
    expect(problem.detail).toContain('precio');
    // Que el error hable el idioma del archivo del dueño no es cosmética: es lo
    // que le permite arreglar la planilla, y evita filtrar el esquema interno.
    expect(problem.detail).not.toContain('price_ars_cents');
    expect(problem.detail).not.toContain('products');
  });

  it('MissingColumnsError con varias faltantes las lista todas', () => {
    const problem = mapErrorToProblem(
      new MissingColumnsError(['sku', 'precio', 'stock']),
      INSTANCE,
    );
    expect(problem.errors?.map((e) => e.field)).toEqual([
      'sku',
      'precio',
      'stock',
    ]);
  });

  it('ningún detail del catálogo menciona tablas, columnas ni el ORM', () => {
    const prohibido = /products|categories|import_jobs|price_ars_cents|prisma|postgres/i;
    const errores = [
      new UnsupportedFormatError(),
      new FileTooLargeError(4_194_304),
      new MissingColumnsError(['precio']),
      new RowLimitExceededError(5_000),
      new InvalidEncodingError(),
      new ImportAlreadyRunningError(),
      new ImportNotFoundError(),
    ];

    for (const error of errores) {
      expect(mapErrorToProblem(error, INSTANCE).detail).not.toMatch(prohibido);
    }
  });

  it('los mensajes que dependen de un límite dicen el número', () => {
    // Un consumidor que no sabe el tope no puede decidir si partir el archivo.
    expect(mapErrorToProblem(new RowLimitExceededError(5_000), INSTANCE).detail).toContain(
      '5000',
    );
    expect(
      mapErrorToProblem(new FileTooLargeError(4_194_304), INSTANCE).detail,
    ).toContain('4');
  });

  it('el 415 explica qué formatos sí se aceptan', () => {
    const detail = mapErrorToProblem(new UnsupportedFormatError(), INSTANCE).detail;
    expect(detail).toMatch(/CSV/i);
    expect(detail).toMatch(/xlsx|Excel/i);
  });

  it('el 422 de encoding le dice al dueño cómo guardar el archivo', () => {
    expect(
      mapErrorToProblem(new InvalidEncodingError(), INSTANCE).detail,
    ).toMatch(/UTF-8/i);
  });
});
