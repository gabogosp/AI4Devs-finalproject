import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bootTestApp, truncateCatalog } from '../../test/e2e-app';
import { StorefrontModule } from './storefront.module';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogEventsService } from '../observability/catalog-events.service';

/**
 * e2e del evento de negocio `product.viewed` (US-003 §9, E2E §18). Un fetch OK de
 * la ficha emite el evento (entity_id + admin_user_id null, sin PII) e incrementa
 * el contador `pdp_viewed_total`; un 404 no emite.
 */
describe('Storefront evento product.viewed (e2e-storefront-events)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let events: CatalogEventsService;
  let productId: string;

  beforeAll(async () => {
    app = await bootTestApp([StorefrontModule]);
    prisma = app.get(PrismaService);
    events = app.get(CatalogEventsService);
    await truncateCatalog(prisma);
    const cat = await prisma.category.create({
      data: { name: 'Refrigeración', slug: 'refrigeracion' },
    });
    productId = (
      await prisma.product.create({
        data: {
          sku: 'EVT-001',
          name: 'Heladera',
          price_ars_cents: 100000,
          stock: 5,
          status: 'published',
          category_id: cat.id,
        },
      })
    ).id;
  });
  afterAll(async () => {
    await app?.close();
  });

  it('fetch de publicado → emite product.viewed con entity_id y admin_user_id null', async () => {
    const spy = jest.spyOn(events, 'emit');
    const before = events.count('product.viewed');

    const res = await request(app.getHttpServer()).get('/v1/products/EVT-001');
    expect(res.status).toBe(200);

    // entity_id = id interno del producto; admin_user_id = null (sin PII).
    expect(spy).toHaveBeenCalledWith('product.viewed', productId, null, undefined);
    // El contador incrementa (la métrica no lleva sku/product_id como dimensión).
    expect(events.count('product.viewed')).toBe(before + 1);
    spy.mockRestore();
  });

  it('un 404 no emite product.viewed', async () => {
    const before = events.count('product.viewed');
    const res = await request(app.getHttpServer()).get('/v1/products/NOPE-999');
    expect(res.status).toBe(404);
    expect(events.count('product.viewed')).toBe(before);
  });
});
