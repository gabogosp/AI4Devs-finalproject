import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { adminToken, bootTestApp, truncateCatalog } from '../../test/e2e-app';
import { ProductsModule } from './products.module';
import { PrismaService } from '../prisma/prisma.service';

describe('Products edición (e2e-products-update, AC-3)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let categoryId: string;
  let otherCategoryId: string;
  let productId: string;

  beforeAll(async () => {
    app = await bootTestApp([ProductsModule]);
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
    otherCategoryId = (
      await prisma.category.create({
        data: { name: 'Ferretería', slug: 'ferreteria' },
      })
    ).id;
    productId = (
      await prisma.product.create({
        data: {
          sku: 'REF-001',
          name: 'Heladera',
          price_ars_cents: 100000,
          stock: 3,
          category_id: categoryId,
        },
      })
    ).id;
  });

  const patch = (id: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .patch(`/v1/admin/products/${id}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(body);

  it('edita precio/stock/categoría (AC-3) y persiste', async () => {
    const res = await patch(productId, {
      price_ars_cents: 250000,
      stock: 10,
      category_id: otherCategoryId,
    });
    expect(res.status).toBe(200);
    expect(res.body.price_ars_cents).toBe(250000);
    expect(res.body.stock).toBe(10);
    expect(res.body.category_id).toBe(otherCategoryId);

    const persisted = await prisma.product.findUnique({
      where: { id: productId },
    });
    expect(persisted?.price_ars_cents).toBe(250000);
  });

  it('producto inexistente → 404', async () => {
    const res = await patch('00000000-0000-0000-0000-0000000000ee', {
      stock: 1,
    });
    expect(res.status).toBe(404);
  });
});
