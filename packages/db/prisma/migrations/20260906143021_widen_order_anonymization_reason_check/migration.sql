-- DropCheck
ALTER TABLE "orders" DROP CONSTRAINT "orders_anonymization_reason_check";

-- CreateCheck
-- US-020 — suma 'account_deletion' como tercer motivo de anonimización: la
-- baja de cuenta anonimiza también las órdenes históricas del cliente
-- (`OrdersRepository.anonymizeAllForCustomer`), reusando la misma columna y
-- el mismo mecanismo que US-021 (retención) y el borrado admin.
ALTER TABLE "orders" ADD CONSTRAINT "orders_anonymization_reason_check"
  CHECK ("anonymization_reason" IS NULL
         OR "anonymization_reason" IN ('retention_policy', 'requested', 'account_deletion'));
