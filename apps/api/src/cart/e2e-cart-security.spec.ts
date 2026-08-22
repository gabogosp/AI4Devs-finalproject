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
      { slug: 'mecha-widia', price: 540_000, stock: 10 },
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

  describe('CSRF de la escritura (§7.5, T6.5)', () => {
    /** Cliente con carrito ya creado (y por lo tanto con cookie que defender). */
    const conCarrito = async () => {
      const c = cliente();
      const res = await c.put('taco-fischer', { quantity: 1 });
      expect(res.status).toBe(200);
      return c;
    };

    it('con cookie, header correcto y Origin permitido → 200', async () => {
      const c = await conCarrito();

      const res = await c.put('taco-fischer', { quantity: 2 });

      expect(res.status).toBe(200);
    });

    it('con la cookie del carrito pero SIN X-CSRF-Token → 403 dsm:auth/csrf', async () => {
      const c = await conCarrito();

      const res = await c.put('taco-fischer', { quantity: 2 }, { csrf: null });

      expect(res.status).toBe(403);
      expect(res.body.type).toBe('dsm:auth/csrf');
    });

    it('con el valor CSRF de OTRO carrito → 403', async () => {
      const victima = await conCarrito();
      const atacante = await conCarrito();

      const res = await victima.put(
        'taco-fischer',
        { quantity: 9 },
        { csrf: atacante.cookie('dsm_cart_csrf') },
      );

      expect(res.status).toBe(403);
    });

    it('con un valor inventado → 403 (no se puede forjar sin JWT_SECRET)', async () => {
      const c = await conCarrito();

      const res = await c.put(
        'taco-fischer',
        { quantity: 2 },
        { csrf: 'valor-inventado-por-el-atacante' },
      );

      expect(res.status).toBe(403);
    });

    it('SIN Origin → 403 (una escritura por cookie sin origen no es verificable)', async () => {
      const c = await conCarrito();

      const res = await c.put('taco-fischer', { quantity: 2 }, { origin: null });

      expect(res.status).toBe(403);
    });

    it('con Origin fuera de la allowlist → 403', async () => {
      const c = await conCarrito();

      const res = await c.put(
        'taco-fischer',
        { quantity: 2 },
        { origin: 'http://evil.example' },
      );

      expect(res.status).toBe(403);
    });

    it('el DELETE exige lo mismo', async () => {
      const c = await conCarrito();

      expect((await c.del('taco-fischer', { csrf: null })).status).toBe(403);
      expect((await c.del('taco-fischer', { origin: null })).status).toBe(403);
      expect((await c.del('taco-fischer')).status).toBe(200);
    });

    it('el GET no exige CSRF: es seguro y CSRF protege efectos', async () => {
      const c = await conCarrito();

      const res = await c.get({ origin: null });

      expect(res.status).toBe(200);
    });

    it('un 403 de CSRF no modifica el carrito', async () => {
      const c = await conCarrito();

      await c.put('taco-fischer', { quantity: 9 }, { csrf: null });

      expect((await c.get()).body.cart!.items[0].quantity).toBe(1);
    });
  });

  describe('atributos de las cookies del carrito (§7.4)', () => {
    const cookieCruda = (
      res: { headers: Record<string, string | string[] | undefined> },
      nombre: string,
    ): string =>
      ((res.headers['set-cookie'] as string[] | undefined) ?? []).find((c) =>
        c.startsWith(`${nombre}=`),
      ) ?? '';

    it('dsm_cart llega HttpOnly + SameSite=Lax + Secure', async () => {
      const res = await cliente().put('taco-fischer', { quantity: 1 });

      const cookie = cookieCruda(res, 'dsm_cart');
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');
      // `AUTH_COOKIE_SECURE` es `true` por default (el entorno de test no lo baja).
      expect(cookie).toContain('Secure');
    });

    it('dsm_cart_csrf llega SIN HttpOnly (el FE tiene que leerla)', async () => {
      const res = await cliente().put('taco-fischer', { quantity: 1 });

      const cookie = cookieCruda(res, 'dsm_cart_csrf');
      expect(cookie).not.toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');
    });

    it('ni el token ni su hash aparecen en NINGÚN cuerpo de respuesta', async () => {
      const { createHash } = await import('node:crypto');
      const c = cliente();
      const puesto = await c.put('taco-fischer', { quantity: 1 });
      const leido = await c.get();
      const borrado = await c.del('taco-fischer');

      const token = c.cookie('dsm_cart')!;
      const hash = createHash('sha256').update(token, 'utf8').digest('hex');
      for (const res of [puesto, leido, borrado]) {
        const cuerpo = JSON.stringify(res.body);
        expect(cuerpo).not.toContain(token);
        expect(cuerpo).not.toContain(hash);
        expect(cuerpo).not.toContain('session_token');
      }
    });
  });

  describe('aislamiento entre carritos', () => {
    it('el cliente A no ve nada de B', async () => {
      const a = cliente();
      const b = cliente();
      await a.put('taco-fischer', { quantity: 2 });
      await b.put('mecha-widia', { quantity: 3 });

      const deA = await a.get();
      const deB = await b.get();

      expect(deA.body.cart!.items.map((i) => i.slug)).toEqual(['taco-fischer']);
      expect(deB.body.cart!.items.map((i) => i.slug)).toEqual(['mecha-widia']);
      expect(deA.body.cart!.id).not.toBe(deB.body.cart!.id);
    });

    it('conocer el id del carrito no da acceso: no hay ruta que lo acepte', async () => {
      const a = cliente();
      const res = await a.put('taco-fischer', { quantity: 1 });
      const idAjeno = res.body.cart!.id!;

      // La superficie es estructuralmente inmune a IDOR: el id no está en ninguna
      // URL, así que no hay chequeo de propiedad que alguien pueda olvidar.
      const intento = await request(app.getHttpServer()).get(
        `/v1/cart/${idAjeno}`,
      );
      expect(intento.status).toBe(404);

      const intento2 = await request(app.getHttpServer())
        .put(`/v1/cart/items/taco-fischer`)
        .set('Origin', ORIGEN_PERMITIDO)
        .send({ quantity: 5, cart_id: idAjeno });
      // El campo desconocido es 422 (no se ignora), así que tampoco por el cuerpo.
      expect(intento2.status).toBe(422);
    });

    it('sin cookie, una escritura estrena carrito propio en vez de tocar uno ajeno', async () => {
      const a = cliente();
      await a.put('taco-fischer', { quantity: 2 });

      const b = cliente();
      const res = await b.put('taco-fischer', { quantity: 1 });

      expect(res.body.cart!.id).not.toBe((await a.get()).body.cart!.id);
      expect((await a.get()).body.cart!.items[0].quantity).toBe(2);
    });
  });

  describe('validación en el borde (§6)', () => {
    it('un campo no declarado produce 422 con errors[]: no se ignora', async () => {
      const res = await cliente().put('taco-fischer', {
        quantity: 1,
        unit_price_ars_cents: 1,
      });

      expect(res.status).toBe(422);
      expect(Array.isArray(res.body.errors)).toBe(true);
      expect(JSON.stringify(res.body.errors)).toContain('unit_price_ars_cents');
    });

    it('quantity 0 produce 422 y no crea línea', async () => {
      const res = await cliente().put('taco-fischer', { quantity: 0 });

      expect(res.status).toBe(422);
      expect(Array.isArray(res.body.errors)).toBe(true);
      expect(await prisma.cartItem.count()).toBe(0);
      expect(await prisma.cart.count()).toBe(0);
    });

    it('quantity por encima del tope por línea produce 422', async () => {
      const res = await cliente().put('taco-fischer', { quantity: 1000 });

      expect(res.status).toBe(422);
    });

    it('el cliente no puede fijar precio por el cuerpo (anti-tampering)', async () => {
      const c = cliente();
      await c.put('taco-fischer', { quantity: 1 });

      const res = await c.put('taco-fischer', {
        quantity: 1,
        unit_price_ars_cents: 1,
      });

      expect(res.status).toBe(422);
      // Y el importe sigue derivándose del catálogo.
      expect((await c.get()).body.cart!.items[0].unit_price_ars_cents).toBe(
        320_000,
      );
    });
  });
});
