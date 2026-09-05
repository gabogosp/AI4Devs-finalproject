---
tracker-id: null
tracker-source: null
parent-us: US-005
discipline: backend
variant: null
language: es
archived: true
archived_at: 2026-09-05
merged_commit: 9a9fc53
pr-url: https://github.com/gabogosp/AI4Devs-finalproject/pull/3
---

# US-005 Backend — Enriquecimiento IA de descripciones + embeddings (ejecutor in-process, contrato de cobertura observable)

## Why

El diferenciador del producto es la búsqueda en lenguaje natural (PRD §2.1 capacidad 2), y
hoy **no hay un solo vector en la base**. La extensión `pgvector` está instalada desde el
bootstrap (migración `20260715000000_enable_pgvector`), pero `product_embeddings` no existe,
`products.description_enriched` tampoco, y el catálogo real llega —por definición del
negocio— con descripciones pobres que un modelo de embeddings no puede aterrizar contra una
consulta como *"algo para colgar un cuadro en pared dura"*.

Esta US es el eslabón que falta entre el catálogo y el buscador: **US-006 marca**
(`enrichment_done = false`), **US-005 enriquece y embebe**, **US-004 busca**. Sin ella US-004
no tiene sobre qué hacer kNN y el fallback a full-text se vuelve el camino único — es decir,
el producto pierde exactamente lo que lo diferencia. ADR-0003 ya fijó el proveedor y los
modelos (`gemini-1.5-flash` para enriquecer, `text-embedding-004` de 768 dimensiones para
embeddear), así que acá no se elige proveedor: se construye el pipeline.

Lo que sí hubo que decidir es **quién ejecuta el trabajo**. ADR-0004 lo asignó a un worker
BullMQ, y ADR-0012 —que ya tuvo que desviarse por lo mismo en el import— dejó escrito que el
enriquecimiento IA esperaría *"once the queue exists"*. Esa cola no existe: `REDIS_URL` no
está aprovisionado (US-019 T1.3 sigue abierta, depende de cuentas externas sin fecha) y
`apps/worker/` es un README de una línea. Esperar significa bloquear el diferenciador detrás
de una dependencia sin fecha. **ADR-0014** (este change, T0.1) resuelve extender el patrón de
ADR-0012 al enriquecimiento: contrato asíncrono y estado durable en Postgres desde el día uno,
ejecutor in-process por ahora, con el mismo criterio de migración a BullMQ. El argumento que
lo hace defendible acá y no en cualquier caso: este trabajo es **I/O-bound** (espera a Gemini),
no CPU-bound como el parseo de un CSV, así que el costo que ADR-0012 declara como negativo
—competir con el request path— es sustancialmente menor.

## What changes

**Modelo de datos** — aditivo; ninguna columna ni tabla existente cambia de tipo ni se borra:

- `products` gana **6 columnas**: `description_enriched` (la del DER §8),
  `description_curated` (AC-7 — el dueño curó el texto y la IA no lo pisa),
  `enrichment_source_hash` (AC-6 — control de costo: re-enriquecer sólo si cambió el texto
  fuente), `enrichment_attempts` + `enrichment_next_attempt_at` (AC-4/AC-5 — backoff que
  sobrevive a un reinicio) y `enrichment_error_code` (AC-5 — el fallo queda registrado).
  Cinco de las seis son **desviación del DER**, declaradas en `design.md` §Persistencia.
- `product_embeddings` — la tabla 1:1 del DER: `product_id` PK/FK (`ON DELETE CASCADE`),
  `embedding vector(768)`, `model_version`, `generated_at`. Con **índice HNSW**
  (`vector_cosine_ops`, `m=16`, `ef_construction=64`) que es el que US-004 va a usar.
- Índice parcial `products (enrichment_next_attempt_at) WHERE enrichment_done = false` — la
  cola de pendientes es una query, no una estructura en memoria.

**Pipeline de enriquecimiento** (módulo nuevo `src/enrichment/`):

| Pieza | Qué hace |
|---|---|
| Puertos `AI_ENRICHER` / `AI_EMBEDDER` | Interfaz + token de inyección. El dominio no conoce Gemini. |
| `GeminiHttpClient` | REST directo con `fetch` + `x-goog-api-key` **en header, nunca en la URL** (AC-9), timeout por llamada, validación de que el vector tiene exactamente 768 dimensiones. |
| Reintentos + limitador | Backoff exponencial con jitter, respeto de `Retry-After`, tope de RPM del proveedor (AC-4). |
| `EnrichmentRepository` | Claim por **lease** (`FOR UPDATE SKIP LOCKED` + `next_attempt_at` futuro): dos runs concurrentes no procesan el mismo producto y un run que muere libera solo al vencer el lease — sin tabla de jobs ni reaper aparte. |
| `EnrichmentService` | Matriz de decisión por producto: enriquecer+embeddear / sólo embeddear (curado o texto igual pero embedding faltante) / saltar (AC-6, AC-7), transacción por producto, **nunca** toca `status` (AC-10). |
| `EnrichmentRunner` | Lotes con `await` entre ítems (no bloquea el event loop), concurrencia acotada, cooldown tras N fallos consecutivos del proveedor (AC-4, AC-5). |
| Adapter real de `EnrichmentQueue` | Reemplaza el no-op de US-006 T4.4: al terminar un import, empuja el runner. La cola sigue siendo `WHERE enrichment_done = false`, así que un "encolado" perdido no pierde trabajo. |

**Superficie HTTP** — dos endpoints admin, autenticados y con throttler propio:

| Endpoint | Qué hace | AC |
|---|---|---|
| `GET /v1/admin/enrichment/status` | Cobertura del catálogo (enriquecidos / embebidos / pendientes / abandonados), estado del runner (`idle\|running\|cooldown\|disabled`), versiones de modelo en uso y último código de error. | AC-3 |
| `POST /v1/admin/enrichment/runs` | 202 y dispara el run; 409 si ya hay uno corriendo. Con `force` re-habilita los abandonados (AC-5 «reintentar luego»). | AC-4, AC-5 |

Además, `PATCH /v1/admin/products/{id}` acepta ahora `description_enriched`: escribirla marca
`description_curated = true` y **fuerza la regeneración del embedding sobre el texto curado**,
sin volver a llamar al LLM (AC-7).

**Observabilidad**: `EnrichmentEventsService` con 9 eventos de negocio
(`enrichment.run_started`, `.product_enriched`, `.embedding_generated`, `.skipped_unchanged`,
`.skipped_curated`, `.retried`, `.abandoned`, `.provider_unavailable`, `.run_finished`) más
un estimador de costo aproximado — insumo de la cobertura del PRD §1.4 y de la salud vigilada
del E2E §18.5. Ningún evento lleva la clave, la URL con query string ni el prompt completo.

**Degradación honesta**: sin `GEMINI_API_KEY` el runner arranca `disabled` y lo **dice** en
`/status`. No existe un adapter "dev" que devuelva vectores falsos: un embedding inventado
contamina el índice y rompe la relevancia de forma invisible, que es peor que no tener
embedding (el producto sigue navegable por categoría — red de seguridad del PRD §3.2 y AC-5).
En producción el arranque **falla** si falta la clave, igual que ya hace `RESEND_API_KEY`.

## ACs de US-005 cubiertos (capa backend)

| AC | Cubierto | Nota |
|---|---|---|
| AC-1 enriquecer + embeddear | ✅ | `description_enriched` auto-aplicada, vector de 768 dims persistido, `enrichment_done=true` + `model_version` |
| AC-2 elegible para la búsqueda | ✅ (dato) | helper kNN + HNSW verificados acá; el endpoint `/search` es de US-004 |
| AC-3 cobertura ≥ 90% medible | ✅ | consulta de cobertura + `GET /status`; el 90% es un resultado de corrida, ejercido en T6.4 con fallo inyectado |
| AC-4 reintento ante fallo transitorio | ✅ | backoff + jitter + `Retry-After` + tope de RPM + cooldown |
| AC-5 fallo persistente degrada | ✅ | tras `ENRICHMENT_MAX_ATTEMPTS` queda abandonado con `error_code`; conserva la descripción base, sin embedding, visible en browse |
| AC-6 re-enriquecer sólo si cambió | ✅ | `enrichment_source_hash`; un cambio de precio o stock no gatilla ninguna llamada |
| AC-7 no pisar la descripción curada | ✅ (API) | `description_curated` + re-embed sobre el texto curado. La **UI** de curación es FE |
| AC-8 versionado de embeddings | ✅ | `model_version` por fila; cambiar de modelo no invalida en silencio (queda trazado y re-embeddeable) |
| AC-9 sin secretos en logs | ✅ | clave en header, redacción en el adapter, test que falla si la clave aparece en un log |
| AC-10 el enriquecimiento no publica | ✅ | el `UPDATE` no incluye `status`; invariante probada con un producto en `draft` |

## Out of scope

- **La búsqueda semántica** (`/search`, umbral, fallback, degradación a full-text) — **US-004**.
  Acá se deja el dato y el helper kNN probado, no el endpoint.
- **El import y el encolado** — US-006. Este change **consume** su marca y **reemplaza** su
  adapter no-op; no toca el parseo ni los endpoints de import.
- **La UI de curación de la descripción enriquecida** (el campo en el panel del dueño) — es
  trabajo FE sobre una superficie que US-001 nunca construyó.
  `Deferred: FE del panel — owner: PO`.
- **Migración del ejecutor a BullMQ + worker desplegado** — ADR-0014 fija el criterio; la
  ejecución depende de US-019 T1.3 (`REDIS_URL`).
  `Deferred: US-019 / operaciones — owner: Arquitecto`.
- **Re-embeddear el catálogo ante un cambio de modelo** (`model_version` lo hace posible y
  trazable, pero no hay endpoint de migración masiva). `Deferred: US futura — owner: Arquitecto`.
- **Enriquecimiento de categorías o de imágenes** — ningún AC lo pide.
- **Batería de relevancia ≥ 70%** — se mide sobre `/search`, o sea en US-004 / `/plan-qa`.
- **Tests de carga (k6) y E2E cross-service (Playwright)** — de `/plan-qa`, no dev-owned
  (`qa-backend-standards.md` §2.1).

## Standards consultados

| Standard | Secciones aplicadas |
|---|---|
| `base-standards.md` | §1 KISS/YAGNI (sin tabla de jobs, sin librería de circuit-breaker, sin SDK) |
| `backend-standards.md` | capas controller→service→repository, errores explícitos, validación en el borde |
| `backend-node-standards.md` | §2 capas · §3 DI por token (puertos de IA) · §4 DTO + ValidationPipe whitelist · §5 Prisma + `Unsupported()` + `$queryRaw` para `vector` · §6 errores de dominio + filtro RFC 7807 · §7 config validada fail-fast · §8 timeouts/retries/no bloquear el event loop · §9 logs pino estructurados |
| `api-standards.md` | §2 URLs · §5 formato de respuesta (snake_case) · §8 errores RFC 7807 · §10 idempotencia (202 + 409 de un solo run) · §12 headers de rate-limit |
| `security-standards.md` | §2 STRIDE (frontera nueva: proveedor de IA) · §3/§4 admin-only · §5 secretos (clave en header, nunca en URL ni log) · §6 validación de la respuesta del proveedor · §7.1 `no-store` · §7.3 rate-limit de la superficie que gasta plata |
| `observability-standards.md` | §9 sin secretos ni PII; cardinalidad acotada de contadores |
| `performance-standards.md` | presupuestos: el runner no degrada el p95 de lectura del storefront (E2E §17) |
| `testing-standards.md` / `qa-backend-standards.md` | §14 pirámide, AAA, dobles de prueba (fake determinista de IA); suites dev-owned vs QA |
| `documentation-standards.md` | §8 disparadores de ADR · §11.1 README del servicio + OpenAPI publicado + runbook |
| `data-standards.md` | modelado 1:1, migración aditiva, índices declarados con su justificación |

## Preguntas abiertas

**Ninguna bloquea el arranque**: las cinco tienen default implementado. El fundamento de cada
una vive en `design.md` §Decisiones y §Preguntas abiertas.

| Id | Pregunta | Default implementado |
|---|---|---|
| OQ-BE-1 | ¿Qué texto alimenta el embedding? | `name` + nombre de categoría + (curado ∥ enriquecido ∥ base). La categoría entra porque "mecha widia 8" sin el rubro es casi ruido |
| OQ-BE-2 | Ventana aceptable del enriquecimiento inicial (**Q-4 abierta del E2E §23**) | `GEMINI_MAX_RPM=15` (free tier de `gemini-1.5-flash`) ⇒ ~5.000 SKUs en **≈ 5,5 h**. Si el PO quiere menos, hay que subir cuota: es límite del proveedor, no del código |
| OQ-BE-3 | ¿La descripción enriquecida se muestra en la ficha pública? | **No** en este change: los DTO del storefront no cambian. El texto existe y se embebe; exponerlo es decisión de producto (afecta SEO y es visible al cliente) |
| OQ-BE-4 | Tuning del HNSW (`m`, `ef_construction`) | `m=16`, `ef_construction=64` (defaults de pgvector, adecuados a ~5.000 vectores). Re-tunear con datos reales es tarea de US-004 |
| OQ-BE-5 | ¿Cuántos intentos antes de abandonar? | 5, con backoff 1m/5m/25m/2h/10h. El costo de equivocarse es plata de Gemini, no corrupción |

## References

- User story: [`docs/user-stories/US-005-enriquecimiento-ia-embeddings.md`](../../../docs/user-stories/US-005-enriquecimiento-ia-embeddings.md)
- Ticket de referencia del readme del proyecto: `DB-US-005` (esquema + pgvector + HNSW + helper kNN + `EXPLAIN`)
- PRD: [`docs/product/prd.md`](../../../docs/product/prd.md) §1.4 (KPI de cobertura ≥ 90% y relevancia ≥ 70%), §2.1 capacidad 3, §3.2 (red de seguridad)
- E2E: [`docs/product/design-e2e.md`](../../../docs/product/design-e2e.md) §6.1 (`enrichment` + worker), §8 (DER `PRODUCT_EMBEDDINGS`, HNSW, `$queryRaw`), §9.3 (secuencia del pipeline), §14 (frontera con Gemini), §17 (NFRs), §18 + §18.5 (observabilidad y runbook), §21 (suposición de cuota), §22 (riesgo de rate-limit), §23 Q-4
- ADR-0003 — Gemini (`gemini-1.5-flash` + `text-embedding-004`, 768 dims): **gobierna el proveedor, no se re-decide**
- ADR-0002 — Postgres + pgvector como datastore único (el vector vive acá, no en un motor aparte)
- ADR-0004 — Redis + BullMQ (**enmendado** por ADR-0014 en cuanto a quién ejecuta este workload)
- ADR-0012 — ejecutor in-process del import (**precedente extendido** por ADR-0014)
- **ADR-0014 — ejecutor in-process del enriquecimiento IA** (se escribe en T0.1; decisión del Arquitecto del 2026-08-22)
- Specs vivas: [`openspec/specs/catalogo/`](../../specs/catalogo/) — al archivar, el pipeline forma la capacidad `openspec/specs/enriquecimiento/` y los dos endpoints entran al contrato vivo
- Changes de referencia: `US-006-import-masivo-inventario-backend` (runner in-process, lotes, heartbeat, puerto `EnrichmentQueue`), `US-014-registro-login-backend` (puerto de mailer + adapter según config, throttler nombrado, secretos exigidos en producción)
