import { Controller, Get, Headers, Param, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { StorefrontService } from './storefront.service';
import { StorefrontProductDto } from './dto/storefront-product.dto';
import { StorefrontThrottlerGuard } from './storefront-throttler.guard';
import { CatalogEventsService } from '../observability/catalog-events.service';

/**
 * Superficie **pública** del storefront (US-003) — la primera de `@dsm/api` sin
 * `AdminGuard`. Devuelve la ficha de un producto publicado por su `sku`
 * (identificador interino; la URL por `slug` es OQ-BE-1, infra-owned). El
 * rate-limit por IP (§7.3) y la caché acotada (AC-9) se aplican en el borde
 * (Fases 5/6), no acá.
 */
@Controller('v1/products')
// §7.3 — throttle por IP de la superficie pública. `@SkipThrottle({ auth: true })`
// deja fuera el throttler estricto de auth: acá sólo aplica el `storefront`.
@UseGuards(StorefrontThrottlerGuard)
@SkipThrottle({ auth: true })
export class StorefrontProductsController {
  constructor(
    private readonly storefront: StorefrontService,
    private readonly events: CatalogEventsService,
  ) {}

  @Get(':sku')
  async getBySku(
    @Param('sku') sku: string,
    @Headers('traceparent') traceparent?: string,
  ): Promise<StorefrontProductDto> {
    const product = await this.storefront.getPublishedProduct(sku);
    // US §9 / E2E §18: evento de negocio de la ficha. Lectura anónima →
    // `admin_user_id: null` (sin PII). El `entity_id` va al LOG, nunca como
    // dimensión de la métrica `pdp_viewed_total` (cardinalidad §3.3). Un 404
    // lanza en la línea anterior, así que no se emite.
    this.events.emit('product.viewed', product.id, null, traceparent);
    return StorefrontProductDto.from(product);
  }
}
