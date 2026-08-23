import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppConfigModule } from '../config/config.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CatalogEventsModule } from '../observability/catalog-events.module';
import { configureApp } from '../bootstrap';
import { asegurarCategoria, idDeCorrida } from '../../test/enrichment-fixtures';
import { FakeAiProvider } from '../../test/fake-ai.provider';
import { PrismaService } from '../prisma/prisma.service';
import { EnrichmentModule } from './enrichment.module';
import { EnrichmentRepository } from './enrichment.repository';
import { EnrichmentRunner } from './enrichment.runner';
import { EMBEDDING_DIMS } from './ai/gemini-http.client';
import { AI_EMBEDDER, AI_ENRICHER } from './ports/ai.ports';

/**
 * T6.1 — ciclo completo de aceptación (AC-1, AC-2, AC-8, AC-10).
 *
 * Es el test que responde «¿esto sirve para lo que se construyó?»: un catálogo con
 * descripciones pobres entra, y sale con texto, con vectores de 768 dimensiones y **buscable**.
 * Los otros specs verifican piezas; este verifica el resultado.
 *
 * El proveedor es el fake determinista inyectado por el token del puerto. Consecuencia honesta
 * y declarada: este spec prueba el **pipeline**, no la calidad del texto de Gemini ni que el
 * adapter HTTP funcione contra el proveedor real (para eso hace falta la clave, que por
 * decisión del PO no se carga).
 */
describe('Ciclo completo del enriquecimiento (e2e-enrichment-cycle)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let runner: EnrichmentRunner;
  let repo: EnrichmentRepository;
  let fake: FakeAiProvider;
  const corrida = idDeCorrida();
  let categoryId: string;
  const ids: Record<string, string> = {};

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

    categoryId = await asegurarCategoria(
      prisma,
      `ciclo-${corrida}`,
      `Herramientas ${corrida}`,
    );

    // Tres productos con descripción pobre —el caso REAL del catálogo de DSM— y uno de ellos
    // en `draft`, que es el que prueba AC-10.
    const semillas: Array<[string, string, string, string]> = [
      ['AMOLADORA', 'Amoladora angular 115mm', 'amoladora 115', 'published'],
      ['TALADRO', 'Taladro percutor 13mm', 'taladro percutor', 'published'],
      ['MECHA', 'Mecha widia 8mm', 'mecha 8', 'draft'],
    ];
    for (const [clave, nombre, descripcion, status] of semillas) {
      const sku = `CICLO-${corrida}-${clave}`;
      const p = await prisma.product.create({
        data: {
          sku,
          slug: sku.toLowerCase(),
          name: nombre,
          price_ars_cents: 150_000,
          stock: 3,
          status,
          category_id: categoryId,
          description_raw: descripcion,
        },
      });
      ids[clave] = p.id;
    }

    // Una sola corrida, acotada a estos tres: el resultado de TODOS los asserts sale de acá.
    await runner.start({ productIds: Object.values(ids) });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('AC-1: los 3 productos quedan con texto enriquecido y marcados como hechos', async () => {
    const filas = await prisma.product.findMany({
      where: { id: { in: Object.values(ids) } },
    });

    expect(filas).toHaveLength(3);
    for (const f of filas) {
      expect(f.description_enriched).toBeTruthy();
      expect((f.description_enriched ?? '').length).toBeGreaterThan(0);
      expect(f.enrichment_done).toBe(true);
      expect(f.enrichment_error_code).toBeNull();
      expect(f.enrichment_attempts).toBe(0);
      // La descripción original se CONSERVA: el enriquecimiento agrega, no reemplaza.
      expect(f.description_raw).toBeTruthy();
    }
  });

  it('AC-8: cada uno tiene su vector de 768 dimensiones con model_version', async () => {
    const filas = await prisma.$queryRawUnsafe<
      Array<{ product_id: string; dims: number; model_version: string }>
    >(
      `SELECT product_id, vector_dims(embedding) AS dims, model_version
         FROM product_embeddings WHERE product_id = ANY($1::uuid[])`,
      Object.values(ids),
    );

    expect(filas).toHaveLength(3);
    for (const f of filas) {
      // 768 es la dimensión de `text-embedding-004` y está fijada en el esquema: un vector de
      // otra dimensión haría fallar el índice HNSW, no un assert.
      expect(Number(f.dims)).toBe(EMBEDDING_DIMS);
      // `model_version` es lo que permite saber qué vectores hay que regenerar el día que se
      // cambie de modelo. Sin él, un cambio de proveedor obligaría a re-embeddear todo a ciegas.
      expect(f.model_version).toBe(fake.modelVersion);
    }
  });

  it('AC-10: el producto en draft SIGUE en draft — el enriquecimiento no publica', async () => {
    // Si esto fallara, un borrador que el dueño todavía no quiere mostrar aparecería en la
    // tienda porque la IA le escribió una descripción.
    const mecha = await prisma.product.findUniqueOrThrow({ where: { id: ids.MECHA } });

    expect(mecha.status).toBe('draft');
    // Y sí se enriqueció: se prepara mientras está en borrador, para que publicar sea
    // instantáneo y no espere una corrida.
    expect(mecha.enrichment_done).toBe(true);
    expect(mecha.description_enriched).toBeTruthy();

    const publicados = await prisma.product.findMany({
      where: { id: { in: [ids.AMOLADORA, ids.TALADRO] } },
      select: { status: true },
    });
    expect(publicados.every((p) => p.status === 'published')).toBe(true);
  });

  it('AC-2: el producto es ELEGIBLE para la búsqueda semántica (kNN lo devuelve primero)', async () => {
    // El punto de todo el change: sin este assert, US-005 sería una tarea de escritura de
    // texto. Se consulta con el vector del texto de la amoladora y tiene que volver ella.
    const filas = await prisma.$queryRawUnsafe<Array<{ embedding: string }>>(
      `SELECT embedding::text AS embedding FROM product_embeddings WHERE product_id = $1::uuid`,
      ids.AMOLADORA,
    );
    const vectorDeLaAmoladora = JSON.parse(filas[0].embedding) as number[];

    const vecinos = await repo.findNearest(vectorDeLaAmoladora, 5);

    expect(vecinos.length).toBeGreaterThan(0);
    expect(vecinos[0].id).toBe(ids.AMOLADORA);
    // El draft NO aparece entre los resultados: la búsqueda pública sólo ve publicados.
    expect(vecinos.map((v) => v.id)).not.toContain(ids.MECHA);
  });

  it('la cobertura del /status refleja los 3 (AC-3 sobre este subconjunto)', async () => {
    const cobertura = await repo.coverage();

    // Por delta no hace falta: los 3 son de esta corrida y se preguntan por id.
    expect(await repo.hasEmbedding(ids.AMOLADORA)).toBe(true);
    expect(await repo.hasEmbedding(ids.TALADRO)).toBe(true);
    expect(await repo.hasEmbedding(ids.MECHA)).toBe(true);
    expect(cobertura.total).toBeGreaterThanOrEqual(3);
    expect(cobertura.coverage_ratio).toBeGreaterThan(0);
  });
});
