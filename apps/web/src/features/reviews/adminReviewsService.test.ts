import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { adminReviewsService } from './adminReviewsService';

const API = 'http://localhost:3000';
const REVIEW_ID = '22222222-2222-4222-8222-222222222222';

describe('adminReviewsService (T-B9, design.md §D8)', () => {
  it('listForProduct() llama a GET /v1/products/{slug}/reviews — el MISMO endpoint público, sin uno admin dedicado', async () => {
    let vistaUrl = '';
    server.use(
      http.get(`${API}/v1/products/heladera-exhibidora/reviews`, ({ request }) => {
        vistaUrl = request.url;
        return HttpResponse.json({
          average: 3.5,
          count: 1,
          data: [
            {
              id: REVIEW_ID,
              customer_name: 'Ana Gómez',
              rating: 3,
              comment: 'Regular',
              created_at: '2026-08-30T10:00:00.000Z',
            },
          ],
          pagination: { limit: 20, offset: 0, total: 1 },
        });
      }),
    );

    const page = await adminReviewsService.listForProduct('heladera-exhibidora');

    expect(vistaUrl).toContain('/v1/products/heladera-exhibidora/reviews');
    expect(page.data).toHaveLength(1);
    expect(page.data[0].id).toBe(REVIEW_ID);
  });

  it('setHidden(id, true) hace PATCH /v1/admin/reviews/{id} con { hidden: true } (AC-8)', async () => {
    let body: unknown;
    server.use(
      http.patch(`${API}/v1/admin/reviews/${REVIEW_ID}`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          id: REVIEW_ID,
          rating: 3,
          comment: 'Regular',
          hidden: true,
          created_at: '2026-08-30T10:00:00.000Z',
          updated_at: '2026-08-30T11:00:00.000Z',
        });
      }),
    );

    const review = await adminReviewsService.setHidden(REVIEW_ID, true);

    expect(body).toEqual({ hidden: true });
    expect(review.hidden).toBe(true);
  });

  it('setHidden(id, false) hace PATCH con { hidden: false } — "mostrar de nuevo"', async () => {
    let body: unknown;
    server.use(
      http.patch(`${API}/v1/admin/reviews/${REVIEW_ID}`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          id: REVIEW_ID,
          rating: 3,
          comment: 'Regular',
          hidden: false,
          created_at: '2026-08-30T10:00:00.000Z',
          updated_at: '2026-08-30T11:00:00.000Z',
        });
      }),
    );

    const review = await adminReviewsService.setHidden(REVIEW_ID, false);

    expect(body).toEqual({ hidden: false });
    expect(review.hidden).toBe(false);
  });

  it('un 404 (id inexistente) propaga un AppError notFound', async () => {
    server.use(
      http.patch(`${API}/v1/admin/reviews/${REVIEW_ID}`, () =>
        HttpResponse.json(
          { type: 'dsm:catalog/not-found', title: 'Not Found', status: 404 },
          { status: 404 },
        ),
      ),
    );

    await expect(adminReviewsService.setHidden(REVIEW_ID, true)).rejects.toMatchObject({
      appError: { kind: 'notFound' },
    });
  });
});
