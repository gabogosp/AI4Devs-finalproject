import { INestApplication, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppConfigModule } from '../config/config.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CatalogEventsModule } from '../observability/catalog-events.module';
import { MetricsModule } from '../observability/metrics.module';
import { configureApp } from '../bootstrap';
import { nuevaIpDeTest } from '../../test/e2e-app';
import { asegurarCategoria, idDeCorrida } from '../../test/enrichment-fixtures';
import { FakeAiProvider } from '../../test/fake-ai.provider';
import { EnrichmentRepository } from '../enrichment/enrichment.repository';
import { MetricsService } from '../observability/metrics.service';
import { SearchEventsService } from '../observability/search-events.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiEmbedder } from '../ai/ports/ai.ports';
import { SEARCH_EMBEDDER } from './search-embedder.provider';
import { SearchModule } from './search.module';

/**
 * T4.2 — los 6 eventos, cada uno en su punto (e2e-search-observability).
 *
 * Se recorre la app real y se cuenta contra el registro de Prometheus, no contra un mapa
 * interno: si un evento se emitiera pero no llegara al registro, el operador no lo vería y este
 * test tampoco.
 *
 * Los dos últimos tests son de no-fuga: ni la clave del proveedor ni el vector completo pueden
 * aparecer en una línea de log. 768 floats en un log son inútiles, caros y —una vez que están—
 * imposibles de sacar de un agregador.
 */
describe('Observabilidad de la búsqueda (e2e-search-observability)', () => {
  const CANARIO = 'CLAVE-CANARIO-DE-BUSQUEDA-NO-DEBE-APARECER';
  const corrida = idDeCorrida();
  const CONSULTA = `amoladora angular ${corrida}`;

  let app: INestApplication;
  let prisma: PrismaService;
  let metrics: MetricsService;
  let events: SearchEventsService;
  let fake: FakeAiProvider;
  let logueado: string[] = [];
  const spies: jest.SpyInstance[] = [];

  /** Arranca la app con el embedder que el escenario necesita. */
  async function boot(embedder: AiEmbedder): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({
      // `MetricsModule` es @Global, pero igual tiene que entrar al grafo por algún import: en
      // la app lo hace AppModule. Sin él, `SearchEventsService` se construye con su
      // `@Optional()` en undefined y los contadores no llegan al registro.
      imports: [
        AppConfigModule,
        PrismaModule,
        CatalogEventsModule,
        MetricsModule,
        SearchModule,
      ],
    })
      .overrideProvider(SEARCH_EMBEDDER)
      .useValue(embedder)
      .compile();
    const nueva = moduleRef.createNestApplication();
    configureApp(nueva);
    await nueva.init();
    return nueva;
  }

  beforeAll(async () => {
    process.env.GEMINI_API_KEY = CANARIO;
    // Cada test habla desde su propia IP: el presupuesto de esta superficie es chico a propósito
    // (20/min) y el test del 429 lo agota, así que sin aislar el cubo los tests siguientes
    // cobran 429 en lugar de medir lo que miden.
    process.env.TRUST_PROXY_HOPS = '1';
    fake = new FakeAiProvider();
    app = await boot(fake);
    prisma = app.get(PrismaService);
    metrics = app.get(MetricsService);
    events = app.get(SearchEventsService);

    await prisma.$executeRawUnsafe(`DELETE FROM products WHERE slug LIKE 'obs-%'`);
    const categoryId = await asegurarCategoria(prisma, `obs-${corrida}`, `Obs ${corrida}`);
    const p = await prisma.product.create({
      data: {
        sku: `OBS-${corrida}`,
        slug: `obs-${corrida}`,
        name: 'Amoladora angular',
        price_ars_cents: 150_000,
        stock: 3,
        status: 'published',
        category_id: categoryId,
      },
    });
    await new EnrichmentRepository(
      prisma,
      app.get(ConfigService) as unknown as ConfigService,
    ).saveEmbedding(p.id, FakeAiProvider.vectorDe(CONSULTA), fake.modelVersion);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    delete process.env.GEMINI_API_KEY;
    delete process.env.TRUST_PROXY_HOPS;
  });

  let ip: string;
  beforeEach(() => {
    ip = nuevaIpDeTest();
    logueado = [];
    for (const nivel of ['log', 'warn', 'error', 'debug'] as const) {
      spies.push(
        jest.spyOn(Logger.prototype, nivel).mockImplementation((...args: unknown[]) => {
          logueado.push(args.map((a) => JSON.stringify(a) ?? String(a)).join(' '));
        }),
      );
    }
  });
  afterEach(() => {
    for (const s of spies.splice(0)) s.mockRestore();
  });

  const buscar = (q: string) =>
    request(app.getHttpServer())
      .get(`/v1/search?q=${encodeURIComponent(q)}`)
      .set('X-Forwarded-For', ip);

  it('search.performed se emite en toda búsqueda y llega al registro', async () => {
    const antes = await events.count('search.performed');

    await buscar(CONSULTA).expect(200);

    expect(await events.count('search.performed')).toBe(antes + 1);
    // Observable desde afuera, que es el punto de AUDIT-dsm-api-006.
    expect(await metrics.render()).toContain('dsm_search_events_total{event="search.performed"}');
  });

  it('search.cache_hit se emite en la segunda búsqueda igual', async () => {
    // Cada `cache_hit` es una llamada paga que NO se hizo: con el free tier es la métrica que
    // dice si el techo de RPM es tolerable.
    const consulta = `taco fischer ${corrida}`;
    await buscar(consulta).expect(200);
    const antes = await events.count('search.cache_hit');

    await buscar(consulta).expect(200);

    expect(await events.count('search.cache_hit')).toBe(antes + 1);
  });

  it('search.no_results se emite cuando no hay coincidencias (demanda no cubierta)', async () => {
    const antes = await events.count('search.no_results');

    // El fake da un vector determinista por texto; una consulta absurda cae lejos de todo.
    const res = await buscar(`zzz-inexistente-${corrida}`).expect(200);

    if (res.body.confidence === 'none') {
      expect(await events.count('search.no_results')).toBe(antes + 1);
    } else {
      // Si el kNN devolvió algo con score bajo, el evento correcto es el de baja confianza.
      expect(res.body.confidence).toBe('low');
      expect(await events.count('search.low_confidence')).toBeGreaterThan(0);
    }
  });

  it('search.degraded se emite cuando se cae a full-text', async () => {
    // App aparte con un embedder que no está disponible: es el escenario de AC-4.
    const sinProveedor: AiEmbedder = { available: false, modelVersion: 'x', embed: jest.fn() };
    const degradada = await boot(sinProveedor);
    const suEvents = degradada.get(SearchEventsService);
    try {
      const antes = await suEvents.count('search.degraded');

      const res = await request(degradada.getHttpServer())
        .get(`/v1/search?q=${encodeURIComponent(CONSULTA)}`)
        .set('X-Forwarded-For', ip)
        .expect(200);

      expect(res.body.degraded).toBe(true);
      expect(await suEvents.count('search.degraded')).toBe(antes + 1);
    } finally {
      await degradada.close();
    }
  });

  it('search.rate_limited se emite en el 429, que el handler nunca ve', async () => {
    // Se emite desde el guard porque es el único que sabe del 429: el handler no corre. En el
    // service, el evento del caso de abuso —el que interesa medir— no se emitiría nunca.
    const antes = await events.count('search.rate_limited');
    let vio429 = false;

    for (let i = 0; i < 40 && !vio429; i += 1) {
      const res = await buscar(`consulta ${corrida} ${i}`);
      if (res.status === 429) vio429 = true;
    }

    expect(vio429).toBe(true);
    expect(await events.count('search.rate_limited')).toBeGreaterThan(antes);
  });

  it('NINGUNA línea de log contiene la clave del proveedor', async () => {
    await buscar(CONSULTA).expect(200);

    const todo = logueado.join('\n');
    expect(todo.length).toBeGreaterThan(0); // el captor funciona
    expect(todo).not.toContain(CANARIO);
    expect(todo).not.toMatch(/AIza[0-9A-Za-z_-]{10,}/);
  });

  it('NINGUNA línea de log contiene el vector', async () => {
    // 768 floats en un log son inútiles para diagnosticar, caros de almacenar y —una vez que
    // están— imposibles de sacar de un agregador.
    await buscar(CONSULTA).expect(200);

    const todo = logueado.join('\n');
    expect(todo).not.toMatch(/\[-?\d+\.\d+,\s*-?\d+\.\d+,\s*-?\d+\.\d+/);
    expect(todo).not.toContain('embedding');
  });
});
