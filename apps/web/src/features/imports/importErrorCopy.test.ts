import { describe, expect, it } from 'vitest';
import type { AppError } from '@/lib/http/errors';
import {
  copyDeFalloGlobal,
  copyDeFila,
  copyDeRechazo,
  SIN_IMPACTO,
} from './importErrorCopy';

/** Los 7 `type` del catálogo cerrado de la superficie de import. */
const TIPOS_ARCHIVO = [
  'dsm:import/file-too-large',
  'dsm:import/unsupported-format',
  'dsm:import/missing-columns',
  'dsm:import/row-limit-exceeded',
  'dsm:import/invalid-encoding',
  'dsm:import/already-running',
  'dsm:import/not-found',
];

/** Los 10 `error_code` de fila del catálogo cerrado. */
const CODIGOS_FILA = [
  'missing_required',
  'invalid_sku',
  'invalid_text',
  'invalid_price',
  'invalid_stock',
  'invalid_category',
  'invalid_image_url',
  'duplicate_sku_in_file',
  'slug_conflict',
  'write_failed',
];

function validation(problemType: string, campos: string[] = []): AppError {
  return {
    kind: 'validation',
    message: 'detalle del servidor',
    problemType,
    fieldErrors: campos.map((field) => ({ field, message: 'requerida' })),
  };
}

describe('importErrorCopy — nivel archivo', () => {
  it.each(TIPOS_ARCHIVO)('%s tiene copy propio y no vacío', (tipo) => {
    const texto = copyDeRechazo(validation(tipo));
    expect(texto.length).toBeGreaterThan(10);
    expect(texto).not.toBe('detalle del servidor');
  });

  it('los 7 mensajes son distintos entre sí', () => {
    const textos = TIPOS_ARCHIVO.map((t) => copyDeRechazo(validation(t)));
    expect(new Set(textos).size).toBe(TIPOS_ARCHIVO.length);
  });

  it('missing-columns ENUMERA las columnas que mandó el servidor', () => {
    const texto = copyDeRechazo(
      validation('dsm:import/missing-columns', ['precio', 'stock']),
    );
    // Los nombres del ARCHIVO, que es lo que el dueño puede arreglar.
    expect(texto).toContain('precio');
    expect(texto).toContain('stock');
  });

  it('un `type` desconocido cae al detail del servidor y nunca a cadena vacía', () => {
    const texto = copyDeRechazo(validation('dsm:import/algo-que-no-existe'));
    expect(texto).toBe('detalle del servidor');
    expect(texto).not.toBe('');
  });

  it('un 404 se resuelve por `kind`, porque el AppError de notFound no trae problemType', () => {
    const texto = copyDeRechazo({
      kind: 'notFound',
      message: 'No se encontró esa importación.',
    });
    // Sin este caso, el 404 caía al `detail` del servidor y se perdía la mitad
    // útil del mensaje: que los trabajos se guardan 90 días.
    expect(texto).toMatch(/no existe|purgó/i);
    expect(texto).toContain('90 días');
  });

  it('el 429 arma el mensaje con el Retry-After', () => {
    expect(
      copyDeRechazo({
        kind: 'rateLimited',
        message: 'demasiadas',
        retryAfterSeconds: 45,
      }),
    ).toContain('45 segundos');

    expect(
      copyDeRechazo({
        kind: 'rateLimited',
        message: 'demasiadas',
        retryAfterSeconds: 600,
      }),
    ).toContain('10 minutos');

    // Sin el header, no se inventa un número.
    const sinHeader = copyDeRechazo({
      kind: 'rateLimited',
      message: 'demasiadas',
    });
    expect(sinHeader).toContain('más tarde');
    expect(sinHeader).not.toMatch(/\d+ (segundos|minutos)/);
  });

  it('ningún copy nombra tablas ni columnas de la base', () => {
    const prohibido = /price_ars_cents|products|import_jobs|category_id|prisma/i;
    for (const tipo of TIPOS_ARCHIVO) {
      expect(copyDeRechazo(validation(tipo))).not.toMatch(prohibido);
    }
    for (const codigo of CODIGOS_FILA) {
      expect(copyDeFila(codigo, 'motivo')).not.toMatch(prohibido);
    }
    expect(SIN_IMPACTO).not.toMatch(prohibido);
  });
});

describe('importErrorCopy — nivel fila', () => {
  it.each(CODIGOS_FILA)('%s tiene copy propio', (codigo) => {
    const texto = copyDeFila(codigo, 'motivo del servidor');
    expect(texto.length).toBeGreaterThan(5);
    expect(texto).not.toBe('motivo del servidor');
  });

  it('los 10 mensajes son distintos entre sí', () => {
    const textos = CODIGOS_FILA.map((c) => copyDeFila(c, 'motivo'));
    expect(new Set(textos).size).toBe(CODIGOS_FILA.length);
  });

  it('un `error_code` desconocido devuelve el motivo del servidor', () => {
    // Es la propiedad que hace que agregar un código en el backend degrade a
    // «menos lindo» en vez de a una celda vacía.
    expect(copyDeFila('codigo_nuevo_del_backend', 'el precio no es válido')).toBe(
      'el precio no es válido',
    );
  });
});

describe('importErrorCopy — fallo global del trabajo', () => {
  it('interrupted dice qué hacer, con la garantía que lo hace seguro', () => {
    const texto = copyDeFalloGlobal('interrupted', 'se reinició');
    expect(texto).toContain('Volvé a subir');
    expect(texto).toContain('SKU');
  });

  it('un error_code global desconocido cae al mensaje del servidor', () => {
    expect(copyDeFalloGlobal('lo-que-sea', 'mensaje del backend')).toBe(
      'mensaje del backend',
    );
  });

  it('sin error_code ni mensaje, un texto honesto en vez de vacío', () => {
    expect(copyDeFalloGlobal(null, null)).toBe('La importación falló.');
  });
});
