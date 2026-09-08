import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bootTestApp, truncateCatalog } from '../../test/e2e-app';
import { StorefrontModule } from './storefront.module';
import { PrismaService } from '../prisma/prisma.service';

/**
 * e2e de la caché acotada de la superficie pública (US-003 AC-9). La ficha lleva
 * `Cache-Control: public, max-age=60, stale-while-revalidate=30` (permite CDN pero
 * acota la frescura del precio); el surface admin conserva `no-store`.
 */
describe('Storefront caché acotada (e2e-storefront-cache, AC-9)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await bootTestApp([StorefrontModule]);
    prisma = app.get(PrismaService);
    await truncateCatalog(prisma);
    const cat = await prisma.category.create({
      data: { name: 'Refrigeración', slug: 'refrigeracion' },
    });
    await prisma.product.create({
      data: {
        sku: 'CACHE-001',
        slug: 'heladera-cache',
        name: 'Heladera',
        price_ars_cents: 100000,
        stock: 5,
        status: 'published',
        category_id: cat.id,
      },
    });
  });
  afterAll(async () => {
    await app?.close();
  });

  it('la ficha pública lleva Cache-Control acotado (max-age=60, sin no-store)', async () => {
    const res = await request(app.getHttpServer()).get(
      '/v1/products/heladera-cache',
    );
    expect(res.status).toBe(200);
    const cc = res.headers['cache-control'];
    expect(cc).toContain('public');
    expect(cc).toContain('max-age=60');
    expect(cc).toContain('stale-while-revalidate=30');
    expect(cc).not.toContain('no-store');
  });

  it('el surface admin conserva no-store', async () => {
    const res = await request(app.getHttpServer()).get('/v1/admin/categories');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('M1: un 404 NO lleva Cache-Control cacheable (sólo 2xx)', async () => {
    const res = await request(app.getHttpServer()).get('/v1/products/NOPE-404');
    expect(res.status).toBe(404);
    // El interceptor no corre ante excepción → no hay header público que un CDN
    // pudiera cachear.
    expect(res.headers['cache-control'] ?? '').not.toContain('max-age=60');
  });

  describe('TTL por endpoint (US-002 T6.1, decisión D5)', () => {
    it('el árbol de categorías lleva su TTL propio de 300s', async () => {
      const res = await request(app.getHttpServer()).get('/v1/categories');

      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe(
        'public, max-age=300, stale-while-revalidate=60',
      );
    });

    it('detalle y listado de categoría se quedan en el default de 60s', async () => {
      for (const path of [
        '/v1/categories/refrigeracion',
        '/v1/categories/refrigeracion/products',
      ]) {
        const res = await request(app.getHttpServer()).get(path);
        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toBe(
          'public, max-age=60, stale-while-revalidate=30',
        );
      }
    });

    it('la ficha de US-003 NO cambia su TTL al ramificar el interceptor', async () => {
      const res = await request(app.getHttpServer()).get(
        '/v1/products/heladera-cache',
      );

      expect(res.headers['cache-control']).toBe(
        'public, max-age=60, stale-while-revalidate=30',
      );
    });

    it('un 404 de categoría no lleva header cacheable', async () => {
      const res = await request(app.getHttpServer()).get(
        '/v1/categories/no-existe',
      );

      expect(res.status).toBe(404);
      expect(res.headers['cache-control'] ?? '').not.toContain('max-age');
    });

    it('un 422 del listado tampoco lleva header cacheable', async () => {
      const res = await request(app.getHttpServer()).get(
        '/v1/categories/refrigeracion/products?limit=150',
      );

      expect(res.status).toBe(422);
      expect(res.headers['cache-control'] ?? '').not.toContain('max-age');
    });

    /**
     * US-025 — hallazgo real de e9 en el E2E: `GET /products/:slug/reviews`
     * heredaba el default de 60s del controller (pensado para precio/stock,
     * US-003 AC-9), así que una reseña recién dejada o recién moderada no se
     * veía en la próxima lectura hasta que expiraba el caché — viola AC-3/AC-8.
     * `@StorefrontCache({ maxAge: 0, swr: 0 })` en esa ruta puntual lo corrige
     * sin tocar el TTL del resto del controller (verificado dos filas abajo).
     */
    it('las reseñas públicas NO llevan el TTL de 60s de precio/stock — siempre revalida', async () => {
      const res = await request(app.getHttpServer()).get(
        '/v1/products/heladera-cache/reviews',
      );

      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe(
        'public, max-age=0, stale-while-revalidate=0',
      );
    });

    it('el override de reseñas no afecta el TTL de la ficha del mismo producto', async () => {
      const res = await request(app.getHttpServer()).get(
        '/v1/products/heladera-cache',
      );

      expect(res.headers['cache-control']).toBe(
        'public, max-age=60, stale-while-revalidate=30',
      );
    });

    /**
     * US-026 D5: aunque el TTL deseado (60s/30s) coincide con el default de
     * clase, se declara `@StorefrontCache` explícito en cada ruta nueva — la
     * misma lección de US-025/#139 (una ruta nueva sin su propio decorator
     * hereda el default en silencio, y ese default puede cambiar sin que
     * nadie note que esta ruta dependía de él).
     */
    it('"novedades" lleva su propio Cache-Control explícito de 60s/30s (D5)', async () => {
      const res = await request(app.getHttpServer()).get('/v1/products/novedades');

      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe(
        'public, max-age=60, stale-while-revalidate=30',
      );
    });

    it('"mas-vendidos" lleva su propio Cache-Control explícito de 60s/30s (D5)', async () => {
      const res = await request(app.getHttpServer()).get('/v1/products/mas-vendidos');

      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe(
        'public, max-age=60, stale-while-revalidate=30',
      );
    });
  });
});
