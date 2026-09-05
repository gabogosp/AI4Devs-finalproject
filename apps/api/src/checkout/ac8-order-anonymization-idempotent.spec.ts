import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { adminToken, bootTestApp } from '../../test/e2e-app';
import { CheckoutModule } from './checkout.module';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersRepository } from './orders.repository';

/**
 * T5.1 + T5.6 — AC-8: idempotencia (llamar tres veces seguidas no cambia
 * nada ni produce error) e irreversibilidad (ningún camino de lectura, ni el
 * log, devuelve la PII original una vez anonimizada).
 */
describe('AC-8: anonimizar es idempotente y no reversible (ac8-order-anonymization-idempotent)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orders: OrdersRepository;

  beforeAll(async () => {
    app = await bootTestApp([CheckoutModule]);
    prisma = app.get(PrismaService);
    orders = app.get(OrdersRepository);
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE orders, order_items, products, categories RESTART IDENTITY CASCADE',
    );
  });

  async function crearOrden(sufijo: string) {
    const cat = await prisma.category.create({
      data: { name: 'Refrigeración', slug: `refrigeracion-${sufijo}` },
    });
    const producto = await prisma.product.create({
      data: {
        sku: `AC8-${sufijo}`,
        slug: `compresor-${sufijo}`,
        name: 'Compresor Embraco',
        price_ars_cents: 12_500_000,
        stock: 3,
        status: 'published',
        category_id: cat.id,
      },
    });
    return prisma.order.create({
      data: {
        access_token_hash: `h-ac8-${sufijo}`,
        buyer_name: 'Comprador Original',
        buyer_email: `original-${sufijo}@test.local`,
        buyer_phone: '+54 351 555 9999',
        total_ars_cents: 12_500_000,
        consent_accepted: true,
        consent_accepted_at: new Date(),
        consent_terms_version: '2026-06-15',
        items: {
          create: [
            {
              product_id: producto.id,
              quantity: 1,
              unit_price_ars_cents: 12_500_000,
              product_name: 'Compresor Embraco',
              product_sku: `AC8-${sufijo}`,
            },
          ],
        },
      },
    });
  }

  it('T5.1 — tres llamadas seguidas al repo: mismo estado final, sin error, sin cambio entre la 2ª y la 3ª', async () => {
    const orden = await crearOrden('repo');

    const primera = await orders.anonymize(orden.id, 'requested');
    const segunda = await orders.anonymize(orden.id, 'requested');
    const tercera = await orders.anonymize(orden.id, 'requested');

    expect(primera).not.toBeNull();
    expect(segunda?.anonymizedAt).toEqual(primera?.anonymizedAt);
    expect(tercera?.anonymizedAt).toEqual(segunda?.anonymizedAt);
  });

  it('T5.1 — tres POST .../anonymize seguidos: mismo estado final, sin error, sin cambio entre el 2º y el 3º', async () => {
    const orden = await crearOrden('e2e');
    const post = () =>
      request(app.getHttpServer())
        .post(`/v1/admin/orders/${orden.id}/anonymize`)
        .set('Authorization', `Bearer ${adminToken()}`);

    const primera = await post();
    const segunda = await post();
    const tercera = await post();

    expect(primera.status).toBe(200);
    expect(segunda.status).toBe(200);
    expect(tercera.status).toBe(200);
    expect(segunda.body.anonymized_at).toBe(primera.body.anonymized_at);
    expect(tercera.body.anonymized_at).toBe(segunda.body.anonymized_at);
  });

  it('T5.6 — findById sobre una orden anonimizada nunca devuelve los valores originales sembrados', async () => {
    const orden = await crearOrden('irrev-read');
    await orders.anonymize(orden.id, 'requested');

    const releida = await orders.findById(orden.id);

    expect(releida?.buyer_name).not.toBe('Comprador Original');
    expect(releida?.buyer_email).not.toContain('original-irrev-read');
    expect(releida?.buyer_phone).not.toBe('+54 351 555 9999');
  });

  it('T5.6 — el log emitido por anonymizeOnRequest no contiene los valores originales sembrados', async () => {
    const orden = await crearOrden('irrev-log');
    const capturado: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      capturado.push(String(chunk));
      return true;
    });

    try {
      await request(app.getHttpServer())
        .post(`/v1/admin/orders/${orden.id}/anonymize`)
        .set('Authorization', `Bearer ${adminToken()}`);
    } finally {
      (process.stdout.write as jest.Mock).mockRestore();
      void originalWrite;
    }

    const logCompleto = capturado.join('\n');
    expect(logCompleto).not.toContain('Comprador Original');
    expect(logCompleto).not.toContain('original-irrev-log');
    expect(logCompleto).not.toContain('+54 351 555 9999');
  });
});
