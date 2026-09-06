import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { bootTestApp } from '../../test/e2e-app';
import { PrismaService } from '../prisma/prisma.service';
import { ACCESS_COOKIE } from '../auth/cookies';
import { JWT_AUDIENCE, JWT_ISSUER } from '../auth/session.service';
import { OrdersModule } from './orders.module';

/**
 * T4.3 — supertest contra Postgres real, mismo estilo que
 * `e2e-admin-orders.spec.ts`: `bootTestApp([OrdersModule])`, sin mocks de
 * Prisma. Verifica el borde HTTP: `CustomerGuard` corta ANTES del handler
 * (401 sin cookie) y el shape de la respuesta con sesión válida.
 */
describe('OrdersHistoryController (e2e, US-015 T4.3)', () => {
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
      data: { name: 'Refrigeración', slug: 'refrigeracion-e2e-orders-history' },
    });
    productId = (
      await prisma.product.create({
        data: {
          sku: 'E2E-ORD-HIST-A',
          slug: 'producto-e2e-orders-history',
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
      { sub: customerId, role: 'customer', typ: 'access', jti: 'jti-test' },
      { secret: process.env.JWT_SECRET, issuer: JWT_ISSUER, audience: JWT_AUDIENCE },
    );
    return `${ACCESS_COOKIE}=${token}`;
  }

  async function crearClienteConOrdenConfirmada(sufijo: string) {
    const cliente = await prisma.customer.create({
      data: {
        email: `cliente-${sufijo}@test.local`,
        password_hash: 'hash-de-prueba',
        name: `Cliente ${sufijo}`,
      },
    });
    const orden = await prisma.order.create({
      data: {
        access_token_hash: `h-hist-ctrl-${sufijo}`,
        customer_id: cliente.id,
        buyer_name: 'Comprador de Prueba',
        buyer_email: `comprador-${sufijo}@test.local`,
        buyer_phone: '+54 351 555 0000',
        total_ars_cents: 100_000,
        status: 'new',
        consent_accepted: true,
        consent_accepted_at: new Date(),
        consent_terms_version: '2026-06-15',
        items: {
          create: [
            {
              product_id: productId,
              quantity: 1,
              unit_price_ars_cents: 100_000,
              product_name: 'Producto de prueba',
              product_sku: 'E2E-ORD-HIST-A',
            },
          ],
        },
      },
    });
    return { cliente, orden };
  }

  describe('GET /v1/me/orders', () => {
    it('sin cookie: 401 antes de ejecutar el handler (el guard corta)', async () => {
      const res = await request(app.getHttpServer()).get('/v1/me/orders');
      expect(res.status).toBe(401);
    });

    it('con cookie válida: 200 con el shape de OrderHistoryListResponse', async () => {
      const { cliente } = await crearClienteConOrdenConfirmada('list-ok');

      const res = await request(app.getHttpServer())
        .get('/v1/me/orders')
        .set('Cookie', accessCookie(cliente.id));

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        data: expect.any(Array),
        pagination: { limit: 20, offset: 0, total: 1 },
      });
      expect(res.body.data[0]).toMatchObject({
        order_number: expect.any(Number),
        status: 'new',
        total_ars_cents: 100_000,
      });
      expect(res.body.data[0]).not.toHaveProperty('id');
    });
  });

  describe('GET /v1/me/orders/:order_number', () => {
    it('sin cookie: 401 antes de ejecutar el handler', async () => {
      const res = await request(app.getHttpServer()).get('/v1/me/orders/1');
      expect(res.status).toBe(401);
    });

    it('con cookie válida: 200 con items/fulfillment/status', async () => {
      const { cliente, orden } = await crearClienteConOrdenConfirmada('detail-ok');

      const res = await request(app.getHttpServer())
        .get(`/v1/me/orders/${orden.order_number}`)
        .set('Cookie', accessCookie(cliente.id));

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'new',
        fulfillment: 'pickup',
        items: [
          {
            product_name: 'Producto de prueba',
            product_sku: 'E2E-ORD-HIST-A',
            quantity: 1,
            unit_price_ars_cents: 100_000,
            subtotal_ars_cents: 100_000,
          },
        ],
      });
    });

    it('orden ajena: 404 (RFC 7807), no 403 — indistinguible de "no existe"', async () => {
      const { orden } = await crearClienteConOrdenConfirmada('detail-ajena');
      const otro = await prisma.customer.create({
        data: {
          email: 'otro-cliente@test.local',
          password_hash: 'hash-de-prueba',
          name: 'Otro Cliente',
        },
      });

      const res = await request(app.getHttpServer())
        .get(`/v1/me/orders/${orden.order_number}`)
        .set('Cookie', accessCookie(otro.id));

      expect(res.status).toBe(404);
      expect(res.body.type).toBe('dsm:checkout/order-not-found');
    });
  });
});
