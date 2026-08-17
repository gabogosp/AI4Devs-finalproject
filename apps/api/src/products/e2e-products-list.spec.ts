import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { adminToken, bootTestApp, truncateCatalog } from '../../test/e2e-app';
import { ProductsModule } from './products.module';
import { PrismaService } from '../prisma/prisma.service';

/** Integration: pagina >100 SKUs (NFR ≥5.000). */
describe('Products listado paginado (e2e-products-list, NFR)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await bootTestApp([ProductsModule]);
    prisma = app.get(PrismaService);
    await truncateCatalog(prisma);
    const cat = await prisma.category.create({
      data: { name: 'Refrigeración', slug: 'refrigeracion' },
    });
    await prisma.product.createMany({
      data: Array.from({ length: 120 }, (_, i) => ({
        sku: `SKU-${String(i).padStart(4, '0')}`,
        slug: `producto-${i}`,
        name: `Producto ${i}`,
        price_ars_cents: 1000 + i,
        stock: i,
        status: 'draft',
        category_id: cat.id,
      })),
    });
  });
  afterAll(async () => {
    await app?.close();
  });

  const get = (qs: string) =>
    request(app.getHttpServer())
      .get(`/v1/admin/products${qs}`)
      .set('Authorization', `Bearer ${adminToken()}`);

  it('devuelve {data, pagination:{limit,offset,total}} con total correcto', async () => {
    const res = await get('?limit=50&offset=0');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(50);
    expect(res.body.pagination).toEqual({ limit: 50, offset: 0, total: 120 });
  });

  it('la segunda página no repite y respeta el offset', async () => {
    const page1 = await get('?limit=50&offset=0');
    const page2 = await get('?limit=50&offset=50');
    const ids1 = new Set(page1.body.data.map((p: { id: string }) => p.id));
    const overlap = page2.body.data.filter((p: { id: string }) =>
      ids1.has(p.id),
    );
    expect(overlap).toHaveLength(0);
    expect(page2.body.data).toHaveLength(50);
  });

  it('array vacío cuando el offset supera el total', async () => {
    const res = await get('?limit=50&offset=1000');
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination.total).toBe(120);
  });
});
