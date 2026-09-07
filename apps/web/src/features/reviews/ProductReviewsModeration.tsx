'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AsyncState } from '@/lib/async';
import { AppErrorException, networkError } from '@/lib/http/errors';
import { adminReviewsService } from './adminReviewsService';
import { ReviewsList } from './ReviewsList';
import type { ReviewViewModel } from './types';

export interface ProductReviewsModerationProps {
  productSlug: string;
}

/**
 * Vista admin de moderación por-producto (US-025 AC-8, `design.md` §D8) —
 * compuesta en `/admin/productos/{id}` (T-B11), no un panel cross-producto:
 * el contrato archivado no publica `GET /admin/reviews`.
 *
 * Carga las reseñas del producto reusando `getPublicReviews` (el MISMO
 * endpoint del storefront, vía `adminReviewsService.listForProduct`) — por
 * eso ninguna reseña ya oculta aparece acá al montar (el filtro
 * `hidden_at: null` del listado público es incondicional, sin variante
 * admin). El estado `hidden` se actualiza de forma **optimista en memoria**
 * al confirmar ocultar/mostrar, sin refetchear ni sacar la fila de la lista
 * — limitación real, documentada, no silenciada: un refresh de página o
 * volver a entrar a esta pantalla ya no muestra una reseña que se ocultó en
 * una sesión anterior (el copy de abajo se lo dice al dueño explícitamente).
 */
export function ProductReviewsModeration({ productSlug }: ProductReviewsModerationProps) {
  const [state, setState] = useState<AsyncState<ReviewViewModel[]>>({ status: 'idle' });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    adminReviewsService
      .listForProduct(productSlug, controller.signal)
      .then((page) =>
        setState({
          status: 'success',
          data: page.data.map(
            (r): ReviewViewModel => ({
              id: r.id,
              authorName: r.customer_name,
              rating: r.rating,
              comment: r.comment,
              createdAt: r.created_at,
              // El listado público nunca trae una reseña oculta (§D8): el
              // único origen de `hidden: true` acá es el toggle local de
              // abajo, nunca la carga inicial.
              isOwn: false,
              hidden: false,
            }),
          ),
        }),
      )
      .catch((err) =>
        setState({
          status: 'error',
          error: err instanceof AppErrorException ? err.appError : networkError(),
        }),
      );
    return () => controller.abort();
  }, [productSlug]);

  const handleToggleHidden = useCallback(async (reviewId: string, hidden: boolean) => {
    const updated = await adminReviewsService.setHidden(reviewId, hidden);
    setState((prev) =>
      prev.status === 'success'
        ? {
            status: 'success',
            data: prev.data.map((r) =>
              r.id === reviewId ? { ...r, hidden: updated.hidden } : r,
            ),
          }
        : prev,
    );
  }, []);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-foreground">Moderación de reseñas</h2>
      <p className="text-sm text-muted">
        Ocultar una reseña la saca de la ficha pública. Podés mostrarla de nuevo mientras estés en
        esta pantalla, pero si la recargás o volvés a entrar más tarde, una reseña ya oculta deja
        de aparecer acá.
      </p>

      {(state.status === 'idle' || state.status === 'loading') && (
        <p role="status" aria-live="polite" aria-busy="true">
          Cargando reseñas…
        </p>
      )}
      {state.status === 'error' && <p role="alert">No pudimos cargar las reseñas.</p>}
      {state.status === 'success' && state.data.length === 0 && (
        <p className="text-sm text-muted">Este producto todavía no tiene reseñas.</p>
      )}
      {state.status === 'success' && state.data.length > 0 && (
        <ReviewsList
          reviews={state.data}
          onToggleHidden={(reviewId, hidden) => void handleToggleHidden(reviewId, hidden)}
        />
      )}
    </section>
  );
}
