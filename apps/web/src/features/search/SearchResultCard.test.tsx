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

/**
 * La imagen de la tarjeta es **decorativa**, y es una decisión de accesibilidad,
 * no una omisión: el nombre del producto está como texto en el `<h3>` de al
 * lado, dentro del mismo enlace. Con `alt` = nombre, un lector de pantalla lo
 * lee dos veces y axe lo reporta como `image-redundant-alt`. Repetir no es
 * describir.
 *
 * En la ficha (`hero`) sigue sin aplicar: ahí la imagen ES el contenido y su
 * `alt` es lo que indexa Google Images.
 */
describe('SearchResultCard — imagen decorativa', () => {
  it('la imagen no se anuncia: el nombre ya está al lado', () => {
    const { container } = renderCard(
      result({ image_url: 'https://cdn.example.com/taco.jpg' }),
    );

    expect(screen.queryByRole('img')).toBeNull();
    // El elemento existe y se ve; lo que no hace es duplicar el nombre.
    expect(container.querySelector('img')).not.toBeNull();
    expect(container.querySelector('img')!.getAttribute('alt')).toBe('');
  });

  it('el nombre del producto se anuncia UNA sola vez', () => {
    renderCard(result({ image_url: 'https://cdn.example.com/taco.jpg' }));

    expect(screen.getAllByText('Taco Fischer SX 8mm (x50)')).toHaveLength(1);
  });

  it('sin imagen el placeholder tampoco anuncia nada redundante', () => {
    renderCard(result({ image_url: null }));

    expect(screen.queryByRole('img')).toBeNull();
    // Y el enlace conserva su nombre accesible, que sale del `<h3>`: la tarjeta
    // sigue siendo navegable y anunciable sin la imagen.
    expect(
      screen.getByRole('link', { name: /Taco Fischer SX 8mm/ }),
    ).toBeInTheDocument();
  });
});
