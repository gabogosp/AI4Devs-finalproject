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

  const seed = (sku: string, slug: string, status: string) =>
    prisma.product.create({
      data: {
        sku,
        slug,
        name: 'Heladera',
        description_raw: 'No-frost 300L',
        price_ars_cents: 100000,
        stock: 5,
        status,
        category_id: categoryId,
      },
    });

  const get = (slug: string) =>
    request(app.getHttpServer()).get(`/v1/products/${slug}`);

  it('producto publicado → 200 con el shape público por slug (AC-1/AC-2)', async () => {
    await seed('PUB-001', 'heladera-publicada', 'published');
    const res = await get('heladera-publicada');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      slug: 'heladera-publicada',
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

  it('el identificador público es el slug, no el sku (T10.3)', async () => {
    // El mismo producto publicado NO se resuelve por su sku: si esta request
    // devolviera 200, la ruta seguiría atada al identificador viejo.
    await seed('PUB-003', 'heladera-por-slug', 'published');
    expect((await get('PUB-003')).status).toBe(404);
    expect((await get('heladera-por-slug')).status).toBe(200);
  });

  it('responde 200 sin enviar Authorization (superficie pública)', async () => {
    await seed('PUB-002', 'heladera-sin-auth', 'published');
    // La request se construye sin `.set('Authorization', ...)`: que devuelva 200
    // (y no 401/403) prueba que la ruta no está gateada por AdminGuard.
    const res = await get('heladera-sin-auth');
    expect(res.status).toBe(200);
  });

  it('producto draft → 404 RFC 7807 (AC-7)', async () => {
    await seed('DRA-001', 'heladera-borrador', 'draft');
    const res = await get('heladera-borrador');
    expect(res.status).toBe(404);
    expect(res.body.type).toBe('dsm:catalog/not-found');
  });

  it('producto archived → 404 (AC-7)', async () => {
    await seed('ARC-001', 'heladera-archivada', 'archived');
    expect((await get('heladera-archivada')).status).toBe(404);
  });

  it('slug inexistente → 404 idéntico al de un producto oculto (AC-8)', async () => {
    await seed('DRA-002', 'heladera-oculta', 'draft');
    const oculto = await get('heladera-oculta');
    const inexistente = await get('no-existe-999');
    expect(inexistente.status).toBe(404);
    expect(inexistente.body.type).toBe('dsm:catalog/not-found');
    // Sin enumeration leak: los dos 404 son indistinguibles.
    expect(inexistente.body.detail).toBe(oculto.body.detail);
  });
});
