import { PrismaService } from '../prisma/prisma.service';
import { asegurarCategoria, idDeCorrida } from '../../test/enrichment-fixtures';

/**
 * T0.1 — el esquema full-text de la búsqueda (AC-4).
 *
 * Los dos primeros tests miran el catálogo del sistema (`information_schema`, `pg_indexes`):
 * verifican que la columna **es generada** y que el índice GIN existe. El tercero es el que
 * de verdad importa, y es de **comportamiento**: cambiar el `name` de un producto con un
 * `UPDATE` crudo tiene que actualizar el `tsvector` **sin que corra una línea de código de
 * aplicación**.
 *
 * Por qué ese tercer test vale más que los otros dos: si mañana alguien reemplaza la columna
 * generada por un trigger, los dos primeros seguirían pasando (la columna existiría, el índice
 * también) y el tercero también… hasta que aparezca una vía de escritura que no dispare el
 * trigger. El test se escribe con `$executeRawUnsafe` —la vía más cruda posible, sin Prisma
 * client de por medio— justamente para que «ninguna capa de aplicación participa» sea literal.
 */
describe('Esquema full-text de la búsqueda (search-schema)', () => {
  const prisma = new PrismaService();
  const corrida = idDeCorrida();

  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('`products.search_document` existe y es una columna GENERADA', async () => {
    const filas = await prisma.$queryRawUnsafe<
      Array<{ column_name: string; data_type: string; is_generated: string }>
    >(
      `SELECT column_name, data_type, is_generated
         FROM information_schema.columns
        WHERE table_name = 'products' AND column_name = 'search_document'`,
    );

    expect(filas).toHaveLength(1);
    expect(filas[0].data_type).toBe('tsvector');
    // ALWAYS = la base la mantiene. Si esto dijera NEVER, alguien la convirtió en una columna
    // común y ahora depende de que todo camino de escritura se acuerde de actualizarla.
    expect(filas[0].is_generated).toBe('ALWAYS');
  });

  it('la expresión generadora usa `spanish` y las tres columnas previstas', async () => {
    const filas = await prisma.$queryRawUnsafe<Array<{ generation_expression: string }>>(
      `SELECT generation_expression
         FROM information_schema.columns
        WHERE table_name = 'products' AND column_name = 'search_document'`,
    );

    const expresion = filas[0].generation_expression;
    // `spanish` aplica stemming y stop-words del idioma del catálogo: con `simple`,
    // «tornillos» y «tornillo» serían términos distintos y la búsqueda perdería la mitad.
    expect(expresion).toContain('spanish');
    expect(expresion).toContain('name');
    expect(expresion).toContain('description_enriched');
    // `sku` entra porque es el caso léxico puro que el vector hace PEOR.
    expect(expresion).toContain('sku');
    // `coalesce` en las tres: sin él un solo NULL vuelve NULL toda la concatenación y el
    // producto desaparece de la búsqueda por texto. Hoy, antes de la primera corrida del
    // enriquecimiento, `description_enriched` es NULL en TODO el catálogo.
    // Postgres normaliza la expresión al guardarla (`coalesce` → `COALESCE`), así que se
    // compara sin distinguir mayúsculas: lo que importa es que las tres columnas estén
    // envueltas, no cómo lo escribió quien redactó la migración.
    expect(expresion.toLowerCase()).toContain('coalesce(name');
    expect(expresion.toLowerCase()).toContain('coalesce(description_enriched');
    expect(expresion.toLowerCase()).toContain('coalesce(sku');
  });

  it('existe el índice GIN sobre la columna', async () => {
    const filas = await prisma.$queryRawUnsafe<Array<{ indexdef: string }>>(
      `SELECT indexdef FROM pg_indexes
        WHERE tablename = 'products' AND indexname = 'products_search_document_gin_idx'`,
    );

    expect(filas).toHaveLength(1);
    expect(filas[0].indexdef).toContain('gin');
    expect(filas[0].indexdef).toContain('search_document');
  });

  it('SE MANTIENE SOLA: un UPDATE crudo del nombre actualiza el tsvector', async () => {
    // El test de comportamiento. Ninguna capa de aplicación participa: se escribe con SQL
    // crudo y se pregunta a la base si el documento cambió.
    const categoryId = await asegurarCategoria(
      prisma,
      `fts-${corrida}`,
      `FTS ${corrida}`,
    );
    const clave = `FTS-${corrida}`;
    const producto = await prisma.product.create({
      data: {
        sku: clave,
        slug: clave.toLowerCase(),
        name: 'Amoladora angular',
        price_ars_cents: 150_000,
        stock: 1,
        status: 'published',
        category_id: categoryId,
      },
    });

    const encuentra = async (palabra: string): Promise<boolean> => {
      const filas = await prisma.$queryRawUnsafe<Array<{ match: boolean }>>(
        `SELECT (search_document @@ websearch_to_tsquery('spanish', $2)) AS match
           FROM products WHERE id = $1::uuid`,
        producto.id,
        palabra,
      );
      return filas[0]?.match === true;
    };

    expect(await encuentra('amoladora')).toBe(true);
    expect(await encuentra('caladora')).toBe(false);

    // Se cambia el nombre por la vía más cruda que existe.
    await prisma.$executeRawUnsafe(
      `UPDATE products SET name = 'Caladora de banco' WHERE id = $1::uuid`,
      producto.id,
    );

    expect(await encuentra('caladora')).toBe(true);
    expect(await encuentra('amoladora')).toBe(false);
  });

  it('el stemming español funciona: singular y plural son el mismo término', async () => {
    // Es la razón de ser de la configuración `spanish`, y se prueba porque es invisible: con
    // `simple` este test fallaría y el síntoma en producción sería «busqué tornillos y no
    // aparece el tornillo que sí tengo».
    const categoryId = await asegurarCategoria(
      prisma,
      `fts-${corrida}`,
      `FTS ${corrida}`,
    );
    const clave = `FTS-STEM-${corrida}`;
    const producto = await prisma.product.create({
      data: {
        sku: clave,
        slug: clave.toLowerCase(),
        name: 'Tornillos autoperforantes',
        price_ars_cents: 5_000,
        stock: 10,
        status: 'published',
        category_id: categoryId,
      },
    });

    const filas = await prisma.$queryRawUnsafe<Array<{ singular: boolean; plural: boolean }>>(
      `SELECT (search_document @@ websearch_to_tsquery('spanish', 'tornillo')) AS singular,
              (search_document @@ websearch_to_tsquery('spanish', 'tornillos')) AS plural
         FROM products WHERE id = $1::uuid`,
      producto.id,
    );

    expect(filas[0].singular).toBe(true);
    expect(filas[0].plural).toBe(true);
  });

  it('el client de Prisma NO expone `search_document`', async () => {
    // Es una columna generada: un `UPDATE` sobre ella es un error de Postgres. Dejarla fuera
    // de los tipos hace ese error imposible por construcción, no por disciplina.
    const producto = await prisma.product.findFirst({
      where: { sku: { startsWith: `FTS-${corrida}` } },
    });

    expect(producto).not.toBeNull();
    expect(producto).not.toHaveProperty('search_document');
  });
});
