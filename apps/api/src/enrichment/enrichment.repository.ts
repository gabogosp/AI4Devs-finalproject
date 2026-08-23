import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { configNumber } from './config-number';

/**
 * Producto arrendado por una corrida de enriquecimiento. Es la proyección exacta que
 * devuelve el `RETURNING` del claim: sólo lo que el service necesita para decidir.
 */
export interface ClaimedProduct {
  id: string;
  name: string;
  description_raw: string | null;
  description_enriched: string | null;
  description_curated: boolean;
  enrichment_source_hash: string | null;
  enrichment_attempts: number;
  category_id: string;
}

/**
 * Dimensión que declara el esquema. Se re-exporta desde el repositorio para que los tests
 * de persistencia y de kNN construyan vectores del largo correcto sin importar el adapter
 * del proveedor (que es lo que valida la dimensión del lado de la red).
 */
export const EMBEDDING_DIMS_CHECK = 768;

/** Foto de la cobertura del catálogo (AC-3). */
export interface CoverageSnapshot {
  total: number;
  enriched: number;
  embedded: number;
  pending: number;
  abandoned: number;
  /** `embedded / total`, con 0 cuando el catálogo está vacío. */
  coverage_ratio: number;
}

/**
 * Proporción de cobertura, como función pura: la división por cero de un catálogo vacío
 * se resuelve acá, y se puede probar sin necesidad de vaciar la base (que es compartida).
 */
export function coverageRatio(embedded: number, total: number): number {
  if (total <= 0) return 0;
  return embedded / total;
}

/**
 * Único punto de SQL del enriquecimiento (US-005 T2.1) —
 * `backend-node-standards.md` §5: el repositorio envuelve el acceso a datos y **todo
 * parámetro va bindeado**, nunca interpolado en el string.
 *
 * El estado del trabajo vive en `products` (US-006 puso `enrichment_done` ahí siguiendo el
 * DER), así que no hay tabla de jobs: el claim se hace con la propia columna
 * `enrichment_next_attempt_at`, que cumple doble función — backoff durable **y** lease.
 */
@Injectable()
export class EnrichmentRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Arrienda hasta `batchSize` productos pendientes y los devuelve en la **misma
   * sentencia** que los arrienda.
   *
   * Tres propiedades que compra este SQL, y que valen más que su fealdad:
   *
   * - **`FOR UPDATE SKIP LOCKED` + lease al futuro**: dos corridas concurrentes obtienen
   *   conjuntos disjuntos. La corrección no depende de que Railway corra una sola
   *   réplica.
   * - **No hace falta un reaper**: si el proceso muere a mitad del lote, las filas quedan
   *   arrendadas y vuelven a ser elegibles solas cuando el lease vence. El trabajo
   *   huérfano se auto-cura, que es exactamente la crítica que ADR-0012 se hacía.
   * - **El backoff sobrevive al reinicio**, porque es una fecha en la base y no un
   *   `setTimeout` en memoria.
   *
   * El orden prioriza los **nunca intentados** (`NULLS FIRST`) y después los más viejos:
   * un producto recién importado se enriquece antes que uno que ya falló tres veces.
   */
  async claimBatch(batchSize: number): Promise<ClaimedProduct[]> {
    const leaseMs = configNumber(this.config, 'ENRICHMENT_LEASE_MS', 120_000);
    const maxAttempts = configNumber(this.config, 'ENRICHMENT_MAX_ATTEMPTS', 5);

    // `make_interval` recibe el lease en segundos como parámetro bindeado: concatenar
    // un intervalo en el string sería la puerta de entrada de una inyección.
    return this.prisma.$queryRaw<ClaimedProduct[]>`
      UPDATE products
         SET enrichment_next_attempt_at = now() + make_interval(secs => ${leaseMs / 1000}::double precision)
       WHERE id IN (
         SELECT id FROM products
          WHERE enrichment_done = false
            AND (enrichment_next_attempt_at IS NULL OR enrichment_next_attempt_at <= now())
            AND enrichment_attempts < ${maxAttempts}::int
          ORDER BY enrichment_next_attempt_at NULLS FIRST, created_at
          LIMIT ${batchSize}::int
            FOR UPDATE SKIP LOCKED
       )
      RETURNING id, name, description_raw, description_enriched, description_curated,
                enrichment_source_hash, enrichment_attempts, category_id`;
  }

  /** Cuántos productos quedan pendientes de enriquecer (insumo del `/status`). */
  async countPending(): Promise<number> {
    const maxAttempts = configNumber(this.config, 'ENRICHMENT_MAX_ATTEMPTS', 5);
    const filas = await this.prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT count(*)::bigint AS total FROM products
       WHERE enrichment_done = false AND enrichment_attempts < ${maxAttempts}::int`;
    return Number(filas[0]?.total ?? 0);
  }

  /** Cuántos productos quedaron abandonados tras agotar los intentos (AC-5). */
  async countAbandoned(): Promise<number> {
    const maxAttempts = configNumber(this.config, 'ENRICHMENT_MAX_ATTEMPTS', 5);
    const filas = await this.prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT count(*)::bigint AS total FROM products
       WHERE enrichment_done = false AND enrichment_attempts >= ${maxAttempts}::int`;
    return Number(filas[0]?.total ?? 0);
  }

  /**
   * Guarda (o refresca) el embedding de un producto — US-005 T2.2.
   *
   * `vector` no es un tipo de Prisma, así que va por `$executeRaw` con el literal
   * casteado (E2E §16). El `ON CONFLICT` hace la operación **idempotente**: re-embeddear
   * un producto actualiza su fila en vez de fallar, que es lo que necesita el camino de
   * curación (AC-7) y el de re-embeddeo por cambio de modelo (AC-8).
   *
   * `model_version` se persiste en cada escritura: sin eso, cambiar de modelo dejaría un
   * catálogo con vectores de dos espacios distintos mezclados y sin forma de distinguirlos
   * — la búsqueda devolvería resultados incoherentes y no habría manera de saber cuáles
   * re-generar.
   */
  async saveEmbedding(
    productId: string,
    vector: number[],
    modelVersion: string,
  ): Promise<void> {
    const literal = `[${vector.join(',')}]`;
    await this.prisma.$executeRaw`
      INSERT INTO product_embeddings (product_id, embedding, model_version, generated_at)
      VALUES (${productId}::uuid, ${literal}::vector, ${modelVersion}, now())
      ON CONFLICT (product_id) DO UPDATE
         SET embedding = EXCLUDED.embedding,
             model_version = EXCLUDED.model_version,
             generated_at = now()`;
  }

  /** ¿El producto ya tiene vector? Decide si un hash sin cambios igual necesita embeddear. */
  async hasEmbedding(productId: string): Promise<boolean> {
    const filas = await this.prisma.$queryRaw<Array<{ existe: boolean }>>`
      SELECT true AS existe FROM product_embeddings WHERE product_id = ${productId}::uuid`;
    return filas.length > 0;
  }

  /**
   * Nombres de rubro por id, en **una** query para todo el lote.
   *
   * El texto fuente necesita el nombre de la categoría (D3) y el `RETURNING` del claim sólo
   * trae `category_id`. Resolverlos de a uno serían N round-trips por lote.
   */
  async categoryNames(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const filas = await this.prisma.category.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    return new Map(filas.map((f) => [f.id, f.name]));
  }

  /**
   * kNN por distancia coseno — US-005 T2.3.
   *
   * Este helper **no expone ningún endpoint**: `/search` es de US-004. Se entrega acá
   * porque es la prueba de que el vector guardado sirve para buscar, y porque el ticket
   * `DB-US-005` pide el `EXPLAIN` que demuestra que el índice HNSW se usa.
   *
   * `1 - (embedding <=> qvec)` convierte la distancia coseno en similitud: el `ORDER BY`
   * va por la **distancia** (que es lo que el índice sabe ordenar), y el `score` que se
   * devuelve es la similitud, que es lo que un consumidor entiende.
   *
   * Sólo productos `published`: es la restricción que US-004 hereda — un borrador con
   * embedding no puede aparecer en la búsqueda pública.
   */
  async findNearest(
    vector: number[],
    limit: number,
  ): Promise<Array<{ id: string; slug: string; score: number }>> {
    const literal = `[${vector.join(',')}]`;
    return this.prisma.$queryRaw<Array<{ id: string; slug: string; score: number }>>`
      SELECT p.id, p.slug, 1 - (e.embedding <=> ${literal}::vector) AS score
        FROM product_embeddings e
        JOIN products p ON p.id = e.product_id
       WHERE p.status = 'published'
       ORDER BY e.embedding <=> ${literal}::vector
       LIMIT ${limit}::int`;
  }

  /**
   * Cobertura del catálogo — US-005 T2.4, insumo del `/status` (AC-3).
   *
   * Una sola sentencia con agregados condicionales en vez de cuatro `count`: son cuatro
   * round-trips que además pueden verse inconsistentes entre sí si el catálogo cambia en
   * el medio.
   */
  async coverage(): Promise<CoverageSnapshot> {
    const maxAttempts = configNumber(this.config, 'ENRICHMENT_MAX_ATTEMPTS', 5);
    const filas = await this.prisma.$queryRaw<
      Array<{
        total: bigint;
        enriched: bigint;
        embedded: bigint;
        pending: bigint;
        abandoned: bigint;
      }>
    >`
      SELECT count(*)::bigint AS total,
             count(*) FILTER (WHERE p.enrichment_done)::bigint AS enriched,
             count(e.product_id)::bigint AS embedded,
             count(*) FILTER (
               WHERE NOT p.enrichment_done AND p.enrichment_attempts < ${maxAttempts}::int
             )::bigint AS pending,
             count(*) FILTER (
               WHERE NOT p.enrichment_done AND p.enrichment_attempts >= ${maxAttempts}::int
             )::bigint AS abandoned
        FROM products p
        LEFT JOIN product_embeddings e ON e.product_id = p.id`;

    const f = filas[0];
    const total = Number(f?.total ?? 0);
    const embedded = Number(f?.embedded ?? 0);

    return {
      total,
      enriched: Number(f?.enriched ?? 0),
      embedded,
      pending: Number(f?.pending ?? 0),
      abandoned: Number(f?.abandoned ?? 0),
      coverage_ratio: coverageRatio(embedded, total),
    };
  }
}
