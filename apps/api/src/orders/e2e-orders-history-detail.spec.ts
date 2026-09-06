import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { bootTestApp } from '../../test/e2e-app';
import { PrismaService } from '../prisma/prisma.service';
import { ACCESS_COOKIE } from '../auth/cookies';
import { JWT_AUDIENCE, JWT_ISSUER } from '../auth/session.service';
import { OrdersModule } from './orders.module';

/**
 * T5.8 — AC-2 (detalle con items/fulfillment/status), AC-4 (sólo la propia),
 * AC-5 (requiere sesión). El caso central: "orden ajena" y "orden
 * inexistente" devuelven EL MISMO type/status RFC 7807 — indistinguibles
 * (design.md §D3, IDOR).
 */
describe('GET /v1/me/orders/:order_number — detalle del historial (e2e-orders-history-detail, US-015 T5.8)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let productId: string;
  const jwt = new JwtService({});

  beforeAll(async () => {
    app = await bootTestApp([OrdersModule]);
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE orders, order_items, products, categories, customers RESTART IDENTITY CASCADE',
    );
    const cat = await prisma.category.create({
      data: { name: 'Refrigeración', slug: 'refrigeracion-e2e-orders-history-detail' },
    });
    productId = (
      await prisma.product.create({
        data: {
          sku: 'E2E-ORD-HIST-DET-A',
          slug: 'producto-e2e-orders-history-detail',
          name: 'Producto de prueba',
          price_ars_cents: 100_000,
          stock: 5,
          status: 'published',
          category_id: cat.id,
        },
      })
    ).id;
  });

  function accessCookie(customerId: string): string {
    const token = jwt.sign(
      { sub: customerId, role: 'customer', typ: 'access', jti: 'jti-detail-test' },
      { secret: process.env.JWT_SECRET, issuer: JWT_ISSUER, audience: JWT_AUDIENCE },
    );
    return `${ACCESS_COOKIE}=${token}`;
  }

  async function crearOrden(sufijo: string, customerId: string, status = 'new') {
    return prisma.order.create({
      data: {
        access_token_hash: `h-hist-detail-${sufijo}`,
        customer_id: customerId,
        buyer_name: 'Comprador de Prueba',
        buyer_email: `comprador-${sufijo}@test.local`,
        buyer_phone: '+54 351 555 0000',
        total_ars_cents: 200_000,
        status,
        fulfillment: 'pickup',
        consent_accepted: true,
        consent_accepted_at: new Date(),
        consent_terms_version: '2026-06-15',
        items: {
          create: [
            {
              product_id: productId,
              quantity: 2,
              unit_price_ars_cents: 100_000,
              product_name: 'Producto de prueba',
              product_sku: 'E2E-ORD-HIST-DET-A',
            },
          ],
        },
      },
    });
  }

  it('sin cookie: 401 (AC-5)', async () => {
    const res = await request(app.getHttpServer()).get('/v1/me/orders/1');
    expect(res.status).toBe(401);
  });

  it('con cookie propia sobre una orden propia: 200 con items/fulfillment/status (AC-2)', async () => {
    const cliente = await prisma.customer.create({
      data: { email: 'propio-detail@test.local', password_hash: 'hash', name: 'Propio' },
    });
    const orden = await crearOrden('propia', cliente.id);

    const res = await request(app.getHttpServer())
      .get(`/v1/me/orders/${orden.order_number}`)
      .set('Cookie', accessCookie(cliente.id));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      order_number: orden.order_number,
      status: 'new',
      total_ars_cents: 200_000,
      created_at: orden.created_at.toISOString(),
      fulfillment: 'pickup',
      items: [
        {
          product_name: 'Producto de prueba',
          product_sku: 'E2E-ORD-HIST-DET-A',
          quantity: 2,
          unit_price_ars_cents: 100_000,
          subtotal_ars_cents: 200_000,
        },
      ],
    });
  });

  it('cookie de OTRO cliente sobre un order_number que no es suyo -> 404, MISMO type/status que "inexistente" (AC-4, IDOR)', async () => {
    const propio = await prisma.customer.create({
      data: { email: 'propio-idor@test.local', password_hash: 'hash', name: 'Propio' },
    });
    const otro = await prisma.customer.create({
      data: { email: 'otro-idor@test.local', password_hash: 'hash', name: 'Otro' },
    });
    const orden = await crearOrden('ajena', propio.id);

    const resAjena = await request(app.getHttpServer())
      .get(`/v1/me/orders/${orden.order_number}`)
      .set('Cookie', accessCookie(otro.id));
    const resInexistente = await request(app.getHttpServer())
      .get('/v1/me/orders/999999')
      .set('Cookie', accessCookie(otro.id));

    expect(resAjena.status).toBe(404);
    expect(resInexistente.status).toBe(404);
    expect(resAjena.body.type).toBe(resInexistente.body.type);
    expect(resAjena.body.status).toBe(resInexistente.body.status);
  });
});
