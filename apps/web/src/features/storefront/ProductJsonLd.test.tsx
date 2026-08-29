import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import {
  ProductJsonLd,
  buildProductJsonLd,
  serializeJsonLd,
} from './ProductJsonLd';
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

describe('buildProductJsonLd', () => {
  it('declara un Product con precio en unidades decimales, no en centavos', () => {
    const ld = buildProductJsonLd(storefrontProduct({ price_ars_cents: 1250000 }));

    expect(ld['@type']).toBe('Product');
    expect(ld.offers.priceCurrency).toBe('ARS');
    expect(ld.offers.price).toBe('12500.00');
  });

  it('refleja la disponibilidad real del producto', () => {
    expect(buildProductJsonLd(storefrontProduct({ in_stock: true })).offers.availability).toBe(
      'https://schema.org/InStock',
    );
    expect(buildProductJsonLd(storefrontProduct({ in_stock: false })).offers.availability).toBe(
      'https://schema.org/OutOfStock',
    );
  });

  it('apunta la oferta a la URL canónica por slug', () => {
    const ld = buildProductJsonLd(storefrontProduct());

    expect(ld.offers.url).toBe('http://localhost:3000/productos/heladera-exhibidora');
  });

  it('omite descripción e imagen cuando no existen, en vez de emitir null', () => {
    const ld = buildProductJsonLd(
      storefrontProduct({ description: null, image_url: null }),
    );

    expect(ld.description).toBeUndefined();
    expect(ld.image).toBeUndefined();
    expect(JSON.stringify(ld)).not.toContain('null');
  });
});

describe('serializeJsonLd — escape de input del dueño', () => {
  it('escapa `<` para que un `</script>` en el nombre no cierre la etiqueta', () => {
    const serialized = serializeJsonLd(
      buildProductJsonLd(
        storefrontProduct({ name: 'Heladera </script><img src=x onerror=alert(1)>' }),
      ),
    );

    // Ninguna secuencia `<` cruda sobrevive: si faltara el escape, el documento
    // se rompería y el payload se ejecutaría como HTML.
    expect(serialized).not.toContain('<');
    expect(serialized).toContain('\\u003c/script');
    // Y sigue siendo JSON válido con el nombre intacto.
    expect(JSON.parse(serialized).name).toBe(
      'Heladera </script><img src=x onerror=alert(1)>',
    );
  });
});

describe('ProductJsonLd', () => {
  it('renderiza exactamente un script ld+json con el payload escapado', () => {
    const { container } = render(
      <ProductJsonLd product={storefrontProduct({ name: 'Bulón <5mm>' })} />,
    );

    const scripts = container.querySelectorAll('script[type="application/ld+json"]');
    expect(scripts).toHaveLength(1);
    expect(scripts[0].innerHTML).not.toContain('<');
    expect(JSON.parse(scripts[0].innerHTML)['@type']).toBe('Product');
  });
});
