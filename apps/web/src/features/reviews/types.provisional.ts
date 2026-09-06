/**
 * PROVISIONAL — no deriva de ningún contrato OpenAPI (todavía no existe uno
 * para reviews, ver design.md §D1). Prohibido: importar este archivo desde
 * cualquier código que hable HTTP. Se borra en Fase B (T-B1) cuando
 * US-025-resenas-calificaciones-productos-backend publique el contrato y el
 * codegen genere `apps/web/src/api/generated/model/review*.ts`.
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
