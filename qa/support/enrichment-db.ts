// `@dsm/db` es CJS y `@dsm/qa` es ESM: los named exports no son analizables
// estáticamente — mismo patrón que `backdate-order.ts`.
import db from '@dsm/db';

const { PrismaClient } = db as unknown as { PrismaClient: new () => PrismaLike };

interface PrismaLike {
  product: {
    findUniqueOrThrow(args: {
      where: { id: string };
      select: Record<string, boolean>;
    }): Promise<Record<string, unknown>>;
    update(args: {
      where: { id: string };
      data: { enrichment_next_attempt_at: Date };
    }): Promise<unknown>;
  };
  $queryRaw<T>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  $disconnect(): Promise<void>;
}

const prisma = new PrismaClient();

/**
 * T0.2 (`qa-plan.md` §10, `design.md` §D-QA2) — excepción angosta y documentada:
 * el contrato de `catalogo` (QA-005-F2) nunca expone estas 7 columnas, así que
 * ésta es la ÚNICA forma negro-caja-adyacente de observarlas. Existe **sólo**
 * para leer lo que la API no devuelve — nunca para fabricar el efecto que un
 * escenario prueba (eso lo sigue haciendo el `PATCH`/`POST /runs` real contra
 * el proveedor real).
 */
export interface EstadoEnriquecimiento {
  description_enriched: string | null;
  description_curated: boolean;
  enrichment_done: boolean;
  enrichment_source_hash: string | null;
  enrichment_attempts: number;
  enrichment_error_code: string | null;
  enrichment_next_attempt_at: Date | null;
}

export async function leerEstadoEnriquecimiento(
  productId: string,
): Promise<EstadoEnriquecimiento> {
  const fila = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    select: {
      description_enriched: true,
      description_curated: true,
      enrichment_done: true,
      enrichment_source_hash: true,
      enrichment_attempts: true,
      enrichment_error_code: true,
      enrichment_next_attempt_at: true,
    },
  });
  return fila as unknown as EstadoEnriquecimiento;
}

/**
 * D-QA5 — excepción angosta de **tiempo**: adelanta `enrichment_next_attempt_at`
 * a `now()` para que `claimBatch` vuelva a considerar elegible al producto de
 * inmediato, en vez de esperar la escalera real de backoff (hasta ~2h31m para
 * llegar al 5º intento). Nunca toca `enrichment_attempts` ni
 * `enrichment_error_code` — esos los escribe el `POST /runs` real, contra el
 * proveedor real, en cada iteración. Mismo criterio exacto que
 * `backdate-order.ts` de `US-010-orden-webhook-stock-qa` (D-QA5 de ese plan).
 */
export async function adelantarProximoIntento(productId: string): Promise<void> {
  await prisma.product.update({
    where: { id: productId },
    data: { enrichment_next_attempt_at: new Date() },
  });
}

/** Verdad de base para contrastar contra `coverage.embedded` de `/status` (SC-005-H3). */
export async function contarEmbeddings(): Promise<number> {
  const filas = await prisma.$queryRaw<Array<{ total: bigint }>>`
    SELECT count(*)::bigint AS total FROM product_embeddings`;
  return Number(filas[0]?.total ?? 0);
}

/**
 * Extensión angosta sobre la lista de §10 de `qa-plan.md` (además de las 3 funciones
 * declaradas ahí): `contarEmbeddings()` sólo da la verdad AGREGADA, y SC-005-C2 necesita
 * afirmar "sin fila en los embeddings" para UN producto puntual — sin esto no hay forma
 * negro-caja-adyacente de probar la ausencia específica. Espejo de solo-lectura de
 * `EnrichmentRepository.hasEmbedding` (misma consulta), nunca escribe.
 */
export async function tieneEmbedding(productId: string): Promise<boolean> {
  const filas = await prisma.$queryRaw<Array<{ existe: boolean }>>`
    SELECT true AS existe FROM product_embeddings WHERE product_id = ${productId}::uuid`;
  return filas.length > 0;
}

export async function disconnectEnrichmentDb(): Promise<void> {
  await prisma.$disconnect();
}
