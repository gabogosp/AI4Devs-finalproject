---
parent-us: US-005
discipline: qa
language: es
---

# US-005 — Plan de QA (capas QA-owned)

> **Service tier**: 1 (derivado — no hay `service-catalog.yaml` en el repo). Mismo criterio
> que `US-010-orden-webhook-stock-qa/qa-plan.md` §1: la capacidad `enriquecimiento-ia` es un
> sub-objetivo **crítico** del PRD (§1.4) — sin ella, `busqueda` (CAP-2, el diferenciador del
> producto) no tiene qué vectorizar. Se registra la derivación explícitamente (tier-resolution:
> catálogo ausente → derivar de `proposal.md`/US), no se asume en silencio.

## 1. Perfil de riesgo

| Componente | Clasificación | Por qué |
|---|---|---|
| Selección de proveedor por config (`ai.providers.ts`) | **CRÍTICO** | Si "presente" se confunde con "válida", una clave rota enciende el runner igual — es exactamente el hallazgo QA-005-F1 que gobierna este plan. |
| `registerFailure` — backoff durable + abandono (AC-4/AC-5) | **CRÍTICO** | Es la red de seguridad completa: si esto falla, un producto con un proveedor caído queda invisible para siempre en vez de degradar con gracia. |
| `actualizarProducto` — `status` fuera del `UPDATE` (AC-10) | **CRÍTICO** | Que el enriquecimiento nunca publique es una garantía de negocio (US-001 sigue siendo la única vía de publicar); un bug acá publicaría productos sin que el dueño lo pida. |
| `POST /v1/admin/enrichment/runs` | Alto | Única superficie que gasta dinero real por request (Gemini); admin-only + throttler propio. |
| Costura de curación (`PATCH /admin/products/{id}` con `description_enriched`) | Alto | AC-7 depende enteramente de que esta costura marque los flags correctos — y el contrato no la expone de vuelta (QA-005-F2), así que un bug acá es invisible para cualquier cliente real. |
| Redacción del secreto (`GEMINI_API_KEY`) en toda respuesta observable | **CRÍTICO** | AC-9; un leak acá es una clave de proveedor de pago filtrada en un log o un `/status` público de facto. |

**Journeys críticas identificadas**:

1. El catálogo pobre se enriquece con éxito y queda buscable — **no ejecutable en este
   entorno** (§3, `@blocked`), pero su ausencia de cobertura queda documentada, no oculta.
2. El proveedor falla — transitoria o persistentemente — y el producto degrada con gracia:
   sigue navegable, nunca se pierde de la cola, nunca publica solo, nunca filtra el secreto.
   Esta es la journey que **sí** es ejecutable hoy, íntegramente, con el proveedor real.
3. El dueño cura un texto y la IA lo respeta — mecánicamente verificable; el round-trip
   completo (el embedding realmente se regenera sobre el texto curado) no lo es.
4. Ninguna sesión de QA en el entorno compartido dispara tráfico real hacia Google por
   accidente (QA-005-F1) — precondición de higiene antes de que cualquier otra journey
   tenga sentido.

## 2. Mapeo de la pirámide de test (capas QA-owned en negrita)

| Capa | Dueño | Estado | Herramienta |
|---|---|---|---|
| Unit (`source-text`, `backoff`, `rate-limiter`, `ai.providers`, `config-number`) | Dev (TDD) | **Hecho** — `tasks.md` de backend, Fase 1 | Jest |
| Integration (`enrichment.repository`, `embedding.repository`, `knn`, `coverage`) | Dev (TDD) | **Hecho** — Fase 2 | Jest + Postgres real |
| e2e-nest (contrato HTTP de los 2 endpoints, matriz de decisión, runner, eventos) | Dev (TDD) | **Hecho** — Fases 3-5 | Jest + supertest + Postgres real + `FakeAiProvider` |
| e2e-nest de los 10 AC (ciclo completo, idempotencia, resiliencia, cobertura) | Dev (TDD) | **Hecho** — Fase 6 (T6.1-T6.4) | Jest + Postgres real + `FakeAiProvider` |
| **Aceptación BDD (Layer 1, backend-aislado, persistente)** | **QA** | Este plan | Cucumber-js + Playwright `APIRequestContext` |
| **Contract testing** | **QA** | Este plan | Script `tsx` contra el OpenAPI vivo |
| **Corrección de contrato incompleto (QA-005-F2, mitad segura)** | **QA** | Este plan | Edición documental de `openspec/specs/catalogo/` |
| **Performance (k6)** | **QA + Dev** | Este plan | k6 (reusa thresholds existentes) |
| **Exploratorio** | **QA** | Este plan | Charters manuales |
| E2E cross-stack (Layer 3) | N/A | No hay pantalla FE para esta capacidad (D-1 diferida); el único riesgo cross-service (búsqueda no degradada) ya vive en `QA-004-PERF-3` | — |
| Batería de relevancia IA / k6 de `/v1/search` bajo enriquecimiento | N/A para este change | Ya en `US-004-busqueda-semantica-backend/qa-plan.md` (`QA-004-REL-*`, `QA-004-PERF-3`) | — |

> **Nota de cobertura dev-owned (awareness, no se re-autora)**: 28/28 tasks del backend
> cubren, contra Postgres real y con un `FakeAiProvider` determinista, los 10 AC completos
> — incluidos AC-1/AC-2/AC-6/AC-8, que este plan **no puede** ejercitar negro-caja en este
> entorno (§3). Este plan no duplica esa suite; construye la capa de aceptación
> **persistente** (per `qa-three-layer-regression`) sobre el proceso HTTP real, con el
> proveedor real (no un fake), para lo que sí es alcanzable así, y documenta explícitamente
> lo que no lo es.

## 3. Matriz de trazabilidad AC → escenarios (autocheck F47)

`Q` = ejecutable hoy por este plan · `B` = **bloqueado** (necesita `GEMINI_API_KEY` real,
ver `design.md` §D-QA1) · `Qm` = ejecutable, mecánico/parcial (no prueba el AC completo).

| AC | Título | Escenario(s) | Estado |
|---|---|---|---|
| AC-1 | Enriquecer y generar embedding | `SC-005-H1` | **B** |
| AC-2 | Elegible para búsqueda semántica | `SC-005-H2` | **B** |
| AC-3 | Cobertura del catálogo medible | `SC-005-H3` | Qm (mecanismo; el ≥90% es operación) |
| AC-4 | Reintento con backoff, respeta rate-limit | `SC-005-C1`, `SC-005-C7` | Qm (backoff durable + cooldown + 429 reales; el reintento in-process jitterado de 429 es dev-owned) |
| AC-5 | Fallo persistente degrada con gracia | `SC-005-C2` | Q (completo, con excepción de tiempo §D-QA5) |
| AC-6 | Re-enriquecer sólo si cambió | `SC-005-C3` | **B** |
| AC-7 | No sobreescribir descripción curada | `SC-005-N1` (mecánica), `SC-005-N2` (completa) | Qm / **B** |
| AC-8 | Versionado de embeddings | `SC-005-N3` | **B** |
| AC-9 | Sin secretos en logs/respuestas | `SC-005-N4` | Q |
| AC-10 | No publica productos | `SC-005-N5` | Q |

Invariantes de infraestructura sin AC numerado propio (mecánica de contrato, subyacen a
AC-1/AC-3/AC-4/AC-5): `SC-005-C4` (409 run-in-progress), `SC-005-C5` (503 disabled),
`SC-005-C6` (401/403), `SC-005-C8` (422 de validación).

Todos los IDs citados (`SC-005-H1/H2/H3`, `SC-005-C1..C8`, `SC-005-N1..N5`) están definidos
en el `Feature:` de §4. No hay referencias colgantes.

## 4. Escenarios BDD (Gherkin)

```gherkin
# language: es
@enriquecimiento @us-005
Característica: Enriquecimiento IA de descripciones + generación de embeddings (US-005)
  Como sistema
  quiero enriquecer descripciones pobres con IA y generar sus embeddings, respetando el texto curado por el dueño y degradando con gracia cuando el proveedor falla
  para que el catálogo sea buscable en lenguaje natural (US-004) sin arriesgar el catálogo entero a un proveedor externo

  # ─── HAPPY PATH ───

  @happy @blocked
  Escenario: SC-005-H1 — Un producto con descripción pobre se enriquece y se embebe con éxito (AC-1)
    Dado un producto publicado con una descripción base pobre, pendiente de enriquecer
    Cuando se dispara una corrida de enriquecimiento
    Entonces el producto queda con una descripción enriquecida no vacía
    Y su embedding de 768 dimensiones queda persistido con la versión del modelo usada
    Y "GET /v1/admin/enrichment/status" lo cuenta entre los embebidos
  # BLOQUEADO (ver `design.md` §D-QA1): necesita que Gemini responda CON ÉXITO. Este
  # entorno sólo tiene el placeholder de `.env.example` (`proposal.md` OQ-QA-005-1). Ya
  # probado dev-owned (`e2e-enrichment-cycle.spec.ts`, T6.1) con el FakeAiProvider
  # determinista.

  @happy @blocked
  Escenario: SC-005-H2 — Un producto enriquecido por esta corrida queda elegible para la búsqueda semántica (AC-2)
    Dado un producto enriquecido y embebido con éxito por una corrida real de esta capacidad
    Cuando se ejecuta una búsqueda kNN sobre su vector
    Entonces el producto aparece como candidato según su similitud
  # BLOQUEADO — depende de SC-005-H1. La elegibilidad kNN en sí ya está probada dev-owned
  # (`knn.spec.ts`, T2.3, `EXPLAIN` sobre el índice HNSW) y con datos sembrados directo por
  # `US-004-busqueda-semantica-backend/qa-plan.md` (`seed-busqueda.ts`). Lo que este
  # escenario probaría de más — que ESTE pipeline real produjo el vector — no es
  # alcanzable sin clave real.

  @happy @critical-path
  Escenario: SC-005-H3 — La cobertura del catálogo es observable y coincide con la verdad de la base (AC-3)
    Dado un catálogo con una mezcla conocida de productos pendientes y abandonados
    Cuando se llama "GET /v1/admin/enrichment/status"
    Entonces "coverage.total", "coverage.pending" y "coverage.abandoned" coinciden con el conteo real de la base
    Y "coverage.coverage_ratio" es "coverage.embedded" dividido "coverage.total"
    Y con un catálogo vacío "coverage.coverage_ratio" es 0 sin lanzar una excepción
  # El umbral de negocio (≥90%) es un resultado de operación sobre el catálogo real
  # (runbook §3.6 del servicio), no una propiedad verificable en este entorno — este
  # escenario prueba que el MECANISMO de medición es correcto, no el número.

  # ─── CORNER (resiliencia real, mecánica de contrato) ───

  @corner @critical-path
  Escenario: SC-005-C1 — El fallo real del proveedor acumula intentos con backoff creciente y abre el circuito (AC-4)
    Dado una instancia con el proveedor de IA habilitado apuntando a una clave real inválida
    Y al menos 5 productos pendientes de enriquecer sembrados en el mismo lote
    Cuando se dispara una corrida con "POST /v1/admin/enrichment/runs"
    Entonces cada producto tocado acumula un intento con su próximo intento agendado según la escalera de backoff
    Y tras las fallas consecutivas del umbral configurado el estado del runner pasa a "cooldown"
    Y una corrida disparada durante el cooldown responde 409 con el tipo "dsm:enrichment/cooldown"

  @corner @critical-path
  Escenario: SC-005-C2 — Un producto agota sus intentos y queda abandonado, navegable y con el error registrado (AC-5)
    Dado un producto pendiente de enriquecer sembrado, con el proveedor de IA habilitado apuntando a una clave real inválida
    Cuando se dispara una corrida y se adelanta su próximo intento hasta agotar el tope de intentos configurado
    Entonces el producto queda sin marca de enriquecido, sin fila en los embeddings, con su descripción base intacta y con un código de error registrado
    Y "GET /v1/admin/enrichment/status" lo cuenta entre los abandonados
    Y el producto sigue apareciendo en el listado público de su categoría (US-002)

  @corner @blocked
  Escenario: SC-005-C3 — Re-enriquecer sólo si cambió la descripción base (AC-6)
    Dado un producto ya enriquecido con éxito y sin cambios en su descripción base
    Cuando se vuelve a disparar una corrida
    Entonces no se llama a la IA ni al embedder para ese producto
  # BLOQUEADO — la rama de "hash igual, saltar" sólo se alcanza tras una corrida EXITOSA
  # previa: el hash sólo se persiste en el camino de éxito (`actualizarProducto`). Sin una
  # GEMINI_API_KEY real no hay baseline que verificar. Ya probado dev-owned
  # (`enrichment.service.spec.ts` T3.2, `e2e-enrichment-idempotency.spec.ts` T6.2).

  @corner @critical-path
  Escenario: SC-005-C4 — Una corrida en curso rechaza un segundo disparo (mecánica, subyace a AC-1/AC-5)
    Dado una instancia con el proveedor de IA habilitado y productos pendientes sembrados
    Cuando se dispara una corrida con "POST /v1/admin/enrichment/runs"
    Y se dispara una segunda corrida inmediatamente después
    Entonces la primera responde 202 con "run_id" y "accepted" true
    Y la segunda responde 409 con el tipo "dsm:enrichment/run-in-progress"

  @corner
  Escenario: SC-005-C5 — Sin proveedor de IA configurado, la corrida no arranca y el catálogo sigue navegable (D6, espíritu de AC-5)
    Dado que la instancia de QA compartida tiene el enriquecimiento deshabilitado
    Cuando se llama "GET /v1/admin/enrichment/status"
    Entonces "runner_state" es "disabled"
    Cuando se intenta "POST /v1/admin/enrichment/runs"
    Entonces recibo 503 con el tipo "dsm:enrichment/disabled"
    Y ningún producto del catálogo cambia de estado

  @corner
  Esquema del escenario: SC-005-C6 — Sin permiso admin, los 2 endpoints rechazan (mecánica de contrato)
    Cuando se llama "<método>" "<endpoint>" con "<credencial>"
    Entonces recibo "<status>"

    Ejemplos:
      | método | endpoint                          | credencial          | status |
      | GET    | /v1/admin/enrichment/status       | sin token           | 401    |
      | GET    | /v1/admin/enrichment/status       | token de cliente    | 403    |
      | POST   | /v1/admin/enrichment/runs         | sin token           | 401    |
      | POST   | /v1/admin/enrichment/runs         | token de cliente    | 403    |

  @corner
  Escenario: SC-005-C7 — El presupuesto real de POST /runs protege el costo (AC-4, control de superficie)
    Dado una instancia con el presupuesto real de "ENRICHMENT_RATE_LIMIT_MAX" sin elevar
    Cuando se superan las llamadas permitidas por la ventana
    Entonces la llamada excedente responde 429 con las cabeceras "Retry-After" y "RateLimit-*"

  @corner
  Esquema del escenario: SC-005-C8 — El cuerpo de POST /runs con forma inválida se rechaza sin tocar el runner
    Cuando se llama "POST /v1/admin/enrichment/runs" con "<cuerpo>"
    Entonces recibo 422
    Y el estado del runner no cambia

    Ejemplos:
      | cuerpo                                                |
      | un campo desconocido, por ejemplo {"forced": true}    |
      | product_ids con un elemento que no es UUID            |
      | product_ids con más de 500 elementos                  |

  # ─── NEGATIVE SPACE ───

  @negative @critical-path
  Escenario: SC-005-N1 — Curar la descripción del dueño marca el producto como curado y elegible para re-embeddear (AC-7, mitad mecánica)
    Dado un producto publicado
    Cuando se llama "PATCH /v1/admin/products/{id}" con "description_enriched"
    Entonces la respuesta es 200
    Y leyendo el estado interno del producto, "description_curated" es true y "enrichment_done" es false
    Y editar sólo el precio o el stock del mismo producto no cambia "description_curated"

  @negative @blocked
  Escenario: SC-005-N2 — El embedding se regenera sobre el texto curado y nunca sobre el crudo (AC-7, mitad completa)
    Dado un producto curado por el dueño
    Cuando se dispara una corrida de enriquecimiento
    Entonces no se llama a la IA de enriquecimiento para ese producto
    Y el embedding persistido corresponde al texto curado, no al texto base
  # BLOQUEADO — necesita que el embedder responda con éxito. Ya probado dev-owned
  # (`enrichment.service.spec.ts` T3.2, `e2e-curated-text.spec.ts`, T4.3/T6.2 con el
  # FakeAiProvider determinista).

  @negative @blocked
  Escenario: SC-005-N3 — La versión del modelo queda registrada y un cambio de modelo no corrompe embeddings previos (AC-8)
    Dado embeddings ya generados con una versión del modelo
    Cuando se procesa un producto nuevo con éxito
    Entonces su embedding registra la versión del modelo usada
    Y los embeddings previos conservan su propia versión sin alterarse
  # BLOQUEADO — necesita al menos una corrida exitosa. Ya probado dev-owned
  # (`embedding.repository.spec.ts`, T2.2, AC-8).

  @negative @critical-path
  Escenario: SC-005-N4 — Ninguna respuesta observable filtra la clave del proveedor, incluso durante una corrida que falla de verdad (AC-9)
    Dado una instancia con el proveedor de IA habilitado apuntando a una clave real inválida
    Cuando se dispara una corrida y se deja fallar contra el proveedor real
    Entonces ninguna respuesta de "GET /v1/admin/enrichment/status" ni de "POST /v1/admin/enrichment/runs" contiene el valor configurado de la clave
    Y "last_error_code" es un tipo del catálogo "dsm:enrichment/*", nunca el mensaje crudo del proveedor

  @negative @critical-path
  Escenario: SC-005-N5 — El enriquecimiento nunca publica, tenga éxito o falle (AC-10)
    Dado un producto en estado "draft" pendiente de enriquecer, con el proveedor de IA habilitado apuntando a una clave real inválida
    Cuando se dispara una corrida de enriquecimiento sobre ese producto
    Entonces el producto sigue en estado "draft" después de la corrida, sea cual sea el resultado del proveedor
```

**Tooling**: Cucumber-js con `qa/acceptance/steps/enriquecimiento.steps.ts` contra
Playwright `APIRequestContext`, mismo patrón que `pago-webhook.steps.ts`/`carrito.steps.ts`.
**Location**: `qa/acceptance/features/enriquecimiento.feature`.
**Test layer**: 1 (backend-aislado) para las 16. No hay Layer 3 (§8). `SC-005-H1/H2/C3/N2/N3`
son `@blocked` — no corren en CI hasta que exista una `GEMINI_API_KEY` real (per
`bdd-scenario-quality`: `@blocked` nunca se cuela verde; se excluye explícitamente del tag
de ejecución).

## 5. Stubs de casos de prueba

| id | execution_mode | test_layer | target_tooling | gherkin_scenario |
|---|---|---|---|---|
| QA-005-ACC-1 | automated | 1 | Cucumber-js + Playwright `APIRequestContext` | enriquecimiento.feature — SC-005-H3, C1, C2, C4, C5, C6, C7, C8, N1, N4, N5 (11 escenarios ejecutables) |
| QA-005-ACC-2 | **manual** | 1 | — (checklist, sin scaffold) | SC-005-H1, H2, C3, N2, N3 — bloqueados, ver `design.md` §D-QA1 |
| QA-005-CT-1 | automated | 1 | Script `tsx` (`fetch`, sin jest) | N/A (contract test, no BDD) — los 2 endpoints de `enriquecimiento-ia` |
| QA-005-PERF-1 | automated | 1 | K6 | N/A (performance, no BDD) — NFR-3 (lectura de storefront durante una corrida activa) |
| QA-005-EXP-1 | **manual** | — | Charter | Reintentos reales del proveedor, interacción `force`+`product_ids`, ruido cross-sesión |

## 6. Contract testing

- [ ] **QA-005-CT-1**: `qa/contract/enrichment.contract.ts` — script `tsx`, mismo patrón que
  `search.contract.ts`/`pago-webhook.contract.ts`, contra
  `openspec/specs/enriquecimiento-ia/contracts/openapi.yaml` (raíz viva).

  ```yaml
  id: QA-005-CT-1
  execution_mode: automated
  test_layer: 1
  target_tooling: Script tsx (fetch, sin jest)
  gherkin_scenario: N/A (contract test, no BDD)
  ```

  - Exit criterion: `GET /admin/enrichment/status` responde 200 con
    `EnrichmentStatus` completo (`runner_state`, `coverage.*`, `models.*`, `last_error_code`,
    `last_run_at`) y `Cache-Control: no-store`; 401/403 sin/con token no-admin. `POST
    /admin/enrichment/runs` responde 202 con `EnrichmentRunAccepted`, 409 con `type`
    `dsm:enrichment/run-in-progress` **o** `dsm:enrichment/cooldown`, 422 con el catálogo de
    causas de validación, 429 con las cabeceras de rate-limit, 503 con `type`
    `dsm:enrichment/disabled` — sin propiedades extra en ninguna de las formas
    (`additionalProperties: false` del spec).
  - Verify: `QA_API_BASE_URL=http://localhost:3009 ADMIN_BOOTSTRAP_TOKEN=<mismo valor de la API> pnpm --filter @dsm/qa test:contract:enrichment`

## 7. Corrección de contrato incompleto (QA-005-F2, mitad segura)

- [ ] **QA-005-CT-2**: agregar `description_enriched` (nullable string) al schema
  `UpdateProduct` de `openspec/specs/catalogo/contracts/openapi.yaml` — documenta lo que
  `UpdateProductDto` (T4.3 del backend) ya acepta en producción.

  ```yaml
  id: QA-005-CT-2
  execution_mode: automated
  test_layer: 1
  target_tooling: Edición documental + Spectral
  gherkin_scenario: N/A (corrección de contrato, no BDD)
  ```

  - Exit criterion: `UpdateProduct` declara `description_enriched: { type: string, nullable:
    true }`; Spectral sigue en 0 errores; el schema `Product` (lectura) **no** se toca — el
    código no devuelve esos campos todavía (QA-005-F2, mitad insegura, `proposal.md`
    OQ-QA-005-2).
  - Verify: `npx @stoplight/spectral-cli lint openspec/specs/catalogo/contracts/openapi.yaml && grep -A2 "description_enriched" openspec/specs/catalogo/contracts/openapi.yaml | grep -q "nullable: true"`

## 8. Performance (k6)

- [ ] **QA-005-PERF-1**: `qa/performance/storefront-under-enrichment.js` — la lectura de
  storefront mantiene su p95 mientras corre una barrida real de enriquecimiento (NFR-3, E2E
  §17), reusando los thresholds `list_products`/`storefront_product` **ya existentes** en
  `qa/performance/lib/thresholds.js` — no se inventa un número nuevo.

  ```yaml
  id: QA-005-PERF-1
  execution_mode: automated
  test_layer: 1
  target_tooling: K6
  gherkin_scenario: N/A (performance, no BDD)
  ```

  - Exit criterion: `setup()` siembra ~150 productos frescos (prefijo propio) contra la
    instancia de perfil B (`design.md` §D-QA4, `ENRICHMENT_ENABLED=true`) y dispara `POST
    /admin/enrichment/runs`; los VUs alternan `GET /v1/categories/{slug}/products` (tag
    `list_products`) y `GET /v1/products/{slug}` (tag `storefront_product`) sobre el pool de
    slugs de `seed:load`. Se cumplen los thresholds existentes (`p(95)<300` para ambos,
    `http_req_failed: rate<0.01`, `checks: rate>0.99`). El escenario **verifica que la
    corrida estaba activa** durante la medición (`runner_state: "running"` en al menos un
    `GET /status` de control) — si terminó antes, el test no midió nada y debe fallar, no
    pasar por defecto (mismo criterio que `QA-004-PERF-3`).
  - Verify: `QA_API_BASE_URL=http://localhost:3925 k6 run qa/performance/storefront-under-enrichment.js --summary-trend-stats="p(95)"`

> **No se planifica k6 para `/v1/search` bajo enriquecimiento concurrente** — ya es
> `QA-004-PERF-3` en `US-004-busqueda-semantica-backend/qa-plan.md`. Repetirlo acá violaría
> `qa-three-layer-regression` (misma journey, mismo riesgo, dos suites).

## 9. E2E cross-stack (Layer 3) — N/A

No existe ninguna pantalla FE para esta capacidad: `grep -rn "enrichment" apps/web/src` no
devuelve nada, y la curación queda `Deferred: FE — owner: PO` (D-1 de
`openspec/specs/enriquecimiento-ia/requirements.md`). Sin UI, no hay journey cross-stack que
ejercitar. El único riesgo cross-service real de esta capacidad — que la búsqueda semántica
no se degrade mientras el enriquecimiento corre en background — ya está cubierto por
`QA-004-PERF-3`; este plan cubre el riesgo hermano (que el **storefront genérico**, no sólo
la búsqueda, tampoco se degrade) en §8.

## 10. Datos y fixtures

### Helpers nuevos requeridos

- **`qa/support/seed-enrichment.ts`**: crea N productos publicados con `description_raw`
  pobre (vía `POST /v1/admin/products` + `PATCH .../publish`, API real, mismo patrón que
  `seed-busqueda.ts`) — nunca INSERT directo. Variantes: lote de N productos pendientes
  (para C1/C4/PERF), un producto solo (para C2), un producto `draft` (para N5).
- **`qa/support/enrichment-db.ts`** (+ `.smoke.ts`): dos funciones, **ambas documentadas
  como excepción angosta** (`design.md` §D-QA2/§D-QA5):
  - `leerEstadoEnriquecimiento(productId)` — **sólo lectura** vía `@dsm/db` (Prisma):
    `description_enriched`, `description_curated`, `enrichment_done`,
    `enrichment_source_hash`, `enrichment_attempts`, `enrichment_error_code`,
    `enrichment_next_attempt_at`. Existe porque el contrato no expone estos campos
    (QA-005-F2) — nunca para fabricar el efecto que un escenario prueba, sólo para
    observarlo.
  - `adelantarProximoIntento(productId)` — `UPDATE products SET
    enrichment_next_attempt_at = now()`. Existe para no esperar 2h31m de backoff real
    (`design.md` §D-QA5) — nunca toca `enrichment_attempts` ni `enrichment_error_code`,
    esos los escribe el `POST /runs` real contra el proveedor real.
  - `contarEmbeddings()` — `SELECT count(*) FROM product_embeddings` — verdad de base para
    contrastar contra `coverage.embedded` de `/status` (SC-005-H3), mismo criterio que el
    propio T6.4 del backend ya usó desde el lado dev-owned.

### Reuso existente (sin modificar)

- `qa/support/spawn-api.ts` (`levantarApiTemporal`) — perfiles B y C de `design.md` §D-QA4.
- `qa/support/admin-auth.ts`, `qa/support/api.ts`, `qa/support/builders.ts`.

### Estrategia de datos (per `testing-standards.md` §5)

- 100% sintético — ningún dato de producción, ningún texto real de catálogo hacia Gemini.
- Defaults determinísticos en los builders existentes; el único no-determinismo es el
  prefijo de corrida (`QA_RUN_PREFIX`), nunca aserido.
- Cada escenario siembra sus propios productos — nunca reusa los de otro escenario (evita
  colisión con el catálogo compartido, mismo criterio que `QA-010-ACC-1`).

## 11. Exploratory charters

Agregar a `qa/exploratory/us-005-enriquecimiento-ia.md`:

1. **Charter: comportamiento real del proveedor con una clave que se corrige a mitad de
   corrida** — con el perfil B corriendo, cambiar la clave de inválida a "también inválida
   pero con otro formato" y observar si la clasificación transitorio/permanente del código
   real se comporta como el `design.md` de backend predice, o si Google devuelve un status
   distinto al esperado (400 vs 401 vs 403) que cambiaría cuál rama de reintento se ejercita.
2. **Charter: interacción de `force` con `product_ids` en el mismo cuerpo** — el contrato no
   dice explícitamente qué pasa si se combinan (¿rehabilita sólo esos ids, o todos los
   abandonados del catálogo aunque no estén en la lista?) — explorar y documentar el
   comportamiento real, candidato a una aclaración del contrato si sorprende.
3. **Charter: ruido cross-sesión sobre el catálogo compartido** — con el fix de QA-005-F1
   aplicado, confirmar que ninguna otra suite del harness (`carrito`, `importar`, `ordenes`)
   ve su catálogo tocado por un enriquecimiento en background durante una corrida completa
   de `pnpm --filter @dsm/qa test:acceptance` sin filtro de tags.

## 12. Quality gates

| Gate | Bloquea | Disparador |
|---|---|---|
| Fix de higiene de entorno (`ENRICHMENT_ENABLED=false` en `api-up.sh`) | **toda otra suite del harness** | antes de correr cualquier suite QA en este worktree u otro que comparta el mismo `.env` |
| Contract (`QA-005-CT-1`, `QA-005-CT-2`) | merge | todo PR que toque `apps/api/src/enrichment/` o `openspec/specs/enriquecimiento-ia/` |
| Aceptación BDD (`QA-005-ACC-1`) | merge | todo PR que toque `apps/api/src/enrichment/` o `apps/api/src/products/products.service.ts` (costura de curación) |
| k6 storefront-under-enrichment (`QA-005-PERF-1`) | release | pre-release |
| `SC-005-H1/H2/C3/N2/N3` (bloqueados) | — | no gatean nada hasta que exista una `GEMINI_API_KEY` real |

## 13. Anti-patterns evitados

- ❌ `qa-backend-standards.md` §2.1 ("QA writes all the tests"): unit/integration/e2e-nest de
  las 28 tasks del backend son dev-owned y no se re-autoran acá (§2).
- ❌ `testing-standards.md` §14.9 (negative-space ausente): 3 de las 4 AC negative-space de
  la US quedan con al menos un escenario ejecutable (AC-9, AC-10, y AC-7 en su mitad
  mecánica); la única completamente bloqueada (AC-8) queda declarada `@blocked`, nunca
  simulada.
- ❌ Simular una respuesta exitosa de Gemini con un doble no autorizado por el propio diseño
  del backend (D6: "un embedding falso se descubre en la demo"): se prefiere `@blocked` +
  la recomendación de conseguir una clave real (`proposal.md` OQ-QA-005-1) — mismo criterio
  que `US-010-orden-webhook-stock-qa` ya aplicó a su propio bloqueo de MercadoPago.
- ❌ `flakiness-detection` señal 5 (order dependencies): cada escenario "enabled" (perfil B)
  levanta y apaga su **propia** instancia (`design.md` §D-QA4) — el contador de fallas
  consecutivas del circuit-breaker vive en memoria y compartir instancia entre escenarios
  haría que el orden de ejecución importara.
- ❌ `k6-load-scaffolding` ("umbral inventado sin trazar a un NFR"): `QA-005-PERF-1` reusa
  los thresholds `list_products`/`storefront_product` que ya existen y ya están atados a
  E2E §17 — no se inventa un número nuevo para la misma superficie bajo una condición nueva.
- ❌ Documentar en el contrato algo que el código no cumple (QA-005-F2): se corrige sólo la
  mitad segura (`UpdateProduct` acepta el campo — verdad) y se deja la mitad insegura
  (`Product` no lo devuelve) como hallazgo explícito, no como "completado".
- ❌ Dejar un hallazgo de higiene de entorno como nota al pie: QA-005-F1 es la **primera**
  task de este plan (Fase 0), no una advertencia al final.

## 14. Preguntas abiertas / hallazgos

Las dos preguntas de producto viven en `proposal.md` con su default. Acá, el detalle
técnico de los dos hallazgos que gobiernan el diseño:

1. **QA-005-F1 (hallazgo de higiene de entorno)**: `qa/scripts/api-up.sh`, tal como está
   hoy, deja la instancia compartida de QA con `GEMINI_API_KEY=replace-me` (no vacía, "
   configurada" para `ai.providers.ts`) y `ENRICHMENT_ENABLED=true` (default) — cualquier
   import real en esa instancia dispara la cola de enriquecimiento contra Google con una
   clave inválida, sin que nadie lo pida. Se corrige en Fase 0 de `tasks.md` (T0.1).
2. **QA-005-F2 (hallazgo de contrato incompleto)**: `UpdateProductDto` acepta
   `description_enriched` (T4.3 del backend) pero ni `openspec/specs/catalogo/contracts/`
   lo declara ni `ProductResponseDto` lo devuelve nunca — la curación (AC-7) es invisible
   para cualquier cliente API, incluida la futura UI de curación (D-1). Se corrige la mitad
   segura (§7, QA-005-CT-2); la mitad insegura queda como recomendación
   (`proposal.md` OQ-QA-005-2).

## 15. Dependencias declaradas

| Dependencia | Estado | Efecto |
|---|---|---|
| `US-005-enriquecimiento-ia-embeddings-backend` | **Archivado** (PR #3, 28/28 tasks) | Desbloquea todo §4-§10 salvo lo declarado `@blocked` |
| `US-004-busqueda-semantica-backend` | **Archivado** | Su qa-plan ya absorbió `QA-004-REL-*`/`QA-004-PERF-3` — no se repiten acá |
| `GEMINI_API_KEY` real (free tier, ADR-0003) | **No existe en este entorno** | Bloquea `SC-005-H1/H2/C3/N2/N3` (AC-1/AC-2/AC-6/AC-8) — ver `proposal.md` OQ-QA-005-1 |
| Fix de `ProductResponseDto` (exponer curación) | No planificado, fuera de alcance | Bloquearía sólo la observabilidad de AC-7; el `PATCH` real ya funciona sin esto |

**Linear MCP**: no conectado en esta sesión — sin sub-task de tracker que anotar. Per
`tracker-handoff` §2.4, se deja constancia acá en vez de omitirlo en silencio.

## 16. Standards consultados

- `docs/base-standards.md`
- `docs/quality/testing-standards.md` §2 (pirámide), §4.1 (naming), §5 (datos de test), §8
  (coverage), §14 (patrones de código de test, §14.2 fakes vs mocks, §14.8 fixtures), §14.9
  (negative space), §18 (anti-patterns)
- `docs/quality/qa-backend-standards.md` §2.1 (ownership matrix), §13 (performance), §15
  (datos sintéticos), §21 (BDD y Gherkin)
- `docs/architecture/api-standards.md` §8 (RFC 7807), §10 (idempotencia/202), §12 (headers
  de rate-limit)
- `docs/architecture/decisions/0014-in-process-enrichment-executor.md` (gobierna por qué el
  runner compite con el request path — insumo de `QA-005-PERF-1`)
- `docs/architecture/decisions/0003-*` (Gemini, free tier — gobierna por qué el bloqueo es
  de trámite, no de arquitectura)
- Skills: `qa-three-layer-regression` (no duplicar `QA-004-*`), `bdd-scenario-quality`
  (`@blocked` no se cuela verde, Scenario Outline en `SC-005-C6`/`SC-005-C8`),
  `k6-load-scaffolding` (thresholds existentes, verificar corrida activa),
  `flakiness-detection` (instancia por escenario), `threat-modeling-lite` (STRIDE del
  proveedor de IA ya cerrado por el backend, `design.md` §Seguridad — este plan lo verifica
  vía `SC-005-N4`, no lo reabre), `openspec-workflow`, `tracker-handoff`

## 17. Referencias

- User Story: `docs/user-stories/US-005-enriquecimiento-ia-embeddings.md`
- E2E: `docs/product/design-e2e.md` §6.1, §8, §9.3, §14, §17, §18/§18.5, §21, §22, §23 Q-4
- Change de backend (archivado): `proposal.md`, `design.md`, `tasks.md` — 28/28 tasks
- Contrato vivo de esta capacidad:
  `openspec/specs/enriquecimiento-ia/contracts/openapi.yaml` +
  `openapi/paths/{enrichment-status,enrichment-runs}.yaml`
- Contrato a corregir (QA-005-F2): `openspec/specs/catalogo/contracts/openapi.yaml`
  (`UpdateProduct`)
- ADR-0003 (Gemini), ADR-0014 (ejecutor in-process)
- Changes relacionados: `openspec/changes/archive/US-004-busqueda-semantica-backend/qa-plan.md`
  (dueño de `QA-004-REL-*`/`QA-004-PERF-3`), `openspec/changes/archive/US-010-orden-webhook-stock-qa/`
  (precedente de formato + de "hallazgo de entorno → `@blocked` documentado")
