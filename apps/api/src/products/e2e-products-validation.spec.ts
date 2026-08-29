import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { adminToken, bootTestApp } from '../../test/e2e-app';
import { ProductsModule } from './products.module';

const CATEGORY_UUID = '00000000-0000-0000-0000-0000000000aa';

describe('Products validación por campo (e2e-products-validation, AC-5)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await bootTestApp([ProductsModule]);
  });
  afterAll(async () => {
    await app?.close();
  });

  const post = (body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/v1/admin/products')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(body);

  const valid = {
    sku: 'X-1',
    name: 'Producto',
    price_ars_cents: 1000,
    stock: 1,
    category_id: CATEGORY_UUID,
  };

  it('precio 0 → 422 con error en campo price_ars_cents', async () => {
    const res = await post({ ...valid, price_ars_cents: 0 });
    expect(res.status).toBe(422);
    expect(res.body.errors.map((e: { field: string }) => e.field)).toContain(
      'price_ars_cents',
    );
  });

  it('stock -1 → 422 con error en campo stock', async () => {
    const res = await post({ ...valid, stock: -1 });
    expect(res.status).toBe(422);
    expect(res.body.errors.map((e: { field: string }) => e.field)).toContain(
      'stock',
    );
  });

  it('name vacío → 422 con error en campo name', async () => {
    const res = await post({ ...valid, name: '' });
    expect(res.status).toBe(422);
    expect(res.body.errors.map((e: { field: string }) => e.field)).toContain(
      'name',
    );
  });
});
