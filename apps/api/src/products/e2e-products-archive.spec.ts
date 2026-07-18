import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { adminToken, bootTestApp, truncateCatalog } from '../../test/e2e-app';
import { ProductsModule } from './products.module';
import { PrismaService } from '../prisma/prisma.service';

describe('Products archivar (e2e-products-archive, AC-7)', () => {
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

  const archive = (id: string) =>
    request(app.getHttpServer())
      .patch(`/v1/admin/products/${id}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ status: 'archived' });

  it('archiva el producto (AC-7) sin borrarlo físicamente', async () => {
    const p = await prisma.product.create({
      data: {
        sku: 'REF-ARCH',
        name: 'Heladera',
        price_ars_cents: 100000,
        stock: 5,
        status: 'published',
        category_id: categoryId,
      },
    });
    const res = await archive(p.id);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('archived');

    // El registro sigue existiendo (no hay delete físico).
    const persisted = await prisma.product.findUnique({ where: { id: p.id } });
    expect(persisted).not.toBeNull();
    expect(persisted?.status).toBe('archived');
  });

  it('permite archivar desde draft', async () => {
    const p = await prisma.product.create({
      data: {
        sku: 'REF-ARCH2',
        name: 'Ventilador',
        price_ars_cents: 50000,
        stock: 2,
        category_id: categoryId,
      },
    });
    const res = await archive(p.id);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('archived');
  });
});
