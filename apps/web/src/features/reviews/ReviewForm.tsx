'use client';

import { useState, type FormEvent } from 'react';
import type { AsyncState } from '@/lib/async';
import { Button } from '@/components/ui/Button';
import { StarRatingInput } from './StarRatingInput';
import type { ReviewFormFieldError, ReviewFormInput } from './types.provisional';

export interface ReviewFormProps {
  initialValue?: ReviewFormInput;
  onSubmit: (input: ReviewFormInput) => void;
  submitState: AsyncState<void>;
  fieldError?: ReviewFormFieldError;
}

const RATING_ERROR_ID = 'review-form-rating-error';
const COMMENT_ERROR_ID = 'review-form-comment-error';

/**
 * Formulario de reseña (AC-2/AC-5/AC-9, `design.md` §D4).
 *
 * La validación de rango 1-5 es estructuralmente inalcanzable desde acá
 * (`StarRatingInput` sólo puede producir 1-5) — lo único que este componente
 * hace en el cliente es no dejar enviar sin ninguna calificación. La
 * autoridad real es el backend: `fieldError` es un slot controlado por
 * props, alimentado por el padre (`ReviewsDataContainer`, Fase B) a partir de
 * un 422 real, nunca inventado acá.
 *
 * `submitState` es un prop controlado (no estado local): quien orquesta el
 * envío real y decide cuándo está `'loading'` es el padre.
 */
export function ReviewForm({ initialValue, onSubmit, submitState, fieldError }: ReviewFormProps) {
  const [rating, setRating] = useState(initialValue?.rating ?? 0);
  const [comment, setComment] = useState(initialValue?.comment ?? '');

  const isEditing = initialValue !== undefined;
  const isSubmitting = submitState.status === 'loading';
  const canSubmit = rating >= 1 && rating <= 5 && !isSubmitting;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit({ rating, comment });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-foreground">Tu calificación</span>
        <StarRatingInput value={rating} onChange={setRating} disabled={isSubmitting} />
        {fieldError?.field === 'rating' && (
          <p id={RATING_ERROR_ID} role="alert" className="text-xs text-error">
            {fieldError.message}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="review-form-comment" className="text-sm font-medium text-foreground">
          Comentario (opcional)
        </label>
        <textarea
          id="review-form-comment"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          disabled={isSubmitting}
          aria-invalid={fieldError?.field === 'comment' || undefined}
          aria-describedby={fieldError?.field === 'comment' ? COMMENT_ERROR_ID : undefined}
          className="min-h-[96px] rounded-sm border border-border bg-surface px-3 py-2 text-base focus:outline-none focus-visible:shadow-focus"
        />
        {fieldError?.field === 'comment' && (
          <p id={COMMENT_ERROR_ID} role="alert" className="text-xs text-error">
            {fieldError.message}
          </p>
        )}
      </div>

      <Button type="submit" disabled={!canSubmit} loading={isSubmitting} className="w-fit">
        {isEditing ? 'Guardar cambios' : 'Publicar reseña'}
      </Button>
    </form>
  );
}
