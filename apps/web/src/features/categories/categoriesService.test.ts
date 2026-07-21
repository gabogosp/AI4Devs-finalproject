import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { categoriesService } from './categoriesService';

const API = 'http://localhost:3000';
const cat = {
  id: '1',
  slug: 'refrigeracion',
  name: 'Refrigeración',
  parent_id: null,
  created_at: '2026-01-01T00:00:00.000Z',
};

describe('categoriesService', () => {
  it('create postea SIN slug y devuelve la categoría', async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(`${API}/v1/admin/categories`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(cat, { status: 201 });
      }),
    );
    const created = await categoriesService.create({ name: 'Refrigeración' });
    expect(body.slug).toBeUndefined();
    expect(body.name).toBe('Refrigeración');
    expect(created.slug).toBe('refrigeracion');
  });

  it('list devuelve el array', async () => {
    server.use(
      http.get(`${API}/v1/admin/categories`, () => HttpResponse.json([cat])),
    );
    expect(await categoriesService.list()).toHaveLength(1);
  });

  it('409 → AppErrorException conflict', async () => {
    server.use(
      http.post(`${API}/v1/admin/categories`, () =>
        HttpResponse.json(
          { type: 'dsm:catalog/conflict', status: 409, detail: 'slug duplicado' },
          { status: 409 },
        ),
      ),
    );
    await expect(categoriesService.create({ name: 'x' })).rejects.toMatchObject({
      appError: { kind: 'conflict' },
    });
  });
});
