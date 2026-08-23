import { Category, Product } from '@dsm/db';
import { StorefrontProductDto } from './storefront-product.dto';

/** Unit del mapper de la ficha pública (US-003 AC-2/AC-3/AC-4/AC-5/AC-6). */
describe('StorefrontProductDto.from', () => {
  const category: Category = {
    id: 'cat-1',
    slug: 'refrigeracion',
    name: 'Refrigeración',
    parent_id: null,
    created_at: new Date('2026-01-01T00:00:00Z'),
  };

  const base = (over: Partial<Product> = {}): Product & { category: Category } => ({
    id: 'prod-1',
    sku: 'REF-001',
    slug: 'heladera',
    name: 'Heladera',
    description_raw: 'Heladera no-frost 300L',
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
    category,
    ...over,
  });

  it('stock>0 → in_stock:true (AC-3)', () => {
    expect(StorefrontProductDto.from(base({ stock: 5 })).in_stock).toBe(true);
  });

  it('stock=0 → in_stock:false (AC-4)', () => {
    expect(StorefrontProductDto.from(base({ stock: 0 })).in_stock).toBe(false);
  });

  it('image_url=null se pasa tal cual (AC-6)', () => {
    expect(StorefrontProductDto.from(base({ image_url: null })).image_url).toBeNull();
  });

  it('description = description_raw (AC-5)', () => {
    const dto = StorefrontProductDto.from(base({ description_raw: 'texto base' }));
    expect(dto.description).toBe('texto base');
  });

  it('mapea sku/name/precio/currency/categoría', () => {
    const dto = StorefrontProductDto.from(base());
    expect(dto).toMatchObject({
      sku: 'REF-001',
      name: 'Heladera',
      price_ars_cents: 100000,
      currency: 'ARS',
      category: { name: 'Refrigeración', slug: 'refrigeracion' },
    });
  });

  it('NO expone campos de administración (OQ-BE-3)', () => {
    const dto = StorefrontProductDto.from(base()) as unknown as Record<string, unknown>;
    for (const key of ['id', 'stock', 'status', 'category_id', 'created_at', 'updated_at']) {
      expect(dto).not.toHaveProperty(key);
    }
  });
});
