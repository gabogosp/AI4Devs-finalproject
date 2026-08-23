import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { asegurarCategoria, idDeCorrida } from '../../test/enrichment-fixtures';
import { FakeAiProvider } from '../../test/fake-ai.provider';
import { EnrichmentRepository } from '../enrichment/enrichment.repository';
import { SearchRepository } from './search.repository';

/**
 * T2.2 — el kNN vectorial contra Postgres real (integration).
 *
 * Se prueba contra la base y no con dobles porque lo que puede fallar acá es **SQL**: el tipo de
 * `JOIN`, el filtro de estado, el orden del operador `<=>` y que el planner use el índice. Un
 * doble de Prisma devolvería lo que yo le diga y no probaría ninguna de esas cuatro cosas.
 */
describe('SearchRepository.knn (integration, pgvector)', () => {
  const prisma = new PrismaService();
  const config = new ConfigService({ SEARCH_HNSW_EF_SEARCH: 64 }) as unknown as ConfigService;
  const repo = new SearchRepository(prisma, config);
  const enrichment = new EnrichmentRepository(prisma, config);
  const fake = new FakeAiProvider();
  const corrida = idDeCorrida();

  /** Vector unitario sobre el eje `i`: permite construir «cercano» y «ortogonal» a mano. */
  const eje = (i: number): number[] => {
    const v = new Array(768).fill(0);
    v[i] = 1;
    return v;
  };
  const CONSULTA = eje(0);

  const ids: Record<string, string> = {};

  beforeAll(async () => {
    await prisma.$connect();

    // Se borran las fixtures de corridas anteriores de ESTE spec: sin esto compite consigo
    // mismo (cada corrida deja vectores cercanos a la consulta y el top-N se llena de los de
    // ayer). Sólo toca su propio prefijo.
    await prisma.$executeRawUnsafe(`DELETE FROM products WHERE slug LIKE 'sknn-%'`);

    const categoryId = await asegurarCategoria(
      prisma,
      `sknn-${corrida}`,
      `Fijaciones ${corrida}`,
    );

    const crear = async (
      clave: string,
      status: string,
      vector: number[] | null,
    ): Promise<string> => {
      const p = await prisma.product.create({
        data: {
          sku: `SKNN-${corrida}-${clave}`,
          slug: `sknn-${corrida}-${clave}`,
          name: `Producto ${clave}`,
          price_ars_cents: 123_000,
          stock: 4,
          status,
          category_id: categoryId,
        },
      });
      if (vector) await enrichment.saveEmbedding(p.id, vector, fake.modelVersion);
      return p.id;
    };

    ids.cercano = await crear('cercano', 'published', eje(0));
    ids.intermedio = await crear('intermedio', 'published', [
      ...eje(0).map((v, i) => (i === 0 ? 0.7 : i === 1 ? 0.714 : 0)),
    ]);
    ids.ortogonal = await crear('ortogonal', 'published', eje(5));
    // Los dos casos negativos que el SQL tiene que excluir por sí solo:
    ids.draft = await crear('draft', 'draft', eje(0));
    ids.sinVector = await crear('sinvector', 'published', null);
  }, 60_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Sólo los productos de esta corrida, para no depender del volumen ajeno. */
  const mios = <T extends { slug: string }>(filas: T[]): T[] =>
    filas.filter((f) => f.slug.startsWith(`sknn-${corrida}`));

  /** `limit` que cubre toda la tabla: el resultado no depende de cuántos vectores haya. */
  const buscarTodo = async () => {
    const filas = await prisma.$queryRawUnsafe<Array<{ total: bigint }>>(
      'SELECT count(*)::bigint AS total FROM product_embeddings',
    );
    return repo.knn(CONSULTA, Number(filas[0].total));
  };

  it('el vecino más cercano sale PRIMERO', async () => {
    const resultados = mios(await buscarTodo());

    expect(resultados[0].slug).toBe(`sknn-${corrida}-cercano`);
    expect(resultados.map((r) => r.slug.split('-').pop())).toEqual([
      'cercano',
      'intermedio',
      'ortogonal',
    ]);
  });

  it('AC-9: un producto publicado SIN embedding no aparece (y no rompe la consulta)', async () => {
    // El `JOIN` es INNER a propósito. Con `LEFT JOIN` este producto aparecería con distancia
    // NULL y el orden pasaría a depender de dónde ponga Postgres los nulos.
    const slugs = mios(await buscarTodo()).map((r) => r.slug);

    expect(slugs).not.toContain(`sknn-${corrida}-sinvector`);
    // Y la consulta devolvió los otros tres sin fallar: el producto sin vector no rompe nada.
    expect(slugs).toHaveLength(3);
  });

  it('AC-6: un DRAFT con el vector idéntico a la consulta NO aparece', async () => {
    // El filtro vive en el SQL, no en el servicio: así el borrador no sale de la base y no hay
    // forma de devolverlo por accidente en un camino nuevo.
    const slugs = mios(await buscarTodo()).map((r) => r.slug);
    expect(slugs).not.toContain(`sknn-${corrida}-draft`);
  });

  it('devuelve todo lo que el DTO necesita, con score en 0..1', async () => {
    const [top] = mios(await buscarTodo());

    expect(top).toMatchObject({
      slug: `sknn-${corrida}-cercano`,
      name: 'Producto cercano',
      price_ars_cents: 123_000,
      stock: 4,
      category_name: `Fijaciones ${corrida}`,
    });
    expect(top).toHaveProperty('image_url');
    expect(Number(top.score)).toBeGreaterThan(0.99); // vector idéntico
    for (const r of mios(await buscarTodo())) {
      expect(Number(r.score)).toBeGreaterThanOrEqual(0);
      expect(Number(r.score)).toBeLessThanOrEqual(1);
    }
  });

  it('respeta el LIMIT', async () => {
    const dos = await repo.knn(CONSULTA, 2);
    expect(dos).toHaveLength(2);
  });

  it('el índice HNSW es USABLE por el operador que la query usa (`<=>`)', async () => {
    // Verificado y no asumido: sin índice, ordenar por `<=>` obliga a Postgres a recorrer y
    // ordenar TODA la tabla en cada búsqueda. A 5.000 vectores el síntoma sería latencia
    // creciente sin ningún error — el peor modo de fallar.
    //
    // Se hace `EXPLAIN` del **ordenamiento vectorial aislado** y no de la query completa, y la
    // razón es honesta: con las pocas decenas de filas de una base de test el planner elige un
    // sort en memoria para la query con `JOIN` **por costo**, no por incapacidad. Ese plan
    // mediría una decisión de costo a escala de test, no si el índice sirve. Lo que acá se
    // protege es lo que puede romperse de verdad: que el índice exista y que su opclass
    // coincida con el operador (`vector_cosine_ops` ↔ `<=>`). Si alguien lo borra o lo crea con
    // otra opclass, este assert se pone rojo.
    const literal = `[${CONSULTA.join(',')}]`;
    const plan = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
      await tx.$executeRawUnsafe('SET LOCAL hnsw.ef_search = 64');
      const filas = await tx.$queryRawUnsafe<Array<Record<string, string>>>(
        `EXPLAIN SELECT product_id FROM product_embeddings ORDER BY embedding <=> $1::vector LIMIT 5`,
        literal,
      );
      return filas.map((f) => Object.values(f)[0]).join('\n');
    });

    expect(plan).toContain('product_embeddings_embedding_hnsw_idx');
    expect(plan.toLowerCase()).toContain('index scan');
  });

  it('la query ordena por la DISTANCIA cruda, que es lo que el índice puede servir', async () => {
    // El error clásico que desactiva el índice en silencio: ordenar por
    // `1 - (embedding <=> v) DESC` en vez de por `embedding <=> v`. Devuelve las mismas filas
    // en el mismo orden, así que ningún test de resultados lo notaría, y a escala real la
    // búsqueda pasa de milisegundos a segundos. Por eso se verifica sobre la FUENTE: el
    // `EXPLAIN` de la query completa no puede distinguirlo con pocas filas.
    const { readFileSync } = await import('node:fs');
    const fuente = readFileSync('src/search/search.repository.ts', 'utf8');
    const orderBy = fuente
      .split('\n')
      .filter((l) => l.includes('ORDER BY') && l.includes('<=>'));

    expect(orderBy).toHaveLength(1);
    // Ordena por la distancia, ascendente (implícito), sin envolverla en una expresión.
    expect(orderBy[0]).toMatch(/ORDER BY e\.embedding <=> \$\{literal\}::vector\s*$/);
    expect(orderBy[0]).not.toContain('DESC');
    expect(orderBy[0]).not.toContain('1 -');
  });

  it('el vector no viaja como texto interpolado del usuario', async () => {
    // Guardarraíl de acoplamiento: el vector se arma con números ya validados por el adapter
    // (768 dimensiones finitas). Si alguien pasara texto libre acá, esto lo caza.
    const fuente = (await import('node:fs')).readFileSync(
      'src/search/search.repository.ts',
      'utf8',
    );
    // La consulta del usuario entra por `${consulta}` como PARÁMETRO de Prisma en `fullText`,
    // nunca por `$queryRawUnsafe`.
    expect(fuente).not.toMatch(/queryRawUnsafe[\s\S]{0,200}websearch_to_tsquery/);
  });
});
