import { formatDateTime } from '@/lib/format/datetime';
import { Button } from '@/components/ui/Button';
import { StarRatingDisplay } from './StarRatingDisplay';
import type { ReviewViewModel } from './types';

export interface ReviewListItemProps {
  review: ReviewViewModel;
  /**
   * Acción de moderación (admin, T-B10, `design.md` §D8) — **opcional**, y
   * sólo la pasa `ProductReviewsModeration`. La superficie pública/storefront
   * nunca la pasa, así que ningún comprador ve un botón de moderación acá:
   * ausente el prop, no se renderiza nada nuevo (sin regresión).
   */
  onToggleHidden?: (reviewId: string, hidden: boolean) => void;
}

/**
 * Un ítem de la lista de reseñas (AC-8). El comentario es texto libre del
 * cliente y se renderiza **siempre** como texto plano vía interpolación JSX
 * (`{review.comment}`) — nunca `dangerouslySetInnerHTML`, mismo criterio que
 * la descripción de producto en `ProductDetail.tsx` (`design.md` §D4,
 * `qa-plan.md` §8).
 *
 * El badge de "Oculta por moderación" del AUTOR lleva **texto**, no sólo un
 * ícono o color — y sólo se muestra en la superficie del propio autor
 * (`isOwn && hidden`), nunca para una reseña ajena. El botón de moderación
 * de abajo es una superficie DISTINTA (admin, `onToggleHidden`): indica el
 * estado actual con su propio texto ("Ocultar"/"Mostrar de nuevo"), no
 * reutiliza ese badge.
 */
export function ReviewListItem({ review, onToggleHidden }: ReviewListItemProps) {
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
      {onToggleHidden && (
        <div className="flex items-center gap-2 pt-1">
          {review.hidden && (
            <span className="text-xs font-medium text-error">Oculta por moderación</span>
          )}
          <Button
            type="button"
            variant="secondary"
            className="min-h-0 py-1"
            onClick={() => onToggleHidden(review.id, !review.hidden)}
          >
            {review.hidden ? 'Mostrar de nuevo' : 'Ocultar'}
          </Button>
        </div>
      )}
    </li>
  );
}
