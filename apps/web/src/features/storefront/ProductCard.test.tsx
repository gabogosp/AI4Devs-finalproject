import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProductCard } from './ProductCard';
import type { StorefrontProductListItem } from '@/api/generated/model';
import { CartProvider } from '@/features/cart/CartProvider';

// US-007 T3.5: la card con stock ofrece «Agregar» (OQ-FE-2 resuelta como sí), así
// que necesita el CartProvider del layout y el servicio mockeado.
vi.mock('@/features/cart/cartService', () => {
  // El literal va DENTRO de la factory: `vi.mock` se hoistea al tope del archivo,
  // así que una constante de módulo todavía no está inicializada cuando corre.
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

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
}));

function renderCard(ui: React.ReactElement) {
  return render(<CartProvider>{ui}</CartProvider>);
}

function item(over: Partial<StorefrontProductListItem> = {}): StorefrontProductListItem {
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

describe('ProductCard (AC-3, AC-5)', () => {
  it('toda la card es un link a la ficha, con el nombre del producto como nombre accesible', () => {
    renderCard(<ProductCard item={item()} categoryName="Climatización" />);

    expect(screen.getByRole('link', { name: /Compresor 1HP/ })).toHaveAttribute(
      'href',
      '/productos/compresor-1hp',
    );
  });

  it('muestra el precio en pesos, sin centavos y con separador de miles', () => {
    renderCard(<ProductCard item={item()} categoryName="Climatización" />);

    // $ 12.500 y NO 1250000 ni 12500.00: el precio viaja en centavos por
    // contrato, mostrarlo crudo sería un error de un factor 100.
    expect(screen.getByText(/12\.500/)).toBeInTheDocument();
    expect(screen.queryByText(/1250000/)).not.toBeInTheDocument();
    expect(screen.getByText('IVA incluido')).toBeInTheDocument();
  });

  it('sin stock: badge con TEXTO visible y ningún control de compra (AC-5)', () => {
    renderCard(<ProductCard item={item({ in_stock: false })} categoryName="Climatización" />);

    expect(screen.getByText('Sin stock')).toBeInTheDocument();
    // La card NO ofrece comprar — ni con stock ni sin él (design.md D8).
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText(/Agregar/i)).not.toBeInTheDocument();
  });

  // REESCRITO por US-007 T3.5 (OQ-FE-2 resuelta por el PO como «sí, con stock la
  // card ofrece agregar»). El assert original —«tampoco un control de compra»— era
  // correcto mientras el carrito no existía; ahora contradice la decisión del PO.
  // El caso de SIN stock queda intacto: ahí el invariante sigue siendo que no hay
  // nada que apretar.
  it('con stock: sin badge y CON «Agregar», nombrando el producto', () => {
    renderCard(<ProductCard item={item({ in_stock: true })} categoryName="Climatización" />);

    expect(screen.queryByText('Sin stock')).not.toBeInTheDocument();
    // En una grilla hay muchos «Agregar»: el nombre accesible tiene que distinguirlos.
    expect(
      screen.getByRole('button', { name: /Agregar Compresor 1HP/i }),
    ).toBeInTheDocument();
  });

  it('el clic en «Agregar» NO navega a la ficha', async () => {
    renderCard(<ProductCard item={item({ in_stock: true })} categoryName="Climatización" />);

    await userEvent.click(screen.getByRole('button', { name: /Agregar/i }));

    // Si el botón disparara la navegación del link, agregar desde el listado
    // sacaría a la persona del listado — justo lo que OQ-FE-2 quiere evitar.
    expect(push).not.toHaveBeenCalled();
  });

  it('el botón NO está anidado dentro del link (HTML inválido + doble destino)', () => {
    renderCard(<ProductCard item={item({ in_stock: true })} categoryName="Climatización" />);

    const link = screen.getByRole('link', { name: /Compresor 1HP/ });
    const boton = screen.getByRole('button', { name: /Agregar/i });
    expect(link.contains(boton)).toBe(false);
  });

  it('sin imagen usa el placeholder con alt descriptivo, no un broken image', () => {
    renderCard(<ProductCard item={item({ image_url: null })} categoryName="Climatización" />);

    expect(
      screen.getByRole('img', { name: /Compresor 1HP — sin imagen disponible/ }),
    ).toBeInTheDocument();
  });
});
