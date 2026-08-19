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

vi.mock('@/features/storefront/categoriesStorefrontService', () => ({
  categoriesStorefrontService: {
    getBySlug: async () => {
      if (!categoryResult.ok) throw categoryResult.error;
      return categoryResult.value;
    },
  },
}));

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
});
