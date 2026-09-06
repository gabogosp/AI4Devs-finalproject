---
parent-us: US-005
discipline: qa
language: es
---

# US-005 QA — Tasks

> Cada task se cierra cuando su `Verify:` pasa. Los comandos asumen la **raíz del repo**
> como cwd. **T0.1 va primero y bloquea todo lo demás**: hasta que
> `qa/scripts/api-up.sh` deje de arrancar la instancia compartida con el enriquecimiento
> habilitado (QA-005-F1), ninguna otra suite del harness — ni siquiera las que no tocan
> `enrichment` — corre en un entorno confiable.
>
> **Nota de ejecución (`develop-qa`)**: este worktree comparte el host con otras sesiones de
> otros worktrees, así que los puertos default (`3009`/`3925`/`3926`) estaban ocupados. La
> corrida real de este plan usó `QA_API_PORT=39005`, `QA_ENRICHMENT_ENABLED_PORT=39025`,
> `QA_ENRICHMENT_RATELIMIT_PORT=39026` — sin cambiar ningún default en el código (son env
> overrides ya soportados por `design.md` §D-QA4), sólo para esta sesión.

## Mapa de cobertura (definición de cada caso)

Cada fila **define** su `SC-`/`QA-` en este documento; el escenario Gherkin completo vive
en `qa-plan.md` §4. `manual` no se scaffoldea: queda como checklist humano o hallazgo
documentado.

| id | Task | AC | Capa | Estado |
|---|---|---|---|---|
| SC-005-H3 | T1.1 | AC-3 | 1 | hecho |
| SC-005-C5 | T1.1 | D6/AC-5 | 1 | hecho |
| SC-005-C6 | T1.1 | mecánica | 1 | hecho |
| SC-005-C8 | T1.1 | mecánica | 1 | hecho |
| SC-005-N1 | T1.1 | AC-7 (mecánica) | 1 | hecho |
| SC-005-C1 | T1.2 | AC-4 | 1 | hecho |
| SC-005-C2 | T1.3 | AC-5 | 1 | hecho |
| SC-005-C4 | T1.4 | mecánica | 1 | hecho |
| SC-005-C7 | T1.5 | AC-4 | 1 | hecho |
| SC-005-N4 | T1.6 | AC-9 | 1 | hecho |
| SC-005-N5 | T1.7 | AC-10 | 1 | hecho |
| SC-005-H1 | T1.8 | AC-1 | 1 | **bloqueado**, ver QA-005-F1/OQ-QA-005-1 |
| SC-005-H2 | T1.8 | AC-2 | 1 | **bloqueado** |
| SC-005-C3 | T1.8 | AC-6 | 1 | **bloqueado** |
| SC-005-N2 | T1.8 | AC-7 (completa) | 1 | **bloqueado** |
| SC-005-N3 | T1.8 | AC-8 | 1 | **bloqueado** |
| QA-005-CT-1 | T2.1 | (contrato de los 2 endpoints) | 1 | pendiente |
| QA-005-CT-2 | T2.2 | (corrección de contrato, QA-005-F2) | 1 | pendiente |
| QA-005-PERF-1 | T3.1 | NFR-3 (E2E §17) | 1 | pendiente |
| QA-005-EXP-1 | T4.1 | (exploratorio) | — | pendiente (charter escrito, ejecución humana pendiente) |

---

## Pre-requisitos

- [x] **Backend de US-005 archivado, capacidad `enriquecimiento-ia` viva.** No es una
  planificación pendiente — el código corre.
  - **Verify**: `test -d openspec/changes/archive/US-005-enriquecimiento-ia-embeddings-backend && grep -qx "archived: true" openspec/changes/archive/US-005-enriquecimiento-ia-embeddings-backend/proposal.md`
- [x] **`apps/api` compilado** (`levantarApiTemporal` arranca el build, no `ts-node`).
  - **Verify**: `test -f apps/api/dist/apps/api/src/main.js || pnpm --filter @dsm/api build`

---

## Fase 0: Higiene de entorno (QA-005-F1) y soporte del harness

- [x] T0.1 Fix de `qa/scripts/api-up.sh` — la instancia compartida nunca llama a Gemini.
  - **Pattern**: agregar `ENRICHMENT_ENABLED=false` y `ENRICHMENT_RATE_LIMIT_MAX=100000` al
    bloque `exec env ...` existente, con un comentario nuevo en el bloque de comentarios de
    cabecera (mismo estilo que `IMPORT_RATE_LIMIT_MAX`/`CHECKOUT_RATE_LIMIT_MAX` ya
    documentados ahí), `per design.md §D-QA3`. No se toca ninguna variable existente.
  - **Exit criterion**: la instancia que levanta `api:up` reporta
    `runner_state: "disabled"` en `GET /v1/admin/enrichment/status` sin importar el valor de
    `GEMINI_API_KEY` en `.env`; ningún import disparado contra esa instancia toca
    `enrichment_attempts`/`enrichment_error_code` de ningún producto.
  - **Verify**: `grep -q "ENRICHMENT_ENABLED=false" qa/scripts/api-up.sh && grep -q "ENRICHMENT_RATE_LIMIT_MAX=100000" qa/scripts/api-up.sh && bash qa/scripts/api-up.sh & sleep 3; curl -sS -m 10 "http://localhost:${QA_API_PORT:-3009}/v1/admin/enrichment/status" -H "Authorization: Bearer $(node -e "console.log(require('jsonwebtoken').sign({role:'admin',sub:'admin'},process.env.JWT_SECRET||'dev-secret',{expiresIn:'5m'}))")" | grep -q '"runner_state":"disabled"'; kill %1`

- [x] T0.2 `qa/support/enrichment-db.ts` + `.smoke.ts` — lectura de estado interno y
  adelanto de `enrichment_next_attempt_at`, excepciones angostas y documentadas.
  - **Pattern**: `prisma.product.findUniqueOrThrow({ where: { id }, select: { ... } })` para
    lectura; `prisma.product.update({ where: { id }, data: { enrichment_next_attempt_at:
    new Date() } })` para el adelanto — vía `@dsm/db`, mismo import CJS/ESM que
    `backdate-order.ts` (`import db from '@dsm/db'`), `per design.md §D-QA2/§D-QA5`. **Sólo
    lectura o adelanto de tiempo — nunca escribe `enrichment_attempts`/`enrichment_error_code`/
    `description_enriched`.**
  - **Exit criterion**: `leerEstadoEnriquecimiento(productId)` devuelve las 7 columnas
    (`description_enriched`, `description_curated`, `enrichment_done`,
    `enrichment_source_hash`, `enrichment_attempts`, `enrichment_error_code`,
    `enrichment_next_attempt_at`) sin tocar ninguna; `adelantarProximoIntento(productId)`
    dejar `enrichment_next_attempt_at <= now()` sin modificar ninguna otra columna
    (verificado leyendo la fila completa antes/después); `contarEmbeddings()` devuelve
    `SELECT count(*) FROM product_embeddings` como número.
  - **Verify**: `DATABASE_URL="${DATABASE_URL:-postgresql://dsm:dsm@localhost:55433/dsm?schema=public}" pnpm --filter @dsm/qa exec tsx support/enrichment-db.smoke.ts` (exit 0; el smoke siembra un producto real vía `admin-auth`+`builders`, lo lee, lo adelanta, y falla si cualquier otra columna cambió)
  - **Desviación registrada** (`develop-qa`, T1.3): se agregó una 4ª función de solo-lectura,
    `tieneEmbedding(productId)` (espejo de `EnrichmentRepository.hasEmbedding`), no declarada
    en `qa-plan.md` §10 — SC-005-C2 necesita afirmar "sin fila en los embeddings" para UN
    producto puntual, y `contarEmbeddings()` sólo da la verdad agregada. Misma excepción
    angosta (sólo lectura, nunca escribe).

- [x] T0.3 `qa/support/seed-enrichment.ts` + `.smoke.ts` — productos publicados pendientes
  de enriquecer, un draft, y un lote.
  - **Pattern**: `POST /v1/admin/products` + `PATCH .../{id}` a `status: "published"`, mismo
    patrón que `seed-busqueda.ts`/`seed-categorias.ts` — API real, nunca INSERT directo.
  - **Exit criterion**: `sembrarLotePendiente(n)` crea `n` productos publicados, con
    `description_raw` corta (< 20 caracteres, "descripción pobre" real) y devuelve sus ids;
    `sembrarProductoDraft()` crea uno en `status: "draft"`; todos nacen con
    `enrichment_done = false` (comportamiento por defecto de la columna, sin tocarla).
  - **Verify**: `pnpm --filter @dsm/qa exec tsx support/seed-enrichment.smoke.ts` (exit 0; siembra 3 + 1 draft, verifica los 4 ids y sus `status`)

---

## Fase 1: Suite de aceptación (Cucumber-js + Playwright `APIRequestContext`)

- [x] T1.1 `qa/acceptance/features/enriquecimiento.feature` +
  `qa/acceptance/steps/enriquecimiento.steps.ts` — SC-005-H3, C5, C6, C8, N1 (mecánica,
  contra la instancia **compartida**, sin habilitar el proveedor).
  - **Pattern**: `Característica`/`Antecedentes`/`Escenario` en español, mismo estilo que
    `pago-webhook.feature`; steps contra `APIRequestContext` apuntando a
    `QA_API_BASE_URL` (la instancia de `api-up.sh`, ya con el fix de T0.1). SC-005-N1 usa
    `leerEstadoEnriquecimiento` (T0.2) para observar el efecto del `PATCH`.
  - **Exit criterion**: SC-005-H3 verde — con un catálogo sembrado de N pendientes + M
    abandonados (vía `adelantarProximoIntento` + agotar intentos en un fixture aparte, o
    reusando el estado que T1.3 deja), `coverage.total`/`coverage.pending`/
    `coverage.abandoned` coinciden con el conteo de `qa/support/enrichment-db.ts`, y
    `coverage.coverage_ratio === coverage.embedded / coverage.total` (0 sin excepción con
    catálogo vacío — no se fuerza un catálogo vacío real, se verifica la fórmula con los
    números que devuelve el endpoint); SC-005-C5 verde — `runner_state: "disabled"` y `POST
    /runs` responde 503 `dsm:enrichment/disabled`, sin cambios en ningún producto; SC-005-C6
    verde (4 combinaciones) — 401/403 en los 2 endpoints; SC-005-C8 verde (3 combinaciones) —
    422 en los 3 cuerpos inválidos, sin cambio de `runner_state`; SC-005-N1 verde — `PATCH`
    con `description_enriched` responde 200, y `leerEstadoEnriquecimiento` confirma
    `description_curated: true` + `enrichment_done: false`; un `PATCH` posterior sólo de
    `price_ars_cents` no cambia `description_curated`.
  - **Verify**: `pnpm --filter @dsm/qa test:acceptance -- --tags "@enriquecimiento and not @blocked" --name "SC-005-(H3|C5|C6|C8|N1)"` (cubre las 5 escenarios mecánicos de esta task; los `@critical-path` de T1.2-T1.7 se verifican en sus propias tasks)
  - **Corrección registrada sobre el Verify original**: el filtro `and not @critical-path`
    proponía excluir los escenarios `@critical-path`, pero `qa-plan.md` §4 tagea `SC-005-H3` Y
    `SC-005-N1` como `@critical-path` (son mecánicos pero también críticos) — con el filtro
    original, esos 2 de los 5 quedaban excluidos por error. Se corrigió a un filtro por
    `--name` sobre los 5 IDs exactos de esta task, que sí los cubre a todos sin ambigüedad de
    tags. Confirmado con la corrida completa (`--tags "@enriquecimiento and not @blocked"`,
    sin filtro de nombre): 16/16 escenarios verdes (11 definiciones, con las 4+3 combinaciones
    de los 2 Esquemas del Escenario).

- [x] T1.2 SC-005-C1 — backoff durable + cooldown, con proveedor real inválido (AC-4).
  - **Pattern**: `Before`/`After` scoped a `@needs-provider-enabled` que levanta/apaga una
    instancia temporal (perfil B, `design.md` §D-QA4: `ENRICHMENT_ENABLED=true`,
    `GEMINI_API_KEY` heredada de `.env`, `ENRICHMENT_RATE_LIMIT_MAX=100000`,
    `ENRICHMENT_COOLDOWN_MS=5000`, puerto `QA_ENRICHMENT_ENABLED_PORT` default `3925`) vía
    `levantarApiTemporal` (`qa/support/spawn-api.ts`). Siembra 6 productos con
    `sembrarLotePendiente(6)` (≥ `ENRICHMENT_FAILURE_THRESHOLD` default 5).
  - **Exit criterion**: tras `POST /runs`, cada producto tocado tiene
    `enrichment_attempts >= 1` y `enrichment_next_attempt_at` en el futuro según la escalera
    de backoff (`leerEstadoEnriquecimiento`); tras las 5 fallas consecutivas reales, un `GET
    /status` inmediato muestra `runner_state: "cooldown"`, y un `POST /runs` disparado en ese
    momento responde 409 con `type: "dsm:enrichment/cooldown"`.
  - **Verify**: `pnpm --filter @dsm/qa test:acceptance -- --tags "@enriquecimiento and @corner and @critical-path and not @blocked" --name "SC-005-C1"`
  - **Desviación registrada sobre `design.md` §D-QA4** (perfil B): además de las 4 variables
    declaradas, se agregaron `GEMINI_MAX_RPM=15` + `GEMINI_SEARCH_MAX_RPM=0` a la instancia
    temporal. Motivo: el perfil `batch` de `GeminiHttpClient` serializa las salidas a
    `60_000/GEMINI_MAX_RPM` ms (`rate-limiter.ts`); con el default real (5 RPM ⇒ 12s entre
    llamadas), los 6 fallos reales de este escenario habrían tardado ~60-70s de reloj real,
    contra el timeout del step de Cucumber. Se realoca temporalmente TODO el free tier al
    enriquecimiento (la suma sigue en el techo real de 15, `env.validation.ts` no lo
    rechaza) — inocuo: la clave es inválida, nunca consume cuota real de todos modos. Con el
    ajuste, el escenario corre en ~21s (medido). Aplicado también a T1.3/T1.6/T1.7 (mismo
    perfil B, misma función `levantarPerfilB()`).

- [x] T1.3 SC-005-C2 — abandono completo tras agotar los intentos (AC-5).
  - **Pattern**: perfil B (mismo helper que T1.2, instancia propia — no reusar la de T1.2,
    `flakiness-detection` señal 5); 1 producto sembrado; ciclo de
    `POST /runs` → `adelantarProximoIntento(id)` (T0.2) repetido hasta
    `enrichment_attempts === ENRICHMENT_MAX_ATTEMPTS` (default 5).
  - **Exit criterion**: al final, `enrichment_done: false`, `contarEmbeddings()` no incluye
    ese producto, `description_raw` intacta, `enrichment_error_code` no nulo; `GET /status`
    lo cuenta entre `coverage.abandoned`; `GET /v1/categories/{slug}/products` (US-002, el
    endpoint público) sigue devolviéndolo.
  - **Verify**: `pnpm --filter @dsm/qa test:acceptance -- --tags "@enriquecimiento and @corner and @critical-path and not @blocked" --name "SC-005-C2"`

- [x] T1.4 SC-005-C4 — 409 run-in-progress (mecánica).
  - **Pattern**: perfil B, instancia propia; siembra un lote (≥10, para que la ventana entre
    el primer `POST` y el fin del batch sea suficiente); dos `POST /runs` disparados
    **sin espera artificial** entre sí (`Promise.all` o `await` inmediato, nunca `sleep`,
    `per flakiness-detection`).
  - **Exit criterion**: la primera respuesta es 202 con `run_id` (UUID) y `accepted: true`;
    la segunda es 409 con `type: "dsm:enrichment/run-in-progress"`.
  - **Verify**: `pnpm --filter @dsm/qa test:acceptance -- --tags "@enriquecimiento and @corner and @critical-path and not @blocked" --name "SC-005-C4"`

- [x] T1.5 SC-005-C7 — 429 con el presupuesto real (AC-4, control de superficie).
  - **Pattern**: perfil C (`design.md` §D-QA4: `ENRICHMENT_ENABLED=false`, **sin** override
    de `ENRICHMENT_RATE_LIMIT_MAX` — queda el default real 6/min, puerto
    `QA_ENRICHMENT_RATELIMIT_PORT` default `3926`); 7 `POST /runs` consecutivos contra el
    mismo IP.
  - **Exit criterion**: las primeras 6 responden 503 (`disabled` — el throttle no es lo que
    se mide acá, sólo hace falta que la ruta responda) o 202/409 según corresponda; la 7ª
    dentro de la ventana de 60s responde 429 con `Retry-After` y `RateLimit-*` presentes.
  - **Verify**: `pnpm --filter @dsm/qa test:acceptance -- --tags "@enriquecimiento and @corner and not @blocked" --name "SC-005-C7"`

- [x] T1.6 SC-005-N4 — sin fuga del secreto, incluso fallando de verdad (AC-9).
  - **Pattern**: perfil B, instancia propia; dispara una corrida real (falla contra la
    clave inválida configurada) y agrega sobre **todo** lo devuelto por `GET /status` y
    `POST /runs` — la variante negativa que `security-standards.md §5` pide poder demostrar.
  - **Exit criterion**: ninguna respuesta (agregada como texto) contiene el valor literal de
    `GEMINI_API_KEY` configurado en el entorno de la instancia temporal, ni el patrón
    `key=`; `last_error_code` matchea `^dsm:enrichment/`.
  - **Verify**: `pnpm --filter @dsm/qa test:acceptance -- --tags "@enriquecimiento and @negative and @critical-path and not @blocked" --name "SC-005-N4"`

- [x] T1.7 SC-005-N5 — nunca publica, éxito o falla (AC-10).
  - **Pattern**: perfil B, instancia propia; 1 producto sembrado en `draft`
    (`sembrarProductoDraft`, T0.3); dispara una corrida que lo toca.
  - **Exit criterion**: `GET /v1/admin/products/{id}` (o `leerEstadoEnriquecimiento` + una
    lectura del `status` vía la API admin existente de `catalogo`) muestra `status: "draft"`
    idéntico antes y después de la corrida, sin importar si esa corrida terminó en éxito o
    falla para ese producto.
  - **Verify**: `pnpm --filter @dsm/qa test:acceptance -- --tags "@enriquecimiento and @negative and @critical-path and not @blocked" --name "SC-005-N5"`

- [x] T1.8 SC-005-H1, H2, C3, N2, N3 — declarar el bloqueo, no simularlo.
  - **Exit criterion**: `enriquecimiento.feature` contiene los 5 escenarios tageados
    `@blocked` con el comentario que explica por qué cada uno necesita una respuesta
    **exitosa** real del proveedor (`design.md` §D-QA1); **no** se escribe ningún step que
    los implemente con un doble no autorizado.
  - **Verify**: `for sc in SC-005-H1 SC-005-H2 SC-005-C3 SC-005-N2 SC-005-N3; do grep -q "$sc" qa/acceptance/features/enriquecimiento.feature || { echo "falta $sc"; exit 1; }; done && pnpm --filter @dsm/qa test:acceptance -- --tags "@enriquecimiento and not @blocked" 2>&1 | grep -qvE "SC-005-(H1|H2|C3|N2|N3)"` (con el tag de exclusión, ninguno de los 5 debe aparecer en la salida de la corrida — ni como pasado ni como fallido, sólo ausente)

---

## Fase 2: Contract testing

- [ ] T2.1 `qa/contract/enrichment.contract.ts` — QA-005-CT-1.
  - **Pattern**: script `tsx` standalone con `fetch`, mismo estilo que
    `search.contract.ts`/`pago-webhook.contract.ts` (sin jest, sin `supertest`). Registrar
    `test:contract:enrichment` en `qa/package.json`, sin tocar los scripts `test:contract*`
    existentes.
  - **Exit criterion**: valida forma de respuesta + catálogo RFC 7807 de los 2 endpoints
    contra `openspec/specs/enriquecimiento-ia/contracts/openapi.yaml` (raíz viva) — ver
    `qa-plan.md` §6 para el detalle completo de casos.
  - **Verify**: `QA_API_BASE_URL=http://localhost:3009 ADMIN_BOOTSTRAP_TOKEN=<mismo valor de la API> pnpm --filter @dsm/qa test:contract:enrichment`

- [ ] T2.2 Corrección de contrato incompleto (QA-005-F2, mitad segura) — QA-005-CT-2.
  - **Pattern**: edición documental de `openspec/specs/catalogo/contracts/openapi.yaml`,
    schema `UpdateProduct` — agregar la propiedad, no tocar `Product` (lectura).
  - **Exit criterion**: `UpdateProduct` declara
    `description_enriched: { type: string, nullable: true }`; Spectral sigue en 0 errores;
    ningún otro schema de ese archivo cambia.
  - **Verify**: `npx @stoplight/spectral-cli lint openspec/specs/catalogo/contracts/openapi.yaml && python3 -c "
import yaml
d = yaml.safe_load(open('openspec/specs/catalogo/contracts/openapi.yaml'))
props = d['components']['schemas']['UpdateProduct']['properties']
assert 'description_enriched' in props, 'falta description_enriched en UpdateProduct'
assert props['description_enriched'].get('nullable') is True
print('ok')"`

---

## Fase 3: Performance (k6)

- [ ] T3.1 `qa/performance/storefront-under-enrichment.js` — QA-005-PERF-1.
  - **Pattern**: `setup()` levanta admin token + siembra ~150 productos frescos
    (`sembrarLotePendiente`, adaptado para volumen — o llamado 3× con lotes de 50) contra una
    instancia de perfil B ya arriba (documentar en el script que requiere
    `qa/scripts/api-up.sh` con `ENRICHMENT_ENABLED=true` override manual antes de correr
    este script — k6 no orquesta el spawn de la API), dispara `POST /admin/enrichment/runs`;
    VUs alternan `list_products`/`storefront_product` contra el pool de `seed:load` —
    `per k6-load-scaffolding` + `design.md §D-QA8`. **Reusa** `list_products` y
    `storefront_product` de `qa/performance/lib/thresholds.js`, no declara un threshold
    nuevo.
  - **Exit criterion**: `http_req_duration{endpoint:list_products}` y
    `{endpoint:storefront_product}` cumplen `p(95)<300`/`p(99)<800` (thresholds existentes),
    `checks: rate>0.99`, `http_req_failed: rate<0.01`; el script hace al menos un `GET
    /admin/enrichment/status` de control durante la ventana y **falla** si
    `runner_state !== "running"` en esa lectura (la corrida terminó antes de medir nada).
  - **Verify**: `QA_API_BASE_URL=http://localhost:3925 k6 run qa/performance/storefront-under-enrichment.js --summary-trend-stats="p(95)"`

---

## Fase 4: Exploratorio y cierre

- [ ] T4.1 Charter `qa/exploratory/us-005-enriquecimiento-ia.md` — QA-005-EXP-1 (manual).
  - **Exit criterion**: documenta los 3 charters de `qa-plan.md` §11 con su tiempo asignado,
    el riesgo que exploran y dónde se registran los hallazgos. Queda como checklist humano;
    `/develop-qa` no lo scaffoldea.
  - **Verify**: `test -f qa/exploratory/us-005-enriquecimiento-ia.md && grep -c "^## Charter" qa/exploratory/us-005-enriquecimiento-ia.md | grep -qx 3`

- [ ] T4.2 Trazabilidad AC → escenario, sin huecos.
  - **Exit criterion**: los 10 AC de US-005 aparecen en la matriz de `qa-plan.md` §3 con al
    menos un escenario (ejecutable, mecánico-parcial, o `@blocked` explícito); cada `SC-`/
    `QA-` de la matriz existe como escenario Gherkin, contract test, script k6 o charter.
  - **Verify**: `python3 -c "
import re, sys, pathlib
plan = pathlib.Path('openspec/changes/US-005-enriquecimiento-ia-embeddings-qa/qa-plan.md').read_text()
acs = set(re.findall(r'AC-(\d+)', pathlib.Path('docs/user-stories/US-005-enriquecimiento-ia-embeddings.md').read_text()))
faltan = [a for a in acs if f'AC-{a} ' not in plan and f'AC-{a},' not in plan and f'AC-{a})' not in plan and f'AC-{a}\`' not in plan and f'AC-{a}.' not in plan]
scs = set(re.findall(r'SC-005-[A-Z]\d', plan))
sys.exit(0 if not faltan and len(scs) >= 16 else 1)"`

---

## Verification (suite-level)

- [ ] Suite de aceptación completa verde (excepto lo bloqueado):
  `pnpm --filter @dsm/qa test:acceptance -- --tags "@enriquecimiento and not @blocked"` —
  11/11 escenarios ejecutables verdes (incluyendo las 4+3 combinaciones de los dos Esquemas
  del Escenario).
- [ ] Contract tests verdes: `pnpm --filter @dsm/qa test:contract:enrichment` — todos los
  casos declarados en `qa-plan.md` §6.
- [ ] Contrato de `catalogo` corregido y lintado: `npx @stoplight/spectral-cli lint openspec/specs/catalogo/contracts/openapi.yaml`
- [ ] Carga dentro del presupuesto existente:
  `k6 run qa/performance/storefront-under-enrichment.js` — thresholds `list_products` y
  `storefront_product` en verde, `runner_state: running` confirmado durante la ventana.
- [ ] **Sin regresión en las suites QA ya existentes** (el fix de T0.1 es la superficie de
  mayor riesgo de romper algo ajeno):
  `pnpm --filter @dsm/qa test:acceptance -- --tags "not @enriquecimiento and not @blocked"`
  — mismo conteo de escenarios verdes que antes del fix (ninguna otra suite dependía de
  `ENRICHMENT_ENABLED=true` en la instancia compartida).
- [ ] El charter manual ejecutado y sus hallazgos registrados (humano) — charter ESCRITO
  (T4.1); ejecución queda para el humano.

## Trazabilidad AC → escenario

| AC de US-005 | Escenarios QA-owned | Estado |
|---|---|---|
| AC-1 enriquecer + generar embedding | `SC-005-H1` | **bloqueado** |
| AC-2 elegible para búsqueda semántica | `SC-005-H2` | **bloqueado** |
| AC-3 cobertura del catálogo medible | `SC-005-H3` | ejecutable (mecanismo; el ≥90% es operación) |
| AC-4 reintento con backoff, respeta rate-limit | `SC-005-C1`, `SC-005-C7` | ejecutable (backoff durable + cooldown + 429 reales) |
| AC-5 fallo persistente degrada con gracia | `SC-005-C2` | ejecutable (completo) |
| AC-6 re-enriquecer sólo si cambió | `SC-005-C3` | **bloqueado** |
| AC-7 no sobreescribir descripción curada | `SC-005-N1`, `SC-005-N2` | ejecutable (mecánica) / **bloqueado** (completa) |
| AC-8 versionado de embeddings | `SC-005-N3` | **bloqueado** |
| AC-9 sin secretos en logs/respuestas | `SC-005-N4` | ejecutable |
| AC-10 no publica productos | `SC-005-N5` | ejecutable |
