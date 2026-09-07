'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AsyncState } from '@/lib/async';
import { AppErrorException, networkError } from '@/lib/http/errors';
import { track } from '@/lib/observability/events';
import { useSession } from '@/features/account/SessionProvider';
import { reviewsService, type OwnReviewResponse, type Review } from './reviewsService';
import { ReviewsSection } from './ReviewsSection';
import type {
  ReviewFormFieldError,
  ReviewFormInput,
  ReviewViewModel,
  ReviewsSummaryViewModel,
  ViewerReviewState,
} from './types';

export interface ReviewsDataContainerProps {
  productSlug: string;
}

/**
 * `design.md` §D5: la reseña propia viaja SIEMPRE en `Vos` (mismo copy que
 * `ReviewsSection.test.tsx`/`.a11y.test.tsx` ya fijan como convención) —
 * nunca el `customer_name` real, aunque el listado público lo traiga, porque
 * esta vista es la del propio autor viendo su reseña.
 */
function toOwnViewModel(review: Review): ReviewViewModel {
  return {
    id: review.id,
    authorName: 'Vos',
    rating: review.rating,
    comment: review.comment,
    createdAt: review.created_at,
    isOwn: true,
    hidden: review.hidden,
  };
}

/**
 * Antepone/reemplaza la reseña propia en la lista pública. El listado
 * público filtra `hidden_at: null` de forma incondicional (`design.md`
 * §D8) — así que una reseña propia oculta NUNCA aparece en `base`, y hay que
 * anteponerla a mano para que el autor la siga viendo (AC-8, transparencia
 * hacia el autor). Si no está oculta, ya viene en `base` con el
 * `customer_name` real: ese caso se reemplaza (no se duplica), marcando
 * `isOwn: true`.
 */
function mergeOwnReview(base: ReviewViewModel[], own: ReviewViewModel): ReviewViewModel[] {
  return base.some((r) => r.id === own.id)
    ? base.map((r) => (r.id === own.id ? own : r))
    : [own, ...base];
}

/**
 * Wiring real de la sección de reseñas (T-B3, `design.md` §D5/§D2) — hoja
 * `'use client'`, la única que compone `ProductDetail.tsx` (T-B4).
 *
 * Dos fetches independientes, nunca uno esperando al otro:
 * - `reviewsService.list(productSlug)` — público, corre siempre, una sola
 *   vez al montar (AC-3/AC-4). No depende de la sesión.
 * - `reviewsService.getOwn(productSlug)` — sólo si `useSession()` resuelve
 *   `authenticated`; deriva `ViewerReviewState` (AC-5/AC-6/AC-7) sin pisar
 *   el listado público ya cargado.
 *
 * Con la sesión todavía sin resolver (`unknown`/`authenticating`) o en
 * `error` (no se pudo verificar), el estado más conservador es
 * `'ineligible'`: ausencia total (AC-6), nunca `'guest'` ni `'eligible-*'`
 * inventado sin que el backend lo haya confirmado.
 */
export function ReviewsDataContainer({ productSlug }: ReviewsDataContainerProps) {
  const { state: sessionState } = useSession();
  const [publicState, setPublicState] = useState<
    AsyncState<{ summary: ReviewsSummaryViewModel; base: ReviewViewModel[] }>
  >({ status: 'idle' });
  const [ownResponse, setOwnResponse] = useState<OwnReviewResponse | null>(null);
  const [submitState, setSubmitState] = useState<AsyncState<void>>({ status: 'idle' });
  const [fieldError, setFieldError] = useState<ReviewFormFieldError | undefined>(undefined);
  const vistaRegistrada = useRef(false);

  const loadPublic = useCallback(async () => {
    setPublicState((prev) => (prev.status === 'success' ? prev : { status: 'loading' }));
    try {
      const page = await reviewsService.list(productSlug);
      setPublicState({
        status: 'success',
        data: {
          summary: { average: page.average ?? 0, count: page.count },
          base: page.data.map(
            (r): ReviewViewModel => ({
              id: r.id,
              authorName: r.customer_name,
              rating: r.rating,
              comment: r.comment,
              createdAt: r.created_at,
              isOwn: false,
              hidden: false,
            }),
          ),
        },
      });
    } catch (err) {
      setPublicState({
        status: 'error',
        error: err instanceof AppErrorException ? err.appError : networkError(),
      });
    }
  }, [productSlug]);

  useEffect(() => {
    void loadPublic();
  }, [loadPublic]);

  useEffect(() => {
    if (sessionState.kind !== 'authenticated') {
      setOwnResponse(null);
      return;
    }
    let vigente = true;
    reviewsService
      .getOwn(productSlug)
      .then((res) => {
        if (vigente) setOwnResponse(res);
      })
      .catch(() => {
        // No se puede afirmar elegibilidad sin la respuesta — se cae al
        // conservador `'ineligible'` (derivado más abajo), nunca se inventa.
        if (vigente) setOwnResponse(null);
      });
    return () => {
      vigente = false;
    };
  }, [productSlug, sessionState.kind]);

  const viewerState: ViewerReviewState =
    sessionState.kind === 'anonymous'
      ? { kind: 'guest' }
      : sessionState.kind === 'authenticated' && ownResponse
        ? ownResponse.review
          ? { kind: 'eligible-editing', ownReview: toOwnViewModel(ownResponse.review) }
          : { kind: ownResponse.eligible ? 'eligible-new' : 'ineligible' }
        : { kind: 'ineligible' };

  const reviews: AsyncState<ReviewViewModel[]> = useMemo(() => {
    if (publicState.status === 'success') {
      return {
        status: 'success',
        data: ownResponse?.review
          ? mergeOwnReview(publicState.data.base, toOwnViewModel(ownResponse.review))
          : publicState.data.base,
      };
    }
    if (publicState.status === 'error') {
      return { status: 'error', error: publicState.error };
    }
    return { status: publicState.status };
  }, [publicState, ownResponse]);

  const summary: ReviewsSummaryViewModel =
    publicState.status === 'success' ? publicState.data.summary : { average: 0, count: 0 };

  useEffect(() => {
    if (reviews.status !== 'success' || vistaRegistrada.current) return;
    vistaRegistrada.current = true;
    track('review_shown', { review_count: reviews.data.length });
  }, [reviews]);

  const handleSubmit = useCallback(
    (input: ReviewFormInput) => {
      setSubmitState({ status: 'loading' });
      setFieldError(undefined);
      reviewsService
        .upsert(productSlug, { rating: input.rating, comment: input.comment })
        .then((updated) => {
          track('review_submitted');
          setSubmitState({ status: 'success', data: undefined });
          // La respuesta de `upsert` YA es la reseña propia actualizada — se
          // usa directamente en vez de un segundo `getOwn` (AC-1/AC-2/AC-5).
          // `eligible` sólo puede ser `true`: el backend acaba de aceptar el
          // upsert, así que la elegibilidad quedó demostrada por el hecho.
          setOwnResponse({ eligible: true, review: updated });
          // El promedio/conteo (AC-3) sí requiere un refetch real del
          // listado público — nunca se recalcula a mano en el cliente.
          void loadPublic();
        })
        .catch((err: unknown) => {
          track('review_submit_failed');
          if (!(err instanceof AppErrorException)) {
            setSubmitState({ status: 'error', error: networkError() });
            return;
          }
          const appError = err.appError;
          if (appError.kind === 'forbidden') {
            // AC-6: el backend es la autoridad real — vuelve a `ineligible`
            // aunque el cliente hubiera mostrado el formulario antes.
            setSubmitState({ status: 'idle' });
            setOwnResponse({ eligible: false, review: null });
            return;
          }
          if (appError.kind === 'validation') {
            // AC-9: mapeo del 422 real a `fieldError`, nunca inventado.
            setSubmitState({ status: 'idle' });
            const fe = appError.fieldErrors[0];
            setFieldError({
              field: fe?.field === 'comment' ? 'comment' : 'rating',
              message: fe?.message ?? appError.message,
            });
            return;
          }
          setSubmitState({ status: 'error', error: appError });
        });
    },
    [productSlug, loadPublic],
  );

  return (
    <ReviewsSection
      viewerState={viewerState}
      summary={summary}
      reviews={reviews}
      onSubmitReview={handleSubmit}
      submitState={submitState}
      fieldError={fieldError}
    />
  );
}
