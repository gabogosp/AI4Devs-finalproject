import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const getTree = vi.fn();
const captureError = vi.fn();

vi.mock('./categoriesStorefrontService', () => ({
  categoriesStorefrontService: { getTree: () => getTree() },
}));
vi.mock('@/lib/observability/sentry', () => ({
  captureError: (e: unknown) => captureError(e),
}));

const { CategoryNav } = await import('./CategoryNav');

const tree = [
  { slug: 'climatizacion', name: 'Climatización', children: [] },
  { slug: 'refrigeracion', name: 'Refrigeración', children: [] },
];

beforeEach(() => {
  getTree.mockReset();
  captureError.mockReset();
});

describe('CategoryNav (AC-1)', () => {
  it('renderiza un link indexable por rubro', async () => {
    getTree.mockResolvedValue(tree);

    render(await CategoryNav());

    const nav = screen.getByRole('navigation', { name: 'Rubros' });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Climatización' })).toHaveAttribute(
      'href',
      '/categorias/climatizacion',
    );
    expect(screen.getByRole('link', { name: 'Refrigeración' })).toHaveAttribute(
      'href',
      '/categorias/refrigeracion',
    );
  });

  it('si el árbol falla NO lanza: se pierde la nav, no el sitio', async () => {
    getTree.mockRejectedValue(new Error('backend caído'));

    // Sin el catch, un 5xx del árbol tumbaría TODA página del storefront,
    // incluida la ficha de producto, que no depende de este fetch.
    const ui = await CategoryNav();

    expect(ui).toBeNull();
    expect(captureError).toHaveBeenCalledTimes(1);
  });

  it('con el árbol vacío no renderiza una barra hueca', async () => {
    getTree.mockResolvedValue([]);

    expect(await CategoryNav()).toBeNull();
    expect(captureError).not.toHaveBeenCalled();
  });
});
