import { Body, Controller, Param, ParseUUIDPipe, Patch, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { ReviewsService } from './reviews.service';
import { ModerateReviewDto, ReviewResponseDto } from './dto/review.dto';
import { ReviewEventsService } from '../observability/review-events.service';
import { NotFoundError } from '../common/errors/domain-errors';

/** Moderación básica del dueño (US-025 AC-8): ocultar/mostrar, nunca editar el contenido. */
@Controller('v1/admin/reviews')
@UseGuards(AdminGuard)
export class AdminReviewsController {
  constructor(
    private readonly reviews: ReviewsService,
    private readonly events: ReviewEventsService,
  ) {}

  @Patch(':id')
  async moderate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ModerateReviewDto,
  ): Promise<ReviewResponseDto> {
    const review = await this.reviews.moderate(id, dto.hidden);
    if (!review) {
      throw new NotFoundError('Reseña no encontrada');
    }
    this.events.emit(dto.hidden ? 'review.hidden' : 'review.shown', review.id);
    return ReviewResponseDto.from(review);
  }
}
