import { parseContract } from '@/lib/http/contract';
import { getPublicReviews, getOwnReview, upsertOwnReview } from '@/api/generated/endpoints';
import {
  GetPublicReviewsResponse,
  GetOwnReviewResponse,
  UpsertOwnReviewResponse,
} from '@/api/generated/zod';
import type {
  GetPublicReviewsParams,
  OwnReviewResponse,
  PublicReviewsResponse,
  Review,
  UpsertReviewRequest,
} from '@/api/generated/model';

/**
 * Tipos DERIVADOS DEL CONTRATO (`frontend-standards.md` §3.1/§3.2). Nunca a mano.
 */
export type { GetPublicReviewsParams, OwnReviewResponse, PublicReviewsResponse, Review };
export type UpsertReviewInput = UpsertReviewRequest;

/**
 * Igual que `accountService`/`orderHistoryService`: la marca hace que la
 * llamada salga same-origin y con cookies de sesión (ADR-0013) — sin ella
 * iría al API directo y la cookie no volvería.
 */
const conSesion = { session: 'customer' } as const;

/**
 * Repositorio (`frontend-standards.md` §11.5) sobre `getPublicReviews`/
 * `getOwnReview`/`upsertOwnReview` generados (US-025 `design.md` §D5).
 * Ningún componente importa `@/api/generated/endpoints` directamente.
 *
 * `list` es **público** (sin `session`) — mismo criterio que
 * `storefrontService`: el GET de reseñas de un producto no requiere sesión
 * (AC-3/AC-4). `getOwn`/`upsert` sí llevan `session: 'customer'`: requieren
 * la cookie de sesión (AC-6/AC-7).
 */
export const reviewsService = {
  async list(
    slug: string,
    params: GetPublicReviewsParams = {},
    signal?: AbortSignal,
  ): Promise<PublicReviewsResponse> {
    const res = await getPublicReviews(slug, params, { signal });
    return parseContract(GetPublicReviewsResponse, res.data);
  },

  /**
   * AC-5/AC-6/AC-7: elegibilidad + reseña propia (si existe, sin importar si
   * está oculta — AC-8, transparencia hacia el autor) — la fuente que
   * `ReviewsDataContainer` (T-B3) usa para derivar `ViewerReviewState`.
   */
  async getOwn(slug: string, signal?: AbortSignal): Promise<OwnReviewResponse> {
    const res = await getOwnReview(slug, { ...conSesion, signal });
    return parseContract(GetOwnReviewResponse, res.data);
  },

  /**
   * AC-1/AC-2/AC-5: upsert idempotente — crea si no existe, actualiza la
   * misma reseña si ya existe. 403 (AC-6) y 422 (AC-9) llegan como
   * `AppErrorException`, que el llamador (`ReviewsDataContainer`) traduce.
   */
  async upsert(slug: string, input: UpsertReviewInput): Promise<Review> {
    const res = await upsertOwnReview(slug, input, conSesion);
    return parseContract(UpsertOwnReviewResponse, res.data);
  },
};
