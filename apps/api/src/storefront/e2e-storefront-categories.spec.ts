import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bootTestApp, truncateCatalog } from '../../test/e2e-app';
import { StorefrontModule } from './storefront.module';
import { PrismaService } from '../prisma/prisma.service';

/**
 * e2e-nest de la navegación pública por categorías (US-002 AC-1/AC-2/AC-3/AC-6/AC-9).
 * Superficie SIN auth: ninguna request lleva Authorization.
 */
describe('Storefront navegación por categorías (e2e-storefront-categories)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await bootTestApp([StorefrontModule]);
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await truncateCatalog(prisma);
    const refrigeracion = await prisma.category.create({
      data: { name: 'Refrigeración', slug: 'refrigeracion' },
    });
    const compresores = await prisma.category.create({
      data: {
        name: 'Compresores',
        slug: 'compresores',
        parent_id: refrigeracion.id,
      },
    });
    await prisma.category.create({
      data: { name: 'Ferretería', slug: 'ferreteria' },
    });
    await prisma.product.create({
      data: {
        sku: 'CAT-001',
        slug: 'compresor-1-4',
        name: 'Compresor 1/4',
        price_ars_cents: 850000,
        stock: 4,
        status: 'published',
        category_id: compresores.id,
      },
    });
  });

  const get = (path: string) => request(app.getHttpServer()).get(path);

  it('árbol: 200 con rubros y sus subrubros, sin auth (AC-1)', async () => {
    const res = await get('/v1/categories');

    expect(res.status).toBe(200);
    expect(res.body.data.map((c: { slug: string }) => c.slug)).toEqual([
      'ferreteria',
      'refrigeracion',
    ]);
    const refrigeracion = res.body.data[1];
    expect(refrigeracion.children).toEqual([
      { slug: 'compresores', name: 'Compresores' },
    ]);
    // El árbol no expone parent: la jerarquía la da el anidamiento.
    expect(refrigeracion).not.toHaveProperty('parent');
  });

  it('detalle de subrubro: 200 con parent para el breadcrumb (AC-2)', async () => {
    const res = await get('/v1/categories/compresores');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      slug: 'compresores',
      name: 'Compresores',
      parent: { slug: 'refrigeracion', name: 'Refrigeración' },
      children: [],
    });
  });

  it('listado: 200 con envelope data + pagination (AC-3)', async () => {
    const res = await get('/v1/categories/compresores/products');

    expect(res.status).toBe(200);
    expect(res.body.pagination).toEqual({ limit: 20, offset: 0, total: 1 });
    expect(res.body.data).toEqual([
      {
        slug: 'compresor-1-4',
        name: 'Compresor 1/4',
        price_ars_cents: 850000,
        currency: 'ARS',
        image_url: null,
        in_stock: true,
      },
    ]);
  });

  it('D1: el rubro agrega los productos de sus subrubros', async () => {
    // El producto cuelga del subrubro; sin agregación el rubro daría total 0.
    const res = await get('/v1/categories/refrigeracion/products');

    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBe(1);
    expect(res.body.data[0].slug).toBe('compresor-1-4');
  });

  it('categoría inexistente → 404 RFC 7807 en el detalle (AC-9)', async () => {
    const res = await get('/v1/categories/no-existe');

    expect(res.status).toBe(404);
    expect(res.body.type).toBe('dsm:catalog/not-found');
  });

  it('categoría inexistente → 404 también en el listado, no 200 vacío (AC-9)', async () => {
    // Un 200 con data:[] sería una página fantasma indexable.
    const res = await get('/v1/categories/no-existe/products');

    expect(res.status).toBe(404);
    expect(res.body.type).toBe('dsm:catalog/not-found');
  });

  it('query inválido → 422 (limit fuera de rango)', async () => {
    const res = await get('/v1/categories/compresores/products?limit=150');

    expect(res.status).toBe(422);
  });

  it('las tres rutas responden sin Authorization (superficie pública)', async () => {
    // Que devuelvan 2xx y no 401/403 prueba que no quedaron bajo AdminGuard.
    for (const path of [
      '/v1/categories',
      '/v1/categories/refrigeracion',
      '/v1/categories/refrigeracion/products',
    ]) {
      expect((await get(path)).status).toBe(200);
    }
  });

  it('el surface admin sigue gateado (no se abrió de más)', async () => {
    const res = await get('/v1/admin/products');
    expect([401, 403, 404]).toContain(res.status);
  });
});
