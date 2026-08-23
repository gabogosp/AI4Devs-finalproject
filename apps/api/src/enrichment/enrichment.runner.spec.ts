import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { bootTestApp } from '../../test/e2e-app';
import { PrismaService } from '../prisma/prisma.service';
import { HealthModule } from '../health/health.module';
import { EnrichmentRepository } from './enrichment.repository';
import { EnrichmentService } from './enrichment.service';
import { EnrichmentRunner } from './enrichment.runner';
import { FakeAiProvider } from '../../test/fake-ai.provider';
import { AiTransientError } from '../common/errors/enrichment-errors';
import { DisabledAiProvider } from './ai/disabled-ai.provider';
import { AiEmbedder, AiEnricher } from '../ai/ports/ai.ports';
import { asegurarCategoria } from '../../test/enrichment-fixtures';

/**
 * T3.4 — el runner. Integración con el fake determinista: lo que se prueba es el
 * **comportamiento del ejecutor**, no la calidad del texto.
 *
 * Cuatro propiedades, y ninguna es cosmética: que procese todo en lotes, que no arranque dos
 * veces, que corte cuando el proveedor está caído (AC-4) y que **no bloquee el event loop**
 * — que es el costo declarado de correr in-process (ADR-0014) y el que hay que mantener bajo
 * control con evidencia.
 */
describe('EnrichmentRunner (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const corrida = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  let categoryId: string;
  let n = 0;

  beforeAll(async () => {
    app = await bootTestApp([HealthModule]);
    prisma = app.get(PrismaService);
    categoryId = await asegurarCategoria(prisma, `run-${corrida}`, `Runner ${corrida}`);
  });
  afterAll(async () => {
    await app?.close();
  });

  /**
   * Runner armado con la config pedida y el proveedor dado.
   *
   * ⚠ Los overrides van a **`process.env`**, no al objeto del `ConfigService`:
   * `ConfigService.get()` consulta `process.env` primero, y al arrancar la app Nest deja ahí
   * los 16 valores validados por `envSchema`. Un `new ConfigService({...})` con otros valores
   * se ignora en silencio — se descubrió porque dos tests de este archivo fallaron con la
   * config «puesta» y sin efecto. `restaurarEnv` los devuelve a su lugar en el `afterEach`.
   */
  const envOriginal: Record<string, string | undefined> = {};
  function ponerEnv(vars: Record<string, unknown>): void {
    for (const [k, v] of Object.entries(vars)) {
      if (!(k in envOriginal)) envOriginal[k] = process.env[k];
      process.env[k] = String(v);
    }
  }
  afterEach(() => {
    for (const [k, v] of Object.entries(envOriginal)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  function armar(
    env: Record<string, unknown>,
    proveedor: FakeAiProvider = new FakeAiProvider(),
  ) {
    ponerEnv({
      ENRICHMENT_MAX_ATTEMPTS: 5,
      ENRICHMENT_FAILURE_THRESHOLD: 5,
      ENRICHMENT_COOLDOWN_MS: 300_000,
      ENRICHMENT_ENABLED: 'true',
      ...env,
    });
    const config = new ConfigService({}) as ConfigService;
    const repo = new EnrichmentRepository(prisma, config);
    const service = new EnrichmentService(prisma, repo, config, proveedor, proveedor);
    return {
      runner: new EnrichmentRunner(repo, service, config, proveedor, proveedor),
      proveedor,
      repo,
    };
  }

  /** Siembra `cantidad` productos pendientes y devuelve sus ids. */
  async function sembrarPendientes(cantidad: number): Promise<string[]> {
    // El TRUNCATE de otra suite puede haberse llevado la categoría entre tests:
    // el upsert la recrea y cuesta una query por siembra.
    categoryId = await asegurarCategoria(prisma, `run-${corrida}`, `Runner ${corrida}`);
    const ids: string[] = [];
    for (let i = 0; i < cantidad; i += 1) {
      n += 1;
      const clave = `RUN-${corrida}-${n}`;
      const p = await prisma.product.create({
        data: {
          sku: clave,
          slug: clave.toLowerCase(),
          name: `Producto ${clave}`,
          price_ars_cents: 100_000,
          stock: 2,
          status: 'published',
          category_id: categoryId,
          description_raw: 'descripcion pobre',
        },
      });
      ids.push(p.id);
    }
    return ids;
  }

  /** Deja fuera de la cola todo lo que no sea de esta corrida, para poder contar lotes. */
  async function aislarCola(): Promise<void> {
    await prisma.$executeRawUnsafe(
      `UPDATE products SET enrichment_next_attempt_at = now() + interval '1 hour'
        WHERE enrichment_done = false AND sku NOT LIKE $1`,
      `RUN-${corrida}-%`,
    );
  }

  it('procesa todos los pendientes en lotes y termina idle', async () => {
    const ids = await sembrarPendientes(60);
    await aislarCola();
    const { runner, proveedor } = armar({ ENRICHMENT_BATCH_SIZE: 25 });

    const resultado = await runner.start();

    expect(resultado.processed).toBe(60);
    expect(runner.state).toBe('idle');
    // 60 productos ⇒ 60 llamadas al embedder: ni una de más (una por producto).
    expect(proveedor.embedCalls).toHaveLength(60);
    const hechos = await prisma.product.count({
      where: { id: { in: ids }, enrichment_done: true },
    });
    expect(hechos).toBe(60);
  });

  it('un segundo start() mientras corre devuelve already-running y NO duplica trabajo', async () => {
    // Sin esta guarda, dos disparos concurrentes gastarían el doble de cuota por el mismo
    // catálogo (el claim evita pisarse, pero no evita el gasto duplicado del segundo bucle).
    await sembrarPendientes(30);
    await aislarCola();
    const { runner, proveedor } = armar({ ENRICHMENT_BATCH_SIZE: 10 });

    const [primero, segundo] = await Promise.all([runner.start(), runner.start()]);

    const arrancoUno = [primero, segundo].filter((r) => r.status !== 'already-running');
    const rechazado = [primero, segundo].find((r) => r.status === 'already-running');
    expect(arrancoUno).toHaveLength(1);
    expect(rechazado).toBeDefined();
    expect(rechazado!.processed).toBe(0);
    expect(proveedor.embedCalls).toHaveLength(30); // 30, no 60
  });

  it('con ENRICHMENT_ENABLED=false el estado es disabled y no toca nada', async () => {
    const ids = await sembrarPendientes(3);
    const { runner, proveedor } = armar({ ENRICHMENT_ENABLED: 'false' });

    const resultado = await runner.start();

    expect(resultado.status).toBe('disabled');
    expect(runner.state).toBe('disabled');
    expect(proveedor.embedCalls).toHaveLength(0);
    expect(
      await prisma.product.count({ where: { id: { in: ids }, enrichment_done: true } }),
    ).toBe(0);
  });

  it('SIN PROVEEDOR (adapter deshabilitado) ⇒ disabled, y NO acumula fallos en el catálogo', async () => {
    // El hueco que este test cierra: el runner miraba sólo el flag, así que sin
    // `GEMINI_API_KEY` arrancaba, reclamaba productos y fallaba en cada uno contra el
    // `DisabledAiProvider`. Cada fallo deja rastro DURABLE —intentos, error_code, backoff— en
    // productos que no tienen nada de malo, y a los 5 quedan abandonados. Un entorno sin clave
    // habría marcado el catálogo entero como problemático.
    const ids = await sembrarPendientes(3);
    await aislarCola();
    const sinProveedor = new DisabledAiProvider();
    const config = new ConfigService({}) as ConfigService;
    ponerEnv({ ENRICHMENT_ENABLED: 'true' });
    const repo = new EnrichmentRepository(prisma, config);
    const service = new EnrichmentService(
      prisma,
      repo,
      config,
      sinProveedor as unknown as AiEnricher,
      sinProveedor as unknown as AiEmbedder,
    );
    const runner = new EnrichmentRunner(
      repo,
      service,
      config,
      sinProveedor as unknown as AiEnricher,
      sinProveedor as unknown as AiEmbedder,
    );

    const resultado = await runner.start();

    expect(resultado.status).toBe('disabled');
    const filas = await prisma.product.findMany({ where: { id: { in: ids } } });
    for (const f of filas) {
      expect(f.enrichment_attempts).toBe(0);
      expect(f.enrichment_error_code).toBeNull();
      expect(f.enrichment_next_attempt_at).toBeNull();
    }
  });

  it('tras 5 fallos consecutivos entra en cooldown y DEJA de llamar al proveedor (AC-4)', async () => {
    await sembrarPendientes(20);
    await aislarCola();
    const roto = new FakeAiProvider();
    jest
      .spyOn(roto, 'embed')
      .mockRejectedValue(new AiTransientError('el proveedor está caído'));
    const { runner } = armar({ ENRICHMENT_BATCH_SIZE: 20, ENRICHMENT_CONCURRENCY: 1 }, roto);

    await runner.start();

    expect(runner.state).toBe('cooldown');
    // Cortó al llegar al umbral: no intentó los 20.
    const intentos = (roto.embed as unknown as jest.Mock).mock.calls.length;
    expect(intentos).toBe(5);
  });

  it('durante el cooldown, start() no arranca ni llama al proveedor', async () => {
    await sembrarPendientes(5);
    await aislarCola();
    const roto = new FakeAiProvider();
    jest.spyOn(roto, 'embed').mockRejectedValue(new AiTransientError('caído'));
    const { runner } = armar(
      { ENRICHMENT_BATCH_SIZE: 5, ENRICHMENT_CONCURRENCY: 1, ENRICHMENT_FAILURE_THRESHOLD: 2 },
      roto,
    );
    await runner.start();
    expect(runner.state).toBe('cooldown');
    const llamadasTrasPrimeraCorrida = (roto.embed as unknown as jest.Mock).mock.calls
      .length;

    const segunda = await runner.start();

    expect(segunda.status).toBe('cooldown');
    expect(segunda.processed).toBe(0);
    expect((roto.embed as unknown as jest.Mock).mock.calls.length).toBe(
      llamadasTrasPrimeraCorrida,
    );
  });

  it('un éxito reinicia el contador de fallos consecutivos', async () => {
    // «Consecutivos» tiene que ser literal: si no se reiniciara, cinco fallos espaciados a
    // lo largo de un catálogo grande abrirían el breaker sin que el proveedor esté caído.
    await sembrarPendientes(4);
    await aislarCola();
    const intermitente = new FakeAiProvider();
    let llamada = 0;
    jest.spyOn(intermitente, 'embed').mockImplementation(async (text: string) => {
      llamada += 1;
      if (llamada % 2 === 1) throw new AiTransientError('intermitente');
      return FakeAiProvider.vectorDe(text);
    });
    const { runner } = armar(
      { ENRICHMENT_BATCH_SIZE: 4, ENRICHMENT_CONCURRENCY: 1, ENRICHMENT_FAILURE_THRESHOLD: 2 },
      intermitente,
    );

    await runner.start();

    expect(runner.state).not.toBe('cooldown');
  });

  it('NO bloquea el event loop: /health responde mientras corre (ADR-0014)', async () => {
    // Es el costo declarado de correr in-process. Se paga con cortesía —lotes con `await`
    // entre tramos— y se verifica, no se promete.
    await sembrarPendientes(200);
    await aislarCola();
    const { runner } = armar({ ENRICHMENT_BATCH_SIZE: 25, ENRICHMENT_CONCURRENCY: 2 });

    const corriendo = runner.start();
    const arranque = Date.now();
    const res = await request(app.getHttpServer()).get('/health');
    const demora = Date.now() - arranque;

    expect(res.status).toBe(200);
    expect(demora).toBeLessThan(1_000);
    await corriendo;
  });

  it('sin pendientes, la corrida termina en 0 sin llamar al proveedor', async () => {
    await prisma.$executeRawUnsafe(
      `UPDATE products SET enrichment_next_attempt_at = now() + interval '1 hour'
        WHERE enrichment_done = false`,
    );
    const { runner, proveedor } = armar({ ENRICHMENT_BATCH_SIZE: 25 });

    const resultado = await runner.start();

    expect(resultado.processed).toBe(0);
    expect(proveedor.embedCalls).toHaveLength(0);
    expect(runner.state).toBe('idle');
  });
});
