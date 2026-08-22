---
parent-us: US-006
discipline: backend
variant: null
language: es
---

# US-006 Backend — Tasks

> Cada task es closure-grade: atómica, con `Exit criterion:` observable y `Verify:` con el
> comando exacto que `/develop-backend` corre. Los comandos asumen la **raíz del repo** como
> cwd. El runner es el de US-001: `pnpm --filter @dsm/api test -- …` ejecuta Jest en su forma
> terminante (no watch — F49); el config de unit (`jest.config.js`,
> `testRegex: src/.*\.spec\.ts$`) incluye también los specs `e2e-*` colocados en `src/`.
> Integration/e2e corren contra el Postgres real de `docker-compose` (`:55432`), que debe
> estar arriba (`make up`). **No se usa `psql` del host** (no existe en esta máquina): la
> verificación de esquema va por un spec que consulta `information_schema` vía Prisma.
>
> **Estimación dual**: **9,5 h AI-asistido** / **19 h tradicional**. La US §7 presupuesta
> `BE-US-006 12-16h`: el tradicional excede el techo ~3 h por trabajo que la US daba por
> resuelto con BullMQ — el modelo de trabajo en Postgres, el runner por lotes, el reaper y
> los dos endpoints de lectura del progreso/reporte. Con la cola aprovisionada ese trabajo
> lo habría aportado la infraestructura.

## Pre-requisitos

- [x] **US-001 backend archivado** (AS-BUILT verificado al planificar): `apps/api` corre con
  `HttpProblemFilter` (RFC 7807 `dsm:catalog/*`), `ValidationPipe` global
  (`whitelist` + `forbidNonWhitelisted`, 422), helmet §7.1, allowlist CORS §7.2, throttlers
  nombrados `auth` y `storefront`, y `AdminGuard` (ADR-0009).
  **Verify**: `pnpm --filter @dsm/api typecheck && pnpm --filter @dsm/api test -- --testPathPattern='e2e-rbac|e2e-security-edge'`
- [x] **US-003 backend en `apps/api`**: `products.slug` UNIQUE existe y
  `ProductsService.deriveUniqueSlug` deriva con sufijo ordinal.
  **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern='products.service|e2e-products-create'`
- [x] **Postgres local arriba**: `docker compose up -d postgres`.
- [x] **Preguntas abiertas cerradas (2026-08-20)** — OQ-BE-1 = contrato asíncrono + ejecutor
  in-process (ADR-0012) · OQ-BE-2 = celda vacía significa "no cambiar ese campo" · **OQ-BE-3 =
  5.000 filas / 4 MiB / 32 MiB descomprimidos** (el PO eligió el tope ajustado, **no** el
  holgado que proponía el diseño: queda sin margen sobre el catálogo objetivo — ver la
  advertencia bajo la tabla de `design.md` §NFRs cuantificados) · OQ-BE-4 = marca durable
  `enrichment_done=false` + puerto no-op · OQ-BE-5 = rechazar el archivo no-UTF-8 · OQ-BE-6 =
  retención de 90 días. No queda ninguna decisión pendiente: el plan se ejecuta completo y en
  orden, empezando por T0.1.

---

## Fase 0: ADR, esquema y configuración — 1,2 h

- [x] T0.1 ADR-0012 — ejecución in-process del import (enmienda a ADR-0004)
  - **Exit criterion**: existe `docs/architecture/decisions/0012-*.md` con
    `Status: Accepted`, que declara (a) el contrato asíncrono `POST` 202 + `GET` de estado,
    (b) el ejecutor in-process con un solo trabajo concurrente, heartbeat y reaper, (c) el
    estado durable en Postgres, y (d) el **criterio de migración** a BullMQ —"cuando exista
    `REDIS_URL` y el worker, el runner pasa a ser un processor que lee el mismo `import_jobs`;
    el contrato HTTP y el esquema no cambian"—, citando ADR-0004 como decisión **enmendada**
    (no superseded) y el bloqueo real (add-on Redis sin aprovisionar, `apps/worker` vacío).
    ADR-0004 queda `Accepted` con su sección `Related` apuntando a ADR-0012. La entrada
    correspondiente existe en `docs/_index/decisions.yaml`.
  - **Verify**: `grep -q '^> \*\*Status\*\*: Accepted' docs/architecture/decisions/0012-*.md && grep -qi 'bullmq' docs/architecture/decisions/0012-*.md && grep -q '0012' docs/architecture/decisions/0004-redis-bullmq-async-processing.md && grep -q 'ADR-0012' docs/_index/decisions.yaml`

- [x] T0.2 Migración aditiva: `import_jobs` + `import_job_rows` + `products.enrichment_done`
  - **Pattern**: en `packages/db/prisma/schema.prisma`, dos `model` nuevos con
    `@id @default(dbgenerated("gen_random_uuid()")) @db.Uuid` y `@@map("…")`, espejando
    `RefreshToken`; FK con `onDelete: Cascade`; en `Product`,
    `enrichment_done Boolean @default(false)`; migración generada con
    `pnpm --filter @dsm/db migrate` — `per backend-node-standards.md §5 — migraciones
    expand-and-contract, nunca destructivas`. Las tablas nuevas nacen vacías, así que
    `NOT NULL` + `UNIQUE` se declaran de entrada (no hace falta el patrón de tres pasos de
    `20260816120000_add_product_slug`); la columna en `products` lleva `DEFAULT false`, que en
    PostgreSQL ≥ 11 no reescribe la tabla.
  - **Exit criterion**: el esquema materializado tiene **exactamente** las columnas de
    `design.md` §Persistencia — `import_jobs`: `id`, `status`, `filename`, `file_size_bytes`,
    `source_format`, `idempotency_key`, `created_by_subject`, `total_rows`, `processed_rows`,
    `created_count`, `updated_count`, `failed_count`, `categories_created_count`,
    `error_code`, `error_message`, `report_truncated`, `started_at`, `finished_at`,
    `heartbeat_at`, `created_at`, `updated_at` (21); `import_job_rows`: `id`, `job_id`,
    `row_number`, `sku`, `field`, `error_code`, `error_message`, `created_at` (8);
    `products` pasa de 12 a **13** columnas con `enrichment_done` boolean NOT NULL default
    `false`. Índice único en `import_jobs.idempotency_key`; índices en `import_jobs(status)`,
    `import_jobs(created_at)` y `import_job_rows(job_id, row_number)`. La FK
    `import_job_rows.job_id` borra en cascada. **Ninguna** otra tabla ni columna se modifica.
  - **Verify**: `pnpm --filter @dsm/db migrate:deploy && pnpm --filter @dsm/api test -- --testPathPattern=import-schema`
    (nuevo `src/imports/import-schema.spec.ts`, espejo de `auth-schema.spec.ts`: consulta
    `information_schema.columns`, `information_schema.table_constraints` y `pg_indexes`, y
    compara el conjunto **completo** de columnas e índices por tabla contra la lista literal
    de arriba — falla si falta **o sobra** una sola columna, F40; además inserta un job con
    dos filas de error, borra el job y asserta que las filas desaparecieron por cascada; y
    asserta que `products` tiene exactamente 13 columnas con `enrichment_done` en `false` por
    default)

- [x] T0.3 Variables de entorno del import validadas por Zod
  - **Pattern**: extender `envSchema` en `apps/api/src/config/env.validation.ts` con
    `z.coerce.number().int().positive().default(…)` — `per backend-node-standards.md §7 —
    config validada al arranque, fail-fast`.
  - **Exit criterion**: `env.validation.ts` declara con default seguro
    `IMPORT_MAX_FILE_BYTES` (4_194_304 = 4 MiB), `IMPORT_MAX_ROWS` (5_000),
    `IMPORT_MAX_UNCOMPRESSED_BYTES` (33_554_432 = 32 MiB), `IMPORT_BATCH_SIZE` (200),
    `IMPORT_MAX_REPORT_ROWS` (1_000), `IMPORT_JOB_STALE_MS` (120_000),
    `IMPORT_RETENTION_DAYS` (90), `IMPORT_RATE_LIMIT_MAX` (3) e
    `IMPORT_RATE_LIMIT_TTL_MS` (3_600_000); un valor inválido (`IMPORT_MAX_ROWS=abc`,
    `IMPORT_BATCH_SIZE=0`) hace **fallar el arranque** con el mensaje de fail-fast, no cae al
    default en silencio.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=env.validation`
    (casos nuevos: sin las variables → los 9 defaults exactos; `IMPORT_MAX_ROWS=abc` →
    `validateEnv` lanza; `IMPORT_BATCH_SIZE=0` → lanza)

---

## Fase 1: Lectura y validación del archivo — 1,8 h

- [x] T1.1 Detección de formato por contenido + decodificación (§6.4)
  - **Pattern**: sniff de magic bytes sobre el buffer —`PK\x03\x04` ⇒ `xlsx`— y, para el
    resto, decodificación estricta con `new TextDecoder('utf-8', { fatal: true })` tras
    quitar el BOM `EF BB BF` — `per security-standards.md §6.4 — validar por content
    sniffing (magic bytes) + extensión contra un allowlist explícito; el Content-Type header
    es atacante-controlado`.
  - **Exit criterion**: `detectFormat(buffer, filename)` devuelve `'xlsx'` para un buffer que
    empieza con `PK\x03\x04`, `'csv'` para texto UTF-8 válido, y lanza
    `UnsupportedFormatError` (415) para cualquier otra cosa —**incluido** un buffer con
    `Content-Type: text/csv` y contenido binario, y un `.csv` renombrado desde un ejecutable—;
    un CSV en windows-1252 (bytes `0xF3` sueltos) lanza `InvalidEncodingError` (422), **no** se
    decodifica con reemplazos. El `filename` **nunca** se usa para decidir el formato ni como
    ruta: sólo se conserva como metadata.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=detect-format`
    (unit: xlsx real mínimo → `'xlsx'`; CSV UTF-8 con y sin BOM → `'csv'` y mismo contenido
    decodificado; `Buffer.from([0x7f,0x45,0x4c,0x46])` con nombre `catalogo.csv` →
    `UnsupportedFormatError`; `Buffer.from('Refrigeración','latin1')` → `InvalidEncodingError`;
    el resultado no contiene `�`)

- [x] T1.2 Lectura en streaming CSV/XLSX con caps de filas y de expansión (AC-6, AC-11)
  - **Pattern**: `csv-parse` con `{ bom: true, columns: normalizeHeader, relax_column_count: true }`
    y `exceljs` `WorkbookReader` (streaming) — nunca cargar el workbook entero — con contador
    de bytes descomprimidos que **aborta** el stream al superar el cap; encabezados
    reconocidos con la `slugify()` existente — `per security-standards.md §6.6 — global
    body-size limit; memory-exhaustion DoS defense` y `§6.4 — size cap enforced before
    buffering`.
  - **Exit criterion**: `readRows(buffer, format, limits)` devuelve un iterable de
    `{ rowNumber, cells }` con los encabezados normalizados (`Descripción`, `DESCRIPCION` y
    `descripcion` colapsan a la misma clave) e **ignora** los encabezados desconocidos; con
    los cinco requeridos (`sku`, `nombre`, `precio`, `stock`, `categoria`) **no** presentes
    lanza `MissingColumnsError` (422) enumerando **cuáles faltan** (no las columnas de la
    base); al superar `IMPORT_MAX_ROWS` lanza `RowLimitExceededError` (422) **sin** haber
    leído el archivo entero; un xlsx cuya expansión supera `IMPORT_MAX_UNCOMPRESSED_BYTES`
    aborta con `UnsupportedFormatError` y **no** agota la memoria del proceso. `rowNumber` es
    1-based sobre las filas de datos (el encabezado no cuenta).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=read-rows`
    (unit: CSV con acentos y mayúsculas en el encabezado → claves normalizadas; CSV sin
    `precio` → `MissingColumnsError` cuyo mensaje contiene `precio` y **no** contiene
    `price_ars_cents`; CSV de `IMPORT_MAX_ROWS + 1` filas → `RowLimitExceededError` y el
    contador de filas leídas **no** llega al total del archivo, probando el corte temprano;
    xlsx con una hoja de una celda repetida que expande > cap → aborta y
    `process.memoryUsage().heapUsed` no crece más que el cap; columna `notas` desconocida →
    ignorada, el resto se lee)

- [x] T1.3 Validación por fila → fila parseada o error de fila (AC-5)
  - **Pattern**: función pura `validateRow(cells, rowNumber): ParsedRow | RowError` con
    allowlist por campo (tipo, longitud, rango, patrón) — `per security-standards.md §6.1 —
    allowlist semantics: definir qué ES válido y rechazar el resto; reject, don't repair`.
    El precio se parsea con `/^\d+(?:[.,]\d{1,2})?$/` y se convierte a centavos con
    aritmética entera (`api-standards §5.5 — money en unidades menores enteras`).
  - **Exit criterion**: acepta `sku` 1..64, `nombre` 1..200 sin caracteres de control,
    `descripcion` ≤ 2000, `precio` `> 0` con ≤ 2 decimales y `,` o `.` como separador
    decimal, `stock` entero `>= 0`, `categoria` 1..120, `imagen_url` con esquema **`https:`**
    y ≤ 2048; devuelve `RowError` con el `error_code` del catálogo cerrado
    (`missing_required`, `invalid_sku`, `name_too_long`, `invalid_price`, `invalid_stock`,
    `invalid_category`, `invalid_image_url`) y el `field` culpable para cada violación.
    **Rechaza el separador de miles**: `1.234` es `invalid_price`, no 1234 ni 1,234.
    `precio: 0` y `stock: -1` son inválidos (espejo de los CHECK de la base). `http://…` es
    `invalid_image_url`. Una celda **vacía** en columna opcional produce `undefined`
    (semántica "no cambiar", OQ-BE-2), no cadena vacía; en columna requerida produce
    `missing_required`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=row-schema`
    (unit, tabla de casos: `'1234,56'` → `123456` centavos; `'1234.5'` → `123450`;
    `'1.234'` → `invalid_price`; `'1234,567'` → `invalid_price`; `'0'` → `invalid_price`;
    `stock:'-1'` → `invalid_stock`; `sku:''` → `missing_required`;
    `nombre` de 201 chars → `name_too_long`; `nombre` con un caracter de control (`\u0000`) → rechazado;
    `imagen_url:'http://x'` → `invalid_image_url`; `descripcion:''` → `undefined`)

---

## Fase 2: Política de slug compartida y asignación por lote — 0,8 h

- [x] T2.1 Extraer `resolveSlug` — refactor de comportamiento invariante
  - **Pattern**: Extract Method sobre `ProductsService.deriveUniqueSlug` hacia una función
    pura en `apps/api/src/common/slug.ts`:
    ```ts
    export function resolveSlug(base: string, taken: ReadonlySet<string>): string {
      if (!taken.has(base)) return base;
      let ordinal = 2;
      while (taken.has(`${base}-${ordinal}`)) ordinal += 1;
      return `${base}-${ordinal}`;
    }
    ```
    — `per base-standards.md §1 — refactor con disciplina: se nombra el patrón, la frontera
    que no se mueve y el criterio de éxito; suite verde antes y después`. La frontera que no
    se mueve es el comportamiento observable de `POST /v1/admin/products`.
  - **Exit criterion**: `resolveSlug` existe como función pura sin I/O ni tipos de framework;
    `ProductsService.deriveUniqueSlug` la usa (`resolveSlug(base, new Set(await
    repo.findSlugsByPrefix(base)))`) y conserva **exactamente** su comportamiento previo,
    incluidos el fallback al `sku` cuando el `name` no produce base y el `ValidationError`
    cuando tampoco lo produce el `sku`. Los specs preexistentes
    `products.service.spec.ts` y `e2e-products-create.spec.ts` pasan **sin ninguna
    modificación**.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern='common/slug|products.service|e2e-products-create' && git diff --exit-code 2db5997 -- apps/api/src/products/products.service.spec.ts apps/api/src/products/e2e-products-create.spec.ts`
    (los specs corren y prueban el comportamiento; el `git diff` contra el commit base de
    este change prueba que **no se tocaron los tests para que pasen** — un refactor que
    reescribe su propia red de seguridad no es invariante. Nuevo `src/common/slug.spec.ts`
    para `resolveSlug`: base libre → base; base ocupada → `-2`; `-2` ocupado → `-3`; hueco
    (`base` y `base-3` ocupados) → `-2`. **Si el commit base cambió** porque otra sesión tocó
    esos archivos antes de arrancar, re-pinear el SHA al commit inmediatamente anterior al
    primer commit de este change y anotarlo acá)

- [x] T2.2 `BatchSlugAllocator` + `findSlugsByPrefixes` — una query por lote
  - **Pattern**: en `ProductsRepository`,
    `findMany({ where: { OR: bases.map(b => ({ slug: { startsWith: b } })) }, select: { slug: true } })`
    — una sola ida a la base por lote; el allocator mantiene un `Set` acumulador que vive todo
    el trabajo y al que agrega cada slug asignado — `per backend-node-standards.md §5 — el
    repositorio envuelve el ORM; los services no lo llaman directo`.
  - **Exit criterion**: `BatchSlugAllocator.prime(bases[])` hace **exactamente una** consulta
    y `allocate(base)` devuelve slugs únicos usando `resolveSlug` contra el set acumulado, de
    modo que dos filas del mismo lote con el mismo nombre reciben `heladera` y `heladera-2`
    **sin** volver a la base; el slug asignado se agrega al set en el acto. Procesar 400 filas
    en lotes de 200 produce **2** consultas de slug, no 400.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern='batch-slug-allocator|products.repository'`
    (unit con un repositorio espía: `prime` de 200 bases ⇒ el espía se llamó **1** vez;
    `allocate('heladera')` dos veces ⇒ `['heladera','heladera-2']` con **cero** llamadas
    adicionales al espía; con `heladera` ya en la base ⇒ `heladera-2` y `heladera-3`.
    Integration en `products.repository.spec.ts`: sembrar `heladera`, `heladera-2`,
    `mecha-3` y `otro`; `findSlugsByPrefixes(['heladera','mecha'])` devuelve exactamente los
    3 primeros y **no** `otro`)

---

## Fase 3: Repositorios (único punto de ORM) — 0,9 h

- [x] T3.1 `ImportJobsRepository`
  - **Pattern**: clase `@Injectable()` que envuelve `PrismaService` y traduce `P2002` a error
    de dominio, espejando `ProductsRepository` — `per backend-node-standards.md §5` y `§6 —
    nunca escapa un error crudo del ORM`.
  - **Exit criterion**: expone `create(data)`, `findById(id)`, `findByIdempotencyKey(key)`,
    `findActive()` (el `pending`/`running` vigente, o `null`), `markRunning(id)`,
    `heartbeat(id, counters)`, `markCompleted(id, counters)`, `markFailed(id, code, message)`,
    `appendRowErrors(id, rows[])`, `findRowErrors(id, page)` (paginado, ordenado por
    `row_number`), `countRowErrors(id)`, `reapStale(staleMs)` y
    `purgeOlderThan(days)`. `create` con una `idempotency_key` repetida lanza
    `ConflictError` (nunca un `PrismaClientKnownRequestError`); `reapStale` marca `failed` con
    `error_code='interrupted'` **sólo** los `running` cuyo `heartbeat_at` es más viejo que el
    umbral y devuelve cuántos cerró; `purgeOlderThan` borra sólo jobs con `created_at` fuera
    de la ventana (la cascada se lleva sus filas) y **nunca** barre la tabla entera.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=import-jobs.repository`
    (integration contra Postgres real: alta OK; alta con la misma `idempotency_key` →
    `ConflictError` y **no** un error de Prisma; `findActive` devuelve el `running` y `null`
    cuando todos están `completed`; `reapStale` con 1 job de heartbeat viejo + 1 fresco +
    1 `completed` ⇒ cierra **exactamente** 1 y deja los otros dos intactos;
    `purgeOlderThan(90)` con un job de 100 días y otro de 10 ⇒ borra 1 y sus filas de error
    desaparecen, el otro queda)

- [x] T3.2 `ProductsRepository` — lectura por SKUs y upsert de import
  - **Exit criterion**: expone `findManyBySkus(skus[])` (una consulta, devuelve
    `Map<sku, {id, slug, description_raw, status}>`) y `upsertFromImport(data)` que en **una**
    `prisma.$transaction` crea (con `slug`, `status:'draft'` y `enrichment_done:false`) o
    actualiza **sin tocar** `slug`, `status` ni `sku`, y pone `enrichment_done:false` **sólo**
    si el `description_raw` entrante difiere del persistido. Devuelve
    `{ outcome: 'created' | 'updated', id, slug }`. Una colisión de UNIQUE de `slug` sigue
    llegando como `ConflictError` con `field: 'slug'` (distinguible de la de `sku`, lógica ya
    existente).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=products.repository`
    (integration: `findManyBySkus` de 3 skus con 2 existentes ⇒ mapa de 2 en **1** consulta;
    `upsertFromImport` de un sku nuevo ⇒ `created`, `status='draft'`,
    `enrichment_done=false`; el mismo sku con otro `nombre` ⇒ `updated`, el `slug` **es
    idéntico** al original y el `status` no cambió aunque el producto estuviera `published`;
    update con la **misma** descripción sobre un producto con `enrichment_done=true` ⇒ queda
    `true`; update con descripción distinta ⇒ pasa a `false`; sembrar `heladera` y forzar
    `upsertFromImport` con ese slug ⇒ `ConflictError` con `field:'slug'`)

- [x] T3.3 `CategoriesRepository` — resolución por lote
  - **Exit criterion**: expone `findManyBySlugs(slugs[])` (una consulta →
    `Map<slug, id>`) y `createIfAbsent({name, slug})`, que ante la carrera de UNIQUE
    **re-lee** y devuelve la categoría existente en vez de propagar el conflicto (la
    auto-creación del import no puede fallar porque dos filas del mismo rubro compitieron).
    `createIfAbsent` crea siempre como rubro raíz (`parent_id: null`).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=categories.repository`
    (integration: `findManyBySlugs(['a','b','c'])` con 2 existentes ⇒ mapa de 2;
    `createIfAbsent` de un slug nuevo ⇒ crea con `parent_id` null; **dos** llamadas
    concurrentes con `Promise.all` sobre el mismo slug ⇒ ambas resuelven al **mismo** id y
    ninguna lanza; `SELECT count(*)` de ese slug ⇒ 1)

---

## Fase 4: Caso de uso del import — 1,8 h

- [x] T4.1 `CategoryResolver` — auto-creación normalizada (AC-2)
  - **Pattern**: normalizar con la `slugify()` **existente** (la misma que usa
    `CategoriesService.create`, US-001) antes de reconciliar — `per base-standards.md §1 —
    single source of truth: una regla, un lugar`.
  - **Exit criterion**: `resolve(nombres[])` devuelve `Map<nombreOriginal, categoryId>`
    haciendo **una** consulta por lote y creando sólo las ausentes; "Plomería", "plomeria",
    "PLOMERÍA" y " Plomería " resuelven al **mismo** id y crean **una sola** categoría, cuyo
    `name` es el primer nombre visto tal cual lo escribió el dueño (no el slug); el contador
    `categoriesCreated` refleja sólo las realmente creadas. El cache vive todo el trabajo, así
    que un rubro repetido en 500 filas no genera 500 consultas.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=category-resolver`
    (integration: `resolve(['Plomería','plomeria','PLOMERÍA'])` ⇒ 3 entradas con el **mismo**
    id, 1 fila en `categories` con `slug='plomeria'` y `name='Plomería'`,
    `categoriesCreated === 1`; segunda llamada con el mismo nombre ⇒ `categoriesCreated === 0`
    y **cero** consultas nuevas)

- [x] T4.2 `ImportService.processRow` — upsert por SKU, atómico por fila (AC-1, AC-4, AC-9, AC-10)
  - **Pattern**: por lote, `findManyBySkus` → resolver categorías → `prime` del allocator sólo
    con las bases de los SKUs **nuevos** → por fila una `prisma.$transaction` con
    `upsertFromImport` — `per backend-node-standards.md §5 — transacción para casos de uso
    multi-escritura, sin escrituras parciales ante fallo`.
  - **Exit criterion**: una fila con SKU inexistente **crea** el producto en `draft` con slug
    derivado; una fila con SKU existente **actualiza** `name`, `description_raw`,
    `price_ars_cents`, `stock`, `category_id` e `image_url` y **no toca** `slug`, `status`,
    `sku` ni `id` (AC-1, AC-4, AC-9, AC-10); una celda opcional vacía **no** pisa el valor
    persistido (OQ-BE-2); un `sku` repetido dentro del mismo archivo procesa la **primera**
    ocurrencia y devuelve `duplicate_sku_in_file` para las siguientes; una colisión de `slug`
    se reintenta **una** vez con el set refrescado y, si vuelve a colisionar, devuelve
    `slug_conflict`; cualquier otro fallo de escritura devuelve `write_failed` **sin** abortar
    el lote ni dejar escritura parcial.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=imports.service`
    (integration: alta + actualización del mismo sku en dos pasadas ⇒ **1** fila en
    `products`, precio actualizado, `slug` y `created_at` idénticos; producto `published`
    actualizado por el import ⇒ sigue `published`; archivo con `REF-1` dos veces ⇒ 1 creado +
    1 `duplicate_sku_in_file`; fila con `category_id` que se borra entre la resolución y la
    escritura ⇒ `write_failed` y las demás filas del lote **sí** se escriben; celda
    `descripcion` vacía sobre un producto con descripción ⇒ la descripción sobrevive)

- [x] T4.3 `ImportRunner` — lotes, progreso, heartbeat y reaper (AC-5, AC-7)
  - **Pattern**: bucle por lotes de `IMPORT_BATCH_SIZE` con `await` entre lotes (cede el event
    loop) que actualiza `processed_rows` + contadores + `heartbeat_at`; disparo con
    `setImmediate` tras responder el 202; `OnApplicationBootstrap` invoca `reapStale` —
    `per backend-node-standards.md §8 — nunca bloquear el event loop; offload de trabajo
    pesado` (ADR-0012 documenta la desviación interina del anti-patrón "cola con
    temporizadores": la durabilidad la da Postgres, no un temporizador).
  - **Exit criterion**: el trabajo pasa `pending → running → completed` (o `failed` ante fallo
    global) y sus contadores (`processed_rows`, `created_count`, `updated_count`,
    `failed_count`, `categories_created_count`) son consultables **mientras corre**, no sólo
    al final (AC-7); `total_rows` se fija al terminar la lectura; las filas rechazadas se
    persisten hasta `IMPORT_MAX_REPORT_ROWS` y superado el tope `report_truncated` pasa a
    `true` mientras `failed_count` sigue contando **el total real**; el runner **no** bloquea
    el event loop (un `GET` de salud responde mientras procesa 2.000 filas); un trabajo
    `running` con `heartbeat_at` viejo queda `failed` con `error_code='interrupted'` al
    bootear la app; el `finally` cierra el trabajo aunque el lote lance.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=import-runner`
    (integration: correr un archivo de 500 filas y muestrear `findById` a mitad ⇒
    `status='running'` con `0 < processed_rows < 500`; al terminar ⇒ `completed`,
    `processed_rows === total_rows === 500`, contadores que suman 500; archivo de 1.200 filas
    todas inválidas con tope 1.000 ⇒ `failed_count === 1200`, filas persistidas `=== 1000`,
    `report_truncated === true`; durante el procesamiento, un `GET /v1/health` responde en
    < 1 s (el event loop no está bloqueado); insertar a mano un job `running` con
    `heartbeat_at` de hace 10 min y bootear ⇒ `failed` / `interrupted`)

- [x] T4.4 Puerto `EnrichmentQueue` + adapter no-op + marca durable (AC-3)
  - **Pattern**: interfaz + token de inyección (`provide: ENRICHMENT_QUEUE`) inyectada por el
    service — `per backend-node-standards.md §3 — depender de interfaces/tokens, no de clases
    concretas, donde ayuda a sustituir/testear`. Mismo patrón que el puerto de mailer de
    US-014.
  - **Exit criterion**: `ImportRunner` depende del **puerto**, no de un adapter concreto; al
    completarse el trabajo se llama `enqueue(ids)` **una** vez con los ids de los productos
    creados o cuya `description_raw` cambió, y **no** con los que sólo cambiaron de precio o
    stock (E2E §9.3 — control de costo de Gemini); el adapter interino registra el conteo y
    **no** intenta conectarse a Redis (no está aprovisionado); un fallo del adapter **no**
    cambia el estado del trabajo ni propaga excepción. La marca `enrichment_done=false` queda
    en la base, así que `SELECT ... WHERE enrichment_done = false` reconstruye la cola aunque
    ningún encolado haya ocurrido. `Deferred: adapter BullMQ — US-005` queda anotado en el
    código y en el README.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern='enrichment-queue|import-runner'`
    (unit con el puerto espiado: archivo con 2 altas + 1 update de descripción + 1 update de
    sólo precio ⇒ `enqueue` llamado **1** vez con **3** ids y sin el cuarto; un adapter que
    lanza ⇒ el trabajo igual queda `completed`. Integration: tras el import,
    `count({ where: { enrichment_done: false } })` es 3)

---

## Fase 5: Borde HTTP — 1,5 h

- [x] T5.1 Errores de dominio `dsm:import/*` + títulos 413/415
  - **Pattern**: subclases de la `DomainError` existente con `readonly status` y
    `readonly type` — `per backend-node-standards.md §6 — errores de dominio tipados mapeados
    centralmente, nunca HttpException ad-hoc en services`.
  - **Exit criterion**: `apps/api/src/imports/import-errors.ts` define
    `UnsupportedFormatError` (415 `dsm:import/unsupported-format`), `FileTooLargeError`
    (413 `dsm:import/file-too-large`), `MissingColumnsError` (422
    `dsm:import/missing-columns`), `RowLimitExceededError` (422
    `dsm:import/row-limit-exceeded`), `InvalidEncodingError` (422
    `dsm:import/invalid-encoding`), `ImportAlreadyRunningError` (409
    `dsm:import/already-running`) e `ImportNotFoundError` (404 `dsm:import/not-found`); el
    mapa `TITLES` de `http-problem.filter.ts` gana `413: 'Payload Too Large'` y
    `415: 'Unsupported Media Type'` (hoy caen al genérico `'Error'`); el filtro **existente**
    los mapea al envelope RFC 7807 con ese `type` y `title` **sin más cambios**, y ningún
    `detail` contiene nombres de tablas ni columnas de la base.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern='import-errors|http-problem-filter'`
    (unit sobre `mapErrorToProblem`: las 7 clases producen el `type`/`status`/`title`
    esperados; `MissingColumnsError(['precio'])` tiene `errors[]` con `field:'precio'` y su
    `detail` **no** contiene `price_ars_cents` ni `products`; el spec preexistente del filtro
    sigue verde)

- [x] T5.2 `POST /v1/admin/imports` — multipart, caps, idempotencia y concurrencia (AC-6, AC-8, AC-11)
  - **Pattern**: `@UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize, files: 1 } }))`
    y traducción del `LIMIT_FILE_SIZE` de multer a `FileTooLargeError` — `per
    security-standards.md §6.4 — size cap enforced before buffering the body (reject
    oversized with 413); server-generated storage names; el filename del usuario nunca es un
    path` y `api-standards.md §10 — Idempotency-Key en POST retryables`.
  - **Exit criterion**: sin token → **401**; token `role=customer` → **403** (AC-8, el
    `AdminGuard` no se modifica); archivo mayor al cap → **413 dsm:import/file-too-large**
    **antes** de bufferizarlo entero; formato no soportado → **415**; encabezados requeridos
    ausentes → **422 dsm:import/missing-columns**; exceso de filas → **422
    dsm:import/row-limit-exceeded**; encoding ilegible → **422
    dsm:import/invalid-encoding**; en **todos** esos casos `count(products)` y
    `count(import_jobs)` quedan **iguales** que antes del request (AC-6 — impacto cero);
    archivo válido → **202** con `Location: /v1/admin/imports/{id}` y cuerpo con `id` y
    `status`; un segundo `POST` con un trabajo `pending`/`running` vigente → **409
    dsm:import/already-running**; un `POST` que repite `Idempotency-Key` → **200** con el
    **mismo** `id`, sin crear un segundo trabajo; el `filename` se persiste como metadata y
    nada se escribe a disco.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-imports-upload`
    (e2e con supertest `.attach()`: los 4 casos de rechazo de archivo comparan
    `count(products)` y `count(import_jobs)` antes/después con `toEqual`; archivo de
    `IMPORT_MAX_FILE_BYTES + 1` → 413 `problem+json`; `.attach('file', elfBuffer, 'x.csv')`
    → 415; sin `Authorization` → 401; con `customerToken()` → 403; válido → 202 con
    `Location`; segundo POST inmediato → 409; POST repetido con la misma `Idempotency-Key` →
    200 con el mismo `id` y `count(import_jobs)` sin cambios)

- [x] T5.3 `GET /v1/admin/imports/{id}` — estado, progreso y filas rechazadas (AC-5, AC-7)
  - **Pattern**: DTO de respuesta con `static from(job, errors, page)`, separado de la entidad
    de persistencia; query `limit`/`offset` validada con `class-validator` como
    `ListProductsQueryDto` — `per backend-node-standards.md §4 — DTO de respuesta separado de
    la entidad; todo input de controller validado en el borde` y `api-standards.md §6.1 —
    paginación offset con envelope de paginación`.
  - **Exit criterion**: devuelve **exactamente** los 17 campos escalares de `design.md` §API
    más `errors[]` y `pagination` — sin `idempotency_key` ni `heartbeat_at` (internos); un id
    inexistente → **404 dsm:import/not-found**; un id que no es UUID → **422** (no 500);
    `errors[]` viene ordenado por `row_number` y paginado (default `limit: 50`), con
    `pagination.total` = total real de filas rechazadas persistidas; consultado mientras el
    trabajo corre, `processed_rows` avanza entre dos llamadas (AC-7); `limit`/`offset`
    inválidos → 422.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-imports-status`
    (e2e: `Object.keys(body)` es exactamente el conjunto declarado —falla si sobra
    `idempotency_key`—; UUID inexistente → 404 `dsm:import/not-found`; `/v1/admin/imports/abc`
    → 422; import de 120 filas malas ⇒ `errors.length === 50`, `pagination.total === 120`, y
    con `?offset=50` los `row_number` son estrictamente mayores; dos `GET` durante un import
    de 500 filas ⇒ el segundo `processed_rows` es `>=` el primero y al menos uno es `> 0`)

- [x] T5.4 `GET /v1/admin/imports/{id}/report` — CSV con fórmulas neutralizadas
  - **Pattern**: prefijar con `'` toda celda que empiece con `=`, `+`, `-`, `@`, tab o CR
    antes de escribirla, y encomillar según RFC 4180 — `per security-standards.md §6.3 —
    encode for the destination context, at output time`. El sink acá es una planilla, no HTML.
  - **Exit criterion**: responde `text/csv; charset=utf-8` con
    `Content-Disposition: attachment; filename="import-{id}-errores.csv"` y encabezado
    `fila,sku,campo,codigo,motivo`; un `sku` como `=cmd|'/c calc'!A1` se escribe **prefijado
    con `'`** (Excel no lo evalúa al abrirlo); las comillas y comas del mensaje se escapan
    correctamente; un id inexistente → **404**; un trabajo sin filas rechazadas devuelve el
    CSV con **sólo** el encabezado (no 404 ni cuerpo vacío); cuando `report_truncated` es
    `true`, la última línea es un comentario que lo declara.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-imports-report`
    (e2e: importar un archivo con una fila cuyo sku es `=1+1` y otra cuyo motivo contiene
    `"` y `,` ⇒ el cuerpo contiene `'=1+1` y **no** contiene `\n=1+1`; parsear el CSV de
    vuelta con `csv-parse` devuelve el mismo número de filas que `failed_count`; headers
    `content-type` y `content-disposition` exactos; job sin errores ⇒ cuerpo de 1 línea)

- [x] T5.5 Cableado del módulo + rate limit de la superficie (§7.3)
  - **Pattern**: `@Throttle({ auth: { limit: IMPORT_RATE_LIMIT_MAX, ttl: IMPORT_RATE_LIMIT_TTL_MS } })`
    por handler sobre el throttler **ya registrado** `auth` (no se registra un tercero),
    espejando lo que hizo US-014 — `per security-standards.md §7.3 — presupuesto por endpoint
    de escritura pública` y `api-standards.md §12 — 429 con Retry-After y RateLimit-*`.
  - **Exit criterion**: `ImportsModule` registra el controller, el repositorio, el service, el
    runner, el resolver y el puerto de enriquecimiento, y `AppModule` lo importa; el array de
    `ThrottlerModule` **sigue teniendo dos** throttlers (`auth`, `storefront`); el `POST`
    excede a los `IMPORT_RATE_LIMIT_MAX` intentos por hora y devuelve **429** con
    `Retry-After`, `RateLimit-Limit`, `RateLimit-Remaining: 0` y `RateLimit-Reset` en envelope
    `application/problem+json`; los `GET` de estado **no** comparten ese presupuesto (el panel
    hace polling del progreso); la superficie pública del storefront conserva su límite
    intacto y las rutas admin de US-001 siguen respondiendo igual.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern='e2e-imports-security|e2e-throttler-independence'`
    (e2e: N `POST` dentro del límite → 409/202 según corresponda, el N+1 → 429 con
    `Retry-After` y `problem+json`; 20 `GET` de estado seguidos → todos 200; en la misma
    corrida `GET /v1/products/{slug}` sigue 200 y `GET /v1/admin/categories` con token admin
    sigue 200; `grep -c` de throttlers no aplica — lo prueba el spec de independencia
    preexistente, que se mantiene verde)

---

## Fase 6: Observabilidad — 0,3 h

- [x] T6.1 Eventos `import.*` agregados, sin PII ni cardinalidad por trabajo
  - **Pattern**: extender `CatalogEventName` con `'import.started' | 'import.completed' |
    'import.failed'` y agregar a `CatalogEventsService.emit` un quinto parámetro **opcional**
    `fields?: Record<string, string|number|boolean|null>` que se vuelca al log estructurado —
    `per observability-patterns §3.3 — el id va al log, NUNCA como dimensión de métrica
    (cardinalidad)` y `observability-standards §9 — clasificación por campo`.
  - **Exit criterion**: se emiten los tres eventos en sus momentos (`import.started` al tomar
    el trabajo con `source_format`; `import.completed` con `created`, `updated`, `failed`,
    `categories_created` y `duration_ms`; `import.failed` con `error_code`); **no** se emite
    un evento por fila (un import de 500 filas produce **2** líneas de evento, no 500); el
    contador de métrica se lleva **sólo** por nombre de evento, sin `job_id` como dimensión;
    ningún log de la superficie de import contiene contenido de celdas del archivo; la firma
    anterior de `emit` sigue funcionando (los llamadores de US-001/002/003 no se tocan).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern='e2e-imports-observability|events'`
    (e2e con el logger pino capturado: un import de 500 filas con un nombre de producto
    reconocible ⇒ exactamente 1 `import.started` + 1 `import.completed`, `count('import.completed') === 1`,
    y el volcado completo de logs **no** contiene ese nombre de producto ni ninguna celda; el
    spec preexistente `events.spec.ts` sigue verde probando que la firma vieja no se rompió)

---

## Fase 7: Cobertura e2e de los AC — 0,9 h

- [x] T7.1 e2e de reconciliación por SKU (AC-1, AC-4, AC-9, AC-10)
  - **Exit criterion**: subir un archivo con 2 SKUs nuevos y 1 existente ⇒ los 2 nuevos se
    crean en `draft` y el existente se actualiza (AC-1); re-subir **el mismo** archivo ⇒
    `count(products)` no cambia y `updated_count === 3` (AC-10); subir un archivo que sólo
    cambia precios sobre un catálogo publicado ⇒ los precios cambian en ARS, **ninguno** de
    los productos cambia de `status` ni de `slug` y no aparece ningún duplicado (AC-4, AC-9);
    un producto creado por el import **no** aparece en `GET /v1/products/{slug}` público
    (sigue `draft`, AC-9).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-imports-acceptance`

- [x] T7.2 e2e de categorías auto-creadas y enriquecimiento pendiente (AC-2, AC-3)
  - **Exit criterion**: un archivo con 3 filas que referencian "Plomería", "plomeria" y
    "Electricidad" ⇒ se crean **2** categorías, `categories_created_count === 2`, y los 3
    productos quedan asignados correctamente (AC-2); tras el import, los productos creados y
    los que cambiaron descripción tienen `enrichment_done = false` y el puerto de
    enriquecimiento recibió exactamente esos ids (AC-3).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-imports-categories`

- [x] T7.3 e2e de errores parciales y de rechazo del archivo (AC-5, AC-6, AC-7, AC-11)
  - **Exit criterion**: archivo con 5 filas válidas y 3 inválidas (precio `0`, SKU vacío,
    stock `-1`) ⇒ trabajo `completed` con `created_count === 5` y `failed_count === 3`, las
    5 válidas presentes en `products`, ninguna de las 3 inválidas escrita ni parcialmente
    (AC-5), y el reporte identifica las 3 por `row_number` con su `error_code` y `motivo`;
    archivo sin la columna `precio` ⇒ 422 y `count(products)` sin cambios (AC-6); archivo con
    más filas que el cap ⇒ 422 y sin trabajo creado (AC-11); durante un archivo de 800 filas,
    el `POST` respondió en < 2 s y el progreso avanzó en `GET` sucesivos (AC-7).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-imports-rejection`

---

## Fase 8: Contratos y documentación — 0,4 h

- [ ] T8.1 Tres contratos OpenAPI draft (1 por endpoint) + lint
  - **Pattern**: un yaml autocontenido por endpoint en `contracts/openapi/`
    (`admin-create-import`, `admin-get-import`, `admin-get-import-report`) con
    `components.schemas` de request/response, `components.responses` RFC 7807 con el `type`
    URI canónico y `components.securitySchemes.adminBearer` — `per
    api-contract-completeness — 1 yaml por endpoint + catálogo de errores RFC 7807 cerrado`.
  - **Exit criterion**: los 3 archivos validan como OpenAPI 3.x y coinciden con la
    implementación: `multipart/form-data` con el campo `file` en binario, el header
    `Idempotency-Key` opcional, el header `Location` en el 202, y el catálogo **cerrado**
    `dsm:import/unsupported-format` (415), `dsm:import/file-too-large` (413),
    `dsm:import/missing-columns` (422), `dsm:import/row-limit-exceeded` (422),
    `dsm:import/invalid-encoding` (422), `dsm:import/already-running` (409),
    `dsm:import/not-found` (404), más 401/403/429 con las cabeceras `RateLimit-*`; el
    `text/csv` del reporte declara `Content-Disposition`. Los **límites vigentes están
    declarados con número** en la `description` del `requestBody` y de las respuestas 413/422
    —**5.000 filas**, **4 MiB** de archivo, **32 MiB** descomprimidos y **3 imports/hora/IP**—
    porque un consumidor que no sabe el tope no puede decidir si partir el archivo ni cuándo
    reintentar (`api-contract-completeness` §Anti-patterns — "límite mencionado sin número").
    Queda anotado que al archivar los
    tres extienden la capacidad **existente** `openspec/specs/catalogo/` (el import es
    catálogo), no una capacidad nueva.
  - **Verify**: `npx @stoplight/spectral-cli lint openspec/changes/US-006-import-masivo-inventario-backend/contracts/openapi/*.yaml`

- [ ] T8.2 Spec publicado del servicio + README + runbook
  - **Pattern**: en `apps/api/docs/api/openapi.yaml` el `/v1` vive en `servers`, así que los
    paths se declaran **sin** el prefijo (`/admin/imports`, **no** `/v1/admin/imports`) —
    `per api-standards.md §5 — el contrato declara todo campo y ruta que la API expone`,
    respetando la convención ya establecida del archivo.
  - **Exit criterion**: el spec publicado incorpora las 3 rutas bajo un tag nuevo
    `admin-imports`; `apps/api/README.md` documenta el **esquema de columnas v1** (los 7
    encabezados, cuáles son requeridos, el formato de precio y que el separador de miles se
    rechaza), los **límites vigentes con su número** (5.000 filas, 4 MiB, 32 MiB
    descomprimidos, 3 imports/hora) **y la advertencia de que el tope de filas coincide con el
    catálogo objetivo, así que un catálogo mayor obliga a partir el archivo** — el dueño tiene
    que enterarse por la documentación, no por un 422 en el peor momento; el catálogo de
    códigos de error por fila, las 9 variables
    de entorno nuevas, la obligación de FE de invalidar el catálogo al completarse el trabajo,
    y el procedimiento de recuperación ante import interrumpido ("re-subí el archivo: la
    reconciliación por SKU lo hace seguro").
  - **Verify**: `npx @stoplight/spectral-cli lint apps/api/docs/api/openapi.yaml && grep -q '^  /admin/imports:' apps/api/docs/api/openapi.yaml && grep -q '^  /admin/imports/{id}:' apps/api/docs/api/openapi.yaml && grep -q '^  /admin/imports/{id}/report:' apps/api/docs/api/openapi.yaml && grep -q 'imagen_url' apps/api/README.md && grep -q 'IMPORT_MAX_ROWS' apps/api/README.md`
    (los tres `grep` de paths usan la convención real del archivo —sin `/v1`, dos espacios de
    indentación— verificada contra los paths existentes `  /admin/products:` y
    `  /products/{slug}:`)

---

## Verification (suite-level)

- [ ] Unit + integration + e2e colocados pasan: `pnpm --filter @dsm/api test`
- [ ] Suite e2e-nest dedicada pasa: `pnpm --filter @dsm/api test:e2e`
- [ ] Lint + typecheck limpios: `pnpm --filter @dsm/api lint && pnpm --filter @dsm/api typecheck`
- [ ] Esquema materializado == `design.md` §Persistencia (F40):
      `pnpm --filter @dsm/db migrate:deploy && pnpm --filter @dsm/api test -- --testPathPattern=import-schema`
- [ ] Contratos válidos:
      `npx @stoplight/spectral-cli lint openspec/changes/US-006-import-masivo-inventario-backend/contracts/openapi/*.yaml && npx @stoplight/spectral-cli lint apps/api/docs/api/openapi.yaml`
- [ ] **No regresión del catálogo existente (US-001/002/003)**:
      `pnpm --filter @dsm/api test -- --testPathPattern='e2e-products|e2e-categories|e2e-storefront|e2e-rbac|e2e-security-edge'`
- [ ] **El refactor de slug es invariante**:
      `pnpm --filter @dsm/api test -- --testPathPattern='common/slug|products.service' && git diff --exit-code 2db5997 -- apps/api/src/products/products.service.spec.ts apps/api/src/products/e2e-products-create.spec.ts`
- [ ] **El import nunca publica ni cambia URLs (AC-9 + regla de US-003)**:
      `pnpm --filter @dsm/api test -- --testPathPattern=e2e-imports-acceptance`
      (el spec compara `status` y `slug` de cada producto antes y después del import con
      `toEqual` — falla si el import mueve cualquiera de los dos)
- [ ] **Ningún contenido del archivo escapa por log (observabilidad)**:
      `pnpm --filter @dsm/api test -- --testPathPattern=e2e-imports-observability`
- [ ] Dependencias nuevas en el lockfile y sin vulnerabilidades altas:
      `pnpm install --frozen-lockfile && pnpm audit --audit-level=high`
- [ ] CI del monorepo verde: `pnpm -r lint && pnpm -r typecheck && pnpm -r test`

---

## Trazabilidad AC → tasks

| AC | Tasks | Estado |
|---|---|---|
| AC-1 (alta + actualización por SKU) | T0.2, T3.2, T4.1, T4.2, T5.2, T7.1 | en este change |
| AC-2 (categoría inexistente se crea) | T3.3, T4.1, T7.2 | en este change |
| AC-3 (se encola enriquecimiento + embeddings) | T0.2, T3.2, T4.4, T7.2 | **parcial en este change**: marca durable `enrichment_done=false` + puerto de encolado. El **encolado real en BullMQ y el consumidor** son `Deferred: US-005 (+ Redis de US-019) — owner: Arquitecto` (OQ-BE-4) |
| AC-4 (actualización masiva de precios) | T1.3, T3.2, T4.2, T7.1 | en este change |
| AC-5 (importa válidas, reporta inválidas) | T1.3, T4.2, T4.3, T5.3, T5.4, T7.3 | en este change |
| AC-6 (formato/columnas inválidas → rechazo total) | T1.1, T1.2, T5.1, T5.2, T7.3 | en este change |
| AC-7 (procesamiento async con progreso) | T4.3, T5.2, T5.3, T5.4, T7.3 | en este change — contrato asíncrono con ejecutor in-process (ADR-0012, OQ-BE-1); la **UI de progreso y la descarga** son FE-US-006 |
| AC-8 (sólo el admin puede importar) | T5.2, T5.5 | en este change — `AdminGuard` reusado sin modificar |
| AC-9 (producto nuevo no se publica solo) | T3.2, T4.2, T7.1 | en este change |
| AC-10 (re-importar no duplica) | T3.2, T4.2, T7.1 | en este change |
| AC-11 (límite de tamaño/filas) | T0.3, T1.1, T1.2, T5.2, T7.3 | en este change — límites de OQ-BE-3 |

### Declaraciones de `design.md` que **no** son AC (F51)

| Declaración | Task | Estado |
|---|---|---|
| ADR-0012 (ejecución in-process — enmienda a ADR-0004) | T0.1 | en este change — **bloquea la implementación**: T0.1 va primero |
| Migración: 2 tablas (29 columnas), 4 índices, 1 FK en cascada + `products.enrichment_done` (§Persistencia, F40) | T0.2 | en este change |
| 9 variables de entorno validadas por Zod al arranque (§7) | T0.3 | en este change |
| Validación de upload: magic bytes, encoding estricto, cap de expansión, filename como metadata (§6.4) | T1.1, T1.2, T5.2 | en este change |
| Esquema de columnas v1 fijo + rechazo del separador de miles (§5.5) | T1.3, T8.2 | en este change |
| `resolveSlug` extraído y compartido; refactor de comportamiento invariante | T2.1 | en este change |
| Slug por lote sin N+1 y sin colisión intra-lote | T2.2, T4.2 | en este change |
| SKU repetido en el archivo → `duplicate_sku_in_file` (no "gana el último") | T4.2 | en este change |
| Categoría creada fuera de la transacción de la fila (huérfana benigna, declarada) | T3.3, T4.1 | en este change |
| Un solo trabajo concurrente (409) + heartbeat + reaper al arranque | T3.1, T4.3, T5.2 | en este change |
| Tope de filas de reporte + `report_truncated` | T3.1, T4.3, T5.3 | en este change |
| `Idempotency-Key` con UNIQUE (`api-standards §10`) | T3.1, T5.2 | en este change |
| Retención 90 días con purga oportunista (OQ-BE-6) | T3.1 | en este change |
| Neutralización de fórmulas CSV en el reporte (§6.3) | T5.4 | en este change |
| Errores de dominio `dsm:import/*` + títulos 413/415 en el filtro existente (§6) | T5.1 | en este change |
| Rate limit 3/h sobre el throttler `auth`, sin tercer throttler (§7.3) | T5.5 | en este change |
| 3 eventos agregados sin PII ni cardinalidad por trabajo (E2E §18) | T6.1 | en este change |
| Contratos: 3 yaml + spec publicado + README + runbook (capacidad `catalogo`) | T8.1, T8.2 | en este change |
| Invalidación del catálogo del storefront al completarse el import | — | `Deferred: FE-US-006 — owner: PO` — el backend no tiene canal hacia Next; el panel llama `revalidateCatalog()` al ver `completed`. **Sin esto el storefront puede servir precios viejos**: coordinar el corte |
| Adapter BullMQ del puerto de enriquecimiento + worker dedicado | — | `Deferred: US-005 / US-019 — owner: Arquitecto` (Redis sin aprovisionar) |
| Listado/historial de imports (`GET /v1/admin/imports`) | — | `Deferred: US-016 (panel de métricas) — owner: PO` |
| Fallback de encoding windows-1252 | — | `Deferred: revisitar tras el primer import real — owner: Arquitecto` (OQ-BE-5) |
| Entrada de runbook "import atascado en running" (E2E §18.5) | T8.2 | en este change |
| Archivos de prueba representativos, carga y aceptación cross-stack | — | `Deferred: QA-US-006 — owner: QA` |
