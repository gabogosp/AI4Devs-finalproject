import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { Breadcrumb } from './Breadcrumb';
import { CategoryEmptyState } from './CategoryEmptyState';
import { Pagination } from './Pagination';
import { ProductCard } from './ProductCard';
import type { StorefrontProductListItem } from '@/api/generated/model';

expect.extend(toHaveNoViolations);

function item(over: Partial<StorefrontProductListItem> = {}): StorefrontProductListItem {
  return {
    slug: 'compresor-1hp',
    name: 'Compresor 1HP',
    price_ars_cents: 1250000,
    currency: 'ARS',
    image_url: 'https://cdn.example.com/compresor.jpg',
    in_stock: true,
    ...over,
  };
}

/**
 * Página de categoría armada con sus piezas reales. No se renderiza el Server
 * Component `CategoryPage` porque axe necesita el árbol montado y aquél es
 * async; se compone la misma estructura (breadcrumb → h1 → grilla → paginación)
 * para que el árbol accesible sea el que ve el usuario.
 */
function CategoryScreen({
  items,
  empty = false,
}: {
  items: StorefrontProductListItem[];
  empty?: boolean;
}) {
  return (
    <div>
      <Breadcrumb
        items={[
          { name: 'Inicio', href: '/' },
          { name: 'Climatización', href: '/categorias/climatizacion' },
          { name: 'Compresores' },
        ]}
      />
      <h1>Compresores</h1>
      {empty ? (
        <CategoryEmptyState />
      ) : (
        <>
          <h2 className="sr-only">Productos</h2>
          <section>
            {items.map((it) => (
              <ProductCard key={it.slug} item={it} categoryName="Compresores" />
            ))}
          </section>
          <Pagination slug="compresores" current={2} total={45} pageSize={20} />
        </>
      )}
    </div>
  );
}

const STATES: Array<[string, ReactElement]> = [
  ['con productos', <CategoryScreen items={[item()]} key="a" />],
  ['vacía', <CategoryScreen items={[]} empty key="b" />],
  [
    'con un item sin stock',
    <CategoryScreen items={[item({ in_stock: false }), item({ slug: 'c2', name: 'C2' })]} key="c" />,
  ],
];

describe('Accesibilidad de la página de categoría (WCAG 2.1 AA)', () => {
  it.each(STATES)('%s: cero violaciones de axe', async (_name, ui) => {
    const { container } = render(ui);

    expect(await axe(container)).toHaveNoViolations();
  });

  it('hay un único h1 y la jerarquía de headings no salta niveles', () => {
    render(<CategoryScreen items={[item()]} />);

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    // La card usa h3 bajo el h1 de la categoría; no hay h4 sin h3 previo.
    expect(screen.getAllByRole('heading', { level: 3 }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { level: 4 })).not.toBeInTheDocument();
  });

  it('el breadcrumb y la paginación marcan la posición actual', () => {
    render(<CategoryScreen items={[item()]} />);

    // Dos `aria-current="page"`: el ítem del breadcrumb y la página activa.
    const currents = document.querySelectorAll('[aria-current="page"]');
    expect(currents).toHaveLength(2);
  });

  it('las nav están etiquetadas y se distinguen entre sí', () => {
    render(<CategoryScreen items={[item()]} />);

    expect(screen.getByRole('navigation', { name: 'Ruta de navegación' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Paginación' })).toBeInTheDocument();
  });

  it('el alt de la imagen es descriptivo, nunca "imagen"', () => {
    render(<CategoryScreen items={[item()]} />);

    const img = screen.getByRole('img');
    const alt = img.getAttribute('alt') ?? '';
    expect(alt).toContain('Compresor 1HP');
    expect(alt.toLowerCase()).not.toBe('imagen');
  });

  it('el badge sin stock comunica con TEXTO, no sólo con color', () => {
    render(<CategoryScreen items={[item({ in_stock: false })]} />);

    expect(screen.getByText('Sin stock')).toBeInTheDocument();
  });
});
