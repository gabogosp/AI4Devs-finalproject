import { Injectable } from '@nestjs/common';
import { Category, Product } from '@dsm/db';
import { Pagination, ProductsRepository } from '../products/products.repository';
import {
  CategoriesRepository,
  CategoryWithChildren,
  CategoryWithFamily,
} from '../categories/categories.repository';
import { NotFoundError } from '../common/errors/domain-errors';

/** Mensaje único de 404 de categoría: detalle y listado son indistinguibles. */
const CATEGORIA_NO_ENCONTRADA = 'Categoría no encontrada';

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
  constructor(
    private readonly repo: ProductsRepository,
    private readonly categories: CategoriesRepository,
  ) {}

  /** Árbol de dos niveles para la navegación (US-002 AC-1). */
  getCategoryTree(): Promise<CategoryWithChildren[]> {
    return this.categories.findRoots();
  }

  /** Detalle de categoría con su familia; 404 si el slug no existe (AC-9). */
  async getCategoryBySlug(slug: string): Promise<CategoryWithFamily> {
    const category = await this.categories.findBySlugWithFamily(slug);
    if (!category) {
      throw new NotFoundError(CATEGORIA_NO_ENCONTRADA);
    }
    return category;
  }

  /**
   * Listado publicado de una categoría (AC-3). Decisión **D1**: un rubro agrega
   * los productos de sus subrubros — si no, un rubro cuyos productos cuelgan de
   * los hijos se vería vacío. Un subrubro lista sólo los propios.
   *
   * El 404 se resuelve ANTES de consultar productos (AC-9): una categoría
   * inexistente nunca debe devolver 200 con lista vacía, que sería una página
   * fantasma indexable.
   */
  async listPublishedProducts(
    slug: string,
    page: Pagination,
  ): Promise<{ data: Product[]; total: number }> {
    const category = await this.getCategoryBySlug(slug);
    const ids =
      category.parent_id === null
        ? [category.id, ...category.children.map((c) => c.id)]
        : [category.id];
    return this.repo.findPublishedByCategoryIds(ids, page);
  }

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
