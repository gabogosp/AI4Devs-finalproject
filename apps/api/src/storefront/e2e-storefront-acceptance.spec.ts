import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { adminToken, bootTestApp, truncateCatalog } from '../../test/e2e-app';
import { StorefrontModule } from './storefront.module';
import { ProductsModule } from '../products/products.module';
import { PrismaService } from '../prisma/prisma.service';

/**
 * e2e de aceptación de la ficha pública (US-003 AC-3/AC-4/AC-6/AC-9): stock,
 * imagen nula y precio vigente (lectura viva tras un PATCH admin).
 */
describe('Storefront aceptación (e2e-storefront-acceptance)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let categoryId: string;

  beforeAll(async () => {
    app = await bootTestApp([StorefrontModule, ProductsModule]);
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
        sku: 'AC-001',
        slug: 'heladera-aceptacion',
        name: 'Heladera',
        description_raw: 'No-frost',
        price_ars_cents: 100000,
        stock: 5,
        status: 'published',
        category_id: categoryId,
        ...over,
      },
    });

  const get = (slug = 'heladera-aceptacion') =>
    request(app.getHttpServer()).get(`/v1/products/${slug}`);

  it('AC-3: stock>0 → in_stock:true', async () => {
    await seed({ stock: 7 });
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.in_stock).toBe(true);
  });

  it('AC-4: publicado con stock=0 → 200 con in_stock:false (visible, no comprable)', async () => {
    await seed({ stock: 0 });
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.in_stock).toBe(false);
  });

  it('AC-6: sin imagen → image_url:null', async () => {
    await seed({ image_url: null });
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.image_url).toBeNull();
  });

  it('AC-9: tras un PATCH admin del precio, la relectura pública trae el precio nuevo', async () => {
    const p = await seed({ price_ars_cents: 100000 });
    expect((await get()).body.price_ars_cents).toBe(100000);

    const patch = await request(app.getHttpServer())
      .patch(`/v1/admin/products/${p.id}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ price_ars_cents: 250000 });
    expect(patch.status).toBe(200);

    // Lectura viva de la DB: nunca sirve un precio desactualizado indefinidamente.
    expect((await get()).body.price_ars_cents).toBe(250000);
  });
});
