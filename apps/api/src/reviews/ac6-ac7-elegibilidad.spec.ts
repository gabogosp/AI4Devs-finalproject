import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bootTestApp, nuevaIpDeTest } from '../../test/e2e-app';
import { AuthModule } from '../auth/auth.module';
import { ReviewsModule } from './reviews.module';
import { StorefrontModule } from '../storefront/storefront.module';
import { PrismaService } from '../prisma/prisma.service';
import { CSRF_COOKIE } from '../auth/cookies';
import { parseCorsOrigins } from '../config/env.validation';

const ORIGEN = parseCorsOrigins(process.env.CORS_ALLOWED_ORIGINS ?? '')[0];

/**
 * T6 (US-025) — AC-6 (no comprado → 403, negative-space) y AC-7 (invitado
 * → 401, negative-space). AC-6 se verifica vía POST directo a la API,
 * "sin importar lo que envíe el cliente" — el AC lo pide textualmente.
 */
describe('AC-6/AC-7 — elegibilidad verificada server-side (ac6-ac7-elegibilidad)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let productoId = '';
  /** `GET/PUT /v1/me/reviews/:slug` toma el slug (fix post-mortem), no el id. */
  const productoSlug = 'taladro-x-eleg';
  let ip = '';

  const leerCsrf = (cookies: string[]): string =>
    cookies
      .find((c) => c.startsWith(`${CSRF_COOKIE}=`))!
      .split(';')[0]
      .split('=')[1];

  async function registrar(sufijo: string) {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .set('X-Forwarded-For', ip)
      .send({
        email: `${sufijo}@test.local`,
        name: `Cliente ${sufijo}`,
        password: 'correo caballo batería grapa',
      })
      .expect(201);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    return { cookies, csrf: leerCsrf(cookies) };
  }

  beforeAll(async () => {
    process.env.TRUST_PROXY_HOPS = '1';
    app = await bootTestApp([AuthModule, ReviewsModule, StorefrontModule]);
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app?.close();
    delete process.env.TRUST_PROXY_HOPS;
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE reviews, order_items, orders, customers, products, categories RESTART IDENTITY CASCADE',
    );
    const cat = await prisma.category.create({
      data: { name: 'Herramientas', slug: 'herramientas-elegibilidad' },
    });
    productoId = (
      await prisma.product.create({
        data: {
          sku: 'RESENA-ELEG-A',
          slug: 'taladro-x-eleg',
          name: 'Taladro X',
          price_ars_cents: 500_000,
          stock: 5,
          status: 'published',
          category_id: cat.id,
        },
      })
    ).id;
    ip = nuevaIpDeTest();
  });

  it('AC-6: GET /v1/me/reviews/:slug dice eligible:false para quien nunca compró el producto', async () => {
    const { cookies } = await registrar('nunca-compro');

    const res = await request(app.getHttpServer())
      .get(`/v1/me/reviews/${productoSlug}`)
      .set('Cookie', cookies)
      .expect(200);

    expect(res.body.eligible).toBe(false);
    expect(res.body.review).toBeNull();
  });

  it('AC-6: PUT directo (sin importar lo que envíe) se rechaza con 403, sin crear la fila', async () => {
    const { cookies, csrf } = await registrar('intenta-igual');

    await request(app.getHttpServer())
      .put(`/v1/me/reviews/${productoSlug}`)
      .set('Cookie', cookies)
      .set('X-CSRF-Token', csrf)
      .set('Origin', ORIGEN)
      .send({ rating: 5, comment: 'Nunca lo compré pero igual reseño' })
      .expect(403);

    expect(await prisma.review.count()).toBe(0);
  });

  it('AC-6: orden del mismo producto pero NO delivered (aún preparing): sigue sin ser elegible', async () => {
    const { cookies, csrf } = await registrar('orden-sin-entregar');
    const customerId = (
      await prisma.customer.findFirstOrThrow({ where: { email: 'orden-sin-entregar@test.local' } })
    ).id;
    await prisma.order.create({
      data: {
        access_token_hash: 'h-sin-entregar',
        buyer_name: 'Cliente',
        buyer_email: 'orden-sin-entregar@test.local',
        buyer_phone: '+54 351 555 0000',
        consent_accepted: true,
        consent_accepted_at: new Date(),
        consent_terms_version: '2026-06-15',
        total_ars_cents: 500_000,
        customer_id: customerId,
        status: 'preparing',
        items: {
          create: {
            product_id: productoId,
            quantity: 1,
            unit_price_ars_cents: 500_000,
            product_name: 'Taladro X',
            product_sku: 'RESENA-ELEG-A',
          },
        },
      },
    });

    await request(app.getHttpServer())
      .put(`/v1/me/reviews/${productoSlug}`)
      .set('Cookie', cookies)
      .set('X-CSRF-Token', csrf)
      .set('Origin', ORIGEN)
      .send({ rating: 4 })
      .expect(403);
  });

  it('AC-7: sin sesión (invitado) — 401 en GET y en PUT', async () => {
    await request(app.getHttpServer())
      .get(`/v1/me/reviews/${productoSlug}`)
      .set('X-Forwarded-For', ip)
      .expect(401);

    await request(app.getHttpServer())
      .put(`/v1/me/reviews/${productoSlug}`)
      .set('X-Forwarded-For', ip)
      .set('Origin', ORIGEN)
      .send({ rating: 5 })
      .expect(401);
  });
});
