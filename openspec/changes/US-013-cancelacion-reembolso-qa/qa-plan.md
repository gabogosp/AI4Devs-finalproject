# QA Plan — US-013 Cancelación de orden + reembolso + reintegro de stock (Backend + Frontend, cross-stack)

> **Ticket**: US-013 — Cancelación de orden + reembolso + reintegro de stock
> **Author**: qa-engineer agent
> **Date**: 2026-09-06
> **Status**: Proposed
> **Affected platform(s)**: backend + frontend-web (Layer 3 cross-stack — backend
> **mergeado a `main`** (`e296d3f`, PR #66); frontend-web **PR #67 abierto, no
> mergeado todavía** — stacked sobre el backend)
> **Service tier(s)**: 2 (superficie admin de bajo volumen, ~100 órdenes/mes,
> un solo operador — mismo criterio que `US-012-panel-ordenes-dueno-qa` y
> `US-016-panel-metricas-qa`) **con AC-2/AC-3/AC-8 tratados como Tier 1**:
> ninguno es de alto volumen, pero los tres protegen dinero real (stock que no
> vuelve, un reembolso que no se dispara, un reintegro que se duplica) — mismo
> patrón que `US-006-import-masivo-inventario-qa` aplicó a sus propios AC de
> integridad de negocio.
> **Companion files**: este `qa-plan.md` vive en su propio change sibling
> (`openspec/changes/US-013-cancelacion-reembolso-qa/`, sin `proposal.md`/
> `tasks.md`/`design.md` propios — Modo A no los requiere; la rama de esta
> disciplina, `feat/US-013-cancelacion-reembolso-qa`, no coincidiría con el
> nombre de ningún directorio embebido — mismo motivo documentado por
> `US-016-panel-metricas-qa`). Consume como contexto, sin re-planificarlos:
> `openspec/changes/US-013-cancelacion-reembolso-backend/{proposal,design}.md`
> (mergeado) y
> `openspec/changes/US-013-cancelacion-reembolso-frontend-web/{proposal,design}.md`
> (PR #67 en review).

> **Alcance**: capas **owned-by-QA** (Layer 3 cross-stack, aceptación BDD,
> contract testing, E2E de navegador, accesibilidad, carga, exploratorio). Las
> dev-owned (unit/integration/e2e-nest del backend; unit/component-RTL+MSW del
> frontend) son la TDD de cada disciplina y **no se re-autoran acá** (ownership
> matrix `qa-backend-standards.md` §2.1 / `qa-frontend-standards.md` §2.1).
> **Numeración**: `QA-013-{CATEGORÍA}-{N}` para contract/aceptación/E2E/a11y/
> carga (mismo esquema Modo A que `US-016-panel-metricas-qa`) + `TC-013-E{N}`
> para charters exploratorios.
> **Estado de bloqueo**: la capa de aceptación API-level (backend-only) corre
> **hoy** contra `main` — el backend ya está mergeado. La capa E2E de
> navegador, accesibilidad L3 y el charter de uso real de la UI quedan
> `blocked_by` el merge de `US-013-cancelacion-reembolso-frontend-web` (PR
> #67) — el código ya existe en este worktree (stacked), pero no en `main`
> todavía.

---

## 1. Perfil de riesgo

US-013 cierra el ciclo post-venta del PRD (capacidad 11, §2.1): es la primera
acción del sistema que **revierte** tres efectos que otras tres capacidades ya
comprometieron como definitivos (el decremento de stock de `checkout`/`pagos`,
el cobro real de MercadoPago, y el estado "activa" de una orden en el panel de
`ordenes`). El riesgo no es "la acción no funciona" — el backend ya la probó
en aislamiento con 225/225 tests verdes — es que **la reversión no sea
exactamente simétrica** a lo que otras tres capacidades hicieron, y que nada
de eso se note desde el proceso de un solo módulo.

| Riesgo | Por qué importa acá |
|---|---|
| **El stock que se reintegra no es el que realmente se decrementó** | El backend prueba `incrementForOrder` contra fixtures propias (`prisma.order.create` directo, `cancel-order.service.spec.ts`). Ningún test de un solo módulo compara la cancelación contra el **decremento real** que produjo `checkout`/`confirm-payment`/`simulate-payment` — si un futuro cambio de redondeo o de agrupación por `product_id` divergiera entre el decremento y el reintegro, ningún test aislado lo vería. |
| **AC-3 (reembolso real MercadoPago) es estructuralmente no verificable en este entorno, y hay que decirlo explícito, no ocultarlo** | Sin cuenta sandbox (mismo hallazgo que `QA-010-F1`), y sin ningún camino de API real en este entorno que produzca una orden con un pago `provider='mercadopago'` `approved` (el webhook real de US-010 necesita que `MercadoPagoClient.getPayment` devuelva `approved` de verdad) — no hay siquiera un punto de partida black-box para ejercitar el reembolso real. Si este gap no se declara con la misma explicitud que `QA-010-F1`, alguien puede asumir que "ya está probado" cuando sólo lo está dev-owned con el cliente mockeado por DI. |
| **AC-8 es la garantía que más dinero protege de toda la US** | Reintegrar el stock dos veces (por un reintento, una carrera, o el futuro job de reconciliación que toque esta ruta) infla el catálogo en silencio — nadie lo nota hasta que se vende stock que no existe. La idempotencia es "estructural" del lado del backend (`UPDATE ... WHERE status IN (...)`), pero eso es una garantía de diseño, no una medida contra el proceso real bajo concurrencia real. |
| **`cancelled` deja de ser un estado alcanzable únicamente por un bridge de siembra** | Hasta este change, la ÚNICA forma de que una orden QA llegara a `cancelled` era `puentearACancelled` (`seed-ordenes.ts`, `UPDATE` directo vía `@dsm/db`) o `crearOrdenCanceladaPorStock` (`seed-metricas.ts`, cancelación automática por falta de stock). Ninguna suite existente verificó jamás que una orden cancelada **por este endpoint nuevo** produce el mismo efecto observable (ausente del listado, visible por id, excluida de las métricas) que esas dos rutas alternativas. |
| **El gate de visibilidad del botón "Cancelar orden" es sólo superficie — si el backend cambiara su guard sin que nadie lo notara, la UI seguiría mostrando el botón** | `design.md` del frontend lo dice explícito (D3): "la superficie FE decide qué ofrecer, nunca qué permitir". Ningún test de un solo módulo cruza "el botón está oculto" con "el backend además rechaza" contra el mismo par backend+frontend reales. |
| **La confirmación de dos pasos (AC-6) es la única superficie 100% nueva de toda la US** | Todo lo demás reusa mecanismos ya construidos (`refund_pending`/`retry-refunds`, `NotificationPort`, `order_status_history`). El flujo de escribir "CANCELAR" en un input real, contra un backend real, sin datos de prueba amañados, nunca se ejecutó — el componente en sí ya tiene test unitario (RTL+MSW), pero no contra la API real. |

Journeys críticos identificados:
1. El dueño abre el detalle de una orden `new`/`preparing`/`ready`, cancela con
   la confirmación de dos pasos, y ve reflejado en la misma pantalla el nuevo
   estado, el resultado del reembolso y la fila nueva del historial (AC-1,
   AC-2, AC-4, AC-6, AC-10).
2. El dueño intenta cancelar una orden que ya no puede cancelarse (entregada,
   o ya cancelada) y el sistema lo protege en las dos puntas: la UI no ofrece
   el botón, y si de todos modos llegara la petición, el backend la rechaza
   (AC-7).
3. Un visitante sin sesión de dueño (incluida una cuenta de cliente real)
   nunca puede ejercer esta acción (AC-9).

---

## 2. Mapeo de la pirámide (capas QA en negrita)

| Capa | Dueño | Estado |
|---|---|---|
| Unit backend (`cancel-order.service.spec.ts`, `payment-confirmation-errors`) | dev | ✅ construido — `US-013-cancelacion-reembolso-backend/tasks.md` (mergeado, PR #66) |
| Integration/E2E-nest backend (`e2e-payments-cancel-order.spec.ts` con `MercadoPagoClient` mockeado por DI, `e2e-rbac.spec.ts` extendido) | dev | ✅ construido — mergeado |
| Unit/component frontend (Vitest+RTL+MSW: `ordersService.test.ts`, `OrderCancelAction.test.tsx`, `OrderDetail.test.tsx`, `orders.events.test.tsx`, `a11y.test.tsx` de componente) | dev | ✅ construido — `US-013-cancelacion-reembolso-frontend-web/tasks.md`, PR #67 mergeado a `main` el 2026-09-06 |
| **Aceptación BDD cross-stack (API-level, contra Postgres real)** | **QA** | este plan — **ejecutable hoy** (backend en `main`) |
| **Contract testing** (`cancel-order` vs OpenAPI publicado) | **QA** | este plan — **ejecutable hoy** |
| **E2E de navegador cross-stack** (backend + frontend reales) | **QA** | este plan — **ejecutable hoy**, ver corrección §5.0/§5.3 |
| **Accesibilidad L3** (axe + teclado sobre la página servida, con el diálogo real abierto) | **QA** | este plan — **ejecutable hoy**, ver corrección §5.0/§5.3 |
| **Carga (k6)** | **QA** | este plan — **ejecutable hoy** (sólo backend) |
| **Exploratorio** | **QA** | este plan (manual) — mixto, ver §5.6 |

### 2.1 Nota de cobertura dev-owned (awareness, no se re-autora)

**Backend** (`US-013-cancelacion-reembolso-backend/tasks.md`, mergeado): el
algoritmo completo de `CancelOrderService.cancel()` con `Postgres` real y
`MercadoPagoClient` **mockeado por DI de NestJS** — incluye el camino
`mercadopago` marcado `refunded` (T8.1, `e2e-payments-cancel-order.spec.ts`),
los 7 escenarios obligatorios de `cancel-order.service.spec.ts` (guard de FSM,
idempotencia estructural, no-op de `simulated_dsm`/`manual`), el barrido de
RBAC extendido (T8.2), y que `changed_by` sale del `sub` del JWT. **Esto es
exactamente lo que la capa QA NO puede replicar black-box**: ningún mecanismo
de este entorno permite sustituir `MercadoPagoClient` sin tocar
`apps/api/src/` (ver §7, hallazgo QA-013-F1) — la cobertura del camino
`mercadopago`→`refunded` real es, y sigue siendo, dev-owned.

**Frontend** (`US-013-cancelacion-reembolso-frontend-web/tasks.md`, PR #67):
los 5 estados del componente contra MSW (T3.x-T5.x), la idempotencia visual
(doble-click no dispara un segundo `POST`, T4.2), el foco/Escape del diálogo
(T4.3), los 3 mensajes de `refund.status` incluido `refund_pending` (con
MSW simulando esa respuesta — algo que la capa QA no puede producir
black-box, ver §7), y la ausencia de PII en los 3 eventos de negocio (T6.2).

**Nada de eso se repite acá.** Este plan ejercita exactamente lo que ninguna
de las dos capas dev-owned puede ver desde su propio proceso: el reintegro de
stock contra el decremento real de otra capacidad, la cancelación de una orden
que otras tres capacidades (checkout, panel de fulfillment, panel de
métricas) ya conocían, la concurrencia real de dos llamadas simultáneas, y la
confirmación de dos pasos contra un backend real, en un navegador real.

---

## 3. Matriz de trazabilidad: AC × capa

Leyenda: **DEV** = TDD de la disciplina (ya construida) · **QA-ACC** =
aceptación API-level, este plan · **QA-CT** = contract testing, este plan ·
**QA-E2E** = E2E de navegador cross-stack, este plan · **QA-A11Y** = este plan
· **QA-CARGA** = este plan · **—** = no aplica.

| AC | DEV (awareness) | **QA-ACC** | **QA-CT** | **QA-E2E** | **QA-A11Y** | **QA-CARGA** |
|---|---|---|---|---|---|---|
| **AC-1** cancelar orden no entregada | DEV | **H-1** | **QA-013-CT-1** | **E-1**, **E-2** | — | **L-1** |
| **AC-2** stock se reintegra | DEV | **H-1**, **X-1** | — | — | — | — |
| **AC-3** reembolso real MercadoPago | DEV (mockeado por DI — ver §2.1/§7) | **bloqueado** (QA-013-F1) | — | — | — | — |
| **AC-4** aviso al comprador (trigger) | DEV | **H-1** | — | — | — | — |
| **AC-5** pago simulado — no-op | DEV | **H-2** | — | **E-3** (parcial, ver §7) | — | **L-1** |
| **AC-6** confirmación de dos pasos | DEV (componente, MSW) | — | — | **E-1** | **A-1** | — |
| **AC-7** no cancela orden entregada | DEV | **N-1** | **QA-013-CT-1** | **E-2**, **E-4** | — | — |
| **AC-8** reintegro idempotente | DEV (estructural) | **C-1**, **C-2** | — | — | — | — |
| **AC-9** sólo admin | DEV | **N-2** | — | **E-6** | — | — |
| **AC-10** trazabilidad | DEV | **H-1** | — | **E-5** | — | — |
| **NFR** p95 escritura camino sin llamada externa < 200ms (`design.md` §D8 backend) | — | — | — | — | — | **QA-013-PERF-1** |

**Las 10 AC tienen ≥1 tratamiento QA explícito** — incluida AC-3, que no
queda huérfana ni "asumida cubierta": está declarada `bloqueado`, con la
razón exacta y la cobertura dev-owned que la sustituye (§7).

---

## 4. Escenarios Gherkin

`Feature: qa/acceptance/features/cancelacion-ordenes.feature`, tag de feature
`@cancelacion-ordenes`. Gherkin en español (`# language: es`), mismo criterio
que el resto de la suite. Los pasos corren contra `Playwright.request`
(`APIRequestContext`), convención real del repo desde la corrección de
`US-023-pago-manual-offline-qa` — no `supertest`.

**Siembra**: reusa `qa/support/seed-metricas.ts` (`crearOrdenActiva`,
`crearOrdenPendiente`, `simularPagoAutomatico`, `catalogoParaMetricas`) — ver
§6 para el detalle de por qué no hace falta ningún seeding nuevo. La
cancelación en sí (la acción bajo prueba) se ejerce siempre por
`POST /v1/admin/orders/{id}/cancel` real, nunca por un bridge.

### 4.1 Happy path

```gherkin
@happy @critical-path
Esquema del escenario: H-1 — Cancelar una orden activa reintegra el stock, resuelve el reembolso y deja trazabilidad
  Dado una orden real confirmada por pago manual, en estado "<estado>", con un ítem de 2 unidades
  Y el stock de ese producto antes de cancelar
  Cuando el dueño la cancela
  Entonces la orden queda "cancelada"
  Y el stock del producto vuelve a su valor de antes de la orden
  Y el sistema dispara el aviso de cancelación al comprador
  Y el historial registra quién canceló y cuándo
  Y el pago de la orden queda "reembolsado"

  Ejemplos:
    | estado    |
    | new       |
    | preparing |
    | ready     |

@happy
Escenario: H-2 — Cancelar una orden pagada con el medio simulado deja el reembolso resuelto sin llamada externa
  Dado una orden real confirmada por el medio simulado "DSM"
  Cuando el dueño la cancela
  Entonces la orden queda "cancelada" y el stock se reintegra
  Y el pago queda "reembolsado" sin que el sistema haya llamado a ningún proveedor externo
```

### 4.2 Corner (condiciones de borde)

```gherkin
@corner @critical-path
Escenario: C-1 — Repetir la cancelación de una orden ya cancelada no reintegra el stock una segunda vez
  Dado una orden real que el dueño ya canceló
  Cuando el dueño repite exactamente esa misma cancelación
  Entonces la respuesta sigue siendo exitosa
  Y el stock del producto no vuelve a incrementarse
  Y el historial de la orden no gana una segunda entrada de cancelación

@corner @critical-path
Escenario: C-2 — Dos cancelaciones simultáneas de la misma orden no reintegran el stock dos veces
  Dado una orden real activa con un ítem de stock conocido
  Cuando se disparan dos cancelaciones simultáneas para esa misma orden
  Entonces exactamente una aplica la transición de estado
  Y el stock del producto queda incrementado una sola vez, nunca el doble
```

### 4.3 Negative (negative-space — lo que NO tiene que pasar)

```gherkin
@negative @critical-path
Esquema del escenario: N-1 — Cancelar una orden que no puede cancelarse se rechaza sin cambiar nada
  Dado "<condición>"
  Cuando el dueño intenta cancelarla
  Entonces recibo <código>
  Y ningún stock del producto involucrado cambia
  Y ningún pago cambia de estado

  Ejemplos:
    | condición                                    | código |
    | una orden real ya entregada                  | 409    |
    | una orden real todavía sin confirmar el pago | 404    |
    | un id que no corresponde a ninguna orden real| 404    |

@negative @critical-path
Escenario: N-2 — Sin sesión de dueño, ni con sesión de cliente real, se puede cancelar una orden
  Dado un visitante sin ninguna sesión
  Cuando intenta cancelar una orden real activa
  Entonces el sistema deniega la solicitud
  Cuando una cuenta de cliente real (US-014, sesión válida pero no admin) lo intenta
  Entonces el sistema la deniega igual que al visitante sin sesión
  Y la orden permanece sin cambios en los dos casos
```

### 4.4 Cross-feature (Layer 3 — cruzan disciplinas o US)

```gherkin
@cross-feature @critical-path
Escenario: X-1 — El stock reintegrado es exactamente el que decrementó el ciclo real de checkout y confirmación
  Dado un producto con stock conocido antes de cualquier venta
  Y un cliente que completó un checkout real de 3 unidades de ese producto (US-008)
  Y esa orden confirmada por pago manual real (US-023)
  Cuando el dueño cancela esa orden
  Entonces el stock del producto vuelve exactamente al valor previo a la venta
  # Cruza checkout (US-008) + confirmación de pago (US-023) con cancelación
  # (US-013). Ningún test de un solo módulo compara el reintegro contra el
  # decremento REAL de otra capacidad — el backend de esta US siembra sus
  # propias fixtures con Prisma directo para probar incrementForOrder.

@cross-feature
Escenario: X-2 — Una orden recién cancelada por este endpoint deja de contar como venta en el panel de métricas
  Dado una orden real confirmada por pago manual, ya contabilizada en el resumen del panel de métricas (US-016)
  Cuando el dueño la cancela
  Entonces el resumen de métricas para el período que la incluye ya no la cuenta en `orders_count`
  Y su monto ya no aporta a `total_ars_cents`
  # Cruza reports (US-016) con cancelación (US-013). El allowlist de "venta"
  # de reports/ excluye "cancelled" desde su propio diseño, pero hasta este
  # change la única forma de llegar a "cancelled" en una suite QA era un
  # bridge vía @dsm/db (seed-metricas.ts, crearOrdenCanceladaPorStock) o el
  # camino de auto-cancelación por falta de stock — nunca una cancelación
  # deliberada del dueño por este endpoint.

@cross-feature
Escenario: X-3 — Una orden recién cancelada por este endpoint sigue consultable por id en el panel de fulfillment, pero desaparece del listado sin filtro
  Dado una orden real activa, visible en el listado sin filtro del panel de órdenes (US-012)
  Cuando el dueño la cancela
  Entonces el detalle de esa orden sigue abriéndose por su id, con el nuevo estado
  Y esa orden ya no aparece en el listado sin filtro del panel
  # Cruza el panel de fulfillment (US-012) con cancelación (US-013). Mismo
  # comportamiento que C-1 de `US-012-panel-ordenes-dueno-qa` verificó en su
  # momento contra una orden cancelada por bridge (puentearACancelled) —
  # este escenario es la primera vez que se verifica contra una orden
  # cancelada por el endpoint real.
```

**Tooling**: Cucumber-js con `qa/acceptance/steps/cancelacion-ordenes.steps.ts`
(Playwright `APIRequestContext`).
**Location**: `qa/acceptance/features/cancelacion-ordenes.feature`.
**Reuses**: `qa/support/admin-auth.ts` (login real de dueño),
`qa/support/customer-auth.ts` (sesión real de cliente, N-2),
`qa/support/seed-metricas.ts` (`crearOrdenActiva`, `crearOrdenPendiente`,
`simularPagoAutomatico`, `catalogoParaMetricas` — sin extensión), y agrega un
helper de una sola función (`cancelarOrden`, ver §6) que llama al endpoint
bajo prueba.

---

## 5. Test cases owned-by-QA

### 5.0 Índice

| Test case | Escenario(s) | Herramienta | Layer | Bloqueado por |
|---|---|---|---|---|
| QA-013-ACC-1 | H-1, H-2, C-1, C-2, N-1, N-2 | Cucumber+Playwright | 3 | — (ejecutable hoy) |
| QA-013-ACC-2 | X-1 | Cucumber+Playwright | 3 | — (ejecutable hoy) |
| QA-013-ACC-3 | X-2 | Cucumber+Playwright | 3 | — (ejecutable hoy) |
| QA-013-ACC-4 | X-3 | Cucumber+Playwright | 3 | — (ejecutable hoy) |
| QA-013-CT-1 | contrato `cancel-order` | tsx standalone (`qa/contract/`) | 3 | — (ejecutable hoy) |
| QA-013-E2E-1 | E-1 (confirmación de dos pasos, AC-6) | Playwright | 3 | — (verde) |
| QA-013-E2E-2 | E-2 (botón oculto por estado, AC-1/AC-7) | Playwright | 3 | — (verde) |
| QA-013-E2E-3 | E-3 (mensaje según `refund.status`, AC-5 parcial) | Playwright | 3 | — (verde, ver Estado — encontró un defecto real, resuelto por PR #72) |
| QA-013-E2E-4 | E-4 (409 real, diálogo permanece abierto, AC-7) | Playwright | 3 | — (verde) |
| QA-013-E2E-5 | E-5 (historial visible sin recargar, AC-10) | Playwright | 3 | — (verde) |
| QA-013-E2E-6 | E-6 (acceso denegado end-to-end, AC-9) | Playwright | 3 | — (verde) |
| QA-013-A11Y-1 | NFR WCAG 2.1 AA + teclado (diálogo real abierto) | axe-core+Playwright | 3 | — (verde) |
| QA-013-PERF-1 | L-1 (NFR p95 < 200ms, camino sin llamada externa) | k6 | 3 | — (verde) |
| TC-013-E1 | charter | manual | 3 | — (ejecutable hoy) |
| TC-013-E2 | charter | manual | 3 | — |

**Por herramienta**: Cucumber+Playwright 4 · tsx standalone 1 · Playwright 6 ·
axe-core+Playwright 1 · k6 1 · charter manual 2. **15 test cases, las 13
automatizadas verdes** (QA-013-ACC-1..4, QA-013-CT-1, QA-013-E2E-1..6,
QA-013-A11Y-1, QA-013-PERF-1) **+ 2 charters manuales documentados**.

**Corrección respecto a la versión original de este plan**: cuando se
planificó, `US-013-cancelacion-reembolso-frontend-web` (PR #67) todavía no
había mergeado a `main`, y esta sección declaraba 8 test cases "bloqueados"
por ese merge. Eso resultó innecesariamente conservador: este worktree ya
estaba stacked sobre la rama del FE (el código de `OrderCancelAction.tsx` ya
existía acá), así que `apps/web` se pudo construir y servir directo desde
este worktree sin esperar el merge — nada estuvo realmente bloqueado. PR #67
mergeó a `main` el 2026-09-06 mientras este plan se ejecutaba, volviendo el
punto discutible en la práctica, pero se corrige acá para que quien lea este
plan más tarde no interprete "bloqueado por PR #67" como una limitación real
del entorno.

### 5.1 Aceptación BDD API-level

```yaml
- id: QA-013-ACC-1
  scenario: H-1, H-2, C-1, C-2, N-1, N-2
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "cancelacion-ordenes.feature — happy/corner/negative"
  name: CancelacionDeOrdenes_Aceptacion_HappyCornerYNegativoContraLaApiReal
```

- Exit criterion: los 8 escenarios de `cancelacion-ordenes.feature` (H-1×3
  ejemplos, H-2, C-1, C-2, N-1×3 ejemplos, N-2) pasan contra la API real +
  Postgres real, sembrando por `seed-metricas.ts` (checkout real + confirmación
  real + `PATCH` real), nunca por `prisma.order.create`/`@dsm/db` directo.
- Verify: `pnpm --filter @dsm/qa test:acceptance -- --tags "@cancelacion-ordenes and not @cross-feature"` (exit 0)
- **Estado**: verde — 10 escenarios/58 steps en 0 (H-1×3, H-2, C-1, C-2, N-1×3,
  N-2). `qa/acceptance/features/cancelacion-ordenes.feature` +
  `qa/acceptance/steps/cancelacion-ordenes.steps.ts`. Corrido directo con
  `cucumber-js` (el `--` de `pnpm --filter @dsm/qa <script> -- --flag` reenvía
  literal al hijo y produce `ENOENT`, mismo hallazgo de entorno ya documentado
  por `US-016-panel-metricas-qa`).

```yaml
- id: QA-013-ACC-2
  scenario: X-1
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "X-1 — reintegro exacto contra el decremento real de checkout+confirmación"
  name: CancelacionDeOrdenes_ReintegraElStockExactoQueDecrementoElCicloRealDeCheckoutYConfirmacion
```

- Exit criterion: el stock del producto, leído antes de la venta y después de
  cancelar, es idéntico — la orden nació 100% de `POST /v1/checkout` +
  `POST /admin/orders/{id}/confirm-payment` reales, sin `INSERT`/`UPDATE`
  directo.
- Verify: `pnpm --filter @dsm/qa test:acceptance -- --tags "@cross-feature and @cancelacion-ordenes"` (exit 0)
- **Estado**: verde — cubierto en la misma corrida de 3 escenarios/13 steps
  (X-1, X-2, X-3) — ver Estado de QA-013-ACC-4.

```yaml
- id: QA-013-ACC-3
  scenario: X-2
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "X-2 — deja de contar como venta en el panel de métricas"
  name: CancelacionDeOrdenes_UnaOrdenReciénCancelada_DejaDeContarComoVentaEnElPanelDeMetricas
```

- Exit criterion: `GET /v1/admin/reports/summary` para el período que incluye
  la orden refleja `orders_count`/`total_ars_cents` sin esa orden, **después**
  de cancelarla con el endpoint real (antes de cancelar, sí contaba).
- Verify: `pnpm --filter @dsm/qa test:acceptance -- --tags "@cross-feature and @cancelacion-ordenes"` (exit 0, mismo comando que ACC-2 — misma corrida cubre ambos tags)
- **Estado**: verde — cubierto en la misma corrida de 3 escenarios/13 steps
  (X-1, X-2, X-3) — ver Estado de QA-013-ACC-4.

```yaml
- id: QA-013-ACC-4
  scenario: X-3
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "X-3 — consultable por id, ausente del listado sin filtro"
  name: CancelacionDeOrdenes_UnaOrdenReciénCancelada_ConsultablePorIdPeroAusenteDelListadoSinFiltro
```

- Exit criterion: `GET /v1/admin/orders/{id}` sigue devolviendo 200 con
  `status: "cancelled"`; `GET /v1/admin/orders` sin filtro no incluye ese
  `order_number` en ninguna página.
- Verify: mismo comando que ACC-2/ACC-3 (los 3 escenarios `@cross-feature`
  corren en la misma invocación).
- **Estado**: verde — `pnpm --filter @dsm/qa test:acceptance -- --tags
  "@cross-feature and @cancelacion-ordenes"` → 3 escenarios/13 steps en 0
  (X-1, X-2, X-3), Postgres descartable propio + API/web reales de este
  worktree. Corrido directo con `cucumber-js` (mismo hallazgo de entorno del
  `--` documentado en QA-013-ACC-1).

### 5.2 Contract testing

```yaml
- id: QA-013-CT-1
  scenario: contrato `cancel-order`
  execution_mode: automated
  test_layer: 3
  target_tooling: tsx standalone (qa/contract/)
  gherkin_scenario: "contrato POST /v1/admin/orders/{id}/cancel vs OpenAPI publicado"
  name: CancelOrder_ContratoVsOpenApiPublicado_200Con409Y404YRefundShapeValidados
```

- Exit criterion: `qa/contract/cancel-order.contract.ts` (mismo formato real
  que `qa/contract/reports.contract.ts`/`pago-manual.contract.ts`, no
  `supertest`/`--testPathPattern`) valida que el 200 (`CancelOrderResponse`,
  incluidos los campos `refund.status`/`refund.provider`), el 409
  (`dsm:payments/order-cannot-be-cancelled`) y el 404
  (`dsm:payments/order-not-found`) coincidan con los schemas declarados en
  `apps/api/docs/api/openapi.yaml`, sin campos ausentes ni de más.
- Verify: `pnpm --filter @dsm/qa test:contract:cancel-order` (exit 0)
- **Estado**: verde — `pnpm exec tsx contract/cancel-order.contract.ts` →
  `✓ cancel-order conforma el contrato — 6/6 casos` contra la API real
  (Postgres descartable propio). Requiere `QA_WEB_BASE_URL` exportado además
  de `QA_API_BASE_URL` — el checkout de siembra (`seed-metricas.ts`) valida
  el `Origin` contra la allowlist de CORS.

### 5.3 E2E de navegador cross-stack (Playwright, backend + frontend reales)

> **CORRECCIÓN (ejecución, `/develop-qa`)**: esta sección decía "bloqueada por
> el merge de PR #67" al planificarse — no lo está. Este worktree está
> stacked sobre la rama de `US-013-cancelacion-reembolso-frontend-web` (PR
> #67), así que `apps/web` se construyó y sirvió DESDE ACÁ (no desde `main`)
> con `pnpm --filter @dsm/web build && start`, contra el backend real de este
> mismo worktree. Mismo criterio ya aplicado por `US-016-panel-metricas-qa`.
> Las 6 corrieron; ver Estado por test case abajo — **QA-013-E2E-3 encontró
> un defecto real** (no un bloqueo de entorno), **resuelto 2026-09-06 vía
> PR #72 y re-verificado — las 6 quedan verdes contra el código corregido**.

| Escenario | Definición | AC |
|---|---|---|
| **E-1** | Click en "Cancelar orden" abre el diálogo; el botón de confirmar permanece deshabilitado hasta tipear "CANCELAR" exacto; sólo entonces se dispara la llamada real y la orden queda cancelada | AC-1, AC-6 |
| **E-2** | El botón "Cancelar orden" no se renderiza en el detalle de una orden `delivered` ni `cancelled` | AC-1, AC-7 (superficie) |
| **E-3** | En éxito, el mensaje distingue "reembolsado" (orden pagada por medio simulado o manual) de "sin pago que reembolsar" | AC-5 (parcial — ver nota abajo) |
| **E-4** | Un 409 real del backend (orden ya cancelada por otra pestaña, o entregada) muestra el mensaje específico y el diálogo permanece abierto | AC-7 (negativo) |
| **E-5** | Tras cancelar con éxito, el historial de estado (`OrderStatusHistory`, componente existente) muestra la fila nueva sin recargar la página | AC-10 |
| **E-6** | Un visitante sin sesión de admin, y una cuenta de cliente real (US-014), no ven el panel ni pueden ejercer la acción | AC-9 |

**Nota sobre E-3**: el tercer mensaje posible (`refund_pending` — "el
reembolso quedó en curso") **no es reproducible black-box** en este entorno:
sólo aparece cuando el pago es `provider='mercadopago'` y la llamada real a
MercadoPago falla — y como ninguna orden con ese proveedor es alcanzable por
API real acá (mismo hallazgo que QA-013-F1, §7), E-3 sólo ejercita
`refunded`/`not_applicable`. La variante `refund_pending` ya está cubierta
dev-owned (`OrderCancelAction.test.tsx`, con MSW simulando esa respuesta).

```yaml
- id: QA-013-E2E-1
  scenario: E-1
  execution_mode: automated
  test_layer: 3
  target_tooling: Playwright
  gherkin_scenario: "E-1 — confirmación de dos pasos contra un backend real (AC-1/AC-6)"
  name: OrderCancelActionUI_TipeaCancelarYConfirma_DisparaLaCancelacionRealYActualizaElEstado
```

- Exit criterion: con una orden real en `new`, el botón "Cancelar orden" abre
  el diálogo; el botón de confirmar está deshabilitado mientras el input no
  coincide con "CANCELAR" (`page.getByLabel('Escribí "CANCELAR" para
  confirmar')`); tipear exactamente "CANCELAR" habilita el confirmar;
  clickearlo dispara `page.waitForResponse` al `POST .../cancel` real y el
  badge de estado cambia a "Cancelada" sin recargar.
- Verify: `pnpm --filter @dsm/qa test:e2e -- --grep "QA-013-E2E-1" --reporter=list` (exit 0)
- **Estado**: verde — `qa/e2e/cancelacion-ordenes.spec.ts`, contra backend+web
  reales servidos desde este worktree.

```yaml
- id: QA-013-E2E-2
  scenario: E-2
  execution_mode: automated
  test_layer: 3
  target_tooling: Playwright
  gherkin_scenario: "E-2 — botón oculto por estado terminal (AC-1/AC-7 superficie)"
  name: OrderCancelActionUI_OrdenEntregadaOCancelada_NoRenderizaElBotonDeCancelar
```

- Exit criterion: en el detalle de una orden real `delivered` y de una orden
  real `cancelled`, `page.getByRole('button', { name: 'Cancelar orden' })`
  tiene cuenta 0 en ambos casos.
- Verify: `pnpm --filter @dsm/qa test:e2e -- --grep "QA-013-E2E-2" --reporter=list` (exit 0)
- **Estado**: verde.

```yaml
- id: QA-013-E2E-3
  scenario: E-3
  execution_mode: automated
  test_layer: 3
  target_tooling: Playwright
  gherkin_scenario: "E-3 — mensaje según refund.status, variantes alcanzables (AC-5 parcial)"
  name: OrderCancelActionUI_TrasCancelarConMedioManualOSimulado_MuestraElMensajeDeReembolsoCorrecto
```

- Exit criterion: cancelar una orden pagada por confirmación manual muestra
  "Se canceló la orden y se reintegró el pago."; cancelar una orden pagada
  por el medio simulado muestra el mismo mensaje (ambos casos son `refunded`
  sin llamada externa, D3 del backend).
- Verify: `pnpm --filter @dsm/qa test:e2e -- --grep "QA-013-E2E-3" --reporter=list` (exit 0)
- **Estado**: 🟢 VERDE — **RESUELTO 2026-09-06** (`fix/US-013-cancel-result-message-not-shown`,
  PR #72). Se había encontrado un **defecto real en `apps/web`, no un problema
  de entorno ni de este test**: el mensaje de resultado
  (`REFUND_MESSAGE[refund.status]`, `OrderCancelAction.tsx`) nunca llegaba a
  verse — el componente arrancaba con
  `if (order.status === 'delivered' || order.status === 'cancelled') return null;`
  ANTES del JSX que renderiza `{message && <div role="status">{message}</div>}`.
  `confirm()` llama `setMessage(...)` y, en el mismo ciclo, `onCancelled(cancelado)`
  — que en `OrderDetail.tsx` reemplaza el `order` completo por el que devolvió
  el `200` (con `status: 'cancelled'`). En el render siguiente,
  `OrderCancelAction` recibía `order.status === 'cancelled'` y el early-return
  cortaba ANTES de llegar al div del mensaje. **Hallazgo secundario, menor, en
  el mismo componente, también resuelto**: la fila de historial mostraba
  "Nueva → cancelled" (inglés crudo) en vez de "Nueva → Cancelada" —
  `STATUS_LABEL` de `orderStatus.ts` no tiene (deliberadamente) una entrada
  para `cancelled`; la traducción se agregó en el `label()` propio de
  `OrderStatusHistory.tsx`. Fix aplicado: separa "ofrecer una nueva
  cancelación" (gated por estado terminal) de "mostrar el resultado de la
  última acción" (siempre se renderiza si hay mensaje/error) — con test de
  regresión que reproduce el re-render real del padre. **Re-verificado en esta
  sesión, independientemente**, con el fix aplicado (cherry-pick local de
  `0091611`, no incluido en este PR de QA — vive en #72): QA-013-E2E-1..6
  (6/6), QA-013-A11Y-1a/1b (2/2), QA-013-ACC-1..4 (13/13 escenarios, 71/71
  steps), QA-013-CT-1 (6/6) y QA-013-PERF-1 (p95 15.31ms) TODOS verdes contra
  el código corregido.

```yaml
- id: QA-013-E2E-4
  scenario: E-4
  execution_mode: automated
  test_layer: 3
  target_tooling: Playwright
  gherkin_scenario: "E-4 — 409 real, diálogo permanece abierto (AC-7 negativo)"
  name: OrderCancelActionUI_Conflicto409DelBackendReal_MuestraElMensajeEspecificoYElDialogoSigueAbierto
```

- Exit criterion: forzando una carrera real (dos `POST` casi simultáneos vía
  `page.route` que deja pasar el segundo después de que el primero ya
  canceló, o navegando directo a una orden ya entregada y disparando la
  cancelación desde el DOM), el segundo intento responde 409 real, el mensaje
  "La orden ya no puede cancelarse..." aparece, y el diálogo de confirmación
  sigue montado (`page.getByRole('dialog')` visible).
- Verify: `pnpm --filter @dsm/qa test:e2e -- --grep "QA-013-E2E-4" --reporter=list` (exit 0)
- **Estado**: verde — **corrección respecto al diseño original del test**: cancelar
  la MISMA orden dos veces (mi diseño inicial) es idempotente (200, D3 del
  backend), nunca 409 — no reproduce la carrera. El 409 real sólo aparece
  cuando la orden pasa a `delivered` (estado terminal) por fuera mientras el
  diálogo sigue abierto — reescrito para avanzar la orden por los 3 `PATCH`
  reales (`preparing`→`ready`→`delivered`) antes del click de confirmar,
  mismo patrón que `ordenes.spec.ts` TC-1223.

```yaml
- id: QA-013-E2E-5
  scenario: E-5
  execution_mode: automated
  test_layer: 3
  target_tooling: Playwright
  gherkin_scenario: "E-5 — historial visible sin recargar (AC-10)"
  name: OrderCancelActionUI_TrasCancelarConExito_OrderStatusHistoryMuestraLaFilaNuevaSinRecargar
```

- Exit criterion: tras cancelar con éxito, sin ninguna navegación ni
  recarga, la tabla de `OrderStatusHistory` en la misma página muestra una
  fila nueva con `to_status` "Cancelada".
- Verify: `pnpm --filter @dsm/qa test:e2e -- --grep "QA-013-E2E-5" --reporter=list` (exit 0)
- **Estado**: verde — el conteo de filas del historial crece en 1 sin
  navegación/recarga. El hallazgo secundario de QA-013-E2E-3 (el TEXTO de esa
  fila mostraba "cancelled" en vez de "Cancelada") está resuelto por el mismo
  fix (PR #72) — re-verificado, la fila ahora muestra "Cancelada".

```yaml
- id: QA-013-E2E-6
  scenario: E-6
  execution_mode: automated
  test_layer: 3
  target_tooling: Playwright
  gherkin_scenario: "E-6 — acceso denegado end-to-end (AC-9)"
  name: OrderCancelActionUI_SinSesionDeAdminNiConSesionDeClienteReal_NoEjerceLaAccion
```

- Exit criterion: un visitante sin sesión que navega directo al detalle de
  una orden real no ve el panel (`AdminGuard` de FE redirige); una cuenta de
  cliente real (US-014, login real) tampoco.
- Verify: `pnpm --filter @dsm/qa test:e2e -- --grep "QA-013-E2E-6" --reporter=list` (exit 0)
- **Estado**: verde — visitante sin sesión Y cuenta de cliente real (US-014,
  registrada por API real, cookie `dsm_access` transplantada al contexto del
  navegador vía `page.context().addCookies(...)` — sesión real, no un mock)
  ambas redirigidas a `/admin/acceso`. El guard del FE (`adminSession`) sólo
  mira el token admin en `sessionStorage`, así que ninguna cookie de cliente
  lo satisface.

### 5.4 Accesibilidad L3 (axe-core + teclado, página servida con el diálogo real abierto)

> **Sin duplicación con la capa dev-owned**: `a11y.test.tsx` del FE corre
> `jest-axe` sobre `OrderDetail` con `OrderCancelAction` visible, en jsdom.
> Esta capa corre en un navegador real, con el `ConfirmDialog` efectivamente
> **abierto** (focus trap real, no simulado) y el layout `(admin)` completo.

| Escenario | Definición |
|---|---|
| **A-1** | 0 violaciones WCAG 2.1 AA en `OrderDetail` con `OrderCancelAction` visible y con el `ConfirmDialog` real abierto; navegable y operable sólo con teclado |

```yaml
- id: QA-013-A11Y-1
  scenario: A-1
  execution_mode: automated
  test_layer: 3
  target_tooling: axe-core+Playwright
  gherkin_scenario: "NFR — 0 violaciones AA con el diálogo de confirmación real abierto"
  name: OrderCancelActionUI_SinViolacionesAA_ConElDialogoDeConfirmacionRealAbierto
```

- Exit criterion: 0 violaciones `serious`/`critical` en el detalle de una
  orden con el diálogo cerrado y con el diálogo abierto (foco atrapado
  dentro, `role="dialog"` + `aria-modal`, `Escape` cierra); el input de
  confirmación y los 2 botones del diálogo son alcanzables y operables sólo
  con teclado (`Tab`/`Enter`/`Escape`), foco visible.
- Verify: `pnpm --filter @dsm/qa test:a11y -- --grep "QA-013-A11Y" --reporter=list` (exit 0)
- **Estado**: verde — 2/2 tests (diálogo cerrado + diálogo real abierto, foco
  atrapado, `Escape` cierra, tab order sólo llega al botón de confirmar una
  vez habilitado — un botón `disabled` es correctamente salteado por `Tab`,
  no un defecto). 0 violaciones `serious`/`critical` en los dos casos.
  Corregido respecto al plan original: NO bloqueado por PR #67 (ver §5.3).

### 5.5 Carga (k6)

| Escenario | Definición | Presupuesto |
|---|---|---|
| **L-1** | `POST /v1/admin/orders/{id}/cancel` sobre órdenes pagadas por medio manual/simulado (sin llamada externa), una orden distinta por iteración | **p95 < 200ms** — `design.md` §D8 del backend: "sin llamada externa para `simulated_dsm`/`manual`, p95 < 200ms en ese caso" |

**Decisión deliberada — sin threshold para el camino `mercadopago`**: el
propio `design.md` del backend marca el p95 < 800ms de ese camino como
`[propuesto — confirma Ops]` y, más importante, **no es alcanzable black-box
en este entorno** (mismo hallazgo QA-013-F1) — cargar un camino que siempre
falla por credenciales inválidas mediría la latencia del timeout/circuit
breaker configurado, no la del reembolso real. Mismo criterio que
`US-016-panel-metricas-qa` aplicó a los endpoints `/export` sin presupuesto
propio: la ausencia acá **es** la decisión, no un olvido.

```yaml
- id: QA-013-PERF-1
  scenario: L-1
  execution_mode: automated
  test_layer: 3
  target_tooling: k6
  gherkin_scenario: "L-1 — NFR p95 < 200ms, camino sin llamada externa (design.md §D8 backend)"
  name: CancelOrder_CaminoSinLlamadaExterna_P95MenorADoscientosMsConOrdenDistintaPorIteracion
```

- Exit criterion: `qa/performance/cancel-order-write.js` ejercita el `POST`
  (tag `endpoint:cancel_order`) contra órdenes pagadas por confirmación
  manual, sembradas por iteración (`setup()`/`SharedArray`, nunca la misma
  orden reusada — cancelar es de un solo uso), con `checks` de status **y**
  de `refund.status === 'refunded'` en el body
  (`k6-load-scaffolding` §Checks vs thresholds).
- Verify: `k6 run qa/performance/cancel-order-write.js --summary-trend-stats="p(95)" 2>&1 | grep -q "✓"` (exit 0)
- **Estado**: verde — 150/150 iteraciones, 3 VUs, **p95 7.74ms** vs presupuesto
  200ms (holgura amplia, mismo patrón que el resto de la suite de este
  repo), `checks` 300/300 (status 200 + `refund.status === "refunded"`),
  `http_req_failed` 0.00%. Setup: 150 checkouts reales + 1 sola
  `GET /pending-payment` + 150 `confirm-payment` reales, dejando el pool en
  `new` antes de la carga (cancelar es de un solo uso, nunca la misma orden
  dos veces).

Se agrega `cancel_order` a `qa/performance/lib/thresholds.js` (fuente única de
presupuestos), mismo criterio que `simulate_payment`/`order_transition`.

### 5.6 Exploratorio (manual, justificado)

```yaml
- id: TC-013-E1
  execution_mode: manual
  test_layer: 3
  target_tooling: charter
  gherkin_scenario: "—"
  name: Charter_CancelarUnaOrdenConDosPestanasAbiertasYConectividadIntermitente
```

- **Misión**: sondear la acción de cancelar tal como la va a usar el dueño en
  el local: dos pestañas del mismo panel abiertas (una mirando el detalle,
  otra el listado), conectividad intermitente durante la confirmación, y qué
  pasa si el dueño abre el diálogo, lo deja a medio escribir, y vuelve 10
  minutos después.
- **Áreas**: la segunda pestaña after el otro ya canceló (¿el 409 real se ve
  claro, o el dueño piensa que algo se rompió?); reintentar tras un error de
  red genuino (cortar la conexión a mitad de la mutación); el copy del
  diálogo ("Esta acción no se puede deshacer") ¿es suficientemente disuasivo
  sin ser alarmante?
- **Riesgos**: un dueño que cancela por error una orden que en realidad
  quería sólo marcar como "lista" (los dos botones conviven en la misma
  pantalla, `OrderStatusActions` + `OrderCancelAction`) — el criterio de
  "suficientemente distinguible visualmente" es de juicio, no un assert
  determinista.
- **Justificación manual**: mismo criterio que `TC-1250` (US-012) y
  `TC-016-E1` (US-016) para charters de "uso real" de un panel admin con
  interacción humana y timing no determinista.

```yaml
- id: TC-013-E2
  execution_mode: manual
  test_layer: 3
  target_tooling: charter
  gherkin_scenario: "—"
  name: Charter_RecuperacionRealDeUnReembolsoMercadoPagoElDiaQueHayaCuentaSandbox
```

- **Misión**: el día que exista una cuenta sandbox de MercadoPago (mismo
  bloqueo documentado por `QA-010-F1`), verificar el ciclo completo: cancelar
  una orden con un pago `mercadopago` real aprobado, confirmar que el
  reembolso real se dispara y el pago queda `refunded`; si la llamada
  fallara a propósito (sandbox simulando un error), confirmar que
  `POST /admin/payments/retry-refunds` (job ya existente, sin cambios) lo
  recupera en una corrida posterior.
- **Áreas**: el mensaje de UI para `refund_pending` (D4 del frontend,
  "el sistema lo reintenta automáticamente") ¿sigue siendo preciso contra un
  reembolso real que sí se recupera?; el tiempo real que tarda MercadoPago en
  confirmar un reembolso (no instantáneo en producción, a diferencia de
  cualquier simulación).
- **Riesgos**: sin este charter, el ÚNICO momento en que alguien verá el
  reembolso real funcionar de punta a punta sería el primer reembolso real en
  producción — sin ensayo previo.
- **Justificación manual**: depende de una cuenta sandbox que no existe hoy
  (QA-013-F1); no es automatizable hasta que ese bloqueo se resuelva, y aun
  resuelto, el timing real de MercadoPago no es determinista.

**Estado de TC-013-E1/TC-013-E2**: se agregan como apéndice a
`qa/exploratory/charters.md` (sección "US-013 — Cancelación de orden") en la
fase de ejecución (`/develop-qa`), no en este plan.

---

## 6. Infraestructura de test

### Se reusa de `qa/` (sin modificar)

| Pieza | Para qué |
|---|---|
| `qa/support/admin-auth.ts` | login real de dueño (`ADMIN_BOOTSTRAP_TOKEN`) |
| `qa/support/customer-auth.ts` (`nuevaCuenta`) | sesión real de cliente (US-014), para N-2/E-6 |
| `qa/support/seed-metricas.ts` (`crearOrdenActiva`, `crearOrdenPendiente`, `simularPagoAutomatico`, `confirmarPagoManual`, `catalogoParaMetricas`) | **la siembra completa que este plan necesita, sin extender ni modificar**: órdenes en `new`/`preparing`/`ready`/`delivered` vía checkout real + `confirm-payment` real (`provider='manual'`) o `simulate-payment` real (`provider='simulated_dsm'`) — 100% API real, ningún bridge nuevo hace falta (ver nota abajo) |
| `qa/support/api.ts` (`apiCall`) | llamadas admin ruidosas ante cualquier no-2xx |
| `qa/performance/lib/thresholds.js` | fuente única de budgets; se le suma `cancel_order` |
| `qa/e2e/playwright.config.ts` · `playwright.a11y.config.ts` | runners ya configurados |
| `qa/exploratory/charters.md` | se le agrega un apéndice, no se reescribe lo anterior |
| `qa/scripts/api-up.sh` | levanta la API con los overrides ya declarados |
| scripts de `qa/package.json` | `test:acceptance`, `test:e2e`, `test:a11y`, `test:load`, `test:contract:*` |

**Nota sobre la siembra — ningún mecanismo nuevo, la acción bajo prueba ES el
"puente"**: a diferencia de `US-012-panel-ordenes-dueno-qa` (planificado
cuando `confirm-payment`/`simulate-payment` no existían, y necesitó
`puentearACancelled` vía `@dsm/db` para llegar a `cancelled`), este plan **no
necesita ningún bridge para llegar a `cancelled`** — esa transición es
precisamente la acción bajo prueba, ejercida siempre por
`POST /v1/admin/orders/{id}/cancel` real. `seed-metricas.ts` ya cubre el
100% de los estados de PARTIDA que las 10 AC necesitan (`new`/`preparing`/
`ready`/`delivered`, con pago `manual` o `simulated_dsm`); no hace falta
extenderlo ni crear un archivo "hermano" nuevo.

### Se agrega (dueño: este change)

| Archivo | Qué hace |
|---|---|
| `qa/support/cancelar-orden.ts` | Helper de una sola función (`cancelarOrden(adminToken, orderId)`), llama a `POST /v1/admin/orders/{id}/cancel` real — la acción bajo prueba, no un bridge de siembra. Reusa `QA_API_BASE_URL` de `qa-env.ts`, mismo patrón que `avanzarEstado`/`confirmarPagoManual` de `seed-metricas.ts`. |
| `qa/acceptance/features/cancelacion-ordenes.feature` | los 9 escenarios de §4 (H-1×3 ejemplos, H-2, C-1, C-2, N-1×3 ejemplos, N-2, X-1, X-2, X-3), tag `@cancelacion-ordenes` |
| `qa/acceptance/steps/cancelacion-ordenes.steps.ts` | steps propios; reusa `admin-auth`/`customer-auth`/`seed-metricas`/`cancelar-orden` sin modificarlos |
| `qa/contract/cancel-order.contract.ts` | QA-013-CT-1 |
| `qa/e2e/cancelacion-ordenes.spec.ts` | QA-013-E2E-1..6 |
| `qa/e2e/cancelacion-ordenes-a11y.spec.ts` | QA-013-A11Y-1 |
| `qa/performance/cancel-order-write.js` | QA-013-PERF-1 |

---

## 7. Bloqueos y hallazgos declarados

| # | Qué | Estado | Efecto |
|---|---|---|---|
| **QA-013-F1** | **AC-3 (reembolso real MercadoPago) no tiene ningún camino de API real, en este entorno, que produzca una orden con un pago `provider='mercadopago'` `approved`** — el único camino sería el webhook real de US-010, que necesita que `MercadoPagoClient.getPayment` real devuelva `approved`, y este entorno no tiene cuenta sandbox (mismo hallazgo estructural que `QA-010-F1`). A diferencia de `SC-010-N2` (que sí tenía un punto de partida y sólo bloqueaba el desenlace), acá falta el punto de partida mismo. | Declarado, no oculto — **no es un gap nuevo de este plan**, es la extensión natural de un límite de entorno ya aceptado por el repo (US-010 QA) | Ninguna aceptación/E2E de este plan intenta producir una orden `mercadopago` real; la cobertura de ese camino es 100% dev-owned (`cancel-order.service.spec.ts`, `e2e-payments-cancel-order.spec.ts`, ambos con el cliente mockeado por DI de NestJS) |
| **B-1** | ~~Frontend de US-013 con PR #67 abierto, no mergeado a `main`.~~ **RESUELTO/no era un bloqueo real**: el worktree ya estaba stacked sobre la rama del FE, así que `apps/web` se construyó y sirvió directo desde acá sin esperar el merge (ver corrección en §5.0). PR #67 mergeó a `main` el 2026-09-06 durante la ejecución de este plan. | No bloqueó nada — corregido, ver §5.0 | — |
| **B-2** | **Entorno**: la API tiene que arrancar con `ADMIN_BOOTSTRAP_TOKEN` (login admin real) y con las cuentas de cliente de `customer-auth.ts` operativas (US-014, ya mergeado) para N-2/E-6. | Bloquea la corrida, no el plan | ver `qa/support/qa-env.ts` (ya existe) |
| **B-3** | **`MP_ACCESS_TOKEN` de este entorno no es una credencial de sandbox real** (`.env.example` declara `replace-me`) — consecuencia directa de QA-013-F1, no una configuración a corregir por este plan. | Informativo, no bloquea nada de lo planificado acá | Aprovisionar una cuenta sandbox de MercadoPago es tarea de infraestructura/negocio, fuera de alcance de un `qa-plan.md` |

---

## 8. Estrategia de datos de test

- **Órdenes sintéticas nacidas del ciclo real** (`POST /v1/checkout` →
  `confirm-payment`/`simulate-payment` → `PATCH` de fulfillment) para todo lo
  que la API real puede producir — que es el 100% de los estados que las 10
  AC de esta US necesitan. La transición a `cancelled` es siempre la acción
  bajo prueba (`POST .../cancel` real), nunca un bridge.
- **Identidad de cliente real** para N-2/E-6, vía `customer-auth.ts` (US-014)
  — nunca un JWT minteado a mano con un rol distinto.
- **Defaults deterministas**; el único valor no determinista es el prefijo de
  corrida (reusa `builders.ts`/`seed-metricas.ts`), nunca aserido
  (`testing-standards.md` §5).
- **Aislamiento**: cada escenario crea sus propias órdenes vía el seed;
  ningún escenario depende del residuo de otro (`qa-three-layer-regression`
  §Cross-layer rules) — crítico acá porque C-2 (carrera) necesita saber el
  stock exacto antes de disparar dos llamadas simultáneas.
- **Sintético únicamente**: ningún dato de producción; ninguna credencial de
  MercadoPago real se prueba ni se solicita (§7, QA-013-F1/B-3).

---

## 9. Quality gates

| Gate | Cuándo | Bloquea |
|---|---|---|
| Aceptación API-level (QA-013-ACC-1..4) | PR y nightly | sí — ejecutable desde hoy |
| Contract testing (QA-013-CT-1) | PR y nightly | sí — ejecutable desde hoy |
| Carga p95 < 200ms camino sin llamada externa (QA-013-PERF-1) | pre-release | sí — ejecutable desde hoy |
| E2E de navegador cross-stack (QA-013-E2E-1..6) | pre-uat promotion | sí — ejecutable desde hoy |
| Accesibilidad L3 0 violaciones AA (QA-013-A11Y-1) | pre-release | sí — ejecutable desde hoy |
| Charters exploratorios | pre-release | no (informan) |

---

## 10. Anti-patrones evitados a propósito

- ❌ **Autorar capas dev-owned** (`qa-backend-standards.md` §2.1 /
  `qa-frontend-standards.md` §2.1): cero stubs de unit, component, integration
  o e2e-nest en este plan.
- ❌ **Inventar un seeding nuevo cuando ya existe uno reusable**: se verificó
  `qa/support/seed-metricas.ts` antes de proponer nada — cubre el 100% de los
  estados de partida sin extensión.
- ❌ **Disfrazar un bloqueo estructural (QA-013-F1) con un doble no
  autorizado**: ninguna aceptación de este plan sustituye
  `MercadoPagoClient` ni su `baseUrl` — mismo criterio que `SC-010-N2`
  (`design.md` §D-QA1 de `US-010-orden-webhook-stock-qa`).
- ❌ **Repetir la siembra directa por Prisma que el backend ya usa en
  aislamiento** (`cancel-order.service.spec.ts`): todo el dataset de X-1/X-2/
  X-3 nace de endpoints reales — es precisamente lo que la capa dev-owned no
  puede probar desde su propio proceso.
- ❌ **Un k6 sin umbral atado a un NFR** (`k6-load-scaffolding`): L-1 usa el
  número que el propio `design.md` del backend propone para el camino sin
  llamada externa; el camino `mercadopago` queda deliberadamente sin
  threshold, documentado (§5.5), no omitido en silencio.
- ❌ **Esperas fijas** (`playwright-stability`, `flakiness-detection` señal
  1): ninguna `waitForTimeout`; los cambios de estado se asertan con
  `page.waitForResponse`, nunca con un `sleep`.
- ❌ **Assertar sobre el DOM cuando el AC es de status HTTP**
  (`playwright-stability` F59): N-1/E-4 verifican el código de respuesta
  real (`response.status()`), no sólo el texto renderizado.
- ❌ **Escenarios sin ejecutar disfrazados de ejecutables**: cada test case
  de este plan declara su bloqueo (o su ausencia) explícito en §5.0 y en su
  propia frontmatter (`blocked_by`) — 8 de 15 corren hoy, 7 quedan
  `blocked_by` PR #67, ninguno se presenta como verde sin haber corrido.
- ❌ **Duplicar el escenario "orden cancelada consultable por id" que
  `US-012-panel-ordenes-dueno-qa` ya escribió** (C-1 de esa suite): X-3 de
  este plan verifica la MISMA propiedad, pero contra una orden cancelada por
  el endpoint real de esta US, nunca ejercitado antes — no es una
  duplicación, es la primera vez que se prueba con datos reales de este
  camino.

---

## 11. Standards consultados

`testing-standards.md` (§2 pirámide, §5 datos, §14 patrones, §14.9
negative-space, §18 anti-patterns) · `qa-backend-standards.md` (§2.1
ownership, §13 performance, §15 datos, §21 BDD) · `qa-frontend-standards.md`
(§2.1 ownership, §19 accesibilidad, §23 Playwright, §24 BDD web) ·
`performance-standards.md` (§7 diseño del load test, §8 budgets en CI) ·
`base-standards.md` (§1 KISS/YAGNI) · skills `qa-three-layer-regression`,
`bdd-scenario-quality`, `playwright-stability`, `k6-load-scaffolding`,
`flakiness-detection`, `nfr-quantification` (consultado para confirmar que el
NFR de L-1 ya viene propuesto por `design.md` §D8 del backend, sin necesidad
de proponer un número nuevo), `threat-modeling-lite` (consultado — el
threat model de superficie ya lo hizo el backend en `design.md` §D7; este
plan no repite el análisis, sólo verifica AC-9/E-6 contra sesiones reales),
`openspec-workflow` (convención Modo A + traceability matrix).

---

## 12. Open questions

- **OQ-QA-013-1**: ¿Vale la pena aprovisionar una cuenta sandbox de
  MercadoPago para poder cerrar QA-013-F1 (y el hallazgo gemelo QA-010-F1)?
  Es una decisión de infraestructura/negocio, no de este plan — recomendación:
  agruparla con la de US-010 si/cuando se decida, en vez de resolverla dos
  veces por separado.
- **OQ-QA-013-2**: El copy de `refund_pending` ("el sistema lo reintenta
  automáticamente") nunca se validó contra un reembolso real que efectivamente
  se recupera — queda como TC-013-E2, sin fecha, hasta que exista sandbox.

---

## 13. Dependencias declaradas

| Dependencia | Estado | Efecto |
|---|---|---|
| `US-013-cancelacion-reembolso-backend` | Mergeado a `main` (`e296d3f`, PR #66) | Resuelto — desbloquea QA-013-ACC-1..4, QA-013-CT-1, QA-013-PERF-1 |
| `US-013-cancelacion-reembolso-frontend-web` | PR #67, mergeado a `main` el 2026-09-06 | Resuelto — no bloqueó nada en la práctica, ver B-1/§5.0. `fix/US-013-cancel-result-message-not-shown` (PR #72) corrige el defecto que encontró QA-013-E2E-3 |
| `US-008-checkout-guest-backend` | Archivado | Resuelto — origen del checkout real de X-1 |
| `US-023-pago-manual-offline-backend` | Archivado | Resuelto — `confirm-payment` real, vía `seed-metricas.ts` |
| `US-010-orden-webhook-stock-backend` | Archivado | Resuelto — `simulate-payment` real, vía `seed-metricas.ts`; también el origen del hallazgo gemelo QA-010-F1 que fundamenta QA-013-F1 |
| `US-012-panel-ordenes-dueno-backend`/`-qa` | Archivado | Resuelto — listado/detalle real para X-3; precedente directo de C-1 (esa suite) |
| `US-014-registro-login-backend` | Archivado (QA con `[Open]` no bloqueante) | Resuelto — sesión de cliente real para N-2/E-6 |
| `US-016-panel-metricas-backend`/`-frontend-web`/`-qa` | Archivado | Resuelto — `GET /v1/admin/reports/summary` real para X-2; precedente de formato de este plan |

---

## 14. References

- User story: `docs/user-stories/US-013-cancelacion-reembolso.md`
- PRD: `docs/product/prd.md` §2.1 capacidad 11, §11 (suposiciones — stock
  única fuente de verdad)
- E2E: `docs/product/design-e2e.md` §6, §12 (FSM de orden), §14 (auth), §17
  (NFR), §18 (observabilidad)
- Backend de este change (mergeado): `openspec/changes/US-013-cancelacion-reembolso-backend/{proposal,design}.md`
- Frontend hermano (PR #67): `openspec/changes/US-013-cancelacion-reembolso-frontend-web/{proposal,design}.md`
- Specs vivas consultadas (sin modificar): `openspec/specs/pagos/{requirements,decisions}.md`
  (`MercadoPagoClient.refund`, `refund_pending`/`retry-refunds`),
  `openspec/specs/ordenes/{requirements,decisions}.md` (FSM de fulfillment,
  `order_status_history`), `openspec/specs/checkout/` (CAP-10, origen de
  `orders`/`order_items`)
- Precedentes Modo A de este repo (formato y contenido): `openspec/changes/archive/US-016-panel-metricas-qa/qa-plan.md`
  (el más cercano — cross-stack backend+FE, uno bloqueado/uno mergeado),
  `openspec/changes/archive/US-010-orden-webhook-stock-qa/{design,qa-plan}.md`
  (D-QA1 — origen del hallazgo gemelo QA-010-F1 que fundamenta QA-013-F1),
  `openspec/changes/archive/US-012-panel-ordenes-dueno-qa/qa-plan.md`
  (C-1 — precedente directo de X-3, cancelación consultable por id)
