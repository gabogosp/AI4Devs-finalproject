import { Injectable } from '@nestjs/common';
import { Category, Product } from '@dsm/db';
import { ProductsRepository } from '../products/products.repository';
import { NotFoundError } from '../common/errors/domain-errors';

/**
 * Use-case de lectura pública de la ficha (US-003 AC-7/AC-8). Si el producto no
 * existe o está oculto (`draft`/`archived`), el repositorio devuelve `null` y
 * acá se lanza un `NotFoundError` **idéntico** en los tres casos — el filtro
 * global lo mapea a `404 dsm:catalog/not-found`. Sin ramas que distingan el
 * motivo: el público no puede inferir si un producto oculto existe (no
 * enumeration leak).
 */
@Injectable()
export class StorefrontService {
  constructor(private readonly repo: ProductsRepository) {}

  async getPublishedProduct(
    slug: string,
  ): Promise<Product & { category: Category }> {
    const product = await this.repo.findPublishedBySlug(slug);
    if (!product) {
      throw new NotFoundError('Producto no encontrado');
    }
    return product;
  }
}
