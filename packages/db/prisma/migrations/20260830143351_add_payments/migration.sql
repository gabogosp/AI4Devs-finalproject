-- NOTA: Prisma generó acá drift contra columnas `Unsupported` (product_embeddings.embedding
-- es vector(768), products.search_document es tsvector GENERATED) y contra el default de
-- orders.order_number (sequence con `dbgenerated`, que Prisma no puede diffear al pixel) —
-- no puede reconstruirlas desde el schema y proponía dropear el índice HNSW de US-005, el
-- GIN de US-004 y recrear la sequence de US-008. Se eliminan a mano, igual que en
-- 20260829172227_add_orders: ninguna tabla existente se toca en este change (T0.1 Exit
-- criterion — sólo `payments` es nueva).

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "external_id" TEXT,
    "status" TEXT NOT NULL,
    "amount_ars_cents" INTEGER NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "processed_at" TIMESTAMP(3),
    "confirmed_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotency_key_key" ON "payments"("idempotency_key");

-- CreateIndex
CREATE INDEX "payments_external_id_idx" ON "payments"("external_id");

-- CreateIndex
CREATE INDEX "payments_order_id_idx" ON "payments"("order_id");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECKs agregados A MANO (Prisma no los declara en el schema), igual que
-- orders_status_check en 20260829172227_add_orders/migration.sql. El de `provider`
-- incluye los TRES valores del dominio (E2E §8 DER + design.md §Persistence
-- "Reconciliación con US-009") aunque este change sólo escribe 'manual'.
ALTER TABLE "payments" ADD CONSTRAINT "payments_provider_check" CHECK ("provider" IN
  ('mercadopago','simulated_dsm','manual'));
ALTER TABLE "payments" ADD CONSTRAINT "payments_status_check" CHECK ("status" IN
  ('pending','approved','rejected','refunded'));
