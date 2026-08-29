import { Injectable } from '@nestjs/common';
import { Category } from '@dsm/db';
import { CategoriesRepository } from './categories.repository';
import { slugify } from '../common/slug';

export interface CreateCategoryInput {
  name: string;
  parent_id?: string | null;
}

/**
 * Reglas de negocio de categorías (AC-1). Deriva el `slug` del `name` (no se
 * acepta del cliente); la unicidad la garantiza el constraint DB traducido a
 * ConflictError por el repositorio.
 */
@Injectable()
export class CategoriesService {
  constructor(private readonly repo: CategoriesRepository) {}

  create(input: CreateCategoryInput): Promise<Category> {
    const slug = slugify(input.name);
    return this.repo.create({
      name: input.name,
      slug,
      parent_id: input.parent_id ?? null,
    });
  }

  list(): Promise<Category[]> {
    return this.repo.findMany();
  }

  update(id: string, input: CreateCategoryInput): Promise<Category> {
    return this.repo.update(id, {
      name: input.name,
      parent_id: input.parent_id ?? null,
    });
  }
}
