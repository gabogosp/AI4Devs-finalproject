import { Category, Product } from '@dsm/db';

/**
 * DTO de respuesta de la **ficha pública** (US-003 AC-2). Expone sólo los campos
 * SEO-relevantes que el FE compone en metadatos + JSON-LD `schema.org/Product`;
 * NO expone campos de administración (`id`, `stock` numérico, `status`,
 * timestamps) — OQ-BE-3 (no filtrar inventario ni gestión).
 */
export class StorefrontProductDto {
  /** AC-1: identificador público y URL amigable de la ficha (`/producto/{slug}`). */
  slug!: string;
  sku!: string;
  name!: string;
  /**
   * AC-5: descripción base (`description_raw`). Cuando US-005 agregue
   * `description_enriched`, el mapper antepondrá `enriched ?? raw`. Nullable:
   * un producto publicado puede no tener descripción cargada aún.
   */
  description!: string | null;
  price_ars_cents!: number;
  currency!: 'ARS';
  image_url!: string | null;
  /** AC-3/AC-4: comprable/no-comprable, derivado de `stock > 0`. Sin nivel. */
  in_stock!: boolean;
  category!: { name: string; slug: string };

  static from(p: Product & { category: Category }): StorefrontProductDto {
    return {
      slug: p.slug,
      sku: p.sku,
      name: p.name,
      description: p.description_raw,
      price_ars_cents: p.price_ars_cents,
      currency: 'ARS',
      image_url: p.image_url,
      in_stock: p.stock > 0,
      category: { name: p.category.name, slug: p.category.slug },
    };
  }
}
