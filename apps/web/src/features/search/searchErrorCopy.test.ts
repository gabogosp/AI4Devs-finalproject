import { describe, expect, it } from 'vitest';
import type { AppError } from '@/lib/http/errors';
import {
  COPY_CONSULTA_CORTA,
  COPY_CONSULTA_LARGA,
  COPY_GENERICO,
  COPY_NO_DISPONIBLE,
  COPY_RED,
  copyRateLimited,
  searchErrorCopy,
} from './searchErrorCopy';

/** El `detail` que el backend manda y que NUNCA tiene que llegar a pantalla. */
const DETAIL_CRUDO = 'query length 1 below SEARCH_MIN_LENGTH=2';

function validation(problemType: string): AppError {
  return {
    kind: 'validation',
    message: DETAIL_CRUDO,
    fieldErrors: [],
    problemType,
  };
}

describe('searchErrorCopy — cada rechazo tiene su mensaje', () => {
  it('distingue la consulta corta de la larga por el `type`, no por el texto', () => {
    // Los dos errores traen EL MISMO `message`: si la función ramificara por la
    // forma o por el contenido del detail, este test no podría distinguirlos.
    expect(searchErrorCopy(validation('dsm:search/query-too-short'))).toBe(
      COPY_CONSULTA_CORTA,
    );
    expect(searchErrorCopy(validation('dsm:search/query-too-long'))).toBe(
      COPY_CONSULTA_LARGA,
    );
  });

  it('el 429 explica la espera (AC-10)', () => {
    const msg = searchErrorCopy({
      kind: 'rateLimited',
      message: DETAIL_CRUDO,
      retryAfterSeconds: 30,
    });
    expect(msg).toContain('30 segundos');
  });

  it('el 503 ofrece la salida por rubros en vez de dejar al cliente sin nada', () => {
    expect(searchErrorCopy({ kind: 'server', message: DETAIL_CRUDO })).toBe(
      COPY_NO_DISPONIBLE,
    );
    expect(COPY_NO_DISPONIBLE).toContain('rubros');
  });

  it('el fallo de red se distingue del fallo del servidor', () => {
    expect(searchErrorCopy({ kind: 'network', message: 'fetch failed' })).toBe(COPY_RED);
    // No son el mismo mensaje: uno pide revisar la conexión propia y el otro
    // dice que el problema es nuestro. Confundirlos manda al cliente a
    // reiniciar el módem por una caída de nuestro proveedor.
    expect(COPY_RED).not.toBe(COPY_NO_DISPONIBLE);
  });

  it('los cinco mensajes son distintos entre sí', () => {
    const mensajes = [
      COPY_CONSULTA_CORTA,
      COPY_CONSULTA_LARGA,
      copyRateLimited(30),
      COPY_NO_DISPONIBLE,
      COPY_RED,
    ];
    expect(new Set(mensajes).size).toBe(5);
  });

  it('un 422 de otro `type` no acusa a la consulta del cliente', () => {
    // Un query param fuera de la whitelist es un 422, pero no tiene nada que ver
    // con lo que la persona escribió: decirle «escribí más caracteres» la manda
    // a arreglar algo que no está roto.
    expect(searchErrorCopy(validation('dsm:catalog/validation'))).toBe(COPY_GENERICO);
  });
});

describe('searchErrorCopy — el detail del servidor no llega a pantalla', () => {
  const errores: AppError[] = [
    validation('dsm:search/query-too-short'),
    validation('dsm:search/query-too-long'),
    { kind: 'rateLimited', message: DETAIL_CRUDO, retryAfterSeconds: 30 },
    { kind: 'server', message: DETAIL_CRUDO },
    { kind: 'network', message: DETAIL_CRUDO },
    { kind: 'notFound', message: DETAIL_CRUDO },
  ];

  it.each(errores.map((e) => [e.kind, e] as const))(
    'ningún fragmento del detail crudo aparece en el copy de %s',
    (_kind, error) => {
      const msg = searchErrorCopy(error);
      expect(msg).not.toContain(DETAIL_CRUDO);
      // El nombre de la variable de entorno es el fragmento que más duele
      // filtrar: le dice a cualquiera cómo se llama nuestra configuración.
      expect(msg).not.toContain('SEARCH_MIN_LENGTH');
      expect(msg.length).toBeGreaterThan(0);
    },
  );
});

describe('copyRateLimited', () => {
  it('no inventa una espera cuando el backend no mandó Retry-After', () => {
    const generico = copyRateLimited(undefined);
    // Prometer «30 segundos» sin saberlo hace que el cliente vuelva a los 30 y
    // se coma otro rechazo: peor que no prometer nada.
    expect(generico).not.toMatch(/\d/);
    expect(copyRateLimited(0)).toBe(generico);
    expect(copyRateLimited(-5)).toBe(generico);
  });

  it('dice segundos abajo del minuto y minutos arriba, redondeando para arriba', () => {
    expect(copyRateLimited(45)).toContain('45 segundos');
    expect(copyRateLimited(60)).toContain('1 minuto');
    // Redondear para abajo mandaría al cliente a reintentar 30 s antes de tiempo.
    expect(copyRateLimited(90)).toContain('2 minutos');
  });

  it('concuerda el singular y el plural', () => {
    expect(copyRateLimited(60)).not.toContain('1 minutos');
    expect(copyRateLimited(120)).toContain('2 minutos');
  });

  it('ningún mensaje culpa al cliente', () => {
    const acusaciones = /inválid|incorrect|error tuyo|mal escrit/i;
    for (const msg of [
      COPY_CONSULTA_CORTA,
      COPY_CONSULTA_LARGA,
      COPY_NO_DISPONIBLE,
      COPY_RED,
      COPY_GENERICO,
      copyRateLimited(30),
      copyRateLimited(undefined),
    ]) {
      expect(msg).not.toMatch(acusaciones);
    }
  });
});
