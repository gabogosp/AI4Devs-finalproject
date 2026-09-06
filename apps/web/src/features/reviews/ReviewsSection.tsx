import type { AsyncState } from '@/lib/async';
import { ReviewForm } from './ReviewForm';
import { ReviewGuestPrompt } from './ReviewGuestPrompt';
import { ReviewsList } from './ReviewsList';
import { ReviewsSummary } from './ReviewsSummary';
import type {
  ReviewFormFieldError,
  ReviewFormInput,
  ReviewViewModel,
  ReviewsSummaryViewModel,
  ViewerReviewState,
} from './types.provisional';

export interface ReviewsSectionProps {
  viewerState: ViewerReviewState;
  summary: ReviewsSummaryViewModel;
  reviews: AsyncState<ReviewViewModel[]>;
  onSubmitReview: (input: ReviewFormInput) => void;
  submitState: AsyncState<void>;
  fieldError?: ReviewFormFieldError;
}

/**
 * Orquestador presentacional de la sección de reseñas (`design.md` §D2).
 *
 * `viewerState` es una unión discriminada de 4 casos, nunca dos booleanos
 * combinados a mano (`isGuest`/`isEligible`) — mismo criterio que
 * `AsyncState`/`SessionState` del resto del código
 * (`frontend-standards.md` §9.3). `'ineligible'` (AC-6) es **ausencia
 * total**: ni control ni mensaje, no un texto explicando por qué.
 *
 * `reviews` se renderiza con sus 4 estados explícitos, mismo patrón que
 * `PurchaseHistoryList.tsx` — nunca un `if (data) { ... }` catch-all.
 */
export function ReviewsSection({
  viewerState,
  summary,
  reviews,
  onSubmitReview,
  submitState,
  fieldError,
}: ReviewsSectionProps) {
  return (
    <section aria-label="Reseñas y calificaciones" className="flex flex-col gap-6">
      <ReviewsSummary summary={summary} />

      {viewerState.kind === 'guest' && <ReviewGuestPrompt />}

      {viewerState.kind === 'eligible-new' && (
        <ReviewForm onSubmit={onSubmitReview} submitState={submitState} fieldError={fieldError} />
      )}

      {viewerState.kind === 'eligible-editing' && (
        <ReviewForm
          initialValue={{
            rating: viewerState.ownReview.rating,
            comment: viewerState.ownReview.comment ?? '',
          }}
          onSubmit={onSubmitReview}
          submitState={submitState}
          fieldError={fieldError}
        />
      )}

      {/* 'ineligible' → nada (AC-6): ni control ni mensaje. */}

      {(reviews.status === 'idle' || reviews.status === 'loading') && (
        <p role="status" aria-live="polite" aria-busy="true">
          Cargando reseñas…
        </p>
      )}
      {reviews.status === 'error' && (
        <p role="alert">No pudimos cargar las reseñas.</p>
      )}
      {reviews.status === 'success' && <ReviewsList reviews={reviews.data} />}
    </section>
  );
}
