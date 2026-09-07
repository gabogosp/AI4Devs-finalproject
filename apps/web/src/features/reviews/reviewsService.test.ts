import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { reviewsService } from './reviewsService';

const SITE = 'http://localhost:3000';
const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const REVIEW_ID = '22222222-2222-4222-8222-222222222222';

describe('reviewsService', () => {
  it('list() llama a GET /v1/products/{slug}/reviews y devuelve average/count/data/pagination parseados (AC-3/AC-4)', async () => {
    let vistaUrl: URL | undefined;
    server.use(
      http.get(`${SITE}/v1/products/heladera-exhibidora/reviews`, ({ request }) => {
        vistaUrl = new URL(request.url);
        return HttpResponse.json({
          average: 4.5,
          count: 2,
          data: [
            {
              id: REVIEW_ID,
              customer_name: 'Ana Gómez',
              rating: 5,
              comment: 'Excelente',
              created_at: '2026-08-30T10:00:00.000Z',
            },
          ],
          pagination: { limit: 20, offset: 0, total: 2 },
        });
      }),
    );

    const page = await reviewsService.list('heladera-exhibidora', { limit: 20, offset: 0 });

    expect(vistaUrl?.searchParams.get('limit')).toBe('20');
    expect(page.average).toBe(4.5);
    expect(page.count).toBe(2);
    expect(page.data).toHaveLength(1);
  });

  it('list() con count === 0 devuelve average: null (AC-4), sin sesión', async () => {
    server.use(
      http.get(`${SITE}/v1/products/sin-resenas/reviews`, () =>
        HttpResponse.json({ average: null, count: 0, data: [], pagination: { limit: 20, offset: 0, total: 0 } }),
      ),
    );

    const page = await reviewsService.list('sin-resenas');

    expect(page.average).toBeNull();
    expect(page.count).toBe(0);
  });

  it('getOwn() llama a GET /v1/me/reviews/{productId} con cookies de sesión (AC-6/AC-7)', async () => {
    server.use(
      http.get(`${SITE}/v1/me/reviews/${PRODUCT_ID}`, () =>
        HttpResponse.json({ eligible: true, review: null }),
      ),
    );

    const own = await reviewsService.getOwn(PRODUCT_ID);

    expect(own.eligible).toBe(true);
    expect(own.review).toBeNull();
  });

  it('getOwn() sin sesión propaga un AppError unauthorized (401)', async () => {
    server.use(
      http.get(`${SITE}/v1/me/reviews/${PRODUCT_ID}`, () =>
        HttpResponse.json(
          { type: 'dsm:auth/unauthenticated', title: 'Unauthorized', status: 401 },
          { status: 401 },
        ),
      ),
    );

    await expect(reviewsService.getOwn(PRODUCT_ID)).rejects.toMatchObject({
      appError: { kind: 'unauthorized' },
    });
  });

  it('upsert() llama a PUT /v1/me/reviews/{productId} y devuelve la reseña creada/actualizada (AC-1/AC-2/AC-5)', async () => {
    let body: unknown;
    server.use(
      http.put(`${SITE}/v1/me/reviews/${PRODUCT_ID}`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          id: REVIEW_ID,
          rating: 4,
          comment: null,
          hidden: false,
          created_at: '2026-08-30T10:00:00.000Z',
          updated_at: '2026-08-30T10:00:00.000Z',
        });
      }),
    );

    const review = await reviewsService.upsert(PRODUCT_ID, { rating: 4 });

    expect(body).toEqual({ rating: 4 });
    expect(review.rating).toBe(4);
    expect(review.comment).toBeNull();
  });

  it('upsert() con 403 propaga un AppError forbidden (AC-6, no comprado)', async () => {
    server.use(
      http.put(`${SITE}/v1/me/reviews/${PRODUCT_ID}`, () =>
        HttpResponse.json(
          { type: 'dsm:reviews/not-eligible', title: 'Forbidden', status: 403 },
          { status: 403 },
        ),
      ),
    );

    await expect(
      reviewsService.upsert(PRODUCT_ID, { rating: 3 }),
    ).rejects.toMatchObject({ appError: { kind: 'forbidden' } });
  });

  it('upsert() con 422 propaga un AppError validation (AC-9, rating fuera de rango)', async () => {
    server.use(
      http.put(`${SITE}/v1/me/reviews/${PRODUCT_ID}`, () =>
        HttpResponse.json(
          { type: 'dsm:reviews/invalid-rating', title: 'Unprocessable Entity', status: 422 },
          { status: 422 },
        ),
      ),
    );

    await expect(
      reviewsService.upsert(PRODUCT_ID, { rating: 3 }),
    ).rejects.toMatchObject({ appError: { kind: 'validation' } });
  });

  it('una respuesta que no cumple el contrato falla en el borde, no en la UI', async () => {
    server.use(
      http.get(`${SITE}/v1/products/heladera-exhibidora/reviews`, () =>
        HttpResponse.json({ data: [{}] }),
      ),
    );

    await expect(reviewsService.list('heladera-exhibidora')).rejects.toBeTruthy();
  });
});
