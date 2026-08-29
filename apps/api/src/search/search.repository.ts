import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { configNumber } from '../enrichment/config-number';
import { CategoriaSugerida, ScoredProduct } from './relevance';

/**
 * Único punto de SQL de la búsqueda (US-004 T2.2/T2.3) —
 * `backend-node-standards.md` §5: el repositorio envuelve el ORM.
 *
 * Las dos vías —vectorial y full-text— viven acá y devuelven **la misma forma**, así que el
 * servicio tiene un solo camino de mapeo a DTO y la degradación no puede introducir una
 * diferencia de forma en la respuesta.
 *
 * **Nada del usuario se concatena en el SQL.** Las dos consultas usan parámetros ligados de
 * Prisma (`$queryRaw` con template tag), incluida la del texto libre: `websearch_to_tsquery`
 * recibe la consulta como **parámetro**, no interpolada. Es la diferencia entre un buscador y
 * una inyección esperando a que alguien escriba `'; DROP TABLE products; --`.
 */
@Injectable()
export class SearchRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * kNN sobre el índice HNSW de `product_embeddings`.
   *
   * Tres decisiones están en el SQL y no en el servicio, a propósito:
   *
   * 1. **`JOIN` y no `LEFT JOIN`** contra `product_embeddings`: un producto sin vector no
   *    aparece por esta vía y **no rompe nada** (AC-9). Con `LEFT JOIN` aparecería con
   *    distancia `NULL` y el orden pasaría a depender de dónde ponga Postgres los nulos.
   * 2. **`WHERE p.status = 'published'`** dentro de la query (AC-6). Filtrar en el servicio
   *    significaría traer borradores a memoria y confiar en que nadie los devuelva; acá los
   *    borradores no salen de la base.
   * 3. **`SET LOCAL hnsw.ef_search`**: la perilla de precisión contra latencia se fija **por
   *    transacción**, no en la config del servidor. `LOCAL` es lo que garantiza que no se
   *    filtre a otras consultas del mismo pool de conexiones.
   */
  async knn(vector: number[], limit: number): Promise<ScoredProduct[]> {
    const efSearch = configNumber(this.config, 'SEARCH_HNSW_EF_SEARCH', 64);
    // El literal del vector se construye desde números ya validados por el adapter (768
    // dimensiones finitas): no hay texto del usuario en este string.
    const literal = `[${vector.join(',')}]`;

    return this.prisma.$transaction(async (tx) => {
      // `SET LOCAL` necesita el valor inline (Postgres no acepta un parámetro ligado en un
      // SET), así que se fuerza a entero antes de interpolar. `efSearch` viene de `envSchema`
      // validado y de `configNumber`, nunca del request.
      const ef = Math.max(1, Math.trunc(efSearch));
      await tx.$executeRawUnsafe(`SET LOCAL hnsw.ef_search = ${ef}`);

      return tx.$queryRaw<ScoredProduct[]>`
        SELECT p.slug,
               p.name,
               p.price_ars_cents,
               p.stock,
               p.image_url,
               c.name AS category_name,
               c.slug AS category_slug,
               1 - (e.embedding <=> ${literal}::vector) AS score
          FROM product_embeddings e
          JOIN products p ON p.id = e.product_id
          LEFT JOIN categories c ON c.id = p.category_id
         WHERE p.status = 'published'
         ORDER BY e.embedding <=> ${literal}::vector
         LIMIT ${limit}::int`;
    });
  }

  /**
   * Camino full-text: la degradación de AC-4 y el rescate léxico.
   *
   * `websearch_to_tsquery` y **no** `to_tsquery`: acepta texto libre —comillas sin cerrar,
   * `&`, `|`, paréntesis huérfanos— sin lanzar, que es exactamente lo que llega por un
   * buscador. Con `to_tsquery`, un cliente que escriba `taco & | fischer` recibiría un 500.
   *
   * Encuentra por SKU y por palabra del nombre **aunque el producto no tenga embedding**, que
   * es lo que hace que AC-9 y AC-4 se sostengan juntos: el catálogo sigue siendo buscable
   * antes de la primera corrida del enriquecimiento.
   *
   * **El `score` se normaliza al mejor del conjunto, y eso no es cosmética.** `ts_rank` y la
   * similitud cosine viven en escalas distintas: un match léxico exacto de SKU puntúa ~0,10 y
   * un buen match vectorial ~0,85. Medido. Sin normalizar, dos cosas se rompen en silencio:
   *
   * 1. El umbral `SEARCH_MIN_SCORE` (0,55, calibrado para cosine) haría que el camino degradado
   *    **nunca** reporte `confidence: high` — ni con la coincidencia más exacta posible—, así
   *    que la respuesta del plan B siempre se vería dudosa aunque sea perfecta.
   * 2. El `blend` de `SEARCH_LEXICAL_WEIGHT` sumaría 0,10 contra 0,85: la perilla existiría en
   *    la config y no haría nada perceptible.
   *
   * La normalización es **relativa al resultado** (el mejor vale 1) porque un `ts_rank` no
   * tiene techo absoluto contra el que dividir. La consecuencia hay que decirla: el `score` del
   * camino léxico es un **rango relativo**, no una similitud absoluta comparable entre
   * consultas distintas.
   */
  async fullText(consulta: string, limit: number): Promise<ScoredProduct[]> {
    return this.prisma.$queryRaw<ScoredProduct[]>`
      WITH crudos AS (
        SELECT p.slug,
               p.name,
               p.price_ars_cents,
               p.stock,
               p.image_url,
               c.name AS category_name,
               c.slug AS category_slug,
               ts_rank(p.search_document, q) AS rank
          FROM products p
          LEFT JOIN categories c ON c.id = p.category_id,
               websearch_to_tsquery('spanish', ${consulta}) AS q
         WHERE p.status = 'published'
           AND p.search_document @@ q
         ORDER BY rank DESC
         LIMIT ${limit}::int
      )
      SELECT slug,
             name,
             price_ars_cents,
             stock,
             image_url,
             category_name,
             category_slug,
             -- NULLIF evita la division por cero cuando todos los rangos son 0 (posible con
             -- pesos de tsvector nulos): en ese caso el score queda NULL, ordena al final por
             -- NULLS LAST y el resultado se clasifica como poco confiable, que es lo correcto.
             (rank / NULLIF(MAX(rank) OVER (), 0))::double precision AS score
        FROM crudos
       ORDER BY score DESC NULLS LAST`;
  }

  /**
   * Categorías raíz con productos publicados, para el fallback de AC-3.
   *
   * Se ordenan por cantidad de productos: si hay que ofrecerle una salida a alguien que no
   * encontró lo que buscaba, conviene que sea por donde más hay para ver.
   */
  async rootCategoriesByVolume(limit = 3): Promise<CategoriaSugerida[]> {
    return this.prisma.$queryRaw<CategoriaSugerida[]>`
      SELECT c.slug, c.name
        FROM categories c
        JOIN products p ON p.category_id = c.id AND p.status = 'published'
       WHERE c.parent_id IS NULL
       GROUP BY c.id, c.slug, c.name
       ORDER BY count(p.id) DESC, c.name
       LIMIT ${limit}::int`;
  }
}
