import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { SearchResult } from './searchService';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/features/cart/cartService', () => ({
  cartService: { get: vi.fn(), setItemQuantity: vi.fn(), removeItem: vi.fn() },
}));

const { SearchResultCard } = await import('./SearchResultCard');
const { CartProvider } = await import('@/features/cart/CartProvider');

function result(over: Partial<SearchResult> = {}): SearchResult {
  return {
    slug: 'taco-fischer-sx-8mm-x50',
    name: 'Taco Fischer SX 8mm (x50)',
    price_ars_cents: 320000,
    in_stock: true,
    image_url: null,
    score: 0.89,
    ...over,
  };
}

function renderCard(r: SearchResult = result()) {
  return render(
    <CartProvider>
      <SearchResultCard result={r} />
    </CartProvider>,
  );
}

describe('SearchResultCard', () => {
  it('enlaza a la ficha del producto por slug (AC-1)', () => {
    renderCard();

    const enlace = screen.getByRole('link', { name: /Taco Fischer SX 8mm/ });
    expect(enlace).toHaveAttribute('href', '/productos/taco-fischer-sx-8mm-x50');
  });

  it('muestra el precio formateado con IVA incluido', () => {
    renderCard();

    // 320000 centavos = $3.200.
    expect(screen.getByText(/3\.200/)).toBeInTheDocument();
    expect(screen.getByText(/IVA incluido/i)).toBeInTheDocument();
  });

  it('NO muestra el score', () => {
    renderCard(result({ score: 0.42 }));

    // Ni el número crudo ni el porcentaje: expone la mecánica del ranking y no
    // significa nada para quien compra. El orden ya comunica la relevancia.
    expect(screen.queryByText(/0[.,]42/)).not.toBeInTheDocument();
    expect(screen.queryByText(/42\s*%/)).not.toBeInTheDocument();
  });
});

describe('SearchResultCard — stock (AC-7)', () => {
  it('con stock renderiza el botón de agregar al carrito', () => {
    renderCard(result({ in_stock: true }));

    expect(
      screen.getByRole('button', { name: /agregar al carrito/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/sin stock/i)).not.toBeInTheDocument();
  });

  it('sin stock el producto APARECE pero el botón está ausente, no deshabilitado', () => {
    renderCard(result({ in_stock: false }));

    // Que el producto agotado exista es información útil: esconderlo es peor.
    expect(screen.getByRole('link', { name: /Taco Fischer/ })).toBeInTheDocument();
    // Ausente y no deshabilitado: un botón gris invita al clic y no explica nada.
    expect(screen.queryByRole('button', { name: /agregar al carrito/i })).toBeNull();
  });

  it('el badge de sin stock es texto, no sólo color', () => {
    renderCard(result({ in_stock: false }));

    // Quien no distingue el gris del negro tiene que poder saberlo igual (§11).
    expect(screen.getByText(/sin stock/i)).toBeInTheDocument();
  });
});

describe('SearchResultCard — imagen', () => {
  it('sin imagen cae al placeholder nombrando el producto', () => {
    renderCard(result({ image_url: null }));

    expect(
      screen.getByRole('img', { name: /Taco Fischer SX 8mm \(x50\) — sin imagen/ }),
    ).toBeInTheDocument();
  });

  it('con imagen el alt es el nombre, sin categoría colgada (D6)', () => {
    renderCard(result({ image_url: 'https://cdn.example.com/taco.jpg' }));

    const img = screen.getByRole('img', { name: 'Taco Fischer SX 8mm (x50)' });
    expect(img.getAttribute('alt')).not.toContain('undefined');
  });
});
