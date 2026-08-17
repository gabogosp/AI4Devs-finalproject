import { Injectable } from '@nestjs/common';
import { Product } from '@dsm/db';
import {
  CreateProductData,
  Pagination,
  ProductsRepository,
} from './products.repository';
import {
  NotFoundError,
  ValidationError,
} from '../common/errors/domain-errors';
import { slugify } from '../common/slug';
import {
  assertPublishable,
  assertValidTransition,
  ProductStatus,
} from './products.state';

export interface UpdateProductInput {
  name?: string;
  description_raw?: string | null;
  price_ars_cents?: number;
  stock?: number;
  category_id?: string;
  image_url?: string | null;
}

/**
 * Reglas de negocio de productos (AC-2/AC-3/AC-9). Las transiciones de estado
 * (publicar/archivar, AC-4/6/7) se añaden en la Fase 6.
 */
@Injectable()
export class ProductsService {
  constructor(private readonly repo: ProductsRepository) {}

  /** AC-2: alta en estado draft; AC-9: SKU único garantizado por DB→ConflictError. */
  async create(
    input: Omit<CreateProductData, 'status' | 'slug'>,
  ): Promise<Product> {
    const slug = await this.deriveUniqueSlug(input.name, input.sku);
    return this.repo.create({ ...input, slug, status: 'draft' });
  }

  /**
   * URL amigable derivada del `name` (nunca aceptada del cliente — misma regla
   * que categorías, US-001 AC-1). La colisión se resuelve con sufijo ordinal
   * determinista: el primer "heladera" se queda con `heladera`, el siguiente
   * es `heladera-2`. Se cuenta desde el set ya tomado, no desde un random, así
   * el resultado es reproducible.
   */
  private async deriveUniqueSlug(name: string, sku: string): Promise<string> {
    // Un nombre sin caracteres alfanuméricos ("###") no produce base; el `sku`
    // es el fallback (mismo criterio que el backfill de la migración T10.1).
    const base = slugify(name) || slugify(sku);
    if (!base) {
      throw new ValidationError(
        'El nombre no permite derivar una URL amigable',
        [{ field: 'name', message: 'no permite derivar una URL amigable' }],
      );
    }
    const taken = new Set(await this.repo.findSlugsByPrefix(base));
    if (!taken.has(base)) {
      return base;
    }
    let ordinal = 2;
    while (taken.has(`${base}-${ordinal}`)) {
      ordinal += 1;
    }
    return `${base}-${ordinal}`;
  }

  list(page: Pagination): Promise<{ data: Product[]; total: number }> {
    return this.repo.findMany(page);
  }

  async get(id: string): Promise<Product> {
    const product = await this.repo.findById(id);
    if (!product) {
      throw new NotFoundError('Producto no encontrado');
    }
    return product;
  }

  /**
   * AC-3: edición de campos (precio/stock/descripción/categoría/imagen).
   * El `slug` NO se recalcula al cambiar el `name`: la URL ya pudo indexarse y
   * regenerarla la rompería (301 + re-crawl). Cambiar la URL de un producto es
   * una decisión explícita, no un efecto colateral de renombrarlo.
   */
  async update(id: string, input: UpdateProductInput): Promise<Product> {
    await this.get(id); // 404 si no existe (antes de tocar la DB)
    return this.repo.update(id, input);
  }

  /** AC-4/AC-6/AC-7: transición de estado validada (publicar/archivar/despublicar). */
  async changeStatus(id: string, target: ProductStatus): Promise<Product> {
    const product = await this.get(id); // 404 si no existe
    assertValidTransition(product.status as ProductStatus, target);
    if (target === 'published') {
      assertPublishable({
        name: product.name,
        price_ars_cents: product.price_ars_cents,
        stock: product.stock,
        category_id: product.category_id,
      });
    }
    return this.repo.update(id, { status: target });
  }
}
