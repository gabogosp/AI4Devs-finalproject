import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppErrorException } from '@/lib/http/errors';

/**
 * La ruta de categoría: éxito renderiza server-side, y un 404 del contrato se
 * traduce a `notFound()` de Next — que es lo que produce un status HTTP 404
 * REAL en lugar de un 200 vacío (AC-9). El status en sí lo prueba T7.3 contra
 * el servidor; acá se prueba que la ruta **decide** bien.
 */
const notFoundSignal = new Error('NEXT_NOT_FOUND');
const notFound = vi.fn(() => {
  throw notFoundSignal;
});
vi.mock('next/navigation', () => ({ notFound: () => notFound() }));

/**
 * Doble con estado plano y no un spy: un `vi.fn()` que devuelve una promesa
 * rechazada la retiene en `mock.results` y vitest la reporta como unhandled
 * cuando `render()` flushea microtasks, aunque el componente la maneje.
 */
let categoryResult:
  | { ok: true; value: { slug: string; name: string; parent: unknown; children: unknown[] } }
  | { ok: false; error: unknown };
let productsResult: { data: unknown[]; pagination: { limit: number; offset: number; total: number } };
const listProductsCalls: number[] = [];

vi.mock('@/features/storefront/categoriesStorefrontService', () => ({
  categoriesStorefrontService: {
    getBySlug: async () => {
      if (!categoryResult.ok) throw categoryResult.error;
      return categoryResult.value;
    },
    listProducts: async (_slug: string, page: number) => {
      listProductsCalls.push(page);
      return productsResult;
    },
  },
}));

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

const { default: CategoryPage } = await import(
  '@/../app/(storefront)/categorias/[slug]/page'
);

const params = Promise.resolve({ slug: 'climatizacion' });

beforeEach(() => {
  notFound.mockClear();
  categoryResult = {
    ok: true,
    value: { slug: 'climatizacion', name: 'Climatización', parent: null, children: [] },
  };
  productsResult = { data: [], pagination: { limit: 20, offset: 0, total: 0 } };
  listProductsCalls.length = 0;
});

describe('CategoryPage (AC-9, AC-10)', () => {
  it('renderiza el nombre de la categoría como h1 único', async () => {
    render(await CategoryPage({ params }));

    expect(
      screen.getByRole('heading', { level: 1, name: 'Climatización' }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('un 404 del contrato ejecuta notFound() → status 404 real, no un 200 vacío', async () => {
    categoryResult = {
      ok: false,
      error: new AppErrorException({ kind: 'notFound', message: 'No existe' }),
    };

    await expect(CategoryPage({ params })).rejects.toBe(notFoundSignal);
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it('un error que NO es 404 se propaga al boundary en vez de tragarse', async () => {
    const boom = new AppErrorException({ kind: 'server', message: 'backend caído' });
    categoryResult = { ok: false, error: boom };

    await expect(CategoryPage({ params })).rejects.toBe(boom);
    // Traducir un 5xx a 404 escondería una caída del backend detrás de una
    // página "no encontrado" perfectamente indexable.
    expect(notFound).not.toHaveBeenCalled();
  });

  it('renderiza una card por producto de la página (AC-3)', async () => {
    productsResult = {
      data: [gridItem(), gridItem({ slug: 'compresor-2hp', name: 'Compresor 2HP' })],
      pagination: { limit: 20, offset: 0, total: 2 },
    };

    render(await CategoryPage({ params }));

    expect(screen.getByRole('link', { name: /Compresor 1HP/ })).toHaveAttribute(
      'href',
      '/productos/compresor-1hp',
    );
    expect(screen.getByRole('link', { name: /Compresor 2HP/ })).toBeInTheDocument();
  });

  it('pide la página que dice searchParams (AC-3)', async () => {
    productsResult = {
      data: [gridItem()],
      pagination: { limit: 20, offset: 20, total: 25 },
    };

    render(
      await CategoryPage({ params, searchParams: Promise.resolve({ page: '2' }) }),
    );

    expect(listProductsCalls).toEqual([2]);
  });

  it('una page malformada se normaliza a 1 y responde 200, no 404', async () => {
    productsResult = { data: [gridItem()], pagination: { limit: 20, offset: 0, total: 1 } };

    render(
      await CategoryPage({ params, searchParams: Promise.resolve({ page: 'abc' }) }),
    );

    expect(listProductsCalls).toEqual([1]);
    expect(notFound).not.toHaveBeenCalled();
  });

  it('una página fuera de rango ejecuta notFound() — nada de páginas fantasma indexables', async () => {
    productsResult = { data: [], pagination: { limit: 20, offset: 1960, total: 25 } };

    await expect(
      CategoryPage({ params, searchParams: Promise.resolve({ page: '99' }) }),
    ).rejects.toBe(notFoundSignal);
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it('vacío en la página 1 NO es 404: la categoría existe (AC-6)', async () => {
    productsResult = { data: [], pagination: { limit: 20, offset: 0, total: 0 } };

    render(await CategoryPage({ params }));

    expect(notFound).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('categoría vacía: estado accionable con salida, y sin grilla ni paginación (AC-6)', async () => {
    categoryResult = {
      ok: true,
      value: {
        slug: 'climatizacion',
        name: 'Climatización',
        parent: null,
        children: [{ slug: 'compresores', name: 'Compresores' }],
      },
    };
    productsResult = { data: [], pagination: { limit: 20, offset: 0, total: 0 } };

    render(await CategoryPage({ params }));

    expect(
      screen.getByText(/Todavía no hay productos publicados/),
    ).toBeInTheDocument();
    // Un vacío mudo dejaría al cliente sin camino: tiene que poder seguir
    // navegando por los subrubros o volver a los rubros.
    expect(screen.getByRole('link', { name: 'Compresores' })).toHaveAttribute(
      'href',
      '/categorias/compresores',
    );
    expect(screen.getByRole('link', { name: 'Ver todos los rubros' })).toHaveAttribute(
      'href',
      '/',
    );
    expect(screen.queryByRole('navigation', { name: 'Paginación' })).not.toBeInTheDocument();
  });

  it('un rubro vacío SIN subrubros igual ofrece salida', async () => {
    productsResult = { data: [], pagination: { limit: 20, offset: 0, total: 0 } };

    render(await CategoryPage({ params }));

    expect(screen.getByRole('link', { name: 'Ver todos los rubros' })).toBeInTheDocument();
  });
});
