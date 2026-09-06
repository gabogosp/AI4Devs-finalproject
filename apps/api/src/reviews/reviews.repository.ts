import { Injectable } from '@nestjs/common';
import { Review } from '@dsm/db';
import { PrismaService } from '../prisma/prisma.service';

export interface Pagination {
  limit: number;
  offset: number;
}

export interface ReviewWithAuthor extends Review {
  customer: { name: string };
}

/**
 * Único punto de acceso al ORM de `reviews` (§5). `upsert` usa el índice
 * único compuesto `customer_id_product_id` (que Prisma genera a partir de
 * `@@unique([customer_id, product_id])`) — AC-5: reeditar actualiza la
 * MISMA fila, nunca crea una segunda.
 */
@Injectable()
export class ReviewsRepository {
  constructor(private readonly prisma: PrismaService) {}

  upsert(
    customerId: string,
    productId: string,
    data: { rating: number; comment: string | null },
  ): Promise<Review> {
    return this.prisma.review.upsert({
      where: { customer_id_product_id: { customer_id: customerId, product_id: productId } },
      create: {
        customer_id: customerId,
        product_id: productId,
        rating: data.rating,
        comment: data.comment,
      },
      update: { rating: data.rating, comment: data.comment },
    });
  }

  findOwn(customerId: string, productId: string): Promise<Review | null> {
    return this.prisma.review.findUnique({
      where: { customer_id_product_id: { customer_id: customerId, product_id: productId } },
    });
  }

  /**
   * Lista pública (AC-3/AC-4): SIEMPRE filtra `hidden_at: null` — la reseña
   * oculta nunca aparece acá, sin importar quién pregunte (esa distinción
   * la resuelve `ReviewsService.getOwn`, no este método).
   */
  async findVisibleByProduct(
    productId: string,
    page: Pagination,
  ): Promise<{ data: ReviewWithAuthor[]; total: number }> {
    const where = { product_id: productId, hidden_at: null };
    const [data, total] = await Promise.all([
      this.prisma.review.findMany({
        where,
        include: { customer: { select: { name: true } } },
        orderBy: { created_at: 'desc' },
        take: page.limit,
        skip: page.offset,
      }),
      this.prisma.review.count({ where }),
    ]);
    return { data, total };
  }

  async aggregateVisible(
    productId: string,
  ): Promise<{ average: number | null; count: number }> {
    const result = await this.prisma.review.aggregate({
      where: { product_id: productId, hidden_at: null },
      _avg: { rating: true },
      _count: true,
    });
    return { average: result._avg.rating, count: result._count };
  }

  /** Moderación (AC-8): `hidden_at` es un soft-flag, nunca borra la fila. */
  async setHidden(id: string, hidden: boolean): Promise<Review | null> {
    const { count } = await this.prisma.review.updateMany({
      where: { id },
      data: { hidden_at: hidden ? new Date() : null },
    });
    if (count === 0) return null;
    return this.prisma.review.findUniqueOrThrow({ where: { id } });
  }
}
