import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { adminToken, bootTestApp } from '../../test/e2e-app';
import { PrismaService } from '../prisma/prisma.service';
import { CheckoutModule } from '../checkout/checkout.module';
import { StockModule } from '../stock/stock.module';
import { PaymentsModule } from './payments.module';

/**
 * T5.1 (US-023 AC-1, AC-2) — recorrido de punta a punta por HTTP: sembrar una
 * orden `pending_payment` REAL (no un insert directo — via `OrdersRepository`,
 * el mismo camino que usaría el checkout), confirmarla por HTTP, y verificar
 * en base que la orden/stock/payments reflejan la confirmación. `GET
 * /pending-payment` se prueba junto porque comparten el mismo seed.
 */
describe('Confirmación de pago manual — happy path (e2e-payments-confirm-happy)', () => {
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

  async function sembrarOrdenPendiente(sku: string, stockInicial: number, qty: number) {
    const producto = await prisma.product.create({
      data: {
        sku,
        slug: sku.toLowerCase(),
        name: sku,
        price_ars_cents: 100_000,
        stock: stockInicial,
        status: 'published',
        category_id: categoriaId,
      },
    });
    return prisma.order.create({
      data: {
        access_token_hash: `h-${sku}`,
        buyer_name: 'Juana Pérez',
        buyer_email: 'juana@test.local',
        buyer_phone: '+54 351 555 0000',
        total_ars_cents: qty * 100_000,
        consent_accepted: true,
        consent_accepted_at: new Date(),
        consent_terms_version: '2026-06-15',
        items: {
          create: [
            {
              product_id: producto.id,
              quantity: qty,
              unit_price_ars_cents: 100_000,
              product_name: sku,
              product_sku: sku,
            },
          ],
        },
      },
    });
  }

  it('POST confirm-payment → 200 con {order_number, status: "new"} (AC-1)', async () => {
    const orden = await sembrarOrdenPendiente('HAPPY-A', 5, 2);

    const res = await request(app.getHttpServer())
      .post(`/v1/admin/orders/${orden.id}/confirm-payment`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ order_number: orden.order_number, status: 'new' });

    const enBase = await prisma.order.findUniqueOrThrow({ where: { id: orden.id } });
    expect(enBase.status).toBe('new');
  });

  it('GET pending-payment → 200 con id + order_number + buyer_name + total_ars_cents + created_at, y ya no lista la confirmada (AC-2)', async () => {
    const pendiente = await sembrarOrdenPendiente('HAPPY-B', 5, 1);
    const aConfirmar = await sembrarOrdenPendiente('HAPPY-C', 5, 1);

    await request(app.getHttpServer())
      .post(`/v1/admin/orders/${aConfirmar.id}/confirm-payment`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send();

    const res = await request(app.getHttpServer())
      .get('/v1/admin/orders/pending-payment')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        id: pendiente.id,
        order_number: pendiente.order_number,
        buyer_name: 'Juana Pérez',
        total_ars_cents: 100_000,
        created_at: pendiente.created_at.toISOString(),
      },
    ]);
  });
});
