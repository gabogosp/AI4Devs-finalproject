import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AsyncState } from '@/lib/async';
import { ReviewsSection } from './ReviewsSection';
import type { ReviewViewModel, ViewerReviewState } from './types.provisional';

const SUMMARY = { average: 4.2, count: 5 };

function ownReview(): ReviewViewModel {
  return {
    id: 'own-1',
    authorName: 'Vos',
    rating: 3,
    comment: 'Buen producto',
    createdAt: '2026-08-30T10:00:00.000Z',
    isOwn: true,
    hidden: false,
  };
}

function otherReview(): ReviewViewModel {
  return {
    id: 'r2',
    authorName: 'Bruno Díaz',
    rating: 5,
    comment: 'Impecable',
    createdAt: '2026-08-29T10:00:00.000Z',
    isOwn: false,
    hidden: false,
  };
}

function renderSection(
  viewerState: ViewerReviewState,
  reviews: AsyncState<ReviewViewModel[]> = { status: 'success', data: [otherReview()] },
) {
  return render(
    <ReviewsSection
      viewerState={viewerState}
      summary={SUMMARY}
      reviews={reviews}
      onSubmitReview={vi.fn()}
      submitState={{ status: 'idle' }}
    />,
  );
}

describe('ReviewsSection (T-A9) — los 4 viewerState', () => {
  it("'guest' renderiza ReviewGuestPrompt y NO ReviewForm", () => {
    renderSection({ kind: 'guest' });
    expect(screen.getByText(/necesitás una cuenta/i)).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });

  it("'ineligible' no renderiza ni ReviewForm ni ReviewGuestPrompt (AC-6 — ausencia total)", () => {
    renderSection({ kind: 'ineligible' });
    expect(screen.queryByText(/necesitás una cuenta/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });

  it("'eligible-new' renderiza ReviewForm sin initialValue (ninguna estrella marcada)", () => {
    renderSection({ kind: 'eligible-new' });
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    for (let n = 1; n <= 5; n += 1) {
      expect(screen.getByRole('radio', { name: `${n} de 5 estrellas` })).toHaveAttribute(
        'aria-checked',
        'false',
      );
    }
    expect(screen.getByRole('button', { name: /publicar reseña/i })).toBeInTheDocument();
  });

  it("'eligible-editing' renderiza ReviewForm con initialValue igual a ownReview (AC-5)", () => {
    renderSection({ kind: 'eligible-editing', ownReview: ownReview() });
    expect(screen.getByRole('radio', { name: '3 de 5 estrellas' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByLabelText(/comentario/i)).toHaveValue('Buen producto');
    expect(screen.getByRole('button', { name: /guardar cambios/i })).toBeInTheDocument();
  });
});

describe('ReviewsSection — estados explícitos de `reviews: AsyncState<...>`', () => {
  it("'idle'/'loading' muestran un estado de carga explícito", () => {
    renderSection({ kind: 'ineligible' }, { status: 'loading' });
    expect(screen.getByRole('status')).toHaveTextContent(/cargando reseñas/i);
  });

  it("'success' renderiza la lista de reseñas", () => {
    renderSection({ kind: 'ineligible' }, { status: 'success', data: [otherReview()] });
    expect(screen.getByText('Bruno Díaz')).toBeInTheDocument();
  });

  it("'error' muestra un mensaje explícito, no la lista", () => {
    renderSection({ kind: 'ineligible' }, {
      status: 'error',
      error: { kind: 'network', message: 'red' },
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/no pudimos cargar las reseñas/i);
    expect(screen.queryByText('Bruno Díaz')).not.toBeInTheDocument();
  });
});
