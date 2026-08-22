import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getOptionsToken } from '@nestjs/throttler';
import { AppConfigModule } from '../config/config.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CatalogEventsModule } from '../observability/catalog-events.module';
import { configureApp } from '../bootstrap';
import { PrismaService } from '../prisma/prisma.service';
import {
  ClienteDeCarrito,
  sembrarProductos,
  truncarCarrito,
} from '../../test/cart-client';
import { CartModule } from './cart.module';

/**
 * T4.3 — presupuestos del carrito (§7.3) y contrato de cabeceras (§12).
 *
 * Lo que importa acá son dos cosas: que la **escritura sea más estricta** que la
 * lectura (es la que crea filas) y que el 429 traiga los cuatro headers dentro del
 * envelope `problem+json`. Sin `Retry-After` un cliente reintenta a ciegas y el
 * rate-limit se convierte en un generador de tráfico.
 *
 * El límite de escritura se baja con `@Throttle` sobre el throttler `cart`, así que
 * el override de opciones fija el de lectura y el decorador el de escritura.
 */
describe('Rate limit del carrito (e2e-cart-ratelimit)', () => {
  // El límite de escritura sale del `@Throttle` del controller, que lo lee de env
  // al definir la clase; se fija antes de importar/instanciar la app.
  const LIMITE_LECTURA = 6;
  const LIMITE_ESCRITURA = Number(process.env.CART_WRITE_RATE_LIMIT_MAX ?? 30);
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.TRUST_PROXY_HOPS = '1';
    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, PrismaModule, CatalogEventsModule, CartModule],
    })
      .overrideProvider(getOptionsToken())
      .useValue({
        throttlers: [{ name: 'cart', ttl: 60_000, limit: LIMITE_LECTURA }],
      })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app?.close();
    delete process.env.TRUST_PROXY_HOPS;
  });
  beforeEach(async () => {
    await truncarCarrito(prisma);
    await sembrarProductos(prisma, [{ slug: 'taco-fischer', price: 320_000 }]);
  });

  it('la escritura es MÁS estricta que la lectura', async () => {
    // Con el default de env (30 escrituras / 120 lecturas) el techo de escritura
    // es el que corta primero.
    expect(LIMITE_ESCRITURA).toBeLessThan(120);
  });

  it('al exceder el presupuesto de lectura devuelve 429 problem+json con los 4 headers', async () => {
    const c = new ClienteDeCarrito(app);
    for (let i = 0; i < LIMITE_LECTURA; i += 1) {
      expect((await c.get()).status).toBe(200);
    }

    const excedido = await c.get();

    expect(excedido.status).toBe(429);
    expect(excedido.headers['content-type']).toContain('application/problem+json');
    expect(excedido.body.type).toBe('dsm:catalog/http-429');
    expect(excedido.headers['retry-after']).toBeDefined();
    expect(excedido.headers['ratelimit-limit']).toBeDefined();
    expect(excedido.headers['ratelimit-remaining']).toBe('0');
    expect(excedido.headers['ratelimit-reset']).toBeDefined();
  });

  it('el presupuesto se cuenta por IP: otra IP arranca con el suyo intacto', async () => {
    const a = new ClienteDeCarrito(app);
    for (let i = 0; i < LIMITE_LECTURA; i += 1) await a.get();
    expect((await a.get()).status).toBe(429);

    const b = new ClienteDeCarrito(app);
    expect((await b.get()).status).toBe(200);
  });

  it('agotado el presupuesto de lectura, la ESCRITURA sigue disponible (bucket propio por handler)', async () => {
    // `@nestjs/throttler` cuenta por (throttler, IP, handler), así que cada
    // endpoint tiene su presupuesto: es exactamente lo que pide §7.3 —
    // «presupuesto por endpoint en superficies públicas de escritura».
    const c = new ClienteDeCarrito(app);
    for (let i = 0; i < LIMITE_LECTURA; i += 1) await c.get();
    expect((await c.get()).status).toBe(429);

    const escritura = await c.put('taco-fischer', { quantity: 1 });

    expect(escritura.status).toBe(200);
  });

  it('N escrituras agotan el presupuesto de escritura y el GET sigue en 200', async () => {
    const c = new ClienteDeCarrito(app);
    for (let i = 0; i < LIMITE_ESCRITURA; i += 1) {
      expect((await c.put('taco-fischer', { quantity: 1 })).status).toBe(200);
    }

    const excedida = await c.put('taco-fischer', { quantity: 1 });

    expect(excedida.status).toBe(429);
    expect(excedida.headers['content-type']).toContain('application/problem+json');
    expect(excedida.headers['retry-after']).toBeDefined();
    expect(excedida.headers['ratelimit-limit']).toBe(String(LIMITE_ESCRITURA));
    expect(excedida.headers['ratelimit-remaining']).toBe('0');
    expect(excedida.headers['ratelimit-reset']).toBeDefined();
    // La lectura del carrito no se vio afectada: su presupuesto es otro.
    expect((await c.get()).status).toBe(200);
  });
});
