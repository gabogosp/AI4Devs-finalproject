-- NOTA: Prisma generó acá 3 líneas de drift contra columnas `Unsupported`
-- (product_embeddings.embedding es vector(768), products.search_document es
-- tsvector GENERATED) — no puede reconstruirlas desde el schema y proponía
-- dropear el índice HNSW de US-005 y el GIN de US-004. Se eliminan a mano:
-- ninguna tabla existente se toca en este change (T0.1 Exit criterion).

-- CreateSequence
-- Arranca en 1000: un «Pedido #3» le informa al comprador que la tienda vendió
-- dos veces en su vida (PRD §1.3 — las señales de confianza son conversión).
CREATE SEQUENCE "orders_order_number_seq" START WITH 1000;

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_number" INTEGER NOT NULL DEFAULT nextval('orders_order_number_seq'),
    "access_token_hash" TEXT NOT NULL,
    "customer_id" UUID,
    "buyer_name" TEXT NOT NULL,
    "buyer_email" TEXT NOT NULL,
    "buyer_phone" TEXT NOT NULL,
    "fulfillment" TEXT NOT NULL DEFAULT 'pickup',
    "status" TEXT NOT NULL DEFAULT 'pending_payment',
    "total_ars_cents" INTEGER NOT NULL,
    "consent_accepted" BOOLEAN NOT NULL,
    "consent_accepted_at" TIMESTAMP(3) NOT NULL,
    "consent_terms_version" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMP(3),

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price_ars_cents" INTEGER NOT NULL,
    "product_name" TEXT NOT NULL,
    "product_sku" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_number_key" ON "orders"("order_number");

-- CreateIndex
CREATE UNIQUE INDEX "orders_access_token_hash_key" ON "orders"("access_token_hash");

-- CreateIndex
CREATE INDEX "orders_status_created_at_idx" ON "orders"("status", "created_at");

-- CreateIndex
CREATE INDEX "orders_customer_id_idx" ON "orders"("customer_id");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_items_order_id_product_id_key" ON "order_items"("order_id", "product_id");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECKs agregados A MANO (Prisma no los declara en el schema), igual que
-- cart_items_quantity_check/cart_items_unit_price_check en 20260822223412_add_cart
-- y products_stock_check/products_price_check en 20260715230024_init_catalog.
ALTER TABLE "orders" ADD CONSTRAINT "orders_status_check" CHECK ("status" IN
  ('pending_payment','new','preparing','ready','delivered','cancelled'));
ALTER TABLE "orders" ADD CONSTRAINT "orders_fulfillment_check" CHECK ("fulfillment" IN ('pickup'));
ALTER TABLE "orders" ADD CONSTRAINT "orders_total_check" CHECK ("total_ars_cents" >= 0);
ALTER TABLE "orders" ADD CONSTRAINT "orders_consent_check" CHECK ("consent_accepted" = true);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_quantity_check" CHECK ("quantity" >= 1);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_price_check" CHECK ("unit_price_ars_cents" >= 0);
