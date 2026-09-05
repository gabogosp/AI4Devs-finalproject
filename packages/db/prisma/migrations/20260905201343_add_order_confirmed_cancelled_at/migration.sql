-- NOTA: Prisma generó acá drift contra columnas `Unsupported` (product_embeddings.embedding
-- es vector(768), products.search_document es tsvector GENERATED) y contra el default de
-- orders.order_number (sequence con `dbgenerated`, que Prisma no puede diffear al pixel) —
-- igual que en 20260829172227_add_orders y 20260830143351_add_payments. Se elimina a mano:
-- ninguna tabla existente se toca salvo las dos columnas nuevas de `orders` y el CHECK de
-- `payments.status` (T1.1 Exit criterion).

-- AlterTable
ALTER TABLE "orders" ADD COLUMN "cancelled_at" TIMESTAMP(3),
ADD COLUMN "confirmed_at" TIMESTAMP(3);

-- CHECK reemplazado A MANO (Prisma no lo declara en el schema): Postgres no permite
-- extender un CHECK en el lugar, igual que en 20260830143351_add_payments — se dropea y se
-- recrea con el valor nuevo agregado.
ALTER TABLE "payments" DROP CONSTRAINT "payments_status_check";
ALTER TABLE "payments" ADD CONSTRAINT "payments_status_check" CHECK ("status" IN
  ('pending','approved','rejected','refunded','refund_pending'));
