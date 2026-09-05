import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { adminToken, bootTestApp } from '../../test/e2e-app';
import { PrismaService } from '../prisma/prisma.service';
import { CheckoutModule } from '../checkout/checkout.module';
import { StockModule } from '../stock/stock.module';
import { PaymentsModule } from './payments.module';

/**
 * T5.3 (US-023 AC-4, AC-5) — estado inválido y doble confirmación comparten
 * el mismo 409 `dsm:payments/order-not-pending-payment`. El caso concurrente
 * (dos `POST` con `Promise.all`) es la prueba real de que el guard funciona
 * bajo carrera, no sólo en secuencia.
 */
describe('Confirmación de pago manual — estado inválido y doble confirmación (e2e-payments-idempotency)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let categoriaId: string;

  beforeAll(async () => {
    app = await bootTestApp([CheckoutModule, StockModule, PaymentsModule]);
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE payments, orders, order_items, products, categories RESTART IDENTITY CASCADE',
    );
    categoriaId = (
      await prisma.category.create({ data: { name: 'Refrigeración', slug: 'refrigeracion' } })
    ).id;
  });

  async function sembrarOrden(sku: string, status: string) {
    const producto = await prisma.product.create({
      data: {
        sku,
        slug: sku.toLowerCase(),
        name: sku,
        price_ars_cents: 100_000,
        stock: 10,
        status: 'published',
        category_id: categoriaId,
      },
    });
    return prisma.order.create({
      data: {
        access_token_hash: `h-${sku}`,
        buyer_name: 'Comprador',
        buyer_email: 'c@test.local',
        buyer_phone: '+54 351 555 0000',
        total_ars_cents: 100_000,
        status,
        consent_accepted: true,
        consent_accepted_at: new Date(),
        consent_terms_version: '2026-06-15',
        items: {
          create: [
            {
              product_id: producto.id,
              quantity: 1,
              unit_price_ars_cents: 100_000,
              product_name: sku,
              product_sku: sku,
            },
          ],
        },
      },
    });
  }

  const post = (orderId: string) =>
    request(app.getHttpServer())
      .post(`/v1/admin/orders/${orderId}/confirm-payment`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send();

  it.each(['new', 'cancelled'])(
    'orden en estado "%s" → 409 dsm:payments/order-not-pending-payment (AC-4)',
    async (status) => {
      const orden = await sembrarOrden(`INV-${status}`, status);
      const res = await post(orden.id);
      expect(res.status).toBe(409);
      expect(res.body.type).toBe('dsm:payments/order-not-pending-payment');
    },
  );

  it('doble click secuencial: la primera 200, la segunda 409, sin efectos duplicados (AC-5)', async () => {
    const orden = await sembrarOrden('DOBLE-A', 'pending_payment');

    const primera = await post(orden.id);
    const segunda = await post(orden.id);

    expect(primera.status).toBe(200);
    expect(segunda.status).toBe(409);
    expect(segunda.body.type).toBe('dsm:payments/order-not-pending-payment');
    expect(await prisma.payment.count({ where: { order_id: orden.id } })).toBe(1);
  });

  it('dos POST concurrentes sobre la misma orden: exactamente uno 200, exactamente uno 409, una sola fila en payments', async () => {
    const orden = await sembrarOrden('CONCURR-A', 'pending_payment');

    const [a, b] = await Promise.all([post(orden.id), post(orden.id)]);
    const statuses = [a.status, b.status].sort();

    expect(statuses).toEqual([200, 409]);
    expect(await prisma.payment.count({ where: { order_id: orden.id } })).toBe(1);
  });
});
