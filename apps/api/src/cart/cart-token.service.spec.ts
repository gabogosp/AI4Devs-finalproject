import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { CART_COOKIE, CART_CSRF_COOKIE } from '../auth/cookies';
import { hashToken } from '../auth/tokens/opaque-token';
import { PrismaService } from '../prisma/prisma.service';
import { CartsRepository } from './carts.repository';
import { CartTokenService } from './cart-token.service';

/**
 * T2.3 — integration contra el Postgres real. Lo que se prueba es el ciclo de vida
 * completo de la identidad del invitado: crear, resolver, deslizar y purgar; y la
 * propiedad que sostiene todo el diseño — en base vive el **hash**, nunca el token.
 */
describe('CartTokenService (integration)', () => {
  const prisma = new PrismaService();
  const carts = new CartsRepository(prisma);
  const TTL_DIAS = 7;
  const config = new ConfigService({
    CART_TTL_DAYS: TTL_DIAS,
    AUTH_COOKIE_SECURE: 'false',
  }) as ConfigService;
  const service = new CartTokenService(carts, config);

  /** `res` mínimo que registra las cookies emitidas, como hace Express. */
  function fakeRes(): Response & {
    emitidas: Array<{ name: string; value: string; opts: { maxAge?: number } }>;
  } {
    const emitidas: Array<{
      name: string;
      value: string;
      opts: { maxAge?: number };
    }> = [];
    const res = {
      emitidas,
      cookie(name: string, value: string, opts: { maxAge?: number }) {
        emitidas.push({ name, value, opts });
        return res;
      },
    };
    return res as unknown as Response & { emitidas: typeof emitidas };
  }

  const fakeReq = (cookies: Record<string, string> = {}) =>
    ({ cookies }) as unknown as Request;

  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE carts, cart_items RESTART IDENTITY CASCADE',
    );
  });

  describe('ensure', () => {
    it('sin cookie: crea la fila y emite las dos cookies', async () => {
      const res = fakeRes();
      const { cart, token } = await service.ensure(fakeReq(), res);

      expect(cart.id).toBeTruthy();
      expect(cart.items).toEqual([]);
      expect(res.emitidas.map((c) => c.name)).toEqual([
        CART_COOKIE,
        CART_CSRF_COOKIE,
      ]);
      expect(res.emitidas[0].value).toBe(token);
      expect(await prisma.cart.count()).toBe(1);
    });

    it('con una cookie viva NO crea un segundo carrito', async () => {
      const primera = await service.ensure(fakeReq(), fakeRes());
      const segunda = await service.ensure(
        fakeReq({ [CART_COOKIE]: primera.token }),
        fakeRes(),
      );

      expect(segunda.cart.id).toBe(primera.cart.id);
      expect(await prisma.cart.count()).toBe(1);
    });
  });

  describe('resolve', () => {
    it('con la cookie emitida devuelve el mismo carrito', async () => {
      const { cart, token } = await service.ensure(fakeReq(), fakeRes());

      const resuelto = await service.resolve(fakeReq({ [CART_COOKIE]: token }));

      expect(resuelto?.cart.id).toBe(cart.id);
      expect(resuelto?.token).toBe(token);
    });

    it('sin cookie devuelve null y no crea nada', async () => {
      expect(await service.resolve(fakeReq())).toBeNull();
      expect(await prisma.cart.count()).toBe(0);
    });

    it('con un token inventado devuelve null, sin error y sin filtrar el motivo', async () => {
      expect(
        await service.resolve(fakeReq({ [CART_COOKIE]: 'token-inventado' })),
      ).toBeNull();
    });

    it('purga oportunista: con la fila vencida devuelve null Y la fila ya no está', async () => {
      const { cart, token } = await service.ensure(fakeReq(), fakeRes());
      await prisma.cart.update({
        where: { id: cart.id },
        data: { expires_at: new Date(Date.now() - 1000) },
      });

      expect(await service.resolve(fakeReq({ [CART_COOKIE]: token }))).toBeNull();
      expect(await prisma.cart.findUnique({ where: { id: cart.id } })).toBeNull();
    });

    it('resolve NO emite cookies: el GET es seguro', async () => {
      const { token } = await service.ensure(fakeReq(), fakeRes());
      // `resolve` no recibe `res` justamente para que no pueda emitir nada.
      const resuelto = await service.resolve(fakeReq({ [CART_COOKIE]: token }));
      expect(resuelto).not.toBeNull();
    });
  });

  describe('slide', () => {
    it('expires_at y el Max-Age de la cookie salen del MISMO CART_TTL_DAYS', async () => {
      const sesion = await service.ensure(fakeReq(), fakeRes());
      await prisma.cart.update({
        where: { id: sesion.cart.id },
        data: { expires_at: new Date(Date.now() + 60_000) },
      });

      const res = fakeRes();
      const antes = Date.now();
      const deslizado = await service.slide(sesion, res);

      const ventanaMs = TTL_DIAS * 86_400_000;
      const esperado = antes + ventanaMs;
      // Tolerancia de 5 s: lo que importa es que los dos derivan del mismo número.
      expect(
        Math.abs(deslizado.expires_at.getTime() - esperado),
      ).toBeLessThan(5_000);
      for (const cookie of res.emitidas) {
        expect(cookie.opts.maxAge).toBe(ventanaMs);
      }
    });

    it('re-emite las dos cookies con el mismo token (no rota la identidad)', async () => {
      const sesion = await service.ensure(fakeReq(), fakeRes());
      const res = fakeRes();

      await service.slide(sesion, res);

      expect(res.emitidas.map((c) => c.name)).toEqual([
        CART_COOKIE,
        CART_CSRF_COOKIE,
      ]);
      expect(res.emitidas[0].value).toBe(sesion.token);
    });

    it('conserva las líneas del carrito recibido', async () => {
      const sesion = await service.ensure(fakeReq(), fakeRes());
      const cat = await prisma.category.create({
        data: { name: `C ${Date.now()}`, slug: `c-${Date.now()}` },
      });
      const producto = await prisma.product.create({
        data: {
          sku: `SLIDE-${Date.now()}`,
          slug: `slide-${Date.now()}`,
          name: 'X',
          price_ars_cents: 1000,
          stock: 5,
          status: 'published',
          category_id: cat.id,
        },
      });
      await carts.upsertItem({
        cartId: sesion.cart.id,
        productId: producto.id,
        quantity: 2,
        unitPriceArsCents: 1000,
      });
      const conLinea = (await service.resolve(
        fakeReq({ [CART_COOKIE]: sesion.token }),
      ))!;

      const deslizado = await service.slide(conLinea, fakeRes());

      expect(deslizado.items).toHaveLength(1);
    });
  });

  describe('el token en claro nunca toca la base', () => {
    it('session_token_hash NO es igual al valor de la cookie', async () => {
      const res = fakeRes();
      const { cart, token } = await service.ensure(fakeReq(), res);

      const fila = await prisma.cart.findUnique({ where: { id: cart.id } });
      expect(fila?.session_token_hash).not.toBe(token);
      expect(fila?.session_token_hash).toBe(hashToken(token));
      // 64 hex de SHA-256, no el base64url del token.
      expect(fila?.session_token_hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('el token tiene entropía de CSPRNG (256 bits en base64url)', async () => {
      const a = await service.ensure(fakeReq(), fakeRes());
      const b = await service.ensure(fakeReq(), fakeRes());

      expect(a.token).not.toBe(b.token);
      expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });
  });
});
