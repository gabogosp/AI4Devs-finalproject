import { INestApplication, Logger } from '@nestjs/common';
import { bootTestApp } from '../../test/e2e-app';
import {
  ClienteDeCarrito,
  sembrarProductos,
  truncarCarrito,
} from '../../test/cart-client';
import { PrismaService } from '../prisma/prisma.service';
import { CartEventsService } from '../observability/cart-events.service';
import { CartModule } from './cart.module';

/**
 * T5.1 — los 6 eventos de negocio del carrito (US §9, E2E §18), verificados sobre
 * el recorrido HTTP real.
 *
 * Además del conteo, este spec ancla la regla que importa de seguridad: el
 * **volcado completo** de logs de la corrida no contiene el token del carrito, ni
 * en claro ni hasheado. El token es la credencial de acceso al carrito; un log con
 * el token es un log con la sesión de compra de la persona.
 */
describe('Eventos de negocio del carrito (e2e-cart-events)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let events: CartEventsService;
  let ids: Record<string, string>;
  /** Volcado de TODO lo que se logueó durante el test. */
  let logs: unknown[];
  let spyLog: jest.SpyInstance;

  beforeAll(async () => {
    process.env.TRUST_PROXY_HOPS = '1';
    app = await bootTestApp([CartModule]);
    prisma = app.get(PrismaService);
    events = app.get(CartEventsService);
  });
  afterAll(async () => {
    await app?.close();
    delete process.env.TRUST_PROXY_HOPS;
  });
  beforeEach(async () => {
    await truncarCarrito(prisma);
    ids = await sembrarProductos(prisma, [
      { slug: 'taco-fischer', price: 320_000, stock: 10 },
      { slug: 'mecha-widia', price: 540_000, stock: 2 },
    ]);
    events.reset();
    logs = [];
    spyLog = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation((...args: unknown[]) => {
        logs.push(...args);
      });
  });
  afterEach(() => {
    spyLog.mockRestore();
  });

  const cliente = () => new ClienteDeCarrito(app);
  const volcado = () => JSON.stringify(logs);

  it('el ciclo agregar → cambiar cantidad → leer → quitar produce los contadores esperados', async () => {
    const c = cliente();

    await c.put('taco-fischer', { quantity: 1 }); // alta de línea
    await c.put('taco-fischer', { quantity: 3 }); // línea existente
    await c.get(); // carrito no vacío
    await c.del('taco-fischer');

    expect(events.count('cart.item_added')).toBe(1);
    expect(events.count('cart.item_quantity_changed')).toBe(1);
    expect(events.count('cart.viewed')).toBe(1);
    expect(events.count('cart.item_removed')).toBe(1);
  });

  it('un PUT por encima del stock emite cart.stock_limit_rejected (señal de reposición)', async () => {
    const res = await cliente().put('mecha-widia', { quantity: 5 });

    expect(res.status).toBe(409);
    expect(events.count('cart.stock_limit_rejected')).toBe(1);
    // No hubo línea: tampoco eventos de línea.
    expect(events.count('cart.item_added')).toBe(0);
  });

  it('una lectura con producto archivado emite cart.item_unavailable (AC-6)', async () => {
    const c = cliente();
    await c.put('taco-fischer', { quantity: 1 });
    await prisma.product.update({
      where: { id: ids['taco-fischer'] },
      data: { status: 'archived' },
    });

    await c.get();

    expect(events.count('cart.item_unavailable')).toBe(1);
  });

  it('el carrito vacío NO emite cart.viewed', async () => {
    // Si lo emitiera, la métrica de conversión contaría visitas sin carrito y
    // dejaría de significar nada.
    await cliente().get();

    expect(events.count('cart.viewed')).toBe(0);
  });

  it('un 404 de producto no emite ningún evento de línea', async () => {
    const res = await cliente().put('no-existe', { quantity: 1 });

    expect(res.status).toBe(404);
    expect(events.count('cart.item_added')).toBe(0);
    expect(events.count('cart.stock_limit_rejected')).toBe(0);
  });

  it('quitar algo que no está no emite cart.item_removed', async () => {
    const c = cliente();
    await c.put('taco-fischer', { quantity: 1 });
    events.reset();

    await c.del('mecha-widia');

    expect(events.count('cart.item_removed')).toBe(0);
  });

  describe('reglas de contenido de los logs', () => {
    it('el token del carrito NO aparece en el volcado, ni en claro ni hasheado', async () => {
      const { createHash } = await import('node:crypto');
      const c = cliente();
      await c.put('taco-fischer', { quantity: 2 });
      await c.get();
      await c.del('taco-fischer');

      const token = c.cookie('dsm_cart');
      expect(token).toBeTruthy();
      const hash = createHash('sha256').update(token!, 'utf8').digest('hex');

      expect(volcado()).not.toContain(token!);
      expect(volcado()).not.toContain(hash);
      // El valor CSRF se deriva del token: tampoco puede aparecer.
      expect(volcado()).not.toContain(c.cookie('dsm_cart_csrf')!);
    });

    it('el cart_id va al LOG y el entity_id de una línea es el product_id', async () => {
      const c = cliente();
      const res = await c.put('taco-fischer', { quantity: 1 });
      const cartId = res.body.cart!.id!;

      const evento = logs.find(
        (l) =>
          typeof l === 'object' &&
          l !== null &&
          (l as { event?: string }).event === 'cart.item_added',
      ) as { entity_id?: string; cart_id?: string } | undefined;

      expect(evento?.cart_id).toBe(cartId);
      expect(evento?.entity_id).toBe(ids['taco-fischer']);
    });

    it('el contador NO se dimensiona por carrito (cardinalidad §3.3)', async () => {
      // Dos carritos distintos suman al MISMO contador: si el `cart_id` fuera una
      // dimensión de la métrica, cada carrito abriría su propia serie temporal y
      // con miles de carritos eso tumba el backend de métricas.
      const a = cliente();
      const b = cliente();
      await a.put('taco-fischer', { quantity: 1 });
      await b.put('taco-fischer', { quantity: 1 });

      expect(events.count('cart.item_added')).toBe(2);
    });

    it('no hay PII de comprador en los logs (en esta US no existe todavía)', async () => {
      const c = cliente();
      await c.put('taco-fischer', { quantity: 1 });
      await c.get();

      for (const clave of ['email', 'phone', 'buyer', 'password']) {
        expect(volcado()).not.toContain(clave);
      }
    });
  });
});
