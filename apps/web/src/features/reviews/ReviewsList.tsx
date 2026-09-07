import { ReviewListItem } from './ReviewListItem';
import type { ReviewViewModel } from './types';

export interface ReviewsListProps {
  reviews: ReviewViewModel[];
  /**
   * Acción de moderación (admin, T-B10) — opcional, sólo la pasa
   * `ProductReviewsModeration`. Ausente en la superficie pública/storefront
   * (`design.md` §D8): sin este prop, `ReviewListItem` no cambia.
   */
  onToggleHidden?: (reviewId: string, hidden: boolean) => void;
}

/**
 * Lista de reseñas. Con lista vacía no renderiza ningún `<ul>` — el caso
 * "sin reseñas" ya lo cubre `ReviewsSummary` (AC-4) con un texto explícito;
 * un `<ul>` vacío acá sería redundante y sin explicación (`design.md` §D2).
 */
export function ReviewsList({ reviews, onToggleHidden }: ReviewsListProps) {
  if (reviews.length === 0) return null;

  return (
    <ul className="flex flex-col divide-y divide-border">
      {reviews.map((review) => (
        <ReviewListItem key={review.id} review={review} onToggleHidden={onToggleHidden} />
      ))}
    </ul>
  );
}
