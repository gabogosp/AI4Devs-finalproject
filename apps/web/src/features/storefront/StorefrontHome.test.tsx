import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const tree = [
  {
    slug: 'climatizacion',
    name: 'Climatización',
    children: [
      { slug: 'compresores', name: 'Compresores' },
      { slug: 'split', name: 'Equipos split' },
    ],
  },
  { slug: 'ferreteria', name: 'Ferretería', children: [] },
];

/**
 * El doble se controla con estado plano, NO con `vi.fn().mockRejectedValue`.
 * Un spy guarda en `mock.results` la promesa rechazada que devuelve, y vitest
 * la reporta como unhandled apenas alguien flushea microtasks — aunque el
 * componente sí le adjunte el `catch`. Verificado aislando el caso: el
 * componente no propaga; el rojo lo producía el harness, no el código.
 */
let treeResult: { ok: true; value: typeof tree } | { ok: false } = { ok: true, value: tree };

vi.mock('@/features/storefront/categoriesStorefrontService', () => ({
  categoriesStorefrontService: {
    getTree: async () => {
      if (!treeResult.ok) throw new Error('backend caído');
      return treeResult.value;
    },
  },
}));

const StorefrontHome = (await import('@/../app/(storefront)/page')).default;

beforeEach(() => {
  treeResult = { ok: true, value: tree };
});

describe('StorefrontHome (AC-1)', () => {
  it('enlaza cada rubro Y cada subrubro — los subrubros también son puerta de entrada', async () => {
    render(await StorefrontHome());

    expect(screen.getByRole('link', { name: 'Climatización' })).toHaveAttribute(
      'href',
      '/categorias/climatizacion',
    );
    // Si sólo se recorrieran los rubros, estos dos links no existirían y la
    // mitad del catálogo quedaría sin camino desde la home.
    expect(screen.getByRole('link', { name: 'Compresores' })).toHaveAttribute(
      'href',
      '/categorias/compresores',
    );
    expect(screen.getByRole('link', { name: 'Equipos split' })).toHaveAttribute(
      'href',
      '/categorias/split',
    );
    expect(screen.getByRole('link', { name: 'Ferretería' })).toHaveAttribute(
      'href',
      '/categorias/ferreteria',
    );
  });

  it('el h1 es el claim y la página ya no es sólo el stub de US-003', async () => {
    render(await StorefrontHome());

    expect(
      screen.getByRole('heading', { level: 1, name: /DSM Refrigeración y Ferretería/ }),
    ).toBeInTheDocument();
    // Jerarquía nueva: un h2 de sección ("Explorá por rubro") con los rubros como h3.
    expect(
      screen.getByRole('heading', { level: 2, name: /Explorá por rubro/ }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(2);
  });

  it('si el árbol falla, la home se sirve igual con el claim (no 500)', async () => {
    treeResult = { ok: false };

    render(await StorefrontHome());

    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
  });
});
