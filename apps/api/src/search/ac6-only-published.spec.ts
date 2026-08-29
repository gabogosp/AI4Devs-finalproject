import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { asegurarCategoria, idDeCorrida } from '../../test/enrichment-fixtures';
import { FakeAiProvider } from '../../test/fake-ai.provider';
import { EnrichmentRepository } from '../enrichment/enrichment.repository';
import { InMemoryQueryVectorCache } from './query-vector.cache';
import { QueryEmbedder } from './query-embedder';
import { SearchRepository } from './search.repository';
import { SearchService } from './search.service';

/**
 * T5.1 — AC-6: un producto no publicado no aparece por **ninguna** vía (ac6-only-published).
 *
 * El escenario está armado para que el filtro sea la **única** cosa que impide que salgan: los
 * dos productos ocultos tienen embedding, tienen `search_document` poblado, y su nombre y su SKU
 * son exactamente lo que se busca. Si el `WHERE status = 'published'` desapareciera de una de
 * las dos queries, este spec se pone rojo por esa vía y sigue verde por la otra — que es
 * justamente lo que hace que el test señale **dónde** está el agujero.
 *
 * Por qué importa tanto: un borrador es un producto que el dueño **todavía no quiere mostrar**
 * —precio sin definir, foto pendiente, stock sin contar— y un archivado es uno que decidió dejar
 * de vender. Que aparezcan en la búsqueda es peor que un bug de relevancia: es exponer una
 * decisión del negocio que no se tomó.
 */
describe('AC-6 — sólo productos publicados (ac6-only-published)', () => {
  const prisma = new PrismaService();
  const corrida = idDeCorrida();
  const NOMBRE_OCULTO = `Amoladora secreta ${corrida}`;
  const SKU_DRAFT = `AC6${corrida.toUpperCase()}DRAFT`;
  const SKU_ARCH = `AC6${corrida.toUpperCase()}ARCH`;
  /** El texto con el que se van a buscar: los ocultos llevan ESTE vector. */
  const CONSULTA = `amoladora secreta ${corrida}`;

  const fake = new FakeAiProvider();
  const slugsOcultos = [`ac6-${corrida}-draft`, `ac6-${corrida}-archived`];

  /** Servicio armado con el peso léxico que el escenario necesita. */
  const armar = (pesoLexico: number) => {
    const config = new ConfigService({
      GEMINI_EMBED_MODEL: 'text-embedding-004',
      SEARCH_MIN_SCORE: 0.55,
      SEARCH_MIN_LENGTH: 2,
      SEARCH_MAX_LENGTH: 200,
      SEARCH_LIMIT_DEFAULT: 50,
      SEARCH_LIMIT_MAX: 50,
      SEARCH_LEXICAL_WEIGHT: pesoLexico,
      SEARCH_HNSW_EF_SEARCH: 64,
    }) as unknown as ConfigService;
    return new SearchService(
      new SearchRepository(prisma, config),
      new QueryEmbedder(fake, config, new InMemoryQueryVectorCache(config)),
      config,
    );
  };

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.$executeRawUnsafe(`DELETE FROM products WHERE slug LIKE 'ac6-%'`);

    const config = new ConfigService({}) as unknown as ConfigService;
    const enrichment = new EnrichmentRepository(prisma, config);
    const categoryId = await asegurarCategoria(prisma, `ac6-${corrida}`, `AC6 ${corrida}`);

    const crear = async (clave: string, status: string, sku: string) => {
      const p = await prisma.product.create({
        data: {
          sku,
          slug: `ac6-${corrida}-${clave}`,
          name: NOMBRE_OCULTO,
          price_ars_cents: 150_000,
          stock: 9,
          status,
          category_id: categoryId,
        },
      });
      // CON embedding, y con el vector de la consulta: el más cercano posible.
      await enrichment.saveEmbedding(
        p.id,
        FakeAiProvider.vectorDe(CONSULTA),
        fake.modelVersion,
      );
      return p;
    };

    await crear('draft', 'draft', SKU_DRAFT);
    await crear('archived', 'archived', SKU_ARCH);
    // Un publicado con el mismo vector: prueba que la consulta SÍ encuentra cosas, así que un
    // resultado vacío no puede pasar por «no había nada que encontrar».
    await crear('publicado', 'published', `AC6${corrida.toUpperCase()}PUB`);
  }, 60_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Los slugs devueltos por una búsqueda. */
  const slugsDe = async (servicio: SearchService, q: string) =>
    (await servicio.search(q, 50)).results.map((r) => r.slug);

  it('el escenario es válido: el publicado con el mismo vector SÍ aparece', async () => {
    // Sin esta comprobación, los cuatro tests de abajo podrían pasar simplemente porque la
    // búsqueda no encuentra nada.
    const slugs = await slugsDe(armar(0), CONSULTA);
    expect(slugs).toContain(`ac6-${corrida}-publicado`);
  });

  it('vía SEMÁNTICA: ni el draft ni el archived aparecen', async () => {
    const slugs = await slugsDe(armar(0), CONSULTA);

    for (const oculto of slugsOcultos) expect(slugs).not.toContain(oculto);
  });

  it('vía FULL-TEXT (peso léxico 1): tampoco aparecen', async () => {
    // Con peso 1 el ranking es el léxico puro, así que esta consulta va por la otra query del
    // repositorio — la que tiene su propio `WHERE`.
    const slugs = await slugsDe(armar(1), NOMBRE_OCULTO);

    for (const oculto of slugsOcultos) expect(slugs).not.toContain(oculto);
  });

  it('buscando su NOMBRE EXACTO no aparecen', async () => {
    const porVector = await slugsDe(armar(0), NOMBRE_OCULTO);
    const porTexto = await slugsDe(armar(1), NOMBRE_OCULTO);

    for (const oculto of slugsOcultos) {
      expect(porVector).not.toContain(oculto);
      expect(porTexto).not.toContain(oculto);
    }
  });

  it('buscando su SKU EXACTO no aparecen', async () => {
    // El SKU es el caso más específico posible: si algo se filtrara, sería acá.
    for (const sku of [SKU_DRAFT, SKU_ARCH]) {
      const porTexto = await slugsDe(armar(1), sku);
      for (const oculto of slugsOcultos) expect(porTexto).not.toContain(oculto);
    }
  });

  it('el filtro vive en LAS DOS queries del repositorio, no en el servicio', async () => {
    // Verificación estructural: si el filtro estuviera en el servicio, quitarlo de una query
    // pasaría desapercibido hasta que alguien agregue un tercer camino de lectura. Que esté en
    // el SQL significa que los borradores no salen de la base.
    const { readFileSync } = await import('node:fs');
    const fuente = readFileSync('src/search/search.repository.ts', 'utf8');
    // Se descartan los comentarios: lo que se cuenta es SQL, no prosa que lo explique.
    const filtrosSql = fuente
      .split('\n')
      .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//'))
      .filter((l) => l.includes("status = 'published'"));

    // Tres, y las tres son deliberadas: `knn`, `fullText` y `rootCategoriesByVolume` — el
    // fallback tampoco puede ofrecer una categoría que sólo tiene borradores.
    expect(filtrosSql).toHaveLength(3);

    // Y el servicio NO filtra: si lo hiciera, quitar el `WHERE` de una query pasaría
    // desapercibido hasta que alguien agregue un tercer camino de lectura sin acordarse.
    const servicio = readFileSync('src/search/search.service.ts', 'utf8');
    expect(servicio).not.toContain("'published'");
    expect(servicio).not.toContain('status');
  });
});
