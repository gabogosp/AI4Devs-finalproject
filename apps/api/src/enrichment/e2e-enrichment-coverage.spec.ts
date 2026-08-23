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
import { coverageRatio } from './enrichment.repository';
import { EnrichmentModule } from './enrichment.module';
import { EnrichmentRunner } from './enrichment.runner';
import { AI_EMBEDDER, AI_ENRICHER } from './ports/ai.ports';

/**
 * T6.4 — cobertura ≥ 90 % con fallo inyectado (AC-3).
 *
 * **Qué prueba este spec y qué no.** Prueba que el pipeline alcanza ≥ 90 % de cobertura cuando
 * el proveedor falla en una fracción de las llamadas, y que el número que publica el `/status`
 * es el mismo que hay en la base. El ≥ 90 % **de producción** no es una propiedad del código:
 * es el resultado de una corrida sobre el catálogo real de DSM, con el proveedor real, y sólo se
 * puede afirmar después de correrla y mirar el `/status`. Este test protege el mecanismo de
 * medición; el número real lo da la operación (ver el runbook).
 *
 * El catálogo es de 100 productos con un fallo determinista en el 5 %: sin reintentos, la
 * cobertura sería 95 %; con la corrida de reintento, 100 %. El umbral de 90 % deja margen para
 * que el test no sea frágil sin dejar de ser exigente.
 */
describe('Cobertura del catálogo con fallo inyectado (e2e-enrichment-coverage)', () => {
  const TOTAL = 100;
  /** Uno de cada 20 embeddings falla: 5 % determinista, no aleatorio. */
  const UNO_DE_CADA = 20;

  let app: INestApplication;
  let prisma: PrismaService;
  let runner: EnrichmentRunner;
  let fake: FakeAiProvider;
  const corrida = idDeCorrida();
  let ids: string[] = [];

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

    const categoryId = await asegurarCategoria(
      prisma,
      `cob-${corrida}`,
      `Cobertura ${corrida}`,
    );
    // Alta en lote: 100 `create` de a uno tardarían más que la corrida que se quiere medir.
    const datos = Array.from({ length: TOTAL }, (_, i) => {
      const sku = `COB-${corrida}-${String(i).padStart(3, '0')}`;
      return {
        sku,
        slug: sku.toLowerCase(),
        name: `Producto ${sku}`,
        price_ars_cents: 100_000 + i,
        stock: 2,
        status: 'published',
        category_id: categoryId,
        description_raw: `descripcion pobre ${i}`,
      };
    });
    await prisma.product.createMany({ data: datos });
    ids = (
      await prisma.product.findMany({
        where: { sku: { startsWith: `COB-${corrida}-` } },
        select: { id: true },
      })
    ).map((p) => p.id);
    expect(ids).toHaveLength(TOTAL);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('con un 5% de fallos, la cobertura del /status llega a ≥ 90% y coincide con la base', async () => {
    // Fallo determinista: la llamada 20, 40, 60… falla. Determinista y no aleatorio porque un
    // test que falla una vez cada veinte corridas no es una red, es una molestia.
    let llamada = 0;
    const embedReal = fake.embed.bind(fake);
    jest.spyOn(fake, 'embed').mockImplementation(async (texto: string) => {
      llamada += 1;
      if (llamada % UNO_DE_CADA === 0) {
        throw new AiTransientError('fallo inyectado del proveedor');
      }
      return embedReal(texto);
    });

    // Primera corrida: procesa los 100, con ~5 fallos.
    await runner.start({ productIds: ids });
    const trasPrimera = await prisma.product.count({
      where: { id: { in: ids }, enrichment_done: true },
    });
    expect(trasPrimera).toBeGreaterThanOrEqual(90);

    // Corrida de reintento: los que fallaron ya tienen su espera anotada en la base, así que se
    // la vence (es lo que haría el paso del tiempo) y se vuelve a barrer.
    await prisma.$executeRawUnsafe(
      `UPDATE products SET enrichment_next_attempt_at = now() - interval '1 second'
        WHERE id = ANY($1::uuid[]) AND enrichment_done = false`,
      ids,
    );
    runner.resetBreaker();
    await runner.start({ productIds: ids });

    // Cobertura medida SOBRE ESTE catálogo (la base es compartida con otras suites, así que un
    // ratio global no diría nada de esta corrida).
    const conVector = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*)::bigint AS n FROM product_embeddings WHERE product_id = ANY($1::uuid[])`,
      ids,
    );
    const embeddedReal = Number(conVector[0].n);
    expect(coverageRatio(embeddedReal, TOTAL)).toBeGreaterThanOrEqual(0.9);

    // Y el endpoint no puede reportar un número distinto del que hay en la tabla: si el
    // `/status` mintiera, el dueño creería que la búsqueda está lista cuando no lo está.
    const res = await request(app.getHttpServer())
      .get('/v1/admin/enrichment/status')
      .set('Authorization', `Bearer ${adminToken()}`)
      .expect(200);

    const totalEnLaBase = await prisma.product.count();
    const conVectorEnLaBase = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      'SELECT count(*)::bigint AS n FROM product_embeddings',
    );
    expect(res.body.coverage.total).toBe(totalEnLaBase);
    expect(res.body.coverage.embedded).toBe(Number(conVectorEnLaBase[0].n));
    expect(res.body.coverage.coverage_ratio).toBeCloseTo(
      coverageRatio(Number(conVectorEnLaBase[0].n), totalEnLaBase),
      4,
    );
  }, 300_000);

  it('la suma de las categorías del /status es consistente (pending + hechos = total)', async () => {
    // Un `/status` cuyas partes no cierran es peor que no tener `/status`: se toman decisiones
    // con números que no suman.
    const res = await request(app.getHttpServer())
      .get('/v1/admin/enrichment/status')
      .set('Authorization', `Bearer ${adminToken()}`)
      .expect(200);
    const c = res.body.coverage;

    const hechos = await prisma.product.count({ where: { enrichment_done: true } });
    // `pending` (elegibles) + `abandoned` (agotados) + hechos = total del catálogo.
    expect(c.pending + c.abandoned + hechos).toBe(c.total);
    expect(c.embedded).toBeLessThanOrEqual(c.total);
    expect(c.coverage_ratio).toBeGreaterThanOrEqual(0);
    expect(c.coverage_ratio).toBeLessThanOrEqual(1);
  });
});
