import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bootTestApp } from '../../test/e2e-app';
import {
  ClienteDeCarrito,
  ORIGEN_PERMITIDO,
  sembrarProductos,
  truncarCarrito,
} from '../../test/cart-client';
import { PrismaService } from '../prisma/prisma.service';
import { StorefrontModule } from '../storefront/storefront.module';
import { CartModule } from './cart.module';

/**
 * T4.4 — controles de borde de la superficie del carrito: `Cache-Control: no-store`
 * en **toda** la superficie (incluidos 4xx y 429) y los métodos de escritura en la
 * allowlist de CORS. T6.5 extiende este archivo con la frontera de seguridad
 * completa (CSRF, atributos de cookie, aislamiento entre carritos).
 */
describe('Seguridad de borde del carrito (e2e-cart-security)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.TRUST_PROXY_HOPS = '1';
    // La ficha pública entra en la app del test para poder verificar, en el mismo
    // borde, que el `no-store` por prefijo del carrito no le pisó su caché acotada.
    app = await bootTestApp([CartModule, StorefrontModule]);
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app?.close();
    delete process.env.TRUST_PROXY_HOPS;
  });
  beforeEach(async () => {
    await truncarCarrito(prisma);
    await sembrarProductos(prisma, [
      { slug: 'taco-fischer', price: 320_000, stock: 10 },
    ]);
  });

  const cliente = () => new ClienteDeCarrito(app);

  describe('Cache-Control: no-store en toda la superficie (§7.1, AC-9)', () => {
    it('el GET del carrito (200) lleva no-store', async () => {
      const res = await cliente().get();

      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('un PUT válido (200) lleva no-store', async () => {
      const res = await cliente().put('taco-fischer', { quantity: 1 });

      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('un PUT con 422 lleva no-store', async () => {
      const res = await cliente().put('taco-fischer', { quantity: 0 });

      expect(res.status).toBe(422);
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('un PUT con 404 lleva no-store', async () => {
      const res = await cliente().put('no-existe', { quantity: 1 });

      expect(res.status).toBe(404);
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('un 403 de CSRF lleva no-store', async () => {
      const c = cliente();
      await c.put('taco-fischer', { quantity: 1 });

      const res = await c.put('taco-fischer', { quantity: 2 }, { csrf: null });

      expect(res.status).toBe(403);
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('el header se estampa por PREFIJO, así que cubre también los no-2xx', async () => {
      // Un interceptor sólo corre en 2xx: sería un `no-store` que se cae justo en
      // los casos donde cachear duele (un 429 cacheado en el edge convierte el
      // rate-limit en un DoS).
      const res = await cliente().del('no-existe');

      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('la ficha pública NO cambió: conserva su Cache-Control acotado', async () => {
      const res = await request(app.getHttpServer()).get(
        '/v1/products/taco-fischer',
      );

      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe(
        'public, max-age=60, stale-while-revalidate=30',
      );
    });
  });

  describe('CORS: métodos de escritura en la allowlist (§7.2)', () => {
    const preflight = (metodo: string, origen: string) =>
      request(app.getHttpServer())
        .options('/v1/cart/items/taco-fischer')
        .set('Origin', origen)
        .set('Access-Control-Request-Method', metodo)
        .set('Access-Control-Request-Headers', 'x-csrf-token,content-type');

    it('el preflight de PUT desde un origen permitido lo autoriza', async () => {
      const res = await preflight('PUT', ORIGEN_PERMITIDO);

      const metodos = res.headers['access-control-allow-methods'] ?? '';
      expect(metodos).toContain('PUT');
      expect(metodos).toContain('DELETE');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
      expect(res.headers['access-control-allow-origin']).toBe(ORIGEN_PERMITIDO);
    });

    it('el preflight de DELETE también', async () => {
      const res = await preflight('DELETE', ORIGEN_PERMITIDO);

      expect(res.headers['access-control-allow-methods'] ?? '').toContain(
        'DELETE',
      );
      expect(res.headers['access-control-allow-origin']).toBe(ORIGEN_PERMITIDO);
    });

    it('declara X-CSRF-Token entre los headers permitidos', async () => {
      const res = await preflight('PUT', ORIGEN_PERMITIDO);

      expect(
        (res.headers['access-control-allow-headers'] ?? '').toLowerCase(),
      ).toContain('x-csrf-token');
    });

    it('un origen fuera de la allowlist NO recibe Allow-Origin', async () => {
      const res = await preflight('PUT', 'http://evil.example');

      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('nunca aparece el comodín con credenciales', async () => {
      const res = await preflight('PUT', ORIGEN_PERMITIDO);

      expect(res.headers['access-control-allow-origin']).not.toBe('*');
    });
  });
});
