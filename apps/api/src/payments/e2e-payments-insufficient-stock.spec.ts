import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { adminToken, bootTestApp } from '../../test/e2e-app';
import { PrismaService } from '../prisma/prisma.service';
import { CheckoutModule } from '../checkout/checkout.module';
import { StockModule } from '../stock/stock.module';
import { PaymentsModule } from './payments.module';

/**
 * T5.5 — invariante de ADR-0008 (no un AC nuevo, `design.md` §Non-goals):
 * si el stock se agotó entre el checkout y la confirmación (otra venta
 * concurrente), la confirmación se rechaza — el rechazo es observable en
 * los tres lugares: HTTP, `orders.status`, ausencia de fila en `payments`.
 */
describe('Confirmación de pago manual — stock insuficiente (e2e-payments-insufficient-stock)', () => {
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

  it('stock agotado entre checkout y confirmación → 409 dsm:payments/insufficient-stock, orden sigue pending_payment, sin fila en payments', async () => {
    const producto = await prisma.product.create({
      data: {
        sku: 'STK-A',
        slug: 'stk-a',
        name: 'Compresor',
        price_ars_cents: 100_000,
        stock: 3,
        status: 'published',
        category_id: categoriaId,
      },
    });
    const orden = await prisma.order.create({
      data: {
        access_token_hash: 'h-stk-a',
        buyer_name: 'Comprador',
        buyer_email: 'c@test.local',
        buyer_phone: '+54 351 555 0000',
        total_ars_cents: 200_000,
        consent_accepted: true,
        consent_accepted_at: new Date(),
        consent_terms_version: '2026-06-15',
        items: {
          create: [
            {
              product_id: producto.id,
              quantity: 2,
              unit_price_ars_cents: 100_000,
              product_name: 'Compresor',
              product_sku: 'STK-A',
            },
          ],
        },
      },
    });
    // Otra venta concurrente se llevó el stock entre el checkout y la confirmación.
    await prisma.product.update({ where: { id: producto.id }, data: { stock: 1 } });

    const res = await request(app.getHttpServer())
      .post(`/v1/admin/orders/${orden.id}/confirm-payment`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send();

    expect(res.status).toBe(409);
    expect(res.body.type).toBe('dsm:payments/insufficient-stock');

    const ordenEnBase = await prisma.order.findUniqueOrThrow({ where: { id: orden.id } });
    expect(ordenEnBase.status).toBe('pending_payment');

    const productoEnBase = await prisma.product.findUniqueOrThrow({ where: { id: producto.id } });
    expect(productoEnBase.stock).toBe(1);

    expect(await prisma.payment.count({ where: { order_id: orden.id } })).toBe(0);
  });
});
