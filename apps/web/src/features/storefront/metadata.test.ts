import { describe, expect, it } from 'vitest';
import { productMetadata, productUrl } from './metadata';
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

describe('productMetadata', () => {
  it('arma title, description y canonical absoluto con el slug', () => {
    const meta = productMetadata(storefrontProduct());

    expect(meta.title).toBe('Heladera exhibidora — DSM Refrigeración y Ferretería');
    expect(meta.description).toBe('Heladera de 400 litros');
    expect(meta.alternates?.canonical).toBe(
      'http://localhost:3000/productos/heladera-exhibidora',
    );
    // Absoluto, no relativo: un canonical relativo no sirve para un buscador.
    expect(String(meta.alternates?.canonical)).toMatch(/^https?:\/\//);
  });

  it('usa la imagen del producto en Open Graph cuando existe', () => {
    const meta = productMetadata(
      storefrontProduct({ image_url: 'https://cdn.example.com/heladera.jpg' }),
    );

    expect(meta.openGraph?.images).toEqual(['https://cdn.example.com/heladera.jpg']);
  });

  it('cae a la imagen OG por defecto cuando el producto no tiene imagen', () => {
    const meta = productMetadata(storefrontProduct({ image_url: null }));

    expect(meta.openGraph?.images).toEqual(['/og-default.png']);
  });

  it('usa el nombre como description cuando el producto no tiene descripción', () => {
    const meta = productMetadata(
      storefrontProduct({ description: null, name: 'Taladro percutor' }),
    );

    expect(meta.description).toBe('Taladro percutor');
  });

  it('trunca la description a 160 caracteres sin partir palabras', () => {
    const meta = productMetadata(
      storefrontProduct({ description: 'palabra '.repeat(50) }),
    );

    const description = meta.description as string;
    expect(description.length).toBeLessThanOrEqual(160);
    expect(description.endsWith('…')).toBe(true);
    expect(description).not.toMatch(/palab…$/); // no corta a mitad de palabra
  });

  it('un producto inexistente devuelve metadatos mínimos en vez de explotar', () => {
    const meta = productMetadata(null);

    expect(meta.title).toContain('Producto no encontrado');
    expect(meta.alternates?.canonical).toBeUndefined();
  });
});

describe('productUrl', () => {
  it('construye la URL pública de la ficha por slug', () => {
    expect(productUrl('taladro-percutor')).toBe(
      'http://localhost:3000/productos/taladro-percutor',
    );
  });
});
