import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { ProductDetail } from './ProductDetail';
import type { StorefrontProduct } from './storefrontService';

expect.extend(toHaveNoViolations);

function storefrontProduct(over: Partial<StorefrontProduct> = {}): StorefrontProduct {
  return {
    slug: 'heladera-exhibidora',
    sku: 'REF-001',
    name: 'Heladera exhibidora',
    description: 'Heladera de 400 litros',
    price_ars_cents: 1250000,
    currency: 'ARS',
    image_url: 'https://cdn.example.com/heladera.jpg',
    in_stock: true,
    category: { name: 'Refrigeración', slug: 'refrigeracion' },
    ...over,
  };
}

/**
 * WCAG 2.1 AA sobre la ficha (design-system §11, qa-frontend-standards §23).
 * Se cubren los tres estados que cambian el árbol accesible: con stock, sin
 * stock (el CTA se reemplaza por el canal humano) y sin imagen (placeholder).
 */
const STATES: Array<[string, StorefrontProduct]> = [
  ['con stock', storefrontProduct()],
  ['sin stock', storefrontProduct({ in_stock: false })],
  ['sin imagen', storefrontProduct({ image_url: null })],
];

describe('a11y — ficha de producto', () => {
  it.each(STATES)('%s: axe no encuentra violaciones', async (_name, product) => {
    const { container } = render(<ProductDetail product={product} />);

    expect(await axe(container)).toHaveNoViolations();
  });

  it.each(STATES)('%s: el nombre es el único h1', (_name, product) => {
    render(<ProductDetail product={product} />);

    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent(product.name);
  });

  it('la imagen lleva alt descriptivo, no genérico', () => {
    render(<ProductDetail product={storefrontProduct()} />);

    const alt = screen.getByRole('img').getAttribute('alt') ?? '';
    expect(alt).toContain('Heladera exhibidora');
    expect(alt).not.toMatch(/^(imagen|image|foto|producto)$/i);
  });

  it('sin imagen: el placeholder sigue teniendo nombre accesible', () => {
    render(<ProductDetail product={storefrontProduct({ image_url: null })} />);

    expect(
      screen.getByRole('img', { name: /Heladera exhibidora/ }),
    ).toBeInTheDocument();
  });

  it('sin stock: el estado se comunica con texto, no sólo con color', () => {
    render(<ProductDetail product={storefrontProduct({ in_stock: false })} />);

    expect(screen.getByText('Sin stock')).toBeInTheDocument();
  });

  it('sin stock: el enlace de WhatsApp tiene nombre accesible propio', () => {
    render(<ProductDetail product={storefrontProduct({ in_stock: false })} />);

    // Un enlace que fuera sólo ícono quedaría sin nombre y axe lo marcaría,
    // pero el assert explícito documenta la intención del §7.14.
    const link = screen.getByRole('link', { name: /Avisame por WhatsApp/ });
    expect(link).toHaveAccessibleName();
  });
});
