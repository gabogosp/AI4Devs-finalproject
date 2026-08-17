import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProductDetail } from './ProductDetail';
import type { StorefrontProduct } from './storefrontService';

function storefrontProduct(over: Partial<StorefrontProduct> = {}): StorefrontProduct {
  return {
    slug: 'heladera-exhibidora',
    sku: 'REF-001',
    name: 'Heladera exhibidora',
    description: 'Heladera de 400 litros',
    price_ars_cents: 1250000,
    currency: 'ARS',
    image_url: null,
    in_stock: true,
    category: { name: 'Refrigeración', slug: 'refrigeracion' },
    ...over,
  };
}

describe('ProductDetail', () => {
  it('muestra nombre, precio con IVA, categoría y descripción', () => {
    render(<ProductDetail product={storefrontProduct()} />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Heladera exhibidora' }),
    ).toBeInTheDocument();
    expect(screen.getByText('$ 12.500')).toBeInTheDocument();
    expect(screen.getByText('IVA incluido')).toBeInTheDocument();
    expect(screen.getByText('Refrigeración')).toBeInTheDocument();
    expect(screen.getByText('Heladera de 400 litros')).toBeInTheDocument();
  });

  it('el nombre es el único h1 de la ficha', () => {
    render(<ProductDetail product={storefrontProduct()} />);

    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent('Heladera exhibidora');
  });

  it('omite la sección de descripción cuando el producto no tiene una', () => {
    render(<ProductDetail product={storefrontProduct({ description: null })} />);

    expect(screen.queryByText('Descripción')).not.toBeInTheDocument();
    // El resto de la ficha se renderiza igual.
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.getByText('$ 12.500')).toBeInTheDocument();
  });

  it('muestra la descripción enriquecida cuando el backend la resolvió (AC-5)', () => {
    render(
      <ProductDetail
        product={storefrontProduct({
          description: 'Heladera exhibidora de 400 litros, ideal para comercios.',
        })}
      />,
    );

    expect(
      screen.getByText('Heladera exhibidora de 400 litros, ideal para comercios.'),
    ).toBeInTheDocument();
  });

  it('formatea el precio en pesos, no en centavos crudos', () => {
    render(<ProductDetail product={storefrontProduct({ price_ars_cents: 999900 })} />);

    expect(screen.getByText('$ 9.999')).toBeInTheDocument();
    expect(screen.queryByText(/999900/)).not.toBeInTheDocument();
  });

  it('respeta la jerarquía de lectura del §7.3: nombre → precio → descripción', () => {
    render(<ProductDetail product={storefrontProduct()} />);

    // Se compara la posición de los ELEMENTOS en el DOM, no índices dentro del
    // texto: el payload JSON-LD también contiene el nombre y la descripción, y
    // ensuciaría una comparación sobre `textContent`.
    const name = screen.getByRole('heading', { level: 1 });
    const price = screen.getByText('$ 12.500');
    const description = screen.getByText('Heladera de 400 litros');

    const follows = (a: Element, b: Element) =>
      Boolean(
        a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING,
      );

    expect(follows(name, price)).toBe(true);
    expect(follows(price, description)).toBe(true);
  });
});
