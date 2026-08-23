import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { asegurarCategoria, idDeCorrida } from '../../test/enrichment-fixtures';
import { SearchRepository } from './search.repository';

/**
 * T2.3 — el camino full-text (search-fulltext).
 *
 * Es la vía de AC-4 (degradación cuando el proveedor de IA no responde) y el rescate léxico de
 * los casos que el vector hace peor: un SKU, un nombre técnico exacto.
 *
 * La mitad de estos tests son sobre **entrada hostil**, y no por paranoia: lo que llega a un
 * buscador es texto libre. `to_tsquery` explota con `taco & | fischer`; `websearch_to_tsquery`
 * no. Y una consulta es la única cosa del cliente que entra al SQL, así que la inyección es la
 * amenaza que hay que poder demostrar cerrada, no afirmar.
 */
describe('SearchRepository.fullText (integration, search-fulltext)', () => {
  const prisma = new PrismaService();
  const config = new ConfigService({}) as unknown as ConfigService;
  const repo = new SearchRepository(prisma, config);
  const corrida = idDeCorrida();
  const SKU_EXACTO = `FTS${corrida.toUpperCase()}X9`;

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.$executeRawUnsafe(`DELETE FROM products WHERE slug LIKE 'sfts-%'`);

    const categoryId = await asegurarCategoria(
      prisma,
      `sfts-${corrida}`,
      `Herramientas ${corrida}`,
    );

    const crear = (clave: string, name: string, status: string, sku?: string) =>
      prisma.product.create({
        data: {
          sku: sku ?? `SFTS-${corrida}-${clave}`,
          slug: `sfts-${corrida}-${clave}`,
          name,
          price_ars_cents: 99_000,
          stock: 2,
          status,
          category_id: categoryId,
        },
      });

    // Ninguno tiene embedding: es el estado del catálogo ANTES de la primera corrida del
    // enriquecimiento, y el que tiene que seguir siendo buscable.
    await crear('amoladora', 'Amoladora angular de 115 mm', 'published');
    await crear('sku', 'Producto con SKU raro', 'published', SKU_EXACTO);
    await crear('borrador', 'Amoladora secreta en borrador', 'draft');
  }, 60_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const mios = <T extends { slug: string }>(filas: T[]): T[] =>
    filas.filter((f) => f.slug.startsWith(`sfts-${corrida}`));

  it('encuentra por una palabra del nombre, SIN embedding (AC-4 + AC-9)', async () => {
    // Es lo que hace que el catálogo sea buscable antes de que exista un solo vector.
    const resultados = mios(await repo.fullText('amoladora', 20));

    expect(resultados.map((r) => r.slug)).toContain(`sfts-${corrida}-amoladora`);
  });

  it('encuentra por el SKU exacto — el caso que el vector hace PEOR', async () => {
    // «taco fischer SX 8mm» es casi ruido para un embedding y una coincidencia perfecta para
    // el full-text. Por eso el `sku` entra en el `search_document`.
    const resultados = mios(await repo.fullText(SKU_EXACTO, 20));

    expect(resultados.map((r) => r.slug)).toContain(`sfts-${corrida}-sku`);
  });

  it('el stemming español funciona: el plural encuentra el singular', async () => {
    // «amoladoras» → 'amol', igual que «Amoladora» del nombre. Es la razón de ser de la
    // configuración `spanish`: con `simple` serían términos distintos.
    const resultados = mios(await repo.fullText('amoladoras', 20));
    expect(resultados.map((r) => r.slug)).toContain(`sfts-${corrida}-amoladora`);
  });

  it('el stemming NO es perfecto, y eso justifica que exista el camino vectorial', async () => {
    // Hallazgo medido, no supuesto: el stemmer español reduce «angular» a 'angul' pero
    // «angulares» a 'angular' — **no colapsan**, así que buscar el plural de este adjetivo no
    // encuentra el producto por la vía léxica. El test documenta el límite en vez de fingir que
    // no existe.
    //
    // Consecuencia de producto: el full-text es un buen rescate para SKUs y coincidencias
    // exactas, pero no reemplaza al vector. Cuando la degradación esté activa (sin cuota de
    // IA), consultas así van a fallar — y por eso `degraded: true` viaja en la respuesta: el
    // frontend tiene que poder avisar que está mostrando el resultado del plan B.
    const conPlural = mios(await repo.fullText('angulares', 20));
    const conSingular = mios(await repo.fullText('angular', 20));

    expect(conSingular.map((r) => r.slug)).toContain(`sfts-${corrida}-amoladora`);
    expect(conPlural).toHaveLength(0);
  });

  it('AC-6: un DRAFT no aparece ni con la palabra exacta', async () => {
    const resultados = mios(await repo.fullText('secreta', 20));
    expect(resultados).toHaveLength(0);
  });

  it('devuelve la MISMA forma que el kNN, ordenado por ts_rank', async () => {
    // Que las dos vías compartan forma es lo que permite un solo camino de mapeo a DTO: la
    // degradación no puede introducir una diferencia de forma en la respuesta.
    const [top] = mios(await repo.fullText('amoladora angular', 20));

    expect(top).toMatchObject({
      slug: `sfts-${corrida}-amoladora`,
      name: 'Amoladora angular de 115 mm',
      price_ars_cents: 99_000,
      stock: 2,
      category_name: `Herramientas ${corrida}`,
    });
    expect(top).toHaveProperty('image_url');
    expect(Number(top.score)).toBeGreaterThan(0);
  });

  describe('entrada hostil: no lanza y no inyecta', () => {
    const hostiles: Array<[string, string]> = [
      ['operadores sueltos', 'taco & | fischer'],
      ['comilla sin cerrar', '"'],
      ['paréntesis huérfano', 'taco )('],
      ['sólo símbolos', '!!! ???'],
      ['negación de tsquery', '!taco'],
      ['comentario SQL', 'taco -- fischer'],
      ['punto y coma', 'taco; fischer'],
    ];

    it.each(hostiles)('%s no lanza: %s', async (_caso, consulta) => {
      // Con `to_tsquery` varios de estos serían un 500 en la cara del cliente. Con
      // `websearch_to_tsquery` son texto libre: devuelven resultados o vacío, pero responden.
      await expect(repo.fullText(consulta, 20)).resolves.toBeInstanceOf(Array);
    });

    it('un intento de inyección se trata como TEXTO y la tabla sigue existiendo', async () => {
      // La consulta es la única cosa del cliente que entra al SQL. Va como parámetro ligado de
      // Prisma, así que esto es texto que no matchea nada, no una sentencia.
      const resultados = await repo.fullText("'; DROP TABLE products; --", 20);

      expect(Array.isArray(resultados)).toBe(true);

      const sigue = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*)::bigint AS n FROM products`,
      );
      expect(Number(sigue[0].n)).toBeGreaterThan(0);
    });

    it('una consulta larguísima no rompe la query', async () => {
      // El tope de longitud lo aplica el DTO (SEARCH_MAX_LENGTH), pero el repositorio no puede
      // asumir que alguien lo aplicó: es la última línea antes de la base.
      await expect(repo.fullText('a'.repeat(5_000), 20)).resolves.toBeInstanceOf(Array);
    });
  });

  it('rootCategoriesByVolume ofrece una salida y nunca inventa una categoría vacía', async () => {
    // Insumo del fallback de AC-3: si hay que ofrecerle una salida a quien no encontró nada,
    // conviene que sea por donde más productos hay para ver.
    const raices = await repo.rootCategoriesByVolume(3);

    expect(Array.isArray(raices)).toBe(true);
    for (const nombre of raices) {
      expect(typeof nombre).toBe('string');
      expect(nombre.trim().length).toBeGreaterThan(0);
    }
  });
});
