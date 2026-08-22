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

/** Rubro con sus subrubros (árbol público, US-002 AC-1). */
export type CategoryWithChildren = Category & { children: Category[] };

/** Categoría con su familia: padre para el breadcrumb + hijos (US-002 AC-2). */
export type CategoryWithFamily = Category & {
  parent: Category | null;
  children: Category[];
};

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

  /**
   * Árbol público de dos niveles (US-002 AC-1): rubros (sin padre) con sus
   * subrubros. Ambos niveles ordenados por nombre — el orden de `created_at`
   * que usa el listado admin no sirve para navegar.
   */
  findRoots(): Promise<CategoryWithChildren[]> {
    return this.prisma.category.findMany({
      where: { parent_id: null },
      include: { children: { orderBy: { name: 'asc' } } },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Categoría pública por slug con su familia (US-002 AC-2/AC-9): `parent` para
   * el breadcrumb (null si es rubro) y `children` para los subrubros. Devuelve
   * `null` (no lanza) si el slug no existe: el 404 lo decide el service.
   */
  findBySlugWithFamily(slug: string): Promise<CategoryWithFamily | null> {
    return this.prisma.category.findUnique({
      where: { slug },
      include: { parent: true, children: { orderBy: { name: 'asc' } } },
    });
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

  /**
   * Resolución por lote de las categorías del import (US-006 T3.3): una consulta
   * para todos los slugs, indexada por slug. Un archivo donde 500 filas
   * comparten rubro se resuelve con una lectura, no con 500.
   */
  async findManyBySlugs(slugs: string[]): Promise<Map<string, string>> {
    if (slugs.length === 0) return new Map();
    const rows = await this.prisma.category.findMany({
      where: { slug: { in: slugs } },
      select: { id: true, slug: true },
    });
    return new Map(rows.map((r) => [r.slug, r.id]));
  }

  /**
   * Crea la categoría si no existe y, si la carrera la creó primero, **re-lee y
   * devuelve la existente** en vez de propagar el conflicto (US-006 T3.3).
   *
   * Es la diferencia entre un import robusto y uno que falla por su propia
   * concurrencia: dos filas del mismo rubro son el caso NORMAL de un archivo de
   * catálogo, no una anomalía, así que la auto-creación (AC-2) no puede
   * convertirse en una fila rechazada porque dos filas pidieron "Plomería".
   *
   * Siempre como rubro raíz: la jerarquía rubro/subrubro es curaduría del dueño
   * y el archivo no tiene columna para expresarla.
   */
  async createIfAbsent(data: {
    name: string;
    slug: string;
  }): Promise<{ id: string; created: boolean }> {
    const existente = await this.prisma.category.findUnique({
      where: { slug: data.slug },
      select: { id: true },
    });
    if (existente !== null) return { id: existente.id, created: false };

    try {
      const creada = await this.prisma.category.create({
        data: { name: data.name, slug: data.slug, parent_id: null },
        select: { id: true },
      });
      return { id: creada.id, created: true };
    } catch (error) {
      if (isPrismaError(error, PRISMA_UNIQUE_VIOLATION)) {
        const ganadora = await this.prisma.category.findUnique({
          where: { slug: data.slug },
          select: { id: true },
        });
        if (ganadora !== null) return { id: ganadora.id, created: false };
      }
      throw error;
    }
  }
}
