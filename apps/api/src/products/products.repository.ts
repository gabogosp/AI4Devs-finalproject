import { Injectable } from '@nestjs/common';
import { Category, Prisma, Product } from '@dsm/db';
import { PrismaService } from '../prisma/prisma.service';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../common/errors/domain-errors';
import {
  isPrismaError,
  PRISMA_FK_VIOLATION,
  PRISMA_RECORD_NOT_FOUND,
  PRISMA_UNIQUE_VIOLATION,
} from '../common/prisma-errors';

export interface CreateProductData {
  sku: string;
  name: string;
  description_raw?: string | null;
  price_ars_cents: number;
  stock?: number;
  status?: string;
  category_id: string;
  image_url?: string | null;
}

export type UpdateProductData = Prisma.ProductUncheckedUpdateInput;

export interface Pagination {
  limit: number;
  offset: number;
}

/** Único punto de acceso al ORM para `products` (§5). Traduce códigos Prisma. */
@Injectable()
export class ProductsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateProductData): Promise<Product> {
    try {
      return await this.prisma.product.create({
        data: {
          sku: data.sku,
          name: data.name,
          description_raw: data.description_raw ?? null,
          price_ars_cents: data.price_ars_cents,
          stock: data.stock ?? 0,
          status: data.status ?? 'draft',
          category_id: data.category_id,
          image_url: data.image_url ?? null,
        },
      });
    } catch (error) {
      throw this.translate(error);
    }
  }

  async findMany(
    page: Pagination,
  ): Promise<{ data: Product[]; total: number }> {
    const [data, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        take: page.limit,
        skip: page.offset,
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.product.count(),
    ]);
    return { data, total };
  }

  findById(id: string): Promise<Product | null> {
    return this.prisma.product.findUnique({ where: { id } });
  }

  /**
   * Lectura pública del storefront (US-003 AC-1/AC-7/AC-8): sólo productos
   * `published`, con su categoría. Devuelve `null` (no lanza) para cualquier
   * no-match — draft, archived o inexistente colapsan al mismo `null`, así el
   * service decide un 404 idéntico (sin enumeration leak). El identificador
   * público es `sku` (interino; la URL por `slug` es OQ-BE-1, infra-owned).
   */
  findPublishedBySku(
    sku: string,
  ): Promise<(Product & { category: Category }) | null> {
    return this.prisma.product.findFirst({
      where: { sku, status: 'published' },
      include: { category: true },
    });
  }

  async update(id: string, data: UpdateProductData): Promise<Product> {
    try {
      return await this.prisma.product.update({ where: { id }, data });
    } catch (error) {
      throw this.translate(error);
    }
  }

  private translate(error: unknown): unknown {
    if (isPrismaError(error, PRISMA_UNIQUE_VIOLATION)) {
      return new ConflictError('SKU duplicado', [
        { field: 'sku', message: 'SKU duplicado' },
      ]);
    }
    if (isPrismaError(error, PRISMA_FK_VIOLATION)) {
      return new ValidationError('La categoría indicada no existe', [
        { field: 'category_id', message: 'la categoría no existe' },
      ]);
    }
    if (isPrismaError(error, PRISMA_RECORD_NOT_FOUND)) {
      return new NotFoundError('Producto no encontrado');
    }
    return error;
  }
}
