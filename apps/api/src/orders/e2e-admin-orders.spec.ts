import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { adminToken, bootTestApp } from '../../test/e2e-app';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersModule } from './orders.module';

/**
 * T7.2 — supertest contra Postgres real. `bootTestApp([OrdersModule])` monta
 * SÓLO este módulo — sin el `PaymentConfirmationController` de
 * `US-023-pago-manual-offline-backend` (worktree separado, no existe acá) —
 * exactamente el escenario de riesgo de la mitigación D6: si la colisión de
 * rutas no estuviera resuelta con la forma UUID en `:id`, esta suite no lo
 * detectaría con los dos controllers presentes (ninguno matchea antes que el
 * otro por casualidad), lo detecta con SÓLO éste registrado.
 */
describe('Panel admin de órdenes (e2e-admin-orders, US-012)', () => {
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
      data: { name: 'Refrigeración', slug: 'refrigeracion-e2e-orders' },
    });
    productId = (
      await prisma.product.create({
        data: {
          sku: 'E2E-ORD-A',
          slug: 'producto-e2e-orders',
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
        access_token_hash: `h-e2e-orders-${sufijo}`,
        buyer_name: 'Comprador de Prueba',
        buyer_email: `comprador-${sufijo}@test.local`,
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
              product_sku: 'E2E-ORD-A',
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

  const auth = (req: request.Test) => req.set('Authorization', `Bearer ${adminToken()}`);

  it('GET lista sólo las 4 activas (AC-1, AC-8)', async () => {
    await crearOrden('list-pending', 'pending_payment');
    await crearOrden('list-new', 'new');
    await crearOrden('list-prep', 'preparing');

    const res = await auth(request(app.getHttpServer()).get('/v1/admin/orders'));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.map((o: { status: string }) => o.status).sort()).toEqual([
      'new',
      'preparing',
    ]);
  });

  it('GET /{uuid} de una pending_payment → 404 (AC-8)', async () => {
    const orden = await crearOrden('get-pending', 'pending_payment');

    const res = await auth(
      request(app.getHttpServer()).get(`/v1/admin/orders/${orden.id}`),
    );

    expect(res.status).toBe(404);
  });

  it("PATCH {status:'ready'} sobre una preparing → 200, status en la base, fila nueva en order_status_history (AC-3/AC-4/AC-9)", async () => {
    const orden = await crearOrden('patch-ready', 'preparing');

    const res = await auth(
      request(app.getHttpServer()).patch(`/v1/admin/orders/${orden.id}`),
    ).send({ status: 'ready' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');

    const enBase = await prisma.order.findUniqueOrThrow({ where: { id: orden.id } });
    expect(enBase.status).toBe('ready');

    const historial = await prisma.orderStatusHistory.findMany({
      where: { order_id: orden.id },
    });
    expect(historial).toHaveLength(1);
    expect(historial[0].to_status).toBe('ready');
    expect(historial[0].changed_by).toBe('admin');
  });

  it('GET /v1/admin/orders/pending-payment con token admin válido → 404 de Nest, NUNCA 400 (mitigación D6)', async () => {
    const res = await auth(
      request(app.getHttpServer()).get('/v1/admin/orders/pending-payment'),
    );

    expect(res.status).toBe(404);
    // Si la mitigación D6 no estuviera, esto matchearía get(UUID_PATH) y el
    // ParseUUIDPipe devolvería 400 tratando "pending-payment" como :id.
    expect(res.status).not.toBe(400);
  });
});
