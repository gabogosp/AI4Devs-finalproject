---
parent-us: US-006
discipline: backend
variant: null
language: es
---

# US-006 Backend — Design

> Diseño de la **superficie de escritura masiva** del catálogo: el primer endpoint de
> `apps/api` que acepta un **archivo** y el primero que hace trabajo **fuera del request**.
> Reutiliza íntegro el borde HTTP de US-001 (filtro RFC 7807 `dsm:*`, `ValidationPipe`
> 422, helmet §7.1, allowlist CORS §7.2, throttler nombrado `auth`, `AdminGuard`) y la
> derivación de slug de US-003. **No re-arquitectura** nada del catálogo existente.

## Contexto

El sustrato ya existe: `products` (13 columnas tras este change) con `sku` UNIQUE, `slug`
UNIQUE derivado server-side, CHECKs de `price_ars_cents > 0`, `stock >= 0` y
`status IN (draft,published,archived)`; `categories` con `slug` UNIQUE; `ProductsRepository`
como único punto de acceso al ORM que traduce P2002/P2003/P2025 a errores de dominio y
distingue la colisión de `sku` de la de `slug`; `ProductsService.deriveUniqueSlug` con
desambiguación determinista por sufijo ordinal.

Lo que **no** existe es la infraestructura asíncrona que la US y el E2E §9.3 dan por sentada: el
add-on Redis no está aprovisionado (US-019, task pendiente) y `apps/worker` es un README
placeholder. US-014 ya difirió su purga programada de tokens por exactamente este motivo.
Este change resuelve esa tensión sin inventar infraestructura ni renunciar a AC-7 — ver
§Enfoque → *Modo de ejecución* y **OQ-BE-1**.

Este change entrega **comportamiento + esquema**: dos tablas nuevas de trabajo y una
columna que el DER del E2E §8 ya declaraba (`enrichment_done`) y que el esquema AS-BUILT
todavía no tenía.

## Objetivos

- Reconciliar el archivo contra el catálogo **por `sku`**: crear lo nuevo, actualizar lo
  existente, sin duplicar (AC-1, AC-4, AC-10).
- Crear automáticamente las categorías referenciadas que falten, con nombre normalizado
  (AC-2).
- Importar las filas válidas y **reportar** las inválidas con número de fila y motivo, con
  atomicidad **por fila** (AC-5).
- Rechazar el archivo completo, sin impacto, cuando el formato o las columnas no sirven
  (AC-6).
- Procesar fuera del request, con estado/progreso consultable y reporte descargable (AC-7).
- Restringir la superficie al rol admin (AC-8) y acotar tamaño / filas / expansión antes de
  procesar (AC-11).
- Que los productos nuevos nazcan `draft` y que el import **nunca** cambie el estado de
  publicación (AC-9).
- Dejar marca durable de "pendiente de enriquecer" para que US-005 pueda reconstruir su
  cola desde la base (AC-3, parcial).

## No objetivos

- **Enriquecimiento IA / embeddings** → US-005. Acá sólo la marca + el puerto.
- **Cola BullMQ + worker dedicado** → bloqueado por infraestructura (US-019). El contrato
  se diseña para que el swap del ejecutor no toque HTTP ni esquema.
- **Mapeo de columnas configurable, imágenes desde archivo, imports recurrentes** → US §4.
- **Historial/listado de imports** → `Deferred: US-016 — owner: PO`.
- **Pantalla de import** (upload, progreso, descarga) → FE-US-006.
- **Archivos de prueba representativos, carga y aceptación cross-stack** → QA-US-006.

## Enfoque

### Estructura — nuevo módulo de feature `imports`

```
apps/api/src/imports/
  imports.module.ts                 # importa ProductsModule + CategoriesModule
  imports.controller.ts             # @Controller('v1/admin/imports') + AdminGuard
  imports.service.ts                # caso de uso: crear job, leer job, generar reporte
  import-runner.ts                  # ejecución por lotes fuera del request (ADR-0012)
  import-jobs.repository.ts         # único punto de ORM de import_jobs / import_job_rows
  import-errors.ts                  # errores de dominio dsm:import/*
  parsing/
    detect-format.ts                # magic bytes + encoding (§6.4)
    read-rows.ts                    # lectura en streaming CSV/XLSX con caps
    row-schema.ts                   # validación por fila → ParsedRow | RowError
  slug/
    batch-slug-allocator.ts         # asignación de slug por lote (sin N+1)
  enrichment/
    enrichment-queue.port.ts        # puerto + token de inyección
    noop-enrichment-queue.ts        # adapter interino (US-005 trae el de BullMQ)
  dto/import.dto.ts                 # DTOs de entrada y de respuesta
```

`ProductsRepository` y `CategoriesRepository` se **extienden** (siguen siendo el único punto
de acceso al ORM de sus tablas, `backend-node-standards §5`); el servicio de import es un
caso de uso propio y **no** reusa `ProductsService.create` (que es de a uno y hace una query
de slug por producto).

### Modo de ejecución — contrato asíncrono, ejecutor in-process (ADR-0012)

La US pide procesamiento asíncrono con progreso (AC-7) y el E2E §9.3 lo resuelve con
BullMQ. Esa infraestructura **no existe todavía**. Se elige la tercera vía:

- El **contrato es asíncrono desde el día uno**: `POST` persiste el trabajo y responde
  **202** con su id; el estado, el progreso y el reporte se consultan por `GET`.
- El **ejecutor es in-process**: al responder el 202, el servicio dispara el runner con
  `setImmediate`, que procesa en lotes cediendo el event loop entre lote y lote.
- El **estado vive en Postgres**, no en la memoria del proceso: `import_jobs` guarda
  contadores y progreso; `import_job_rows` guarda el reporte.
- **Un solo trabajo concurrente**: un `POST` con otro trabajo en `pending`/`running`
  devuelve `409 dsm:import/already-running`. Un solo dueño no necesita paralelismo, y el
  límite acota el consumo del proceso del API.
- **Reaper al arranque + heartbeat**: el runner actualiza `heartbeat_at` por lote; al
  bootear, los trabajos `running` sin heartbeat reciente pasan a `failed` con
  `error_code = 'interrupted'`. Un redeploy de Railway mata el runner: el operador re-sube
  el archivo y la reconciliación por SKU (AC-10) hace que las filas ya importadas sean
  no-ops.

Cuando exista Redis (US-019) y el worker (US-005), la migración es un **swap del ejecutor**:
`ImportRunner` pasa a ser un `Processor` de BullMQ que lee el mismo `import_jobs` y escribe
los mismos contadores. **El contrato HTTP y el modelo de datos no cambian.** Ese criterio
de migración es el cuerpo de ADR-0012.

> Esto es una **desviación consciente** del anti-patrón "`setTimeout`-based queues"
> (`backend-node-standards §11`). Se declara como interina y acotada: cap de filas, un solo
> trabajo, estado durable en Postgres y criterio de salida escrito. El anti-patrón que el
> standard proscribe es simular durabilidad con temporizadores; acá la durabilidad la da la
> base y lo único in-process es *quién* ejecuta.

### API — tres endpoints

| Método | Ruta | Auth | Éxito | Errores |
|---|---|---|---|---|
| `POST` | `/v1/admin/imports` | admin | `202` + `Location` | `401`, `403`, `409`, `413`, `415`, `422`, `429` |
| `GET` | `/v1/admin/imports/{id}` | admin | `200` | `401`, `403`, `404`, `422`, `429` |
| `GET` | `/v1/admin/imports/{id}/report` | admin | `200` (`text/csv`) | `401`, `403`, `404`, `429` |

- `POST` recibe `multipart/form-data` con un único campo `file`. Acepta `Idempotency-Key`
  opcional (`api-standards §10`): la clave se persiste con UNIQUE y un reintento con la
  misma clave devuelve **200** con el trabajo ya creado en vez de crear uno nuevo.
- `GET {id}` devuelve estado, contadores y las filas rechazadas paginadas con `limit`/
  `offset` (mismo contrato de paginación que el listado admin de US-001, `api-standards §6.1`).
- `GET {id}/report` devuelve el CSV descargable
  (`Content-Disposition: attachment; filename="import-{id}-errores.csv"`).
- **Sin caché**: el middleware de borde ya estampa `Cache-Control: no-store` en todo
  `/v1/admin` (US-001).

**Shape de `GET {id}`**:

```ts
{
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  filename: string;
  source_format: 'csv' | 'xlsx';
  total_rows: number | null;        // null hasta que termina la lectura
  processed_rows: number;
  created_count: number;
  updated_count: number;
  failed_count: number;
  categories_created_count: number;
  error_code: string | null;        // fallo global (AC-6) — null si el fallo es por fila
  error_message: string | null;
  report_truncated: boolean;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  errors: Array<{ row_number: number; sku: string | null; field: string | null;
                  error_code: string; error_message: string }>;
  pagination: { limit: number; offset: number; total: number };
}
```

El progreso que muestra el panel es `processed_rows / total_rows` (y `pending` cuando
`total_rows` todavía es `null`).

### Esquema de columnas v1 (fijo y documentado)

| Encabezado | Requerido | Regla |
|---|---|---|
| `sku` | sí | 1..64 caracteres, sin espacios en los extremos, único dentro del archivo |
| `nombre` | sí | 1..200 caracteres, sin caracteres de control |
| `descripcion` | no | 0..2000 caracteres |
| `precio` | sí | ARS con IVA incluido; dígitos + separador decimal `,` o `.` con ≤ 2 decimales; `> 0`. Se convierte a centavos |
| `stock` | sí | entero `>= 0` |
| `categoria` | sí | 1..120 caracteres; se normaliza a slug para reconciliar |
| `imagen_url` | no | esquema `https:` únicamente, ≤ 2048 caracteres |

El encabezado se reconoce **normalizado** con la misma función `slugify()` de la app, así
que `Descripción`, `DESCRIPCION` y `descripcion` son la misma columna. Un encabezado
desconocido se **ignora** (no rompe el archivo); la ausencia de un encabezado **requerido**
rechaza el archivo entero con `422 dsm:import/missing-columns` listando cuáles faltan (AC-6).

**El separador de miles se rechaza**: `1.234` es ambiguo entre 1,234 y 1234, y adivinar
sobre el precio de un catálogo es inaceptable. Sólo dígitos + un separador decimal.

### Reconciliación por SKU — qué se toca y qué no

| Campo | SKU nuevo (crea) | SKU existente (actualiza) |
|---|---|---|
| `sku` | del archivo | clave — no se toca |
| `slug` | derivado del `nombre` server-side | **NO se recalcula** |
| `name` | del archivo | del archivo |
| `description_raw` | del archivo o `null` | del archivo si la celda trae valor |
| `price_ars_cents` | del archivo | del archivo |
| `stock` | del archivo | del archivo |
| `category_id` | resuelto/creado | resuelto/creado |
| `image_url` | del archivo o `null` | del archivo si la celda trae valor |
| `status` | **`draft` fijado server-side** | **NO se toca** |
| `enrichment_done` | `false` | `false` sólo si cambió `description_raw` |

Dos reglas heredadas, no re-decididas:

1. **El `slug` no se recalcula al renombrar** — regla establecida por US-003: la URL ya pudo
   indexarse y regenerarla la rompería (301 + re-crawl). Un import que renombra "Heladera"
   a "Heladera Exhibidora" mantiene `/productos/heladera`. Sin excepción para el import: si
   la regla vale para una edición de a uno, vale más para 5.000.
2. **El import no publica ni despublica** — AC-9 + la máquina de estados de US-001
   (`products.state.ts`). El archivo no tiene columna `estado` y no la va a tener: publicar
   es una decisión explícita del dueño sobre un producto que ya revisó.

**SKU repetido dentro del mismo archivo**: la primera ocurrencia se procesa, las siguientes
se rechazan con `duplicate_sku_in_file`. No es "gana el último" silencioso — es un error de
datos del operador y merece aparecer en el reporte.

### El slug en lote — sin N+1 y sin colisión intra-lote

`ProductsService.deriveUniqueSlug` (US-003) hace **una query por producto**
(`findSlugsByPrefix`) y no ve las filas del mismo lote: dos "Heladera" en el mismo archivo
calcularían ambas `heladera` y la segunda violaría el UNIQUE. Con 5.000 filas eso son
5.000 queries y un porcentaje garantizado de fallos evitables.

La política de desambiguación **no se duplica**: se **extrae** de `ProductsService` a una
función pura, que el service de a uno y el allocator de lote comparten.

```ts
// common/slug.ts — política pura, sin I/O, sin framework
export function resolveSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let ordinal = 2;
  while (taken.has(`${base}-${ordinal}`)) ordinal += 1;
  return `${base}-${ordinal}`;
}
```

`ProductsService.deriveUniqueSlug` pasa a ser `resolveSlug(base, new Set(await
repo.findSlugsByPrefix(base)))` — **refactor behavior-invariant** (Extract Method): la
frontera que no se mueve es el comportamiento observable de `POST /v1/admin/products`, y la
prueba es que `products.service.spec.ts` y `e2e-products-create.spec.ts` siguen verdes sin
cambios (skill `refactoring-discipline`).

El `BatchSlugAllocator` del import usa la misma función con dos fuentes en el `Set`:

1. **Una sola query por lote**: `findSlugsByPrefixes(bases[])` →
   `findMany({ where: { OR: bases.map(b => ({ slug: { startsWith: b } })) }, select: { slug: true } })`.
   Con lotes de 200, un archivo de 5.000 filas hace **25 queries** en vez de 5.000.
2. **Un acumulador en memoria** que vive todo el trabajo: cada slug asignado se agrega, así
   la segunda "Heladera" del archivo obtiene `heladera-2` sin volver a la base.

Sólo se asignan slugs a las filas que **realmente crean**: el lote arranca con
`findManyBySkus(skus)`, que ya hace falta para separar altas de actualizaciones y para los
contadores. Una actualización no consume ordinales.

La carrera residual con el panel admin (alguien crea un producto homónimo mientras corre el
import) la sigue atrapando el UNIQUE de la base → `ConflictError` del repositorio → **un**
reintento de la fila recalculando desde el set refrescado → si vuelve a colisionar, la fila
va al reporte con `slug_conflict`. La base sigue siendo la autoridad; el allocator es sólo
la optimización.

### Categorías auto-creadas (AC-2)

El nombre del archivo se normaliza con `slugify()` — la misma función que usa
`CategoriesService.create` (US-001), así que "Plomería", "plomeria" y "PLOMERÍA" resuelven
al mismo `plomeria` y no duplican. Por lote: una query `findManyBySlugs(slugs)` y una
creación por cada slug ausente, como **rubro raíz** (`parent_id: null`) — la jerarquía
rubro/subrubro no es inferible de una columna plana y no se inventa.

La categoría se crea **fuera** de la transacción de la fila. Consecuencia declarada: si la
fila falla después, la categoría creada sobrevive. Es benigno (una categoría vacía no es una
escritura parcial de producto) y evita repetir la creación por cada fila del mismo rubro.
La carrera con otra creación se resuelve por UNIQUE + re-lectura.

### Atomicidad y reporte (AC-5, AC-6)

Dos niveles, deliberadamente distintos:

- **Nivel archivo (AC-6)** — todo o nada. Formato no soportado, encoding ilegible,
  encabezados requeridos ausentes o exceso de filas se detectan **antes** de escribir
  cualquier producto: el `POST` responde 4xx y no se crea ni siquiera el trabajo. Impacto
  en el catálogo: cero.
- **Nivel fila (AC-5)** — fila a fila. Cada fila válida se escribe en su propia
  `prisma.$transaction`; una fila inválida o que falla al escribir no aborta el trabajo ni
  deja escritura parcial. El resultado es un trabajo `completed` con `failed_count > 0`.

El reporte se persiste en `import_job_rows` **sólo para las filas rechazadas** (las buenas
ya están en `products`), con tope `IMPORT_MAX_REPORT_ROWS` (default 1.000): superado el
tope se deja de persistir y se marca `report_truncated = true`, mientras `failed_count`
sigue contando el total real. Un archivo íntegramente malo no puede convertir el reporte en
un segundo problema de almacenamiento.

Catálogo cerrado de códigos de error por fila (aparecen en el JSON y en el CSV):
`missing_required`, `invalid_sku`, `name_too_long`, `invalid_price`, `invalid_stock`,
`invalid_category`, `invalid_image_url`, `duplicate_sku_in_file`, `slug_conflict`,
`write_failed`.

### Marca de enriquecimiento (AC-3, parcial)

El DER del E2E §8 ya declara `products.enrichment_done`; el esquema AS-BUILT no la tenía.
Se materializa acá porque es lo que hace **verificable** el AC-3 sin infraestructura de cola:

- El import la pone en `false` al crear y al cambiar `description_raw` — E2E §9.3
  ("re-enriquecer sólo si cambia `description_raw`", control de costo de Gemini).
- Al terminar el trabajo, el servicio llama al **puerto** `EnrichmentQueue.enqueue(ids)`.
  El adapter interino es un no-op que registra el conteo; el adapter BullMQ lo trae US-005.
- La marca es **durable**: US-005 puede reconstruir su cola con
  `WHERE enrichment_done = false` aunque ningún evento se haya encolado. Un evento perdido
  en el aire habría dejado el AC-3 sin rastro recuperable.

### Persistencia

Migración **aditiva** de `packages/db` (`backend-node-standards §5` — expand-and-contract;
nada destructivo). Dos tablas nuevas y una columna nueva. Ninguna tabla existente se
reescribe.

**`import_jobs`** — 21 columnas:

| Columna | Tipo | Nota |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `status` | text | `pending` \| `running` \| `completed` \| `failed`; default `pending` |
| `filename` | text | metadata de display del archivo subido; **nunca** se usa como path (§6.4) |
| `file_size_bytes` | int | |
| `source_format` | text | `csv` \| `xlsx` |
| `idempotency_key` | text NULL | UNIQUE (`api-standards §10`) |
| `created_by_subject` | text NULL | claim `sub` del JWT admin — pseudónimo, no PII |
| `total_rows` | int NULL | null hasta que termina la lectura |
| `processed_rows` | int | default 0 |
| `created_count` | int | default 0 |
| `updated_count` | int | default 0 |
| `failed_count` | int | default 0 |
| `categories_created_count` | int | default 0 |
| `error_code` | text NULL | fallo global (`interrupted`, …) |
| `error_message` | text NULL | |
| `report_truncated` | boolean | default false |
| `started_at` | timestamptz NULL | |
| `finished_at` | timestamptz NULL | |
| `heartbeat_at` | timestamptz NULL | insumo del reaper |
| `created_at` | timestamptz | default now() |
| `updated_at` | timestamptz | `@updatedAt` |

Índices: UNIQUE(`idempotency_key`), índice(`status`) para el reaper y el chequeo de
concurrencia, índice(`created_at`) para la purga por retención.

**`import_job_rows`** — 8 columnas:

| Columna | Tipo | Nota |
|---|---|---|
| `id` | uuid PK | |
| `job_id` | uuid FK → `import_jobs.id` | `onDelete: Cascade` |
| `row_number` | int | número de fila del archivo, 1-based sobre datos |
| `sku` | text NULL | null cuando la fila ni siquiera trae SKU |
| `field` | text NULL | campo culpable cuando aplica |
| `error_code` | text | del catálogo cerrado de arriba |
| `error_message` | text | mensaje para el dueño, en español |
| `created_at` | timestamptz | default now() |

Índice: (`job_id`, `row_number`).

**`products.enrichment_done`** — `boolean NOT NULL DEFAULT false`. `ADD COLUMN` con default
en PostgreSQL ≥ 11 no reescribe la tabla, así que la migración es instantánea. Los productos
existentes quedan en `false`, que es correcto: ninguno fue enriquecido nunca.

**Retención**: la purga de trabajos con `created_at` anterior a `IMPORT_RETENTION_DAYS`
(default 90) se hace de forma **oportunista** al crear un trabajo nuevo (`DELETE` acotado,
cascada a las filas). No hay cron porque no hay cola; el costo es una sentencia por import.

> Decisión de datos: motor único PostgreSQL, coherente con ADR-0002. El caso es relacional
> con integridad referencial (job → filas), volumen pequeño y consistencia estricta — encaja
> en el baseline sin desviación. **`data-architect` Mode B no se invocó**: dos tablas
> aditivas de trabajo, sin movimiento de datos, sin nuevo motor, sin compliance
> (`project-config.yml` → `compliance: []`).

### Seguridad — threat model lite (STRIDE del upload admin)

Superficie: endpoint admin que **acepta un archivo** — combina el walkthrough de "POST que
crea recurso", el de "endpoint admin" y las reglas de upload de `security-standards §6.4`.

| Amenaza | Vector concreto | Control |
|---|---|---|
| **Spoofing** | JWT admin robado sube un catálogo falso | `AdminGuard` (ADR-0009, sin cambios); rate-limit 3/h/IP sobre el throttler `auth`; US-014 endurece la emisión |
| **Tampering** | El archivo intenta fijar `status`, `slug`, `id` o `enrichment_done` | Esquema de columnas **allowlist**: el parser sólo lee las 7 columnas conocidas y las desconocidas se ignoran. `status` y `slug` se fijan server-side; no existe camino desde el archivo |
| **Repudiation** | "Yo no subí ese archivo que puso todos los precios en $1" | `import_jobs` **es** el audit trail: `created_by_subject`, `filename`, `file_size_bytes`, contadores y timestamps, retenidos 90 días + eventos `import.*` |
| **Information disclosure** | El 422 de columnas revela el esquema de la base; el reporte filtra internals | El 422 lista los **encabezados del archivo** que faltan, no columnas de la base; el `HttpProblemFilter` global impide que escape SQL, stack o código Prisma; el reporte sólo contiene datos del propio archivo del operador |
| **Denial of service** | Archivo de 2 GB; xlsx zip-bomb que descomprime a 10 GB; 100 imports en paralelo | Cap de tamaño **antes** de bufferizar (413); cap de **bytes descomprimidos** que aborta el stream; cap de filas; **un solo trabajo concurrente** (409); lectura en streaming, nunca el workbook entero en memoria |
| **Elevation of privilege** | El archivo publica productos o crea un admin | El import no escribe `status` ni ninguna tabla de auth; toda la superficie exige `role=admin` |
| **Injection** | SQL desde una celda; fórmula CSV en el reporte | Prisma parametriza todo (`§6.2`); **el riesgo real es el CSV que generamos**: toda celda del reporte que empiece con `= + - @`, tab o CR se prefija con `'` antes de escribirse, para que Excel no la evalúe al abrirla |

**Validación del archivo** (`§6.4`), en este orden y todo antes de escribir:

1. **Tamaño** — cap de multer (`limits.fileSize`, `limits.files: 1`) → `413`. Se rechaza
   antes de bufferizar el cuerpo completo.
2. **Tipo por contenido, no por header** — `Content-Type` y extensión son
   atacante-controlados. Se sniffean **magic bytes**: `PK\x03\x04` ⇒ xlsx (contenedor ZIP);
   cualquier otra cosa se intenta como texto. Un tipo no reconocido → `415`.
3. **Encoding** — se acepta UTF-8 con o sin BOM. Un CSV que no decodifica como UTF-8 válido
   se rechaza con `422 dsm:import/invalid-encoding` y un mensaje accionable ("guardá el CSV
   como UTF-8"). **No se adivina** el encoding: interpretar mal un catálogo entero es peor
   que pedir que lo guarden bien (ver **OQ-BE-5**).
4. **Expansión** — el lector xlsx aborta si los bytes descomprimidos superan
   `IMPORT_MAX_UNCOMPRESSED_BYTES` (defensa zip-bomb).
5. **Filas** — al superar `IMPORT_MAX_ROWS` se aborta con `422
   dsm:import/row-limit-exceeded` (AC-11).
6. **Encabezados** — requeridos ausentes → `422 dsm:import/missing-columns` (AC-6).
7. **Nombre de archivo** — es metadata de display. Nunca se usa como path ni se persiste
   como ruta; el contenido se procesa desde memoria y no se escribe a disco.

**Escalation rule** (`threat-modeling-lite`): no aplica — sin PCI, sin PHI, sin primitiva
criptográfica nueva, sin cruce de frontera de confianza con terceros. Lite alcanza.

### NFRs cuantificados

| NFR | Valor | Instrumentación |
|---|---|---|
| `POST /v1/admin/imports` p95 | `< 500 ms` `[propuesto — confirma Arquitecto]` (sólo valida encabezado y persiste el trabajo; no procesa) | logs pino + duración de transacción |
| `GET /v1/admin/imports/{id}` p95 | `< 300 ms` `[propuesto — confirma Arquitecto]` | ídem |
| Duración del trabajo | archivo al tope (5.000 filas) `< 3 min` p95 `[propuesto — confirma tras la primera medición en Neon]` | `finished_at - started_at`, evento `import.completed` |
| Límite de filas | **5.000** (OQ-BE-3, decisión del PO) — **exactamente** el catálogo objetivo del E2E §21, **sin margen**: ver la advertencia debajo de la tabla | contador + `422` |
| Límite de tamaño | **4 MiB** — una fila de este esquema con descripción base ronda 700 B; 5.000 × 700 B ≈ 3,5 MB, así que 4 MiB cubre el archivo completo al tope con holgura mínima | `413` |
| Límite de expansión | **32 MiB** descomprimidos (8× el cap comprimido — se mantiene la proporción del cálculo original) | aborta el stream |
| Rate limit | **3 imports / hora / IP**, sobre el throttler `auth` existente | `429` + `Retry-After` + `RateLimit-*` |
| Concurrencia | **1 trabajo** a la vez | `409` |
| Disponibilidad | tier 3 (backoffice) — hereda el 99,5 % mensual del PRD §4; una caída del import no afecta el storefront | health checks Railway |

> ⚠ **El límite de 5.000 filas queda sin margen — costo explícito de la decisión.** El E2E
> §21 estima el catálogo de DSM en **~5.000 SKUs**, así que el tope coincide exactamente con
> el tamaño del catálogo completo: **hoy entra justo, mañana no**. Consecuencias que hay que
> tener escritas y no implícitas:
>
> - Un catálogo que crezca por encima de ~5.000 SKUs **ya no se puede subir en un solo
>   archivo**: el dueño tendrá que partirlo en dos, y el sistema le devolverá `422
>   dsm:import/row-limit-exceeded` sin más pista que el mensaje. Es una fricción operativa
>   real, no teórica: basta con que el proveedor sume una línea de productos.
> - El límite de tamaño (4 MiB) es el que primero puede morder: la estimación de 700 B por
>   fila supone descripciones base cortas. Un catálogo con descripciones largas puede tocar
>   los 4 MiB **antes** de las 5.000 filas, y entonces el rechazo llega como `413` y no como
>   `422`, que es un mensaje distinto para la misma causa de fondo.
> - **Gatillo de revisión**: cuando `count(products)` supere **4.000** (80 % del tope) o
>   cuando aparezca el primer `422 dsm:import/row-limit-exceeded` real en producción, hay que
>   **volver a medir** la duración del trabajo con el archivo al tope y reevaluar el límite.
>   Ambos límites son variables de entorno (`IMPORT_MAX_ROWS`, `IMPORT_MAX_FILE_BYTES`), así
>   que subirlos no requiere despliegue de código — pero **sí** requiere re-medir: el ejecutor
>   es in-process y comparte CPU con el request path, que es la razón por la que el tope
>   existe. Subir el número sin medir traslada el problema al `POST` del storefront.
> - `[Resolved: 2026-08-20 — OQ-BE-3 opción (b), decisión del PO]`. La opción (a) proponía
>   10.000 / 8 MiB precisamente para tener ese margen; el PO optó por el tope ajustado. Queda
>   registrado para que la revisión futura sepa qué se descartó y por qué.

### Observabilidad

Se extiende `CatalogEventsService` (el import **es** catálogo) con tres eventos y con un
quinto parámetro opcional `fields` para los contadores agregados — cambio aditivo, la firma
existente sigue funcionando:

| Evento | Cuándo | Campos |
|---|---|---|
| `import.started` | el runner toma el trabajo | `entity_id` = job id, `source_format`, `total_rows` |
| `import.completed` | el runner termina | contadores `created` / `updated` / `failed` / `categories_created`, `duration_ms` |
| `import.failed` | fallo global o trabajo huérfano recuperado | `error_code` |

**Sin evento por fila**: 5.000 filas serían 5.000 líneas de log por import — el reporte ya
vive en la base y es consultable. Los contadores no llevan `job_id` como dimensión de
métrica (cardinalidad — `observability-patterns §3.3`); el id va al log.

**PII**: no hay. El único identificador de persona es `created_by_subject` (claim `sub` del
admin, pseudónimo interno). El contenido del archivo es dato comercial del dueño, no PII de
clientes; aun así **no se loguean celdas** — sólo conteos y códigos de error.

### Resiliencia

- **Sin dependencias externas nuevas en runtime**: sólo Postgres. No hay llamadas salientes
  (Gemini es de US-005), así que no hay timeouts/circuit-breaking que planificar.
- **Reintento acotado**: una fila que colisiona en `slug` se reintenta **una** vez con el set
  refrescado; el resto de los fallos de escritura van directo al reporte. No hay backoff
  porque no hay dependencia flaky que absorber.
- **Idempotencia**: `Idempotency-Key` a nivel request (`api-standards §10`) y, sobre todo,
  idempotencia **semántica** por SKU (AC-10) — re-subir el archivo después de una
  interrupción converge al mismo estado.
- **Interrupción**: heartbeat + reaper al arranque (ver *Modo de ejecución*).

### Impacto en el storefront

Los precios y el stock que toca el import son exactamente los que sirven US-002 y US-003.
Hay **dos cachés** en el camino y ninguna se entera sola de una escritura masiva:

1. **`Cache-Control: public, max-age=60, stale-while-revalidate=30`** del API público
   (US-003 AC-9): un CDN puede servir hasta ~90 s de precio viejo. Acotado y aceptable — es
   el mismo compromiso ya firmado para la edición de a uno.
2. **La Data Cache de Next**, etiquetada `product:{slug}` y `CATALOG_TAG`. El panel invalida
   por mutación (`revalidateProduct` / `revalidateCatalog`), pero el import es una mutación
   masiva que el FE no ve fila por fila. **Sin invalidación explícita, el storefront puede
   servir precios viejos mucho más de 60 s.**

**Contrato cross-stack (obligación de FE-US-006)**: al ver el trabajo en `completed` con
`created_count + updated_count > 0`, el panel llama `revalidateCatalog()` — la invalidación
**global**, no la por-slug: miles de slugs no se invalidan de a uno, y `revalidateCatalog()`
ya purga tag de catálogo, rutas de categoría, home y sitemap. Los productos **creados** nacen
`draft` y no afectan al storefront; el riesgo real son los **actualizados** que ya estaban
`published`.

Queda declarado en la §Consideraciones de despliegue para que el corte de FE y BE vaya junto.

### Testing (owned-by-dev; `qa-backend-standards §2.1`)

- **Unit**: parser de precios (formatos válidos/inválidos, separador de miles rechazado);
  validación por fila (los 10 códigos de error); `resolveSlug` puro (base libre, ocupada,
  cadena de ordinales); neutralización de fórmulas del CSV; detección de formato por magic
  bytes.
- **Integration (Postgres real de `docker-compose`)**: `ImportJobsRepository`;
  `findSlugsByPrefixes` y `findManyBySkus`; creación de categorías por lote con colisión.
- **e2e-nest (supertest)**: los 11 AC — upsert por SKU, categoría auto-creada, marca de
  enriquecimiento, actualización masiva de precios, reporte de filas rechazadas, rechazo del
  archivo, 202 + progreso + reporte, RBAC, `draft`, idempotencia por SKU, límites.
- **Reconciliación de esquema (F40)**: spec que compara el conjunto **completo** de columnas
  materializadas contra la tabla de §Persistencia — falla si falta **o sobra** una.
- Carga, archivos representativos y aceptación cross-stack: **QA-US-006**, fuera de este
  change.

## Trade-offs

- **Ejecutor in-process vs esperar BullMQ.** Elegido in-process detrás del contrato
  asíncrono. Costo: un redeploy corta el trabajo en curso (mitigado por reaper +
  idempotencia por SKU) y el parseo compite por CPU con el request path (mitigado por el cap
  de filas, un solo trabajo y el `await` entre lotes). Beneficio: US-006 no queda bloqueada
  detrás de US-019 y el swap posterior no toca contrato ni esquema. La alternativa
  "síncrono acotado" se descartó porque mata AC-7 y no llega al catálogo real.
- **Reporte sólo de filas rechazadas vs de todas las filas.** Elegido sólo rechazadas + tope
  de 1.000. Un reporte completo de 5.000 filas duplicaría el catálogo en una tabla de
  trabajo sin agregar información: las filas buenas ya se ven en `products`.
- **Categorías creadas fuera de la transacción de la fila.** Costo: una categoría puede
  quedar huérfana si su primera fila falla. Beneficio: no se repite la creación por cada
  fila del mismo rubro y la transacción de fila queda mínima. El costo es benigno y
  reversible desde el panel.
- **Rechazar el encoding no-UTF-8 vs adivinar windows-1252.** Elegido rechazar con mensaje
  accionable. Adivinar mal escribe "Refrigeraci�n" en 5.000 productos y no hay deshacer.
  Ver **OQ-BE-5**.
- **Extender `CatalogEventsService` vs crear `ImportEventsService`.** Elegido extender: el
  import es catálogo, el consumidor (panel US-016) es el mismo, y un service nuevo
  duplicaría el contador y el formato de log por una razón puramente organizativa.
- **`enrichment_done` como marca durable vs sólo emitir un evento.** Elegido la columna: el
  DER del E2E §8 ya la declaraba y hace el AC-3 verificable y **recuperable** hoy. Un evento
  hacia una cola que no existe se pierde sin rastro.

## Consideraciones de despliegue

- **Requiere migración** — 2 tablas nuevas + `products.enrichment_done`. Orden:
  `prisma migrate deploy` **antes** de arrancar la versión nueva del API (el código nuevo lee
  `enrichment_done`). La migración es segura hacia atrás (la versión vieja ignora tablas y
  columnas que no conoce), así que un rolling deploy sirve.
  ⚠ Recordatorio heredado de US-003: `prisma migrate deploy` aplica **todas** las
  migraciones pendientes de `packages/db`, no las de una US.
- **Dos dependencias runtime nuevas**: `csv-parse` (lectura CSV en streaming) y `exceljs`
  (`WorkbookReader` en streaming — SheetJS carga el workbook entero en memoria y sería el
  vector de zip-bomb que justamente queremos cerrar). Ambas al lockfile
  (`security-standards §9.1`); `@types/multer` como dependencia de desarrollo (multer ya
  viene con `@nestjs/platform-express`).
- **Nueve variables de entorno nuevas**, todas con default seguro y validadas por Zod al
  arranque; si faltan, aplica el default y el boot no rompe.
- **Reinicio ⇒ trabajo interrumpido**: un deploy de Railway mata el runner in-process. El
  reaper lo marca `failed` con `error_code = 'interrupted'` al bootear y el runbook dice
  "re-subí el archivo" (seguro por AC-10). **Evitar desplegar con un import en curso.**
- **Coordinación con FE-US-006**: el panel debe llamar `revalidateCatalog()` al completarse
  el trabajo (ver §Impacto en el storefront). Sin eso, el storefront puede mostrar precios
  viejos indefinidamente. API y FE en el mismo release.
- **Sin feature flag**: superficie nueva, admin-only, sin comportamiento previo que romper.
  El "apagado" es no exponer el endpoint en el panel.
- **Runbook (E2E §18.5)**: entrada nueva — *"Import atascado en `running`"* → verificar
  `heartbeat_at`; si está viejo, reiniciar el servicio (el reaper lo cierra) y re-subir.
- **Se recomienda `/plan-deployment`**: migración de esquema + superficie nueva +
  dependencias nuevas + trabajo en background que comparte proceso con el request path +
  corte coordinado con FE.

## ADR triggers

- **ADR-0012 (nuevo, T0.1)** — *Ejecución in-process del import masivo mientras Redis/BullMQ
  no esté aprovisionado*. Enmienda a ADR-0004 (que queda `Accepted`, no superseded), con
  criterio de migración explícito. Es un ADR y no una nota de diseño porque **desvía de una
  decisión ya aceptada** y porque define el contrato que hace barata la vuelta.
- ADR-0009 (seam RBAC admin) **no se toca**. ADR-0002 (motor único) se **cumple**, no se
  desvía. ADR-0003 (Gemini) no entra: el enriquecimiento es US-005.

## Preguntas abiertas

> **Las seis están resueltas (2026-08-20).** No queda ninguna decisión pendiente: el plan se
> ejecuta completo y en orden. Cinco se resolvieron según la recomendación del diseño; **la
> tercera no** —el PO eligió el tope ajustado en vez del holgado— y ese costo está escrito en
> la advertencia bajo la tabla de §NFRs cuantificados, no sólo acá.

- **OQ-BE-1 — Modo de ejecución del import.**
  `[Resolved: 2026-08-20 — opción (c), contrato asíncrono + ejecutor in-process (ADR-0012)]`
  Se descartó (a) síncrono acotado porque incumple AC-7 y no llega al catálogo real, y (b)
  BullMQ real porque está bloqueado por infraestructura (add-on Redis sin aprovisionar en
  US-019, `apps/worker` vacío) y sumaba ~8-10 h más una dependencia dura de una US a mitad de
  camino. Fundamento de la elegida: cumple AC-7 hoy y, cuando llegue Redis, la vuelta es un
  swap del ejecutor sin tocar el contrato HTTP ni el modelo de datos — el costo de haber
  esperado habría sido mayor que el de migrar después. **Levanta el bloqueo de arranque**:
  T0.1 puede ejecutarse.

- **OQ-BE-2 — Semántica de la celda vacía al actualizar.**
  `[Resolved: 2026-08-20 — opción (a), celda vacía = "no cambiar ese campo"]` Fundamento: es
  la única semántica que permite el archivo de sólo precios —el caso day-2 de AC-4— sin pisar
  el stock real. Se descartó (b) borrar/poner a cero, que convertiría una actualización de
  precios en un vaciado de inventario, y (c) exigir siempre valor, que obliga al dueño a
  mantener el stock exacto en cada archivo que sube. En un alta, una columna **requerida**
  vacía sigue siendo fila inválida (`missing_required`).

- **OQ-BE-3 — Límites de tamaño y filas (AC-11).**
  `[Resolved: 2026-08-20 — opción (b), 5.000 filas · 4 MiB · 32 MiB descomprimidos]`
  **Decisión distinta de la recomendación del diseño**, que proponía 10.000 / 8 MiB para tener
  margen sobre el catálogo objetivo. El PO optó por el tope ajustado. Fundamento registrado
  del costo: el límite coincide **exactamente** con los ~5.000 SKUs que el E2E §21 estima para
  el catálogo, así que **queda sin margen** — el primer crecimiento del catálogo obliga a
  partir el archivo en dos. La advertencia completa, con el gatillo de revisión (80 % del
  tope, o el primer `422` real en producción) y la obligación de **re-medir** antes de subir
  el número, está bajo la tabla de §NFRs cuantificados. Ambos límites son variables de
  entorno, así que el ajuste no requiere despliegue de código — pero sí re-medición, porque el
  ejecutor in-process comparte CPU con el request path.

- **OQ-BE-4 — Alcance de AC-3 (encolado de enriquecimiento).**
  `[Resolved: 2026-08-20 — opción (a), marca durable `enrichment_done = false` + puerto no-op]`
  Fundamento: deja el AC-3 verificable y, sobre todo, **recuperable** — US-005 reconstruye su
  cola con `WHERE enrichment_done = false` sin depender de que ningún evento se haya emitido.
  Se descartó (b) encolar contra el Redis local, que produciría jobs huérfanos y falsa
  sensación de completitud al no haber consumidor ni Redis en la nube, y (c) omitir el AC-3,
  que dejaría a US-005 sin forma de saber qué enriquecer.

- **OQ-BE-5 — Archivos que no son UTF-8.**
  `[Resolved: 2026-08-20 — rechazar con mensaje accionable; nada de adivinar codificación]`
  Excel en Windows exporta CSV en windows-1252 por default, así que el caso va a aparecer y el
  rechazo va a generar fricción real. Se acepta esa fricción: el fallback a windows-1252 puede
  escribir mojibake en miles de productos y no hay deshacer. El error es
  `422 dsm:import/invalid-encoding` con el mensaje "guardá el CSV como UTF-8". *Revisit*: tras
  el primer import real, si el dueño lo sufre de forma recurrente.

- **OQ-BE-6 — Retención del historial de imports.**
  `[Resolved: 2026-08-20 — 90 días, purga oportunista al crear un trabajo nuevo]` Fundamento:
  `import_jobs` es el rastro de auditoría de quién cambió los precios del catálogo y 90 días
  cubren la ventana de disputa razonable sin acumular. Es la variable `IMPORT_RETENTION_DAYS`,
  así que extenderla si contabilidad lo pide no requiere cambio de código.

## Referencias

- US: `docs/user-stories/US-006-import-masivo-inventario.md` (AC-1…AC-11).
- Standards: `backend-node-standards §2/§4/§5/§6/§7/§8/§9/§10/§11`,
  `backend-standards` (layering, expand-and-contract), `api-standards §3.2/§4.2/§5.5/§6.1/§8/§10/§12`,
  `security-standards §6.1/§6.2/§6.3/§6.4/§6.6/§7.1/§7.2/§7.3/§9.1`,
  `observability-patterns §3.3`, `qa-backend-standards §2.1`, `testing-standards §14`.
- Skills: `openspec-workflow`, `api-contract-completeness`, `threat-modeling-lite`,
  `nfr-quantification`, `data-architecture-patterns`, `observability-patterns`,
  `refactoring-discipline`.
- ADR: `0004` (enmendado por `0012`), `0002`, `0009`, `0010`.
- Contratos (draft de este change): `./contracts/openapi/admin-create-import.yaml`,
  `admin-get-import.yaml`, `admin-get-import-report.yaml`.
- Precedentes: `openspec/changes/archive/US-001-admin-catalogo-productos-backend/`,
  `openspec/changes/US-003-ficha-producto-pdp-backend/` (slug, caché pública),
  `openspec/changes/US-014-registro-login-backend/` (patrón de puerto + adapter, ADR-enmienda).
