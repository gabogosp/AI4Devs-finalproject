-- AlterTable
ALTER TABLE "orders"
  ADD COLUMN "anonymized_at" TIMESTAMP(3),
  ADD COLUMN "anonymization_reason" TEXT;

-- CreateCheck
ALTER TABLE "orders" ADD CONSTRAINT "orders_anonymization_reason_check"
  CHECK ("anonymization_reason" IS NULL
         OR "anonymization_reason" IN ('retention_policy', 'requested'));

-- CreateCheck
ALTER TABLE "orders" ADD CONSTRAINT "orders_anonymization_consistency_check"
  CHECK (("anonymized_at" IS NULL) = ("anonymization_reason" IS NULL));
