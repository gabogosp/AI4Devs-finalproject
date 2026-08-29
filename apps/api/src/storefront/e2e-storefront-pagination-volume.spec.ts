import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bootTestApp, truncateCatalog } from '../../test/e2e-app';
import { StorefrontModule } from './storefront.module';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Paginación a volumen (US-002 AC-7): el catálogo completo nunca se transfiere
 * de una, las páginas particionan el conjunto sin duplicados ni faltantes, y el
 * rubro agrega a sus subrubros (D1) también a escala.
 *
 * Nota de NFR: el objetivo p95 < 300ms es herencia de la capacidad y su
 * re-medición prod-shaped queda gated en US-019 — acá NO se asserta latencia,
 * que en CI local sería una medición sin valor.
 */
describe('Storefront paginación a volumen (e2e-storefront-pagination-volume)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const PUBLICADOS_RUBRO = 40;
  const PUBLICADOS_SUB_A = 50;
  const PUBLICADOS_SUB_B = 35;
  const TOTAL_RUBRO = PUBLICADOS_RUBRO + PUBLICADOS_SUB_A + PUBLICADOS_SUB_B; // 125

  beforeAll(async () => {
    app = await bootTestApp([StorefrontModule]);
    prisma = app.get(PrismaService);
    await truncateCatalog(prisma);

    const rubro = await prisma.category.create({
      data: { name: 'Refrigeración', slug: 'refrigeracion' },
    });
    const subA = await prisma.category.create({
      data: { name: 'Compresores', slug: 'compresores', parent_id: rubro.id },
    });
    const subB = await prisma.category.create({
      data: { name: 'Aislantes', slug: 'aislantes', parent_id: rubro.id },
    });

    const filas: {
      sku: string;
      slug: string;
      name: string;
      price_ars_cents: number;
      stock: number;
      status: string;
      category_id: string;
    }[] = [];
    const agregar = (
      prefijo: string,
      categoryId: string,
      cantidad: number,
      status: string,
    ) => {
      for (let i = 0; i < cantidad; i += 1) {
        const n = String(i).padStart(4, '0');
        filas.push({
          sku: `${prefijo}-${n}`,
          slug: `${prefijo.toLowerCase()}-${n}`,
          // Nombres deliberadamente NO ordenados por inserción: si el orden
          // dependiera del insert, la partición pasaría por casualidad.
          name: `Producto ${prefijo} ${String(999 - i).padStart(4, '0')}`,
          price_ars_cents: 1000 + i,
          stock: i % 3,
          status,
          category_id: categoryId,
        });
      }
    };

    agregar('RUB', rubro.id, PUBLICADOS_RUBRO, 'published');
    agregar('SUBA', subA.id, PUBLICADOS_SUB_A, 'published');
    agregar('SUBB', subB.id, PUBLICADOS_SUB_B, 'published');
    // Ruido intercalado que no debe contarse ni aparecer.
    agregar('DRAFT', rubro.id, 15, 'draft');
    agregar('ARCH', subA.id, 10, 'archived');

    await prisma.product.createMany({ data: filas });
  });

  afterAll(async () => {
    await app?.close();
  });

  const listar = (slug: string, query = '') =>
    request(app.getHttpServer()).get(
      `/v1/categories/${slug}/products${query}`,
    );

  it('D1 a escala: el total del rubro agrega sus subrubros, sin contar ocultos', async () => {
    const res = await listar('refrigeracion', '?limit=1');

    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBe(TOTAL_RUBRO);
  });

  it('el total de un subrubro es sólo el propio', async () => {
    const res = await listar('compresores', '?limit=1');

    expect(res.body.pagination.total).toBe(PUBLICADOS_SUB_A);
  });

  it('las páginas particionan el conjunto: sin duplicados ni faltantes', async () => {
    const vistos: string[] = [];
    for (let offset = 0; offset < TOTAL_RUBRO; offset += 50) {
      const res = await listar('refrigeracion', `?limit=50&offset=${offset}`);
      expect(res.status).toBe(200);
      // Ninguna página excede el limit pedido.
      expect(res.body.data.length).toBeLessThanOrEqual(50);
      vistos.push(...res.body.data.map((p: { slug: string }) => p.slug));
    }

    expect(vistos).toHaveLength(TOTAL_RUBRO); // unión = total
    expect(new Set(vistos).size).toBe(TOTAL_RUBRO); // intersección vacía
    expect(vistos.some((s) => s.startsWith('draft-'))).toBe(false);
    expect(vistos.some((s) => s.startsWith('arch-'))).toBe(false);
  });

  it('el orden es estable entre requests (offset determinista)', async () => {
    const a = await listar('refrigeracion', '?limit=10&offset=30');
    const b = await listar('refrigeracion', '?limit=10&offset=30');

    expect(a.body.data.map((p: { slug: string }) => p.slug)).toEqual(
      b.body.data.map((p: { slug: string }) => p.slug),
    );
  });

  it('AC-7: el catálogo completo nunca se transfiere de una', async () => {
    // Pedir más del tope es un 422, no una respuesta gigante.
    expect((await listar('refrigeracion', '?limit=150')).status).toBe(422);
    expect((await listar('refrigeracion', '?limit=1000')).status).toBe(422);

    const tope = await listar('refrigeracion', '?limit=100');
    expect(tope.status).toBe(200);
    expect(tope.body.data.length).toBeLessThanOrEqual(100);
    expect(tope.body.data.length).toBeLessThan(TOTAL_RUBRO);
  });

  it('un offset más allá del total devuelve página vacía, no error', async () => {
    const res = await listar('refrigeracion', `?offset=${TOTAL_RUBRO + 10}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination.total).toBe(TOTAL_RUBRO);
  });
});
