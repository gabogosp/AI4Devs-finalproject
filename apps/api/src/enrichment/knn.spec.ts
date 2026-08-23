import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { EnrichmentRepository, EMBEDDING_DIMS_CHECK } from './enrichment.repository';
import { asegurarCategoria } from '../../test/enrichment-fixtures';

/**
 * T2.3 — el kNN. Este helper **no expone endpoint** (`/search` es de US-004): se prueba acá
 * porque es la demostración de que el vector guardado sirve para buscar, y porque el ticket
 * `DB-US-005` pide el `EXPLAIN` que confirma que el índice HNSW se usa.
 *
 * Los vectores se construyen **a mano** y no con el fake por hash: para aseverar un ORDEN
 * hace falta controlar la geometría (uno casi idéntico a la consulta, uno intermedio, uno
 * ortogonal). Un vector pseudo-aleatorio daría un orden que el test no podría predecir.
 */
describe('EnrichmentRepository.findNearest (integration, pgvector)', () => {
  const prisma = new PrismaService();
  const config = new ConfigService({ ENRICHMENT_MAX_ATTEMPTS: 5 }) as ConfigService;
  const repo = new EnrichmentRepository(prisma, config);
  const corrida = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  /** Vector unitario sobre el eje `eje`, con una pizca en el eje siguiente. */
  const eje = (i: number, mezcla = 0): number[] => {
    const v = new Array(EMBEDDING_DIMS_CHECK).fill(0);
    v[i] = 1;
    if (mezcla > 0) v[i + 1] = mezcla;
    const norma = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    return v.map((x) => x / norma);
  };

  const CONSULTA = eje(0);
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    await prisma.$connect();
    const categoryId = await asegurarCategoria(prisma, `knn-${corrida}`, `KNN ${corrida}`);

    const crear = async (clave: string, status: string) => {
      const p = await prisma.product.create({
        data: {
          sku: `KNN-${corrida}-${clave}`,
          slug: `knn-${corrida}-${clave}`.toLowerCase(),
          name: `Producto ${clave}`,
          price_ars_cents: 100_000,
          stock: 3,
          status,
          category_id: categoryId,
        },
      });
      ids[clave] = p.id;
      return p.id;
    };

    // Geometría controlada respecto de CONSULTA = eje(0):
    await repo.saveEmbedding(await crear('cercano', 'published'), eje(0, 0.05), 'm1');
    await repo.saveEmbedding(await crear('intermedio', 'published'), eje(0, 0.9), 'm1');
    await repo.saveEmbedding(await crear('ortogonal', 'published'), eje(300), 'm1');
    // Un borrador con el vector IDÉNTICO a la consulta: si apareciera, sería el primero.
    await repo.saveEmbedding(await crear('borrador', 'draft'), eje(0), 'm1');
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('ordena por similitud descendente', async () => {
    const vecinos = await repo.findNearest(CONSULTA, 50);
    const mios = vecinos.filter((v) => v.slug.startsWith(`knn-${corrida}`));

    expect(mios.map((v) => v.slug.split('-').pop())).toEqual([
      'cercano',
      'intermedio',
      'ortogonal',
    ]);
    const scores = mios.map((v) => Number(v.score));
    expect(scores[0]).toBeGreaterThan(scores[1]);
    expect(scores[1]).toBeGreaterThan(scores[2]);
  });

  it('el score está acotado a [0,1] y el ortogonal cae a ~0', async () => {
    const vecinos = await repo.findNearest(CONSULTA, 50);
    const mios = vecinos.filter((v) => v.slug.startsWith(`knn-${corrida}`));

    for (const v of mios) {
      expect(Number(v.score)).toBeGreaterThanOrEqual(0);
      expect(Number(v.score)).toBeLessThanOrEqual(1);
    }
    expect(Number(mios[0].score)).toBeGreaterThan(0.99); // casi idéntico
    expect(Number(mios[2].score)).toBeCloseTo(0, 5); // ortogonal
  });

  it('un DRAFT con el vector idéntico NO aparece (restricción que hereda US-004)', async () => {
    // Es la única barrera entre un borrador del dueño y la búsqueda pública.
    const vecinos = await repo.findNearest(CONSULTA, 50);

    expect(vecinos.map((v) => v.id)).not.toContain(ids.borrador);
    expect(vecinos.map((v) => v.id)).toContain(ids.cercano);
  });

  it('respeta el LIMIT', async () => {
    expect(await repo.findNearest(CONSULTA, 2)).toHaveLength(2);
  });

  it('el plan de la consulta USA el índice HNSW (ticket DB-US-005)', async () => {
    // Con pocas filas el planner elegiría un seq scan por costo, así que se lo desactiva
    // en la MISMA conexión (transacción interactiva) para poder observar la elección de
    // índice. Si el índice no existiera o el operador no coincidiera con su opclass,
    // Postgres seguiría con seq scan y el assert falla.
    const plan = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
      const literal = `[${CONSULTA.join(',')}]`;
      const filas = await tx.$queryRawUnsafe<Array<Record<string, string>>>(
        `EXPLAIN SELECT product_id FROM product_embeddings ORDER BY embedding <=> $1::vector LIMIT 5`,
        literal,
      );
      return filas.map((f) => Object.values(f)[0]).join('\n');
    });

    expect(plan).toContain('product_embeddings_embedding_hnsw_idx');
    expect(plan.toLowerCase()).toContain('index scan');
  });
});
