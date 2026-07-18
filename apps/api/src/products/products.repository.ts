import { Injectable } from '@nestjs/common';
import { Prisma, Product } from '@dsm/db';
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
