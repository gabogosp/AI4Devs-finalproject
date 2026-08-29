import {
  Controller,
  Get,
  Headers,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { StorefrontService } from './storefront.service';
import {
  ListStorefrontProductsQueryDto,
  StorefrontCategoryDto,
  StorefrontProductListItemDto,
} from './dto/storefront-category.dto';
import { StorefrontThrottlerGuard } from './storefront-throttler.guard';
import {
  StorefrontCache,
  StorefrontCacheInterceptor,
} from './storefront-cache.interceptor';
import { CatalogEventsService } from '../observability/catalog-events.service';

/**
 * Navegación **pública** por categorías (US-002) — sin `AdminGuard`, espejo del
 * controller de la ficha (US-003). El rate-limit por IP y la caché acotada se
 * aplican en el borde con los mismos mecanismos; acá el controller sólo valida,
 * delega y mapea.
 */
@Controller('v1/categories')
@UseGuards(StorefrontThrottlerGuard)
@SkipThrottle({ auth: true, cart: true })
@UseInterceptors(StorefrontCacheInterceptor)
export class StorefrontCategoriesController {
  constructor(
    private readonly storefront: StorefrontService,
    private readonly events: CatalogEventsService,
  ) {}

  /** Árbol de dos niveles (AC-1). Cambia poco → TTL propio (D5). */
  @Get()
  @StorefrontCache({ maxAge: 300, swr: 60 })
  async getTree() {
    const roots = await this.storefront.getCategoryTree();
    return { data: roots.map(StorefrontCategoryDto.treeNode) };
  }

  /**
   * Detalle de una categoría (AC-1/AC-2). Es el único punto que emite
   * `category.viewed` (decisión D4): paginar dentro de la misma categoría no
   * cuenta como otra vista.
   */
  @Get(':slug')
  async getBySlug(
    @Param('slug') slug: string,
    @Headers('traceparent') traceparent?: string,
  ): Promise<StorefrontCategoryDto> {
    const category = await this.storefront.getCategoryBySlug(slug);
    // Lectura anónima → sin admin_user_id (sin PII). Un 404 lanza antes, así
    // que no emite.
    this.events.emit('category.viewed', category.id, null, traceparent);
    return StorefrontCategoryDto.from(category);
  }

  /** Listado paginado de productos publicados de la categoría (AC-3/AC-6). */
  @Get(':slug/products')
  async listProducts(
    @Param('slug') slug: string,
    @Query() query: ListStorefrontProductsQueryDto,
  ) {
    const { data, total } = await this.storefront.listPublishedProducts(slug, {
      limit: query.limit,
      offset: query.offset,
    });
    return {
      data: data.map(StorefrontProductListItemDto.from),
      pagination: { limit: query.limit, offset: query.offset, total },
    };
  }
}
