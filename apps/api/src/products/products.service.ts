import { Injectable } from '@nestjs/common';
import { Product } from '@dsm/db';
import {
  CreateProductData,
  Pagination,
  ProductsRepository,
} from './products.repository';
import { NotFoundError } from '../common/errors/domain-errors';

export interface UpdateProductInput {
  name?: string;
  description_raw?: string | null;
  price_ars_cents?: number;
  stock?: number;
  category_id?: string;
  image_url?: string | null;
}

/**
 * Reglas de negocio de productos (AC-2/AC-3/AC-9). Las transiciones de estado
 * (publicar/archivar, AC-4/6/7) se añaden en la Fase 6.
 */
@Injectable()
export class ProductsService {
  constructor(private readonly repo: ProductsRepository) {}

  /** AC-2: alta en estado draft; AC-9: SKU único garantizado por DB→ConflictError. */
  create(input: Omit<CreateProductData, 'status'>): Promise<Product> {
    return this.repo.create({ ...input, status: 'draft' });
  }

  list(page: Pagination): Promise<{ data: Product[]; total: number }> {
    return this.repo.findMany(page);
  }

  async get(id: string): Promise<Product> {
    const product = await this.repo.findById(id);
    if (!product) {
      throw new NotFoundError('Producto no encontrado');
    }
    return product;
  }

  /** AC-3: edición de campos (precio/stock/descripción/categoría/imagen). */
  async update(id: string, input: UpdateProductInput): Promise<Product> {
    await this.get(id); // 404 si no existe (antes de tocar la DB)
    return this.repo.update(id, input);
  }
}
