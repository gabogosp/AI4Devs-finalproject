import { PrismaService } from '../prisma/prisma.service';
import { ReviewsRepository } from './reviews.repository';

/**
 * T3 (US-025) — integration contra Postgres real, mismo criterio que
 * `customers.repository.spec.ts`/`orders.repository.spec.ts`: único punto
 * de acceso al ORM de `reviews` (§5).
 */
describe('ReviewsRepository (integration)', () => {
  const prisma = new PrismaService();
  const repo = new ReviewsRepository(prisma);

  let clienteA = '';
  let clienteB = '';
  let productoA = '';
  let productoB = '';

  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE reviews, order_items, orders, products, categories, customers RESTART IDENTITY CASCADE',
    );
    const cat = await prisma.category.create({
      data: { name: 'Refrigeración', slug: 'refrigeracion-resenas' },
    });
    productoA = (
      await prisma.product.create({
        data: {
          sku: 'RESENA-A',
          slug: 'taladro-x',
          name: 'Taladro X',
          price_ars_cents: 500_000,
          stock: 5,
          status: 'published',
          category_id: cat.id,
        },
      })
    ).id;
    productoB = (
      await prisma.product.create({
        data: {
          sku: 'RESENA-B',
          slug: 'sierra-y',
          name: 'Sierra Y',
          price_ars_cents: 700_000,
          stock: 5,
          status: 'published',
          category_id: cat.id,
        },
      })
    ).id;
    clienteA = (
      await prisma.customer.create({
        data: { email: 'ana@test.local', password_hash: 'hash', name: 'Ana' },
      })
    ).id;
    clienteB = (
      await prisma.customer.create({
        data: { email: 'beto@test.local', password_hash: 'hash', name: 'Beto' },
      })
    ).id;
  });

  describe('upsert', () => {
    it('crea la reseña si no existe', async () => {
      const creada = await repo.upsert(clienteA, productoA, {
        rating: 4,
        comment: 'Anduvo bien',
      });
      expect(creada.rating).toBe(4);
      expect(creada.comment).toBe('Anduvo bien');
      expect(creada.hidden_at).toBeNull();
    });

    it('AC-5: reeditar actualiza la MISMA fila, no crea una segunda', async () => {
      const primera = await repo.upsert(clienteA, productoA, { rating: 3, comment: null });
      const segunda = await repo.upsert(clienteA, productoA, { rating: 5, comment: 'Mejor de lo esperado' });

      expect(segunda.id).toBe(primera.id);
      expect(segunda.rating).toBe(5);
      expect(segunda.comment).toBe('Mejor de lo esperado');
      expect(await prisma.review.count()).toBe(1);
    });

    it('AC-2: comment null es válido', async () => {
      const creada = await repo.upsert(clienteA, productoA, { rating: 5, comment: null });
      expect(creada.comment).toBeNull();
    });
  });

  describe('findOwn', () => {
    it('devuelve la reseña propia, null si no existe', async () => {
      await repo.upsert(clienteA, productoA, { rating: 4, comment: null });

      expect(await repo.findOwn(clienteA, productoA)).not.toBeNull();
      expect(await repo.findOwn(clienteB, productoA)).toBeNull();
      expect(await repo.findOwn(clienteA, productoB)).toBeNull();
    });
  });

  describe('findVisibleByProduct / aggregateVisible', () => {
    it('excluye reseñas ocultas de la lista y del agregado', async () => {
      const r1 = await repo.upsert(clienteA, productoA, { rating: 5, comment: 'Excelente' });
      await repo.upsert(clienteB, productoA, { rating: 3, comment: 'Regular' });
      await repo.setHidden(r1.id, true);

      const { data, total } = await repo.findVisibleByProduct(productoA, { limit: 10, offset: 0 });
      expect(total).toBe(1);
      expect(data.map((r) => r.id)).not.toContain(r1.id);

      const agregado = await repo.aggregateVisible(productoA);
      expect(agregado.count).toBe(1);
      expect(agregado.average).toBe(3);
    });

    it('AC-4: sin reseñas visibles, average null y count 0', async () => {
      const agregado = await repo.aggregateVisible(productoA);
      expect(agregado.average).toBeNull();
      expect(agregado.count).toBe(0);
    });

    it('incluye el nombre del autor', async () => {
      await repo.upsert(clienteA, productoA, { rating: 4, comment: null });

      const { data } = await repo.findVisibleByProduct(productoA, { limit: 10, offset: 0 });
      expect(data[0].customer.name).toBe('Ana');
    });
  });

  describe('setHidden', () => {
    it('togglea hidden_at en ambas direcciones', async () => {
      const creada = await repo.upsert(clienteA, productoA, { rating: 4, comment: null });

      const oculta = await repo.setHidden(creada.id, true);
      expect(oculta?.hidden_at).not.toBeNull();

      const mostrada = await repo.setHidden(creada.id, false);
      expect(mostrada?.hidden_at).toBeNull();
    });

    it('id inexistente: devuelve null', async () => {
      expect(await repo.setHidden('00000000-0000-0000-0000-000000000000', true)).toBeNull();
    });
  });
});
