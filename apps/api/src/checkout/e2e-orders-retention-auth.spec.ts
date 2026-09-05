import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { bootTestApp, customerToken } from '../../test/e2e-app';
import { CheckoutModule } from './checkout.module';
import { PrismaService } from '../prisma/prisma.service';

/**
 * T5.2 — AC-9: sólo el dueño autenticado puede anonimizar a pedido. Las tres
 * intentonas de acceso indebido no deben cambiar la orden.
 */
describe('AC-9: autorización de la anonimización a pedido (e2e-orders-retention-auth)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await bootTestApp([CheckoutModule]);
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE orders, order_items, products, categories RESTART IDENTITY CASCADE',
    );
  });

  async function crearOrden(): Promise<string> {
    const cat = await prisma.category.create({
      data: { name: 'Refrigeración', slug: 'refrigeracion-ac9' },
    });
    const producto = await prisma.product.create({
      data: {
        sku: 'AC9-A',
        slug: 'compresor-ac9',
        name: 'Compresor Embraco',
        price_ars_cents: 12_500_000,
        stock: 3,
        status: 'published',
        category_id: cat.id,
      },
    });
    const orden = await prisma.order.create({
      data: {
        access_token_hash: 'h-ac9',
        buyer_name: 'Comprador de Prueba',
        buyer_email: 'comprador-ac9@test.local',
        buyer_phone: '+54 351 555 0000',
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
              product_sku: 'AC9-A',
            },
          ],
        },
      },
    });
    return orden.id;
  }

  const expiredToken = () =>
    new JwtService({}).sign(
      { role: 'admin', sub: 'admin' },
      { secret: process.env.JWT_SECRET, expiresIn: '-1s' },
    );

  it('sin token, con token expirado, y con token de rol distinto de admin: las tres devuelven 401/403 y la orden no cambia', async () => {
    const id = await crearOrden();

    const sinToken = await request(app.getHttpServer()).post(
      `/v1/admin/orders/${id}/anonymize`,
    );
    const conExpirado = await request(app.getHttpServer())
      .post(`/v1/admin/orders/${id}/anonymize`)
      .set('Authorization', `Bearer ${expiredToken()}`);
    const conOtroRol = await request(app.getHttpServer())
      .post(`/v1/admin/orders/${id}/anonymize`)
      .set('Authorization', `Bearer ${customerToken()}`);

    expect([401, 403]).toContain(sinToken.status);
    expect([401, 403]).toContain(conExpirado.status);
    expect([401, 403]).toContain(conOtroRol.status);

    const orden = await prisma.order.findUniqueOrThrow({ where: { id } });
    expect(orden.buyer_name).toBe('Comprador de Prueba');
    expect(orden.buyer_email).toBe('comprador-ac9@test.local');
    expect(orden.anonymized_at).toBeNull();
  });
});
