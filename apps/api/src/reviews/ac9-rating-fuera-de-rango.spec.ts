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

/** T6 (US-025) — AC-9 (negative-space): rating fuera de 1-5 se rechaza. */
describe('AC-9 — calificación fuera de rango rechazada (ac9-rating-fuera-de-rango)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let productoId = '';
  let ip = '';

  const leerCsrf = (cookies: string[]): string =>
    cookies
      .find((c) => c.startsWith(`${CSRF_COOKIE}=`))!
      .split(';')[0]
      .split('=')[1];

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
      data: { name: 'Herramientas', slug: 'herramientas-rating' },
    });
    productoId = (
      await prisma.product.create({
        data: {
          sku: 'RESENA-RATING-A',
          slug: 'taladro-x-rating',
          name: 'Taladro X',
          price_ars_cents: 500_000,
          stock: 5,
          status: 'published',
          category_id: cat.id,
        },
      })
    ).id;
    ip = nuevaIpDeTest();

    const reg = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .set('X-Forwarded-For', ip)
      .send({ email: 'rating@test.local', name: 'Cliente Rating', password: 'correo caballo batería grapa' })
      .expect(201);
    const customerId = reg.body.customer.id as string;
    await prisma.order.create({
      data: {
        access_token_hash: 'h-rating',
        buyer_name: 'Cliente Rating',
        buyer_email: 'rating@test.local',
        buyer_phone: '+54 351 555 0000',
        consent_accepted: true,
        consent_accepted_at: new Date(),
        consent_terms_version: '2026-06-15',
        total_ars_cents: 500_000,
        customer_id: customerId,
        status: 'delivered',
        items: {
          create: {
            product_id: productoId,
            quantity: 1,
            unit_price_ars_cents: 500_000,
            product_name: 'Taladro X',
            product_sku: 'RESENA-RATING-A',
          },
        },
      },
    });
  });

  it('rating 0: 422, no se guarda ninguna reseña', async () => {
    const reg = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email: 'rating@test.local', password: 'correo caballo batería grapa' })
      .expect(200);
    const cookies = reg.headers['set-cookie'] as unknown as string[];
    const csrf = leerCsrf(cookies);

    await request(app.getHttpServer())
      .put(`/v1/me/reviews/${productoId}`)
      .set('Cookie', cookies)
      .set('X-CSRF-Token', csrf)
      .set('Origin', ORIGEN)
      .send({ rating: 0, comment: null })
      .expect(422);

    expect(await prisma.review.count()).toBe(0);
  });

  it('rating 6: 422, no se guarda ninguna reseña', async () => {
    const reg = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email: 'rating@test.local', password: 'correo caballo batería grapa' })
      .expect(200);
    const cookies = reg.headers['set-cookie'] as unknown as string[];
    const csrf = leerCsrf(cookies);

    await request(app.getHttpServer())
      .put(`/v1/me/reviews/${productoId}`)
      .set('Cookie', cookies)
      .set('X-CSRF-Token', csrf)
      .set('Origin', ORIGEN)
      .send({ rating: 6, comment: null })
      .expect(422);

    expect(await prisma.review.count()).toBe(0);
  });
});
