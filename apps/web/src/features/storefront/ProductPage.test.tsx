import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import type { StorefrontProduct } from './storefrontService';

/**
 * La ruta de la ficha: éxito renderiza server-side y un 404 del contrato se
 * traduce a `notFound()` de Next — que es lo que produce un status HTTP 404
 * REAL en lugar de un 200 vacío (AC-7/AC-8). El status en sí lo prueba T6.2
 * contra el servidor; acá se prueba que la ruta **decide** bien.
 */
const notFoundSignal = new Error('NEXT_NOT_FOUND');
const notFound = vi.fn(() => {
  throw notFoundSignal;
});
vi.mock('next/navigation', () => ({ notFound: () => notFound() }));

const { default: ProductPage } = await import(
  '../../../app/(storefront)/productos/[slug]/page'
);

// US-007 T3.4: la ficha ahora incluye `AddToCartButton`, que consume el
// CartProvider del layout. Este test renderiza el subárbol aislado, así que el
// botón se stubea — ninguna aserción de este archivo cambia.
vi.mock('@/features/cart/AddToCartButton', () => ({
  AddToCartButton: () => null,
}));

const API = 'http://localhost:3000';

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

describe('ProductPage (ruta SSR de la ficha)', () => {
  it('renderiza la ficha de un producto publicado', async () => {
    server.use(
      http.get(`${API}/v1/products/heladera-exhibidora`, () =>
        HttpResponse.json(storefrontProduct()),
      ),
    );

    const ui = await ProductPage({
      params: Promise.resolve({ slug: 'heladera-exhibidora' }),
    });
    render(ui);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Heladera exhibidora' }),
    ).toBeInTheDocument();
    expect(screen.getByText('$ 12.500')).toBeInTheDocument();
  });

  it('un 404 del contrato dispara notFound() (status 404 real, no un 200 vacío)', async () => {
    notFound.mockClear();
    server.use(
      http.get(`${API}/v1/products/no-existe`, () =>
        HttpResponse.json(
          { type: 'dsm:catalog/not-found', status: 404, detail: 'No existe' },
          { status: 404 },
        ),
      ),
    );

    await expect(
      ProductPage({ params: Promise.resolve({ slug: 'no-existe' }) }),
    ).rejects.toBe(notFoundSignal);
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it('un error de servidor NO se convierte en 404 — sube al error boundary', async () => {
    notFound.mockClear();
    server.use(
      http.get(`${API}/v1/products/heladera-exhibidora`, () =>
        HttpResponse.json({ detail: 'boom' }, { status: 500 }),
      ),
    );

    await expect(
      ProductPage({ params: Promise.resolve({ slug: 'heladera-exhibidora' }) }),
    ).rejects.not.toBe(notFoundSignal);
    expect(notFound).not.toHaveBeenCalled();
  });
});
