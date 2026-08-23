-- US-004 T0.1 — documento full-text de la búsqueda semántica.
--
-- Migración ADITIVA: una columna generada y su índice. No toca ninguna otra tabla ni
-- columna, así que es segura hacia atrás — el código que hoy corre no la conoce.
--
-- Se escribe a mano porque Prisma no expresa ni `tsvector` ni `GENERATED ... STORED`,
-- igual que el HNSW de US-005 y los CHECK de US-007.

-- `GENERATED ALWAYS ... STORED` y NO un trigger: una columna generada no puede quedar
-- desincronizada del dato que la origina. Un trigger sí —el día que alguien escriba por
-- una vía que no lo dispare— y el síntoma sería «la búsqueda por texto no encuentra un
-- producto que existe», de los más difíciles de atribuir a su causa.
--
-- Configuración `spanish`: aplica stemming y stop-words del idioma del catálogo. Con
-- `simple` (el default), «tornillos» y «tornillo» serían términos distintos.
--
-- Incluye `sku` a propósito: es el caso léxico puro que el vector hace PEOR
-- («taco fischer SX 8mm»). Y usa `description_enriched` —la que produce US-005— porque es
-- el texto rico; la `description_raw` del catálogo es justamente la que no alcanza.
--
-- `coalesce` en las tres: sin él, un solo NULL vuelve NULL toda la concatenación y el
-- producto desaparece de la búsqueda por texto. Es el modo de fallar más silencioso que
-- tiene esta columna, y afectaría a todo producto sin descripción enriquecida — que hoy,
-- antes de la primera corrida del enriquecimiento, son TODOS.
ALTER TABLE "products" ADD COLUMN "search_document" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('spanish',
      coalesce("name", '') || ' ' || coalesce("description_enriched", '') || ' ' || coalesce("sku", ''))
  ) STORED;

-- GIN y no GiST: GIN es el índice de búsqueda de texto de Postgres (lookups más rápidos a
-- costa de escrituras más caras), y este catálogo se lee mucho más de lo que se escribe.
CREATE INDEX "products_search_document_gin_idx" ON "products" USING GIN ("search_document");
