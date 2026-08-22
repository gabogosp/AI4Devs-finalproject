import { Category, Product } from '@dsm/db';
import { StorefrontService } from './storefront.service';
import { ProductsRepository } from '../products/products.repository';
import { CategoriesRepository } from '../categories/categories.repository';
import { NotFoundError } from '../common/errors/domain-errors';

/** Unit del use-case público con repositorio mockeado (US-003 AC-7/AC-8). */
describe('StorefrontService.getPublishedProduct', () => {
  const published: Product & { category: Category } = {
    id: 'prod-1',
    sku: 'REF-001',
    slug: 'heladera',
    name: 'Heladera',
    description_raw: 'desc',
    price_ars_cents: 100000,
    stock: 5,
    status: 'published',
    category_id: 'cat-1',
    image_url: null,
    enrichment_done: false,
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
      findPublishedBySlug: jest.fn().mockResolvedValue(result),
      findPublishedByCategoryIds: jest.fn().mockResolvedValue({
        data: [],
        total: 0,
      }),
    } as unknown as ProductsRepository;
    const categories = {
      findRoots: jest.fn().mockResolvedValue([]),
      findBySlugWithFamily: jest.fn().mockResolvedValue(null),
    } as unknown as CategoriesRepository;
    return { service: new StorefrontService(repo, categories), repo, categories };
  };

  it('repo devuelve el producto → lo retorna', async () => {
    const { service } = makeService(published);
    await expect(service.getPublishedProduct('heladera')).resolves.toBe(published);
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

/** Unit de la navegación por categorías (US-002 T4.1). */
describe('StorefrontService — categorías', () => {
  const categoria = (over: Partial<Category> = {}): Category => ({
    id: 'cat-1',
    slug: 'refrigeracion',
    name: 'Refrigeración',
    parent_id: null,
    created_at: new Date(),
    ...over,
  });

  const makeService = (familia: unknown) => {
    const repo = {
      findPublishedByCategoryIds: jest
        .fn()
        .mockResolvedValue({ data: [], total: 0 }),
    } as unknown as ProductsRepository;
    const categories = {
      findRoots: jest.fn().mockResolvedValue([]),
      findBySlugWithFamily: jest.fn().mockResolvedValue(familia),
    } as unknown as CategoriesRepository;
    return { service: new StorefrontService(repo, categories), repo, categories };
  };

  const rubroConDosHijos = {
    ...categoria(),
    parent: null,
    children: [
      categoria({ id: 'cat-2', slug: 'compresores' }),
      categoria({ id: 'cat-3', slug: 'aislantes' }),
    ],
  };

  it('getCategoryTree delega en findRoots', async () => {
    const { service, categories } = makeService(null);
    await service.getCategoryTree();
    expect(categories.findRoots).toHaveBeenCalled();
  });

  it('slug inexistente → NotFoundError en el detalle (AC-9)', async () => {
    const { service } = makeService(null);
    await expect(service.getCategoryBySlug('no-existe')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('slug inexistente → NotFoundError también en el listado, con el mismo mensaje', async () => {
    const { service } = makeService(null);
    const mensajes: string[] = [];
    for (const llamada of [
      () => service.getCategoryBySlug('no-existe'),
      () => service.listPublishedProducts('no-existe', { limit: 20, offset: 0 }),
    ]) {
      try {
        await llamada();
      } catch (e) {
        mensajes.push((e as Error).message);
      }
    }
    expect(mensajes).toHaveLength(2);
    expect(new Set(mensajes).size).toBe(1);
  });

  it('categoría inexistente: NO se consulta productos (el 404 va antes)', async () => {
    const { service, repo } = makeService(null);
    await expect(
      service.listPublishedProducts('no-existe', { limit: 20, offset: 0 }),
    ).rejects.toBeInstanceOf(NotFoundError);
    // Si se consultara igual, un catálogo grande pagaría el query de una página
    // fantasma en cada hit de scraper.
    expect(repo.findPublishedByCategoryIds).not.toHaveBeenCalled();
  });

  it('D1: un rubro agrega su id + el de sus hijos directos', async () => {
    const { service, repo } = makeService(rubroConDosHijos);

    await service.listPublishedProducts('refrigeracion', {
      limit: 20,
      offset: 0,
    });

    expect(repo.findPublishedByCategoryIds).toHaveBeenCalledWith(
      ['cat-1', 'cat-2', 'cat-3'],
      { limit: 20, offset: 0 },
    );
  });

  it('D1: un subrubro lista sólo el propio', async () => {
    const subrubro = {
      ...categoria({ id: 'cat-2', slug: 'compresores', parent_id: 'cat-1' }),
      parent: categoria(),
      children: [],
    };
    const { service, repo } = makeService(subrubro);

    await service.listPublishedProducts('compresores', {
      limit: 20,
      offset: 0,
    });

    expect(repo.findPublishedByCategoryIds).toHaveBeenCalledWith(['cat-2'], {
      limit: 20,
      offset: 0,
    });
  });
});
