-- US-003 Fase 10 (T10.1): URL pública por slug de producto (AC-1).
-- Aditiva en tres pasos porque `products` ya tiene filas: agregar nullable →
-- backfill determinista desde `name` → NOT NULL + UNIQUE. Espeja el precedente
-- `categories.slug`.

-- 1. Columna nullable (las filas existentes aún no tienen valor).
ALTER TABLE "products" ADD COLUMN "slug" TEXT;

-- 2. Backfill derivado del `name`, replicando `slugify()` de la app
--    (apps/api/src/common/slug.ts): sin acentos, minúsculas, no-alfanumérico
--    colapsado a "-", sin guiones en los bordes. `translate` cubre el juego
--    acentuado del español sin depender de la extensión `unaccent`.
--    La colisión se desambigua con sufijo "-2", "-3"… por orden estable
--    (created_at, id): la fila más antigua conserva el slug base.
WITH normalized AS (
  SELECT
    "id",
    NULLIF(
      TRIM(BOTH '-' FROM REGEXP_REPLACE(
        LOWER(TRANSLATE("name",
          'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
          'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC')),
        '[^a-z0-9]+', '-', 'g')),
      ''
    ) AS base,
    ROW_NUMBER() OVER (
      PARTITION BY NULLIF(
        TRIM(BOTH '-' FROM REGEXP_REPLACE(
          LOWER(TRANSLATE("name",
            'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
            'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC')),
          '[^a-z0-9]+', '-', 'g')),
        ''
      )
      ORDER BY "created_at", "id"
    ) AS ordinal
  FROM "products"
)
UPDATE "products" p
SET "slug" = CASE
  -- Nombre sin ningún carácter alfanumérico: no hay base derivable; se usa el
  -- `sku` (único por constraint) para no dejar la fila sin slug.
  WHEN n.base IS NULL THEN LOWER(REGEXP_REPLACE(p."sku", '[^a-zA-Z0-9]+', '-', 'g'))
  WHEN n.ordinal = 1 THEN n.base
  ELSE n.base || '-' || n.ordinal::text
END
FROM normalized n
WHERE p."id" = n."id";

-- 3. Constraints: ninguna fila queda nula ni duplicada.
ALTER TABLE "products" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");
