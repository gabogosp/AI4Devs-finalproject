import { INestApplication } from '@nestjs/common';
import { bootTestApp } from '../../test/e2e-app';
import {
  ClienteDeCarrito,
  sembrarProductos,
  truncarCarrito,
} from '../../test/cart-client';
import { PrismaService } from '../prisma/prisma.service';
import { CartModule } from './cart.module';

/**
 * T6.4 — disponibilidad (AC-6), precio vigente (AC-9) y no-publicados (AC-10).
 *
 * Los tres AC comparten una idea: **el carrito se recalcula en cada lectura**. No
 * hay estado congelado que pueda quedar mintiendo, y lo que cambió se **muestra**
 * en vez de aplicarse en silencio.
 */
describe('Disponibilidad y precio del carrito (e2e-cart-availability)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ids: Record<string, string>;

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
    ids = await sembrarProductos(prisma, [
      { slug: 'taco-fischer', price: 320_000, stock: 10 },
      { slug: 'mecha-widia', price: 540_000, stock: 10 },
      { slug: 'producto-borrador', price: 100_000, stock: 5, status: 'draft' },
      { slug: 'producto-archivado', price: 100_000, stock: 5, status: 'archived' },
    ]);
  });

  const cliente = () => new ClienteDeCarrito(app);

  describe('AC-6 — el producto que dejó de estar disponible se MARCA, no se borra', () => {
    it('despublicarlo lo deja unavailable, fuera del total y con la línea viva', async () => {
      const c = cliente();
      await c.put('taco-fischer', { quantity: 2 }); // 640.000
      await c.put('mecha-widia', { quantity: 1 }); // 540.000

      await prisma.product.update({
        where: { id: ids['taco-fischer'] },
        data: { status: 'archived' },
      });
      const res = await c.get();

      const carrito = res.body.cart!;
      const bloqueado = carrito.items.find((i) => i.slug === 'taco-fischer')!;
      expect(bloqueado.availability).toBe('unavailable');
      // La línea sigue: el cliente no pierde la información de qué quería.
      expect(carrito.item_count).toBe(2);
      expect(await prisma.cartItem.count()).toBe(2);
      // Fuera del total, que suma sólo lo comprable (OQ-BE-4).
      expect(carrito.total_ars_cents).toBe(540_000);
      expect(carrito.has_blocking_issues).toBe(true);
      // Pero la línea conserva su propio subtotal para el detalle del FE.
      expect(bloqueado.subtotal_ars_cents).toBe(640_000);
    });

    it('bajarle el stock por debajo de la cantidad lo deja insufficient_stock con available_quantity', async () => {
      const c = cliente();
      await c.put('taco-fischer', { quantity: 5 });

      await prisma.product.update({
        where: { id: ids['taco-fischer'] },
        data: { stock: 2 },
      });
      const res = await c.get();

      const linea = res.body.cart!.items[0];
      expect(linea.availability).toBe('insufficient_stock');
      expect(linea.available_quantity).toBe(2);
      expect(linea.max_quantity).toBe(2);
      expect(res.body.cart!.total_ars_cents).toBe(0);
      expect(res.body.cart!.has_blocking_issues).toBe(true);
    });

    it('un producto bloqueado se puede QUITAR del carrito', async () => {
      // Si el borrado resolviera el slug con el filtro de publicados, la línea
      // quedaría atrapada: bloqueada e imposible de sacar.
      const c = cliente();
      await c.put('taco-fischer', { quantity: 1 });
      await prisma.product.update({
        where: { id: ids['taco-fischer'] },
        data: { status: 'archived' },
      });

      const res = await c.del('taco-fischer');

      expect(res.status).toBe(200);
      expect(res.body.cart!.items).toEqual([]);
    });

    it('vuelto a publicar, la línea se recupera sola', async () => {
      const c = cliente();
      await c.put('taco-fischer', { quantity: 1 });
      await prisma.product.update({
        where: { id: ids['taco-fischer'] },
        data: { status: 'archived' },
      });
      expect((await c.get()).body.cart!.has_blocking_issues).toBe(true);

      await prisma.product.update({
        where: { id: ids['taco-fischer'] },
        data: { status: 'published' },
      });
      const res = await c.get();

      expect(res.body.cart!.items[0].availability).toBe('available');
      expect(res.body.cart!.has_blocking_issues).toBe(false);
      expect(res.body.cart!.total_ars_cents).toBe(320_000);
    });
  });

  describe('AC-9 — precios vigentes', () => {
    it('cambiado el precio, la lectura usa el NUEVO en unitario, subtotal y total', async () => {
      const c = cliente();
      await c.put('taco-fischer', { quantity: 2 });

      await prisma.product.update({
        where: { id: ids['taco-fischer'] },
        data: { price_ars_cents: 400_000 },
      });
      const res = await c.get();

      const linea = res.body.cart!.items[0];
      expect(linea.unit_price_ars_cents).toBe(400_000);
      expect(linea.subtotal_ars_cents).toBe(800_000);
      expect(res.body.cart!.total_ars_cents).toBe(800_000);
    });

    it('el cambio es VISIBLE: price_changed con el precio viejo', async () => {
      const c = cliente();
      await c.put('taco-fischer', { quantity: 1 });

      await prisma.product.update({
        where: { id: ids['taco-fischer'] },
        data: { price_ars_cents: 400_000 },
      });
      const res = await c.get();

      expect(res.body.cart!.items[0].price_changed).toBe(true);
      expect(res.body.cart!.items[0].previous_unit_price_ars_cents).toBe(320_000);
    });

    it('tocar la línea RE-SELLA la instantánea: el aviso se apaga', async () => {
      // Semántica legible: «desde que lo agregaste, esto cambió».
      const c = cliente();
      await c.put('taco-fischer', { quantity: 1 });
      await prisma.product.update({
        where: { id: ids['taco-fischer'] },
        data: { price_ars_cents: 400_000 },
      });
      expect((await c.get()).body.cart!.items[0].price_changed).toBe(true);

      const res = await c.put('taco-fischer', { quantity: 2 });

      expect(res.body.cart!.items[0].price_changed).toBe(false);
      expect(res.body.cart!.items[0]).not.toHaveProperty(
        'previous_unit_price_ars_cents',
      );
    });

    it('la respuesta del carrito no se puede cachear (sin esto, AC-9 se cae en el edge)', async () => {
      const c = cliente();
      await c.put('taco-fischer', { quantity: 1 });

      const res = await c.get();

      expect(res.headers['cache-control']).toBe('no-store');
    });
  });

  describe('AC-10 — no se agregan productos no publicados', () => {
    const sinInstance = (body: Record<string, unknown>) => {
      const { instance, ...resto } = body;
      expect(instance).toBeDefined();
      return resto;
    };

    it('draft, archived e inexistente devuelven respuestas idénticas salvo `instance`', async () => {
      // Si se distinguieran, el carrito sería un oráculo de enumeración del
      // catálogo oculto — la misma disciplina que US-003 fijó para la ficha.
      const borrador = await cliente().put('producto-borrador', { quantity: 1 });
      const archivado = await cliente().put('producto-archivado', { quantity: 1 });
      const inventado = await cliente().put('no-existe-jamas', { quantity: 1 });

      for (const res of [borrador, archivado, inventado]) {
        expect(res.status).toBe(404);
        expect(res.body.type).toBe('dsm:catalog/not-found');
      }
      expect(sinInstance(borrador.body)).toEqual(sinInstance(archivado.body));
      expect(sinInstance(archivado.body)).toEqual(sinInstance(inventado.body));
    });

    it('ninguno crea línea ni carrito', async () => {
      for (const slug of [
        'producto-borrador',
        'producto-archivado',
        'no-existe-jamas',
      ]) {
        await cliente().put(slug, { quantity: 1 });
      }

      expect(await prisma.cartItem.count()).toBe(0);
      expect(await prisma.cart.count()).toBe(0);
    });

    it('tampoco se cuelan en un carrito que ya existe', async () => {
      const c = cliente();
      await c.put('taco-fischer', { quantity: 1 });

      const res = await c.put('producto-borrador', { quantity: 1 });

      expect(res.status).toBe(404);
      expect((await c.get()).body.cart!.items.map((i) => i.slug)).toEqual([
        'taco-fischer',
      ]);
    });
  });
});
