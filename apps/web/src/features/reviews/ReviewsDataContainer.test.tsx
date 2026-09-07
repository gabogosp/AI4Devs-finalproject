import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { SessionProvider } from '@/features/account/SessionProvider';
import { SESSION_HINT_KEY } from '@/features/account/sessionState';
import { ReviewsDataContainer } from './ReviewsDataContainer';

const SITE = 'http://localhost:3000';
const SLUG = 'heladera-exhibidora';
const REVIEW_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_REVIEW_ID = '33333333-3333-4333-8333-333333333333';

const customer = {
  id: '55555555-5555-4555-8555-555555555555',
  email: 'ana@example.com',
  name: 'Ana Gómez',
  phone: null,
  avatar_url: null,
  created_at: '2026-08-22T12:00:00Z',
};

afterEach(() => window.localStorage.clear());

function mockList(over: Partial<{ average: number | null; count: number; data: unknown[] }> = {}) {
  server.use(
    http.get(`${SITE}/v1/products/${SLUG}/reviews`, () =>
      HttpResponse.json({
        average: null,
        count: 0,
        data: [],
        pagination: { limit: 20, offset: 0, total: 0 },
        ...over,
      }),
    ),
  );
}

function mockOwn(body: { eligible: boolean; review: unknown }) {
  server.use(http.get(`${SITE}/v1/me/reviews/${SLUG}`, () => HttpResponse.json(body)));
}

function autenticar() {
  window.localStorage.setItem(SESSION_HINT_KEY, '1');
  server.use(http.get(`${SITE}/v1/auth/me`, () => HttpResponse.json(customer)));
}

function montar() {
  return render(
    <SessionProvider>
      <ReviewsDataContainer productSlug={SLUG} />
    </SessionProvider>,
  );
}

describe('ReviewsDataContainer (T-B3) — invitado (sin sesión)', () => {
  it('carga el listado público y muestra ReviewGuestPrompt (AC-7), sin llamar a getOwn', async () => {
    mockList({
      average: 4.5,
      count: 1,
      data: [
        {
          id: OTHER_REVIEW_ID,
          customer_name: 'Bruno Díaz',
          rating: 5,
          comment: 'Impecable',
          created_at: '2026-08-29T10:00:00.000Z',
        },
      ],
    });
    montar();

    expect(await screen.findByText(/necesitás una cuenta/i)).toBeInTheDocument();
    expect(screen.getByText('Bruno Díaz')).toBeInTheDocument();
    expect(screen.getByText('1 reseñas')).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });

  it('con count 0 muestra "Sin reseñas todavía" (AC-4)', async () => {
    mockList();
    montar();

    expect(await screen.findByText('Sin reseñas todavía')).toBeInTheDocument();
  });

  it('un error de red al cargar el listado muestra la alerta explícita', async () => {
    server.use(http.get(`${SITE}/v1/products/${SLUG}/reviews`, () => HttpResponse.error()));
    montar();

    expect(await screen.findByRole('alert')).toHaveTextContent(/no pudimos cargar las reseñas/i);
  });
});

describe('ReviewsDataContainer — autenticado, deriva los 3 casos restantes de ViewerReviewState', () => {
  it("elegible sin reseña propia → 'eligible-new' (ReviewForm sin precarga)", async () => {
    autenticar();
    mockList();
    mockOwn({ eligible: true, review: null });
    montar();

    expect(await screen.findByRole('radiogroup')).toBeInTheDocument();
    for (let n = 1; n <= 5; n += 1) {
      expect(screen.getByRole('radio', { name: `${n} de 5 estrellas` })).toHaveAttribute(
        'aria-checked',
        'false',
      );
    }
    expect(screen.getByRole('button', { name: /publicar reseña/i })).toBeInTheDocument();
  });

  it("sin orden delivered → 'ineligible' — ausencia total, ni control ni mensaje (AC-6)", async () => {
    autenticar();
    mockList({ average: 4, count: 1, data: [] });
    mockOwn({ eligible: false, review: null });
    montar();

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    expect(screen.queryByText(/necesitás una cuenta/i)).not.toBeInTheDocument();
  });

  it("con reseña propia visible → 'eligible-editing' precargado, y la lista la muestra como 'Vos' (AC-5)", async () => {
    autenticar();
    mockList({
      average: 3,
      count: 1,
      data: [
        {
          id: REVIEW_ID,
          customer_name: 'Ana Gómez',
          rating: 3,
          comment: 'Buen producto',
          created_at: '2026-08-30T10:00:00.000Z',
        },
      ],
    });
    mockOwn({
      eligible: true,
      review: {
        id: REVIEW_ID,
        rating: 3,
        comment: 'Buen producto',
        hidden: false,
        created_at: '2026-08-30T10:00:00.000Z',
        updated_at: '2026-08-30T10:00:00.000Z',
      },
    });
    montar();

    expect(await screen.findByRole('button', { name: /guardar cambios/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '3 de 5 estrellas' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByLabelText(/comentario/i)).toHaveValue('Buen producto');
    // El listado la muestra como "Vos", no con el `customer_name` real —
    // reemplazada, no duplicada.
    expect(screen.getByText('Vos')).toBeInTheDocument();
    expect(screen.queryByText('Ana Gómez')).not.toBeInTheDocument();
  });

  it('una reseña propia OCULTA no aparece en el listado público pero sí en la vista propia (AC-8)', async () => {
    autenticar();
    // El listado público filtra `hidden_at: null` de forma incondicional
    // (`design.md` §D8) — por eso viene vacío aunque el autor tenga una
    // reseña propia.
    mockList({ average: null, count: 0, data: [] });
    mockOwn({
      eligible: true,
      review: {
        id: REVIEW_ID,
        rating: 2,
        comment: 'Tuve un problema',
        hidden: true,
        created_at: '2026-08-30T10:00:00.000Z',
        updated_at: '2026-08-30T10:00:00.000Z',
      },
    });
    montar();

    expect(await screen.findByRole('button', { name: /guardar cambios/i })).toBeInTheDocument();
    expect(screen.getByText('Vos')).toBeInTheDocument();
    expect(screen.getByText('Oculta por moderación')).toBeInTheDocument();
  });
});

describe('ReviewsDataContainer — ciclo de submit (AC-1/AC-2/AC-5/AC-6/AC-9)', () => {
  it('éxito: publica, refresca el listado y pasa a `eligible-editing` (T-B3)', async () => {
    autenticar();
    mockList({ average: null, count: 0, data: [] });
    mockOwn({ eligible: true, review: null });
    let putBody: unknown;
    server.use(
      http.put(`${SITE}/v1/me/reviews/${SLUG}`, async ({ request }) => {
        putBody = await request.json();
        return HttpResponse.json({
          id: REVIEW_ID,
          rating: 4,
          comment: '',
          hidden: false,
          created_at: '2026-08-30T10:00:00.000Z',
          updated_at: '2026-08-30T10:00:00.000Z',
        });
      }),
    );
    const { setEventSink } = await import('@/lib/observability/events');
    const eventos: string[] = [];
    setEventSink((event) => eventos.push(event));

    const user = userEvent.setup();
    montar();

    await screen.findByRole('radiogroup');
    // Tras el submit exitoso, el próximo GET del listado ya refleja la
    // reseña recién publicada.
    mockList({
      average: 4,
      count: 1,
      data: [
        {
          id: REVIEW_ID,
          customer_name: 'Ana Gómez',
          rating: 4,
          comment: '',
          created_at: '2026-08-30T10:00:00.000Z',
        },
      ],
    });

    await user.click(screen.getByRole('radio', { name: '4 de 5 estrellas' }));
    await user.click(screen.getByRole('button', { name: /publicar reseña/i }));

    expect(await screen.findByRole('button', { name: /guardar cambios/i })).toBeInTheDocument();
    expect(putBody).toEqual({ rating: 4, comment: '' });
    await waitFor(() => expect(eventos).toContain('review_submitted'));
    expect(eventos).toEqual(['review_shown', 'review_submitted']);
    setEventSink(() => {});
  });

  it('403 (no elegible en el servidor): el formulario desaparece — vuelve a `ineligible` (AC-6)', async () => {
    autenticar();
    mockList();
    mockOwn({ eligible: true, review: null });
    server.use(
      http.put(`${SITE}/v1/me/reviews/${SLUG}`, () =>
        HttpResponse.json(
          { type: 'dsm:reviews/not-eligible', title: 'Forbidden', status: 403 },
          { status: 403 },
        ),
      ),
    );
    const { setEventSink } = await import('@/lib/observability/events');
    const eventos: string[] = [];
    setEventSink((event) => eventos.push(event));

    const user = userEvent.setup();
    montar();

    await user.click(await screen.findByRole('radio', { name: '2 de 5 estrellas' }));
    await user.click(screen.getByRole('button', { name: /publicar reseña/i }));

    await waitFor(() => expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument());
    expect(screen.queryByText(/necesitás una cuenta/i)).not.toBeInTheDocument();
    expect(eventos).toEqual(['review_shown', 'review_submit_failed']);
    setEventSink(() => {});
  });

  it('422 (calificación fuera de rango real): mapea a `fieldError`, el formulario sigue visible (AC-9)', async () => {
    autenticar();
    mockList();
    mockOwn({ eligible: true, review: null });
    server.use(
      http.put(`${SITE}/v1/me/reviews/${SLUG}`, () =>
        HttpResponse.json(
          {
            type: 'dsm:reviews/invalid-rating',
            title: 'Unprocessable Entity',
            status: 422,
            errors: [{ field: 'rating', message: 'La calificación debe estar entre 1 y 5.' }],
          },
          { status: 422 },
        ),
      ),
    );
    const { setEventSink } = await import('@/lib/observability/events');
    const eventos: string[] = [];
    setEventSink((event) => eventos.push(event));

    const user = userEvent.setup();
    montar();

    await user.click(await screen.findByRole('radio', { name: '3 de 5 estrellas' }));
    await user.click(screen.getByRole('button', { name: /publicar reseña/i }));

    expect(
      await screen.findByText('La calificación debe estar entre 1 y 5.'),
    ).toBeInTheDocument();
    // El formulario sigue ahí — 422 no es `forbidden`, no vuelve a `ineligible`.
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    expect(eventos).toEqual(['review_shown', 'review_submit_failed']);
    setEventSink(() => {});
  });
});
