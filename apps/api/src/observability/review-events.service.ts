import { Injectable, Logger, Optional } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { EventFields } from './catalog-events.service';

export type ReviewEventName = 'review.hidden' | 'review.shown';

/**
 * Eventos de moderación de reseñas (US-025 AC-8). Mismo esqueleto que
 * `AccountEventsService` — delega el contador en `MetricsService`,
 * `@Optional()` para specs que instancian a mano.
 */
@Injectable()
export class ReviewEventsService {
  private readonly logger = new Logger(ReviewEventsService.name);

  constructor(@Optional() private readonly metrics?: MetricsService) {}

  emit(name: ReviewEventName, reviewId: string, traceId?: string, fields?: EventFields): void {
    this.metrics?.increment('review', name);

    this.logger.log({
      event: name,
      entity_id: reviewId,
      trace_id: traceId ?? null,
      ...(fields ?? {}),
    });
  }

  async count(name: ReviewEventName): Promise<number> {
    return (await this.metrics?.value('review', name)) ?? 0;
  }
}
