import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { bootTestApp, customerToken } from '../../test/e2e-app';
import { PrismaService } from '../prisma/prisma.service';
import { CheckoutModule } from '../checkout/checkout.module';
import { StockModule } from '../stock/stock.module';
import { PaymentsModule } from './payments.module';

/**
 * T5.2 (US-023 AC-3) — ninguna de las dos rutas cambia estado ni devuelve
 * datos sin un JWT `role=admin` válido. Mismo estilo que `e2e-admin-auth.spec.ts`.
 */
describe('Confirmación de pago manual — auth (e2e-payments-auth)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ordenId: string;

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
    const cat = await prisma.category.create({
      data: { name: 'Refrigeración', slug: 'refrigeracion' },
    });
    const producto = await prisma.product.create({
      data: {
        sku: 'AUTH-A',
        slug: 'auth-a',
        name: 'Compresor',
        price_ars_cents: 100_000,
        stock: 5,
        status: 'published',
        category_id: cat.id,
      },
    });
    ordenId = (
      await prisma.order.create({
        data: {
          access_token_hash: 'h-auth-a',
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
                product_name: 'Compresor',
                product_sku: 'AUTH-A',
              },
            ],
          },
        },
      })
    ).id;
  });

  function otroRolToken(role: string): string {
    const jwt = new JwtService({});
    return jwt.sign({ role, sub: 'x' }, { secret: process.env.JWT_SECRET });
  }

  it('POST sin Authorization → 401, orden sin cambios', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/admin/orders/${ordenId}/confirm-payment`)
      .send();
    expect(res.status).toBe(401);

    const enBase = await prisma.order.findUniqueOrThrow({ where: { id: ordenId } });
    expect(enBase.status).toBe('pending_payment');
  });

  it('POST con JWT de customer (role != admin) → 403, orden sin cambios', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/admin/orders/${ordenId}/confirm-payment`)
      .set('Authorization', `Bearer ${customerToken()}`)
      .send();
    expect(res.status).toBe(403);

    const enBase = await prisma.order.findUniqueOrThrow({ where: { id: ordenId } });
    expect(enBase.status).toBe('pending_payment');
  });

  it('POST con JWT sin claim role → 403', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/admin/orders/${ordenId}/confirm-payment`)
      .set('Authorization', `Bearer ${otroRolToken('')}`)
      .send();
    expect(res.status).toBe(403);
  });

  it('GET pending-payment sin Authorization → 401', async () => {
    const res = await request(app.getHttpServer()).get('/v1/admin/orders/pending-payment');
    expect(res.status).toBe(401);
  });

  it('GET pending-payment con JWT de customer → 403', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/admin/orders/pending-payment')
      .set('Authorization', `Bearer ${customerToken()}`);
    expect(res.status).toBe(403);
  });
});
