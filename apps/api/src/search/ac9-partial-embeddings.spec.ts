import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { asegurarCategoria, idDeCorrida } from '../../test/enrichment-fixtures';
import { FakeAiProvider } from '../../test/fake-ai.provider';
import { EnrichmentRepository } from '../enrichment/enrichment.repository';
import { InMemoryQueryVectorCache } from './query-vector.cache';
import { QueryEmbedder } from './query-embedder';
import { ScoredProduct } from './relevance';
import { SearchRepository } from './search.repository';
import { SearchService } from './search.service';

/**
 * T5.3 — AC-9: productos sin embedding no rompen la búsqueda (ac9-partial-embeddings).
 *
 * Es el estado **real** del catálogo durante la ventana de la primera corrida: miles de productos
 * cargados y una fracción vectorizada. Si la búsqueda fallara —o devolviera vacío— con embeddings
 * parciales, el sitio estaría roto justo el día que se publica el catálogo.
 *
 * El caso de **cero** embeddings se ejerce con un doble del repositorio y no vaciando la tabla: el
 * Postgres de desarrollo es compartido con las suites de otras sesiones, y un `DELETE FROM
 * product_embeddings` les borraría las fixtures a mitad de su corrida. La diferencia queda
 * declarada acá para que nadie la lea como cobertura que no es.
 */
describe('AC-9 — embeddings parciales (ac9-partial-embeddings)', () => {
  const prisma = new PrismaService();
  const corrida = idDeCorrida();
  const fake = new FakeAiProvider();
  const CONSULTA = `taladro percutor ${corrida}`;

  const config = new ConfigService({
    GEMINI_EMBED_MODEL: 'text-embedding-004',
    SEARCH_MIN_SCORE: 0.55,
    SEARCH_MIN_LENGTH: 2,
    SEARCH_MAX_LENGTH: 200,
    SEARCH_LIMIT_DEFAULT: 50,
    SEARCH_LIMIT_MAX: 50,
    SEARCH_LEXICAL_WEIGHT: 0,
  }) as unknown as ConfigService;

  const repo = new SearchRepository(prisma, config);
  const armar = (r: SearchRepository = repo, pesoLexico = 0) => {
    const suConfig = new ConfigService({
      GEMINI_EMBED_MODEL: 'text-embedding-004',
      SEARCH_MIN_SCORE: 0.55,
      SEARCH_MIN_LENGTH: 2,
      SEARCH_MAX_LENGTH: 200,
      SEARCH_LIMIT_DEFAULT: 50,
      SEARCH_LIMIT_MAX: 50,
      SEARCH_LEXICAL_WEIGHT: pesoLexico,
    }) as unknown as ConfigService;
    return new SearchService(
      r,
      new QueryEmbedder(fake, suConfig, new InMemoryQueryVectorCache(suConfig)),
      suConfig,
    );
  };

  const conVector = `ac9-${corrida}-con`;
  const sinVector = `ac9-${corrida}-sin`;

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.$executeRawUnsafe(`DELETE FROM products WHERE slug LIKE 'ac9-%'`);

    const enrichment = new EnrichmentRepository(prisma, config);
    const categoryId = await asegurarCategoria(prisma, `ac9-${corrida}`, `AC9 ${corrida}`);

    // Mitad del catálogo embebida, mitad no: el estado durante la primera corrida.
    const embebido = await prisma.product.create({
      data: {
        sku: `AC9${corrida.toUpperCase()}CON`,
        slug: conVector,
        name: `Taladro percutor ${corrida}`,
        price_ars_cents: 220_000,
        stock: 3,
        status: 'published',
        category_id: categoryId,
      },
    });
    await enrichment.saveEmbedding(
      embebido.id,
      FakeAiProvider.vectorDe(CONSULTA),
      fake.modelVersion,
    );

    await prisma.product.create({
      data: {
        sku: `AC9${corrida.toUpperCase()}SIN`,
        slug: sinVector,
        // El mismo nombre: por texto tiene que encontrarse igual de bien.
        name: `Taladro percutor ${corrida} sin vector`,
        price_ars_cents: 210_000,
        stock: 2,
        status: 'published',
        category_id: categoryId,
      },
    });
  }, 60_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('la búsqueda semántica responde con los que SÍ tienen vector, no con un error', async () => {
    const salida = await armar().search(CONSULTA, 50);

    const slugs = salida.results.map((r) => r.slug);
    expect(slugs).toContain(conVector);
    // El que no tiene vector no aparece por esta vía — y eso NO es una falla: es el `JOIN`
    // INNER haciendo su trabajo. Lo que importa es que la consulta no explotó.
    expect(slugs).not.toContain(sinVector);
    expect(salida.degraded).toBe(false);
  });

  it('el que NO tiene vector es alcanzable por el camino full-text', async () => {
    // Es lo que hace que AC-9 y AC-4 se sostengan juntos: el catálogo entero sigue siendo
    // buscable mientras el enriquecimiento avanza.
    const porTexto = await armar(repo, 1).search(`taladro percutor ${corrida}`, 50);

    expect(porTexto.results.map((r) => r.slug)).toContain(sinVector);
  });

  it('y sigue siendo alcanzable por el listado de categoría de US-002', async () => {
    // La búsqueda es una vía más, no la única. Un producto sin vector tiene que poder
    // encontrarse navegando, que es como el 100 % del catálogo se encuentra hoy.
    const filas = await prisma.$queryRawUnsafe<Array<{ slug: string }>>(
      `SELECT p.slug FROM products p
         JOIN categories c ON c.id = p.category_id
        WHERE c.slug = $1 AND p.status = 'published'`,
      `ac9-${corrida}`,
    );

    expect(filas.map((f) => f.slug)).toContain(sinVector);
  });

  it('CERO embeddings ⇒ 200 con confidence none y fallback no vacío', async () => {
    // Con la tabla vacía el kNN no devuelve nada. Se modela con un repositorio cuyo `knn`
    // devuelve `[]` —y cuyo `fullText` y `rootCategoriesByVolume` son los REALES, contra
    // Postgres— porque vaciar `product_embeddings` en una base compartida les borraría las
    // fixtures a las suites de otras sesiones.
    const repoSinVectores = {
      knn: async (): Promise<ScoredProduct[]> => [],
      fullText: (q: string, limit: number) => repo.fullText(q, limit),
      rootCategoriesByVolume: (limit?: number) => repo.rootCategoriesByVolume(limit),
    } as unknown as SearchRepository;

    const salida = await armar(repoSinVectores).search(
      `consulta sin coincidencias ${corrida}`,
      50,
    );

    expect(salida.results).toEqual([]);
    expect(salida.confidence).toBe('none');
    // Nunca un callejón sin salida: se ofrecen categorías por donde seguir.
    expect(salida.fallback!.suggested_categories.length).toBeGreaterThan(0);
    // Y NO se marca como degradado: el proveedor respondió bien, simplemente no hay vectores
    // contra los que comparar. Confundir las dos cosas haría que el panel reporte una caída
    // del proveedor que no ocurrió.
    expect(salida.degraded).toBe(false);
  });

  it('un producto sin vector tampoco rompe el ORDEN de los que sí tienen', async () => {
    // Con `LEFT JOIN` en vez de `JOIN`, el producto sin vector entraría con distancia NULL y el
    // orden pasaría a depender de dónde ponga Postgres los nulos. Este test lo detectaría.
    const salida = await armar().search(CONSULTA, 50);
    const scores = salida.results.map((r) => Number(r.score));

    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    for (const s of scores) expect(Number.isFinite(s)).toBe(true);
  });
});
