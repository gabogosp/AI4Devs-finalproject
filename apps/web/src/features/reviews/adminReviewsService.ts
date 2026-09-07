import { parseContract } from '@/lib/http/contract';
import { getPublicReviews, moderateReview } from '@/api/generated/endpoints';
import { GetPublicReviewsResponse, ModerateReviewResponse } from '@/api/generated/zod';
import type { PublicReviewsResponse, Review } from '@/api/generated/model';

/**
 * Tipos DERIVADOS DEL CONTRATO (`frontend-standards.md` §3.1/§3.2). Nunca a mano.
 */
export type { PublicReviewsResponse, Review };

/**
 * Repositorio (`frontend-standards.md` §11.5) de la superficie ADMIN de
 * moderación (US-025 AC-8, `design.md` §D8). Mismo criterio que
 * `productsService.ts`: sin marca `session` — el token admin viaja por
 * `Authorization: Bearer` desde `getAuthToken()`, inyectado automáticamente
 * por el mutator (`apps/web/src/lib/http/client.ts`), no por una cookie.
 *
 * `listForProduct` delega en `getPublicReviews(slug)` — el MISMO endpoint
 * que consume el storefront. No hay un `GET /admin/reviews` dedicado en el
 * contrato archivado (`design.md` §D8): moderar exige conocer el `id` de
 * antemano, y ese listado por-producto es la única fuente que el contrato
 * publica para conseguirlo.
 */
export const adminReviewsService = {
  async listForProduct(slug: string, signal?: AbortSignal): Promise<PublicReviewsResponse> {
    const res = await getPublicReviews(slug, {}, { signal });
    return parseContract(GetPublicReviewsResponse, res.data);
  },

  /**
   * `PATCH /admin/reviews/{id}` (AC-8) — soft-flag, nunca borra la fila ni
   * edita el contenido. `reviewId` es el `id` de la reseña (no el del
   * producto) — el mismo `id` que trae cada fila de `listForProduct`.
   */
  async setHidden(reviewId: string, hidden: boolean): Promise<Review> {
    const res = await moderateReview(reviewId, { hidden });
    return parseContract(ModerateReviewResponse, res.data);
  },
};
