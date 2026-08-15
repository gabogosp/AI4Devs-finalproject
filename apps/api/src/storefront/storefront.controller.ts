import { Controller, Get, Param } from '@nestjs/common';
import { StorefrontService } from './storefront.service';
import { StorefrontProductDto } from './dto/storefront-product.dto';

/**
 * Superficie **pública** del storefront (US-003) — la primera de `@dsm/api` sin
 * `AdminGuard`. Devuelve la ficha de un producto publicado por su `sku`
 * (identificador interino; la URL por `slug` es OQ-BE-1, infra-owned). El
 * rate-limit por IP (§7.3) y la caché acotada (AC-9) se aplican en el borde
 * (Fases 5/6), no acá.
 */
@Controller('v1/products')
export class StorefrontProductsController {
  constructor(private readonly storefront: StorefrontService) {}

  @Get(':sku')
  async getBySku(@Param('sku') sku: string): Promise<StorefrontProductDto> {
    const product = await this.storefront.getPublishedProduct(sku);
    return StorefrontProductDto.from(product);
  }
}
