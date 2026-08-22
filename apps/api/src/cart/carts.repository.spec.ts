import { PrismaService } from '../prisma/prisma.service';
import { CartsRepository } from './carts.repository';

/**
 * T2.1 — integration contra el Postgres real de docker-compose. Lo que se prueba
 * acá no es que Prisma funcione, sino las tres propiedades que el diseño le pide a
 * este repositorio y que un mock no podría demostrar: que el upsert sobre la clave
 * compuesta no puede duplicar una línea, que un carrito vencido no vuelve a la
 * vida, y que la cascada la hace la base.
 */
describe('CartsRepository (integration)', () => {
  const prisma = new PrismaService();
  const repo = new CartsRepository(prisma);

  const enUnaHora = () => new Date(Date.now() + 3_600_000);
  const haceUnaHora = () => new Date(Date.now() - 3_600_000);

  let productoA = '';
  let productoB = '';

  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE carts, cart_items, products, categories RESTART IDENTITY CASCADE',
    );
    const cat = await prisma.category.create({
      data: { name: 'Fijaciones', slug: 'fijaciones' },
    });
    productoA = (
      await prisma.product.create({
        data: {
          sku: 'REPO-A',
          slug: 'taco-fischer',
          name: 'Taco Fischer',
          price_ars_cents: 320_000,
          stock: 10,
          status: 'published',
          category_id: cat.id,
        },
      })
    ).id;
    productoB = (
      await prisma.product.create({
        data: {
          sku: 'REPO-B',
          slug: 'mecha-widia',
          name: 'Mecha widia',
          price_ars_cents: 540_000,
          stock: 4,
          status: 'published',
          category_id: cat.id,
        },
      })
    ).id;
  });

  const nuevoCarrito = () =>
    repo.create({ tokenHash: `hash-${Date.now()}-${Math.random()}`, expiresAt: enUnaHora() });

  describe('upsertItem', () => {
    it('dos veces con el mismo (cart, product) deja UNA fila con la última cantidad', async () => {
      const cart = await nuevoCarrito();
      await repo.upsertItem({
        cartId: cart.id,
        productId: productoA,
        quantity: 2,
        unitPriceArsCents: 320_000,
      });
      await repo.upsertItem({
        cartId: cart.id,
        productId: productoA,
        quantity: 5,
        unitPriceArsCents: 330_000,
      });

      const vivo = await repo.findLiveByTokenHash(cart.session_token_hash);
      expect(vivo?.items).toHaveLength(1);
      expect(vivo?.items[0].quantity).toBe(5);
      // La instantánea se re-sella en cada toque (Decisión 3).
      expect(vivo?.items[0].unit_price_ars_cents).toBe(330_000);
    });

    it('productos distintos son líneas distintas', async () => {
      const cart = await nuevoCarrito();
      await repo.upsertItem({
        cartId: cart.id,
        productId: productoA,
        quantity: 1,
        unitPriceArsCents: 320_000,
      });
      await repo.upsertItem({
        cartId: cart.id,
        productId: productoB,
        quantity: 1,
        unitPriceArsCents: 540_000,
      });

      expect(await repo.countItems(cart.id)).toBe(2);
    });

    it('un producto inexistente da un error de dominio, no un error crudo de Prisma', async () => {
      const cart = await nuevoCarrito();
      await expect(
        repo.upsertItem({
          cartId: cart.id,
          productId: '00000000-0000-0000-0000-000000000000',
          quantity: 1,
          unitPriceArsCents: 100,
        }),
      ).rejects.toMatchObject({ status: 422, type: 'dsm:catalog/validation' });
    });
  });

  describe('findLiveByTokenHash', () => {
    it('devuelve el carrito con sus líneas', async () => {
      const cart = await nuevoCarrito();
      await repo.upsertItem({
        cartId: cart.id,
        productId: productoA,
        quantity: 3,
        unitPriceArsCents: 320_000,
      });

      const vivo = await repo.findLiveByTokenHash(cart.session_token_hash);
      expect(vivo?.id).toBe(cart.id);
      expect(vivo?.items[0].quantity).toBe(3);
    });

    it('null si expires_at ya pasó, AUNQUE la fila exista', async () => {
      const cart = await repo.create({
        tokenHash: 'hash-vencido',
        expiresAt: haceUnaHora(),
      });

      expect(await repo.findLiveByTokenHash('hash-vencido')).toBeNull();
      // El filtro vive en la query: la fila sigue ahí hasta que alguien la purgue.
      expect(await repo.findByTokenHash('hash-vencido')).not.toBeNull();
      expect((await repo.findByTokenHash('hash-vencido'))?.id).toBe(cart.id);
    });

    it('null si el hash no existe', async () => {
      expect(await repo.findLiveByTokenHash('inventado')).toBeNull();
    });
  });

  describe('deleteById', () => {
    it('borra las líneas en cascada', async () => {
      const cart = await nuevoCarrito();
      await repo.upsertItem({
        cartId: cart.id,
        productId: productoA,
        quantity: 1,
        unitPriceArsCents: 320_000,
      });

      await repo.deleteById(cart.id);

      expect(await prisma.cartItem.count({ where: { cart_id: cart.id } })).toBe(0);
      expect(await repo.findByTokenHash(cart.session_token_hash)).toBeNull();
    });

    it('borrar uno que no está no lanza', async () => {
      await expect(
        repo.deleteById('00000000-0000-0000-0000-000000000000'),
      ).resolves.toBeUndefined();
    });
  });

  describe('deleteItem', () => {
    it('borra la línea y devuelve true; repetirlo devuelve false sin lanzar', async () => {
      const cart = await nuevoCarrito();
      await repo.upsertItem({
        cartId: cart.id,
        productId: productoA,
        quantity: 1,
        unitPriceArsCents: 320_000,
      });

      expect(await repo.deleteItem(cart.id, productoA)).toBe(true);
      expect(await repo.deleteItem(cart.id, productoA)).toBe(false);
      expect(await repo.countItems(cart.id)).toBe(0);
    });

    it('no toca las líneas de otro carrito', async () => {
      const a = await nuevoCarrito();
      const b = await nuevoCarrito();
      for (const cart of [a, b]) {
        await repo.upsertItem({
          cartId: cart.id,
          productId: productoA,
          quantity: 1,
          unitPriceArsCents: 320_000,
        });
      }

      await repo.deleteItem(a.id, productoA);

      expect(await repo.countItems(b.id)).toBe(1);
    });
  });

  describe('countItems', () => {
    it('cuenta LÍNEAS distintas, no unidades', async () => {
      const cart = await nuevoCarrito();
      await repo.upsertItem({
        cartId: cart.id,
        productId: productoA,
        quantity: 40,
        unitPriceArsCents: 320_000,
      });

      expect(await repo.countItems(cart.id)).toBe(1);
    });
  });

  describe('touch', () => {
    it('mueve expires_at y updated_at hacia adelante', async () => {
      const cart = await repo.create({
        tokenHash: 'hash-touch',
        expiresAt: new Date(Date.now() + 60_000),
      });
      const nuevo = new Date(Date.now() + 7 * 86_400_000);

      // `updated_at` tiene resolución de milisegundos; una espera mínima evita
      // comparar dos instantes iguales.
      await new Promise((r) => setTimeout(r, 5));
      const despues = await repo.touch(cart.id, nuevo);

      expect(despues.expires_at.getTime()).toBe(nuevo.getTime());
      expect(despues.updated_at.getTime()).toBeGreaterThan(
        cart.updated_at.getTime(),
      );
    });

    it('un carrito ya borrado da NotFoundError de dominio', async () => {
      await expect(
        repo.touch('00000000-0000-0000-0000-000000000000', enUnaHora()),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('deleteExpired', () => {
    it('borra sólo los vencidos', async () => {
      await repo.create({ tokenHash: 'v1', expiresAt: haceUnaHora() });
      await repo.create({ tokenHash: 'v2', expiresAt: haceUnaHora() });
      await repo.create({ tokenHash: 'vivo', expiresAt: enUnaHora() });

      expect(await repo.deleteExpired()).toBe(2);
      expect(await repo.findByTokenHash('vivo')).not.toBeNull();
    });
  });
});
