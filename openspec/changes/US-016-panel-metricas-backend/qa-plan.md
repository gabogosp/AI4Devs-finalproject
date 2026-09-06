# QA Plan — US-016 Panel de métricas del dueño (Backend + Frontend, cross-stack)

> **Ticket**: US-016 — Panel de métricas / gráficos del dueño
> **Author**: qa-engineer agent
> **Date**: 2026-09-05
> **Status**: Proposed
> **Affected platform(s)**: backend + frontend-web (Layer 3 cross-stack — las dos
> disciplinas de código ya están construidas: backend 23/23 tasks, PR #55 in review;
> frontend-web 25/25 tasks, PR #59 in review, stacked sobre #55)
> **Service tier(s)**: 2 (superficie backoffice de bajo tráfico, un solo operador —
> mismo criterio que el resto del panel admin) **con AC-7 y AC-8 tratados como Tier 1**:
> ninguno de los dos es de alto volumen, pero los dos protegen la integridad de una
> decisión de negocio (a quién se le muestra el panel, y qué cuenta como venta) — mismo
> patrón que `US-006-import-masivo-inventario-qa` aplicó a AC-8/AC-11 de esa US.
> **Companion files**: `proposal.md`/`tasks.md`/`design.md` de este change (backend) +
> `openspec/changes/US-016-panel-metricas-frontend-web/{proposal,tasks,design}.md`
> (sibling, consumido como contexto — no se re-planifica acá)

> **Alcance**: capas **owned-by-QA** (Layer 3 cross-stack, aceptación BDD, E2E de
> navegador, contract testing, accesibilidad, carga, exploratorio). Las dev-owned
> (unit/integration/e2e-nest del backend; unit/component-RTL+MSW/E2E-smoke del
> frontend) son la TDD de cada disciplina y **no se re-autoran acá** (ownership matrix
> `qa-backend-standards.md` §2.1 / `qa-frontend-standards.md` §2.1).
> **Numeración**: `QA-016-{CATEGORÍA}-{N}` para contract/E2E/a11y/carga (mismo esquema
> Modo A que `US-008-checkout-guest-backend/qa-plan.md`, `US-009-pago-mercadopago-backend/qa-plan.md`
> y `US-023-pago-manual-offline-backend/qa-plan.md`) + `TC-016-E{N}` para charters
> exploratorios (mismo esquema que `TC-021-E{N}` de US-021, el precedente más reciente).
> **A diferencia de los tres precedentes Modo A anteriores**: ningún test case de este
> plan queda `blocked_by` un change sin construir — backend y frontend-web de esta
> misma US ya están completos, y las tres capacidades hermanas de las que depende el
> escenario cross-feature (US-008 checkout, US-023 confirmación manual, US-010 medio
> simulado, US-012 fulfillment) están **archivadas**. Todo lo de este plan es
> ejecutable hoy contra `main` una vez mergeados los PR #55/#59.

---

## 1. Perfil de riesgo

US-016 es la capacidad 9 del PRD — la primera superficie del panel que agrega datos de
**otras tres capacidades** (`checkout` CAP-10, `pagos` CAP-4, `ordenes`/fulfillment CAP-5)
en vez de gestionar un recurso propio. Es, por diseño, una superficie de **sólo lectura**
sin escritura nueva — el riesgo no es "se rompe una transacción", es "el número que el
dueño usa para decidir está mal, y nada lo nota hasta que el dueño desconfía del panel".

| Riesgo | Por qué importa acá |
|---|---|
| **El número que ve el dueño no es el que pasó de verdad** | Los tres datasets (`sales`, `top-products`, `summary`) agregan sobre `orders`/`order_items` con `$queryRaw`. Ningún test de un solo módulo compara el panel contra el **ciclo de vida real** de una orden (checkout → confirmación de pago → fulfillment) — el backend siembra sus 6 estados con `prisma.order.create` directo (`design.md` §D2/T7.3), nunca a través del checkout+pago+fulfillment reales. Un desacople entre "qué estados escribe el sistema real" y "qué allowlist lee `reports/`" no lo vería ningún test aislado. |
| **AC-8 es la interpretación de negocio más frágil de la US** | "Venta" = `new/preparing/ready/delivered`; `cancelled` (dinero reembolsado, `pagos/requirements.md` R-10) y `pending_payment` quedan afuera. La allowlist está *hardcodeada* como constante (`sale-statuses.ts`) — un PR futuro que agregue un séptimo estado a la FSM de pagos/fulfillment sin tocar esta constante infla o desinfla las ventas en silencio. |
| **El rango acotado por retención (AC-9) es transparencia, no sólo un cálculo** | El backend acota `from` al piso de `ORDER_RETENTION_MONTHS` **silenciosamente** (200, nunca 422) y depende de que el FE lea `range.from`/`range.to` de la respuesta para avisarle al dueño. Un desacople entre "el backend clampeó" y "el FE lo señala" deja al dueño mirando un rango recortado sin saberlo — ningún test de un solo lado lo detecta. |
| **El export CSV en el navegador real nunca se ejercitó** | El backend prueba la neutralización de fórmulas (T7.5) contra el CSV en memoria; el frontend prueba que el botón *llama* a `downloadCsv`/`Blob` (dev-owned, mock de `URL.createObjectURL`). **Ningún test dispara una descarga real de un navegador real contra el backend real** — es exactamente el mismo hueco que `qa-plan.md` de US-006 nombró para el import ("la descarga del CSV como descarga de verdad… jsdom sólo puede espiar eso"). |
| **Acceso restringido (AC-7)** | `AdminGuard` está barrido estáticamente contra las 6 rutas (`e2e-rbac.spec.ts`, T7.2) y el FE hereda el guard del route group `(admin)` sin código propio. Bajo riesgo de regresión aislada, pero es la puerta de un panel que expone facturación total — mismo tratamiento Tier-1 que el resto del panel admin. |
| **Superficie de bajo tráfico, sin gate de carga declarado** | El propio `design.md` del backend (Out of scope) dice "sin gate de CI ni alerta dedicada" para observabilidad — pero el NFR de latencia (`p95 < 300ms`, heredado de PRD §4/E2E §17) sí existe y es el mismo que ya midió `US-012-panel-ordenes-dueno-qa` (p95 real 1.81 ms) para una superficie admin análoga. No hay excusa para no medirlo una vez, aunque el volumen (~100 órdenes/mes) no lo amerite operacionalmente. |

Journeys críticas identificadas:
1. El dueño abre `/admin/metricas`, ve el chart + el ranking + el resumen del período por
   defecto (últimos 30 días), y los tres reflejan **exactamente** las órdenes pagadas de
   ese rango (AC-1/2/3/8).
2. El dueño cambia el rango; los tres widgets se recalculan (AC-4); un rango sin ventas
   muestra el estado vacío, nunca un error (AC-5); un rango que excede la retención se
   acota con una nota visible (AC-9).
3. El dueño descarga el CSV de cada widget — archivo real, en el navegador real,
   coincidente con lo que el widget mostraba (AC-6).
4. Un visitante sin sesión de dueño no accede al panel (AC-7).

---

## 2. Mapeo de la pirámide (capas QA en negrita)

| Capa | Dueño | Estado |
|---|---|---|
| Unit backend (`sale-statuses`, `reports-errors`, `date-range`, `reports.service` con repo mockeado) | dev | ✅ construido — `US-016-panel-metricas-backend/tasks.md` Fases 1, 5 |
| Integration backend (`reports.repository` contra Postgres real, T3.1-T3.3) | dev | ✅ construido — Fase 3 |
| E2E-nest backend (`e2e-admin-reports`, `e2e-rbac` extendido, AC-5/7/8/9 como invariantes) | dev | ✅ construido — Fases 6-7 |
| Unit/component frontend (Vitest+RTL+MSW: `metricsService`, `rangeClampNote`, `formatPeriod`, `SalesChart`/`TopProductsTable`/`SummaryCards`/`MetricsDashboard`, 5 estados cada uno) | dev | ✅ construido — `US-016-panel-metricas-frontend-web/tasks.md` Fases 4-9 |
| a11y de componente (jest-axe sobre `MetricsDashboard`, con datos y vacío) | dev | ✅ construido — Fase 11 |
| E2E smoke frontend (Playwright + stub `api-stub.mjs`, sin backend real): happy path + empty state | dev | ✅ construido — Fase 12 (`apps/web/e2e/metrics-happy-path.spec.ts`, `metrics-empty-state.spec.ts`) |
| **Aceptación BDD cross-stack (API-level, contra Postgres real)** | **QA** | este plan |
| **Contract testing** (`admin-reports` vs OpenAPI publicado) | **QA** | este plan |
| **E2E de navegador cross-stack** (backend + frontend reales, dataset de ciclo de vida real) | **QA** | este plan |
| **Accesibilidad L3** (axe + teclado sobre la página servida, con Recharts real) | **QA** | este plan |
| **Carga (k6)** | **QA** | este plan |
| **Exploratorio** | **QA** | este plan (manual) |

### 2.1 Nota de cobertura dev-owned (awareness, no se re-autora)

**Backend** (`US-016-panel-metricas-backend/tasks.md`, 23/23 tasks): allowlist de venta
en aislamiento (T1.1), parseo/acotado de rango con reloj inyectado (T1.3), las 3 queries
`$queryRaw` contra Postgres real con AC-5/AC-8 como invariante (T3.1-T3.3), zero-fill del
resumen (T5.3), los 6 endpoints con supertest incluyendo que ninguno colisiona con el
scrape Prometheus existente (T6.2), el barrido de RBAC extendido (T7.2), AC-8 con las 6
órdenes sembradas **directo por Prisma** — explícitamente fuera del alcance de este plan,
que las siembra por API real —, AC-9 con reloj congelado (T7.4) y la neutralización CSV
(T7.5).

**Frontend** (`US-016-panel-metricas-frontend-web/tasks.md`, 25/25 tasks): `metricsService`
contra MSW con los 6 endpoints + 422 (T4.2), `rangeClampNote`/`formatPeriod` puros (T5.1,
T6.1), los 5 estados de cada widget contra MSW (T6.3, T7.1, T8.1), aislamiento de fallas
entre widgets (T9.1), a11y de componente con jest-axe (T11.1), y el E2E smoke contra el
stub (T12.1/T12.2) — sin backend real, sin Postgres, sin descarga de archivo real.

**Nada de eso se repite acá.** Este plan ejercita exactamente lo que ninguna de las dos
capas dev-owned puede ver desde su propio proceso: el ciclo de vida real de una orden
cruzando `checkout` → `pagos` → `fulfillment` → `reports`, la descarga de un archivo real
en un navegador real, y la accesibilidad de la página servida con Recharts renderizando
SVG de verdad (jsdom no lo hace).

---

## 3. Matriz de trazabilidad: AC × capa

Leyenda: **DEV** = TDD de la disciplina (ya construida) · **QA-ACC** = aceptación
API-level, este plan · **QA-E2E** = E2E de navegador cross-stack, este plan · **QA-A11Y**
= este plan · **QA-CARGA** = este plan · **—** = no aplica.

| AC | DEV (awareness) | **QA-ACC** | **QA-E2E** | **QA-A11Y** | **QA-CARGA** |
|---|---|---|---|---|---|
| **AC-1** evolución de ventas | DEV (T3.1, T6.3) | **H-1** | **QA-016-E2E-1** | — | **QA-016-PERF-1** |
| **AC-2** productos más pedidos | DEV (T3.2, T7.1) | **H-1** | **QA-016-E2E-1** | — | **QA-016-PERF-1** |
| **AC-3** resumen del período | DEV (T3.3, T5.3, T8.1) | **H-1** | **QA-016-E2E-1** | — | **QA-016-PERF-1** |
| **AC-4** elegir el rango temporal | DEV (T1.3, T6.1) | **H-2** | **QA-016-E2E-1** | — | — |
| **AC-5** período sin datos | DEV (T5.3, T7.1) | **C-1** | **QA-016-E2E-2** | **QA-016-A11Y-1** | — |
| **AC-6** exportar datos crudos | DEV (T2.1, T5.1-T5.3, T7.5) | **H-3**, **C-3** | **QA-016-E2E-3** | — | — |
| **AC-7** acceso restringido — autoridad real | DEV (T7.2) | **N-1** | **QA-016-E2E-4** | — | — |
| **AC-8** sólo pagadas cuentan — autoridad real | DEV (T1.1, T3.1-T3.3, T7.3 — siembra directa, gap declarado) | **N-2**, **N-3**, **X-1** | **QA-016-E2E-1** (dataset real) | — | — |
| **AC-9** histórico limitado a 12 meses | DEV (T1.3, T7.4 — reloj congelado, gap declarado) | **C-2** | **QA-016-E2E-5** | — | — |
| **NFR** WCAG 2.1 AA (US §9, design-system §9/§11) | — | — | — | **QA-016-A11Y-1** | — |
| **NFR** p95 lectura < 300ms (PRD §4 / E2E §17 / design.md §D8) | — | — | — | — | **QA-016-PERF-1** |

**Las 9 AC tienen ≥1 escenario QA definido**, y AC-1/2/3/8 comparten el escenario
cross-feature **X-1**, que es el único punto del sistema donde se verifica que el ciclo de
vida real de una orden — no una fila sembrada a mano — produce el número correcto en el
panel.

---

## 4. Escenarios Gherkin

`Feature: qa/acceptance/features/metricas.feature`, tag de feature `@metricas`. Gherkin en
español (`# language: es`), mismo criterio que el resto de la suite. Los pasos de
aceptación corren contra `Playwright.request` (`APIRequestContext`) — convención real del
repo confirmada en la ejecución de `US-023-pago-manual-offline-qa` (no `supertest`, que es
lo que asumían los planes Modo A anteriores a esa corrección).

### 4.1 Happy path

```gherkin
@happy @critical-path
Escenario: H-1 — El panel muestra la evolución de ventas, el ranking y el resumen del período por defecto
  Dado un catálogo con dos productos publicados
  Y tres órdenes reales confirmadas por pago, en distintos días del último mes
  Cuando el dueño consulta las tres métricas sin especificar rango
  Entonces la evolución de ventas incluye una fila por cada día con al menos una orden
  Y el ranking de productos muestra cada producto con la cantidad realmente vendida
  Y el resumen muestra la cantidad de órdenes, el monto facturado y el desglose por estado
  Y los tres coinciden entre sí en la cantidad total de órdenes del período

@happy
Escenario: H-2 — Cambiar el rango recalcula las tres métricas
  Dado una orden real confirmada por pago hace 40 días
  Y ninguna orden real en los últimos 7 días
  Cuando el dueño consulta las métricas con el rango por defecto (30 días)
  Entonces esa orden no aparece en ninguna de las tres
  Cuando el dueño consulta las métricas con un rango que sí cubre esos 40 días
  Entonces esa orden aparece en las tres

@happy
Escenario: H-3 — Descargar el CSV de cada métrica trae los mismos datos que el JSON
  Dado una orden real confirmada por pago dentro del período consultado
  Cuando el dueño pide el JSON y el CSV de cada una de las tres métricas para el mismo rango
  Entonces el CSV de ventas, el de productos y el de resumen contienen los mismos valores
    que sus respuestas JSON hermanas
  Y los tres archivos tienen el `Content-Type` `text/csv` y un `Content-Disposition`
    de tipo `attachment`
```

### 4.2 Corner (condiciones de borde)

```gherkin
@corner
Escenario: C-1 — Un período sin ventas muestra ceros y arrays vacíos, nunca un error
  Dado un rango de fechas futuro, sin ninguna orden
  Cuando el dueño consulta las tres métricas para ese rango
  Entonces la evolución de ventas es un array vacío
  Y el ranking de productos es un array vacío
  Y el resumen tiene `orders_count` y `total_ars_cents` en cero
  Y el desglose por estado tiene las 4 claves activas, cada una en cero
  Y ninguna de las tres respuestas es un error

@corner
Escenario: C-2 — Un rango que excede la retención se acota al piso vigente, no se rechaza
  Dado la política de retención vigente de 12 meses
  Y una orden real confirmada por pago dentro de la ventana de retención
  Cuando el dueño pide un rango que empieza 24 meses atrás
  Entonces la respuesta es 200, nunca 422
  Y el rango efectivo devuelto (`range.from`) es el piso de retención, no lo pedido
  Y la orden dentro de la ventana aparece en los tres datasets

@corner
Escenario: C-3 — Exportar un período sin datos entrega un CSV válido, no un archivo roto
  Dado un rango de fechas futuro, sin ninguna orden
  Cuando el dueño descarga el CSV de cada una de las tres métricas para ese rango
  Entonces los tres archivos son CSV válidos con al menos la fila de encabezado
  Y ninguno de los tres es un archivo vacío ni una respuesta de error
```

### 4.3 Negative (negative-space — lo que NO tiene que pasar)

```gherkin
@negative @critical-path
Escenario: N-1 — Sin sesión de dueño, el panel de métricas deniega el acceso
  Dado un visitante sin ninguna sesión
  Cuando intenta consultar cualquiera de los 6 endpoints de reportes
  Entonces el sistema deniega la solicitud
  Cuando una cuenta de cliente real (US-014, sesión válida pero no admin) lo intenta
  Entonces el sistema la deniega igual que al visitante sin sesión

@negative @critical-path
Escenario: N-2 — Una orden pendiente de pago no se contabiliza como venta
  Dado una orden real recién generada por checkout, todavía sin confirmar el pago
  Cuando el dueño consulta las tres métricas para el período que la incluiría
  Entonces esa orden no está contada en `orders_count`
  Y no aporta a `total_ars_cents`
  Y sus productos no aparecen en el ranking

@negative @critical-path
Escenario: N-3 — Una orden cancelada por falta de stock (pago reembolsado) no se contabiliza como venta
  Dado una orden real cuyo pago automático se aprobó pero el stock ya no alcanzaba al confirmar
  Y esa orden quedó "cancelled" con el pago en estado de reembolso
  Cuando el dueño consulta las tres métricas para el período que la incluiría
  Entonces esa orden no está contada en `orders_count`
  Y no aporta a `total_ars_cents`
  Y no aparece en el desglose por estado
```

### 4.4 Cross-feature (Layer 3 — cruzan disciplinas o US)

```gherkin
@cross-feature @critical-path
Escenario: X-1 — El panel refleja el ciclo de vida real de un lote de órdenes, no una siembra a mano
  Dado seis órdenes nacidas de un checkout real (US-008), cada una llevada por su camino real:
    | orden | camino                                                                  | estado final    |
    | A     | checkout, sin confirmar pago                                            | pending_payment |
    | B     | checkout + confirmación manual de pago (US-023)                        | new             |
    | C     | checkout + confirmación manual + avanzada a "preparing" (US-012)       | preparing       |
    | D     | checkout + confirmación manual + avanzada hasta "ready" (US-012)       | ready           |
    | E     | checkout + confirmación manual + avanzada hasta "delivered" (US-012)   | delivered       |
    | F     | checkout + pago automático simulado (US-010) con stock insuficiente al confirmar | cancelled |
  Cuando el dueño consulta el resumen del período que las incluye a las seis
  Entonces `orders_count` es 4, no 6
  Y el desglose por estado tiene exactamente una orden en cada uno de `new`, `preparing`, `ready`, `delivered`
  Y `total_ars_cents` es la suma exacta de los montos de B, C, D y E — nunca A ni F
  Cuando el dueño consulta la evolución de ventas para ese mismo período
  Entonces la suma de `orders_count` de todas las filas es 4
  Cuando el dueño consulta el ranking de productos para ese mismo período
  Entonces la cantidad vendida de cada producto sólo cuenta las líneas de B, C, D y E
  # Ningún test de un solo módulo puede ver esto: el backend siembra sus 6 estados con
  # prisma.order.create directo (design.md §D2/T7.3); este escenario es el único punto
  # del sistema que prueba que el camino REAL de checkout→pago→fulfillment produce el
  # número correcto en el panel.

@cross-feature
Escenario: X-2 — El nombre y el SKU del ranking son el snapshot que el cliente compró, no el catálogo actual
  Dado un producto renombrado en el catálogo después de que un cliente lo compró vía checkout real
  Cuando el dueño consulta el ranking de productos del período de esa compra
  Entonces el ranking muestra el nombre y el SKU tal como estaban al momento de la compra
  Y no el nombre actual del producto en el catálogo
  # Cruza catalog (US-001) con checkout (US-008) y reports — verifica el trade-off
  # documentado en design.md §D6 (agrupa por el snapshot de order_items, no por products)
  # contra un renombre real, no simulado.
```

**Tooling**: Cucumber-js con `qa/acceptance/steps/metricas.steps.ts` (Playwright
`APIRequestContext`, no supertest).
**Location**: `qa/acceptance/features/metricas.feature`.
**Reuses**: `qa/support/admin-auth.ts` (login real de dueño), `qa/support/customer-auth.ts`
(sesión real de cliente, N-1), `qa/support/builders.ts` (`nuevoProducto`), y agrega
`qa/support/seed-metricas.ts` (ver §6).

---

## 5. Test cases owned-by-QA

### 5.0 Índice

| Test case | Escenario(s) | Herramienta | Layer |
|---|---|---|---|
| QA-016-ACC-1 | H-1, H-2, C-1, C-2, N-1, N-2, N-3, X-2 | Cucumber-js + Playwright `APIRequestContext` | 3 |
| QA-016-ACC-2 | X-1 | Cucumber-js + Playwright `APIRequestContext` | 3 |
| QA-016-CT-1 | contrato `admin-reports` | tsx standalone (`qa/contract/`) | 3 |
| QA-016-E2E-1 | H-1, H-2, X-1 (dataset real, navegador real) | Playwright | 3 |
| QA-016-E2E-2 | C-1 (estado vacío, navegador real) | Playwright | 3 |
| QA-016-E2E-3 | H-3 (descarga real de CSV) | Playwright | 3 |
| QA-016-E2E-4 | N-1 (sin sesión, navegador real) | Playwright | 3 |
| QA-016-E2E-5 | C-2 (nota de rango acotado, navegador real) | Playwright | 3 |
| QA-016-A11Y-1 | NFR WCAG 2.1 AA + teclado | axe-core + Playwright | 3 |
| QA-016-PERF-1 | NFR p95 < 300ms | k6 | 3 |
| TC-016-E1 | charter | manual | 3 |
| TC-016-E2 | charter | manual | 3 |

**Por herramienta**: Cucumber+Playwright 2 · tsx standalone 1 · Playwright 5 ·
axe-core+Playwright 1 · k6 1 · charter manual 2. **12 test cases, 0 bloqueados.**

### 5.1 Aceptación BDD API-level

```yaml
- id: QA-016-ACC-1
  scenario: H-1, H-2, C-1, C-2, N-1, N-2, N-3, X-2
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "metricas.feature — happy/corner/negative/X-2"
  name: PanelMetricas_Aceptacion_HappyCornerNegativoYSnapshotDeProducto
```

- Exit criterion: los 8 escenarios de `metricas.feature` (excepto X-1) pasan contra la
  API real + Postgres real, seedeando por API (`seed-metricas.ts`, checkout real +
  confirmación real + PATCH real), nunca por `prisma.order.create` directo.
- Verify: `pnpm --filter @dsm/qa test:acceptance -- --tags "@metricas and not @cross-feature"` (exit 0)

```yaml
- id: QA-016-ACC-2
  scenario: X-1
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "X-1 — ciclo de vida real de 6 órdenes"
  name: PanelMetricas_SoloCuentaLasCuatroActivas_ContraElCicloRealDeCheckoutPagoYFulfillment
```

- Exit criterion: las 6 órdenes de la tabla de X-1 se producen **100% por API real**
  (`POST /v1/checkout`, `POST /admin/orders/{id}/confirm-payment`,
  `POST /checkout/simulate-payment` con stock reducido antes de confirmar,
  `PATCH /admin/orders/{id}`) — cero `INSERT`/`UPDATE` directo vía `@dsm/db`. Las tres
  respuestas de `reports/*` reflejan exactamente `orders_count=4`.
- Verify: `pnpm --filter @dsm/qa test:acceptance -- --tags "@cross-feature and @metricas"` (exit 0)

### 5.2 Contract testing

- [ ] **QA-016-CT-1**: Contract test standalone para los 6 endpoints de `admin-reports`
  vs OpenAPI (mismo formato real que `qa/contract/pago-manual.contract.ts`, no
  `supertest`/`--testPathPattern` como asumían los planes anteriores a la corrección de
  US-023).
  - Exit criterion: `qa/contract/reports.contract.ts` valida que los 3 `GET` (200 con el
    shape de `design.md` §D4, 401/403/422) y los 3 `GET .../export` (200 `text/csv` con
    `Content-Disposition: attachment`, 401/403/422) matcheen los schemas y los
    `Content-Type` declarados en `apps/api/docs/api/openapi.yaml`.
  - Verify: `pnpm --filter @dsm/qa test:contract:reports` (exit 0)

### 5.3 E2E de navegador cross-stack (Playwright, backend + frontend reales)

> Distinto de `apps/web/e2e/metrics-happy-path.spec.ts`/`metrics-empty-state.spec.ts`
> (dev-owned, Layer 2): esos corren contra `e2e/support/api-stub.mjs` — **sin backend
> real, sin Postgres**. Esta capa corre contra la API real levantada por `qa/scripts/api-up.sh`
> y el frontend real (`pnpm --filter @dsm/web build && start`), con datos sembrados por
> `seed-metricas.ts` — es el único punto donde se prueba el acuerdo real entre las tres
> capas (Postgres real, `GET /v1/admin/reports/*` real, navegador real).

```yaml
- id: QA-016-E2E-1
  scenario: H-1, H-2, X-1
  execution_mode: automated
  test_layer: 3
  target_tooling: Playwright
  gherkin_scenario: "H-1/H-2/X-1 — dashboard completo con dataset de ciclo de vida real"
  name: PanelMetricasUI_ConDatasetDeCicloDeVidaReal_MuestraSoloLasCuatroOrdenesActivas
```

- Exit criterion: `qa/e2e/metricas.spec.ts` — login admin real → `/admin/metricas` →
  el chart, el ranking y las tarjetas muestran los valores derivados de las 6 órdenes de
  `seed-metricas.ts` (X-1), contando sólo las 4 activas; cambiar el rango
  (`RangeFilterForm` real) dispara `page.waitForResponse` a los 3 endpoints reales y
  los valores se actualizan.
- Verify: `pnpm --filter @dsm/qa test:e2e -- --grep "metricas dataset real" --reporter=list` (exit 0)

```yaml
- id: QA-016-E2E-2
  scenario: C-1
  execution_mode: automated
  test_layer: 3
  target_tooling: Playwright
  gherkin_scenario: "C-1 — estado vacío contra backend real"
  name: PanelMetricasUI_RangoSinOrdenesReales_MuestraEstadoVacioSinError
```

- Exit criterion: con un rango real sin órdenes sembradas (no un stub que "trata
  cualquier fecha del año 2000 como vacío" — dato real ausente), los 3 widgets muestran
  su mensaje de estado vacío y `getByRole('alert')` con texto no vacío tiene cuenta 0.
- Verify: `pnpm --filter @dsm/qa test:e2e -- --grep "metricas vacio real" --reporter=list` (exit 0)

```yaml
- id: QA-016-E2E-3
  scenario: H-3
  execution_mode: automated
  test_layer: 3
  target_tooling: Playwright
  gherkin_scenario: "H-3 — descarga real de CSV desde el navegador"
  name: PanelMetricasUI_BotonDescargarCsv_DisparaUnaDescargaRealConContenidoCorrecto
```

- Exit criterion: clickear "Descargar CSV" en cada uno de los 3 widgets dispara una
  descarga real (`page.waitForEvent('download')`), el archivo tiene extensión `.csv`, y
  su contenido (leído del path del download) coincide con los valores mostrados en el
  widget en ese momento — contra el backend real, sin mock de `Blob`/`URL.createObjectURL`.
- Verify: `pnpm --filter @dsm/qa test:e2e -- --grep "metricas descarga csv real" --reporter=list` (exit 0)

```yaml
- id: QA-016-E2E-4
  scenario: N-1
  execution_mode: automated
  test_layer: 3
  target_tooling: Playwright
  gherkin_scenario: "N-1 — acceso denegado end-to-end"
  name: PanelMetricasUI_SinSesionDeAdminNiConSesionDeClienteReal_NoVeElPanel
```

- Exit criterion: un visitante sin sesión que navega directo a `/admin/metricas` no ve
  el dashboard; una cuenta de cliente real (US-014, login real) tampoco.
- Verify: `pnpm --filter @dsm/qa test:e2e -- --grep "metricas sin sesion" --reporter=list` (exit 0)

```yaml
- id: QA-016-E2E-5
  scenario: C-2
  execution_mode: automated
  test_layer: 3
  target_tooling: Playwright
  gherkin_scenario: "C-2 — nota de rango acotado contra un clamp real"
  name: PanelMetricasUI_RangoQueExcedeLaRetencionReal_MuestraLaNotaDeRangoAcotado
```

- Exit criterion: con una orden real backdateada a 13 meses (única excepción documentada
  de bridge vía `@dsm/db` — ver §6/§7, no hay endpoint que fije `created_at`) fuera de la
  ventana de retención vigente y un pedido de rango de 24 meses, el widget muestra la
  nota "Mostrando desde…" con la fecha efectiva, no la pedida.
- Verify: `pnpm --filter @dsm/qa test:e2e -- --grep "metricas rango acotado" --reporter=list` (exit 0)

### 5.4 Accesibilidad L3 (axe-core + teclado, página servida con Recharts real)

> **Sin duplicación con la capa dev-owned**: `T11.1` del FE corre `jest-axe` sobre
> `MetricsDashboard` con MSW — jsdom no renderiza el `<svg>` de Recharts con dimensiones
> reales, así que el chart nunca queda expuesto al motor de axe de esa corrida. Esta capa
> corre sobre la página servida en un navegador real, con el layout `(admin)` completo y
> el chart efectivamente pintado.

```yaml
- id: QA-016-A11Y-1
  scenario: "NFR WCAG 2.1 AA (US §9, design-system §9/§11)"
  execution_mode: automated
  test_layer: 3
  target_tooling: axe-core+Playwright
  gherkin_scenario: "NFR — 0 violaciones AA con datos y en vacío"
  name: PanelMetricasUI_SinViolacionesAA_ConChartRealYEnLosTresEstadosVacios
```

- Exit criterion: `qa/e2e/metricas-a11y.spec.ts` — 0 violaciones AA con datos reales
  (chart pintado, tabla accesible de `<details>` abierta) y 0 violaciones en el estado
  vacío de los 3 widgets; la tabla de datos accesible de `SalesChart`, el `<select>` de
  granularidad y `RangeFilterForm` son alcanzables y operables sólo con teclado (`Tab`/
  `Enter`), con foco visible.
- Verify: `pnpm --filter @dsm/qa test:a11y -- --grep "metricas" --reporter=list` (exit 0)

### 5.5 Carga (k6)

| Escenario | Definición | Presupuesto |
|---|---|---|
| **L-1** | `GET /v1/admin/reports/{sales,top-products,summary}` sin filtro, con datos sembrados, tag por endpoint | **p95 < 300ms** — heredado de PRD §4/E2E §17, mismo NFR que `design.md` §D8 de este change y que ya midió `US-012-panel-ordenes-dueno-qa` (p95 real 1.81ms) para una superficie admin de forma equivalente |

**Decisión deliberada — sin threshold para los 3 `/export`**: a diferencia de los 3 `GET`
de lectura, ningún AC ni NFR de la US fija un presupuesto de latencia para la descarga
CSV (payload de archivo, perfil de acceso distinto al de un dashboard interactivo).
Inventar un número acá repetiría el anti-patrón que este mismo repo ya evitó con la
lectura del carrito en `US-007-carrito-compra-qa` (OQ-QA-1: "la ausencia acá **es** la
decisión"). Si el PO/Arquitecto quiere un presupuesto de export, es un ítem nuevo, no una
suposición de este plan.

```yaml
- id: QA-016-PERF-1
  scenario: L-1
  execution_mode: automated
  test_layer: 3
  target_tooling: k6
  gherkin_scenario: "L-1 — NFR p95 lectura < 300ms (PRD §4 / design.md §D8)"
  name: ReportsAdmin_LecturaDeLosTresDatasets_P95MenorATrescientosMs
```

- Exit criterion: `qa/performance/reports-read.js` ejercita los 3 `GET` (tags
  `endpoint:reports_sales`/`reports_top_products`/`reports_summary`) contra datos
  sembrados por `seed-metricas.ts`, con `checks` de status **y** de shape del body
  (`k6-load-scaffolding` §Checks vs thresholds — un 200 con body vacío no pasa el gate).
- Verify: `k6 run qa/performance/reports-read.js --summary-trend-stats="p(95)" 2>&1 | grep -q "✓"` (exit 0)

Se agrega `reports_read` a `qa/performance/lib/thresholds.js` (fuente única de
presupuestos, mismo criterio que `list_orders`/`order_transition` de US-012).

### 5.6 Exploratorio (manual, justificado)

Agregar a `qa/exploratory/charters.md`:

```yaml
- id: TC-016-E1
  execution_mode: manual
  test_layer: 3
  target_tooling: charter
  gherkin_scenario: "—"
  name: Charter_ElPanelDeMetricasConDatosRealesDelDuenoDurantePreUAT
```

- **Misión**: sondear el panel con el volumen y la forma reales del catálogo del dueño
  (no el fixture prolijo de 2-3 productos), buscando combinaciones de rango+granularidad
  que produzcan un chart ilegible o un ranking con empates no resueltos.
- **Áreas**: rango de 12 meses completo con granularidad "día" (¿el chart se vuelve
  ilegible con ~365 puntos?); productos con nombres largos en el ranking (¿el layout de
  la tabla se rompe?); exportar un CSV de 12 meses y abrirlo en la planilla que el dueño
  realmente usa; combinaciones de rango que crucen el cambio de año.
- **Riesgos**: un chart de 365 barras sin agregación visual queda inutilizable aunque los
  datos sean correctos; un nombre de producto muy largo rompe la tabla de ranking en
  mobile (el panel es desktop-first, pero el dueño puede abrirlo desde el celular).
- **Justificación manual**: el criterio es de legibilidad y juicio, no un assert
  determinista — mismo criterio que `TC-241` (US-002) y `TC-1250` (US-012) para
  charters de "uso real" de un panel admin.

```yaml
- id: TC-016-E2
  execution_mode: manual
  test_layer: 3
  target_tooling: charter
  gherkin_scenario: "—"
  name: Charter_ConsistenciaDelResumenTrasUnaAnonimizacionRealDeUS021
```

- **Misión**: verificar que anonimizar una orden real (`US-021`, ya archivada) no cambia
  los números del panel de métricas — el diseño del backend (§D2/§D9) declara que
  `anonymized_at` sólo pisa PII del comprador, nunca `status`/`total_ars_cents`, pero
  ningún test automatizado de este plan ni de `US-021-*-qa` cruza las dos superficies.
- **Áreas**: `POST /admin/orders/{id}/anonymize` (US-021) sobre una orden que ya cuenta
  en el resumen del panel de métricas; comparar `orders_count`/`total_ars_cents`/ranking
  antes y después de anonimizar esa misma orden.
- **Riesgos**: un cambio futuro en la anonimización que toque una columna que `reports/`
  sí lee (por ejemplo, si algún día se decide anonimizar también `order_items.product_name`)
  rompería el ranking sin que ningún test de `US-021` lo note, porque esa capacidad no
  conoce `reports/`.
- **Justificación manual**: cruza dos capacidades archivadas por sesiones distintas
  (`retencion-datos-personales` y `metricas`) sin un AC formal que las una — explorar la
  costura antes de automatizarla evita comprometer un test determinista sobre una
  interacción que hoy es sólo una lectura del diseño, no un comportamiento verificado.

---

## 6. Infraestructura de test

### Se reusa de `qa/` (sin modificar)

| Pieza | Para qué |
|---|---|
| `qa/support/admin-auth.ts` | login real de dueño (`ADMIN_BOOTSTRAP_TOKEN`) |
| `qa/support/customer-auth.ts` (`nuevaCuenta`) | sesión real de cliente (US-014), para N-1 |
| `qa/support/api.ts` (`apiCall`) | llamadas admin ruidosas ante cualquier no-2xx |
| `qa/support/builders.ts` | `nuevaCategoria`/`nuevoProducto`, catálogo de siembra |
| `qa/performance/lib/thresholds.js` | fuente única de budgets; se le suma `reports_read` |
| `qa/e2e/playwright.config.ts` · `playwright.a11y.config.ts` | runners ya configurados |
| `qa/exploratory/charters.md` | se le agrega un apéndice, no se reescribe lo anterior |
| `qa/scripts/api-up.sh` | levanta la API con los overrides de rate-limit ya declarados |
| scripts de `qa/package.json` | `test:acceptance`, `test:e2e`, `test:a11y`, `test:load` |

### Se agrega (dueño: este change)

| Archivo | Qué hace |
|---|---|
| `qa/support/seed-metricas.ts` | **hermano** de `seed-ordenes.ts`, pero sin el bridge vía `@dsm/db` que ese archivo necesitaba en su momento: hoy `POST /admin/orders/{id}/confirm-payment` (US-023) y `POST /checkout/simulate-payment` (US-010) ya existen. Produce las 6 órdenes de X-1 100% por API real: A (`pending_payment`, sin tocar), B/C/D/E (checkout real + `confirm-payment` real + `PATCH` real hasta el estado que cada una necesita), F (checkout real + reducir stock del producto vía `PATCH /admin/products/{id}` **antes** de `simulate-payment` real, para reproducir la cancelación automática por stock insuficiente de `pagos/requirements.md` R-10). **Única excepción documentada**: para C-2/QA-016-E2E-5 (AC-9), backdatear `created_at` de una orden ya confirmada por API real requiere un `UPDATE` de una sola columna vía `@dsm/db` — no existe ningún endpoint que fije esa fecha; acotado a un único uso, análogo al bridge que `US-012-panel-ordenes-dueno-qa` documentó para su propio D2 mientras esa capacidad no tenía el endpoint real. |
| `qa/support/seed-metricas.smoke.ts` | smoke del seed — mismo patrón que `seed-ordenes.smoke.ts`; asegura que el único `UPDATE` directo es el de `created_at` de C-2, nada más. |
| `qa/acceptance/features/metricas.feature` | los 9 escenarios de §4, tag `@metricas` |
| `qa/acceptance/steps/metricas.steps.ts` | steps del panel; reusa `admin-auth`/`customer-auth`/`api` sin modificarlos |
| `qa/contract/reports.contract.ts` | QA-016-CT-1 |
| `qa/e2e/metricas.spec.ts` | QA-016-E2E-1/2/3/4/5 |
| `qa/e2e/metricas-a11y.spec.ts` | QA-016-A11Y-1 |
| `qa/performance/reports-read.js` | QA-016-PERF-1 |

---

## 7. Estrategia de datos de test

- **Órdenes sintéticas nacidas del ciclo real** (`POST /v1/checkout` → `confirm-payment`/
  `simulate-payment` → `PATCH` de fulfillment) siempre que exista un camino de API — a
  diferencia de `US-012-panel-ordenes-dueno-qa` (planificado cuando esos endpoints no
  existían todavía), acá **sí existen**, así que el bridge vía `@dsm/db` se reduce al
  único campo que ningún endpoint expone (`created_at`, para el clamp de retención).
- **Identidad de cliente real** para N-1, vía `customer-auth.ts` (US-014) — nunca un JWT
  minteado a mano con un rol distinto.
- **Defaults deterministas**; el único valor no determinista es el prefijo de corrida
  (reusa `builders.ts`), nunca aserido (`testing-standards.md` §5).
- **Aislamiento**: cada escenario crea sus propias órdenes vía el seed; ningún escenario
  depende del residuo de otro (`qa-three-layer-regression` §Cross-layer rules).
- **Sintético únicamente**: ningún dato de producción; los nombres de producto de X-2
  (renombre) son sintéticos con centinelas reconocibles.

---

## 8. Quality gates

| Gate | Cuándo | Bloquea |
|---|---|---|
| Aceptación API-level (QA-016-ACC-1/2) | PR y nightly | sí |
| Contract testing (QA-016-CT-1) | PR y nightly | sí |
| E2E de navegador cross-stack (QA-016-E2E-1..5) | pre-uat promotion | sí |
| Accesibilidad L3 0 violaciones AA (QA-016-A11Y-1) | pre-release | sí |
| Carga p95 < 300ms (QA-016-PERF-1) | pre-release | sí |
| Charters exploratorios | pre-release | no (informan) |

---

## 9. Anti-patrones evitados a propósito

- ❌ **Autorar capas dev-owned** (`qa-backend-standards.md` §2.1 / `qa-frontend-standards.md`
  §2.1): cero stubs de unit, component, integration o e2e-nest/smoke en este plan.
- ❌ **Repetir la siembra directa por Prisma que el backend ya usa en aislamiento** (T7.3):
  todo el dataset cross-feature de X-1 nace de endpoints reales — es precisamente lo que
  la capa dev-owned no puede probar desde su propio proceso.
- ❌ **Un k6 sin umbral atado a un NFR** (`k6-load-scaffolding`): L-1 usa el número
  heredado de PRD §4/design.md §D8; los exports quedan deliberadamente sin threshold,
  documentado, no omitido en silencio.
- ❌ **Inventar un AC o un NFR para el export CSV** (§5.5): sin presupuesto de latencia
  propio declarado por la US, no se propone uno nuevo.
- ❌ **Esperas fijas** (`playwright-stability`, `flakiness-detection` señal 1): ninguna
  `waitForTimeout`; los recálculos se asertan con `page.waitForResponse`, las descargas
  con `page.waitForEvent('download')`.
- ❌ **Duplicar el E2E smoke dev-owned del FE** (`apps/web/e2e/metrics-happy-path.spec.ts`):
  ese corre contra un stub sin backend; QA-016-E2E-1 corre contra la API real con un
  dataset que ningún stub podría producir (el ciclo de vida de X-1).
- ❌ **Assertar sobre el DOM cuando el AC es de status HTTP** (`playwright-stability` F59):
  C-2/N-1 verifican el código de respuesta real (`response.status()`), no sólo el texto
  renderizado.
- ❌ **Escenarios sin ejecutar disfrazados de ejecutables**: a diferencia de los tres
  precedentes Modo A anteriores de este repo, ningún test case de este plan lleva
  `blocked_by` — se declara explícitamente en el header que las capacidades de las que
  depende ya están archivadas.

---

## 10. Standards consultados

`testing-standards.md` (§2 pirámide, §5 datos, §14 patrones, §14.9 negative-space, §18
anti-patterns) · `qa-backend-standards.md` (§2.1 ownership, §13 performance, §15 datos,
§21 BDD) · `qa-frontend-standards.md` (§2.1 ownership, §19 accesibilidad, §23 Playwright)
· `performance-standards.md` (§7 diseño del load test, §8 budgets en CI) ·
`base-standards.md` (§1 KISS/YAGNI) · skills `qa-three-layer-regression`,
`bdd-scenario-quality`, `playwright-stability`, `k6-load-scaffolding`,
`flakiness-detection`, `nfr-quantification` (consultado para confirmar que el NFR de
latencia ya viene heredado de PRD §4/design.md §D8, sin necesidad de proponer un número
nuevo), `openspec-workflow` (convención Modo A + traceability matrix).

---

## 11. Open questions

- **OQ-QA-016-1**: ¿Vale la pena un presupuesto de latencia propio para los 3 endpoints
  `/export`, dado que hoy no tienen threshold (§5.5)? Recomendación: no proponerlo hasta
  que exista un catálogo real con volumen suficiente para que el tamaño del CSV importe
  — hoy (~100 órdenes/mes) el archivo es trivialmente chico.
- **OQ-QA-016-2**: TC-016-E2 (charter de anonimización × métricas) sale de leer el diseño,
  no de un AC formal que una las dos capacidades. Si el PO quiere esa garantía
  automatizada, es candidato a un AC nuevo en `US-016` o `US-021`, no una suposición de
  este plan.

---

## 12. Dependencias declaradas

| Dependencia | Estado | Efecto |
|---|---|---|
| `US-016-panel-metricas-backend` (este change) | 23/23 tasks, PR #55 in review | Ninguno bloqueante — la ejecución de este plan espera el merge, no la planificación |
| `US-016-panel-metricas-frontend-web` | 25/25 tasks, PR #59 in review (stacked sobre #55) | Ídem |
| `US-008-checkout-guest-backend` | Archivado | Resuelto — fuente de las órdenes reales de X-1 |
| `US-023-pago-manual-offline-backend` | Archivado | Resuelto — `confirm-payment` real para B/C/D/E |
| `US-010-orden-webhook-stock-backend` | Archivado | Resuelto — `simulate-payment` real para F (cancelación por stock) |
| `US-012-panel-ordenes-dueno-backend` | Archivado | Resuelto — `PATCH` real de fulfillment para C/D/E |
| `US-014-registro-login-backend` | Archivado (QA con `[Open]` no bloqueante para este plan) | Resuelto — sesión de cliente real para N-1 |
| `US-021-retencion-datos-ordenes-*` | Archivado (BE/QA); FE in review | No bloqueante — sólo referenciado por el charter TC-016-E2 |

**A diferencia de los tres precedentes Modo A previos de este repo** (US-008/US-009/US-023,
que declararon uno o más ítems `Blocked-by` un sibling sin construir), **ningún test case
de este plan queda bloqueado**: las cuatro capacidades de las que depende el dataset
cross-feature (checkout, pagos manual, pagos simulado, fulfillment) ya están archivadas.
Sólo falta el merge de los dos PR de esta misma US para poder ejecutar.

---

## 13. References

- User story: `docs/user-stories/US-016-panel-metricas.md`
- PRD: `docs/product/prd.md` §2.1 capacidad 9, §4, §6
- E2E: `docs/product/design-e2e.md` §6.1, §17, §18, §18.5
- Backend de este change: `proposal.md`, `design.md` (§D1-D10), `tasks.md`
- Frontend hermano: `openspec/changes/US-016-panel-metricas-frontend-web/{proposal,design,tasks}.md`
- Specs vivas consultadas (sin modificar): `openspec/specs/ordenes/requirements.md`
  (R-1..R-8, allowlist de 4 estados y FSM de fulfillment), `openspec/specs/pagos/requirements.md`
  (R-1..R-17, confirmación manual y webhook/simulado, R-10 cancelación por stock),
  `openspec/specs/checkout/` (CAP-10, origen de `orders`/`order_items`)
- Precedentes Modo A de este repo: `US-008-checkout-guest-backend/qa-plan.md`,
  `US-009-pago-mercadopago-backend/qa-plan.md`,
  `openspec/changes/archive/US-023-pago-manual-offline-backend/qa-plan.md`
- Precedente de contenido/formato (Modo B, capacidad admin análoga):
  `openspec/changes/archive/US-012-panel-ordenes-dueno-qa/qa-plan.md`
