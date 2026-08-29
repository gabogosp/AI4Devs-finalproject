import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppConfigModule } from '../config/config.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CatalogEventsModule } from '../observability/catalog-events.module';
import { MetricsModule } from '../observability/metrics.module';
import { configureApp } from '../bootstrap';
import { nuevaIpDeTest } from '../../test/e2e-app';
import { asegurarCategoria, idDeCorrida } from '../../test/enrichment-fixtures';
import { AiEmbedder } from '../ai/ports/ai.ports';
import { PrismaService } from '../prisma/prisma.service';
import { SEARCH_EMBEDDER } from './search-embedder.provider';
import { SearchModule } from './search.module';

/**
 * T5.4 — AC-4 y AC-5 de punta a punta (ac4-ac5-degradation).
 *
 * Los dos modos de fallo de un tercero se prueban por separado porque **fallan distinto**: uno
 * lanza rápido y el otro **no contesta nunca**. El segundo es el peligroso: sin un presupuesto que
 * lo abandone, la búsqueda quedaría esperando a Gemini con el cliente mirando un spinner, y el
 * request colgado ocuparía una conexión hasta el timeout del proxy.
 *
 * Por eso el test **mide el tiempo**: no alcanza con que la respuesta sea correcta, tiene que
 * llegar dentro del presupuesto del PRD §4 (p95 < 1,5 s).
 */
describe('AC-4 + AC-5 — degradación por default (ac4-ac5-degradation)', () => {
  const corrida = idDeCorrida();
  const CONSULTA = `amoladora angular ${corrida}`;

  /** Arranca la app con el embedder roto que el escenario necesita. */
  async function bootCon(embedder: AiEmbedder): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({
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
    const app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    return app;
  }

  /** Siembra un producto que el FULL-TEXT puede encontrar (no tiene vector, y no hace falta). */
  async function sembrar(prisma: PrismaService): Promise<void> {
    await prisma.$executeRawUnsafe(`DELETE FROM products WHERE slug LIKE 'deg-%'`);
    const categoryId = await asegurarCategoria(prisma, `deg-${corrida}`, `Deg ${corrida}`);
    await prisma.product.create({
      data: {
        sku: `DEG${corrida.toUpperCase()}`,
        slug: `deg-${corrida}`,
        name: `Amoladora angular ${corrida}`,
        price_ars_cents: 150_000,
        stock: 3,
        status: 'published',
        category_id: categoryId,
      },
    });
  }

  beforeAll(() => {
    process.env.TRUST_PROXY_HOPS = '1';
  });
  afterAll(() => {
    delete process.env.TRUST_PROXY_HOPS;
  });

  it('AC-4: proveedor que LANZA ⇒ 200 degradado con resultados del full-text', async () => {
    const roto: AiEmbedder = {
      available: true,
      modelVersion: 'x',
      embed: async () => {
        throw new Error('el proveedor respondió 500');
      },
    };
    const app = await bootCon(roto);
    try {
      await sembrar(app.get(PrismaService));

      const res = await request(app.getHttpServer())
        .get(`/v1/search?q=${encodeURIComponent(CONSULTA)}`)
        .set('X-Forwarded-For', nuevaIpDeTest())
        .expect(200);

      expect(res.body.degraded).toBe(true);
      // Con resultados de verdad: degradar no puede significar «devolver vacío».
      expect(res.body.results.length).toBeGreaterThan(0);
      expect(res.body.results.map((r: { slug: string }) => r.slug)).toContain(
        `deg-${corrida}`,
      );
    } finally {
      await app.close();
    }
  }, 30_000);

  it('AC-4: proveedor COLGADO ⇒ 200 degradado, y en MENOS de 1,5 s (PRD §4)', async () => {
    // El modo de fallo peligroso: no contesta nunca. Sin presupuesto, el cliente esperaría
    // indefinidamente. El tiempo se MIDE, no se razona.
    const colgado: AiEmbedder = {
      available: true,
      modelVersion: 'x',
      embed: () => new Promise<number[]>(() => undefined),
    };
    const app = await bootCon(colgado);
    try {
      await sembrar(app.get(PrismaService));

      const antes = Date.now();
      const res = await request(app.getHttpServer())
        .get(`/v1/search?q=${encodeURIComponent(CONSULTA)}`)
        .set('X-Forwarded-For', nuevaIpDeTest())
        .expect(200);
      const demora = Date.now() - antes;

      expect(res.body.degraded).toBe(true);
      expect(res.body.results.length).toBeGreaterThan(0);
      // El presupuesto del PRD, medido de punta a punta: 900 ms de timeout del embedding + el
      // full-text + la hidratación tienen que caber en 1,5 s.
      expect(demora).toBeLessThan(1_500);
      // Y no respondió antes de intentar: el timeout se respetó en vez de saltearse.
      expect(demora).toBeGreaterThanOrEqual(800);
    } finally {
      await app.close();
    }
  }, 30_000);

  it('AC-4: el 200 degradado conserva la MISMA forma que el no degradado', async () => {
    // Si la degradación cambiara la forma, el frontend tendría dos contratos que mantener y el
    // camino menos ejercitado sería el que se rompe.
    const roto: AiEmbedder = {
      available: false,
      modelVersion: 'x',
      embed: jest.fn(),
    };
    const app = await bootCon(roto);
    try {
      await sembrar(app.get(PrismaService));

      const res = await request(app.getHttpServer())
        .get(`/v1/search?q=${encodeURIComponent(CONSULTA)}`)
        .set('X-Forwarded-For', nuevaIpDeTest())
        .expect(200);

      expect(Object.keys(res.body).sort()).toEqual([
        'confidence',
        'degraded',
        'fallback',
        'interpreted_as',
        'results',
      ]);
    } finally {
      await app.close();
    }
  }, 30_000);

  it('AC-5: `?q=a` ⇒ 422 y el proveedor registra CERO llamadas', async () => {
    // La validación va antes del caché y del proveedor. Si se invirtiera el orden, cada tecleo
    // suelto de un cliente costaría una llamada paga.
    const espia = jest.fn();
    const observado: AiEmbedder = {
      available: true,
      modelVersion: 'x',
      embed: espia,
    };
    const app = await bootCon(observado);
    try {
      const res = await request(app.getHttpServer())
        .get('/v1/search?q=a')
        .set('X-Forwarded-For', nuevaIpDeTest());

      expect(res.status).toBe(422);
      expect(res.body.type).toBe('dsm:search/query-too-short');
      expect(espia).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  }, 30_000);

  it('AC-5: una consulta de sólo espacios tampoco llega al proveedor', async () => {
    const espia = jest.fn();
    const observado: AiEmbedder = { available: true, modelVersion: 'x', embed: espia };
    const app = await bootCon(observado);
    try {
      const res = await request(app.getHttpServer())
        .get('/v1/search?q=%20%20%20%20')
        .set('X-Forwarded-For', nuevaIpDeTest());

      expect(res.status).toBe(422);
      expect(espia).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  }, 30_000);
});
