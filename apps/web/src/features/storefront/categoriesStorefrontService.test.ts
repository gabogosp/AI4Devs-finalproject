import { afterEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import {
  CATALOG_REVALIDATE_SECONDS,
  CATALOG_TAG,
  PAGE_SIZE,
  categoriesStorefrontService,
} from './categoriesStorefrontService';

const API = 'http://localhost:3000';

const tree = {
  data: [
    {
      slug: 'climatizacion',
      name: 'Climatización',
      children: [{ slug: 'compresores', name: 'Compresores' }],
    },
    { slug: 'refrigeracion', name: 'Refrigeración', children: [] },
  ],
};

function gridItem(over: Record<string, unknown> = {}) {
  return {
    slug: 'compresor-1hp',
    name: 'Compresor 1HP',
    price_ars_cents: 1250000,
    currency: 'ARS',
    image_url: null,
    in_stock: true,
    ...over,
  };
}

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

describe('categoriesStorefrontService.getTree', () => {
  it('devuelve los rubros con sus subrubros, validados contra el contrato', async () => {
    server.use(http.get(`${API}/v1/categories`, () => HttpResponse.json(tree)));

    const rubros = await categoriesStorefrontService.getTree();

    expect(rubros).toHaveLength(2);
    expect(rubros[0].name).toBe('Climatización');
    expect(rubros[0].children[0].slug).toBe('compresores');
  });

  it('rechaza como server una respuesta que no cumple el contrato', async () => {
    server.use(
      http.get(`${API}/v1/categories`, () => HttpResponse.json({ data: [{ name: 'Sin slug' }] })),
    );

    await expect(categoriesStorefrontService.getTree()).rejects.toMatchObject({
      appError: { kind: 'server' },
    });
  });
});

describe('categoriesStorefrontService.getBySlug', () => {
  it('devuelve el detalle con parent no-null (subrubro: alimenta el breadcrumb)', async () => {
    server.use(
      http.get(`${API}/v1/categories/compresores`, () =>
        HttpResponse.json({
          slug: 'compresores',
          name: 'Compresores',
          parent: { slug: 'climatizacion', name: 'Climatización' },
          children: [],
        }),
      ),
    );

    const cat = await categoriesStorefrontService.getBySlug('compresores');

    expect(cat.parent).toEqual({ slug: 'climatizacion', name: 'Climatización' });
  });

  it('devuelve el detalle con parent null (rubro raíz)', async () => {
    server.use(
      http.get(`${API}/v1/categories/climatizacion`, () =>
        HttpResponse.json({
          slug: 'climatizacion',
          name: 'Climatización',
          parent: null,
          children: [{ slug: 'compresores', name: 'Compresores' }],
        }),
      ),
    );

    const cat = await categoriesStorefrontService.getBySlug('climatizacion');

    expect(cat.parent).toBeNull();
    expect(cat.children).toHaveLength(1);
  });

  it('propaga notFound cuando la categoría no existe (AC-9: nunca un 200 vacío)', async () => {
    server.use(
      http.get(`${API}/v1/categories/no-existe`, () =>
        HttpResponse.json(
          { type: 'dsm:catalog/not-found', status: 404, detail: 'No existe' },
          { status: 404 },
        ),
      ),
    );

    await expect(categoriesStorefrontService.getBySlug('no-existe')).rejects.toMatchObject({
      appError: { kind: 'notFound' },
    });
  });
});

describe('categoriesStorefrontService.listProducts', () => {
  it('pide offset 0 en la página 1', async () => {
    const fetchSpy = stubFetch({
      data: [gridItem()],
      pagination: { limit: PAGE_SIZE, offset: 0, total: 25 },
    });

    const page = await categoriesStorefrontService.listProducts('compresores', 1);

    expect(page.pagination.total).toBe(25);
    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url).toContain('limit=20');
    expect(url).toContain('offset=0');
  });

  it('traduce page → offset en la página 2', async () => {
    const fetchSpy = stubFetch({
      data: [gridItem({ slug: 'compresor-2hp' })],
      pagination: { limit: PAGE_SIZE, offset: 20, total: 25 },
    });

    await categoriesStorefrontService.listProducts('compresores', 2);

    expect(String(fetchSpy.mock.calls[0][0])).toContain('offset=20');
  });

  it('nunca pide más de PAGE_SIZE ítems, sin importar la página (AC-7)', async () => {
    const fetchSpy = stubFetch({
      data: [],
      pagination: { limit: PAGE_SIZE, offset: 1980, total: 25 },
    });

    for (const page of [1, 2, 50, 100]) {
      await categoriesStorefrontService.listProducts('compresores', page);
    }

    for (const call of fetchSpy.mock.calls) {
      expect(String(call[0])).not.toMatch(/limit=(2[1-9]|[3-9]\d|\d{3,})/);
    }
  });

  it('rechaza como server un envelope sin pagination', async () => {
    server.use(
      http.get(`${API}/v1/categories/compresores/products`, () =>
        HttpResponse.json({ data: [gridItem()] }),
      ),
    );

    await expect(
      categoriesStorefrontService.listProducts('compresores', 1),
    ).rejects.toMatchObject({ appError: { kind: 'server' } });
  });
});

describe('política de caché (design.md D2)', () => {
  it.each([
    ['getTree', () => categoriesStorefrontService.getTree(), tree],
    [
      'getBySlug',
      () => categoriesStorefrontService.getBySlug('climatizacion'),
      { slug: 'climatizacion', name: 'Climatización', parent: null, children: [] },
    ],
    [
      'listProducts',
      () => categoriesStorefrontService.listProducts('climatizacion', 1),
      { data: [], pagination: { limit: 20, offset: 0, total: 0 } },
    ],
  ])('%s etiqueta el fetch con el tag catalog y el safety-net de 1h', async (_name, call, body) => {
    const fetchSpy = stubFetch(body);

    await call();

    expect(fetchSpy.mock.calls[0][1].next).toEqual({
      revalidate: CATALOG_REVALIDATE_SECONDS,
      tags: [CATALOG_TAG],
    });
  });

  it('CATALOG_TAG es el literal que la Server Action de invalidación importa', () => {
    expect(CATALOG_TAG).toBe('catalog');
    expect(CATALOG_REVALIDATE_SECONDS).toBe(3600);
    expect(PAGE_SIZE).toBe(20);
  });
});
