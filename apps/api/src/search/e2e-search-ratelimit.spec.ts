import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

/**
 * T3.3 — el presupuesto de `/v1/search` (e2e-search-ratelimit, AC-10).
 *
 * Vive en su propio archivo porque el `@Throttle` del controller lee el tope de `process.env`
 * **al cargar la clase**, así que bajarlo requiere setear la variable antes del primer `import`
 * del módulo: acá se carga con `await import()` dentro del `beforeAll` y los imports estáticos
 * son sólo de tipos.
 *
 * Lo que se protege: es la única superficie **pública** del sistema donde un request de más
 * puede costar **plata en un tercero**. Y el segundo test es tanto o más importante que el
 * primero: agotar el cubo de la búsqueda **no puede** dejar a un cliente sin poder navegar el
 * catálogo, ver su carrito ni entrar a su cuenta.
 */
describe('GET /v1/search — rate limit (e2e-search-ratelimit)', () => {
  const LIMITE = 3;
  let app: INestApplication;

  beforeAll(async () => {
    process.env.SEARCH_RATE_LIMIT_MAX = String(LIMITE);
    process.env.SEARCH_RATE_LIMIT_TTL_MS = '60000';
    // Sin esto Express ignora `X-Forwarded-For` y todos los tests comparten el cubo de
    // 127.0.0.1. En producción el default es 0 a propósito: confiar de más deja falsificar la
    // IP y evadir el límite por completo.
    process.env.TRUST_PROXY_HOPS = '1';
    // Sin cuota para la búsqueda: el proveedor no se toca y las respuestas salen por full-text.
    // Lo que se mide es el borde, no el ranking.
    process.env.GEMINI_SEARCH_MAX_RPM = '0';

    const [
      { AppConfigModule },
      { PrismaModule },
      { CatalogEventsModule },
      { configureApp },
      { SearchModule },
      { StorefrontModule },
      { CartModule },
    ] = await Promise.all([
      import('../config/config.module'),
      import('../prisma/prisma.module'),
      import('../observability/catalog-events.module'),
      import('../bootstrap'),
      import('./search.module'),
      import('../storefront/storefront.module'),
      import('../cart/cart.module'),
    ]);

    const moduleRef = await Test.createTestingModule({
      imports: [
        AppConfigModule,
        PrismaModule,
        CatalogEventsModule,
        SearchModule,
        // Las otras dos superficies públicas viajan en la misma app: es lo que permite probar
        // que el cubo de la búsqueda no se derrama sobre ellas.
        StorefrontModule,
        CartModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.SEARCH_RATE_LIMIT_MAX;
    delete process.env.SEARCH_RATE_LIMIT_TTL_MS;
    delete process.env.TRUST_PROXY_HOPS;
    delete process.env.GEMINI_SEARCH_MAX_RPM;
  });

  const buscar = (ip: string) =>
    request(app.getHttpServer())
      .get('/v1/search?q=taco fischer')
      .set('X-Forwarded-For', ip);

  it('la petición N+1 devuelve 429 con Retry-After y las tres RateLimit-*', async () => {
    const ip = '10.40.0.1';

    for (let i = 0; i < LIMITE; i += 1) {
      expect((await buscar(ip)).status).toBe(200);
    }

    const excedido = await buscar(ip);

    expect(excedido.status).toBe(429);
    expect(excedido.headers['content-type']).toContain('application/problem+json');
    expect(Number(excedido.headers['retry-after'])).toBeGreaterThan(0);
    expect(excedido.headers['ratelimit-limit']).toBe(String(LIMITE));
    expect(excedido.headers['ratelimit-remaining']).toBe('0');
    expect(excedido.headers['ratelimit-reset']).toBeDefined();
    // Un 429 cacheado en el edge convierte el rate-limit en un DoS.
    expect(excedido.headers['cache-control']).toContain('no-store');
  });

  it('AGOTAR LA BÚSQUEDA NO BLOQUEA el catálogo ni el carrito', async () => {
    // El test que más importa de este archivo. Si los cubos se compartieran, un abusador de la
    // búsqueda dejaría a los clientes legítimos sin poder navegar ni comprar — convertiría un
    // control de costo en una vulnerabilidad de disponibilidad.
    const ip = '10.40.0.2';
    for (let i = 0; i <= LIMITE + 1; i += 1) await buscar(ip);
    expect((await buscar(ip)).status).toBe(429);

    const catalogo = await request(app.getHttpServer())
      .get('/v1/categories')
      .set('X-Forwarded-For', ip);
    const carrito = await request(app.getHttpServer())
      .get('/v1/cart')
      .set('X-Forwarded-For', ip);

    expect(catalogo.status).not.toBe(429);
    expect(carrito.status).not.toBe(429);
  });

  it('el cubo es por IP: otro cliente no hereda el bloqueo', async () => {
    const quemada = '10.40.0.3';
    for (let i = 0; i <= LIMITE + 1; i += 1) await buscar(quemada);
    expect((await buscar(quemada)).status).toBe(429);

    expect((await buscar('10.40.0.4')).status).toBe(200);
  });

  it('una consulta rechazada por validación TAMBIÉN consume presupuesto', async () => {
    // Deliberado: el throttler corre antes del `ValidationPipe`. Si los 422 no contaran, un
    // abusador podría sondear el endpoint gratis con consultas inválidas — y cada sondeo cuesta
    // CPU y una conexión igual.
    const ip = '10.40.0.5';

    for (let i = 0; i < LIMITE; i += 1) {
      expect((await request(app.getHttpServer())
        .get('/v1/search?q=a')
        .set('X-Forwarded-For', ip)).status).toBe(422);
    }

    const excedido = await buscar(ip);
    expect(excedido.status).toBe(429);
  });
});
