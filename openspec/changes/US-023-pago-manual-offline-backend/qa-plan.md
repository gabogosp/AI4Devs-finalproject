# QA Plan — US-023 Pago manual / offline (confirmación del dueño)

> **Ticket**: US-023 — Pago manual / offline (confirmación del dueño)
> **Author**: qa-engineer agent
> **Date**: 2026-09-05
> **Status**: Proposed
> **Affected platform(s)**: backend (superficie HTTP admin). El consumidor de frontend
> (`PendingPaymentsPanel`, US-012 Fase 12) **todavía no existe en código** — ver §7.
> **Service tier(s)**: 1 (derivado — ver más abajo, no hay `service-catalog.yaml` en el repo)
> **Companion files**: `proposal.md`, `tasks.md`, `design.md` (los tres ya cerrados, PR #27
> mergeado a `main`, 8/8 fases y verificaciones de suite en `[x]`)

> **Nota de contexto (2026-09-05)**: el índice `docs/_index/openspec-changes.yaml` todavía
> marca `US-023-pago-manual-offline-backend` como `status: in review` — es drift entre el
> índice y la realidad (el PR #27 está mergeado, las 8 fases de `tasks.md` están `[x]`). Este
> plan trata el backend como **terminado**, no como trabajo en curso; no le corresponde a este
> agente corregir el índice (fuera de su ownership — ver "Index ownership" del agente).

---

## 1. Perfil de riesgo

| Componente | Clasificación | Por qué |
|---|---|---|
| `POST /v1/admin/orders/{orderId}/confirm-payment` | **CRÍTICO** | Primera vez que el repo escribe `payments` y decrementa `products.stock` en producción (`design.md` §Context). Dinero + inventario en la misma transacción. |
| `GET /v1/admin/orders/pending-payment` | Alto | Sin este endpoint, el dueño no tiene forma de descubrir qué confirmar (AC-2) — es la única puerta de entrada al flujo completo. |
| Guard de idempotencia (`idempotency_key = manual:{orderId}` UNIQUE) | **CRÍTICO** | AC-5 depende enteramente de esta constraint; un fallo acá es un doble descuento de stock, no un bug cosmético. |
| Transacción de tres repositorios (`orders` → `stock` → `payments`) | **CRÍTICO** | Primera vez en el repo que un `$transaction` cruza módulos (`design.md` §Approach). Si la atomicidad se rompe, el resultado es una orden `new` con stock sin decrementar, o viceversa. |
| RBAC (`AdminGuard`, ADR-0009) | Alto | Hereda el seam ya probado por US-001/US-014, pero es la primera vez que gatea una escritura que mueve dinero e inventario simultáneamente. |
| Auditoría (`confirmed_by` + `processed_at`) | Medio-alto (ver hallazgo QA-023-F1 en §12) | El dato se persiste, pero **ningún endpoint HTTP lo expone hoy** — ni `GET /pending-payment` (deliberadamente angosto) ni `GET /v1/admin/orders/{id}` de US-012 (`AdminOrderDetail` no incluye `confirmed_by`/`processed_at`, confirmado leyendo `apps/api/docs/api/openapi.yaml`). AC-6 exige que el registro sea "trazable para auditoría"; hoy solo es trazable con acceso directo a la base. |
| `PendingPaymentsPanel` (FE, US-012 Fase 12) | **No existe en código** (ver §7) | AC-2 (mitad UI) y todo el cross-feature con `OrdersList` dependen de una pieza que aún no se construyó. |

**Derivación del service tier (no hay `service-catalog.yaml` en el repo — regla de resolución del agente)**:
este change vive en el mismo subsistema transaccional que `US-010-orden-webhook-stock-backend`,
cuyo propio `qa-plan.md` ya se autodeclaró **"Service tier(s): 1 (núcleo transaccional — dinero +
stock)"**. US-023 construye — de hecho, es la primera vez que existe en código — exactamente ese
núcleo (`payments/`, `stock/`, la transacción de tres repositorios que US-010 iba a reusar). Mismo
criterio, misma conclusión: **Tier 1**. Se registra la derivación explícitamente en vez de asumirla
en silencio (regla de tier-resolution del agente, precedencia: catálogo ausente → derivar de
`proposal.md`/US → este caso).

### Journeys críticas identificadas

1. Orden `pending_payment` real (creada por checkout, US-008) → el dueño la confirma → pasa a
   `new` con stock decrementado y un pago `manual` auditable (AC-1, AC-6).
2. El dueño descubre qué confirmar sin acceso a la base (AC-2, vía `GET /pending-payment`).
3. Nadie sin sesión de dueño puede mover dinero ni stock (AC-3).
4. Ni un estado inválido ni un doble click/reintento de red producen un efecto duplicado o
   silencioso (AC-4, AC-5).

---

## 2. Mapeo de la pirámide de test (capas QA-owned en negrita)

| Capa | Dueño | Estado | Herramienta |
|---|---|---|---|
| Unit (`stock.repository`, `payments.repository`, errores de dominio) | Dev (TDD) | **Hecho** — `tasks.md` Fase 0-3, 6, todas `[x]` | Jest |
| Integration (`confirm-order.service`, transacción de 3 repos, contra Postgres real) | Dev (TDD) | **Hecho** — T3.3 | Jest + Postgres real |
| e2e-nest (contrato HTTP completo: 200/401/403/404/409, concurrencia, auditoría, stock insuficiente) | Dev (TDD) | **Hecho** — Fase 5, T5.1-T5.5 | Jest + supertest + Postgres real |
| **Aceptación BDD (Layer 1, backend-isolado)** | **QA** | Este plan | Cucumber-js + supertest |
| **Contract testing** | **QA** | Este plan | Spectral + supertest vs OpenAPI |
| **Performance (k6)** | **QA + Dev** | Este plan | k6 |
| **E2E cross-stack (Layer 3)** | **QA** | Este plan — **bloqueado**, ver §7 | Playwright |
| **Exploratorio** | **QA** | Este plan | Charters manuales |
| Accesibilidad / regresión visual | N/A en este change | Backend puro; se retoma cuando exista `PendingPaymentsPanel` (US-012 o quien lo construya) | — |

> **Nota de cobertura dev-owned (awareness, no se re-autora)**: `tasks.md` Fase 5 (T5.1-T5.5) ya
> prueba, contra Postgres real y por HTTP, el camino feliz + listado (T5.1), auth 401/403 (T5.2),
> estado inválido + doble confirmación + concurrencia real con `Promise.all` (T5.3), auditoría
> (T5.4) y stock insuficiente (T5.5) — las 8 fases de `tasks.md` están `[x]`. Este plan **no
> duplica** esos specs; construye la capa de aceptación **persistente** (per skill
> `qa-three-layer-regression`: "per-task test es efímero, el regression suite es el contrato de
> comportamiento que sobrevive a la entrega") y las capas que `tasks.md` no cubre por diseño
> (contract testing formal contra el OpenAPI publicado, k6, exploratorio, E2E cross-stack).

---

## 3. Matriz de trazabilidad AC → escenarios (autocheck F47)

| AC | Título | Escenario(s) | Capa | Estado |
|---|---|---|---|---|
| AC-1 | Confirma el pago, la orden pasa a "new" | `SC-023-H1` | 1 | Ejecutable hoy |
| AC-2 | El panel muestra las pendientes de confirmar (cross-feature con US-012) | `SC-023-H2` (mitad API) + `SC-023-X1` (mitad UI, boceto) | 1 / 3 | H2 ejecutable hoy; X1 **bloqueado** — ver §7 |
| AC-3 | Solo el dueño autenticado puede confirmar | `SC-023-A1` | 1 | Ejecutable hoy |
| AC-4 | No se puede confirmar una orden que no está pendiente | `SC-023-A2` | 1 | Ejecutable hoy |
| AC-5 | No se puede confirmar una orden dos veces (idempotencia) | `SC-023-N1`, `SC-023-N2` | 1 | Ejecutable hoy |
| AC-6 | Registro auditable de quién y cuándo | `SC-023-N3` | 1 | Ejecutable hoy (con la deviación documentada en §12 QA-023-F1) |
| — (invariante ADR-0008, no es AC formal — `design.md` §Non-goals + T5.5) | Stock insuficiente al confirmar | `SC-023-N4` | 1 | Ejecutable hoy |

Todos los IDs citados arriba (`SC-023-H1`, `SC-023-H2`, `SC-023-A1`, `SC-023-A2`, `SC-023-N1`,
`SC-023-N2`, `SC-023-N3`, `SC-023-N4`, `SC-023-X1`) están definidos en el `Feature:` de §4. No hay
referencias colgantes.

---

## 4. Escenarios BDD (Gherkin)

```gherkin
# language: es
@pagos @us-023
Característica: Pago manual / offline — confirmación del dueño (US-023)
  Como dueño de DSM
  quiero confirmar el pago de una orden pagada por transferencia o efectivo coordinado por WhatsApp
  para completar la venta y descontar el stock sin depender de una pasarela de pago online

  Antecedentes:
    Dado un catálogo sembrado con productos disponibles
    Y un comprador que completó el checkout dejando una orden real en estado "pending_payment"

  # ─── HAPPY PATH ───

  @happy @critical-path
  Escenario: SC-023-H1 — El dueño confirma el pago y la orden pasa a "new" (AC-1)
    Cuando el dueño autenticado confirma el pago de esa orden
    Entonces recibe 200 con la orden en estado "new"
    Y el stock de cada producto de la orden queda decrementado exactamente en la cantidad pedida
    Y queda registrado un pago por un medio manual/offline para esa orden

  @happy
  Escenario: SC-023-H2 — El listado de pendientes de pago expone lo necesario para confirmar (AC-2, mitad API)
    Dado que existen dos órdenes en estado "pending_payment", la segunda creada después de la primera
    Cuando se consulta el listado de órdenes pendientes de confirmar pago
    Entonces la respuesta incluye ambas órdenes, la más nueva primero
    Y cada fila trae el identificador interno de la orden, su número, el nombre del comprador, el total y la fecha de creación
    Y ninguna fila incluye el email ni el teléfono del comprador

  # ─── ALTERNATIVE PATH ───

  @alternative @critical-path
  Esquema del escenario: SC-023-A1 — Sin sesión de dueño, la acción se rechaza (AC-3)
    Cuando "<quién>" intenta confirmar el pago de esa orden
    Entonces recibe <código>
    Y la orden permanece en "pending_payment"

    Ejemplos:
      | quién                       | código |
      | nadie (sin token)           | 401    |
      | alguien con sesión no-admin | 403    |

  @alternative
  Esquema del escenario: SC-023-A2 — No se puede confirmar una orden que no está pendiente de pago (AC-4)
    Dado que la orden ya está en estado "<estado>"
    Cuando el dueño intenta confirmar su pago
    Entonces recibe 409 con un mensaje claro sobre el estado actual de la orden
    Y el estado de la orden no cambia

    Ejemplos:
      | estado    |
      | new       |
      | cancelled |

  # ─── NEGATIVE SPACE ───

  @negative @critical-path
  Escenario: SC-023-N1 — Repetir la confirmación no duplica efectos (AC-5, doble click / reintento)
    Dado que el dueño ya confirmó el pago de esa orden
    Cuando el dueño repite la acción de confirmar
    Entonces recibe 409 con un mensaje claro sobre el estado actual de la orden
    Y el stock no se decrementa una segunda vez
    Y sigue existiendo exactamente un pago registrado para esa orden

  @negative @critical-path
  Escenario: SC-023-N2 — Dos confirmaciones simultáneas nunca duplican el pago (AC-5, concurrencia real)
    Cuando el dueño dispara dos confirmaciones simultáneas sobre la misma orden
    Entonces exactamente una responde con éxito y la otra con el rechazo por estado
    Y queda exactamente un pago registrado para esa orden
    Y el stock quedó decrementado una sola vez

  @negative
  Escenario: SC-023-N3 — El registro de quién y cuándo confirmó queda disponible para auditoría (AC-6)
    Dado que un dueño con identidad conocida confirma el pago de esa orden
    Cuando se consulta el registro de auditoría de ese pago
    Entonces el registro identifica a quién confirmó
    Y el registro tiene una marca temporal dentro de los 5 segundos de la confirmación

  @negative
  Escenario: SC-023-N4 — Sin stock suficiente al confirmar, la confirmación se rechaza (invariante ADR-0008)
    Dado que el stock de un producto de la orden bajó por debajo de lo pedido después del checkout
    Cuando el dueño intenta confirmar el pago
    Entonces recibe 409 señalando que no hay stock suficiente
    Y la orden permanece en "pending_payment"
    Y no se registra ningún pago nuevo para esa orden

  # ─── CROSS-FEATURE (bloqueado — ver §7) ───

  @cross-feature @wip
  Escenario: SC-023-X1 — El dueño confirma desde el panel y la orden pasa a la cola operativa (AC-2, boceto no comprometido)
    Dado que el dueño abre la vista de "pendientes de confirmar pago" del panel
    Cuando confirma el pago de una orden desde esa vista
    Entonces la fila desaparece de la vista de pendientes
    Y la orden aparece en la cola operativa del panel como "nueva"
```

**Tooling**: Cucumber-js con `qa/acceptance/steps/pago-manual.steps.ts`, contra `supertest` (mismo
patrón que `qa/acceptance/steps/carrito.steps.ts` / el planificado para US-008/US-010).
**Location**: `qa/acceptance/features/pago-manual.feature`.
**Test layer**: 1 (backend-isolado, per skill `qa-three-layer-regression`) para
`SC-023-H1/H2/A1/A2/N1/N2/N3/N4`. `SC-023-X1` es Layer 3, marcado `@wip` a propósito — no corre en
CI hasta que se un-diferra (per `bdd-scenario-quality`: `@wip` nunca se deja pasar como verde).

```yaml
id: QA-023-ACC-1
scenario: SC-023-H1, SC-023-H2, SC-023-A1, SC-023-A2, SC-023-N1, SC-023-N2, SC-023-N3, SC-023-N4
execution_mode: automated
test_layer: 1
target_tooling: Cucumber-js + supertest
gherkin_scenario: pago-manual.feature (Característica completa, 8 escenarios ejecutables)
status: done
```

- [x] **QA-023-ACC-1 — ejecutado (`/develop-qa`, 2026-09-05)**: `qa/acceptance/features/pago-manual.feature`
  + `qa/acceptance/steps/pago-manual.steps.ts` — 10 escenarios (8 declarados, 2 provienen de los
  Esquemas SC-023-A1/A2 con 2 Ejemplos cada uno), 61 pasos, verdes 5/5 corridas consecutivas contra
  la API real (`qa/scripts/api-up.sh`) + Postgres real, sin mockear la transacción de
  pagos/stock/orders. Verify real: `QA_API_BASE_URL=http://localhost:3009
  DATABASE_URL=postgresql://dsm:dsm@localhost:55432/dsm?schema=public JWT_SECRET=dev-secret
  ADMIN_BOOTSTRAP_TOKEN=<mismo valor de la API> pnpm --filter @dsm/qa test:acceptance -- --tags
  "@pagos"`.
  - **Deviación de tooling (menor, registrada)**: el plan decía "Cucumber-js + supertest"; la
    convención REAL de `qa/acceptance/` (`world.ts`, `carrito.steps.ts`) es Cucumber-js + Playwright
    `APIRequestContext` (nunca `supertest`, que sólo se usa dev-owned dentro de `apps/api/**/*.spec.ts`).
    Se siguió la convención real, no la letra del plan.
  - **Bugfix de escape en Cucumber Expressions**: el paso "queda registrado un pago por un medio
    manual/offline…" no matcheaba — `/` es alternancia en Cucumber Expressions
    (`manual/offline` ⇒ "manual" O "offline"), no texto literal. Se escapó `manual\/offline`.
  - **`qa/scripts/api-up.sh` extendido**: agregado `CHECKOUT_RATE_LIMIT_MAX=100000` (no estaba
    cubierto) — la suite de `@pagos` siembra 10+ órdenes por corrida vía `POST /v1/checkout` real,
    y el presupuesto de producción (10) la autobloqueaba a mitad de camino con un 429 que no tenía
    nada que ver con el guard de idempotencia bajo prueba.

**Reuses**: `qa/support/admin-auth.ts` (JWT admin real vía login, con fallback minteado no-estricto
per su propia doc), `qa/support/api.ts`. Necesita infraestructura nueva — ver §8.

**Nota sobre SC-023-N3 (deviación documentada)**: no existe ningún endpoint HTTP que exponga
`confirmed_by`/`processed_at` (ver hallazgo QA-023-F1, §12). El paso "se consulta el registro de
auditoría de ese pago" se implementa con una lectura directa vía `@dsm/db` (Prisma), **solo para
esta aserción** — la siembra de la orden sigue siendo 100% vía API real (nunca INSERT directo, per
`testing-standards.md` §5). Hay precedente en el repo: `qa/performance/seed-load-data.ts` ya importa
`@dsm/db` para necesidades que la API no cubre. Es una excepción angosta y señalada, no un patrón
que se generaliza al resto de la suite.

**Ampliación de la excepción, registrada en ejecución**: la misma lectura angosta vía Prisma
(`payment.findMany({ where: { order_id } })`) se reusó también en SC-023-H1 ("queda registrado un
pago…"), SC-023-N1 y SC-023-N2 ("sigue existiendo"/"queda exactamente un pago…") — es la MISMA
necesidad de fondo (QA-023-F1: ningún endpoint HTTP expone la tabla `payments`, ni su existencia ni
su auditoría), no una segunda excepción. Sigue usándose exclusivamente para ASERTAR, nunca para
sembrar.

**Segunda excepción angosta, nueva en ejecución (SC-023-A2, ejemplo "cancelled")**: no existe HOY
ningún endpoint que transicione una orden a `cancelled` (`* → cancelled` es US-013, sin construir —
`apps/api/src/orders/order-state.ts` sólo declara 4 estados activos). Sin esta excepción, ese único
Ejemplo del Esquema ya planificado por `qa-plan.md` no tendría forma de ejecutarse por black-box. Se
aplicó el mismo criterio que QA-023-F1 (escritura puntual vía `@dsm/db`, `prisma.order.update({...,
data: { status: 'cancelled' } })`, documentada en el step `Given('que la orden ya está en estado
{string}', ...)` de `pago-manual.steps.ts`) — nunca para sembrar el resto de la suite, sólo para
alcanzar esta precondición concreta que el sistema no expone por ninguna otra vía todavía.

---

## 5. Contract testing

- [x] **QA-023-CT-1**: Contract test (Spectral + supertest) para las dos rutas de `admin-payments`
  contra `apps/api/docs/api/openapi.yaml` — **ejecutado (`/develop-qa`, 2026-09-05)**, 7/7 casos
  verdes contra la API real.

  ```yaml
  id: QA-023-CT-1
  execution_mode: automated
  test_layer: 1
  target_tooling: Spectral + supertest
  gherkin_scenario: N/A (contract test, no BDD)
  status: done
  ```

  **Deviación de convención registrada (tooling y Verify)**: este `Verify:` original —
  `pnpm --filter @dsm/qa test:contract -- --testPathPattern=pago-manual` — asume un runner
  jest-style (`--testPathPattern`) que este repo no usa para contract tests. El único precedente
  real (`qa/contract/search.contract.ts`) es un script `tsx` standalone registrado como su propio
  script de npm — sin jest, sin `--testPathPattern`, y sin `supertest` (usa `fetch` contra el
  servidor real). Se siguió esa convención REAL en vez de la letra del plan:
  `qa/contract/pago-manual.contract.ts` (mismo estilo que `search.contract.ts`), registrado como
  **script nuevo** `test:contract:pago-manual` en `qa/package.json` (no se tocó el `test:contract`
  existente de `search.contract.ts`). El `Verify:` real y ejecutable es:
  `QA_API_BASE_URL=http://localhost:3009 ADMIN_BOOTSTRAP_TOKEN=<mismo valor de la API>
  JWT_SECRET=dev-secret pnpm --filter @dsm/qa test:contract:pago-manual` (exit 0).

  - Exit criterion: un spec valida que `POST /v1/admin/orders/{orderId}/confirm-payment` responde
    200 con el schema `PaymentConfirmed` (`order_number`, `status: "new"`, sin propiedades extra
    — `additionalProperties: false`), y que 401/403/404/409 matchean `application/problem+json`
    con los dos `type` distintos (`dsm:payments/order-not-pending-payment`,
    `dsm:payments/insufficient-stock`) en el 409. `GET /v1/admin/orders/pending-payment` responde
    200 con un array de `PendingPaymentOrder` cuyo `id` es siempre un UUID válido (contrato que
    `POST /confirm-payment` necesita en el path).
  - Verify: `pnpm --filter @dsm/qa test:contract -- --testPathPattern=pago-manual` (exit 0)

---

## 6. Performance (k6)

- [ ] **QA-023-PERF-1**: Script k6 para `POST /confirm-payment` con target p95 < 500 ms (PRD §4 /
  US-023 §9, heredado — hereda el mismo threshold que `checkout`/`cart_write`/`auth_login`, no un
  número nuevo)

  ```yaml
  id: QA-023-PERF-1
  execution_mode: automated
  test_layer: 1
  target_tooling: K6
  gherkin_scenario: N/A (performance, no BDD)
  ```

  - Exit criterion: `qa/performance/confirm-payment.js` pre-siembra N órdenes `pending_payment`
    reales (vía `seedPendingPaymentOrder`, §8) en `setup()` — **una por iteración**, nunca la misma
    orden dos veces (confirmar una orden ya confirmada mide el camino 409, no el camino feliz que
    el NFR describe). Cada VU consume una orden distinta de un `SharedArray` correlacionado por
    índice de iteración. `check()` valida `status === 200` y `body.status === 'new'`, gateado por
    `checks: ['rate>0.99']`. Sin superficie de rate-limit dedicada en este endpoint (`design.md`
    §Approach — "sin throttler dedicado"), así que no hace falta la guarda `rate_limited` que sí
    usan `cart_write`/`auth_login`.
  - Verify: `k6 run --vus 3 --duration 15s qa/performance/confirm-payment.js --summary-trend-stats="p(95)" 2>&1 | grep -q "✓"`

- [ ] **QA-023-PERF-2**: Threshold agregado a la fuente única `thresholds.js`
  - Exit criterion: `qa/performance/lib/thresholds.js` exporta `confirm_payment` con
    `'http_req_duration{endpoint:confirm_payment}': ['p(95)<500']` (mismo NFR heredado que
    `cart_write`/`auth_login`, per el comentario ya establecido en ese archivo — no se inventa un
    número nuevo).
  - Verify: `grep -q "confirm_payment" qa/performance/lib/thresholds.js && grep -q "p(95)<500" qa/performance/lib/thresholds.js`

> **No se planifica baseline/stress/soak trio** (per `k6-load-scaffolding`, "cuándo NO usar" —
> la superficie es admin, un solo operador, bajo volumen declarado explícitamente en `design.md`
> §Trade-offs). Un script único con thresholds NFR-atados es proporcional; el mismo criterio que
> ya aplicaron los qa-plans de US-008 y US-010 para sus propios endpoints de escritura.

---

## 7. E2E cross-stack (Layer 3) — bloqueado, cerrando el loop de US-012 §6 / OQ-QA-2

**Hallazgo de esta sesión (verificado leyendo código, no asumido)**: `US-023 §7` (nota "Resuelto
2026-08-31") afirma que `US-012-panel-ordenes-dueno-frontend-web` (PR #22) ya construyó
`PendingPaymentsPanel.tsx` en su Fase 12 y que "no queda nada de FE por construir". **Eso no es
correcto hoy**:

- `find apps/web/src -iname "*PendingPayment*"` no devuelve ningún componente (solo el tipo
  generado `apps/web/src/api/generated/model/pendingPaymentOrder.ts`, que es el DTO del contrato,
  no la UI).
- `git log --all -- "**/PendingPaymentsPanel*"` no devuelve ningún commit en todo el historial.
- `openspec/changes/US-012-panel-ordenes-dueno-frontend-web/tasks.md` tiene las 4 tasks de su
  "Fase 12: `PendingPaymentsPanel`" (T12.1-T12.4) **sin marcar** (`- [ ]`), mientras las 11 fases
  anteriores están `[x]` — 21/26 tasks cerradas según el propio commit `a969a83`, consistente con
  que faltan exactamente esas 4-5.

Es decir: la nota de US-023 §7 quedó **desactualizada** frente al estado real del código — el PR
#22 mergeó backend + la mayor parte del frontend de US-012, pero **no** la Fase 12. Este hallazgo
se reporta como riesgo (§ del reporte final) para que alguien (PO/dev lead) actualice esa nota o
retome la Fase 12; no es responsabilidad de este agente corregir la US ni el `tasks.md` ajeno.

**Consecuencia para este plan**: `SC-023-X1` (§4) y los bocetos `PP-1`/`PP-2`/`PP-3` que
`US-012-panel-ordenes-dueno-qa/qa-plan.md` §6 dejó sin comprometer siguen **sin AC formal y sin
UI construida** — no hay nada que un Playwright cross-stack pueda ejercitar todavía. Cerrar el
loop de `OQ-QA-2` (ese mismo plan) con la respuesta honesta: **sigue bloqueado, y ahora se sabe
por qué exactamente** (Fase 12 no ejecutada, no un problema de coordinación entre worktrees como
asumía la nota original).

- [ ] **QA-023-E2E-1**: Spec Playwright cross-stack — confirmar desde `PendingPaymentsPanel` y ver
  el efecto en `OrdersList` (boceto, NO ejecutable hoy)

  ```yaml
  id: QA-023-E2E-1
  scenario: SC-023-X1
  execution_mode: manual   # degradado de `automated` a propósito — no hay UI que automatizar todavía
  test_layer: 3
  target_tooling: Playwright
  gherkin_scenario: SC-023-X1 — El dueño confirma desde el panel y la orden pasa a la cola operativa
  status: blocked
  blocked_by: "US-012-panel-ordenes-dueno-frontend-web Fase 12 (T12.1-T12.4), sin construir"
  ```

  - Exit criterion (cuando se desbloquee): siembra una orden `pending_payment` real
    (`seedPendingPaymentOrder`, §8), navega a `/admin/ordenes?tab=pendientes-de-pago`, confirma la
    fila, verifica que desaparece de esa vista y que la misma orden aparece en
    `/admin/ordenes` (pestaña por defecto) con estado "nueva" — sin refresco manual de página
    (PP-3 de `US-012-panel-ordenes-dueno-qa/qa-plan.md` §6).
  - Verify (cuando se desbloquee): `pnpm --filter @dsm/qa test:e2e -- --grep "pendientes-de-pago" --reporter=list` (exit 0)
  - **No se autora el spec todavía** — escribir un Playwright contra selectores que no existen
    produciría un archivo que ningún `/develop-qa` puede ejecutar ni verificar; eso es peor que
    dejarlo declarado como bloqueado (mismo criterio que `qa-plan.md` de US-012 §6 ya aplicó).

**Acción recomendada** (no ejecutada por este agente — excede el alcance de Mode A): alguien debe
decidir si (a) se retoma `US-012-panel-ordenes-dueno-frontend-web` Fase 12 como trabajo pendiente
del mismo change, o (b) se abre un change nuevo dedicado a `PendingPaymentsPanel`. Cualquiera sea
la vía, cuando el componente exista, `QA-023-E2E-1` pasa de `manual`/`blocked` a `automated` sin
tener que rediseñar el escenario — el Gherkin (`SC-023-X1`) ya está escrito y no depende de
implementación.

---

## 8. Datos y fixtures

### Seeds requeridos (nuevo)

- **`qa/support/seed-pending-payment-order.ts`** (nuevo — no existe hoy ninguna forma en `qa/support`
  de llegar a una orden `pending_payment` real): drives el checkout real, nunca INSERT directo.
  1. Abre un invitado nuevo (`nuevoInvitado()` de `cart-client.ts`), agrega N líneas al carrito
     (reusa fixtures de `seedCarrito()` o crea las propias — a definir en implementación).
  2. Lee la cookie `dsm_cart_csrf` (mismo patrón que `Invitado.fijar()`), hace
     `POST /v1/checkout` con `buildCheckoutBody()` (nuevo, ver builders abajo).
  3. El `201` de checkout **no expone el UUID interno de la orden** (solo `order_token`,
     `order_number` — confirmado leyendo `CheckoutCreated` en `openapi.yaml`). Para resolver el
     `id` que `POST /confirm-payment` necesita en el path, el seed hace
     `GET /v1/admin/orders/pending-payment` (con un token admin, `adminAuth()`) y busca la fila
     cuyo `order_number` coincide — **dogfooding intencional de AC-2**: el mismo endpoint que este
     plan prueba es la única vía legítima (sin acceso a DB) para que un consumidor externo
     descubra ese `id`.
  - Devuelve `{ id, orderNumber, buyerName, totalArsCents }`.

### Builders requeridos (nuevos — no existen hoy en `qa/support/builders.ts`)

- `buildBuyerData(overrides?)`: genera `{ name, email, phone }` sintéticos válidos contra el
  patrón de `CreateCheckoutRequest.buyer` (mismo builder que proponía el `qa-plan.md` de US-008,
  nunca implementado todavía — se crea acá porque este change lo necesita primero).
- `buildCheckoutBody(overrides?)`: `{ buyer: buildBuyerData(), consent: true, fulfillment: 'pickup' }`.

### Reuse existente

- `qa/support/admin-auth.ts` (JWT admin, con distinción `real-login` vs `minted-fallback` —
  la suite de aceptación de este change usa `adminAuthWithSource()` y puede asertar `real-login`
  cuando corresponda, per su propia doc de "modo estricto").
- `qa/support/api.ts` (`apiCall` — fail-loud en no-2xx).
- `qa/support/cart-client.ts` (`nuevoInvitado`, `Invitado.fijar`, manejo de cookies/CSRF).

### Estrategia de datos (per `testing-standards.md` §5)

- 100% sintético — ningún dato de producción.
- Defaults determinísticos en los builders (sin `Math.random()`/`Date.now()` salvo IDs opacos que
  el propio sistema genera).
- Cada escenario siembra su propia orden — nunca reusa una orden de otro escenario (evita
  colisiones de `idempotency_key` entre tests que corren en paralelo).

---

## 9. Exploratory charters

Agregar a `qa/exploratory/charters.md`:

1. **Charter: JWT admin con `sub` no-uuid** — confirmar con el token de bootstrap (`sub: 'admin'`,
   literal, sin fila en `Customer`) y verificar que `confirmed_by` guarda el literal sin romper
   nada (columna sin FK, per `design.md` §Persistence) — cubre el camino que el `stub` de
   dev-owned T5.4 ya prueba, pero explorando variantes de token no cubiertas (token expirado a
   mitad de la request, token con `role` en mayúsculas, etc.).
2. **Charter: colisión de rutas admin** — `design.md` §Trade-offs documenta que
   `PaymentConfirmationController` y el futuro `OrdersController` de US-012 comparten el prefix
   `v1/admin/orders` y que la resolución depende de que el `:id` de US-012 tenga una regex UUID.
   Explorar qué pasa si alguien navega a `GET /v1/admin/orders/pending-payment` cuando el
   `OrdersController` de US-012 (Fase 12 aparte) ya está registrado — ¿el orden de módulos en
   `app.module.ts` sigue siendo irrelevante como el design predice?
3. **Charter: reintento de red del dueño en mal momento** — simular un timeout de red justo
   después de que el servidor ya procesó el `POST /confirm-payment` (200 real, pero el cliente
   nunca lo vio) y el dueño reintenta desde la UI (cuando exista) o vía curl — confirmar que el
   segundo intento es un 409 silencioso y observable, no una pantalla de error confusa.

---

## 10. Quality gates

| Gate | Bloquea | Disparador |
|---|---|---|
| Contract (`QA-023-CT-1`) | merge | todo PR que toque `apps/api/src/payments/` o `apps/api/src/stock/` |
| Aceptación BDD (`QA-023-ACC-1`) | merge | todo PR que toque `apps/api/src/payments/`, `apps/api/src/stock/`, o `apps/api/src/checkout/orders.repository.ts` |
| k6 p95 < 500 ms (`QA-023-PERF-1`) | release | pre-release |
| E2E cross-stack (`QA-023-E2E-1`) | uat promotion | **suspendido** hasta que exista `PendingPaymentsPanel` — no gatea nada hoy (ver §7) |

---

## 11. Anti-patterns evitados

- ❌ `qa-backend-standards.md` §2.1 ("QA writes all the tests"): unit/integration/e2e-nest de
  `tasks.md` Fase 0-6 son dev-owned y no se re-autoran acá (§2).
- ❌ `testing-standards.md` §14.9 (negative-space ausente): AC-4/AC-5 y la invariante de
  ADR-0008 (`SC-023-N4`) están cubiertas como escenarios explícitos, no solo como happy path.
- ❌ `flakiness-detection` — señal 5 (order dependencies): `SC-023-N2` usa dos requests
  disparados de verdad (concurrencia real contra el endpoint), nunca `sleep`/timing artificial
  para simularla (mismo criterio que `qa-plan.md` de US-010 §10 ya fijó para su propio caso).
  Señal 6 (network calls reales): la suite corre contra la API local levantada por
  `qa-env.ts`/`RECETA_API_QA`, nunca contra un tercero real.
- ❌ Inventar un AC-2 "de UI" que no existe: §7 documenta el bloqueo explícitamente
  (`execution_mode: manual`, `status: blocked`) en vez de escribir un Playwright contra
  selectores inexistentes que rompería en el primer `/develop-qa` (mismo criterio que
  `US-012-panel-ordenes-dueno-qa/qa-plan.md` §6 ya aplicó a los mismos bocetos PP-1/2/3).
- ❌ `k6-load-scaffolding` ("no thresholds block" / "solo promedios"): `QA-023-PERF-1` declara
  `thresholds` con percentiles (p95), nunca solo `avg`, y el `checks` está gateado con
  `rate>0.99` (§6).

---

## 12. Preguntas abiertas / hallazgos

1. **QA-023-F1 (hallazgo, no solo pregunta)**: AC-6 exige que el registro de quién y cuándo
   confirmó sea "trazable para auditoría", pero **ningún endpoint HTTP lo expone** hoy —
   `GET /pending-payment` es deliberadamente angosto (no incluye `payments`) y
   `GET /v1/admin/orders/{id}` (US-012, `AdminOrderDetail`) tampoco incluye `confirmed_by` ni
   `processed_at` (confirmado en `openapi.yaml`, línea que documenta "sin la fila inicial
   pending_payment→new... la escribe payments/, US-023"). Hoy el dueño **no tiene ninguna
   pantalla** donde ver quién confirmó un pago manual — el dato existe solo en la base. Se
   recomienda una de dos vías cuando alguien retome US-012 o abra un change de auditoría: (a)
   extender `AdminOrderDetail` con `confirmed_by`/`processed_at`/`payment_method` cuando
   `provider='manual'`, o (b) un endpoint de auditoría dedicado. **Owner sugerido**: quien
   planifique la próxima extensión de `US-012-panel-ordenes-dueno-backend` o un audit de
   observabilidad — no bloquea este plan (la deviación de §4 SC-023-N3 lo cubre para testing),
   pero sí es una brecha operativa real para el dueño del negocio.
2. **OQ-QA-023-1**: ¿`SC-023-X1` se retoma cuando se retome la Fase 12 de
   `US-012-panel-ordenes-dueno-frontend-web`, o cuando se abra un change nuevo dedicado? No lo
   decide este agente (excede Mode A) — se deja explícito para quien coordine el próximo ciclo.
3. **OQ-QA-023-2**: ¿el seed `seedPendingPaymentOrder` (§8) se comparte con
   `US-008-checkout-guest-*` / `US-010-orden-webhook-stock-backend` cuando esos qa-plans se
   ejecuten (ninguno de los dos tiene todavía código de QA escrito — sus `qa-plan.md` proponen
   `seed-checkout.ts`/`seed-webhook.ts` que tampoco existen aún)? Recomendación: sí — es
   exactamente la misma necesidad (orden `pending_payment` real); quien ejecute primero
   `/develop-qa` sobre cualquiera de los tres changes debería nombrarlo de forma neutral
   (`seed-pending-payment-order.ts`, no `seed-us-023.ts`) para que los otros dos lo reusen sin
   duplicar.

---

## 13. Dependencias declaradas

| Dependencia | Estado | Efecto |
|---|---|---|
| `US-023-pago-manual-offline-backend` (este mismo change) | **Mergeado a `main`** (PR #27, 8/8 fases `[x]`) | Desbloquea todo §4-§6 — ejecutable hoy |
| `US-008-checkout-guest-backend` + `-frontend-web` | Mergeados (checkout real crea `pending_payment`) | El seed de §8 depende de que el checkout real funcione — resuelto |
| `US-012-panel-ordenes-dueno-frontend-web` Fase 12 (`PendingPaymentsPanel`) | **No construida** (T12.1-T12.4 sin marcar, componente ausente del repo) | **Bloquea** `SC-023-X1` / `QA-023-E2E-1` (§7) — único bloqueo real de este plan |
| `US-012-panel-ordenes-dueno-backend` | Mergeado (PR #22) | No bloquea nada de este plan directamente (AC-2 mitad API no lo necesita) |

**Linear MCP**: no conectado en esta sesión — no se anotó ninguna sub-task de tracker. Mode A
normalmente cruza referencias con las tasks de disciplina existentes vía comentario de tracker;
sin MCP conectado, esa acción queda pendiente para cuando se conecte (per skill
`tracker-handoff` §2.4 — "MCP not connected → skip silently is FORBIDDEN": se deja constancia acá
en vez de omitirlo en silencio).

---

## 14. Standards consultados

- `docs/base-standards.md`
- `docs/quality/testing-standards.md` §2 (pirámide), §4.1 (naming), §5 (datos de test), §8
  (coverage), §14 (patrones de código de test), §14.9 (negative space), §18 (anti-patterns)
- `docs/quality/qa-backend-standards.md` §2.1 (ownership matrix), §13 (performance), §15 (datos
  sintéticos), §20 (Go — no aplica, backend acá es Node/NestJS, se usan los patrones equivalentes
  de `testing-standards.md` §14), §21 (BDD y Gherkin)
- `docs/architecture/api-standards.md` §3, §8 (RFC 7807 — verificado contra los dos contratos
  draft y el OpenAPI publicado)
- `docs/architecture/decisions/0008-stock-decrement-on-payment.md` (gobierna `SC-023-N4` y el
  guard de concurrencia de `SC-023-N2`)
- `docs/architecture/decisions/0009-admin-auth-seam-us001.md` (gobierna `SC-023-A1`, RBAC)
- Skills: `qa-three-layer-regression` (modelo de capas aplicado en §2-§7, frontmatter obligatorio
  en §4/§5/§6/§7), `bdd-scenario-quality` (tense declarativo/imperativo, `@wip` no se cuela verde,
  Scenario Outline en `SC-023-A1`/`SC-023-A2`), `k6-load-scaffolding` (thresholds NFR-atados,
  `checks` gateado, sin baseline/stress/soak innecesario — §6), `threat-modeling-lite` (validado
  el STRIDE de `design.md` — el hallazgo QA-023-F1 en §12 es, en esencia, un gap de Repudiation:
  el control existe en la base pero no es observable por ningún humano sin acceso directo),
  `openspec-workflow` (convención de archivo, sin tocar `tasks.md`/`design.md`/`proposal.md`
  existentes), `tracker-handoff` (constancia explícita de MCP no conectado, §13)

---

## 15. Referencias

- User Story: `docs/user-stories/US-023-pago-manual-offline.md`
- E2E: `docs/product/design-e2e.md` §8 (DER — `PAYMENTS`), §12 (FSM de orden — nota "el panel no
  muestra `pending_payment`", excepción declarada por esta US), §14 (STRIDE), §17 (NFRs — p95
  escritura < 500ms)
- Change de backend (este mismo): `proposal.md`, `design.md`, `tasks.md` — los tres cerrados
- Contratos: `contracts/openapi/orders-confirm-payment.yaml`,
  `contracts/openapi/orders-pending-payment.yaml` (mergeados a `apps/api/docs/api/openapi.yaml`
  por T7.1)
- ADR-0008 (decremento de stock al aprobar pago), ADR-0009 (seam de auth admin)
- Changes relacionados: `openspec/changes/US-012-panel-ordenes-dueno-frontend-web/` (Fase 12,
  bloqueante de §7), `openspec/changes/US-012-panel-ordenes-dueno-qa/qa-plan.md` §6 (bocetos
  PP-1/PP-2/PP-3, OQ-QA-2 — cerrado por este documento, ver §7), `openspec/changes/archive/US-008-checkout-guest-backend/qa-plan.md`
  (referencia estructural), `openspec/changes/US-010-orden-webhook-stock-backend/qa-plan.md`
  (derivación de tier compartida)
```
