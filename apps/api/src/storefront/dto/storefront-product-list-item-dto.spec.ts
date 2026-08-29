// El módulo de DTOs incluye el query DTO decorado; cargar el polyfill al
// importarlo fuera del contenedor de Nest.
import 'reflect-metadata';
import { Product } from '@dsm/db';
import { StorefrontProductListItemDto } from './storefront-category.dto';

/** Unit del item de grilla del listado público (US-002 T3.1). */
describe('StorefrontProductListItemDto', () => {
  const producto = (over: Partial<Product> = {}): Product => ({
    id: 'prod-1',
    sku: 'REF-001',
    slug: 'heladera-no-frost',
    name: 'Heladera No-Frost',
    description_raw: 'desc',
    price_ars_cents: 100000,
    stock: 5,
    status: 'published',
    category_id: 'cat-1',
    image_url: 'https://cdn/img.jpg',
    enrichment_done: false,
    // US-005 agregó estas 6 columnas a `products` (migración aditiva): el fixture
    // las declara para seguir satisfaciendo el tipo generado por Prisma.
    description_enriched: null,
    description_curated: false,
    enrichment_source_hash: null,
    enrichment_attempts: 0,
    enrichment_next_attempt_at: null,
    enrichment_error_code: null,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-02T00:00:00Z'),
    ...over,
  });

  it('expone exactamente el shape de grilla', () => {
    const dto = StorefrontProductListItemDto.from(producto());

    expect(Object.keys(dto).sort()).toEqual([
      'currency',
      'image_url',
      'in_stock',
      'name',
      'price_ars_cents',
      'slug',
    ]);
    expect(dto.currency).toBe('ARS');
    expect(dto.slug).toBe('heladera-no-frost');
  });

  it('in_stock se deriva de stock > 0 (AC-5), sin exponer el nivel', () => {
    expect(
      StorefrontProductListItemDto.from(producto({ stock: 0 })).in_stock,
    ).toBe(false);
    expect(
      StorefrontProductListItemDto.from(producto({ stock: 3 })).in_stock,
    ).toBe(true);
    expect(StorefrontProductListItemDto.from(producto())).not.toHaveProperty(
      'stock',
    );
  });

  it('image_url null pasa tal cual (el placeholder es del FE)', () => {
    expect(
      StorefrontProductListItemDto.from(producto({ image_url: null }))
        .image_url,
    ).toBeNull();
  });

  it('no filtra campos de administración', () => {
    const dto = StorefrontProductListItemDto.from(producto());

    expect(dto).not.toHaveProperty('id');
    expect(dto).not.toHaveProperty('status');
    expect(dto).not.toHaveProperty('category_id');
    expect(dto).not.toHaveProperty('created_at');
    expect(dto).not.toHaveProperty('updated_at');
  });
});
