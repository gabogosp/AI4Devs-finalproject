import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { bootTestApp } from '../../test/e2e-app';
import { PrismaService } from '../prisma/prisma.service';
import { ACCESS_COOKIE } from '../auth/cookies';
import { JWT_AUDIENCE, JWT_ISSUER } from '../auth/session.service';
import { OrdersModule } from './orders.module';

/**
 * T5.7 — AC-1 (listado propio, `-created_at`, con fecha/estado/total), AC-3
 * (estado vacío — `{ data: [], pagination.total: 0 }`, sin caso especial) y
 * AC-7 (retención: sólo dentro de la ventana de 12 meses).
 */
describe('GET /v1/me/orders — listado del historial (e2e-orders-history-list, US-015 T5.7)', () => {
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
      data: { name: 'Refrigeración', slug: 'refrigeracion-e2e-orders-history-list' },
    });
    productId = (
      await prisma.product.create({
        data: {
          sku: 'E2E-ORD-HIST-LIST-A',
          slug: 'producto-e2e-orders-history-list',
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
      { sub: customerId, role: 'customer', typ: 'access', jti: 'jti-list-test' },
      { secret: process.env.JWT_SECRET, issuer: JWT_ISSUER, audience: JWT_AUDIENCE },
    );
    return `${ACCESS_COOKIE}=${token}`;
  }

  async function crearOrden(
    sufijo: string,
    customerId: string | null,
    status: string,
    createdAt?: Date,
  ) {
    const orden = await prisma.order.create({
      data: {
        access_token_hash: `h-hist-list-${sufijo}`,
        customer_id: customerId,
        buyer_name: 'Comprador de Prueba',
        buyer_email: `comprador-${sufijo}@test.local`,
        buyer_phone: '+54 351 555 0000',
        total_ars_cents: 100_000,
        status,
        consent_accepted: true,
        consent_accepted_at: new Date(),
        consent_terms_version: '2026-06-15',
        ...(createdAt ? { created_at: createdAt } : {}),
        items: {
          create: [
            {
              product_id: productId,
              quantity: 1,
              unit_price_ars_cents: 100_000,
              product_name: 'Producto de prueba',
              product_sku: 'E2E-ORD-HIST-LIST-A',
            },
          ],
        },
      },
    });
    return orden;
  }

  it('sin órdenes: {data:[], pagination.total:0} (AC-3, sin caso especial)', async () => {
    const cliente = await prisma.customer.create({
      data: { email: 'vacio@test.local', password_hash: 'hash', name: 'Cliente Vacío' },
    });

    const res = await request(app.getHttpServer())
      .get('/v1/me/orders')
      .set('Cookie', accessCookie(cliente.id));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: [],
      pagination: { limit: 20, offset: 0, total: 0 },
    });
  });

  it('2 propias dentro de retención + 1 fuera + 1 ajena + 1 pending_payment propia -> devuelve sólo las 2, orden -created_at (AC-1, AC-4, AC-7)', async () => {
    const propio = await prisma.customer.create({
      data: { email: 'propio-list@test.local', password_hash: 'hash', name: 'Propio' },
    });
    const ajeno = await prisma.customer.create({
      data: { email: 'ajeno-list@test.local', password_hash: 'hash', name: 'Ajeno' },
    });

    const hace1Mes = new Date();
    hace1Mes.setMonth(hace1Mes.getMonth() - 1);
    const hace2Meses = new Date();
    hace2Meses.setMonth(hace2Meses.getMonth() - 2);
    const hace13Meses = new Date();
    hace13Meses.setMonth(hace13Meses.getMonth() - 13);

    const masReciente = await crearOrden('reciente', propio.id, 'new', hace1Mes);
    const masVieja = await crearOrden('vieja', propio.id, 'new', hace2Meses);
    await crearOrden('fuera-de-ventana', propio.id, 'new', hace13Meses);
    await crearOrden('ajena', ajeno.id, 'new');
    await crearOrden('pending', propio.id, 'pending_payment');

    const res = await request(app.getHttpServer())
      .get('/v1/me/orders')
      .set('Cookie', accessCookie(propio.id));

    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBe(2);
    expect(res.body.data.map((o: { order_number: number }) => o.order_number)).toEqual([
      masReciente.order_number,
      masVieja.order_number,
    ]);
    expect(res.body.data[0]).toEqual({
      order_number: masReciente.order_number,
      status: 'new',
      total_ars_cents: 100_000,
      created_at: hace1Mes.toISOString(),
    });
  });

  it('sin cookie: 401 (AC-5)', async () => {
    const res = await request(app.getHttpServer()).get('/v1/me/orders');
    expect(res.status).toBe(401);
  });
});
