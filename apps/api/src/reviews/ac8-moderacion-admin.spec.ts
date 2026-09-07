import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { adminToken, bootTestApp, nuevaIpDeTest } from '../../test/e2e-app';
import { AuthModule } from '../auth/auth.module';
import { ReviewsModule } from './reviews.module';
import { StorefrontModule } from '../storefront/storefront.module';
import { PrismaService } from '../prisma/prisma.service';

/**
 * T7 (US-025) — AC-8: el dueño oculta una reseña. Deja de contarse en el
 * promedio y de listarse públicamente; el autor sigue viéndola marcada como
 * oculta (transparencia, no censura invisible).
 */
describe('AC-8 — moderación del dueño (ac8-moderacion-admin)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let productoId = '';
  let ip = '';

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
      data: { name: 'Herramientas', slug: 'herramientas-moderacion' },
    });
    productoId = (
      await prisma.product.create({
        data: {
          sku: 'RESENA-MOD-A',
          slug: 'taladro-x-mod',
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

  async function registrarConReseñaVisible() {
    const reg = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .set('X-Forwarded-For', ip)
      .send({ email: 'mod-autor@test.local', name: 'Autor', password: 'correo caballo batería grapa' })
      .expect(201);
    const cookies = reg.headers['set-cookie'] as unknown as string[];
    const customerId = reg.body.customer.id as string;

    await prisma.order.create({
      data: {
        access_token_hash: 'h-mod',
        buyer_name: 'Autor',
        buyer_email: 'mod-autor@test.local',
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
            product_sku: 'RESENA-MOD-A',
          },
        },
      },
    });

    const resena = await prisma.review.create({
      data: { customer_id: customerId, product_id: productoId, rating: 5, comment: 'Ofensivo/falso' },
    });

    return { cookies, resena };
  }

  it('el dueño oculta: deja de contarse en el promedio y de listarse públicamente', async () => {
    const { resena } = await registrarConReseñaVisible();

    await request(app.getHttpServer())
      .patch(`/v1/admin/reviews/${resena.id}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ hidden: true })
      .expect(200)
      .expect((r) => expect(r.body.hidden).toBe(true));

    const publico = await request(app.getHttpServer())
      .get('/v1/products/taladro-x-mod/reviews')
      .expect(200);
    expect(publico.body.count).toBe(0);
    expect(publico.body.average).toBeNull();
    expect(publico.body.data).toEqual([]);
  });

  it('el autor sigue viendo su propia reseña marcada como oculta (transparencia, AC-8)', async () => {
    const { cookies, resena } = await registrarConReseñaVisible();

    await request(app.getHttpServer())
      .patch(`/v1/admin/reviews/${resena.id}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ hidden: true })
      .expect(200);

    const propia = await request(app.getHttpServer())
      // `GET /v1/me/reviews/:slug` toma el slug (fix post-mortem), no el id.
      .get('/v1/me/reviews/taladro-x-mod')
      .set('Cookie', cookies)
      .expect(200);

    expect(propia.body.review).not.toBeNull();
    expect(propia.body.review.hidden).toBe(true);
  });

  it('mostrar de nuevo (hidden:false): reaparece en la lista pública', async () => {
    const { resena } = await registrarConReseñaVisible();
    await request(app.getHttpServer())
      .patch(`/v1/admin/reviews/${resena.id}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ hidden: true })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/v1/admin/reviews/${resena.id}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ hidden: false })
      .expect(200)
      .expect((r) => expect(r.body.hidden).toBe(false));

    const publico = await request(app.getHttpServer())
      .get('/v1/products/taladro-x-mod/reviews')
      .expect(200);
    expect(publico.body.count).toBe(1);
  });

  it('id inexistente: 404', async () => {
    await request(app.getHttpServer())
      .patch('/v1/admin/reviews/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ hidden: true })
      .expect(404);
  });

  it('sin token admin: 401', async () => {
    const { resena } = await registrarConReseñaVisible();

    await request(app.getHttpServer())
      .patch(`/v1/admin/reviews/${resena.id}`)
      .send({ hidden: true })
      .expect(401);
  });
});
