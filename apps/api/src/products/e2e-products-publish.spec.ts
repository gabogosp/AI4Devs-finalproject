import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { adminToken, bootTestApp, truncateCatalog } from '../../test/e2e-app';
import { ProductsModule } from './products.module';
import { PrismaService } from '../prisma/prisma.service';

describe('Products publicar (e2e-products-publish, AC-4/AC-6)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let categoryId: string;

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
  });

  const publish = (id: string) =>
    request(app.getHttpServer())
      .patch(`/v1/admin/products/${id}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ status: 'published' });

  it('un draft completo → published (AC-4)', async () => {
    const p = await prisma.product.create({
      data: {
        sku: 'REF-OK',
        name: 'Heladera',
        price_ars_cents: 100000,
        stock: 5,
        category_id: categoryId,
      },
    });
    const res = await publish(p.id);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('published');
  });

  it('un draft incompleto (name vacío) → 422 y permanece draft (AC-6)', async () => {
    // Inserción directa que salta la validación del DTO para forzar el estado incompleto.
    const p = await prisma.product.create({
      data: {
        sku: 'REF-BAD',
        name: '',
        price_ars_cents: 100000,
        stock: 5,
        category_id: categoryId,
      },
    });
    const res = await publish(p.id);
    expect(res.status).toBe(422);
    expect(res.body.errors.map((e: { field: string }) => e.field)).toContain(
      'name',
    );

    const persisted = await prisma.product.findUnique({ where: { id: p.id } });
    expect(persisted?.status).toBe('draft');
  });
});
