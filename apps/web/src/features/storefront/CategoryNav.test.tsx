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
    // Función async que lanza: `mockRejectedValue` deja en `mock.results` una
    // promesa rechazada que vitest reporta como unhandled apenas alguien
    // flushee microtasks (p. ej. un `render()`), aunque el componente la
    // maneje. Hoy este caso no renderiza, así que pasaría igual — se usa la
    // forma robusta para que agregar un `render()` mañana no rompa el test
    // por una razón que no tiene nada que ver con el componente.
    getTree.mockImplementation(async () => {
      throw new Error('backend caído');
    });

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

  it('con más de 8 rubros, el resto queda detrás de UN solo "Más rubros" — nunca fuera del DOM', async () => {
    // Encontrado real corrigiendo TC-731: sin tope, cada rubro extra es un
    // `Tab` más en TODA página pública. 10 rubros fuerza el caso "hay resto".
    const muchos = Array.from({ length: 10 }, (_, i) => ({
      slug: `rubro-${i}`,
      name: `Rubro ${i}`,
      children: [],
    }));
    getTree.mockResolvedValue(muchos);

    render(await CategoryNav());

    // Los primeros 8 son links directos, sin abrir nada.
    for (let i = 0; i < 8; i += 1) {
      expect(screen.getByRole('link', { name: `Rubro ${i}` })).toBeInTheDocument();
    }

    // Los 2 restantes siguen en el DOM (SEO — AC-1), no se pierden.
    expect(screen.getByRole('link', { name: 'Rubro 8' })).toHaveAttribute(
      'href',
      '/categorias/rubro-8',
    );
    expect(screen.getByRole('link', { name: 'Rubro 9' })).toBeInTheDocument();

    // Un único focusable adicional cubre TODO el resto, no uno por rubro.
    expect(screen.getByText('Más rubros (2)')).toBeInTheDocument();
  });
});
