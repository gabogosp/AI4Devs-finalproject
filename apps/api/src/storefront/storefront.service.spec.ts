import { Category, Product } from '@dsm/db';
import { StorefrontService } from './storefront.service';
import { ProductsRepository } from '../products/products.repository';
import { NotFoundError } from '../common/errors/domain-errors';

/** Unit del use-case público con repositorio mockeado (US-003 AC-7/AC-8). */
describe('StorefrontService.getPublishedProduct', () => {
  const published: Product & { category: Category } = {
    id: 'prod-1',
    sku: 'REF-001',
    name: 'Heladera',
    description_raw: 'desc',
    price_ars_cents: 100000,
    stock: 5,
    status: 'published',
    category_id: 'cat-1',
    image_url: null,
    created_at: new Date(),
    updated_at: new Date(),
    category: {
      id: 'cat-1',
      slug: 'refrigeracion',
      name: 'Refrigeración',
      parent_id: null,
      created_at: new Date(),
    },
  };

  const makeService = (result: (Product & { category: Category }) | null) => {
    const repo = {
      findPublishedBySku: jest.fn().mockResolvedValue(result),
    } as unknown as ProductsRepository;
    return { service: new StorefrontService(repo), repo };
  };

  it('repo devuelve el producto → lo retorna', async () => {
    const { service } = makeService(published);
    await expect(service.getPublishedProduct('REF-001')).resolves.toBe(published);
  });

  it('repo devuelve null → lanza NotFoundError (→ 404)', async () => {
    const { service } = makeService(null);
    await expect(service.getPublishedProduct('NOPE')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('mensaje idéntico para draft/archived/inexistente (no enumeration leak)', async () => {
    // Los tres colapsan a `null` en el repo → mismo error, mismo mensaje.
    const messages = await Promise.all(
      ['DRAFT-SKU', 'ARCHIVED-SKU', 'NONEXISTENT-SKU'].map(async (sku) => {
        const { service } = makeService(null);
        try {
          await service.getPublishedProduct(sku);
          return 'no-throw';
        } catch (e) {
          return (e as Error).message;
        }
      }),
    );
    expect(new Set(messages).size).toBe(1);
    expect(messages[0]).toBe('Producto no encontrado');
  });
});
