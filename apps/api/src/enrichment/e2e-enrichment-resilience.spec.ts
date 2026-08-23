import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppConfigModule } from '../config/config.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CatalogEventsModule } from '../observability/catalog-events.module';
import { configureApp } from '../bootstrap';
import { adminToken } from '../../test/e2e-app';
import { asegurarCategoria, idDeCorrida } from '../../test/enrichment-fixtures';
import { FakeAiProvider } from '../../test/fake-ai.provider';
import { AiTransientError } from '../common/errors/enrichment-errors';
import { PrismaService } from '../prisma/prisma.service';
import { EnrichmentEventsService } from './enrichment-events.service';
import { EnrichmentModule } from './enrichment.module';
import { EnrichmentRepository } from './enrichment.repository';
import { EnrichmentRunner } from './enrichment.runner';
import { AI_EMBEDDER, AI_ENRICHER } from './ports/ai.ports';

/**
 * T6.3 — resiliencia ante un proveedor que falla (AC-4, AC-5).
 *
 * Los dos escenarios que separan «degradar» de «romper»:
 *
 * - **Fallo transitorio** (429, un pico de cuota): el producto termina enriquecido. Que un
 *   segundo de rate-limit deje un producto fuera de la búsqueda para siempre sería inaceptable.
 * - **Fallo persistente**: el producto queda abandonado con su rastro, **conserva su
 *   `description_raw`** y sigue publicado. El catálogo pierde calidad de búsqueda, no productos.
 */
describe('Resiliencia del enriquecimiento (e2e-enrichment-resilience)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let runner: EnrichmentRunner;
  let repo: EnrichmentRepository;
  let events: EnrichmentEventsService;
  let fake: FakeAiProvider;
  const corrida = idDeCorrida();
  let n = 0;

  beforeAll(async () => {
    fake = new FakeAiProvider();
    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, PrismaModule, CatalogEventsModule, EnrichmentModule],
    })
      .overrideProvider(AI_ENRICHER)
      .useValue(fake)
      .overrideProvider(AI_EMBEDDER)
      .useValue(fake)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    runner = app.get(EnrichmentRunner);
    repo = app.get(EnrichmentRepository);
    events = app.get(EnrichmentEventsService);
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => {
    jest.restoreAllMocks();
    fake.embedCalls.length = 0;
    fake.enrichCalls.length = 0;
    events.reset();
    runner.resetBreaker();
  });

  async function productoPendiente(): Promise<string> {
    const categoryId = await asegurarCategoria(
      prisma,
      `res-${corrida}`,
      `Resiliencia ${corrida}`,
    );
    n += 1;
    const sku = `RES-${corrida}-${n}`;
    const p = await prisma.product.create({
      data: {
        sku,
        slug: sku.toLowerCase(),
        name: `Taladro ${sku}`,
        price_ars_cents: 200_000,
        stock: 4,
        status: 'published',
        category_id: categoryId,
        description_raw: 'taladro 13mm',
      },
    });
    return p.id;
  }

  /** Devuelve el producto a la cola sin esperar el backoff durable. */
  const vencerLaEspera = (id: string) =>
    prisma.$executeRawUnsafe(
      `UPDATE products SET enrichment_next_attempt_at = now() - interval '1 second'
        WHERE id = $1::uuid`,
      id,
    );

  it('AC-4: un 429 con Retry-After y después éxito ⇒ el producto termina enriquecido', async () => {
    // El reintento de un transitorio es DURABLE (en la base), no un loop en memoria: es la
    // crítica que ADR-0012 se hacía a sí mismo. Así que el reintento ocurre en la corrida
    // siguiente, y esta prueba lo recorre entero.
    const id = await productoPendiente();
    const embedSpy = jest
      .spyOn(fake, 'embed')
      .mockRejectedValueOnce(new AiTransientError('el proveedor devolvió 429', 1));

    await runner.start({ productIds: [id] });

    // Tras el fallo: intentos en 1, código registrado, y una espera anotada en la base.
    const trasFallo = await prisma.product.findUniqueOrThrow({ where: { id } });
    expect(trasFallo.enrichment_attempts).toBe(1);
    expect(trasFallo.enrichment_error_code).toBe('dsm:enrichment/ai-transient');
    expect(trasFallo.enrichment_done).toBe(false);
    expect(trasFallo.enrichment_next_attempt_at).not.toBeNull();
    expect(events.count('enrichment.retried')).toBe(1);
    expect(events.count('enrichment.abandoned')).toBe(0);

    // Vencida la espera, la corrida siguiente lo completa.
    embedSpy.mockRestore();
    await vencerLaEspera(id);
    await runner.start({ productIds: [id] });

    const final = await prisma.product.findUniqueOrThrow({ where: { id } });
    expect(final.enrichment_done).toBe(true);
    expect(final.description_enriched).toBeTruthy();
    // El rastro del fallo se limpia: no queda un error_code mintiendo sobre un producto sano.
    expect(final.enrichment_error_code).toBeNull();
    expect(final.enrichment_attempts).toBe(0);
    expect(await repo.hasEmbedding(id)).toBe(true);
  });

  it('AC-4: la espera anotada respeta el Retry-After del proveedor', async () => {
    // Si se ignorara y se reintentara con el backoff propio, el proveedor contestaría otro 429:
    // insistir antes de lo que él pidió es pedirle que nos vuelva a rechazar.
    const id = await productoPendiente();
    jest
      .spyOn(fake, 'embed')
      .mockRejectedValue(new AiTransientError('429', 1));

    const antes = Date.now();
    await runner.start({ productIds: [id] });

    const fila = await prisma.product.findUniqueOrThrow({ where: { id } });
    // El primer escalón del backoff durable es 1 minuto: la espera cae en el futuro.
    expect(fila.enrichment_next_attempt_at!.getTime()).toBeGreaterThan(antes);
  });

  it('AC-5: un proveedor que falla siempre deja el producto abandonado con rastro', async () => {
    const id = await productoPendiente();
    jest.spyOn(fake, 'embed').mockRejectedValue(new AiTransientError('caído'));

    // Cinco corridas, venciendo la espera entre cada una: es exactamente lo que pasaría a lo
    // largo de una noche con el proveedor caído.
    for (let i = 0; i < 5; i += 1) {
      runner.resetBreaker();
      await vencerLaEspera(id);
      await runner.start({ productIds: [id] });
    }

    const fila = await prisma.product.findUniqueOrThrow({ where: { id } });
    expect(fila.enrichment_attempts).toBe(5);
    expect(fila.enrichment_error_code).toBe('dsm:enrichment/ai-transient');
    expect(fila.enrichment_done).toBe(false);
    // Sin embedding y SIN texto inventado: no se guarda un vector a medias.
    expect(await repo.hasEmbedding(id)).toBe(false);
    expect(fila.description_enriched).toBeNull();
    // La descripción del catálogo queda intacta y el producto sigue publicado: pierde calidad
    // de búsqueda, no presencia en la tienda.
    expect(fila.description_raw).toBe('taladro 13mm');
    expect(fila.status).toBe('published');
    expect(events.count('enrichment.abandoned')).toBe(1);
  });

  it('AC-5: el abandonado sale del claim y el /status lo reporta en abandoned', async () => {
    const id = await productoPendiente();
    jest.spyOn(fake, 'embed').mockRejectedValue(new AiTransientError('caído'));
    for (let i = 0; i < 5; i += 1) {
      runner.resetBreaker();
      await vencerLaEspera(id);
      await runner.start({ productIds: [id] });
    }

    // Ya no se lo reclama, ni con la espera vencida: no se sigue quemando cuota contra él.
    await vencerLaEspera(id);
    const reclamados = await repo.claimBatch(500, [id]);
    expect(reclamados).toHaveLength(0);

    const res = await request(app.getHttpServer())
      .get('/v1/admin/enrichment/status')
      .set('Authorization', `Bearer ${adminToken()}`)
      .expect(200);

    expect(res.body.coverage.abandoned).toBeGreaterThanOrEqual(1);
    expect(res.body.last_error_code).toBe('dsm:enrichment/ai-transient');
  });

  it('AC-5: force lo rehabilita y, con el proveedor sano, se completa', async () => {
    // El camino de salida del abandono: una decisión explícita del dueño, no un reintento
    // automático. Sin esto, un producto abandonado quedaría fuera de la búsqueda para siempre.
    const id = await productoPendiente();
    const embedSpy = jest
      .spyOn(fake, 'embed')
      .mockRejectedValue(new AiTransientError('caído'));
    for (let i = 0; i < 5; i += 1) {
      runner.resetBreaker();
      await vencerLaEspera(id);
      await runner.start({ productIds: [id] });
    }
    expect(
      (await prisma.product.findUniqueOrThrow({ where: { id } })).enrichment_attempts,
    ).toBe(5);

    embedSpy.mockRestore();
    runner.resetBreaker();
    const resultado = await runner.start({ productIds: [id], force: true });

    expect(resultado.rehabilitated).toBe(1);
    const final = await prisma.product.findUniqueOrThrow({ where: { id } });
    expect(final.enrichment_done).toBe(true);
    expect(await repo.hasEmbedding(id)).toBe(true);
  });
});
