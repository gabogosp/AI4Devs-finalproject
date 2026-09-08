import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { StorefrontProductListItem } from '@/api/generated/model';

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

/**
 * Mismo mecanismo de estado plano que `treeResult` (T-B5): dos secciones
 * independientes (AC-4/AC-5 pueden faltar por separado), cada una con su
 * propio flag `ok`.
 */
type SectionResult =
  | { ok: true; value: StorefrontProductListItem[] }
  | { ok: false };

let novedadesResult: SectionResult = { ok: true, value: [] };
let masVendidosResult: SectionResult = { ok: true, value: [] };

vi.mock('@/features/storefront/homeFeaturedService', () => ({
  homeFeaturedService: {
    getNovedades: async () => {
      if (!novedadesResult.ok) throw new Error('backend caído');
      return novedadesResult.value;
    },
    getMasVendidos: async () => {
      if (!masVendidosResult.ok) throw new Error('backend caído');
      return masVendidosResult.value;
    },
  },
}));

// `HomeFeaturedSection` renderiza `ProductCard`, que necesita el `CartProvider`
// del layout para su `AddToCartButton` — fuera de alcance de esta suite (la
// composición del home), mismo criterio que `CategoryPage.test.tsx`.
vi.mock('@/features/cart/AddToCartButton', () => ({
  AddToCartButton: () => null,
}));

const StorefrontHome = (await import('@/../app/(storefront)/page')).default;

function homeItem(over: Partial<StorefrontProductListItem> = {}): StorefrontProductListItem {
  return {
    slug: 'producto-1',
    name: 'Producto 1',
    price_ars_cents: 100000,
    currency: 'ARS',
    image_url: null,
    in_stock: true,
    ...over,
  };
}

beforeEach(() => {
  treeResult = { ok: true, value: tree };
  novedadesResult = { ok: true, value: [] };
  masVendidosResult = { ok: true, value: [] };
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

describe('StorefrontHome — Novedades y Más vendidos (US-026 T-B5)', () => {
  it('muestra ambas secciones cuando tienen datos (AC-1, AC-2)', async () => {
    novedadesResult = { ok: true, value: [homeItem({ slug: 'nuevo-1', name: 'Producto Nuevo' })] };
    masVendidosResult = { ok: true, value: [homeItem({ slug: 'top-1', name: 'Producto Top' })] };

    render(await StorefrontHome());

    expect(screen.getByRole('heading', { level: 2, name: 'Novedades' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Más vendidos' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Producto Nuevo/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Producto Top/ })).toBeInTheDocument();
  });

  it('sólo muestra "Novedades" cuando "Más vendidos" no tiene ventas confirmadas todavía (AC-5)', async () => {
    novedadesResult = { ok: true, value: [homeItem({ slug: 'nuevo-1', name: 'Producto Nuevo' })] };
    masVendidosResult = { ok: true, value: [] };

    render(await StorefrontHome());

    expect(screen.getByRole('heading', { level: 2, name: 'Novedades' })).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { level: 2, name: 'Más vendidos' }),
    ).not.toBeInTheDocument();
  });

  it('no muestra ninguna sección destacada cuando ambas están vacías, sin afectar los rubros (AC-4)', async () => {
    novedadesResult = { ok: true, value: [] };
    masVendidosResult = { ok: true, value: [] };

    render(await StorefrontHome());

    expect(screen.queryByRole('heading', { level: 2, name: 'Novedades' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { level: 2, name: 'Más vendidos' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Explorá por rubro' }),
    ).toBeInTheDocument();
  });

  it('renderiza los ProductCard en el mismo orden del array recibido, sin re-ordenar (mitad FE de AC-6)', async () => {
    masVendidosResult = {
      ok: true,
      value: [
        homeItem({ slug: 'tercero', name: 'Producto Tercero' }),
        homeItem({ slug: 'primero', name: 'Producto Primero' }),
        homeItem({ slug: 'segundo', name: 'Producto Segundo' }),
      ],
    };

    render(await StorefrontHome());

    const region = screen.getByRole('region', { name: 'Más vendidos' });
    const names = within(region)
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent);

    expect(names).toEqual(['Producto Tercero', 'Producto Primero', 'Producto Segundo']);
  });

  it('"Novedades" aparece antes que "Más vendidos" en el documento cuando ambas están presentes', async () => {
    novedadesResult = { ok: true, value: [homeItem({ slug: 'nuevo-1', name: 'Producto Nuevo' })] };
    masVendidosResult = { ok: true, value: [homeItem({ slug: 'top-1', name: 'Producto Top' })] };

    render(await StorefrontHome());

    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    const novedadesIndex = headings.indexOf('Novedades');
    const masVendidosIndex = headings.indexOf('Más vendidos');

    expect(novedadesIndex).toBeGreaterThan(-1);
    expect(masVendidosIndex).toBeGreaterThan(novedadesIndex);
  });
});
