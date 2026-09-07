import { describe, expect, it } from 'vitest';
import { render, screen, waitForElementToBeRemoved } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { ProductReviewsModeration } from './ProductReviewsModeration';

const API = 'http://localhost:3000';
const SLUG = 'heladera-exhibidora';
const REVIEW_ID = '22222222-2222-4222-8222-222222222222';

function paginaConUnaResena(over: Record<string, unknown> = {}) {
  return {
    average: 4,
    count: 1,
    data: [
      {
        id: REVIEW_ID,
        customer_name: 'Ana Gómez',
        rating: 4,
        comment: 'Buen producto',
        created_at: '2026-08-30T10:00:00.000Z',
        ...over,
      },
    ],
    pagination: { limit: 20, offset: 0, total: 1 },
  };
}

describe('ProductReviewsModeration (T-B10, design.md §D8)', () => {
  it('muestra role="status" mientras carga, y la lista al resolver', async () => {
    server.use(
      http.get(`${API}/v1/products/${SLUG}/reviews`, async () => {
        await new Promise((r) => setTimeout(r, 10));
        return HttpResponse.json(paginaConUnaResena());
      }),
    );

    render(<ProductReviewsModeration productSlug={SLUG} />);

    const status = screen.getByRole('status');
    await waitForElementToBeRemoved(status);

    expect(screen.getByText('Ana Gómez')).toBeInTheDocument();
  });

  it('con 0 reseñas muestra un texto explícito, sin lista', async () => {
    server.use(
      http.get(`${API}/v1/products/sin-resenas/reviews`, () =>
        HttpResponse.json({ average: null, count: 0, data: [], pagination: { limit: 20, offset: 0, total: 0 } }),
      ),
    );

    render(<ProductReviewsModeration productSlug="sin-resenas" />);

    expect(await screen.findByText('Este producto todavía no tiene reseñas.')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('un error de red muestra role="alert"', async () => {
    server.use(http.get(`${API}/v1/products/${SLUG}/reviews`, () => HttpResponse.error()));

    render(<ProductReviewsModeration productSlug={SLUG} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/no pudimos cargar/i);
  });

  it('ocultar una reseña actualiza esa fila en memoria SIN sacarla de la lista ni refetchear (AC-8, §D8)', async () => {
    const user = userEvent.setup();
    let getCalls = 0;
    server.use(
      http.get(`${API}/v1/products/${SLUG}/reviews`, () => {
        getCalls += 1;
        return HttpResponse.json(paginaConUnaResena());
      }),
      http.patch(`${API}/v1/admin/reviews/${REVIEW_ID}`, async ({ request }) => {
        const body = (await request.json()) as { hidden: boolean };
        return HttpResponse.json({
          id: REVIEW_ID,
          rating: 4,
          comment: 'Buen producto',
          hidden: body.hidden,
          created_at: '2026-08-30T10:00:00.000Z',
          updated_at: '2026-08-30T11:00:00.000Z',
        });
      }),
    );

    render(<ProductReviewsModeration productSlug={SLUG} />);
    await screen.findByText('Ana Gómez');
    expect(getCalls).toBe(1);

    await user.click(screen.getByRole('button', { name: 'Ocultar' }));

    // La fila sigue en la lista (no desaparece) y ahora ofrece "Mostrar de
    // nuevo" — sin un segundo GET (estado optimista, no refetch).
    expect(await screen.findByRole('button', { name: 'Mostrar de nuevo' })).toBeInTheDocument();
    expect(screen.getByText('Ana Gómez')).toBeInTheDocument();
    expect(getCalls).toBe(1);
  });

  it('mostrar de nuevo una reseña oculta vuelve a ofrecer "Ocultar"', async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`${API}/v1/products/${SLUG}/reviews`, () => HttpResponse.json(paginaConUnaResena())),
      http.patch(`${API}/v1/admin/reviews/${REVIEW_ID}`, async ({ request }) => {
        const body = (await request.json()) as { hidden: boolean };
        return HttpResponse.json({
          id: REVIEW_ID,
          rating: 4,
          comment: 'Buen producto',
          hidden: body.hidden,
          created_at: '2026-08-30T10:00:00.000Z',
          updated_at: '2026-08-30T11:00:00.000Z',
        });
      }),
    );

    render(<ProductReviewsModeration productSlug={SLUG} />);
    await screen.findByText('Ana Gómez');

    await user.click(screen.getByRole('button', { name: 'Ocultar' }));
    await screen.findByRole('button', { name: 'Mostrar de nuevo' });

    await user.click(screen.getByRole('button', { name: 'Mostrar de nuevo' }));

    expect(await screen.findByRole('button', { name: 'Ocultar' })).toBeInTheDocument();
  });
});
