import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { adminToken, bootTestApp } from '../../test/e2e-app';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersModule } from './orders.module';

/**
 * T8.5 — AC-9: trazabilidad consultable de punta a punta. Una orden que pasa
 * por las 3 transiciones de fulfillment vía 3 `PATCH` sucesivos debe tener,
 * en su `GET /{id}`, un `status_history` con exactamente 3 entradas (sin la
 * fila inicial `pending_payment→new`, fuera de scope — `proposal.md` "Out of
 * scope"), en orden cronológico.
 */
describe('AC-9 — trazabilidad de punta a punta (e2e-orders)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let productId: string;

  beforeAll(async () => {
    app = await bootTestApp([OrdersModule]);
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE orders, order_items, order_status_history, products, categories RESTART IDENTITY CASCADE',
    );
    const cat = await prisma.category.create({
      data: { name: 'Refrigeración', slug: 'refrigeracion-ac9' },
    });
    productId = (
      await prisma.product.create({
        data: {
          sku: 'AC9-A',
          slug: 'producto-ac9',
          name: 'Producto de prueba',
          price_ars_cents: 100_000,
          stock: 5,
          status: 'published',
          category_id: cat.id,
        },
      })
    ).id;
  });

  const auth = (req: request.Test) => req.set('Authorization', `Bearer ${adminToken()}`);

  it('new → preparing → ready → delivered vía 3 PATCH sucesivos: 3 entradas, cronológicas, con from/to/changed_by/changed_at', async () => {
    const orden = await prisma.order.create({
      data: {
        access_token_hash: 'h-ac9-full',
        buyer_name: 'Comprador de Prueba',
        buyer_email: 'comprador-ac9@test.local',
        buyer_phone: '+54 351 555 0000',
        total_ars_cents: 100_000,
        consent_accepted: true,
        consent_accepted_at: new Date(),
        consent_terms_version: '2026-06-15',
        status: 'new',
        items: {
          create: [
            {
              product_id: productId,
              quantity: 1,
              unit_price_ars_cents: 100_000,
              product_name: 'Producto de prueba',
              product_sku: 'AC9-A',
            },
          ],
        },
      },
    });

    for (const status of ['preparing', 'ready', 'delivered']) {
      const res = await auth(
        request(app.getHttpServer()).patch(`/v1/admin/orders/${orden.id}`),
      ).send({ status });
      expect(res.status).toBe(200);
    }

    const detalle = await auth(
      request(app.getHttpServer()).get(`/v1/admin/orders/${orden.id}`),
    );

    expect(detalle.status).toBe(200);
    expect(detalle.body.status_history).toHaveLength(3);

    const [t1, t2, t3] = detalle.body.status_history;
    expect(t1).toMatchObject({ from_status: 'new', to_status: 'preparing' });
    expect(t2).toMatchObject({ from_status: 'preparing', to_status: 'ready' });
    expect(t3).toMatchObject({ from_status: 'ready', to_status: 'delivered' });
    for (const fila of [t1, t2, t3]) {
      expect(fila.changed_by).toBe('admin');
      expect(new Date(fila.changed_at).toString()).not.toBe('Invalid Date');
    }
    // Orden cronológico: cada changed_at es >= al anterior.
    expect(new Date(t1.changed_at).getTime()).toBeLessThanOrEqual(
      new Date(t2.changed_at).getTime(),
    );
    expect(new Date(t2.changed_at).getTime()).toBeLessThanOrEqual(
      new Date(t3.changed_at).getTime(),
    );
  });
});
