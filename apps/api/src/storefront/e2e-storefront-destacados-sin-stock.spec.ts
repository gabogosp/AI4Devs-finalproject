import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bootTestApp, truncateCatalog } from '../../test/e2e-app';
import { StorefrontModule } from './storefront.module';
import { PrismaService } from '../prisma/prisma.service';

/**
 * e2e-nest de AC-8: un producto sin stock que califica para cualquiera de las
 * dos secciones del home se muestra igual (marcado sin stock), nunca oculto —
 * mismo criterio "nunca ocultar, sólo marcar" de US-002/US-003.
 */
describe('Storefront destacados sin stock (e2e-storefront-destacados-sin-stock, AC-8)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let categoryId: string;

  beforeAll(async () => {
    app = await bootTestApp([StorefrontModule]);
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE orders RESTART IDENTITY CASCADE');
    await truncateCatalog(prisma);
    categoryId = (
      await prisma.category.create({
        data: { name: 'Refrigeración', slug: 'refrigeracion' },
      })
    ).id;
  });

  it('"Novedades" incluye un publicado sin stock, marcado in_stock=false', async () => {
    await prisma.product.create({
      data: {
        sku: 'SS-NOV-1',
        slug: 'novedad-sin-stock',
        name: 'Heladera sin stock',
        description_raw: 'desc',
        price_ars_cents: 100000,
        stock: 0,
        status: 'published',
        category_id: categoryId,
      },
    });

    const res = await request(app.getHttpServer()).get('/v1/products/novedades');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      expect.objectContaining({ slug: 'novedad-sin-stock', in_stock: false }),
    ]);
  });

  it('"Más vendidos" incluye un vendido sin stock, marcado in_stock=false', async () => {
    const p = await prisma.product.create({
      data: {
        sku: 'SS-MV-1',
        slug: 'mas-vendido-sin-stock',
        name: 'Gas sin stock',
        description_raw: 'desc',
        price_ars_cents: 50000,
        stock: 0,
        status: 'published',
        category_id: categoryId,
      },
    });
    const orden = await prisma.order.create({
      data: {
        access_token_hash: 'hash-ss-mv-1',
        buyer_name: 'Comprador de Prueba',
        buyer_email: 'comprador-ss-mv-1@test.local',
        buyer_phone: '+54 351 555 0000',
        total_ars_cents: 50000,
        consent_accepted: true,
        consent_accepted_at: new Date(),
        consent_terms_version: '2026-06-15',
        status: 'delivered',
      },
    });
    await prisma.orderItem.create({
      data: {
        order_id: orden.id,
        product_id: p.id,
        quantity: 1,
        unit_price_ars_cents: 50000,
        product_name: 'Producto',
        product_sku: 'SS-MV-1-0',
      },
    });

    const res = await request(app.getHttpServer()).get('/v1/products/mas-vendidos');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      expect.objectContaining({ slug: 'mas-vendido-sin-stock', in_stock: false }),
    ]);
  });
});
