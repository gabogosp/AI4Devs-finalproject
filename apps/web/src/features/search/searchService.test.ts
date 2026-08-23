import { afterEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { AppErrorException } from '@/lib/http/errors';
import { CATALOG_TAG } from '@/features/storefront/categoriesStorefrontService';
import { SEARCH_REVALIDATE_SECONDS, searchService } from './searchService';

const API = 'http://localhost:3000';

/**
 * Los cuatro ejemplos son **copia literal** de `openapi.yaml` (`conResultados`,
 * `bajaConfianza`, `sinResultados`, `degradado`). Es a propósito: si el contrato
 * cambia de forma, estos objetos dejan de parsear contra el schema Zod generado
 * y el test se pone rojo — que es el aviso que queremos. Un fixture inventado
 * seguiría verde mientras la pantalla real se rompe.
 */
const conResultados = {
  results: [
    {
      slug: 'taco-fischer-sx-8mm-x50',
      name: 'Taco Fischer SX 8mm (x50)',
      price_ars_cents: 320000,
      in_stock: true,
      image_url: null,
      score: 0.89,
    },
    {
      slug: 'mecha-widia-8mm',
      name: 'Mecha widia 8mm para hormigón',
      price_ars_cents: 540000,
      in_stock: true,
      image_url: null,
      score: 0.81,
    },
  ],
  confidence: 'high',
  interpreted_as: 'Buscamos en: Fijaciones, Mechas y brocas',
  degraded: false,
  fallback: null,
};

const bajaConfianza = {
  results: [
    {
      slug: 'cinta-aisladora-negra',
      name: 'Cinta aisladora negra',
      price_ars_cents: 45000,
      in_stock: true,
      image_url: null,
      score: 0.41,
    },
  ],
  confidence: 'low',
  interpreted_as: 'Buscamos en: Electricidad',
  degraded: false,
  fallback: {
    suggested_categories: [
      { slug: 'electricidad', name: 'Electricidad' },
      { slug: 'ferreteria', name: 'Ferretería' },
    ],
  },
};

const sinResultados = {
  results: [],
  confidence: 'none',
  interpreted_as: null,
  degraded: false,
  fallback: {
    suggested_categories: [
      { slug: 'ferreteria', name: 'Ferretería' },
      { slug: 'refrigeracion', name: 'Refrigeración' },
    ],
  },
};

const degradado = {
  results: [
    {
      slug: 'taladro-percutor-650w',
      name: 'Taladro percutor 650W',
      price_ars_cents: 4500000,
      in_stock: false,
      image_url: null,
      score: 1,
    },
  ],
  confidence: 'high',
  interpreted_as: 'Buscamos en: Ferretería',
  degraded: true,
  fallback: null,
};

/** Captura las opciones del fetch sin depender de MSW (para asertar la caché). */
function stubFetch(body: unknown) {
  const fetchSpy = vi.fn().mockImplementation(
    async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetchSpy);
  return fetchSpy;
}

afterEach(() => vi.unstubAllGlobals());

describe('searchService.search — los cuatro ejemplos del contrato', () => {
  it('parsea la respuesta de confianza alta conservando el orden del ranking', async () => {
    server.use(http.get(`${API}/v1/search`, () => HttpResponse.json(conResultados)));

    const res = await searchService.search('taco para pared de hormigón');

    expect(res.confidence).toBe('high');
    expect(res.degraded).toBe(false);
    expect(res.fallback).toBeNull();
    // El orden es la respuesta del ranking: reordenar acá tiraría el trabajo del
    // backend, así que se afirma la secuencia y no sólo la pertenencia.
    expect(res.results.map((r) => r.slug)).toEqual([
      'taco-fischer-sx-8mm-x50',
      'mecha-widia-8mm',
    ]);
  });

  it('parsea la baja confianza SIN esconder los resultados y con su fallback', async () => {
    server.use(http.get(`${API}/v1/search`, () => HttpResponse.json(bajaConfianza)));

    const res = await searchService.search('algo para aislar cables');

    expect(res.confidence).toBe('low');
    // Lo que importa de este caso: `low` NO significa lista vacía. El servicio
    // devuelve las dos cosas y deja que la UI avise; filtrarlas acá sería
    // decidir por la pantalla y romper AC-3.
    expect(res.results).toHaveLength(1);
    expect(res.fallback?.suggested_categories.map((c) => c.slug)).toEqual([
      'electricidad',
      'ferreteria',
    ]);
  });

  it('parsea el cero resultados trayendo el fallback no vacío (AC-3)', async () => {
    server.use(http.get(`${API}/v1/search`, () => HttpResponse.json(sinResultados)));

    const res = await searchService.search('algo que no existe en la tienda');

    expect(res.results).toEqual([]);
    expect(res.confidence).toBe('none');
    expect(res.fallback?.suggested_categories.length).toBeGreaterThan(0);
  });

  it('parsea la respuesta degradada como éxito, no como error (AC-4)', async () => {
    server.use(http.get(`${API}/v1/search`, () => HttpResponse.json(degradado)));

    // El punto del caso: `degraded: true` viaja con 200 y NO lanza. Si el
    // servicio lo tratara como fallo, el cliente vería un error donde el backend
    // le está dando resultados por full-text.
    const res = await searchService.search('taladro');

    expect(res.degraded).toBe(true);
    expect(res.results[0].in_stock).toBe(false);
  });
});

describe('searchService.search — request y caché', () => {
  it('manda la consulta tal cual en `q` y omite `limit` cuando no se pide', async () => {
    const fetchSpy = stubFetch(conResultados);

    await searchService.search('taco  fischer');

    const url = new URL(fetchSpy.mock.calls[0][0] as string);
    expect(url.pathname).toBe('/v1/search');
    // Sin normalizar: normalizar es trabajo del guard (T1.1) y del servidor.
    expect(url.searchParams.get('q')).toBe('taco  fischer');
    expect(url.searchParams.has('limit')).toBe(false);
  });

  it('manda `limit` cuando se lo pasan', async () => {
    const fetchSpy = stubFetch(conResultados);

    await searchService.search('taco', 5);

    const url = new URL(fetchSpy.mock.calls[0][0] as string);
    expect(url.searchParams.get('limit')).toBe('5');
  });

  it('tagea con el CATALOG_TAG importado, para que la invalidación del panel lo barra', async () => {
    const fetchSpy = stubFetch(conResultados);

    await searchService.search('taco fischer');

    const init = fetchSpy.mock.calls[0][1] as {
      next: { revalidate: number; tags: string[] };
    };
    expect(init.next.revalidate).toBe(SEARCH_REVALIDATE_SECONDS);
    // Contra la constante importada y no contra el string 'catalog': si mañana
    // cambia el literal, este test tiene que seguir verde — lo que se afirma es
    // que los dos servicios comparten el MISMO tag, no cuál es.
    expect(init.next.tags).toEqual([CATALOG_TAG]);
  });
});

describe('searchService.search — errores', () => {
  it('propaga un 429 como AppErrorException con kind rateLimited y su espera', async () => {
    server.use(
      http.get(`${API}/v1/search`, () =>
        HttpResponse.json(
          {
            type: 'dsm:search/rate-limited',
            title: 'Demasiadas búsquedas',
            status: 429,
            detail: 'Esperá un momento',
          },
          { status: 429, headers: { 'Retry-After': '30' } },
        ),
      ),
    );

    // `rejects.toThrow` no alcanza: pasaría con cualquier excepción. Lo que
    // importa es el `kind`, porque de él depende que la página muestre el copy
    // de espera en vez de un 500 (y que el crawler no vea un 5xx).
    const err = await searchService.search('taco').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AppErrorException);
    expect((err as AppErrorException).appError).toMatchObject({
      kind: 'rateLimited',
      retryAfterSeconds: 30,
    });
  });

  it('propaga un 422 como validation (consulta corta o larga)', async () => {
    server.use(
      http.get(`${API}/v1/search`, () =>
        HttpResponse.json(
          {
            type: 'dsm:search/query-too-short',
            title: 'Consulta muy corta',
            status: 422,
            detail: 'Escribí un poco más',
          },
          { status: 422 },
        ),
      ),
    );

    const err = await searchService.search('a').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AppErrorException);
    expect((err as AppErrorException).appError).toMatchObject({
      kind: 'validation',
      problemType: 'dsm:search/query-too-short',
    });
  });

  it('propaga un 503 como server', async () => {
    server.use(
      http.get(`${API}/v1/search`, () =>
        HttpResponse.json(
          { type: 'dsm:search/unavailable', title: 'No disponible', status: 503 },
          { status: 503 },
        ),
      ),
    );

    const err = await searchService.search('taco').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AppErrorException);
    expect((err as AppErrorException).appError.kind).toBe('server');
  });

  it('falla si el cuerpo no respeta el contrato, en vez de devolver basura tipada', async () => {
    server.use(
      http.get(`${API}/v1/search`, () =>
        // `confidence` fuera del enum: sin validación en el borde esto llegaría
        // a la UI como un `confidence` que ningún branch maneja y la pantalla
        // renderizaría el estado equivocado en silencio.
        HttpResponse.json({ ...conResultados, confidence: 'medium' }),
      ),
    );

    await expect(searchService.search('taco')).rejects.toThrow();
  });
});
