import { formatDateTime } from '@/lib/format/datetime';
import { StarRatingDisplay } from './StarRatingDisplay';
import type { ReviewViewModel } from './types.provisional';

export interface ReviewListItemProps {
  review: ReviewViewModel;
}

/**
 * Un ítem de la lista de reseñas (AC-8). El comentario es texto libre del
 * cliente y se renderiza **siempre** como texto plano vía interpolación JSX
 * (`{review.comment}`) — nunca `dangerouslySetInnerHTML`, mismo criterio que
 * la descripción de producto en `ProductDetail.tsx` (`design.md` §D4,
 * `qa-plan.md` §8).
 *
 * El badge de moderación (AC-8) lleva **texto**, no sólo un ícono o color —
 * y sólo se muestra en la superficie del propio autor (`isOwn && hidden`),
 * nunca para una reseña ajena.
 */
export function ReviewListItem({ review }: ReviewListItemProps) {
  return (
    <li className="flex flex-col gap-1 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">{review.authorName}</span>
        <span className="text-sm text-muted">{formatDateTime(review.createdAt)}</span>
      </div>
      <StarRatingDisplay value={review.rating} mode="item" />
      {review.isOwn && review.hidden && (
        <p className="text-xs font-medium text-error">Oculta por moderación</p>
      )}
      {review.comment && <p className="text-sm text-foreground">{review.comment}</p>}
    </li>
  );
}
