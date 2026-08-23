-- AlterTable
ALTER TABLE "products" ADD COLUMN     "description_curated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "description_enriched" TEXT,
ADD COLUMN     "enrichment_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "enrichment_error_code" TEXT,
ADD COLUMN     "enrichment_next_attempt_at" TIMESTAMP(3),
ADD COLUMN     "enrichment_source_hash" TEXT;

-- CreateTable
CREATE TABLE "product_embeddings" (
    "product_id" UUID NOT NULL,
    "embedding" vector(768) NOT NULL,
    "model_version" TEXT NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_embeddings_pkey" PRIMARY KEY ("product_id")
);

-- AddForeignKey
ALTER TABLE "product_embeddings" ADD CONSTRAINT "product_embeddings_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex (a mano — Prisma no expresa HNSW)
-- Índice del kNN de la búsqueda semántica (US-004). `vector_cosine_ops` porque la
-- distancia del E2E §8 es la coseno. `m`/`ef_construction` son los defaults de
-- pgvector, adecuados a ~5.000 vectores (OQ-BE-4: re-tunear con la batería de
-- relevancia de US-004 en la mano, no antes).
CREATE INDEX "product_embeddings_embedding_hnsw_idx"
  ON "product_embeddings" USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- CreateIndex (a mano — Prisma no expresa índices parciales)
-- La cola de pendientes es una query (ADR-0014), y en estado estable el 99% del
-- catálogo ya está enriquecido: sin el parcial, cada claim escanearía el catálogo
-- completo para encontrar un puñado de filas.
CREATE INDEX "products_enrichment_pending_idx"
  ON "products" ("enrichment_next_attempt_at")
  WHERE "enrichment_done" = false;
