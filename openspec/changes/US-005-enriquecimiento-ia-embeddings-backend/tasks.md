---
tracker-id: null
parent-us: US-005
discipline: backend
language: es
estimate-hours: 13.4
---

# US-005 Backend — Tasks

> **28 tasks · 13,4 h AI-asistido / ~26 h tradicional.** La US §7 presupuesta BE-US-005 en
> **16–24 h** tradicional: el estimado excede el techo ~2 h con causa nombrada. La US escribió
> "consumer de trabajos + integración con Gemini + persistencia + reintentos/backoff/rate-limit"
> asumiendo que **BullMQ regalaba** el ejecutor, los reintentos, el rate-limit y el progreso. Sin
> cola (ADR-0014), eso se construye a mano: el claim por lease (T2.1), el backoff durable (T3.3),
> el limitador de RPM y el cooldown (T1.3/T3.4) y la superficie admin que hace observable la
> cobertura de AC-3 (T4.1). Se suma la costura de curación de AC-7 (T4.3), que US-001 nunca
> construyó y sin la cual el AC no es verificable. El pipeline en sí —enriquecer, embeddear,
> persistir— son ~4 h.
>
> **Contrato de ejecución**: cada task se cierra cuando su `Verify:` pasa. El `Pattern:` es el
> que hay que usar, no una sugerencia (`openspec-workflow` TOK-2): si falta o no alcanza, STOP y
> volver a `/plan-backend-ticket US-005 --regenerate`.

## Pre-requisitos

- [x] **`products.enrichment_done` existe** en el esquema AS-BUILT (US-006 T0.2, ya migrado en
  `20260820164630_add_import_jobs`). Verificar: `grep -q "enrichment_done" packages/db/prisma/schema.prisma`.
- [x] **Postgres local arriba con pgvector**: `docker compose up -d postgres` (imagen
  `pgvector/pgvector:pg16`; la extensión ya la habilita `20260715000000_enable_pgvector`).
  Verificar: `docker compose exec -T postgres psql -U dsm -d dsm -c "SELECT extname FROM pg_extension WHERE extname='vector'"` devuelve una fila.
- [x] **`GEMINI_API_KEY` en `.env`** (free tier de ADR-0003). Sin ella, T1.4 y las suites corren
  con el fake determinista y el runner arranca `disabled` — ninguna task queda bloqueada, pero
  T6.1 no ejercita el proveedor real.
- [x] **`apps/api` sin cambios sin commitear de otras lanes** (worktree aislado — sprint MVP-2
  §Coordinación 1). `git status --porcelain apps/api packages/db` vacío antes de T0.2: esta task
  toca `schema.prisma`, que es superficie compartida con US-006/US-007.
- [x] **Coordinación con US-006** (misma lane C): si `/develop-backend US-006` ya creó
  `src/imports/enrichment/enrichment-queue.port.ts`, T3.5 lo **mueve** a `src/enrichment/ports/`
  en vez de crearlo. Si US-006 no llegó, este change define el puerto y US-006 lo consume.

---

## Fase 0: ADR, esquema y configuración — 2,3 h

- [x] T0.1 ADR-0014 — ejecutor in-process del enriquecimiento IA (0,5 h)
  - **Pattern**: estructura MADR del repo, copiando la forma de
    `docs/architecture/decisions/0012-in-process-import-executor.md`: `Status` / `Amends` /
    `Context` / `Decision` (con **criterio de migración** explícito) / `Consequences`
    (Positive · Negative · Neutral) / `Alternatives considered` / `References`.
    **Número 0014, no 0013**: el 0013 está reclamado (condicionalmente) por
    `openspec/changes/US-014-registro-login-frontend-web/tasks.md` T0.3.
  - **Exit criterion**: existe `docs/architecture/decisions/0014-in-process-enrichment-executor.md`
    con `Status: Accepted`, `Amends: ADR 0004`, referencia explícita a ADR-0012 como precedente
    extendido, y un **criterio de migración** que nombra las dos condiciones (`REDIS_URL`
    aprovisionado + `apps/worker` desplegado) y qué **no** cambia al migrar (el contrato de los
    dos endpoints, el esquema, la semántica de la cola `WHERE enrichment_done = false`). Como
    negativo declara que la corrida compite con el request path y que un deploy corta la corrida
    (mitigado por el lease, no resuelto). `docs/_index/decisions.yaml` tiene la entrada
    `ADR-0014` con `affects: [backend-nestjs, enrichment, semantic-search, async-processing]` y
    `triggered-by` que cita US-005 + Redis sin aprovisionar.
  - **Verify**: `test -f docs/architecture/decisions/0014-in-process-enrichment-executor.md && grep -q "Status.*Accepted" docs/architecture/decisions/0014-in-process-enrichment-executor.md && grep -qi "amends" docs/architecture/decisions/0014-in-process-enrichment-executor.md && grep -q "ADR 0012\|ADR-0012" docs/architecture/decisions/0014-in-process-enrichment-executor.md && grep -q "REDIS_URL" docs/architecture/decisions/0014-in-process-enrichment-executor.md && grep -q "ADR-0014" docs/_index/decisions.yaml && python3 -c "import yaml,sys; d=yaml.safe_load(open('docs/_index/decisions.yaml')); e=[x for x in d if x['id']=='ADR-0014'][0]; sys.exit(0 if e['status']=='Accepted' and 'enrichment' in e['affects'] else 1)"`

- [x] T0.2 Migración aditiva: 6 columnas en `products` + `product_embeddings` + HNSW + índice parcial (1,2 h)
  - **Pattern**: modelo Prisma con el vector como tipo no soportado y el índice a mano —
    `per E2E §16 — ORM Prisma para esquema/migraciones; kNN por $queryRaw`:
    ```prisma
    model ProductEmbedding {
      product_id    String   @id @db.Uuid
      product       Product  @relation(fields: [product_id], references: [id], onDelete: Cascade)
      embedding     Unsupported("vector(768)")
      model_version String
      generated_at  DateTime @default(now())
      @@map("product_embeddings")
    }
    ```
    ```sql
    -- en la migración generada, a mano (Prisma no expresa HNSW ni índices parciales):
    CREATE INDEX product_embeddings_embedding_hnsw_idx
      ON product_embeddings USING hnsw (embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 64);
    CREATE INDEX products_enrichment_pending_idx
      ON products (enrichment_next_attempt_at) WHERE enrichment_done = false;
    ```
    Migración **aditiva** (`ADD COLUMN` con default, `CREATE TABLE`, `CREATE INDEX`), sin
    `DROP` ni cambio de tipo — `per backend-node-standards.md §5 — expand-and-contract`.
  - **Exit criterion**: `pnpm --filter @dsm/db migrate` aplica una migración nueva que crea
    **exactamente** estas 6 columnas en `products` — `description_enriched TEXT NULL`,
    `description_curated BOOLEAN NOT NULL DEFAULT false`, `enrichment_source_hash TEXT NULL`,
    `enrichment_attempts INTEGER NOT NULL DEFAULT 0`, `enrichment_next_attempt_at TIMESTAMP(3) NULL`,
    `enrichment_error_code TEXT NULL` — más la tabla `product_embeddings` con sus **4** columnas
    (`product_id` PK + FK `ON DELETE CASCADE`, `embedding vector(768) NOT NULL`,
    `model_version TEXT NOT NULL`, `generated_at` con default), el índice **HNSW**
    `vector_cosine_ops` con `m=16`/`ef_construction=64` y el índice parcial de pendientes.
    Ninguna columna ni tabla preexistente se modifica. `schema.prisma` refleja lo mismo
    (F40 — column-complete: el conjunto materializado == `design.md` §Persistencia).
  - **Verify**: `pnpm --filter @dsm/db migrate && docker compose exec -T postgres psql -U dsm -d dsm -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='products' AND column_name IN ('description_enriched','description_curated','enrichment_source_hash','enrichment_attempts','enrichment_next_attempt_at','enrichment_error_code')" | grep -qx 6 && docker compose exec -T postgres psql -U dsm -d dsm -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='product_embeddings' AND column_name IN ('product_id','embedding','model_version','generated_at')" | grep -qx 4 && docker compose exec -T postgres psql -U dsm -d dsm -tAc "SELECT indexdef FROM pg_indexes WHERE indexname='product_embeddings_embedding_hnsw_idx'" | grep -q "hnsw" && docker compose exec -T postgres psql -U dsm -d dsm -tAc "SELECT indexdef FROM pg_indexes WHERE indexname='product_embeddings_embedding_hnsw_idx'" | grep -q "vector_cosine_ops" && docker compose exec -T postgres psql -U dsm -d dsm -tAc "SELECT indexdef FROM pg_indexes WHERE indexname='products_enrichment_pending_idx'" | grep -q "enrichment_done = false" && docker compose exec -T postgres psql -U dsm -d dsm -tAc "SELECT confdeltype FROM pg_constraint WHERE conrelid='product_embeddings'::regclass AND contype='f'" | grep -qx c`
    *(`confdeltype = 'c'` prueba el `ON DELETE CASCADE`, no sólo la existencia de la FK.)*

- [x] T0.3 Variables de entorno del enriquecimiento validadas por Zod (0,6 h)
  - **Pattern**: agregar al `envSchema` existente con defaults seguros + `superRefine` de
    producción, exactamente como el bloque de `RESEND_API_KEY` — `per backend-node-standards.md §7
    — config validada al arranque, fail-fast`. Un valor inválido **falla el arranque**, nunca cae
    al default en silencio.
    ```ts
    GEMINI_API_KEY: z.string().min(1).optional(),          // requerida en producción (refinement)
    GEMINI_ENRICH_MODEL: z.string().default('gemini-1.5-flash'),
    GEMINI_EMBED_MODEL: z.string().default('text-embedding-004'),
    GEMINI_ENRICH_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
    GEMINI_EMBED_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
    GEMINI_MAX_RPM: z.coerce.number().int().positive().default(15),
    ENRICHMENT_ENABLED: z.enum(['true','false']).default('true'),
    ENRICHMENT_BATCH_SIZE: z.coerce.number().int().positive().max(200).default(25),
    ENRICHMENT_CONCURRENCY: z.coerce.number().int().positive().max(8).default(2),
    ENRICHMENT_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
    ENRICHMENT_LEASE_MS: z.coerce.number().int().positive().default(120_000),
    ENRICHMENT_COOLDOWN_MS: z.coerce.number().int().positive().default(300_000),
    ENRICHMENT_FAILURE_THRESHOLD: z.coerce.number().int().positive().default(5),
    ENRICHMENT_MAX_ENRICHED_CHARS: z.coerce.number().int().positive().default(1_200),
    ENRICHMENT_RATE_LIMIT_TTL_MS: z.coerce.number().int().positive().default(60_000),
    ENRICHMENT_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(6),
    ```
  - **Exit criterion**: las 16 variables están declaradas con esos defaults; con
    `NODE_ENV=production` y sin `GEMINI_API_KEY` el arranque **lanza** con un mensaje que nombra
    la variable y por qué (la feature quedaría deshabilitada en silencio, D6 del `design.md`);
    con `NODE_ENV=development` sin clave **arranca** y el runner queda `disabled`; un
    `ENRICHMENT_CONCURRENCY=0` o `GEMINI_MAX_RPM=abc` **falla** el arranque en vez de caer al
    default. `.env.example` documenta las 16 con su unidad.
  - **Verify**: `pnpm --filter @dsm/api test -- --ci --testPathPattern=env.validation` (casos:
    producción sin `GEMINI_API_KEY` ⇒ throw cuyo mensaje incluye `GEMINI_API_KEY`; development
    sin clave ⇒ parsea OK; `ENRICHMENT_CONCURRENCY='0'` ⇒ throw; `GEMINI_MAX_RPM='abc'` ⇒ throw;
    ausencia total de las 16 ⇒ los 16 defaults exactos) `&& for v in GEMINI_API_KEY GEMINI_ENRICH_MODEL GEMINI_EMBED_MODEL GEMINI_ENRICH_TIMEOUT_MS GEMINI_EMBED_TIMEOUT_MS GEMINI_MAX_RPM ENRICHMENT_ENABLED ENRICHMENT_BATCH_SIZE ENRICHMENT_CONCURRENCY ENRICHMENT_MAX_ATTEMPTS ENRICHMENT_LEASE_MS ENRICHMENT_COOLDOWN_MS ENRICHMENT_FAILURE_THRESHOLD ENRICHMENT_MAX_ENRICHED_CHARS ENRICHMENT_RATE_LIMIT_TTL_MS ENRICHMENT_RATE_LIMIT_MAX; do grep -q "$v" .env.example || { echo "falta $v en .env.example"; exit 1; }; done`

---

## Fase 1: Puertos de IA y adapter Gemini — 2,6 h

- [ ] T1.1 Puertos `AI_ENRICHER` / `AI_EMBEDDER` + errores de dominio `dsm:enrichment/*` (0,4 h)
  - **Pattern**: interfaz + token de inyección (`export const AI_EMBEDDER = Symbol('AI_EMBEDDER')`)
    inyectados con `@Inject(...)` — `per backend-node-standards.md §3 — depender de
    interfaces/tokens, no de clases concretas`. Mismo patrón que el puerto de mailer de US-014.
    Errores como subclases de la `DomainError` existente con `readonly status` + `readonly type`
    — `per backend-node-standards.md §6 — errores de dominio en TS plano, mapeados por el filtro
    RFC 7807`.
  - **Exit criterion**: `AiEnricher.enrich(input): Promise<string>` y
    `AiEmbedder.embed(text): Promise<number[]>` están definidos como interfaz + token, sin
    ningún tipo de Gemini ni de `fetch` en la firma. Existen
    `AiTransientError` (reintentable) y `AiPermanentError` (no reintentable), ambas con
    `type` bajo el namespace `dsm:enrichment/*`, y `AiDisabledError`. El `HttpProblemFilter`
    mapea los tres sin cambios en el filtro (heredan de `DomainError`).
  - **Verify**: `pnpm --filter @dsm/api test -- --ci --testPathPattern='ai-ports|enrichment-errors'`
    (unit: las tres clases heredan de `DomainError`, exponen `type` que empieza con
    `dsm:enrichment/`, y el `HttpProblemFilter` existente las serializa a `application/problem+json`
    con su `status` — sin tocar el filtro)

- [ ] T1.2 `GeminiHttpClient` — REST con la clave en header, timeout por llamada y validación de la respuesta (0,9 h)
  - **Pattern**: `fetch` global de Node 22 + `AbortSignal.timeout(ms)`, clave en **header**:
    ```ts
    const res = await fetch(`${base}/v1beta/models/${model}:embedContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },  // NUNCA ?key=
      body: JSON.stringify({ content: { parts: [{ text }] } }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    ```
    `per backend-node-standards.md §8 — timeout explícito en toda llamada saliente` y
    `per security-standards.md §5 — el secreto no viaja en la URL`. La respuesta se valida antes
    de devolverse — `per security-standards.md §6`.
  - **Exit criterion**: una llamada de embedding devuelve `number[]` de **exactamente 768**
    elementos finitos y con norma > 0; una respuesta con 512 dims, con `NaN`, con vector vacío o
    con JSON inesperado lanza `AiPermanentError` **sin persistir nada**; 429 y 5xx lanzan
    `AiTransientError` que expone `retryAfterSeconds` cuando el header viene; un timeout lanza
    `AiTransientError`. La clave **no aparece** en la URL construida ni en el mensaje de ninguna
    excepción. El enriquecimiento recorta a `ENRICHMENT_MAX_ENRICHED_CHARS` y rechaza respuesta
    vacía. El prompt de enriquecimiento es una constante versionada en el módulo (español AR,
    pide términos de uso y sinónimos de ferretería, prohíbe inventar especificaciones técnicas).
  - **Verify**: `pnpm --filter @dsm/api test -- --ci --testPathPattern=gemini-http` (unit con
    `fetch` mockeado: 768 dims ⇒ OK; 512 dims ⇒ `AiPermanentError`; `[0,0,...]` norma 0 ⇒
    `AiPermanentError`; `{"foo":1}` ⇒ `AiPermanentError`; 429 con `Retry-After: 30` ⇒
    `AiTransientError` con `retryAfterSeconds === 30`; 503 ⇒ `AiTransientError`; `AbortError` ⇒
    `AiTransientError`; **assert de que la URL pasada a `fetch` no contiene `key=` y que
    `headers['x-goog-api-key']` está presente**; assert de que `String(error)` de cada caso no
    contiene el valor de la clave)

- [ ] T1.3 Reintentos con backoff + jitter + `Retry-After` + limitador de RPM (0,8 h)
  - **Pattern**: función pura de backoff + decorador del cliente, sin librería:
    ```ts
    const delay = Math.min(cap, base * 2 ** attempt) * (0.5 + Math.random() / 2); // jitter
    ```
    y un limitador de intervalo mínimo (`60_000 / GEMINI_MAX_RPM`) que serializa las salidas —
    `per backend-node-standards.md §8 — reintentos con backoff y respeto del rate-limit del
    proveedor`. El reloj se **inyecta** para que el test no duerma.
  - **Exit criterion**: un `AiTransientError` se reintenta hasta 3 veces con esperas crecientes y
    jitter dentro de ±50%; si el error trae `retryAfterSeconds`, esa espera **gana** sobre el
    backoff calculado; un `AiPermanentError` **no** se reintenta (1 sola llamada); el limitador
    garantiza que dos llamadas consecutivas no salen a menos de `60_000 / GEMINI_MAX_RPM` ms de
    distancia; con `GEMINI_MAX_RPM=15`, 30 llamadas tardan ≥ 116 s de reloj **simulado** (el test
    usa fake timers, no espera de verdad).
  - **Verify**: `pnpm --filter @dsm/api test -- --ci --testPathPattern='backoff|rate-limiter'`
    (unit con `jest.useFakeTimers()`: transitorio ⇒ 4 invocaciones totales del cliente y esperas
    monótonas; `retryAfterSeconds: 30` ⇒ la espera es 30_000, no el backoff; permanente ⇒ 1
    invocación; 30 llamadas a 15 RPM ⇒ tiempo simulado ≥ 116_000 ms; el test **termina en < 5 s
    de reloj real**, prueba de que no duerme de verdad)

- [ ] T1.4 Proveedor deshabilitado sin clave + fake determinista para tests (0,5 h)
  - **Pattern**: factory por config con el mismo patrón que
    `apps/api/src/auth/mail/password-reset-mailer.provider.ts` (US-014): un `useFactory` que
    elige adapter según `ConfigService` — `per backend-node-standards.md §3`. El fake vive en
    `test/` o junto al spec, **nunca** en el árbol de providers de producción.
  - **Exit criterion**: sin `GEMINI_API_KEY` (o con `ENRICHMENT_ENABLED=false`) el módulo provee
    `DisabledAiProvider`, cuyos métodos lanzan `AiDisabledError`, y **no** se hace ninguna
    llamada de red; con clave provee `GeminiHttpClient`. **No existe** ningún adapter de
    producción que devuelva vectores sintéticos (D6 del `design.md`): el fake determinista
    —vector derivado por hash del texto, estable entre corridas— es test-only y está fuera de
    `src/enrichment/ai/`.
  - **Verify**: `pnpm --filter @dsm/api test -- --ci --testPathPattern=ai.providers` (unit: sin
    clave ⇒ la instancia es `DisabledAiProvider` y `embed()` rechaza con `AiDisabledError` sin
    llamar a `fetch` —`fetch` espiado, 0 invocaciones—; con clave ⇒ `GeminiHttpClient`)
    `&& ! grep -rniE "synthetic|fakevector|deterministicvector|dummyvector" apps/api/src/enrichment/ai/`

---

## Fase 2: Repositorio y persistencia del vector — 1,8 h

- [ ] T2.1 `EnrichmentRepository.claimBatch` — claim atómico por lease (0,5 h)
  - **Pattern**: el `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED ...) RETURNING`
    completo está en `design.md` §Ejecución. Va por `$queryRaw` con parámetros posicionales
    (**nunca** interpolación de strings) — `per backend-node-standards.md §5 — el repositorio es
    el único punto de SQL; parámetros siempre bindeados`.
  - **Exit criterion**: `claimBatch(n)` devuelve hasta `n` productos con `enrichment_done=false`
    y `enrichment_next_attempt_at` vencido o nulo, y en la **misma sentencia** empuja su
    `enrichment_next_attempt_at` a `now() + ENRICHMENT_LEASE_MS`; dos llamadas concurrentes
    devuelven conjuntos **disjuntos** (ninguna fila en las dos); un producto con
    `enrichment_attempts >= ENRICHMENT_MAX_ATTEMPTS` **no** se devuelve (abandonado); un producto
    con `enrichment_done=true` **no** se devuelve; el orden prioriza los nunca intentados.
  - **Verify**: `pnpm --filter @dsm/api test -- --ci --testPathPattern=enrichment.repository`
    (integration, Postgres real: sembrar 10 pendientes + 2 abandonados + 3 hechos ⇒
    `claimBatch(20)` devuelve exactamente los 10 y sus `next_attempt_at` quedan en el futuro; dos
    `claimBatch(5)` disparados con `Promise.all` ⇒ 10 ids únicos en total, **intersección vacía**;
    un segundo `claimBatch` inmediato ⇒ 0 filas, porque todas están arrendadas; avanzar el reloj
    de la base con `next_attempt_at = now() - interval '1 min'` ⇒ vuelven a ser elegibles)

- [ ] T2.2 Escritura del embedding + `model_version` (upsert) (0,4 h)
  - **Pattern**: el `vector` no es tipo de Prisma ⇒ `$executeRaw` con el literal casteado —
    `per E2E §16`:
    ```ts
    await tx.$executeRaw`
      INSERT INTO product_embeddings (product_id, embedding, model_version, generated_at)
      VALUES (${id}::uuid, ${`[${vector.join(',')}]`}::vector, ${model}, now())
      ON CONFLICT (product_id) DO UPDATE
        SET embedding = EXCLUDED.embedding,
            model_version = EXCLUDED.model_version,
            generated_at = now()`;
    ```
  - **Exit criterion**: guardar dos veces el mismo `product_id` **actualiza** la fila (no lanza
    ni duplica) y refresca `model_version` + `generated_at`; el `model_version` persistido es el
    de `GEMINI_EMBED_MODEL` (AC-8); borrar el producto borra su embedding (CASCADE); un vector de
    dimensión ≠ 768 es rechazado por la base **antes** de llegar acá (defensa en profundidad
    sobre la validación de T1.2).
  - **Verify**: `pnpm --filter @dsm/api test -- --ci --testPathPattern=embedding.repository`
    (integration: upsert ×2 ⇒ `count = 1`, `model_version` y `generated_at` actualizados;
    `model_version === 'text-embedding-004'`; `DELETE FROM products WHERE id=...` ⇒
    `product_embeddings` queda en 0 filas; intentar persistir 767 dims ⇒ la promesa rechaza)

- [ ] T2.3 Helper kNN `findNearest` + prueba de que el HNSW se usa (0,6 h)
  - **Pattern**: distancia coseno con el operador de pgvector y `LIMIT`, tipado a mano —
    `per E2E §8 — kNN por $queryRaw con embedding <=> :qvec`:
    ```ts
    const rows = await this.prisma.$queryRaw<{ id: string; slug: string; score: number }[]>`
      SELECT p.id, p.slug, 1 - (e.embedding <=> ${lit}::vector) AS score
      FROM product_embeddings e JOIN products p ON p.id = e.product_id
      WHERE p.status = 'published'
      ORDER BY e.embedding <=> ${lit}::vector
      LIMIT ${limit}`;
  ```
  - **Exit criterion**: `findNearest(vector, limit)` devuelve los vecinos **ordenados por
    similitud descendente**, con `score` en `[0,1]`, e incluye sólo productos `published`
    (un `draft` con embedding no aparece — la restricción que US-004 hereda). El plan de la query
    usa el índice HNSW: con `SET enable_seqscan = off`, `EXPLAIN` muestra
    `Index Scan using product_embeddings_embedding_hnsw_idx` (AC-2, y el `EXPLAIN` que pide el
    ticket `DB-US-005`). **Este helper no expone ningún endpoint** — `/search` es de US-004.
  - **Verify**: `pnpm --filter @dsm/api test -- --ci --testPathPattern=knn` (integration:
    sembrar 3 productos publicados con vectores construidos a mano —uno casi idéntico a la
    consulta, uno intermedio, uno ortogonal— más 1 `draft` con vector idéntico ⇒ el orden
    devuelto es exactamente `[cercano, intermedio, ortogonal]`, el `draft` **no** está, y
    `score` es descendente y acotado a `[0,1]`; y un test que corre
    `SET enable_seqscan = off; EXPLAIN SELECT ... ORDER BY embedding <=> $1 LIMIT 5` y asserta
    que la salida contiene `product_embeddings_embedding_hnsw_idx`)

- [ ] T2.4 Consulta de cobertura del catálogo (0,3 h)
  - **Pattern**: una sola query con agregados condicionales (no cuatro `count`) —
    `per performance-standards.md — una consulta agregada en vez de N round-trips`.
  - **Exit criterion**: `coverage()` devuelve `{ total, enriched, embedded, pending, abandoned, coverage_ratio }`
    en **una** sentencia, donde `enriched = enrichment_done = true`,
    `embedded = productos con fila en product_embeddings`,
    `pending = enrichment_done = false AND enrichment_attempts < max`,
    `abandoned = enrichment_done = false AND enrichment_attempts >= max`, y
    `coverage_ratio = embedded / total` (0 cuando `total = 0`, sin división por cero).
  - **Verify**: `pnpm --filter @dsm/api test -- --ci --testPathPattern=coverage` (integration:
    catálogo de 10 productos con 7 embebidos + 1 abandonado + 2 pendientes ⇒
    `{ total: 10, embedded: 7, abandoned: 1, pending: 2, coverage_ratio: 0.7 }`; catálogo vacío ⇒
    `coverage_ratio === 0` sin excepción)

---

## Fase 3: Caso de uso del enriquecimiento — 2,4 h

- [ ] T3.1 Texto fuente + hash (control de costo de AC-6) (0,4 h)
  - **Pattern**: función **pura** en `source-text.ts` (sin Nest, sin Prisma) + `createHash` de
    `node:crypto`; normalizar antes de hashear (trim + colapso de espacios) para que un cambio
    cosmético no gatille una llamada paga. Orden fijado en `design.md` D3.
  - **Exit criterion**: `buildSourceText({name, categoryName, curated, enriched, raw})` compone
    `name + categoría + texto` eligiendo el texto por prioridad **curado ∥ enriquecido ∥ base**;
    `hashSourceText` es estable entre corridas y **cambia** si cambia cualquiera de los tres
    insumos; un cambio de **precio o stock no puede cambiar el hash** (no son entradas de la
    función — imposible por construcción, no por convención); dos textos que difieren sólo en
    espacios o en el `\r\n` producen el **mismo** hash.
  - **Verify**: `pnpm --filter @dsm/api test -- --ci --testPathPattern=source-text` (unit:
    prioridad de los tres textos; `hash(x) === hash(x)` entre invocaciones; cambiar `name`,
    `categoryName` o el texto ⇒ hash distinto; `"  a  b "` vs `"a b"` ⇒ mismo hash; **assert de
    tipo/firma: la función no recibe `price_ars_cents` ni `stock`**)

- [ ] T3.2 `EnrichmentService.processProduct` — matriz de decisión + transacción por producto (0,8 h)
  - **Pattern**: la matriz de 5 filas de `design.md` §Matriz de decisión. Escritura en una
    transacción corta por producto (`prisma.$transaction`) que actualiza `products` y hace upsert
    del embedding — `per backend-node-standards.md §5 — transacciones cortas, una unidad de
    negocio`. El `UPDATE` enumera columnas explícitas y **`status` no está en la lista** (AC-10).
  - **Exit criterion**: para un producto no curado con texto base cambiado, llama al enricher
    **1** vez y al embedder **1** vez, guarda `description_enriched`, `enrichment_done=true`,
    `enrichment_source_hash` nuevo, `enrichment_attempts=0`, `enrichment_error_code=null` y el
    vector; para un producto **curado**, **no** llama al enricher (AC-7) pero sí al embedder y el
    embedding se calcula sobre el texto **curado**; con hash igual y embedding presente **no
    llama a ninguno de los dos** (AC-6) y marca `enrichment_done=true`; con hash igual y sin
    embedding llama **sólo** al embedder; el `status` del producto es **idéntico** antes y
    después en los cinco casos (AC-10); si el embedder falla, la transacción **no** deja
    `description_enriched` a medias (o ambos o ninguno).
  - **Verify**: `pnpm --filter @dsm/api test -- --ci --testPathPattern=enrichment.service`
    (unit con puertos espiados, los 5 casos de la matriz con conteo exacto de invocaciones;
    caso curado ⇒ el texto pasado al embedder **contiene** el texto curado y el enricher tiene 0
    invocaciones. Integration: producto `draft` procesado ⇒ `status` sigue `'draft'` y
    `enrichment_done=true`; embedder que lanza a mitad ⇒ `description_enriched` sigue en su valor
    previo y no hay fila en `product_embeddings`)

- [ ] T3.3 Fallo persistente: intentos, backoff durable y abandono (AC-5) (0,4 h)
  - **Pattern**: en el `catch` del producto, `UPDATE products SET enrichment_attempts = enrichment_attempts + 1,
    enrichment_next_attempt_at = now() + $backoff, enrichment_error_code = $code` — el estado del
    reintento vive en la base, no en memoria (`design.md` §Ejecución; es la crítica que ADR-0012
    se hace a sí misma y que acá queda cubierta).
  - **Exit criterion**: un fallo transitorio incrementa `enrichment_attempts`, escribe
    `enrichment_error_code` y agenda `enrichment_next_attempt_at` según el backoff durable
    (1 m/5 m/25 m/2 h/10 h); al llegar a `ENRICHMENT_MAX_ATTEMPTS` el producto queda
    **abandonado**: `enrichment_done` sigue `false`, conserva su `description_raw`, **no** tiene
    fila en `product_embeddings`, y `claimBatch` deja de devolverlo; el producto **sigue visible
    en el listado público por categoría** (US-002) — o sea, degradó sin desaparecer.
  - **Verify**: `pnpm --filter @dsm/api test -- --ci --testPathPattern='enrichment-failure'`
    (integration: forzar 5 fallos transitorios sobre un producto publicado ⇒ `attempts === 5`,
    `error_code` no nulo, 0 filas en `product_embeddings`, `description_raw` intacta,
    `claimBatch` devuelve 0; y `GET /v1/categories/{slug}/products` **sí** lo devuelve —el
    endpoint público de US-002— probando que degradó sin desaparecer)

- [ ] T3.4 `EnrichmentRunner` — lotes, concurrencia, cooldown y no bloquear el event loop (0,6 h)
  - **Pattern**: bucle `while` de lotes con `await` entre lotes y `Promise.all` de a
    `ENRICHMENT_CONCURRENCY` dentro del lote; disparo con `setImmediate`; contador de fallos
    consecutivos del proveedor que activa `cooldown` — `per backend-node-standards.md §8 — nunca
    bloquear el event loop; offload de trabajo pesado`. Un solo run concurrente, con guarda
    in-process (el claim por lease ya cubre el caso multi-réplica).
  - **Exit criterion**: `start()` procesa todos los pendientes en lotes de
    `ENRICHMENT_BATCH_SIZE` y termina con estado `idle`; un segundo `start()` mientras corre
    devuelve "ya corriendo" **sin** arrancar un segundo bucle; tras
    `ENRICHMENT_FAILURE_THRESHOLD` fallos **consecutivos** del proveedor el runner pasa a
    `cooldown` y **deja de llamar** a Gemini hasta que pasa `ENRICHMENT_COOLDOWN_MS` (AC-4); con
    `ENRICHMENT_ENABLED=false` o proveedor deshabilitado el estado es `disabled` y no se procesa
    nada; **el event loop no se bloquea**: un `GET /v1/health` responde en < 1 s mientras se
    procesan 200 productos.
  - **Verify**: `pnpm --filter @dsm/api test -- --ci --testPathPattern=enrichment.runner`
    (integration con el fake: 60 pendientes y batch 25 ⇒ 3 lotes, los 60 quedan
    `enrichment_done=true`, estado final `idle`; dos `start()` en paralelo ⇒ el segundo devuelve
    `already-running` y el conteo de invocaciones del embedder es 60, **no 120**; proveedor que
    falla 5 veces seguidas ⇒ estado `cooldown` y 0 llamadas nuevas al proveedor durante el
    cooldown, con fake timers; `ENRICHMENT_ENABLED=false` ⇒ estado `disabled` y 0 productos
    tocados; y durante una corrida de 200 productos, un `GET /v1/health` responde < 1 s)

- [ ] T3.5 Adapter real de `EnrichmentQueue` (nudge) reemplazando el no-op de US-006 (0,2 h)
  - **Pattern**: implementar el puerto que US-006 T4.4 definió; `enqueue(ids)` **no** guarda una
    cola: registra el conteo y empuja el runner con `setImmediate`. La cola es
    `WHERE enrichment_done = false` (US-006 `design.md` §306-309), así que un nudge perdido no
    pierde trabajo.
  - **Exit criterion**: `ImportRunner` sigue dependiendo del **puerto** (su import cambia de
    ruta si hacía falta, su código no); tras un import, el runner arranca sin intervención
    manual; un fallo del adapter **no** cambia el estado del trabajo de import ni propaga
    excepción (misma garantía que el no-op daba); si el runner está `disabled`, `enqueue` es un
    no-op silencioso con evento, no una excepción. El README de `imports` ya no dice
    `Deferred: adapter BullMQ — US-005`, y en su lugar apunta a ADR-0014.
  - **Verify**: `pnpm --filter @dsm/api test -- --ci --testPathPattern='enrichment-queue|import-runner'`
    (unit: `enqueue([a,b,c])` ⇒ el runner recibe **1** kick, no 3; un runner que lanza en el kick
    ⇒ `enqueue` resuelve y el job de import queda `completed`. Integration: import de 3 filas
    nuevas ⇒ tras el flush del `setImmediate`, los 3 productos tienen `enrichment_done=true` con
    el fake) `&& ! grep -rn "Deferred: adapter BullMQ" apps/api/src`

---

## Fase 4: Borde HTTP admin — 1,6 h

- [ ] T4.1 `GET /v1/admin/enrichment/status` — cobertura observable (AC-3) (0,4 h)
  - **Pattern**: controller con `@UseGuards(AdminGuard)` + DTO de respuesta con `static from()`
    (patrón de `ProductResponseDto`), `snake_case` en el payload —
    `per api-standards.md §5 — formato de respuesta`. `Cache-Control: no-store` ya lo pone el
    middleware de `bootstrap.ts` para todo `/v1/admin`.
  - **Exit criterion**: devuelve 200 con
    `{ runner_state, coverage: { total, enriched, embedded, pending, abandoned, coverage_ratio },
    models: { enrich, embed }, last_error_code, last_run_at }`; `runner_state` es uno de
    `idle|running|cooldown|disabled`; sin token ⇒ **401**; con token de cliente ⇒ **403**; la
    respuesta lleva `Cache-Control: no-store`; **no** incluye la clave del proveedor ni ningún
    dato de comprador.
  - **Verify**: `pnpm --filter @dsm/api test -- --ci --testPathPattern=e2e-enrichment-status`
    (e2e-nest: 200 con las 6 métricas de cobertura y el `runner_state` esperado tras sembrar un
    catálogo conocido; sin `Authorization` ⇒ 401; `customerToken()` ⇒ 403; header
    `cache-control` contiene `no-store`; assert de que el body serializado **no** contiene el
    valor de `GEMINI_API_KEY`)

- [ ] T4.2 `POST /v1/admin/enrichment/runs` — 202 / 409 + throttler `enrichment` (0,5 h)
  - **Pattern**: 202 + un solo run concurrente ⇒ 409 (misma semántica que el import de US-006),
    `per api-standards.md §10 — operación asíncrona: 202 y estado consultable`. Throttler
    nombrado `enrichment` extendiendo `ThrottlerGuard` como
    `StorefrontThrottlerGuard`/`AuthThrottlerGuard`, con `@SkipThrottle` de los otros —
    `per security-standards.md §7.3 — rate-limit de la superficie que gasta dinero`.
  - **Exit criterion**: `POST` con el runner libre ⇒ **202** con `{ run_id, accepted }` y el run
    arranca; con un run en curso ⇒ **409** `dsm:enrichment/run-in-progress` y **no** se arranca
    un segundo; `{ "force": true }` re-habilita los abandonados (pone
    `enrichment_attempts = 0` y `next_attempt_at = null` en los que tenían `attempts >= max`) y
    los procesa; `{ "product_ids": [...] }` acota a esos productos; un campo desconocido en el
    body ⇒ **422** (whitelist del `ValidationPipe`); superado `ENRICHMENT_RATE_LIMIT_MAX` ⇒
    **429** con `Retry-After` y `RateLimit-*`; sin token ⇒ 401.
  - **Verify**: `pnpm --filter @dsm/api test -- --ci --testPathPattern=e2e-enrichment-runs`
    (e2e-nest: 202 y el producto pendiente queda enriquecido; segundo POST inmediato ⇒ 409 con
    ese `type` y el conteo de invocaciones del embedder no se duplica; producto abandonado +
    `force: true` ⇒ vuelve a procesarse y queda `enrichment_done=true`; body `{"foo":1}` ⇒ 422;
    `ENRICHMENT_RATE_LIMIT_MAX=2` y 3 POST ⇒ el tercero es 429 con `Retry-After` presente;
    sin token ⇒ 401)

- [ ] T4.3 `PATCH /v1/admin/products/{id}` acepta `description_enriched` → curada + re-embed (AC-7) (0,5 h)
  - **Pattern**: agregar el campo al `UpdateProductDto` existente (`@IsOptional() @IsString()`)
    y, en el service de productos, escribir `description_curated = true` +
    `enrichment_done = false` + `enrichment_source_hash = null` en la **misma** actualización —
    `per backend-node-standards.md §4 — DTO como único contrato de entrada`. No se agrega
    endpoint: se extiende el que ya existe.
  - **Exit criterion**: enviar `description_enriched` guarda el texto, marca
    `description_curated = true` y deja el producto elegible para **re-embeddear**
    (`enrichment_done = false`); la corrida siguiente **no llama al LLM** para ese producto y el
    embedding se regenera sobre el texto curado (AC-7); enviar otros campos (nombre, precio,
    stock) **no** toca `description_curated` ni gatilla re-embed; una vez curado, un cambio de
    `description_raw` **no** pisa el texto curado (sí re-embeddea, porque el texto fuente
    cambió); el campo respeta el mismo `AdminGuard` y la misma respuesta que el resto del PATCH.
  - **Verify**: `pnpm --filter @dsm/api test -- --ci --testPathPattern='e2e-products-update|curated'`
    (e2e-nest + integration: PATCH con `description_enriched` ⇒ 200, `description_curated=true`,
    `enrichment_done=false`; corrida siguiente ⇒ enricher con **0** invocaciones, embedder con 1,
    y el texto embebido **contiene** el texto curado; PATCH sólo de `price_ars_cents` ⇒
    `description_curated` y `enrichment_done` sin cambios; PATCH de `description_raw` sobre un
    producto curado ⇒ `description_enriched` **idéntica** tras la corrida)

- [ ] T4.4 Cableado del módulo (0,2 h)
  - **Pattern**: `EnrichmentModule` importado en `AppModule` con `ThrottlerModule` del throttler
    nombrado, siguiendo el orden y el estilo de los módulos existentes.
  - **Exit criterion**: la app **arranca** con el módulo cableado (y arranca igual sin
    `GEMINI_API_KEY` en desarrollo, con el runner `disabled`); las rutas
    `/v1/admin/enrichment/status` y `/v1/admin/enrichment/runs` están registradas; los throttlers
    existentes (`auth`, `storefront`) **no** cambian de presupuesto — sin regresión en sus specs.
  - **Verify**: `pnpm --filter @dsm/api test -- --ci --testPathPattern='e2e-health|e2e-throttler-independence'`
    (la app bootea con el módulo nuevo y las suites de independencia de throttler siguen verdes)
    `&& pnpm --filter @dsm/api build`

---

## Fase 5: Observabilidad — 0,6 h

- [ ] T5.1 `EnrichmentEventsService` — 9 eventos sin secretos ni contenido completo (0,4 h)
  - **Pattern**: espejo exacto de `apps/api/src/observability/catalog-events.service.ts`
    (log pino estructurado + `Map` de contadores como stand-in de métrica) —
    `per observability-standards.md §9 — cardinalidad acotada, sin secretos ni PII`.
  - **Exit criterion**: los 9 eventos de `design.md` §Observabilidad se emiten en sus puntos
    (`run_started`, `product_enriched`, `embedding_generated`, `skipped_unchanged`,
    `skipped_curated`, `retried`, `abandoned`, `provider_unavailable`, `run_finished`); los
    contadores son **por nombre de evento**, no por producto (cardinalidad acotada); el payload
    de `product_enriched` lleva **longitudes** de prompt y respuesta, nunca los textos completos;
    ningún evento incluye la clave, la URL del proveedor ni un `Authorization`.
  - **Verify**: `pnpm --filter @dsm/api test -- --ci --testPathPattern='enrichment-events'`
    (unit: los 9 nombres emitidos y contados; `count('product.enriched')` no crece con el número
    de productos distintos en el `Map` de contadores —una sola clave—; el payload contiene
    `prompt_chars`/`response_chars` y **no** contiene el texto; integration: una corrida de 3
    productos ⇒ `run_started` 1, `product_enriched` 3, `run_finished` 1)

- [ ] T5.2 Prueba de no-fuga de la clave del proveedor (AC-9) (0,2 h)
  - **Pattern**: capturar el logger (spy sobre el transporte pino / `Logger`) durante una corrida
    con fallo del proveedor y asertar sobre **todo** lo emitido — la variante negativa que
    `security-standards.md §5` pide poder demostrar.
  - **Exit criterion**: en una corrida donde el proveedor devuelve 401 y luego 500, **ninguna**
    línea de log, ningún mensaje de excepción y ningún body de respuesta HTTP contienen el valor
    de `GEMINI_API_KEY`; tampoco aparece la URL con `key=`; el log del fallo **sí** trae status y
    código de error (o el diagnóstico sería inútil).
  - **Verify**: `pnpm --filter @dsm/api test -- --ci --testPathPattern='enrichment-secrets'`
    (integration: `GEMINI_API_KEY='super-secret-canary-value'`, proveedor mockeado que devuelve
    401 y 500 ⇒ el agregado de todo lo logueado + `String(error)` + el body del `/status`
    **no** contiene `super-secret-canary-value` ni `key=`, y **sí** contiene `401`)
    `&& ! grep -rn "key=\${" apps/api/src/enrichment/`

---

## Fase 6: Cobertura e2e de los AC — 1,4 h

- [ ] T6.1 e2e del ciclo completo (AC-1, AC-2, AC-8, AC-10) (0,4 h)
  - **Pattern**: `bootTestApp([...])` de `apps/api/test/e2e-app.ts` con el fake determinista
    inyectado por `overrideProvider` del token del puerto; `truncateCatalog` para
    determinismo — `per testing-standards.md §14 — AAA y dobles de prueba`.
  - **Exit criterion**: partiendo de 3 productos con descripción pobre (1 en `draft`), una
    corrida deja los 3 con `description_enriched` no vacía, `enrichment_done=true`, fila en
    `product_embeddings` con 768 dims y `model_version` seteado (AC-1, AC-8); el `draft` sigue
    `draft` (AC-10); una consulta kNN con el vector del texto de uno de ellos lo devuelve
    **primero** entre los publicados (AC-2).
  - **Verify**: `pnpm --filter @dsm/api test -- --ci --testPathPattern=e2e-enrichment-cycle`

- [ ] T6.2 e2e de idempotencia y de descripción curada (AC-6, AC-7) (0,4 h)
  - **Exit criterion**: segunda corrida sobre un catálogo ya enriquecido y sin cambios ⇒
    **0** llamadas al enricher y **0** al embedder (AC-6); cambiar sólo el `stock` o el
    `price_ars_cents` por el PATCH admin y correr ⇒ sigue **0** llamadas; cambiar
    `description_raw` ⇒ 1 llamada a cada uno; curar la descripción y correr ⇒ **0** al enricher,
    1 al embedder, y el texto enriquecido **no cambia** (AC-7).
  - **Verify**: `pnpm --filter @dsm/api test -- --ci --testPathPattern=e2e-enrichment-idempotency`

- [ ] T6.3 e2e de resiliencia (AC-4, AC-5) (0,3 h)
  - **Exit criterion**: proveedor que devuelve 429 con `Retry-After` y luego éxito ⇒ el producto
    termina enriquecido y el evento `retried` se emitió (AC-4); proveedor que falla siempre ⇒
    tras `ENRICHMENT_MAX_ATTEMPTS` el producto queda abandonado con `error_code`, sin embedding y
    con su `description_raw` intacta, y el `/status` lo reporta en `abandoned` (AC-5).
  - **Verify**: `pnpm --filter @dsm/api test -- --ci --testPathPattern=e2e-enrichment-resilience`

- [ ] T6.4 e2e de cobertura ≥ 90% con fallo inyectado (AC-3) (0,3 h)
  - **Exit criterion**: con 100 productos y un fake que falla de forma determinista en el 5%,
    una corrida (más los reintentos que correspondan) deja `coverage_ratio >= 0.9` según
    `GET /status`, y el número reportado **coincide** con el conteo real de filas en
    `product_embeddings`. Queda escrito en el spec que el ≥ 90% de producción es un resultado de
    corrida sobre catálogo real, no una propiedad del código.
  - **Verify**: `pnpm --filter @dsm/api test -- --ci --testPathPattern=e2e-enrichment-coverage`
    (el assert compara `coverage.embedded` del endpoint con
    `prisma.$queryRaw('SELECT count(*) FROM product_embeddings')` y exige
    `coverage_ratio >= 0.9`)

---

## Fase 7: Contratos y documentación — 0,7 h

- [ ] T7.1 Dos contratos OpenAPI draft (1 por endpoint) + lint (0,4 h)
  - **Pattern**: un archivo por endpoint bajo
    `openspec/changes/US-005-enriquecimiento-ia-embeddings-backend/contracts/openapi/`, igual que
    US-002/US-006/US-007; errores como `application/problem+json` —
    `per api-standards.md §8` y skill `api-contract-completeness`.
  - **Exit criterion**: existen `admin-enrichment-status.yaml` y `admin-enrichment-runs.yaml`
    con `operationId`, security admin, ejemplo de respuesta y **todos** los códigos que el
    controller puede devolver (status: 200/401/403; runs: 202/409/422/429/401), cada error con
    `type` `dsm:enrichment/*`. Spectral pasa con 0 errores.
  - **Verify**: `npx @stoplight/spectral-cli lint openspec/changes/US-005-enriquecimiento-ia-embeddings-backend/contracts/openapi/*.yaml && python3 -c "import yaml; d=yaml.safe_load(open('openspec/changes/US-005-enriquecimiento-ia-embeddings-backend/contracts/openapi/admin-enrichment-runs.yaml')); ops=[m for p in d['paths'].values() for m in p.values()]; rs=set(); [rs.update(o['responses'].keys()) for o in ops]; assert {'202','409','422','429','401'} <= {str(r) for r in rs}, rs"`

- [ ] T7.2 Spec publicado + README + runbook (0,3 h)
  - **Pattern**: sumar los dos paths a `apps/api/docs/api/openapi.yaml` (base `/v1`, sin
    prefijo duplicado) con su `tag` nuevo `admin-enrichment`; documentar las variables en
    `apps/api/README.md`; agregar las filas de operación al runbook —
    `per documentation-standards.md §11.1`.
  - **Exit criterion**: el spec publicado tiene `/admin/enrichment/status` y
    `/admin/enrichment/runs` (y **no** `/v1/admin/enrichment/...`, porque el server ya es `/v1`);
    el README documenta las 16 variables nuevas, el estado `disabled` sin clave y el hecho de que
    producción no arranca sin ella; el runbook de `docs/services/dsm-ecommerce/runbook.md` tiene
    qué hacer ante "Gemini caído / rate-limited" con el `/status` como diagnóstico y
    `ENRICHMENT_ENABLED=false` como corte manual, y menciona la ventana de ~5,5 h de la primera
    corrida.
  - **Verify**: `npx @stoplight/spectral-cli lint apps/api/docs/api/openapi.yaml && grep -q '^  /admin/enrichment/status:' apps/api/docs/api/openapi.yaml && grep -q '^  /admin/enrichment/runs:' apps/api/docs/api/openapi.yaml && ! grep -q '/v1/admin/enrichment' apps/api/docs/api/openapi.yaml && grep -q 'GEMINI_API_KEY' apps/api/README.md && grep -q 'ENRICHMENT_ENABLED' apps/api/README.md && grep -qi 'disabled' apps/api/README.md && grep -qi 'enriquecimiento' docs/services/dsm-ecommerce/runbook.md && grep -q 'ENRICHMENT_ENABLED' docs/services/dsm-ecommerce/runbook.md`

---

## Verification (suite-level)

- [ ] Unit + integration colocados pasan: `pnpm --filter @dsm/api test -- --ci`
- [ ] Suite e2e-nest dedicada pasa: `pnpm --filter @dsm/api test:e2e`
- [ ] Lint + typecheck limpios: `pnpm --filter @dsm/api lint && pnpm --filter @dsm/api typecheck`
- [ ] **Esquema materializado == `design.md` §Persistencia (F40)**: el `Verify` de T0.2 corrido de
      nuevo sobre una base recreada desde cero:
      `docker compose down -v && docker compose up -d postgres && sleep 8 && pnpm --filter @dsm/db migrate && pnpm --filter @dsm/db seed` y luego el bloque de asserts de T0.2 completo.
- [ ] Contratos válidos:
      `npx @stoplight/spectral-cli lint openspec/changes/US-005-enriquecimiento-ia-embeddings-backend/contracts/openapi/*.yaml apps/api/docs/api/openapi.yaml`
- [ ] **No regresión del catálogo existente (US-001/002/003/014)**:
      `pnpm --filter @dsm/api test -- --ci --testPathPattern='products|categories|storefront|auth'`
- [ ] **El enriquecimiento nunca publica (AC-10, invariante global)**: probado en runtime por
      `pnpm --filter @dsm/api test -- --ci --testPathPattern='enrichment.service|e2e-enrichment-cycle'`
      (un producto en `draft` sigue `draft` tras la corrida), y como red estática
      `! git grep -nE "status[[:space:]]*[:=][[:space:]]*['\"](published|archived|draft)['\"]" -- apps/api/src/enrichment`
- [ ] **Ningún secreto en el árbol ni en los logs (AC-9)**:
      `git grep -nE "AIza[0-9A-Za-z_-]{20,}" -- . ':(exclude).env.example' ':(exclude)*.md'` no devuelve nada, y la suite de T5.2 pasa.
- [ ] **Sin dependencias nuevas**: `git diff --stat -- pnpm-lock.yaml` vacío (el adapter usa el
      `fetch` de Node 22; si alguna task agregó un paquete, es una desviación del `design.md`
      §Trade-offs y hay que declararla).
- [ ] CI del monorepo verde: `pnpm -r lint && pnpm -r typecheck && pnpm -r test`
- [ ] **Re-seed tras los tests** (las suites hacen `TRUNCATE`): `pnpm --filter @dsm/db seed`

---

## Trazabilidad AC → tasks

| AC | Tasks |
|---|---|
| AC-1 enriquecer + generar embedding | T0.2, T1.2, T2.2, T3.2, T6.1 |
| AC-2 elegible para la búsqueda semántica | T0.2 (HNSW), T2.3, T6.1 |
| AC-3 cobertura ≥ 90% medible | T2.4, T4.1, T6.4 |
| AC-4 reintento ante fallo transitorio | T1.3, T3.4, T6.3 |
| AC-5 fallo persistente degrada con gracia | T3.3, T4.2 (`force`), T6.3 |
| AC-6 re-enriquecer sólo si cambió la base | T0.2 (`enrichment_source_hash`), T3.1, T3.2, T6.2 |
| AC-7 no sobreescribir la descripción curada | T0.2 (`description_curated`), T3.2, T4.3, T6.2 |
| AC-8 versionado de embeddings | T0.2, T2.2, T6.1 |
| AC-9 sin secretos ni datos sensibles en logs | T1.2, T5.1, T5.2 |
| AC-10 el enriquecimiento no publica | T3.2, T6.1, gate suite-level |

### Declaraciones de `design.md` que **no** son AC (F51)

| Declaración | Task que la cubre |
|---|---|
| ADR-0014 + entrada en `decisions.yaml` | T0.1 |
| Índice parcial de pendientes | T0.2 |
| 16 variables de entorno + refinement de producción | T0.3 |
| Puertos + taxonomía de errores `dsm:enrichment/*` | T1.1 |
| Clave en header (nunca en URL) | T1.2, T5.2 |
| Tope de RPM del proveedor | T1.3 |
| Proveedor deshabilitado sin clave (D6) | T1.4, T4.4 |
| Claim por lease sin tabla de jobs ni reaper | T2.1 |
| Helper kNN + `EXPLAIN` del HNSW (ticket `DB-US-005`) | T2.3 |
| Cooldown tras fallos consecutivos | T3.4 |
| Puerto `EnrichmentQueue` real (nudge) + limpieza del `Deferred` de US-006 | T3.5 |
| Throttler `enrichment` + 409 de run único | T4.2 |
| Costura de curación en el PATCH admin (D8) | T4.3 |
| 9 eventos de observabilidad + costo aproximado | T5.1 |
| Contratos por endpoint + spec publicado + runbook | T7.1, T7.2 |
| **Diferidas** (no se construyen acá) | UI de curación (`Deferred: FE — owner: PO`) · migración a BullMQ (`Deferred: US-019 — owner: Arquitecto`) · re-embed masivo por cambio de modelo (`Deferred: US futura — owner: Arquitecto`) · exponer el texto enriquecido en el storefront (OQ-BE-3) |
