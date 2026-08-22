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
 * T6.3 — límite de stock (AC-5) y **no-reserva** (AC-8, ADR-0008).
 *
 * AC-8 se verifica como **invariante**, no como declaración: se lee
 * `products.stock` antes y después del ciclo completo y tiene que ser idéntico. La
 * consecuencia que ADR-0008 aceptó a conciencia —dos clientes pueden tener las
 * mismas últimas unidades en su carrito— se prueba explícitamente, porque es un
 * comportamiento correcto y no un bug: el stock se decrementa al aprobarse el pago
 * (US-010), y ahí el `UPDATE` condicional impide el oversell.
 */
describe('Stock del carrito (e2e-cart-stock)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ids: Record<string, string>;

  const stockDe = async (slug: string): Promise<number> =>
    (await prisma.product.findFirst({ where: { slug } }))!.stock;

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
      { slug: 'taco-fischer', price: 320_000, stock: 3 },
      { slug: 'sin-stock', price: 100_000, stock: 0 },
    ]);
  });

  const cliente = () => new ClienteDeCarrito(app);

  describe('AC-5 — la cantidad no puede superar el stock', () => {
    it('con stock 3, pedir 4 devuelve 409 dsm:cart/insufficient-stock con available_quantity 3', async () => {
      const res = await cliente().put('taco-fischer', { quantity: 4 });

      expect(res.status).toBe(409);
      expect(res.body.type).toBe('dsm:cart/insufficient-stock');
      expect(res.body.available_quantity).toBe(3);
      // Campo de primer nivel, no una frase dentro del detail.
      expect(typeof res.body.available_quantity).toBe('number');
    });

    it('el rechazo NO crea la línea ni el carrito', async () => {
      await cliente().put('taco-fischer', { quantity: 4 });

      expect(await prisma.cartItem.count()).toBe(0);
      expect(await prisma.cart.count()).toBe(0);
    });

    it('pedir exactamente el stock disponible pasa', async () => {
      const res = await cliente().put('taco-fischer', { quantity: 3 });

      expect(res.status).toBe(200);
      expect(res.body.cart!.items[0].quantity).toBe(3);
      expect(res.body.cart!.items[0].availability).toBe('available');
    });

    it('un producto sin stock rechaza cualquier cantidad, con available_quantity 0', async () => {
      const res = await cliente().put('sin-stock', { quantity: 1 });

      expect(res.status).toBe(409);
      expect(res.body.available_quantity).toBe(0);
    });

    it('subir la cantidad por encima del stock rechaza y deja la línea como estaba', async () => {
      const c = cliente();
      await c.put('taco-fischer', { quantity: 2 });

      const res = await c.put('taco-fischer', { quantity: 9 });

      expect(res.status).toBe(409);
      const leido = await c.get();
      expect(leido.body.cart!.items[0].quantity).toBe(2);
    });
  });

  describe('AC-8 — el carrito NO reserva ni descuenta stock (ADR-0008)', () => {
    it('el stock es IDÉNTICO antes y después del ciclo completo', async () => {
      const antes = await stockDe('taco-fischer');
      const c = cliente();

      await c.put('taco-fischer', { quantity: 3 }); // agregar
      expect(await stockDe('taco-fischer')).toBe(antes);
      await c.get(); // leer
      expect(await stockDe('taco-fischer')).toBe(antes);
      await c.put('taco-fischer', { quantity: 1 }); // cambiar cantidad
      expect(await stockDe('taco-fischer')).toBe(antes);
      await c.get();
      expect(await stockDe('taco-fischer')).toBe(antes);
      await c.del('taco-fischer'); // quitar
      expect(await stockDe('taco-fischer')).toBe(antes);

      expect(await stockDe('taco-fischer')).toBe(3);
    });

    it('DOS carritos distintos pueden tener las 3 unidades cada uno, sin fallar ni mover el stock', async () => {
      // Es exactamente la consecuencia que ADR-0008 acepta: no hay reserva, así que
      // el «sell-out durante el pago» sigue siendo posible y se resuelve en US-010
      // con el UPDATE condicional. Reservar acá habría exigido TTL y expiración.
      const a = await cliente().put('taco-fischer', { quantity: 3 });
      const b = await cliente().put('taco-fischer', { quantity: 3 });

      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      expect(a.body.cart!.id).not.toBe(b.body.cart!.id);
      expect(await stockDe('taco-fischer')).toBe(3);
    });

    it('el rechazo por stock tampoco toca el inventario', async () => {
      const antes = await stockDe('taco-fischer');

      await cliente().put('taco-fischer', { quantity: 99 });

      expect(await stockDe('taco-fischer')).toBe(antes);
    });

    it('ninguna operación del carrito escribe la tabla products', async () => {
      const productoAntes = await prisma.product.findUnique({
        where: { id: ids['taco-fischer'] },
      });

      const c = cliente();
      await c.put('taco-fischer', { quantity: 2 });
      await c.get();
      await c.del('taco-fischer');

      const productoDespues = await prisma.product.findUnique({
        where: { id: ids['taco-fischer'] },
      });
      // `updated_at` es la prueba: si el carrito hubiera escrito el producto (por
      // reserva, por decremento o por un `update` de paso), habría cambiado.
      expect(productoDespues).toEqual(productoAntes);
    });
  });
});
