import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HomeFeaturedSection } from './HomeFeaturedSection';
import type { StorefrontProductListItem } from '@/api/generated/model';
import { CartProvider } from '@/features/cart/CartProvider';
import { setEventSink, type BusinessEvent, type EventProps } from '@/lib/observability/events';

// Mismo mock que `ProductCard.test.tsx`: `HomeFeaturedSection` renderiza
// `ProductCard`, que necesita el `CartProvider` del layout y el servicio
// mockeado.
vi.mock('@/features/cart/cartService', () => {
  const vacio = {
    id: null,
    items: [],
    item_count: 0,
    total_quantity: 0,
    total_ars_cents: 0,
    has_blocking_issues: false,
    updated_at: null,
  };
  return {
    cartService: {
      get: vi.fn().mockResolvedValue(vacio),
      setItemQuantity: vi.fn().mockResolvedValue(vacio),
      removeItem: vi.fn(),
    },
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

function renderSection(ui: React.ReactElement) {
  return render(<CartProvider>{ui}</CartProvider>);
}

function item(over: Partial<StorefrontProductListItem> = {}): StorefrontProductListItem {
  return {
    slug: `producto-${Math.random().toString(36).slice(2, 8)}`,
    name: 'Compresor 1HP',
    price_ars_cents: 1250000,
    currency: 'ARS',
    image_url: null,
    in_stock: true,
    ...over,
  };
}

function items(n: number, over: Partial<StorefrontProductListItem> = {}): StorefrontProductListItem[] {
  return Array.from({ length: n }, (_, i) =>
    item({ slug: `producto-${i}`, name: `Producto ${i}`, ...over }),
  );
}

describe('HomeFeaturedSection (US-026 T-A5)', () => {
  beforeEach(() => {
    setEventSink(() => {});
  });

  it('items vacío: no renderiza nada, ni h2 ni section (AC-4/AC-5)', () => {
    const { container } = renderSection(
      <HomeFeaturedSection id="novedades" title="Novedades" items={[]} />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('con 3 items: renderiza exactamente 3 ProductCard, en el mismo orden del array (AC-3)', () => {
    renderSection(
      <HomeFeaturedSection id="novedades" title="Novedades" items={items(3)} />,
    );

    const links = screen.getAllByRole('link', { name: /Producto \d/ });
    expect(links).toHaveLength(3);
    expect(links.map((l) => l.textContent)).toEqual([
      expect.stringContaining('Producto 0'),
      expect.stringContaining('Producto 1'),
      expect.stringContaining('Producto 2'),
    ]);
  });

  it('con 8 items: renderiza exactamente 8 ProductCard, en el mismo orden del array (AC-6 mitad FE)', () => {
    renderSection(
      <HomeFeaturedSection id="mas-vendidos" title="Más vendidos" items={items(8)} />,
    );

    const links = screen.getAllByRole('link', { name: /Producto \d/ });
    expect(links).toHaveLength(8);
    links.forEach((link, i) => {
      expect(link.textContent).toContain(`Producto ${i}`);
    });
  });

  it('el <section> tiene aria-labelledby apuntando al id del <h2> con el title dado', () => {
    renderSection(
      <HomeFeaturedSection id="novedades" title="Novedades" items={items(2)} />,
    );

    const heading = screen.getByRole('heading', { level: 2, name: 'Novedades' });
    const region = screen.getByRole('region', { name: 'Novedades' });
    expect(heading.id).toBe('novedades-heading');
    expect(region).toHaveAttribute('aria-labelledby', 'novedades-heading');
  });

  it('un item con in_stock: false muestra el badge "Sin stock" (AC-8, heredado de ProductCard)', () => {
    renderSection(
      <HomeFeaturedSection
        id="novedades"
        title="Novedades"
        items={[item({ slug: 'sin-stock', name: 'Sin Stock Producto', in_stock: false })]}
      />,
    );

    expect(screen.getByText('Sin stock')).toBeInTheDocument();
  });

  it('cada ProductCard linkea a /productos/{slug} (AC-1/AC-2, heredado)', () => {
    renderSection(
      <HomeFeaturedSection
        id="novedades"
        title="Novedades"
        items={[item({ slug: 'compresor-1hp', name: 'Compresor 1HP' })]}
      />,
    );

    expect(screen.getByRole('link', { name: /Compresor 1HP/ })).toHaveAttribute(
      'href',
      '/productos/compresor-1hp',
    );
  });

  it('con items no vacíos, HomeFeaturedViewTracker está presente: emite home_featured_shown', () => {
    const emitted: { event: BusinessEvent; props: EventProps }[] = [];
    setEventSink((event, props) => emitted.push({ event, props }));

    renderSection(<HomeFeaturedSection id="novedades" title="Novedades" items={items(3)} />);

    expect(emitted).toHaveLength(1);
    expect(emitted[0].event).toBe('home_featured_shown');
    expect(emitted[0].props).toMatchObject({
      section: 'novedades',
      item_count: 3,
      screen_name: 'home',
    });
  });

  it('con items vacío, NO emite home_featured_shown (el tracker no se monta)', () => {
    const emitted: { event: BusinessEvent; props: EventProps }[] = [];
    setEventSink((event, props) => emitted.push({ event, props }));

    renderSection(<HomeFeaturedSection id="mas-vendidos" title="Más vendidos" items={[]} />);

    expect(emitted).toHaveLength(0);
  });
});
