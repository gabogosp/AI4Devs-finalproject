import { INestApplication } from '@nestjs/common';
import { bootTestApp } from '../../test/e2e-app';
import {
  ClienteDeCarrito,
  sembrarProductos,
  truncarCarrito,
} from '../../test/cart-client';
import { PrismaService } from '../prisma/prisma.service';
import { CART_COOKIE } from '../auth/cookies';
import { CartModule } from './cart.module';

/**
 * T6.2 — persistencia entre visitas (AC-4) y carrito vacío (AC-7).
 *
 * El caso central de AC-4 se simula con un **cliente HTTP nuevo** que lleva sólo la
 * cookie `dsm_cart`: es lo que queda después de cerrar el navegador. Si el carrito
 * dependiera de estado en memoria del servidor o de una sesión de cuenta, acá se
 * caería.
 *
 * También ancla la propiedad que evita el peor bug de este diseño: la cookie y la
 * fila vencen **juntas**, porque las dos derivan del mismo `CART_TTL_DAYS`. Una
 * cookie viva apuntando a una fila vencida es un carrito que «desaparece» sin
 * explicación.
 */
describe('Persistencia del carrito del invitado (e2e-cart-persistence)', () => {
  const TTL_DIAS = Number(process.env.CART_TTL_DAYS ?? 7);
  const VENTANA_MS = TTL_DIAS * 86_400_000;

  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.TRUST_PROXY_HOPS = '1';
    app = await bootTestApp([CartModule]);
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
      { slug: 'mecha-widia', price: 540_000, stock: 5 },
    ]);
  });

  const cliente = () => new ClienteDeCarrito(app);
  const cookieCruda = (
    res: { headers: Record<string, string | string[] | undefined> },
    nombre: string,
  ): string =>
    ((res.headers['set-cookie'] as string[] | undefined) ?? []).find((c) =>
      c.startsWith(`${nombre}=`),
    ) ?? '';

  describe('AC-4 — el carrito sobrevive al cierre del navegador', () => {
    it('un cliente NUEVO que lleva sólo dsm_cart recupera el mismo carrito', async () => {
      const primeraVisita = cliente();
      await primeraVisita.put('taco-fischer', { quantity: 2 });
      await primeraVisita.put('mecha-widia', { quantity: 1 });
      const token = primeraVisita.cookie(CART_COOKIE)!;

      // Cliente nuevo: sin nada en memoria, sólo la cookie persistente.
      const segundaVisita = cliente().conCookies({ [CART_COOKIE]: token });
      const res = await segundaVisita.get();

      expect(res.status).toBe(200);
      expect(res.body.cart!.item_count).toBe(2);
      expect(res.body.cart!.items.map((i) => i.slug).sort()).toEqual([
        'mecha-widia',
        'taco-fischer',
      ]);
      expect(res.body.cart!.total_ars_cents).toBe(640_000 + 540_000);
    });

    it('no hay ninguna cuenta de por medio: el carrito no está asociado a un customer', async () => {
      const c = cliente();
      await c.put('taco-fischer', { quantity: 1 });

      const fila = await prisma.cart.findFirst();

      expect(fila).not.toBeNull();
      // La columna existe (está en el DER) pero esta US no la escribe (OQ-BE-3).
      expect(fila!.customer_id).toBeNull();
    });

    it('la cookie lleva Max-Age = 604800 (7 días) y la fila un expires_at de la MISMA ventana', async () => {
      const antes = Date.now();
      const res = await cliente().put('taco-fischer', { quantity: 1 });

      expect(cookieCruda(res, CART_COOKIE)).toContain(
        `Max-Age=${VENTANA_MS / 1000}`,
      );
      const fila = await prisma.cart.findFirst();
      expect(
        Math.abs(fila!.expires_at.getTime() - (antes + VENTANA_MS)),
      ).toBeLessThan(10_000);
    });
  });

  describe('el deslizamiento es sólo en escrituras', () => {
    it('una ESCRITURA corre la fila y la cookie hacia adelante', async () => {
      const c = cliente();
      await c.put('taco-fischer', { quantity: 1 });
      const primero = (await prisma.cart.findFirst())!.expires_at.getTime();

      await new Promise((r) => setTimeout(r, 10));
      const res = await c.put('taco-fischer', { quantity: 2 });

      const segundo = (await prisma.cart.findFirst())!.expires_at.getTime();
      expect(segundo).toBeGreaterThan(primero);
      // Y la cookie se re-emite con el mismo Max-Age, no con uno distinto.
      expect(cookieCruda(res, CART_COOKIE)).toContain(
        `Max-Age=${VENTANA_MS / 1000}`,
      );
    });

    it('una LECTURA deja las dos donde estaban (el GET es seguro)', async () => {
      const c = cliente();
      await c.put('taco-fischer', { quantity: 1 });
      const antes = (await prisma.cart.findFirst())!.expires_at.getTime();

      await new Promise((r) => setTimeout(r, 10));
      const res = await c.get();

      expect((await prisma.cart.findFirst())!.expires_at.getTime()).toBe(antes);
      // Consecuencia declarada (design.md §Qué mueve CART_TTL_DAYS = 7): mirar el
      // carrito el día 6 sin tocarlo no lo salva el día 8.
      expect(res.headers['set-cookie']).toBeUndefined();
    });
  });

  describe('AC-7 — carrito vacío', () => {
    it('un GET SIN cookie devuelve 200 con el carrito vacío y sin Set-Cookie', async () => {
      const res = await cliente().get();

      expect(res.status).toBe(200);
      expect(res.body.cart).toEqual({
        id: null,
        items: [],
        item_count: 0,
        total_quantity: 0,
        total_ars_cents: 0,
        has_blocking_issues: false,
        updated_at: null,
      });
      // No se crea carrito al mirar: si no, cada crawler dejaría una fila.
      expect(res.headers['set-cookie']).toBeUndefined();
      expect(await prisma.cart.count()).toBe(0);
    });

    it('un GET con una cookie huérfana devuelve el vacío, sin error ni Set-Cookie', async () => {
      const res = await cliente()
        .conCookies({ [CART_COOKIE]: 'token-que-no-existe' })
        .get();

      expect(res.status).toBe(200);
      expect(res.body.cart!.id).toBeNull();
      expect(res.headers['set-cookie']).toBeUndefined();
    });
  });

  describe('purga oportunista', () => {
    it('con la fila vencida a mano, el GET devuelve el vacío Y la fila ya no está', async () => {
      const c = cliente();
      await c.put('taco-fischer', { quantity: 1 });
      const cartId = (await prisma.cart.findFirst())!.id;
      await prisma.cart.update({
        where: { id: cartId },
        data: { expires_at: new Date(Date.now() - 1000) },
      });

      const res = await c.get();

      expect(res.body.cart!.id).toBeNull();
      expect(await prisma.cart.findUnique({ where: { id: cartId } })).toBeNull();
      // Y sus líneas se fueron con ella (CASCADE).
      expect(await prisma.cartItem.count()).toBe(0);
    });

    it('una escritura con la fila vencida arranca un carrito NUEVO, no revive el viejo', async () => {
      const c = cliente();
      await c.put('taco-fischer', { quantity: 3 });
      const viejo = (await prisma.cart.findFirst())!;
      await prisma.cart.update({
        where: { id: viejo.id },
        data: { expires_at: new Date(Date.now() - 1000) },
      });

      const res = await c.put('mecha-widia', { quantity: 1 });

      expect(res.status).toBe(200);
      expect(res.body.cart!.id).not.toBe(viejo.id);
      // El carrito nuevo no arrastra las líneas del vencido.
      expect(res.body.cart!.items.map((i) => i.slug)).toEqual(['mecha-widia']);
    });
  });

  describe('aislamiento entre visitantes', () => {
    it('dos clientes sin cookie estrenan carritos distintos', async () => {
      const a = await cliente().put('taco-fischer', { quantity: 1 });
      const b = await cliente().put('mecha-widia', { quantity: 1 });

      expect(a.body.cart!.id).not.toBe(b.body.cart!.id);
      expect(await prisma.cart.count()).toBe(2);
    });
  });
});
