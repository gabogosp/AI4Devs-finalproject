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
});
