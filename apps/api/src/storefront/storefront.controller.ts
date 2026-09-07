import {
  Controller,
  Get,
  Headers,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { StorefrontService } from './storefront.service';
import { StorefrontProductDto } from './dto/storefront-product.dto';
import { StorefrontThrottlerGuard } from './storefront-throttler.guard';
import { StorefrontCache, StorefrontCacheInterceptor } from './storefront-cache.interceptor';
import { CatalogEventsService } from '../observability/catalog-events.service';
import { ReviewsService } from '../reviews/reviews.service';
import {
  ListReviewsQueryDto,
  PublicReviewDto,
  PublicReviewsResponseDto,
} from '../reviews/dto/review.dto';

/**
 * Superficie **pública** del storefront (US-003) — la primera de `@dsm/api` sin
 * `AdminGuard`. Devuelve la ficha de un producto publicado por su `slug` (URL
 * amigable indexable, AC-1 — OQ-BE-1 resuelta en la Fase 10). El rate-limit por
 * IP (§7.3) y la caché acotada (AC-9) se aplican en el borde (Fases 5/6), no
 * acá.
 */
@Controller('v1/products')
// §7.3 — throttle por IP de la superficie pública. `@SkipThrottle({ auth: true })`
// deja fuera el throttler estricto de auth: acá sólo aplica el `storefront`.
@UseGuards(StorefrontThrottlerGuard)
@SkipThrottle({ auth: true, cart: true })
// AC-9 (M1): caché acotada SÓLO en 2xx (el interceptor no corre en 404/429).
@UseInterceptors(StorefrontCacheInterceptor)
export class StorefrontProductsController {
  constructor(
    private readonly storefront: StorefrontService,
    private readonly events: CatalogEventsService,
    private readonly config: ConfigService,
    private readonly reviews: ReviewsService,
  ) {}

  @Get(':slug')
  async getBySlug(
    @Param('slug') slug: string,
    @Headers('traceparent') traceparent?: string,
  ): Promise<StorefrontProductDto> {
    const product = await this.storefront.getPublishedProduct(slug);
    // US §9 / E2E §18: evento de negocio de la ficha. Lectura anónima →
    // `admin_user_id: null` (sin PII). El `entity_id` va al LOG, nunca como
    // dimensión de la métrica `pdp_viewed_total` (cardinalidad §3.3). Un 404
    // lanza en la línea anterior, así que no se emite.
    this.events.emit('product.viewed', product.id, null, traceparent);
    return StorefrontProductDto.from(
      product,
      this.config.getOrThrow<number>('STOREFRONT_LOW_STOCK_THRESHOLD'),
    );
  }

  /**
   * Reseñas públicas del producto (US-025 AC-3/AC-4) — mismo throttler/guard
   * de clase que el resto de la ficha, pero SIN el caché de 60s de
   * precio/stock (`STOREFRONT_CACHE_DEFAULT`, US-003 AC-9): ese TTL está
   * pensado para datos que cambian poco (precio, stock), pero acá una
   * reseña o una moderación recién escritas tienen que verse en la
   * PRÓXIMA lectura — un cliente que deja su primera reseña no puede ver
   * el promedio viejo hasta que expire el caché (AC-3). `@StorefrontCache`
   * ya existe para esto (US-002 D5, "se declara en la ruta, no en el
   * interceptor") — no hace falta tocar el interceptor ni el resto del
   * controller.
   */
  @Get(':slug/reviews')
  @StorefrontCache({ maxAge: 0, swr: 0 })
  async getReviews(
    @Param('slug') slug: string,
    @Query() query: ListReviewsQueryDto,
  ): Promise<PublicReviewsResponseDto> {
    const { average, count, data, pagination } = await this.reviews.listPublic(slug, {
      limit: query.limit,
      offset: query.offset,
    });
    return { average, count, data: data.map(PublicReviewDto.from), pagination };
  }
}
