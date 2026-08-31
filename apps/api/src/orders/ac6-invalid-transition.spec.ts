import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { adminToken, bootTestApp } from '../../test/e2e-app';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersModule } from './orders.module';
import { NOTIFICATION_PORT, NotificationPort } from './ports/notification.port';

/**
 * T8.1 — AC-6: la UI nunca ofrece un salto inválido, pero el backend es la
 * AUTORIDAD REAL — un cliente que igual lo intenta (o dos pestañas en carrera)
 * nunca deja la orden en un estado inconsistente.
 */
describe('AC-6 — transición inválida bloqueada, incluida la carrera (e2e-orders)', () => {
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
      data: { name: 'Refrigeración', slug: 'refrigeracion-ac6' },
    });
    productId = (
      await prisma.product.create({
        data: {
          sku: 'AC6-A',
          slug: 'producto-ac6',
          name: 'Producto de prueba',
          price_ars_cents: 100_000,
          stock: 5,
          status: 'published',
          category_id: cat.id,
        },
      })
    ).id;
  });

  async function crearOrden(sufijo: string, status: string) {
    const orden = await prisma.order.create({
      data: {
        access_token_hash: `h-ac6-${sufijo}`,
        buyer_name: 'Comprador de Prueba',
        buyer_email: `comprador-ac6-${sufijo}@test.local`,
        buyer_phone: '+54 351 555 0000',
        total_ars_cents: 100_000,
        consent_accepted: true,
        consent_accepted_at: new Date(),
        consent_terms_version: '2026-06-15',
        status: 'pending_payment',
        items: {
          create: [
            {
              product_id: productId,
              quantity: 1,
              unit_price_ars_cents: 100_000,
              product_name: 'Producto de prueba',
              product_sku: 'AC6-A',
            },
          ],
        },
      },
    });
    if (status !== 'pending_payment') {
      await prisma.order.update({ where: { id: orden.id }, data: { status } });
    }
    return orden;
  }

  const patch = (id: string, status: string) =>
    request(app.getHttpServer())
      .patch(`/v1/admin/orders/${id}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ status });

  it('salto de dos pasos (new → delivered) → 409, status intacto, cero filas nuevas', async () => {
    const orden = await crearOrden('salto', 'new');

    const res = await patch(orden.id, 'delivered');

    expect(res.status).toBe(409);
    const enBase = await prisma.order.findUniqueOrThrow({ where: { id: orden.id } });
    expect(enBase.status).toBe('new');
    expect(await prisma.orderStatusHistory.count({ where: { order_id: orden.id } })).toBe(0);
  });

  it('carrera: 2 PATCH {ready} simultáneos sobre preparing → 1 fila de historial, status determinístico, notificación UNA sola vez', async () => {
    const orden = await crearOrden('race', 'preparing');
    const notifications = app.get<NotificationPort>(NOTIFICATION_PORT);
    const spy = jest.spyOn(notifications, 'orderReadyForPickup');
    spy.mockClear();

    const [r1, r2] = await Promise.all([
      patch(orden.id, 'ready'),
      patch(orden.id, 'ready'),
    ]);

    // Ambos responden 200: uno aplicó la transición real, el otro cayó en el
    // camino no-op (ya está en `ready` cuando llega) — ninguno de los dos es
    // un error del cliente.
    expect([r1.status, r2.status]).toEqual([200, 200]);

    const enBase = await prisma.order.findUniqueOrThrow({ where: { id: orden.id } });
    expect(enBase.status).toBe('ready');
    expect(
      await prisma.orderStatusHistory.count({ where: { order_id: orden.id } }),
    ).toBe(1);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
