import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bootTestApp, truncateCatalog } from '../../test/e2e-app';
import { StorefrontModule } from './storefront.module';
import { PrismaService } from '../prisma/prisma.service';

/**
 * e2e-nest de "Novedades" del home (US-026 AC-1, AC-3, AC-4). Superficie SIN
 * auth, misma familia que `e2e-storefront-product.spec.ts`.
 */
describe('Storefront novedades (e2e-storefront-novedades)', () => {
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

  const seed = async (
    sku: string,
    slug: string,
    status: string,
    createdAt: Date,
  ) => {
    const p = await prisma.product.create({
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
    await prisma.product.update({ where: { id: p.id }, data: { created_at: createdAt } });
    return p;
  };

  const get = () => request(app.getHttpServer()).get('/v1/products/novedades');

  it('devuelve hasta 8 publicados, del más nuevo al más viejo, con link por slug (AC-1)', async () => {
    await seed('NOV-1', 'producto-viejo', 'published', new Date('2026-01-01'));
    await seed('NOV-2', 'producto-nuevo', 'published', new Date('2026-06-01'));
    await seed('NOV-3', 'producto-medio', 'published', new Date('2026-03-01'));

    const res = await get();

    expect(res.status).toBe(200);
    expect(res.body.data.map((p: { slug: string }) => p.slug)).toEqual([
      'producto-nuevo',
      'producto-medio',
      'producto-viejo',
    ]);
    expect(res.body.data[0]).toMatchObject({
      slug: 'producto-nuevo',
      name: 'Heladera',
      price_ars_cents: 100000,
      currency: 'ARS',
    });
  });

  it('excluye draft/archived (sólo published cuenta como "publicado")', async () => {
    await seed('NOV-4', 'novedad-publicada', 'published', new Date('2026-06-01'));
    await seed('NOV-5', 'novedad-borrador', 'draft', new Date('2026-07-01'));
    await seed('NOV-6', 'novedad-archivada', 'archived', new Date('2026-08-01'));

    const res = await get();

    expect(res.body.data.map((p: { slug: string }) => p.slug)).toEqual([
      'novedad-publicada',
    ]);
  });

  it('menos de 8 publicados: devuelve los que hay, sin placeholders (AC-3)', async () => {
    await seed('NOV-7', 'unico-publicado', 'published', new Date('2026-06-01'));

    const res = await get();

    expect(res.body.data).toHaveLength(1);
  });

  it('sin ningún producto publicado: data vacío, 200 (AC-4)', async () => {
    await seed('NOV-8', 'solo-borrador', 'draft', new Date('2026-06-01'));

    const res = await get();

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('respeta el tope de 8 aunque haya más publicados', async () => {
    for (let i = 0; i < 10; i += 1) {
      await seed(`NOV-BULK-${i}`, `novedad-bulk-${i}`, 'published', new Date(2026, 0, i + 1));
    }

    const res = await get();

    expect(res.body.data).toHaveLength(8);
  });

  it('responde 200 sin Authorization (superficie pública)', async () => {
    await seed('NOV-9', 'novedad-sin-auth', 'published', new Date('2026-06-01'));

    expect((await get()).status).toBe(200);
  });

  /**
   * design.md D3: `novedades` y `mas-vendidos` se registran ANTES de `:slug`
   * porque, con igual especificidad de ruta, Express/Nest resuelven por orden
   * de registro. Este test descarta el falso positivo inverso: un producto
   * real cuyo SLUG contiene "novedades" como substring no debe interferir con
   * la ruta estática — y la ruta estática (con ese producto en la BD) debe
   * seguir devolviendo la sección, no intentar resolver "novedades" como slug.
   */
  it('D3: un producto slugueado "novedades-de-la-semana" no rompe la ruta estática', async () => {
    await seed('NOV-10', 'novedades-de-la-semana', 'published', new Date('2026-06-01'));

    const seccion = await get();
    expect(seccion.status).toBe(200);
    expect(Array.isArray(seccion.body.data)).toBe(true);

    const ficha = await request(app.getHttpServer()).get(
      '/v1/products/novedades-de-la-semana',
    );
    expect(ficha.status).toBe(200);
    expect(ficha.body.slug).toBe('novedades-de-la-semana');
  });
});
