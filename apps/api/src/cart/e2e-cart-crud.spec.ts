import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bootTestApp } from '../../test/e2e-app';
import {
  ClienteDeCarrito,
  sembrarProductos,
  truncarCarrito,
} from '../../test/cart-client';
import { PrismaService } from '../prisma/prisma.service';
import { CartModule } from './cart.module';

/**
 * T4.2 — las tres rutas de la superficie del carrito existen y el ciclo completo
 * cierra. T6.1 extiende este archivo con los AC-1/AC-2/AC-3 en detalle.
 */
describe('Carrito CRUD (e2e-cart-crud)', () => {
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
      { slug: 'mecha-widia', price: 540_000, stock: 4 },
    ]);
  });

  const cliente = () => new ClienteDeCarrito(app);

  describe('las tres rutas responden (T4.2)', () => {
    it('GET /v1/cart → 200', async () => {
      const res = await cliente().get();
      expect(res.status).toBe(200);
    });

    it('PUT /v1/cart/items/{slug} → 200', async () => {
      const res = await cliente().put('taco-fischer', { quantity: 1 });
      expect(res.status).toBe(200);
    });

    it('DELETE /v1/cart/items/{slug} → 200', async () => {
      const c = cliente();
      await c.put('taco-fischer', { quantity: 1 });
      const res = await c.del('taco-fischer');
      expect(res.status).toBe(200);
    });

    it('no existe una ruta con id de carrito (la identidad es la cookie)', async () => {
      const res = await request(app.getHttpServer()).get('/v1/cart/algun-id');
      expect(res.status).toBe(404);
    });
  });

  describe('el ciclo PUT → GET → DELETE → GET deja el carrito vacío', () => {
    it('cierra el ciclo completo', async () => {
      const c = cliente();

      const puesto = await c.put('taco-fischer', { quantity: 2 });
      expect(puesto.status).toBe(200);
      expect(puesto.body.cart!.item_count).toBe(1);

      const leido = await c.get();
      expect(leido.body.cart!.items[0].slug).toBe('taco-fischer');
      expect(leido.body.cart!.items[0].quantity).toBe(2);

      const borrado = await c.del('taco-fischer');
      expect(borrado.body.cart!.items).toEqual([]);

      const final = await c.get();
      expect(final.body.cart!.items).toEqual([]);
      expect(final.body.cart!.total_ars_cents).toBe(0);
      expect(final.body.cart!.item_count).toBe(0);
    });

    it('el carrito sobrevive entre requests del mismo cliente', async () => {
      const c = cliente();
      await c.put('taco-fischer', { quantity: 1 });
      await c.put('mecha-widia', { quantity: 1 });

      const res = await c.get();

      expect(res.body.cart!.item_count).toBe(2);
      expect(res.body.cart!.id).toBeTruthy();
    });
  });

  describe('AC-1 — agregar un producto al carrito', () => {
    it('devuelve la línea con cantidad, precio unitario vigente y subtotal, y el total actualizado', async () => {
      const res = await cliente().put('taco-fischer', { quantity: 2 });

      expect(res.status).toBe(200);
      const carrito = res.body.cart!;
      expect(carrito.items).toHaveLength(1);
      expect(carrito.items[0]).toMatchObject({
        slug: 'taco-fischer',
        quantity: 2,
        unit_price_ars_cents: 320_000,
        currency: 'ARS',
        subtotal_ars_cents: 640_000,
        availability: 'available',
      });
      expect(carrito.total_ars_cents).toBe(640_000);
      expect(carrito.total_quantity).toBe(2);
      expect(carrito.item_count).toBe(1);
      expect(carrito.has_blocking_issues).toBe(false);
    });

    it('con dos productos, el total es EXACTAMENTE la suma de los dos subtotales', async () => {
      const c = cliente();
      await c.put('taco-fischer', { quantity: 2 }); // 640.000
      const res = await c.put('mecha-widia', { quantity: 3 }); // 1.620.000

      const carrito = res.body.cart!;
      const subtotales = carrito.items.map((i) => i.subtotal_ars_cents);
      expect(subtotales.sort()).toEqual([640_000, 1_620_000].sort());
      expect(carrito.total_ars_cents).toBe(2_260_000);
      expect(carrito.item_count).toBe(2);
      expect(carrito.total_quantity).toBe(5);
    });
  });

  describe('AC-2 — editar la cantidad', () => {
    it('un segundo PUT deja UNA línea con la cantidad nueva y recalcula subtotal y total', async () => {
      const c = cliente();
      await c.put('taco-fischer', { quantity: 2 });

      const res = await c.put('taco-fischer', { quantity: 5 });

      const carrito = res.body.cart!;
      expect(carrito.items).toHaveLength(1); // no se duplicó la línea
      expect(carrito.items[0].quantity).toBe(5);
      expect(carrito.items[0].subtotal_ars_cents).toBe(1_600_000);
      expect(carrito.total_ars_cents).toBe(1_600_000);
    });

    it('la cantidad es ABSOLUTA: repetir el mismo PUT no acumula (idempotencia §10.5)', async () => {
      const c = cliente();
      await c.put('taco-fischer', { quantity: 3 });

      const res = await c.put('taco-fischer', { quantity: 3 });

      expect(res.body.cart!.items[0].quantity).toBe(3);
      expect(res.body.cart!.total_quantity).toBe(3);
    });

    it('bajar la cantidad también recalcula', async () => {
      const c = cliente();
      await c.put('taco-fischer', { quantity: 5 });

      const res = await c.put('taco-fischer', { quantity: 1 });

      expect(res.body.cart!.items[0].quantity).toBe(1);
      expect(res.body.cart!.total_ars_cents).toBe(320_000);
    });
  });

  describe('AC-3 — quitar un producto', () => {
    it('el producto desaparece y el total refleja lo que queda', async () => {
      const c = cliente();
      await c.put('taco-fischer', { quantity: 2 }); // 640.000
      await c.put('mecha-widia', { quantity: 1 }); // 540.000

      const res = await c.del('taco-fischer');

      const carrito = res.body.cart!;
      expect(carrito.items.map((i) => i.slug)).toEqual(['mecha-widia']);
      expect(carrito.total_ars_cents).toBe(540_000);
      expect(carrito.item_count).toBe(1);
    });

    it('un DELETE repetido devuelve el mismo carrito sin error (idempotente)', async () => {
      const c = cliente();
      await c.put('taco-fischer', { quantity: 1 });
      await c.put('mecha-widia', { quantity: 1 });

      const primero = await c.del('taco-fischer');
      const segundo = await c.del('taco-fischer');

      expect(segundo.status).toBe(200);
      expect(segundo.body.cart).toEqual(primero.body.cart);
    });

    it('quitar lo último deja el carrito vacío pero existente', async () => {
      const c = cliente();
      await c.put('taco-fischer', { quantity: 1 });

      const res = await c.del('taco-fischer');

      expect(res.body.cart!.items).toEqual([]);
      expect(res.body.cart!.id).toBeTruthy(); // el carrito sigue siendo el mismo
      expect(res.body.cart!.total_ars_cents).toBe(0);
    });
  });
});
