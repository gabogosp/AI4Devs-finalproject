import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProductCard } from './ProductCard';
import type { StorefrontProductListItem } from '@/api/generated/model';

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
    render(<ProductCard item={item()} categoryName="Climatización" />);

    expect(screen.getByRole('link', { name: /Compresor 1HP/ })).toHaveAttribute(
      'href',
      '/productos/compresor-1hp',
    );
  });

  it('muestra el precio en pesos, sin centavos y con separador de miles', () => {
    render(<ProductCard item={item()} categoryName="Climatización" />);

    // $ 12.500 y NO 1250000 ni 12500.00: el precio viaja en centavos por
    // contrato, mostrarlo crudo sería un error de un factor 100.
    expect(screen.getByText(/12\.500/)).toBeInTheDocument();
    expect(screen.queryByText(/1250000/)).not.toBeInTheDocument();
    expect(screen.getByText('IVA incluido')).toBeInTheDocument();
  });

  it('sin stock: badge con TEXTO visible y ningún control de compra (AC-5)', () => {
    render(<ProductCard item={item({ in_stock: false })} categoryName="Climatización" />);

    expect(screen.getByText('Sin stock')).toBeInTheDocument();
    // La card NO ofrece comprar — ni con stock ni sin él (design.md D8).
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText(/Agregar/i)).not.toBeInTheDocument();
  });

  it('con stock no muestra el badge, y tampoco un control de compra', () => {
    render(<ProductCard item={item({ in_stock: true })} categoryName="Climatización" />);

    expect(screen.queryByText('Sin stock')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('sin imagen usa el placeholder con alt descriptivo, no un broken image', () => {
    render(<ProductCard item={item({ image_url: null })} categoryName="Climatización" />);

    expect(
      screen.getByRole('img', { name: /Compresor 1HP — sin imagen disponible/ }),
    ).toBeInTheDocument();
  });
});
