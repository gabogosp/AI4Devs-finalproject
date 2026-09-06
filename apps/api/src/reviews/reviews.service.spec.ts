import { PrismaService } from '../prisma/prisma.service';
import { ProductsRepository } from '../products/products.repository';
import { OrdersRepository } from '../checkout/orders.repository';
import { ReviewsRepository } from './reviews.repository';
import { ReviewsService } from './reviews.service';
import { ReviewNotEligibleError } from './reviews-errors';
import { NotFoundError } from '../common/errors/domain-errors';

/**
 * T5 (US-025) — integración contra Postgres real, mismo estilo que
 * `account-deletion.service.spec.ts`: repos reales, sin mocks.
 */
describe('ReviewsService (integration)', () => {
  const prisma = new PrismaService();
  const products = new ProductsRepository(prisma);
  const orders = new OrdersRepository(prisma);
  const reviews = new ReviewsRepository(prisma);
  const service = new ReviewsService(reviews, orders, products);

  let clienteElegible = '';
  let clienteNoElegible = '';
  let productoPublicado = '';

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
      data: { name: 'Herramientas', slug: 'herramientas-resenas-service' },
    });
    productoPublicado = (
      await prisma.product.create({
        data: {
          sku: 'RESENA-SVC-A',
          slug: 'taladro-x-svc',
          name: 'Taladro X',
          price_ars_cents: 500_000,
          stock: 5,
          status: 'published',
          category_id: cat.id,
        },
      })
    ).id;
    await prisma.product.create({
      data: {
        sku: 'RESENA-SVC-B',
        slug: 'taladro-draft-svc',
        name: 'Taladro Draft',
        price_ars_cents: 500_000,
        stock: 5,
        status: 'draft',
        category_id: cat.id,
      },
    });
    clienteElegible = (
      await prisma.customer.create({
        data: { email: 'elegible@test.local', password_hash: 'hash', name: 'Elegible' },
      })
    ).id;
    clienteNoElegible = (
      await prisma.customer.create({
        data: { email: 'no-elegible@test.local', password_hash: 'hash', name: 'No Elegible' },
      })
    ).id;

    const orden = await orders.createPendingOrder({
      accessTokenHash: 'h-svc-1',
      buyerName: 'Elegible',
      buyerEmail: 'elegible@test.local',
      buyerPhone: '+54 351 555 0000',
      consentAcceptedAt: new Date(),
      consentTermsVersion: '2026-06-15',
      totalArsCents: 500_000,
      lines: [
        {
          productId: productoPublicado,
          quantity: 1,
          unitPriceArsCents: 500_000,
          productName: 'Taladro X',
          productSku: 'RESENA-SVC-A',
        },
      ],
    });
    await prisma.order.update({
      where: { id: orden.id },
      data: { customer_id: clienteElegible, status: 'delivered' },
    });
  });

  describe('getOwn', () => {
    it('elegible sin reseña todavía: eligible true, review null', async () => {
      const resultado = await service.getOwn(clienteElegible, productoPublicado);
      expect(resultado).toEqual({ eligible: true, review: null });
    });

    it('no elegible: eligible false', async () => {
      const resultado = await service.getOwn(clienteNoElegible, productoPublicado);
      expect(resultado.eligible).toBe(false);
      expect(resultado.review).toBeNull();
    });

    it('AC-8: reseña oculta sigue devolviéndose al autor con hidden true', async () => {
      const creada = await service.upsertOwn(clienteElegible, productoPublicado, {
        rating: 5,
        comment: null,
      });
      await reviews.setHidden(creada.id, true);

      const propia = await service.getOwn(clienteElegible, productoPublicado);
      expect(propia.review?.hidden_at).not.toBeNull();
    });
  });

  describe('upsertOwn', () => {
    it('elegible: crea la reseña', async () => {
      const creada = await service.upsertOwn(clienteElegible, productoPublicado, {
        rating: 4,
        comment: 'Anduvo bien',
      });
      expect(creada.rating).toBe(4);
    });

    it('AC-6: no elegible → ReviewNotEligibleError, sin escribir ninguna fila', async () => {
      const antes = await prisma.review.count();

      await expect(
        service.upsertOwn(clienteNoElegible, productoPublicado, { rating: 5, comment: null }),
      ).rejects.toThrow(ReviewNotEligibleError);

      expect(await prisma.review.count()).toBe(antes);
    });
  });

  describe('listPublic', () => {
    it('slug inexistente: NotFoundError', async () => {
      await expect(service.listPublic('no-existe', { limit: 10, offset: 0 })).rejects.toThrow(
        NotFoundError,
      );
    });

    it('producto en draft: NotFoundError (mismo criterio que la ficha pública)', async () => {
      await expect(
        service.listPublic('taladro-draft-svc', { limit: 10, offset: 0 }),
      ).rejects.toThrow(NotFoundError);
    });

    it('producto publicado sin reseñas: average null, count 0, data vacío', async () => {
      const resultado = await service.listPublic('taladro-x-svc', { limit: 10, offset: 0 });
      expect(resultado.average).toBeNull();
      expect(resultado.count).toBe(0);
      expect(resultado.data).toEqual([]);
    });
  });
});
