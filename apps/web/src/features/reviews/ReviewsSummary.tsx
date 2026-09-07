import type { ReviewsSummaryViewModel } from './types';
import { StarRatingDisplay } from './StarRatingDisplay';

export interface ReviewsSummaryProps {
  summary: ReviewsSummaryViewModel;
}

/**
 * Resumen de calificaciones (AC-3/AC-4). Con `count === 0` no se muestra
 * ningún promedio ni "0 reseñas" — "Sin reseñas todavía" es el único texto,
 * porque un promedio de 0 leído por un lector de pantalla sugeriría que el
 * producto tiene reseñas negativas en vez de ninguna.
 */
export function ReviewsSummary({ summary }: ReviewsSummaryProps) {
  if (summary.count === 0) {
    return <p className="text-sm text-muted">Sin reseñas todavía</p>;
  }

  return (
    <div className="flex items-center gap-2">
      <StarRatingDisplay value={summary.average} mode="average" />
      <span className="font-medium tabular-nums">{summary.average.toFixed(1)}</span>
      <span className="text-sm text-muted">{summary.count} reseñas</span>
    </div>
  );
}
