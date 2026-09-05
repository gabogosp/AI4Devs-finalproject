import { PrismaService } from '../prisma/prisma.service';
import { OrdersRepository } from './orders.repository';

/**
 * T5.5 — AC-7 (negative-space): el registro de consentimiento (aceptado,
 * cuándo, sobre qué versión) sobrevive intacto a la anonimización.
 */
describe('AC-7: el consentimiento sobrevive a la anonimización (ac7-consent-preserved-after-anonymization)', () => {
  const prisma = new PrismaService();
  const orders = new OrdersRepository(prisma);

  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE orders, order_items, products, categories RESTART IDENTITY CASCADE',
    );
  });

  it('consent_accepted, consent_accepted_at y consent_terms_version son idénticos antes y después de anonimizar', async () => {
    const cat = await prisma.category.create({
      data: { name: 'Refrigeración', slug: 'refrigeracion-ac7' },
    });
    const producto = await prisma.product.create({
      data: {
        sku: 'AC7-A',
        slug: 'compresor-ac7',
        name: 'Compresor Embraco',
        price_ars_cents: 12_500_000,
        stock: 5,
        status: 'published',
        category_id: cat.id,
      },
    });
    const consentAcceptedAt = new Date('2026-06-20T15:30:00.000Z');
    const orden = await prisma.order.create({
      data: {
        access_token_hash: 'h-ac7',
        buyer_name: 'Comprador de Prueba',
        buyer_email: 'comprador-ac7@test.local',
        buyer_phone: '+54 351 555 0000',
        total_ars_cents: 12_500_000,
        consent_accepted: true,
        consent_accepted_at: consentAcceptedAt,
        consent_terms_version: '2026-06-15',
        items: {
          create: [
            {
              product_id: producto.id,
              quantity: 1,
              unit_price_ars_cents: 12_500_000,
              product_name: 'Compresor Embraco',
              product_sku: 'AC7-A',
            },
          ],
        },
      },
    });

    await orders.anonymize(orden.id, 'requested');

    const releida = await prisma.order.findUniqueOrThrow({ where: { id: orden.id } });

    expect(releida.consent_accepted).toBe(true);
    expect(releida.consent_accepted_at).toEqual(consentAcceptedAt);
    expect(releida.consent_terms_version).toBe('2026-06-15');
  });
});
