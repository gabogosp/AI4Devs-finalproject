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
 */
@Injectable()
export class ReviewsService {
  constructor(
    private readonly reviews: ReviewsRepository,
    private readonly orders: OrdersRepository,
    private readonly products: ProductsRepository,
  ) {}

  async getOwn(
    customerId: string,
    productId: string,
  ): Promise<{ eligible: boolean; review: Review | null }> {
    const [eligible, review] = await Promise.all([
      this.orders.hasDeliveredOrderWithProduct(customerId, productId),
      this.reviews.findOwn(customerId, productId),
    ]);
    return { eligible, review };
  }

  async upsertOwn(
    customerId: string,
    productId: string,
    data: { rating: number; comment: string | null | undefined },
  ): Promise<Review> {
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
