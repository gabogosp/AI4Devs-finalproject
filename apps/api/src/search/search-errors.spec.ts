import { readFileSync } from 'node:fs';
import { ArgumentsHost, HttpException } from '@nestjs/common';
import { HttpProblemFilter } from '../common/filters/http-problem.filter';
import {
  QueryTooLongError,
  QueryTooShortError,
  SearchUnavailableError,
} from './search-errors';

/**
 * T3.4 — los errores de dominio de la búsqueda, pasados por el filtro **real**.
 *
 * El test que da sentido al archivo es el último, y es una **ausencia**: no existe un error de
 * dominio para el fallo del proveedor de IA. Si alguien lo agrega, la degradación de AC-4 se
 * convirtió en un 5xx y la tienda «se cae» porque un tercero no contestó.
 */
describe('Errores de dominio de la búsqueda (search-errors)', () => {
  /** `ArgumentsHost` mínimo: el filtro sólo necesita `response` y `request`. */
  const hostFalso = () => {
    const headers: Record<string, unknown> = {};
    const capturado: { status?: number; body?: Record<string, unknown> } = {};
    const response = {
      status(code: number) {
        capturado.status = code;
        return this;
      },
      // El filtro real hace `res.status(...).type(...).json(...)`: el doble tiene que ofrecer
      // la cadena completa de Express o falla con «type is not a function», que no dice nada
      // sobre el problema real.
      type() {
        return this;
      },
      json(body: Record<string, unknown>) {
        capturado.body = body;
        return this;
      },
      setHeader(k: string, v: unknown) {
        headers[k] = v;
      },
      getHeader: (k: string) => headers[k],
    };
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({ url: '/v1/search', headers: {} }),
      }),
    } as unknown as ArgumentsHost;
    return { host, capturado, headers };
  };

  const pasarPorElFiltro = (error: unknown) => {
    const { host, capturado } = hostFalso();
    new HttpProblemFilter().catch(error as HttpException, host);
    return capturado;
  };

  it('QueryTooShortError ⇒ 422 dsm:search/query-too-short con min_length', () => {
    const { status, body } = pasarPorElFiltro(new QueryTooShortError(2));

    expect(status).toBe(422);
    expect(body).toMatchObject({
      type: 'dsm:search/query-too-short',
      status: 422,
      min_length: 2,
    });
  });

  it('QueryTooLongError ⇒ 422 dsm:search/query-too-long con max_length', () => {
    const { status, body } = pasarPorElFiltro(new QueryTooLongError(200));

    expect(status).toBe(422);
    expect(body).toMatchObject({
      type: 'dsm:search/query-too-long',
      status: 422,
      max_length: 200,
    });
  });

  it('SearchUnavailableError ⇒ 503 dsm:search/unavailable', () => {
    const { status, body } = pasarPorElFiltro(new SearchUnavailableError());

    expect(status).toBe(503);
    expect(body).toMatchObject({ type: 'dsm:search/unavailable', status: 503 });
    // El mensaje le ofrece una salida al cliente en vez de dejarlo en un error seco.
    expect(String((body as { detail: string }).detail)).toContain('categorías');
  });

  it('ningún cuerpo lleva stack ni detalle interno', () => {
    for (const error of [
      new QueryTooShortError(2),
      new QueryTooLongError(200),
      new SearchUnavailableError(),
    ]) {
      const { body } = pasarPorElFiltro(error);
      const serializado = JSON.stringify(body);

      expect(serializado).not.toContain('at ');
      expect(serializado).not.toContain('node_modules');
      expect(body).not.toHaveProperty('stack');
    }
  });

  it('NO EXISTE un error de dominio para el fallo del proveedor de IA', () => {
    // La ausencia es la decisión (AC-4). Si Gemini no contesta, la respuesta es un 200 con
    // `degraded: true`: el catálogo sigue siendo buscable por texto y la tienda sigue vendiendo.
    // Un 5xx haría que un problema de un tercero se vea como una caída nuestra, y el cliente
    // que ve un error no reintenta — se va.
    const fuente = readFileSync('src/search/search-errors.ts', 'utf8');

    expect(fuente).not.toMatch(/ProviderUnavailable|GeminiError|EmbeddingError/);
    // Y el 503 que sí existe es explícitamente para la base, no para el proveedor.
    expect(fuente).toContain('SearchUnavailableError');
  });

  it('los errores viven en el módulo y no contaminan el catálogo de `catalog`', () => {
    // `common/errors/domain-errors.ts` es el namespace `dsm:catalog/*` y no se toca: cada
    // módulo declara los suyos, como hizo `auth-errors.ts`.
    const fuente = readFileSync('src/search/search-errors.ts', 'utf8');
    expect(fuente).toContain("'dsm:search/");
    expect(fuente).not.toContain("'dsm:catalog/");
  });
});
