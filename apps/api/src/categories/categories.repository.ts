import { Injectable } from '@nestjs/common';
import { Category } from '@dsm/db';
import { PrismaService } from '../prisma/prisma.service';
import { ConflictError, NotFoundError } from '../common/errors/domain-errors';
import {
  isPrismaError,
  PRISMA_RECORD_NOT_FOUND,
  PRISMA_UNIQUE_VIOLATION,
} from '../common/prisma-errors';

export interface CreateCategoryData {
  name: string;
  slug: string;
  parent_id?: string | null;
}

export interface UpdateCategoryData {
  name?: string;
  parent_id?: string | null;
}

/**
 * Único punto de acceso al ORM para `categories` (§5). Traduce códigos Prisma a
 * errores de dominio; ningún service llama al client directo.
 */
@Injectable()
export class CategoriesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateCategoryData): Promise<Category> {
    try {
      return await this.prisma.category.create({ data });
    } catch (error) {
      if (isPrismaError(error, PRISMA_UNIQUE_VIOLATION)) {
        throw new ConflictError('Ya existe una categoría con ese slug', [
          { field: 'slug', message: 'slug duplicado' },
        ]);
      }
      throw error;
    }
  }

  findMany(): Promise<Category[]> {
    return this.prisma.category.findMany({ orderBy: { created_at: 'asc' } });
  }

  findById(id: string): Promise<Category | null> {
    return this.prisma.category.findUnique({ where: { id } });
  }

  async update(id: string, data: UpdateCategoryData): Promise<Category> {
    try {
      return await this.prisma.category.update({ where: { id }, data });
    } catch (error) {
      if (isPrismaError(error, PRISMA_UNIQUE_VIOLATION)) {
        throw new ConflictError('Ya existe una categoría con ese slug', [
          { field: 'slug', message: 'slug duplicado' },
        ]);
      }
      if (isPrismaError(error, PRISMA_RECORD_NOT_FOUND)) {
        throw new NotFoundError('Categoría no encontrada');
      }
      throw error;
    }
  }
}
