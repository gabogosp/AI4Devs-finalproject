import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bootTestApp, truncateCatalog } from '../../test/e2e-app';
import { StorefrontModule } from './storefront.module';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Aceptación e2e del listado por categoría (US-002 AC-3/AC-5/AC-6/AC-8):
 * disponibilidad, estado vacío, imagen ausente y el negative-space de
 * borradores/archivados.
 */
describe('Storefront listado — aceptación (e2e-storefront-categories-acceptance)', () => {
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

  const seed = (over: Record<string, unknown>) =>
    prisma.product.create({
      data: {
        sku: `AC-${Math.random().toString(36).slice(2, 10)}`,
        slug: `producto-${Math.random().toString(36).slice(2, 10)}`,
        name: 'Heladera',
        price_ars_cents: 100000,
        stock: 5,
        status: 'published',
        category_id: categoryId,
        ...over,
      },
    });

  const listar = (query = '') =>
    request(app.getHttpServer()).get(
      `/v1/categories/refrigeracion/products${query}`,
    );

  it('AC-5: un publicado sin stock aparece con in_stock:false', async () => {
    await seed({ stock: 0, slug: 'sin-stock' });

    const res = await listar();

    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBe(1);
    expect(res.body.data[0]).toMatchObject({
      slug: 'sin-stock',
      in_stock: false,
    });
  });

  it('AC-6: categoría con sólo borradores → 200 con data vacía y total 0', async () => {
    await seed({ status: 'draft', slug: 'borrador-1' });
    await seed({ status: 'draft', slug: 'borrador-2' });

    const res = await listar();

    // Existe la categoría → 200, no 404. Y los drafts no inflan el total.
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
  });

  it('AC-8: borradores y archivados no aparecen en NINGUNA página', async () => {
    const ocultos = ['oculto-draft', 'oculto-archivado'];
    await seed({ status: 'draft', slug: ocultos[0] });
    await seed({ status: 'archived', slug: ocultos[1] });
    for (let i = 0; i < 5; i += 1) {
      await seed({ slug: `visible-${i}`, name: `Visible ${i}` });
    }

    // Se recorre el listado entero: que no aparezcan en la primera página no
    // alcanza como prueba.
    const vistos: string[] = [];
    let offset = 0;
    let total = Infinity;
    while (offset < total) {
      const res = await listar(`?limit=2&offset=${offset}`);
      expect(res.status).toBe(200);
      total = res.body.pagination.total;
      vistos.push(...res.body.data.map((p: { slug: string }) => p.slug));
      offset += 2;
    }

    expect(total).toBe(5);
    expect(vistos).toHaveLength(5);
    for (const oculto of ocultos) {
      expect(vistos).not.toContain(oculto);
    }
  });

  it('AC-3: un producto sin imagen expone image_url null', async () => {
    await seed({ image_url: null, slug: 'sin-imagen' });

    const res = await listar();

    expect(res.body.data[0].image_url).toBeNull();
  });

  it('AC-3: el item trae precio en ARS y enlaza por slug', async () => {
    await seed({ slug: 'heladera-no-frost', price_ars_cents: 250000 });

    const res = await listar();

    expect(res.body.data[0]).toMatchObject({
      slug: 'heladera-no-frost',
      price_ars_cents: 250000,
      currency: 'ARS',
    });
  });
});
