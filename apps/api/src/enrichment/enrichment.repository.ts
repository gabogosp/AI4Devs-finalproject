import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

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
    const leaseMs = this.config.get<number>('ENRICHMENT_LEASE_MS', 120_000);
    const maxAttempts = this.config.get<number>('ENRICHMENT_MAX_ATTEMPTS', 5);

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
    const maxAttempts = this.config.get<number>('ENRICHMENT_MAX_ATTEMPTS', 5);
    const filas = await this.prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT count(*)::bigint AS total FROM products
       WHERE enrichment_done = false AND enrichment_attempts < ${maxAttempts}::int`;
    return Number(filas[0]?.total ?? 0);
  }

  /** Cuántos productos quedaron abandonados tras agotar los intentos (AC-5). */
  async countAbandoned(): Promise<number> {
    const maxAttempts = this.config.get<number>('ENRICHMENT_MAX_ATTEMPTS', 5);
    const filas = await this.prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT count(*)::bigint AS total FROM products
       WHERE enrichment_done = false AND enrichment_attempts >= ${maxAttempts}::int`;
    return Number(filas[0]?.total ?? 0);
  }
}
