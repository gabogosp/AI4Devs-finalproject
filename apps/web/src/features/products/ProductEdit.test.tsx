import { describe, expect, it } from 'vitest';
import { render, screen, waitForElementToBeRemoved } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { ProductEdit } from './ProductEdit';

const API = 'http://localhost:3000';
const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';

function product(over: Record<string, unknown> = {}) {
  return {
    id: PRODUCT_ID,
    sku: 'REF-001',
    slug: 'heladera-exhibidora',
    name: 'Heladera exhibidora',
    description_raw: null,
    price_ars_cents: 100000,
    stock: 5,
    status: 'draft',
    category_id: '22222222-2222-4222-8222-222222222222',
    image_url: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('ProductEdit (T-B11 — compone ProductReviewsModeration, design.md §D8)', () => {
  it('una vez que el producto carga, renderiza la sección de moderación de reseñas con el slug del producto', async () => {
    server.use(
      http.get(`${API}/v1/admin/products/${PRODUCT_ID}`, () => HttpResponse.json(product())),
      http.get(`${API}/v1/admin/categories`, () => HttpResponse.json([])),
      http.get(`${API}/v1/products/heladera-exhibidora/reviews`, () =>
        HttpResponse.json({
          average: null,
          count: 0,
          data: [],
          pagination: { limit: 20, offset: 0, total: 0 },
        }),
      ),
    );

    render(<ProductEdit id={PRODUCT_ID} />);

    const loading = screen.getByRole('status');
    await waitForElementToBeRemoved(loading);

    expect(screen.getByRole('heading', { name: 'Moderación de reseñas' })).toBeInTheDocument();
    expect(
      await screen.findByText('Este producto todavía no tiene reseñas.'),
    ).toBeInTheDocument();
  });
});
