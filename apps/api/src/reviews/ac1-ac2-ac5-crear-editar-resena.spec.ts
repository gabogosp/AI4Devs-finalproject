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
 * T6 (US-025) — AC-1 (dejar reseña), AC-2 (sin comentario), AC-5 (editar la
 * propia). Mismo estilo que `account/ac1-ac2-ac3-edit-profile.spec.ts`:
 * supertest contra Postgres real, seed de una orden `delivered` vía Prisma
 * directo en `beforeEach`.
 */
describe('AC-1/AC-2/AC-5 — crear y editar la propia reseña (ac1-ac2-ac5-crear-editar-resena)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let productoId = '';
  let ip = '';

  const leerCsrf = (cookies: string[]): string =>
    cookies
      .find((c) => c.startsWith(`${CSRF_COOKIE}=`))!
      .split(';')[0]
      .split('=')[1];

  async function registrarYComprar(sufijo: string) {
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
    const customerId = res.body.customer.id as string;

    const orden = await prisma.order.create({
      data: {
        access_token_hash: `h-resena-${sufijo}`,
        buyer_name: `Cliente ${sufijo}`,
        buyer_email: `${sufijo}@test.local`,
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
            product_sku: 'RESENA-AC-A',
          },
        },
      },
    });

    return { cookies, csrf: leerCsrf(cookies), orden };
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
      data: { name: 'Herramientas', slug: 'herramientas-resenas-ac' },
    });
    productoId = (
      await prisma.product.create({
        data: {
          sku: 'RESENA-AC-A',
          slug: 'taladro-x-ac',
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

  it('AC-1: elige 4 estrellas y escribe un comentario — se guarda asociada al cliente y al producto', async () => {
    const { cookies, csrf } = await registrarYComprar('ac1');

    const res = await request(app.getHttpServer())
      .put(`/v1/me/reviews/${productoId}`)
      .set('Cookie', cookies)
      .set('X-CSRF-Token', csrf)
      .set('Origin', ORIGEN)
      .send({ rating: 4, comment: 'Anduvo bien, tardó lo esperado' })
      .expect(200);

    expect(res.body.rating).toBe(4);
    expect(res.body.comment).toBe('Anduvo bien, tardó lo esperado');
    expect(res.body.hidden).toBe(false);
  });

  it('AC-2: elige 5 estrellas sin comentario — se guarda igual, sólo con la calificación', async () => {
    const { cookies, csrf } = await registrarYComprar('ac2');

    const res = await request(app.getHttpServer())
      .put(`/v1/me/reviews/${productoId}`)
      .set('Cookie', cookies)
      .set('X-CSRF-Token', csrf)
      .set('Origin', ORIGEN)
      .send({ rating: 5 })
      .expect(200);

    expect(res.body.rating).toBe(5);
    expect(res.body.comment).toBeNull();
  });

  it('AC-5: vuelve a la ficha y cambia su calificación de 3 a 5 — actualiza la MISMA reseña', async () => {
    const { cookies, csrf } = await registrarYComprar('ac5');

    const primera = await request(app.getHttpServer())
      .put(`/v1/me/reviews/${productoId}`)
      .set('Cookie', cookies)
      .set('X-CSRF-Token', csrf)
      .set('Origin', ORIGEN)
      .send({ rating: 3, comment: 'Aceptable' })
      .expect(200);

    const segunda = await request(app.getHttpServer())
      .put(`/v1/me/reviews/${productoId}`)
      .set('Cookie', cookies)
      .set('X-CSRF-Token', csrf)
      .set('Origin', ORIGEN)
      .send({ rating: 5, comment: 'Mejor de lo que pensé' })
      .expect(200);

    expect(segunda.body.id).toBe(primera.body.id);
    expect(segunda.body.rating).toBe(5);
    expect(await prisma.review.count()).toBe(1);
  });
});
