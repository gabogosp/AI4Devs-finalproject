# QA Plan — US-021 Retención y anonimización de PII de órdenes (Backend)

> **Ticket**: US-021 — Retención y anonimización de los datos personales de las órdenes (Ley 25.326)
> **Author**: qa-engineer agent (assisted by @gosp)
> **Date**: 2026-09-05
> **Status**: Executed — 9/9 TC automatizados verde (`/develop-qa`, PR #41 ya
> mergeado); QA-021-CT-1 verde (11/11 casos); QA-021-CT-2 gap reportado (no
> existe contract test de US-012 para cerrar); TC-021-004b `blocked` y
> TC-021-007 `manual` quedan como estaban (§4, §5).
> **Affected platform(s)**: backend (los dos endpoints admin + el runner de arranque de
> `openspec/changes/US-021-retencion-datos-ordenes-backend/`). Sin superficie frontend
> propia todavía — ver §0 "Corrección de contexto" y §1 "Gap FE".
> **Service tier(s)**: 2 (`docs/services/dsm-ecommerce/runbook.md` frontmatter — única
> fuente de tier que existe en este repo; no hay `service-catalog.yaml`. Mismo tier que
> resolvió `deployment-plan.md` de este mismo change, §Service tier — no se re-deriva).
> **Companion files**: `proposal.md`, `tasks.md`, `design.md`, `deployment-plan.md`
> (Mode A: este `qa-plan.md` se agrega al change de backend ya existente; no hay change
> de QA dedicado — ver §Mode A abajo)

---

## 0. Mode A — por qué este plan vive acá, y una corrección de contexto necesaria

**Mode A** (inline, no Mode B): existe un único change code-generating para US-021
(`US-021-retencion-datos-ordenes-backend`, `status: draft` en el índice, PR #25 abierto,
16 tasks planificadas, 0 ejecutadas). No existe `US-021-retencion-datos-ordenes-frontend-web`
en `openspec/changes/` ni en el índice — la FE de esta US (acción "anonimizar datos del
comprador" + Badge + confirmación de dos pasos, US §7/§8) **no tiene change propio
todavía**. Este plan sigue exactamente el precedente de
`openspec/changes/archive/US-008-checkout-guest-backend/qa-plan.md` (formato, capas,
frontmatter de test-case) y se agrega **dentro** del change de backend, per
`qa-three-layer-regression` (Layer 1 vive en `.../{slug}-backend/qa-plan.md`).

**Corrección de contexto (verificada, no asumida)**: el encargo de esta tarea afirma que
"US-012's panel doesn't have a backend change yet either". Eso **ya no es así** en el
`main` de este worktree: `openspec/changes/US-012-panel-ordenes-dueno-backend` (22/22
tasks, `status: in-review`) y `-frontend-web` (21/26 tasks, `status: in-progress`, PR #22
**mergeado** — commit `1a90fe7`) existen y su código real está en `apps/api/src/orders/`
(`OrdersController`, `GET /v1/admin/orders`, `GET /v1/admin/orders/:id`) y en `apps/web`
(panel de órdenes del dueño ya renderiza). Verificado leyendo el código, no el `design.md`
de este change (que sí sigue afirmando lo contrario — quedó desactualizado respecto al
`main` real, probablemente porque se escribió antes de que se regenerara/mergeara
US-012-backend el mismo día). Esto **no invalida** el `design.md`/`tasks.md` de este
change (su alcance —dos endpoints admin + runner— sigue siendo correcto y no depende de
US-012), pero sí cambia lo que este plan puede probar realmente: **hay un GET real de
orden hoy**, no cero superficie de lectura. Lo que sigue siendo cierto, verificado
directamente en `apps/api/src/orders/dto/order.dto.ts`, es que **ese GET real no expone
`anonymized_at`/`anonymization_reason`** — ver el gap concreto en §1.3.

Este plan por lo tanto:
- Usa el **GET real** de US-012-backend (`GET /v1/admin/orders`, `GET /v1/admin/orders/:id`)
  donde sirve (AC-2, AC-5, AC-6) — no lo trata como inexistente.
- Sigue tratando el **Badge/indicación visual de "anonimizado"** en el panel (FE, US §8)
  como no construido — verificado (`grep -rli anonymiz apps/web/src` → vacío) — y lo
  escopea a nivel API únicamente, tal como pedía el encargo original, sólo que el motivo
  correcto no es "no hay panel" sino "el panel existe pero no conoce todavía el concepto
  de anonimización" (ver §1 Gap FE).

---

## 1. Perfil de riesgo

- **Módulo `checkout/` extendido (`OrdersRetentionController/Service/Runner`)**: ALTO —
  primera superficie del proyecto que **destruye PII de forma irreversible por diseño**
  (US §9). Reusa `AdminGuard`/`AuthThrottlerGuard` ya probados (AC-9), pero el efecto de
  un bug es no recuperable — no hay rollback de datos posible (`deployment-plan.md` §8,
  punto 4).
- **Invariante de negocio central (AC-2)**: las métricas del dueño (US-016, sin
  implementar todavía — verificado: no hay `openspec/changes/US-016-*`) no deben cambiar.
  Sin un endpoint de métricas real contra el cual medir, la única superficie disponible
  hoy para observar el agregado es `GET /v1/admin/orders` (list, US-012) — se usa como
  proxy verificado, no se inventa un endpoint de métricas que no existe.
- **Stateful**: sí — Postgres real (`orders`, `order_items`), sin motor nuevo.
- **Dependencias externas**: ninguna nueva.
- **Performance-sensitive**: NO en el sentido de `qa-backend-standards.md` §13 — ver §8
  (Performance) para el razonamiento explícito de por qué no se arma una suite k6 completa.
- **Accesibilidad**: N/A — no hay superficie UI en este change (backend puro).

Journeys críticas identificadas:
1. El barrido mensual (oportunista al arrancar, o bajo demanda) anonimiza toda orden
   vencida sin tocar ninguna otra ni perder ítems/importes/consentimiento (AC-1/2/6/7).
2. El dueño responde a un pedido de supresión anonimizando una orden puntual, con
   confirmación (AC-3/4).
3. Nadie que no sea el dueño autenticado puede accionar la supresión (AC-9), y accionarla
   dos veces no produce error ni un segundo efecto (AC-8).

### 1.1 Ownership — capas dev-owned (coverage-awareness, no se re-planifican acá)

Per `qa-backend-standards.md` §2.1 y la nota de la skill `qa-three-layer-regression`: unit,
integration y smoke son dev-owned y **ya están planificados** en `tasks.md` de este mismo
change — no se duplican acá:

- Unit/integration: T0.1–T4.4 (repositorio, servicio, controller, runner, DTOs, config).
- Invariantes cross-AC dev-owned: T5.1 (AC-8 idempotencia), T5.2 (AC-9 auth, e2e-nest),
  T5.3 (AC-2 agregados, integration directa contra Postgres), T5.4 (AC-6 conteo de filas),
  T5.5 (AC-7 consentimiento), T5.6 (AC-8 irreversibilidad).
- Contract staging (T6.1): valida los dos yaml del change con Spectral — smoke de
  contrato, dev-owned; el contract test QA-owned de §5 es un nivel distinto (valida la
  API **corriendo de verdad**, no el yaml estático).

Este plan (`qa-plan.md`) cubre exclusivamente lo QA-owned: aceptación BDD (§4), contract
contra servidor real (§5), regresión persistente por categoría (§4, tags), exploratorio
(§9). Donde una capa dev-owned ya prueba el mismo invariante (p.ej. AC-2/AC-6/AC-7 vía
Postgres directo en T5.3–T5.5), el escenario QA-owned equivalente usa una **superficie
distinta** (la API real, incluido el GET de US-012) — no es duplicación: prueba el
contrato observable por un cliente HTTP, no la implementación interna.

### 1.2 Gap FE — explícito, no rellenado en silencio

`US-021-{slug}-frontend-web` **no existe** como change. La US §7/§8 pide: acción
"anonimizar datos del comprador" en el panel, confirmación de dos pasos (destructiva),
Badge en órdenes ya anonimizadas. Nada de esto tiene tarea ni código hoy —
verificado (`grep -rli anonymiz apps/web/src` sin resultados).

**Consecuencia para este plan**: todo escenario que en la US está redactado como "el
dueño lo ve en el panel" (AC-3 "ve una confirmación", AC-5 completo) se escopea acá a
**nivel API únicamente** — se llama al endpoint admin real y se lee el GET real de
US-012-backend, nunca se simula una UI que no existe. Cuando exista
`/plan-frontend-web-ticket US-021` (o el change que materialice esa FE), ese plan de QA
de frontend/E2E debe:
1. Cubrir el Badge/indicación visual sobre datos ya devueltos por la API (una vez que el
   gap de §1.3 se resuelva).
2. Cubrir la confirmación de dos pasos como interacción de UI (Playwright, Layer 2/3) —
   ningún test de este plan la sustituye.

### 1.3 Gap de contrato — el GET real de US-012 no expone auditoría de anonimización

Verificado leyendo `apps/api/src/orders/dto/order.dto.ts`: `AdminOrderSummaryDto` y
`AdminOrderDetailDto` (que alimentan `GET /v1/admin/orders` y `GET /v1/admin/orders/:id`,
ambos reales y mergeados) **no incluyen** `anonymized_at` ni `anonymization_reason`, y
tampoco incluyen los tres campos de consentimiento (`consent_accepted`,
`consent_accepted_at`, `consent_terms_version`). Esto no está cubierto por ninguna task de
`US-021-...-backend/tasks.md` (su traceability matrix mapea AC-5 sólo a "T1.2 (nota de
diseño), Open question a US-012") ni de `US-012-...-backend/tasks.md` (escrito antes de
que la anonimización existiera como concepto).

**Efecto concreto sobre AC-4**: "consta que fue anonimizada y en qué momento... se
distingue el motivo" es 100% verificable **inmediatamente después** de la acción (la
respuesta de `POST .../anonymize` sí trae `anonymized_at`/`anonymization_reason`, T4.3),
pero **no** es verificable "consultando la orden" más tarde por el único GET real que
existe — que es la lectura natural de la palabra "consulta" en el AC. §4 (SC-021-H4) prueba
la mitad disponible hoy y deja explícito el hueco con un test marcado `execution_mode:
blocked` (§4, tabla de test cases) en vez de fingir cobertura completa.

**Recomendación** (no se resuelve en este plan, es una decisión de código de otro
change): agregar `anonymized_at`/`anonymization_reason` a `AdminOrderSummaryDto`/
`AdminOrderDetailDto` — es un cambio de 2 campos, aditivo, en un DTO que ya existe. Encaja
mejor como task de "fast-follow" del propio `US-021-...-backend` (antes de mergear PR #25)
que como reapertura de US-012. Ver también `design.md` §Open questions de este mismo
change, que ya señala la mitad de este hueco (sin nombrar el DTO exacto).

---

## 2. Matriz de test (QA-owned)

| Capa | Requerida | Herramienta | Qué cubre |
|---|---|---|---|
| Unit / Integration BE | Dev-owned (TDD) | Jest + Postgres real | Repositorio, servicio, controller, runner, eventos — **no planificado acá**, ver §1.1 |
| **Acceptance (BDD)** | ✅ Sí | Cucumber-js + Playwright `request` (`qa/acceptance/`) — mismo stack que `carrito.feature`/`checkout.feature` | AC-1..AC-9 (Layer 1, API-level) |
| **Contract** | ✅ Sí | Script standalone contra servidor real (mismo patrón que `qa/contract/search.contract.ts`) | Los dos endpoints nuevos + el GET de US-012 usado como proxy de AC-2/5, vs OpenAPI |
| **Performance (k6)** | ❌ No (justificado) | — | Ver §8 — sin NFR cuantificado, volumen bajo, endpoints admin de baja frecuencia |
| **E2E cross-stack (Playwright, Layer 3)** | ❌ No todavía | — | Bloqueado por el Gap FE de §1.2 — no se inventa un flujo de UI que no existe |
| **Exploratory** | ✅ Sí | Charters (`qa/exploratory/charters.md`) | Carrera barrido/pedido, timezone del cutoff, PII residual en logs |

---

## 3. Mapeo AC → escenario (las 9 AC, todas cubiertas al menos una vez)

| AC | Escenario(s) | Capa |
|---|---|---|
| AC-1 | SC-021-H1 | Acceptance |
| AC-2 | SC-021-H2 | Acceptance (proxy vía `GET /v1/admin/orders`, US-012) |
| AC-3 | SC-021-H3 | Acceptance |
| AC-4 | SC-021-H4 (parcial — ver §1.3) | Acceptance + gap documentado |
| AC-5 | SC-021-A1 | Acceptance (proxy vía `GET /v1/admin/orders/:id`, US-012) |
| AC-6 | SC-021-N1 | Acceptance (regresión) |
| AC-7 | SC-021-N2 (nota de alcance — ver texto) | Acceptance (parcial) + dev-owned (T5.5) |
| AC-8 | SC-021-N3, SC-021-N4 | Acceptance (regresión) |
| AC-9 | SC-021-N5 | Acceptance (regresión) |

---

## 4. Escenarios BDD (Gherkin)

```gherkin
# language: es
@retencion-ordenes @us-021
Característica: Retención y anonimización de los datos personales de las órdenes (US-021)
  Como responsable del tratamiento de datos personales de DSM (el dueño)
  quiero que los datos del comprador se anonimicen al cumplirse el plazo o a pedido
  para cumplir la Ley 25.326 sin perder el historial comercial

  Antecedentes:
    Dado un catálogo sembrado con productos disponibles
    Y un token admin real (AdminGuard)

  # ─── HAPPY PATH ───

  @happy @critical-path
  Escenario: SC-021-H1 — El barrido anonimiza toda orden vencida y ninguna otra (AC-1)
    Dado una orden con más de ORDER_RETENTION_MONTHS de antigüedad, sin anonimizar
    Y una segunda orden reciente, sin anonimizar
    Cuando se dispara "POST /v1/admin/orders/retention-sweep" con el token admin
    Entonces la respuesta trae anonymized_count igual a 1
    Y la orden vencida tiene buyer_name/buyer_email/buyer_phone reemplazados por los
      valores placeholder
    Y la orden reciente conserva sus datos de comprador intactos
    Y ambas órdenes siguen existiendo con su status y su total_ars_cents sin cambios

  @happy
  Escenario: SC-021-H2 — El barrido no altera los agregados comerciales (AC-2)
    Dado un conjunto de 3 órdenes vencidas con ítems y total_ars_cents conocidos
    Y consultadas por "GET /v1/admin/orders" antes del barrido
    Cuando se anonimizan las 3 mediante el barrido
    Y se vuelve a consultar "GET /v1/admin/orders"
    Entonces la suma de total_ars_cents de las 3 órdenes es idéntica antes y después
    Y la cantidad de órdenes devueltas por status es idéntica antes y después
    Y para cada orden, "GET /v1/admin/orders/:id" devuelve los mismos items,
      quantity y unit_price_ars_cents que antes de anonimizar

  @happy @critical-path
  Escenario: SC-021-H3 — Anonimización a pedido responde de inmediato con confirmación (AC-3)
    Dado una orden existente, sin anonimizar
    Cuando el dueño dispara "POST /v1/admin/orders/:id/anonymize" con su token admin
    Entonces la respuesta es 200 con order_id, anonymized_at y anonymization_reason
      igual a "requested"
    Y anonymized_at está dentro de los 5 segundos del momento del pedido

  @happy
  Escenario: SC-021-H4 — La anonimización queda registrada y distingue el motivo (AC-4)
    Dado una orden anonimizada por plazo cumplido
    Y una segunda orden anonimizada a pedido
    Cuando se re-consulta cada una llamando de nuevo a su endpoint de anonimización
      (idempotente — no produce un segundo efecto, ver AC-8)
    Entonces la primera trae anonymization_reason "retention_policy"
    Y la segunda trae anonymization_reason "requested"
    # NOTA DE ALCANCE (§1.3 del qa-plan): esta es la ÚNICA superficie hoy que expone el
    # motivo — "GET /v1/admin/orders/:id" (US-012) no incluye anonymized_at/
    # anonymization_reason en su DTO. La lectura más natural de AC-4 ("se consulta esa
    # orden") apunta a ESE GET, no a re-llamar al endpoint de anonimizar. Ver test case
    # TC-021-004b (execution_mode: blocked) en la tabla de abajo.

  # ─── ALTERNATIVE PATH ───

  @alternative
  Escenario: SC-021-A1 — Una orden anonimizada sigue siendo operable para el dueño (AC-5)
    Dado una orden anonimizada
    Cuando el dueño la consulta con "GET /v1/admin/orders/:id"
    Entonces ve sus items, quantity, unit_price_ars_cents, status y created_at sin cambios
    Y buyer_name/buyer_email/buyer_phone muestran los valores placeholder de anonimización,
      no los datos originales del comprador
    # NOTA DE ALCANCE (§1.3): el AC pide una "indicación" de que fueron anonimizados —
    # hoy el placeholder de buyer_name ("Comprador anonimizado") cumple esa función de
    # forma indirecta; un Badge explícito requiere el campo anonymized_at en el DTO
    # (gap documentado) + FE (gap documentado en §1.2). Este escenario prueba lo que la
    # API entrega hoy, no inventa un Badge que no existe.

  # ─── NEGATIVE SPACE (regresión — correr en cada release que toque este módulo) ───

  @negative @regression
  Escenario: SC-021-N1 — Ninguna orden ni ítem se borra al anonimizar (AC-6)
    Dado 2 órdenes en estado activo (una vencida, una no) consultables por
      "GET /v1/admin/orders"
    Y el total de órdenes en ese listado antes del barrido
    Cuando corre el barrido de retención
    Entonces el total de órdenes en "GET /v1/admin/orders" es idéntico al de antes
    Y "GET /v1/admin/orders/:id" de la orden vencida sigue devolviendo sus items
      (ningún item desapareció)

  @negative @regression
  Escenario: SC-021-N2 — El registro de consentimiento no se destruye (AC-7)
    Dado una orden con consentimiento aceptado y una versión de términos conocida
    Cuando se anonimiza esa orden
    Entonces el registro de consentimiento sigue existiendo con el mismo valor y la
      misma versión de términos
    # NOTA DE ALCANCE (§1.3): sin superficie API que exponga consent_accepted/
    # consent_accepted_at/consent_terms_version (ni el GET de US-012 los incluye), este
    # escenario es hoy dev-owned exclusivamente (T5.5, integration contra Postgres
    # real). Se documenta acá como test case `execution_mode: manual` (verificación por
    # inspección de la migración + la suite dev, no una automatización QA duplicada) —
    # no se inventa un endpoint para poder automatizarlo.

  @negative @regression
  Escenario: SC-021-N3 — Anonimizar dos veces no produce error ni un segundo efecto (AC-8)
    Dado una orden ya anonimizada
    Cuando se dispara de nuevo "POST /v1/admin/orders/:id/anonymize" sobre la misma orden
    Entonces la respuesta es 200 con el mismo anonymized_at que la primera vez
    Y no se produce ningún error

  @negative @regression
  Escenario: SC-021-N4 — El barrido corrido dos veces con el mismo corte no re-anonimiza nada (AC-8)
    Dado que el barrido ya corrió una vez y anonimizó N órdenes
    Cuando se dispara "POST /v1/admin/orders/retention-sweep" de nuevo, sin nuevas
      órdenes vencidas
    Entonces la respuesta trae anonymized_count igual a 0
    Y no se produce ningún error

  @negative @regression @critical-path
  Escenario Outline: SC-021-N5 — Sólo el dueño autenticado puede anonimizar a pedido (AC-9)
    Dado una orden existente, sin anonimizar
    Cuando alguien intenta "POST /v1/admin/orders/:id/anonymize" con "<credencial>"
    Entonces la respuesta es "<status>"
    Y la orden no cambia (buyer_name sigue siendo el original tras el intento)

    Ejemplos:
      | credencial                      | status |
      | sin Authorization               | 401    |
      | JWT expirado                    | 401    |
      | JWT válido con role distinto de admin | 403 |
```

**Tooling**: Cucumber-js + Playwright `request` fixture (mismo stack que
`qa/acceptance/steps/world.ts` — reusa `adminAuth()`/`adminAuthWithSource()` de
`qa/support/admin-auth.ts`, sin fallback minteado en modo estricto CI).

**Location**: `qa/acceptance/features/retencion-ordenes.feature` +
`qa/acceptance/steps/retencion-ordenes.steps.ts`.

**Reuses**: `qa/support/admin-auth.ts` (token admin real), `qa/support/api.ts` (helper
HTTP), builder nuevo `qa/support/seed-orders-retention.ts` (§7).

#### TC-021 — Test cases (frontmatter, per `qa-three-layer-regression`)

```yaml
---
id: TC-021-001
scenario: SC-021-H1
execution_mode: automated
test_layer: 1
target_tooling: Postman
gherkin_scenario: SC-021-H1 — El barrido anonimiza toda orden vencida y ninguna otra
---
```
```yaml
---
id: TC-021-002
scenario: SC-021-H2
execution_mode: automated
test_layer: 1
target_tooling: Postman
gherkin_scenario: SC-021-H2 — El barrido no altera los agregados comerciales
---
```
```yaml
---
id: TC-021-003
scenario: SC-021-H3
execution_mode: automated
test_layer: 1
target_tooling: Postman
gherkin_scenario: SC-021-H3 — Anonimización a pedido responde de inmediato con confirmación
---
```
```yaml
---
id: TC-021-004a
scenario: SC-021-H4
execution_mode: automated
test_layer: 1
target_tooling: Postman
gherkin_scenario: SC-021-H4 — La anonimización queda registrada y distingue el motivo (mitad disponible — vía re-llamada idempotente al endpoint de anonimizar)
---
```
```yaml
---
id: TC-021-004b
scenario: SC-021-H4
execution_mode: blocked
test_layer: 1
target_tooling: Postman
gherkin_scenario: SC-021-H4 — La anonimización queda registrada y distingue el motivo (mitad bloqueada — "GET /v1/admin/orders/:id" no expone anonymized_at/anonymization_reason; ver gap §1.3. Bloqueado por: fast-follow de DTO en US-021-backend o US-012-backend, lo que llegue primero)
---
```
```yaml
---
id: TC-021-005
scenario: SC-021-A1
execution_mode: automated
test_layer: 1
target_tooling: Postman
gherkin_scenario: SC-021-A1 — Una orden anonimizada sigue siendo operable para el dueño
---
```
```yaml
---
id: TC-021-006
scenario: SC-021-N1
execution_mode: automated
test_layer: 1
target_tooling: Postman
gherkin_scenario: SC-021-N1 — Ninguna orden ni ítem se borra al anonimizar
---
```
```yaml
---
id: TC-021-007
scenario: SC-021-N2
execution_mode: manual
test_layer: 1
target_tooling: Postman
gherkin_scenario: SC-021-N2 — El registro de consentimiento no se destruye (sin superficie API — verificación por inspección cruzada con la suite dev T5.5, ver justificación en §1.3/§4)
---
```
```yaml
---
id: TC-021-008
scenario: SC-021-N3
execution_mode: automated
test_layer: 1
target_tooling: Postman
gherkin_scenario: SC-021-N3 — Anonimizar dos veces no produce error ni un segundo efecto
---
```
```yaml
---
id: TC-021-009
scenario: SC-021-N4
execution_mode: automated
test_layer: 1
target_tooling: Postman
gherkin_scenario: SC-021-N4 — El barrido corrido dos veces con el mismo corte no re-anonimiza nada
---
```
```yaml
---
id: TC-021-010
scenario: SC-021-N5
execution_mode: automated
test_layer: 1
target_tooling: Postman
gherkin_scenario: SC-021-N5 — Sólo el dueño autenticado puede anonimizar a pedido
---
```

> **Nota sobre `target_tooling`**: se declara `Postman` (no `godog`) porque este backend
> es NestJS/TypeScript, no Go — `qa-backend-standards.md` §21.2 fija godog como mandatorio
> para **servicios Go**; este repo sigue el precedente ya establecido en
> `US-008-checkout-guest-backend/qa-plan.md` (Cucumber-js + supertest/Playwright
> `request`). El catálogo cerrado de `target_tooling` de la skill es `K6 | Playwright |
> Postman | Pact | godog | Vitest | compose-test | Maestro` — no incluye "Cucumber-js"
> como valor propio, así que se usa `Postman` como la etiqueta más cercana a "aserciones
> HTTP contra un contrato de API", ya que la suite es ejecutable igual como colección
> Postman/Newman si el proyecto lo prefiere (mismo patrón que
> `qa/functional/catalogo-admin.postman_collection.json`). La herramienta real que
> `qa/acceptance/steps/retencion-ordenes.steps.ts` usa es Cucumber-js + Playwright
> `request` — se documenta acá la discrepancia para que quede trazable, en vez de
> inventar un noveno valor fuera del catálogo de la skill.

---

#### Estado de ejecución (actualizado por `/develop-qa`, rama `feat/US-021-retencion-datos-ordenes-qa`)

**Ejecutado, 9/9 verde** — el backend mergeó a `main` como PR #41 (commit
`c9bb229`, 30/30 tasks) y este mismo `/develop-qa` corrió la suite completa
contra la implementación REAL (no un mock), con el build de `@dsm/api` y la
migración de `packages/db` aplicados en este worktree. Las 9 TC marcadas
`execution_mode: automated` (TC-021-001, 002, 003, 004a, 005, 006, 008, 009,
010 — escenarios SC-021-H1/H2/H3/H4/A1/N1/N3/N4/N5) están **cerradas,
pasando**, confirmado con **3 corridas consecutivas** sin flakiness
(`qa/acceptance/features/retencion-ordenes.feature`, tag `@retencion-ordenes`,
11 escenarios Gherkin incluido `@deferred` de TC-021-007 que no corre):

```
QA_API_BASE_URL=http://localhost:3009 pnpm --filter @dsm/qa test:acceptance -- --tags "@retencion-ordenes"
→ 11 scenarios (11 passed), 74 steps (74 passed)
```

Artefactos reales (no stubs):
- `qa/acceptance/features/retencion-ordenes.feature` — los 9 escenarios Gherkin
  (`@retencion-ordenes`), sin cambios respecto a §4.
- `qa/acceptance/steps/retencion-ordenes.steps.ts` — step defs reales contra
  `POST /v1/admin/orders/:id/anonymize`, `POST /v1/admin/orders/retention-sweep`,
  `GET /v1/admin/orders`, `GET /v1/admin/orders/:id`. Corregidos 3 bugs de test
  detectados corriendo por primera vez contra la implementación real (ninguno
  es defecto del backend — ver detalle abajo):
  1. Colisión de step: `Given('un catálogo sembrado con productos disponibles')`
     estaba registrado dos veces (acá y en `pago-manual.steps.ts`, mismo texto
     literal) — Cucumber carga TODO el glob de `acceptance/steps/**` junto, así
     que era "Multiple step definitions match" en toda corrida completa de la
     suite. Se eliminó el duplicado de este archivo (el de `pago-manual.steps.ts`
     ya era un no-op compartible).
  2. `dispararAnonimizacion(w, id, token)` tiene `token = w.token` como default
     — en JS eso se activa con `undefined`, que es exactamente lo que
     `credencialPara('sin Authorization')` devolvía para decir "sin header".
     SC-021-N5 pasaba por el wrapper y terminaba re-sustituyendo el token admin
     real (200 en vez de 401). Se cambió esa llamada a `llamarComoAdmin`
     directo, que sí distingue "sin token" de "con token".
  3. `esComparadorOriginal` comparaba `buyer_email` case-sensitive; el checkout
     normaliza el email a minúsculas al persistir
     (`apps/api/src/auth/email/normalize-email.ts`, usado desde
     `checkout.service.ts`) — comportamiento real esperado, no anonimización.
     El fixture de seed generaba el email con el prefijo de corrida en
     mayúsculas, así que la comparación fallaba siempre para la orden
     "reciente" de SC-021-H1. Se cambió la comparación de email a
     case-insensitive.
- `qa/support/seed-orders-retention.ts` + `buildOrderRetentionFixture` en
  `qa/support/builders.ts` — siembra vía checkout real + `confirm-payment`
  (US-023) + backdate de `created_at` vía `@dsm/db` (§7). Sin cambios: el
  seed ya funcionaba correctamente contra la API real la primera vez.
- `qa/scripts/api-up.sh` — se agregaron `ORDER_RETENTION_SWEEP_RATE_LIMIT_MAX`
  y `ORDER_ANONYMIZE_RATE_LIMIT_MAX` (elevados a 100000, mismo criterio que las
  variables ya existentes) — gap real del script: no conocía los dos
  presupuestos nuevos de US-021, y sin elevarlos la suite se autobloqueaba con
  429 a partir del 5º `POST retention-sweep` de una corrida completa (5/hora en
  producción). El límite real sigue probado por la capa dev-owned
  (`orders-retention.controller.spec.ts` T4.2) y por el contract test (§5,
  contra una instancia efímera con el límite bajo).

TC-021-004b (`blocked`) y TC-021-007 (`manual`) se dejan exactamente como
están. Se verificó explícitamente si PR #41 cerró el gap de §1.3 como bonus:
`apps/api/src/orders/dto/order.dto.ts` (`AdminOrderSummaryDto`/
`AdminOrderDetailDto`) sigue sin `anonymized_at`/`anonymization_reason` — el
gap sigue abierto, TC-021-004b sigue `blocked` (no ejecutable), TC-021-007
sigue `manual` (sin superficie API, checklist humano cruzado con T5.5
dev-owned). TC-021-007 mantiene su escenario `@deferred` en el `.feature`, sin
step defs.

---

## 5. Contract testing

- [x] **QA-021-CT-1**: Script standalone (mismo patrón que `qa/contract/search.contract.ts`)
  contra servidor real, valida los dos endpoints nuevos vs
  `openspec/changes/US-021-retencion-datos-ordenes-backend/contracts/openapi/*.yaml`
  - Exit criterion: valida que 200 de `anonymize` matchee
    `{order_id, anonymized_at, anonymization_reason}` (sin campos extra —
    `additionalProperties: false`), que 200 de `retention-sweep` matchee
    `{anonymized_count}`, que 401/403/404/422/429 respondan `application/problem+json`
    con el `type` declarado en el yaml (`dsm:checkout/order-not-found` para el 404).
  - Verify real: `pnpm --filter @dsm/qa test:contract:retencion-ordenes` (exit 0) —
    **desviación documentada** respecto al `Verify:` original de este plan
    (`test:contract -- --testPathPattern=...`, que asume un runner jest-style): el
    único contract test previo del repo (`search.contract.ts`) ya es un script `tsx`
    standalone sin `--testPathPattern` (mismo precedente que
    `pago-manual.contract.ts` documentó para QA-023-CT-1) — este script sigue esa
    misma convención real, con su propio comando `test:contract:retencion-ordenes`
    en `qa/package.json`, sin tocar `test:contract` (search).
  - Location: `qa/contract/retencion-ordenes.contract.ts`
  - **Estado (`/develop-qa`, ejecutado)**: **11/11 casos verde**, 2 corridas
    consecutivas sin flakiness, contra `http://localhost:3009` (API real, build
    de `apps/api` + migración aplicada). Cubre: 200 + shape de `anonymize` (dos
    veces — inicial e idempotente), 401/403/404/422 de `anonymize`, 200 + shape
    de `retention-sweep`, 401/403 de `retention-sweep`, y **429 de ambos
    endpoints** (el único caso que el `Verify` original no podía cubrir contra
    la instancia compartida de la suite, elevada a propósito — ver §Estado de
    ejecución arriba — así que el script levanta y apaga una instancia efímera
    propia con el rate-limit bajo, mismo criterio que TC-613/`importar.steps.ts`,
    y valida el `Retry-After` + el envelope RFC 7807 de ese 429).

- [~] **QA-021-CT-2**: Confirmar (no re-probar) que `GET /v1/admin/orders/:id` sigue sin
  romper el contrato existente de US-012 (`AdminOrderDetailDto`) tras el merge de este
  change — es una guarda de regresión de contrato cruzado, no un test nuevo de US-021: si
  alguien agrega `anonymized_at` al DTO (§1.3, fast-follow recomendado) sin actualizar
  `openapi.yaml` de US-012, este check lo atrapa.
  - Exit criterion: el contract test ya existente de US-012 (si lo hay) sigue en verde;
    si no existe, se anota como gap de US-012 (no se crea acá — fuera de alcance de este
    change).
  - Verify: `pnpm --filter @dsm/qa test:contract -- --testPathPattern=admin-orders` (exit 0
    si el test existe; si no existe, reportar el gap en vez de fingir que corrió)
  - **Estado (`/develop-qa`, verificado)**: **gap confirmado, no cerrado acá** — no
    existe ningún `qa/contract/*.ts` que valide `GET /v1/admin/orders[/:id]`
    (`AdminOrderSummaryDto`/`AdminOrderDetailDto`, US-012) contra un OpenAPI real
    (`grep -rl "AdminOrderDetail\|AdminOrderSummary\|admin-orders" qa/contract/`
    → 0 archivos). No se crea uno acá — fuera de alcance de este change, per el
    propio Exit criterion. Reportado como gap de US-012, no fabricado como test
    que corrió.

---

## 6. Performance (k6) — decisión explícita: NO se arma suite completa

Per `qa-backend-standards.md` §13.2 ("Every release with Tier 1 changes or critical
endpoint changes") y `performance-standards.md` (triggers de carga): **este change no
dispara la obligación**.

Razonamiento (mismo que ya adoptó `design.md` de este change en su propia sección
Approach, y que `deployment-plan.md` §7.1 confirma como gap conocido, no resuelto acá):

1. **Sin NFR cuantificado**: a diferencia de `checkout` (PRD §4: p95 escritura < 500ms,
   ya con threshold en `qa/performance/lib/thresholds.js` → `cart_write`), ningún
   documento (US §9, `design.md`, PRD §6) fija un target de latencia para
   `retention-sweep` o `anonymize`. Inventar un umbral sin baseline sería el anti-patrón
   de `nfr-quantification` ("p95 razonable — TBD").
2. **Volumen bajo por diseño**: "algunos cientos de órdenes por mes" (`design.md`
   §Approach), un único `UPDATE ... WHERE` resuelto en milisegundos, sin bucle por fila.
   Ninguno de los dos endpoints es un camino crítico de usuario final (son admin,
   rate-limited a 30/min y 5/hora respectivamente) — no encaja en ninguna de las
   categorías de `qa-backend-standards.md` §13.4 (smoke/load/stress/spike/soak son para
   endpoints Tier 1 con tráfico real sostenido).
3. **Señal de escalamiento ya declarada, no construida todavía**: `design.md` §Approach
   dice textualmente que la primera señal de que esto necesita revisión de performance es
   "la métrica de duración del propio endpoint" — que **no existe** todavía
   (`deployment-plan.md` §7.1 ya lo marca como gap, fila "Latencia de `POST
   retention-sweep`"). Construir un k6 antes de tener esa métrica sería medir sin poder
   comparar contra nada real.

**Lo que SÍ se recomienda** (no bloquea este plan, queda como ítem de seguimiento):
cuando exista la métrica de duración del endpoint (gap ya anotado en `deployment-plan.md`),
agregar un script k6 mínimo tipo `qa/performance/cart-write.js` con threshold derivado de
esa medición real — nunca antes.

---

## 7. Datos y fixtures

### Seeds requeridos (nuevos)

- **`qa/support/seed-checkout.ts`** (ya recomendado por el qa-plan de US-008, todavía sin
  construir — se reusa la misma necesidad acá): crea una orden real vía
  `POST /v1/checkout` con datos de comprador conocidos. Es la única forma de tener una
  orden con `buyer_name`/`buyer_email`/`buyer_phone` reales y conocidos contra los que
  comparar después del placeholder de anonimización.
- **`qa/support/seed-orders-retention.ts`** (nuevo, específico de este change): crea N
  órdenes vía el checkout real y luego **retrasa `created_at`** de las que deben quedar
  "vencidas" para el barrido, usando `@dsm/db` (Prisma) directamente — **excepción
  documentada** al patrón "todo seed pasa por la API real" que siguen
  `seed-carrito.ts`/`seed-checkout.ts`: la API (`POST /v1/checkout`) no permite
  parametrizar `created_at` (siempre `now()`), y es exactamente lo que hace falta para
  ejercitar el corte de retención de forma determinista sin esperar 12 meses reales. Mismo
  precedente que `qa/performance/seed-load.ts`/`seed-load-data.ts`, que ya usan `@dsm/db`
  directamente por una razón análoga (volumen que la API no puede producir
  razonablemente). Los datos siguen siendo sintéticos (§Test data strategy).

### Builders requeridos

- `buildOrderRetentionFixture(overrides?)`: genera `{ createdAt, buyerName, buyerEmail,
  buyerPhone, items[] }` con defaults deterministas (reusa `nuevoProducto`/`uniq()` de
  `qa/support/builders.ts` para los ítems).

### Fixtures

- `ANONYMIZED_BUYER_NAME`/`ANONYMIZED_BUYER_EMAIL`/`ANONYMIZED_BUYER_PHONE` — **no se
  redefinen** en QA: se importan (o se comparan por regex del dominio `.invalid`) desde
  `apps/api/src/checkout/order-anonymization.ts` para que un cambio futuro de esas
  constantes no rompa la suite QA en silencio por un valor hardcodeado dos veces.

---

## 8. Exploratory charters

Agregar a `qa/exploratory/charters.md`, sección nueva "US-021 — Retención y anonimización":

1. **Charter: Carrera entre el barrido oportunista y la acción a pedido** — disparar
   `POST retention-sweep` y `POST :id/anonymize` sobre la misma orden casi al mismo
   tiempo (dos pestañas / dos requests concurrentes); confirmar que sólo uno "gana" (el
   `WHERE anonymized_at IS NULL` decide), que no hay dos eventos, y que el `reason` final
   es consistente con quién ganó la carrera. Complementa (no duplica) el threat model
   "Repudiation" de `design.md`.
2. **Charter: Cutoff en el borde de la ventana de retención (timezone/boundary)** — una
   orden creada exactamente en el límite de `ORDER_RETENTION_MONTHS` (mismo día, mismo
   segundo del corte calculado con `setMonth`); verificar de qué lado cae y si el
   comportamiento en el borde es estable entre corridas (no depende de la hora del
   servidor de forma sorprendente).
3. **Charter: Residuo de PII en logs/errores tras anonimizar** — con centinelas
   (email/teléfono/nombre reconocibles) en una orden, anonimizarla y revisar que ningún
   log de la API (incluidos los de error 4xx/5xx sobre esa orden) siga mostrando los
   valores originales — más allá del test unitario ya dirigido de T2.2/T5.6 (dev-owned),
   este charter explora rutas no anticipadas (logs de acceso, logs de Nest por defecto,
   trazas de excepción no manejadas).
4. **Charter: `retention-sweep` bajo rate-limit agotado en operación real** — con el
   presupuesto angosto (5/hora), simular a un operador humano reintentando manualmente
   tras un 429; verificar que el mensaje de error (RFC 7807 + `Retry-After`) es
   comprensible para alguien sin contexto técnico (el dueño, per US §10).

---

## 9. Quality gates

| Gate | Bloquea | Trigger |
|---|---|---|
| Acceptance BDD (API-level, §4) | merge del PR #25 | todo PR que toque `checkout/orders-retention*` |
| Contract (§5) | merge del PR #25 | todo PR que toque los dos yaml de contrato |
| Regresión (`@regression`, SC-021-N1..N5) | release / promoción a `uat` | nightly + pre-release, per el modelo de 3 capas |
| Exploratory (§8) | ninguno (no bloquea) | antes de la primera promoción a `production` (mismo timing que `deployment-plan.md` §6) |

---

## 10. Anti-patterns evitados

- ❌ `qa-backend-standards.md` §2.1 ("QA writes all the tests") — unit/integration/T5.x
  son dev-owned, no se re-escriben acá (§1.1).
- ❌ `bdd-scenario-quality` ("implementation leakage") — ningún escenario asserta sobre
  `updateMany`/SQL; todos observan la respuesta HTTP o el GET real.
- ❌ `nfr-quantification` ("p95 razonable — TBD") — se decide explícitamente NO fijar un
  threshold k6 sin baseline, en vez de inventar uno (§6).
- ❌ Fingir cobertura de un AC sin superficie real — TC-021-004b se marca
  `execution_mode: blocked` y TC-021-007 `manual`, en vez de declarar "cubierto" un
  escenario que ninguna API expone hoy (§1.3, §4).
- ❌ "Test con datos de producción" — todo dato es sintético, seed vía checkout real +
  backdate documentado de `created_at` (§7).
- ❌ Inventar un flujo de UI/Playwright Layer 3 sobre un Badge que no existe (§1.2) — se
  escopea a API-level y se deja la nota para cuando exista el change de FE.

---

## 11. Preguntas abiertas

1. **OQ-QA-021-1**: ¿el fast-follow de DTO (§1.3 — agregar `anonymized_at`/
   `anonymization_reason` a `AdminOrderSummaryDto`/`AdminOrderDetailDto`) se resuelve
   dentro del PR #25 de este mismo change, o como un change separado antes de que
   `US-021` se declare "cumplida" en el sentido de AC-4/AC-5? Este plan no lo decide —
   lo deja trazable para quien cierre el change.
2. **OQ-QA-021-2**: cuando exista `/plan-frontend-web-ticket US-021`, ¿el Badge de
   "anonimizado" se agrega como task nueva dentro de `US-012-panel-ordenes-dueno-frontend-web`
   (ya que es el módulo que renderiza el panel) o como un change `US-021-...-frontend-web`
   separado? Afecta dónde vive el futuro test Layer 2/3 que complete TC-021-004b/005 a
   nivel UI — no bloquea este plan.

---

## 12. Dependencias declaradas

| Dependencia | Estado | Efecto |
|---|---|---|
| US-008 backend (checkout, crea `orders`) | Mergeado a `main` | Resuelto — necesario para `seed-checkout.ts` |
| US-012 backend (`GET /v1/admin/orders[/:id]`) | Mergeado a `main` (PR #22, `in-review`) | Resuelto — usado como proxy de AC-2/5/6 (§1, §4) |
| US-021 backend (este change, PR #25) | `draft`, 0/16 tasks ejecutadas | **Bloquea todo lo de este plan** — ningún escenario corre hasta que `/develop-backend` construya los dos endpoints |
| Fast-follow de DTO (§1.3) | No planificado en ningún change | Bloquea sólo TC-021-004b — el resto de este plan no depende de él |
| `US-021-...-frontend-web` | No existe | Bloquea el Badge/confirmación de dos pasos a nivel UI — fuera de alcance de este plan (§1.2) |

---

## 13. Standards consultados

- `docs/quality/testing-standards.md` §2 (pirámide), §5 (test data), §14.9 (negative-space)
- `docs/quality/qa-backend-standards.md` §2.1 (ownership matrix), §13.2/13.3 (cuándo
  aplica performance — usado para justificar la ausencia de k6), §21.1/21.4 (cuándo BDD,
  tense imperativo/declarativo)
- `docs/product/design-e2e.md` §8 (DER — retención, "órdenes no se borran"), §14 (STRIDE
  — "Datos del comprador (PII): Information disclosure"), §19 (estrategia de testing,
  modelo de 3 capas)
- `docs/product/prd.md` §6 (política de retención de 12 meses)
- Skill `qa-three-layer-regression` — Layer 1 vive en el change de backend; frontmatter
  de test-case (`execution_mode`/`test_layer`/`target_tooling`/`gherkin_scenario`)
- Skill `bdd-scenario-quality` — verificado tense imperativo/declarativo, sin `Scenario
  Outline` salvo SC-021-N5 (2+ variaciones del mismo shape), sin leak de implementación
- Skill `nfr-quantification` — razonamiento explícito para NO fijar un threshold k6 sin
  baseline (§6)
- Precedente: `openspec/changes/archive/US-008-checkout-guest-backend/qa-plan.md`
  (formato, capas, manejo de un gap FE en el momento de escribir el plan)
