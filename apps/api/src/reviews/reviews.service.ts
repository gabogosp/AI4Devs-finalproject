import { Injectable } from '@nestjs/common';
import { Review } from '@dsm/db';
import { ReviewsRepository, ReviewWithAuthor, Pagination } from './reviews.repository';
import { OrdersRepository } from '../checkout/orders.repository';
import { ProductsRepository } from '../products/products.repository';
import { NotFoundError } from '../common/errors/domain-errors';
import { ReviewNotEligibleError } from './reviews-errors';

const PRODUCTO_NO_ENCONTRADO = 'Producto no encontrado';

/**
 * Use-case de reseñas (US-025). AC-6 se verifica SIEMPRE en `upsertOwn`
 * ANTES de tocar `reviews` (NFR §9: nunca se confía en un flag del
 * cliente) — la elegibilidad sale de `OrdersRepository.
 * hasDeliveredOrderWithProduct`, único punto de acceso a `orders`/
 * `order_items` (§5).
 *
 * `getOwn`/`upsertOwn` reciben el **slug** del producto, no su UUID (fix
 * post-mortem del contrato original): la única superficie pública que
 * conoce la ficha es el slug — `StorefrontProductDto` excluye `id` a
 * propósito (US-002/US-003, threat model de `catalogo`), así que un
 * contrato basado en UUID nunca era resoluble desde el FE. Se resuelve acá,
 * una sola vez, contra `products.slug` — el resto del use-case y el
 * repositorio de reviews (`product_id`, la FK real) no cambian.
 */
@Injectable()
export class ReviewsService {
  constructor(
    private readonly reviews: ReviewsRepository,
    private readonly orders: OrdersRepository,
    private readonly products: ProductsRepository,
  ) {}

  private async resolveProductId(slug: string): Promise<string> {
    const producto = await this.products.findIdBySlug(slug);
    if (!producto) {
      throw new NotFoundError(PRODUCTO_NO_ENCONTRADO);
    }
    return producto.id;
  }

  async getOwn(
    customerId: string,
    slug: string,
  ): Promise<{ eligible: boolean; review: Review | null }> {
    const productId = await this.resolveProductId(slug);
    const [eligible, review] = await Promise.all([
      this.orders.hasDeliveredOrderWithProduct(customerId, productId),
      this.reviews.findOwn(customerId, productId),
    ]);
    return { eligible, review };
  }

  async upsertOwn(
    customerId: string,
    slug: string,
    data: { rating: number; comment: string | null | undefined },
  ): Promise<Review> {
    const productId = await this.resolveProductId(slug);
    const elegible = await this.orders.hasDeliveredOrderWithProduct(customerId, productId);
    if (!elegible) {
      throw new ReviewNotEligibleError();
    }
    return this.reviews.upsert(customerId, productId, {
      rating: data.rating,
      comment: data.comment ?? null,
    });
  }

  async listPublic(
    slug: string,
    page: Pagination,
  ): Promise<{ average: number | null; count: number; data: ReviewWithAuthor[]; pagination: Pagination & { total: number } }> {
    const product = await this.products.findPublishedBySlug(slug);
    if (!product) {
      throw new NotFoundError(PRODUCTO_NO_ENCONTRADO);
    }
    const [{ average, count }, { data, total }] = await Promise.all([
      this.reviews.aggregateVisible(product.id),
      this.reviews.findVisibleByProduct(product.id, page),
    ]);
    return { average, count, data, pagination: { ...page, total } };
  }

  async moderate(id: string, hidden: boolean): Promise<Review | null> {
    return this.reviews.setHidden(id, hidden);
  }
}
