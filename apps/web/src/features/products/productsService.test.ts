import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { productsService, type Product } from './productsService';

const API = 'http://localhost:3000';

function product(over: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    sku: 'REF-001',
    name: 'Heladera',
    description_raw: null,
    price_ars_cents: 100000,
    stock: 5,
    status: 'draft',
    category_id: 'c1',
    image_url: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('productsService', () => {
  it('list envía limit/offset y devuelve pagination', async () => {
    let url = '';
    server.use(
      http.get(`${API}/v1/admin/products`, ({ request }) => {
        url = request.url;
        return HttpResponse.json({
          data: [product()],
          pagination: { limit: 20, offset: 0, total: 1 },
        });
      }),
    );
    const page = await productsService.list({ limit: 20, offset: 0 });
    expect(url).toContain('limit=20');
    expect(url).toContain('offset=0');
    expect(page.pagination.total).toBe(1);
  });

  it('publish hace PATCH {status: published}', async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.patch(`${API}/v1/admin/products/p1`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(product({ status: 'published' }));
      }),
    );
    const p = await productsService.publish('p1');
    expect(body).toEqual({ status: 'published' });
    expect(p.status).toBe('published');
  });

  it('create con SKU duplicado → conflict', async () => {
    server.use(
      http.post(`${API}/v1/admin/products`, () =>
        HttpResponse.json(
          { type: 'dsm:catalog/conflict', status: 409, detail: 'SKU duplicado' },
          { status: 409 },
        ),
      ),
    );
    await expect(
      productsService.create({
        sku: 'X',
        name: 'x',
        price_ars_cents: 1,
        category_id: 'c1',
      }),
    ).rejects.toMatchObject({ appError: { kind: 'conflict' } });
  });
});
