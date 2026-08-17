import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { ProductList } from './ProductList';
import type { Product } from './productsService';

const API = 'http://localhost:3000';

function product(i: number): Product {
  return {
    id: `1111111${i}-1111-4111-8111-111111111111`,
    sku: `SKU-${i}`,
    slug: `producto-${i}`,
    name: `Producto ${i}`,
    description_raw: null,
    price_ars_cents: 100000 + i,
    stock: i,
    status: 'draft',
    category_id: '22222222-2222-4222-8222-222222222222',
    image_url: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

describe('ProductList (TanStack Table, paginación server-side)', () => {
  it('carga la primera página y muestra el total + precio formateado', async () => {
    server.use(
      http.get(`${API}/v1/admin/products`, ({ request }) => {
        const offset = new URL(request.url).searchParams.get('offset');
        expect(offset).toBe('0');
        return HttpResponse.json({
          data: [product(1)],
          pagination: { limit: 20, offset: 0, total: 42 },
        });
      }),
    );
    render(<ProductList />);
    expect(await screen.findByText('Producto 1')).toBeInTheDocument();
    expect(screen.getByText('42 productos')).toBeInTheDocument();
    // precio formateado ARS
    expect(screen.getByText(/\$/)).toBeInTheDocument();
    // badge de estado con texto
    expect(screen.getByText('Borrador')).toBeInTheDocument();
  });

  it('"Siguiente" avanza el offset y pide la página 2', async () => {
    const offsets: string[] = [];
    server.use(
      http.get(`${API}/v1/admin/products`, ({ request }) => {
        const offset =
          new URL(request.url).searchParams.get('offset') ?? '0';
        offsets.push(offset);
        return HttpResponse.json({
          data: [product(offset === '0' ? 1 : 2)],
          pagination: { limit: 20, offset: Number(offset), total: 42 },
        });
      }),
    );
    render(<ProductList />);
    await screen.findByText('Producto 1');
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(await screen.findByText('Producto 2')).toBeInTheDocument();
    expect(offsets).toContain('20');
  });
});
