import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { bootTestApp } from '../../test/e2e-app';
import { PrismaService } from '../prisma/prisma.service';
import { CheckoutModule } from '../checkout/checkout.module';
import { StockModule } from '../stock/stock.module';
import { PaymentsModule } from './payments.module';

/**
 * T5.4 (US-023 AC-6) — el registro de quién y cuándo, sacado del JWT real
 * (no inyectado a mano): `confirmed_by` es el `sub` del token, `processed_at`
 * queda dentro de un margen razonable del request (mismo margen que
 * `SC-008-N3` de US-008 usó para `consent_accepted_at`). El caso del token de
 * bootstrap (`sub: 'admin'`, sin fila en `Customer`) prueba que `confirmed_by`
 * no exige FK.
 */
describe('Confirmación de pago manual — registro auditable (e2e-payments-audit-trail)', () => {
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

  async function sembrarOrdenPendiente(sku: string) {
    const producto = await prisma.product.create({
      data: {
        sku,
        slug: sku.toLowerCase(),
        name: sku,
        price_ars_cents: 100_000,
        stock: 5,
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

  function tokenPara(sub: string): string {
    const jwt = new JwtService({});
    return jwt.sign({ role: 'admin', sub }, { secret: process.env.JWT_SECRET });
  }

  it('confirmed_by = sub del JWT (admin registrado con uuid), processed_at dentro de los 5s del request', async () => {
    const orden = await sembrarOrdenPendiente('AUDIT-A');
    const antes = Date.now();

    const res = await request(app.getHttpServer())
      .post(`/v1/admin/orders/${orden.id}/confirm-payment`)
      .set('Authorization', `Bearer ${tokenPara('7c1a2b3c-4d5e-4f60-8a1b-2c3d4e5f6071')}`)
      .send();

    expect(res.status).toBe(200);
    const pago = await prisma.payment.findFirstOrThrow({ where: { order_id: orden.id } });
    expect(pago.confirmed_by).toBe('7c1a2b3c-4d5e-4f60-8a1b-2c3d4e5f6071');
    expect(pago.processed_at!.getTime()).toBeGreaterThanOrEqual(antes);
    expect(pago.processed_at!.getTime()).toBeLessThan(antes + 5000);
  });

  it('sesión de bootstrap (sub: "admin", sin fila en Customer) también queda registrada — confirmed_by sin FK', async () => {
    const orden = await sembrarOrdenPendiente('AUDIT-B');

    const res = await request(app.getHttpServer())
      .post(`/v1/admin/orders/${orden.id}/confirm-payment`)
      .set('Authorization', `Bearer ${tokenPara('admin')}`)
      .send();

    expect(res.status).toBe(200);
    const pago = await prisma.payment.findFirstOrThrow({ where: { order_id: orden.id } });
    expect(pago.confirmed_by).toBe('admin');
  });
});
