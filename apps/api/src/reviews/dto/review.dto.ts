import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Review } from '@dsm/db';
import { ReviewWithAuthor } from '../reviews.repository';

/** Paginación de `GET /v1/products/:slug/reviews` — mismo shape que `ListProductsQueryDto`. */
export class ListReviewsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit = 20;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset = 0;
}

/**
 * Entrada de `PUT /v1/me/reviews/:slug` (US-025 AC-1/AC-2/AC-9).
 * `comment` es opcional (AC-2 — sólo calificar es válido); cuando está
 * ausente en el body, `class-transformer` lo deja `undefined` y Prisma lo
 * guarda como `null` (mismo shape que "sin comentario").
 */
export class UpsertReviewDto {
  @IsInt({ message: 'rating debe ser un número entero' })
  @Min(1, { message: 'rating debe estar entre 1 y 5' })
  @Max(5, { message: 'rating debe estar entre 1 y 5' })
  rating!: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'comment no puede superar los 2000 caracteres' })
  comment?: string | null;
}

/** Entrada de `PATCH /v1/admin/reviews/:id` (US-025 AC-8). */
export class ModerateReviewDto {
  @IsBoolean()
  hidden!: boolean;
}

/** Reseña propia del cliente (`GET /v1/me/reviews/:slug`) — incluye `hidden` (AC-8). */
export class ReviewResponseDto {
  id!: string;
  rating!: number;
  comment!: string | null;
  hidden!: boolean;
  created_at!: Date;
  updated_at!: Date;

  static from(review: Review): ReviewResponseDto {
    return {
      id: review.id,
      rating: review.rating,
      comment: review.comment,
      hidden: review.hidden_at !== null,
      created_at: review.created_at,
      updated_at: review.updated_at,
    };
  }
}

/** Reseña en la lista pública (`GET /v1/products/:slug/reviews`) — nunca `hidden_at`/`customer_id`. */
export class PublicReviewDto {
  id!: string;
  customer_name!: string;
  rating!: number;
  comment!: string | null;
  created_at!: Date;

  static from(review: ReviewWithAuthor): PublicReviewDto {
    return {
      id: review.id,
      customer_name: review.customer.name,
      rating: review.rating,
      comment: review.comment,
      created_at: review.created_at,
    };
  }
}

/** Respuesta de `GET /v1/products/:slug/reviews` (US-025 AC-3/AC-4). */
export class PublicReviewsResponseDto {
  average!: number | null;
  count!: number;
  data!: PublicReviewDto[];
  pagination!: { limit: number; offset: number; total: number };
}
