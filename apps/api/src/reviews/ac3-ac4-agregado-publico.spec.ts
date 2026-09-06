import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bootTestApp } from '../../test/e2e-app';
import { AuthModule } from '../auth/auth.module';
import { ReviewsModule } from './reviews.module';
import { StorefrontModule } from '../storefront/storefront.module';
import { PrismaService } from '../prisma/prisma.service';

/**
 * T6 (US-025) — AC-3 (ver promedio/conteo) y AC-4 (sin reseñas). Superficie
 * pública, sin sesión.
 */
describe('AC-3/AC-4 — agregado público de reseñas (ac3-ac4-agregado-publico)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let productoId = '';
  let clienteA = '';
  let clienteB = '';
  let clienteC = '';

  beforeAll(async () => {
    app = await bootTestApp([AuthModule, ReviewsModule, StorefrontModule]);
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE reviews, order_items, orders, customers, products, categories RESTART IDENTITY CASCADE',
    );
    const cat = await prisma.category.create({
      data: { name: 'Herramientas', slug: 'herramientas-agregado' },
    });
    productoId = (
      await prisma.product.create({
        data: {
          sku: 'RESENA-AGG-A',
          slug: 'taladro-x-agg',
          name: 'Taladro X',
          price_ars_cents: 500_000,
          stock: 5,
          status: 'published',
          category_id: cat.id,
        },
      })
    ).id;
    clienteA = (
      await prisma.customer.create({
        data: { email: 'agg-a@test.local', password_hash: 'hash', name: 'Ana' },
      })
    ).id;
    clienteB = (
      await prisma.customer.create({
        data: { email: 'agg-b@test.local', password_hash: 'hash', name: 'Beto' },
      })
    ).id;
    clienteC = (
      await prisma.customer.create({
        data: { email: 'agg-c@test.local', password_hash: 'hash', name: 'Carla' },
      })
    ).id;
  });

  it('AC-4: producto sin reseñas — average null y count 0, no un promedio inventado', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/products/taladro-x-agg/reviews`)
      .expect(200);

    expect(res.body.average).toBeNull();
    expect(res.body.count).toBe(0);
    expect(res.body.data).toEqual([]);
  });

  it('AC-3: 3 reseñas de 5, 4 y 3 estrellas — promedio "4.0" y "3 reseñas"', async () => {
    await prisma.review.create({ data: { customer_id: clienteA, product_id: productoId, rating: 5 } });
    await prisma.review.create({ data: { customer_id: clienteB, product_id: productoId, rating: 4 } });
    await prisma.review.create({ data: { customer_id: clienteC, product_id: productoId, rating: 3 } });

    const res = await request(app.getHttpServer())
      .get(`/v1/products/taladro-x-agg/reviews`)
      .expect(200);

    expect(res.body.average).toBe(4);
    expect(res.body.count).toBe(3);
    expect(res.body.data).toHaveLength(3);
  });

  it('slug inexistente: 404 (mismo criterio que la ficha)', async () => {
    await request(app.getHttpServer()).get('/v1/products/no-existe/reviews').expect(404);
  });
});
