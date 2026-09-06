-- US-024 — avatar por URL pegada. Nullable, sin default: las cuentas
-- existentes quedan sin avatar (placeholder en el FE), que es el estado
-- correcto para ellas.
ALTER TABLE "customers" ADD COLUMN "avatar_url" VARCHAR(2048);
