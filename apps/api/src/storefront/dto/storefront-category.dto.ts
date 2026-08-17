import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Category, Product } from '@dsm/db';

/** Nodo mínimo del árbol: lo que la navegación necesita para enlazar. */
export interface CategoryRef {
  slug: string;
  name: string;
}

const toRef = (c: Category): CategoryRef => ({ slug: c.slug, name: c.name });

/**
 * Categoría en la superficie pública (US-002 AC-1/AC-2). No expone `id` ni
 * `parent_id` ni timestamps: la navegación se hace por slug.
 */
export class StorefrontCategoryDto {
  slug!: string;
  name!: string;
  /** Padre para el breadcrumb "volver al rubro" (AC-2); null si ya es rubro. */
  parent!: CategoryRef | null;
  children!: CategoryRef[];

  static from(
    c: Category & { parent?: Category | null; children: Category[] },
  ): StorefrontCategoryDto {
    return {
      slug: c.slug,
      name: c.name,
      parent: c.parent ? toRef(c.parent) : null,
      children: c.children.map(toRef),
    };
  }

  /**
   * Nodo del árbol (`GET /v1/categories`): mismo shape sin `parent`, que ahí es
   * ruido — la jerarquía ya la da el anidamiento.
   */
  static treeNode(
    c: Category & { children: Category[] },
  ): Omit<StorefrontCategoryDto, 'parent'> {
    return { slug: c.slug, name: c.name, children: c.children.map(toRef) };
  }
}

/**
 * Item de grilla del listado (US-002 AC-3/AC-5). Orientado a `ProductCard`: sin
 * campos de administración y sin nivel de inventario — sólo comprable o no
 * (OQ-BE-3 de US-003). El enlace a la ficha va por `slug`.
 */
export class StorefrontProductListItemDto {
  slug!: string;
  name!: string;
  price_ars_cents!: number;
  currency!: 'ARS';
  /** null → el FE pone el placeholder (AC-3). */
  image_url!: string | null;
  in_stock!: boolean;

  static from(p: Product): StorefrontProductListItemDto {
    return {
      slug: p.slug,
      name: p.name,
      price_ars_cents: p.price_ars_cents,
      currency: 'ARS',
      image_url: p.image_url,
      in_stock: p.stock > 0,
    };
  }
}

/**
 * Query de paginación del listado (D3: offset). Defaults 20/0 y tope de 100 —
 * el catálogo completo nunca se transfiere de una (AC-7). El `ValidationPipe`
 * global rechaza fuera de rango con 422.
 */
export class ListStorefrontProductsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset = 0;
}
