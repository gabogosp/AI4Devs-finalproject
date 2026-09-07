/**
 * Tipos de dominio de UI de la feature de reseñas (`frontend-standards.md`
 * §3.4 — "domain models... contienen sólo los campos que la feature
 * realmente usa"). A diferencia de `Review`/`PublicReview`/`OwnReviewResponse`
 * (`@/api/generated/model`, T-B1), estos NO son un espejo 1:1 de un DTO: son
 * la forma que consumen los componentes presentacionales de Fase A, y
 * `ReviewsDataContainer` (T-B3) es quien los sintetiza combinando las
 * respuestas reales de `getPublicReviews`/`getOwnReview` (ver `design.md`
 * §D5). Reemplaza a `types.provisional.ts` (borrado en T-B1) — mismo shape,
 * ya no "provisional": el contrato existe y esto es la capa de mapeo
 * DTO→dominio que ese contrato hace posible.
 */
export interface ReviewViewModel {
  id: string;
  authorName: string;
  rating: number; // 1-5
  comment: string | null;
  createdAt: string; // ISO 8601
  isOwn: boolean;
  hidden: boolean; // AC-8 — sólo relevante cuando isOwn === true
}

export interface ReviewsSummaryViewModel {
  average: number;
  count: number;
}

export type ViewerReviewState =
  | { kind: 'guest' }
  | { kind: 'ineligible' }
  | { kind: 'eligible-new' }
  | { kind: 'eligible-editing'; ownReview: ReviewViewModel };

export interface ReviewFormInput {
  rating: number;
  comment: string;
}

export interface ReviewFormFieldError {
  field: 'rating' | 'comment';
  message: string;
}
