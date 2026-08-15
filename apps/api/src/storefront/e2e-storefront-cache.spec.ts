import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bootTestApp, truncateCatalog } from '../../test/e2e-app';
import { StorefrontModule } from './storefront.module';
import { PrismaService } from '../prisma/prisma.service';

/**
 * e2e de la caché acotada de la superficie pública (US-003 AC-9). La ficha lleva
 * `Cache-Control: public, max-age=60, stale-while-revalidate=30` (permite CDN pero
 * acota la frescura del precio); el surface admin conserva `no-store`.
 */
describe('Storefront caché acotada (e2e-storefront-cache, AC-9)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await bootTestApp([StorefrontModule]);
    prisma = app.get(PrismaService);
    await truncateCatalog(prisma);
    const cat = await prisma.category.create({
      data: { name: 'Refrigeración', slug: 'refrigeracion' },
    });
    await prisma.product.create({
      data: {
        sku: 'CACHE-001',
        name: 'Heladera',
        price_ars_cents: 100000,
        stock: 5,
        status: 'published',
        category_id: cat.id,
      },
    });
  });
  afterAll(async () => {
    await app?.close();
  });

  it('la ficha pública lleva Cache-Control acotado (max-age=60, sin no-store)', async () => {
    const res = await request(app.getHttpServer()).get('/v1/products/CACHE-001');
    expect(res.status).toBe(200);
    const cc = res.headers['cache-control'];
    expect(cc).toContain('public');
    expect(cc).toContain('max-age=60');
    expect(cc).toContain('stale-while-revalidate=30');
    expect(cc).not.toContain('no-store');
  });

  it('el surface admin conserva no-store', async () => {
    const res = await request(app.getHttpServer()).get('/v1/admin/categories');
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
