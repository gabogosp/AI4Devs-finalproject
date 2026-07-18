import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { adminToken, bootTestApp, truncateCatalog } from '../../test/e2e-app';
import { ProductsModule } from './products.module';
import { PrismaService } from '../prisma/prisma.service';

describe('Products alta (e2e-products-create, AC-2/AC-9)', () => {
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
    const cat = await prisma.category.create({
      data: { name: 'Refrigeración', slug: 'refrigeracion' },
    });
    categoryId = cat.id;
  });

  const post = (body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/v1/admin/products')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(body);

  it('crea el producto en estado draft (AC-2) → 201', async () => {
    const res = await post({
      sku: 'REF-001',
      name: 'Heladera',
      price_ars_cents: 100000,
      stock: 3,
      category_id: categoryId,
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('draft');
  });

  it('SKU duplicado (AC-9) → 409 y no crea el segundo', async () => {
    const body = {
      sku: 'REF-DUP',
      name: 'Heladera',
      price_ars_cents: 100000,
      stock: 3,
      category_id: categoryId,
    };
    await post(body);
    const res = await post(body);
    expect(res.status).toBe(409);
    const count = await prisma.product.count({ where: { sku: 'REF-DUP' } });
    expect(count).toBe(1);
  });
});
