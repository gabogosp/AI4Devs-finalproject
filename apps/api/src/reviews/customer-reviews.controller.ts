import { Body, Controller, Get, HttpCode, Param, Put, Req, UseGuards } from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { UpsertReviewDto, ReviewResponseDto } from './dto/review.dto';
import { CustomerGuard, RequestConCliente } from '../auth/customer.guard';
import { CsrfGuard } from '../auth/csrf.guard';

export interface OwnReviewResponse {
  eligible: boolean;
  review: ReviewResponseDto | null;
}

/**
 * Autoservicio de reseñas del cliente (US-025 AC-1/AC-2/AC-5/AC-6/AC-7).
 * Mismo criterio estructural que `AccountController` (US-020/US-024): la
 * identidad sale EXCLUSIVAMENTE de `req.customerId` (sesión), nunca de un
 * parámetro del request — no hay forma de reseñar "en nombre de" otro
 * cliente.
 */
@Controller('v1/me/reviews')
@UseGuards(CustomerGuard)
export class CustomerReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get(':productId')
  async getOwn(
    @Req() req: RequestConCliente,
    @Param('productId') productId: string,
  ): Promise<OwnReviewResponse> {
    const { eligible, review } = await this.reviews.getOwn(req.customerId!, productId);
    return { eligible, review: review ? ReviewResponseDto.from(review) : null };
  }

  /**
   * `PUT`, no `POST`/`PATCH` (design.md D2): upsert idempotente sobre el
   * recurso identificado por `:productId` — AC-5 exige que reeditar
   * actualice la MISMA reseña, nunca cree una segunda.
   */
  @Put(':productId')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  async upsertOwn(
    @Req() req: RequestConCliente,
    @Param('productId') productId: string,
    @Body() dto: UpsertReviewDto,
  ): Promise<ReviewResponseDto> {
    const review = await this.reviews.upsertOwn(req.customerId!, productId, {
      rating: dto.rating,
      comment: dto.comment,
    });
    return ReviewResponseDto.from(review);
  }
}
