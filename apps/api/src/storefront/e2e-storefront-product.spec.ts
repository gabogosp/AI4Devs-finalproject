import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bootTestApp, truncateCatalog } from '../../test/e2e-app';
import { StorefrontModule } from './storefront.module';
import { PrismaService } from '../prisma/prisma.service';

/**
 * e2e-nest de la ficha pública (US-003 AC-1/AC-2/AC-7/AC-8). Superficie SIN auth:
 * ninguna request lleva Authorization.
 */
describe('Storefront ficha pública (e2e-storefront-product)', () => {
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
    await truncateCatalog(prisma);
    categoryId = (
      await prisma.category.create({
        data: { name: 'Refrigeración', slug: 'refrigeracion' },
      })
    ).id;
  });

  const seed = (sku: string, status: string) =>
    prisma.product.create({
      data: {
        sku,
        name: 'Heladera',
        description_raw: 'No-frost 300L',
        price_ars_cents: 100000,
        stock: 5,
        status,
        category_id: categoryId,
      },
    });

  const get = (sku: string) =>
    request(app.getHttpServer()).get(`/v1/products/${sku}`);

  it('producto publicado → 200 con el shape público (AC-1/AC-2)', async () => {
    await seed('PUB-001', 'published');
    const res = await get('PUB-001');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      sku: 'PUB-001',
      name: 'Heladera',
      price_ars_cents: 100000,
      currency: 'ARS',
      in_stock: true,
      category: { name: 'Refrigeración', slug: 'refrigeracion' },
    });
    // No filtra campos de administración.
    expect(res.body).not.toHaveProperty('id');
    expect(res.body).not.toHaveProperty('stock');
    expect(res.body).not.toHaveProperty('status');
  });

  it('responde 200 sin enviar Authorization (superficie pública)', async () => {
    await seed('PUB-002', 'published');
    // La request se construye sin `.set('Authorization', ...)`: que devuelva 200
    // (y no 401/403) prueba que la ruta no está gateada por AdminGuard.
    const res = await get('PUB-002');
    expect(res.status).toBe(200);
  });

  it('producto draft → 404 RFC 7807 (AC-7)', async () => {
    await seed('DRA-001', 'draft');
    const res = await get('DRA-001');
    expect(res.status).toBe(404);
    expect(res.body.type).toBe('dsm:catalog/not-found');
  });

  it('producto archived → 404 (AC-7)', async () => {
    await seed('ARC-001', 'archived');
    expect((await get('ARC-001')).status).toBe(404);
  });

  it('sku inexistente → 404 (AC-8)', async () => {
    const res = await get('NOPE-999');
    expect(res.status).toBe(404);
    expect(res.body.type).toBe('dsm:catalog/not-found');
  });
});
