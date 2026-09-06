---
parent-us: US-015
discipline: qa
language: es
---

# US-015 — Plan de QA (capas QA-owned)

> **Service tier**: mixto — **derivado** (no hay `service-catalog.yaml` en el
> repo). El **escritor** (`orders.customer_id` en el checkout, vía
> `OptionalCustomerGuard`) hereda la clasificación **Tier 1** del camino crítico
> que modifica — el propio `design.md` de backend lo dice explícito en
> "Deployment considerations": "`POST /v1/checkout` es la superficie de
> escritura pública más sensible del proyecto". El **lector**
> (`GET /v1/me/orders*`) es **Tier 2**: valor de cuenta, sin dinero en juego,
> sin dependencia cross-service, comparable a `US-001`/`US-003`. Se registra la
> derivación explícitamente (regla de tier-resolution: catálogo ausente →
> derivar de `proposal.md`/US), no se asume en silencio.

## 1. Perfil de riesgo

| Componente | Clasificación | Por qué |
|---|---|---|
| Escritor `orders.customer_id` (`OptionalCustomerGuard` en `POST /v1/checkout`) | **Tier 1 (heredado)** | Toca el único endpoint de escritura pública que mueve plata del proyecto; un defecto acá es indistinguible de un defecto en el checkout guest mismo (AC-6 exige "cero cambio observable"). |
| Autorización del historial (`customer_id` + retención en el WHERE) | **Alto** | Es la única superficie no-admin que expone datos de `orders`/`order_items` a un cliente autenticado — un fallo es IDOR real (un cliente ve la compra de otro). |
| Regla de negocio "guest no se vincula" (AC-6, privacidad) | **Alto** | Es una decisión de privacidad explícita del PO; un defecto acá filtra datos de compra entre una cuenta y una compra anónima con el mismo email, sin que el cliente lo haya autorizado. |
| Lector `GET /v1/me/orders*` (listado/detalle, paginación, retención) | Tier 2 | Valor de cuenta, sin dinero en juego, sin dependencia externa. |
| Retención (corte de 12 meses en el WHERE) | Medio | Ya probado dev-owned en el borde (`orders.repository.spec.ts`); este plan lo verifica desde afuera, black-box. |

**Journeys críticas identificadas**:

1. Un cliente con sesión activa compra → el checkout setea `customer_id` sin
   cambiar el camino guest → esa compra aparece en su propio historial, y en
   ningún otro (AC-1, AC-4, AC-9-del-backend-escritor).
2. Un cliente abre el historial de otro (por `order_number` ajeno) → nunca ve
   nada que no sea suyo, indistinguible de "no existe" (AC-4, IDOR).
3. Una compra hecha como invitado, con el mismo email de una cuenta existente,
   nunca aparece en el historial de esa cuenta (AC-6, privacidad).
4. Sin sesión válida, cero filas expuestas en cualquiera de los dos endpoints
   (AC-5).

## 2. Mapeo de la pirámide de test (capas QA-owned en negrita)

| Capa | Dueño | Estado | Herramienta |
|---|---|---|---|
| Unit (`resolve-customer-session`, `retention-cutoff`, DTOs, eventos) | Dev (TDD) | **Hecho** — `tasks.md` Fase 0-3 | Jest |
| Integration (`orders.repository`, `orders-history.service`, Postgres real) | Dev (TDD) | **Hecho** — Fase 2-3 | Jest + Postgres real |
| e2e-nest (contrato HTTP: listado, detalle, checkout-customer-link) | Dev (TDD) | **Hecho** — Fase 4-5 (`e2e-orders-history-{list,detail}.spec.ts`, `e2e-checkout-customer-link.spec.ts`) | Jest + supertest + Postgres real |
| Regresión completa de US-008 (AC-6, "cero cambio observable") | Dev (TDD) | **Hecho** — Fase 5, T5.5, diff vacío sobre 12 archivos | Jest + Postgres real |
| **Aceptación BDD (Layer 1, backend-aislado, persistente)** | **QA** | Este plan | Cucumber-js + Playwright `APIRequestContext` |
| **Contract testing** | **QA** | Este plan | Script `tsx` contra el contrato publicado |
| **Performance (k6)** | **QA + Dev** | Este plan | k6 |
| **Exploratorio** | **QA** | Este plan | Charters manuales |
| E2E cross-stack (Layer 3) | **QA** | **Diferido** — no hay UI construida todavía (`proposal.md` §Out of scope) | Playwright (futuro) |
| Accesibilidad / regresión visual | N/A en este change | Sin UI de esta US construida todavía | — |

> **Nota de cobertura dev-owned (awareness, no se re-autora)**: `tasks.md` de
> backend ya prueba, contra Postgres real, el listado ordenado con retención
> (T5.7), el detalle con IDOR estructural (T5.8), el borde exacto de la
> retención (T5.9), y la regresión completa del checkout guest sin modificar
> una sola aserción (T5.5). Este plan **no duplica** esos specs; construye la
> capa de aceptación **persistente** (per skill `qa-three-layer-regression`) y
> las capas que `tasks.md` no cubre por diseño (contract testing formal, k6,
> exploratorio) — mismo criterio ya aplicado por `US-010-orden-webhook-stock-qa/qa-plan.md`
> §2 para la misma clase de capacidad.

## 3. Matriz de trazabilidad AC → escenarios (autocheck F47)

| AC | Título | Escenario(s) | Capa | Estado |
|---|---|---|---|---|
| AC-1 | Ver el listado de mis compras | `SC-015-H1`, `SC-015-C4` | 1 | Ejecutable |
| AC-2 | Ver el detalle de una compra | `SC-015-H2` | 1 | Ejecutable |
| AC-3 | Cliente sin compras (alternative path) | `SC-015-A1` | 1 | Ejecutable |
| AC-4 | Solo ve sus propias órdenes (negative space) | `SC-015-H1`, `SC-015-N2` | 1 | Ejecutable |
| AC-5 | Requiere sesión (negative space) | `SC-015-N1` | 1 | Ejecutable |
| AC-6 | Las compras guest no se vinculan automáticamente (negative space) | `SC-015-N3` | 1 | Ejecutable |
| AC-7 | Retención del historial (negative space) | `SC-015-C1` | 1 | Ejecutable |
| — | Paginación con parámetros inválidos (regla de negocio adyacente, PRD §4) | `SC-015-C2`, `SC-015-C3` | 1 | Ejecutable |
| — | Orden anonimizada sigue visible (default documentado, backend `design.md` Trade-offs) | `SC-015-C5` | 1 | Ejecutable |

Todos los IDs citados arriba (`SC-015-H1/H2`, `SC-015-A1`, `SC-015-C1/C2/C3/C4/C5`,
`SC-015-N1/N2/N3`) están definidos en el `Feature:` de §4. No hay referencias
colgantes. Los 7 AC de la US tienen ≥1 escenario ejecutable — sin ningún `blocked`
(a diferencia de `US-010-orden-webhook-stock-qa`, esta US no depende de ningún
proveedor externo).

## 4. Escenarios BDD (Gherkin)

```gherkin
# language: es
@historial-compras @us-015
Característica: Historial de compras del cliente registrado (US-015)
  Como cliente registrado
  quiero ver el historial de mis compras
  para consultar qué compré y el estado de cada pedido

  Antecedentes:
    Dado un catálogo sembrado con productos disponibles

  # ─── HAPPY PATH ───

  @happy @critical-path
  Escenario: SC-015-H1 — El listado muestra sólo las compras propias, ordenadas de la más reciente a la más antigua (AC-1, AC-4)
    Dado un cliente con sesión que compró dos veces estando logueado
    Y otro cliente distinto que también compró estando logueado
    Cuando el primer cliente abre su historial de compras
    Entonces ve exactamente sus dos órdenes, con fecha, estado y total en ARS
    Y el listado está ordenado de la más reciente a la más antigua
    Y no aparece la orden del otro cliente

  @happy
  Escenario: SC-015-H2 — El detalle de una compra muestra ítems, cantidades, precios, estado y retiro (AC-2)
    Dado un cliente con sesión que compró un producto estando logueado
    Cuando abre el detalle de esa orden
    Entonces ve sus ítems con cantidades y precios
    Y ve el estado actual de la orden
    Y ve la modalidad de retiro en sucursal

  # ─── ALTERNATIVE PATH ───

  @alternative
  Escenario: SC-015-A1 — Un cliente sin compras ve un listado vacío, sin error (AC-3)
    Dado un cliente registrado que aún no compró estando logueado
    Cuando abre su historial
    Entonces recibe 200 con un listado vacío
    Y la paginación indica un total de cero

  # ─── CORNER ───

  @corner @critical-path
  Esquema del escenario: SC-015-C1 — La retención respeta el corte de 12 meses en el borde exacto (AC-7)
    Dado una compra propia con fecha "<antigüedad>"
    Cuando el cliente abre su historial
    Entonces esa compra "<resultado>" en el listado
    Y el detalle de esa compra "<resultado_detalle>"

    Ejemplos:
      | antigüedad                  | resultado    | resultado_detalle          |
      | exactamente en el corte     | aparece      | responde 200               |
      | un milisegundo antes del corte | no aparece | responde 404 (no existe)   |

  @corner
  Escenario: SC-015-C2 — Un offset más allá del total devuelve un listado vacío, no un error (paginación, PRD §4)
    Dado un cliente con sesión que compró una vez estando logueado
    Cuando pide su historial con un offset mayor a la cantidad total de sus compras
    Entonces recibe 200 con un listado vacío
    Y la paginación conserva el total real de compras

  @corner
  Esquema del escenario: SC-015-C3 — Parámetros de paginación inválidos se rechazan sin tocar la base (paginación)
    Dado un cliente con sesión que compró una vez estando logueado
    Cuando pide su historial con "<parámetro>" igual a "<valor>"
    Entonces recibe 422 sin exponer ninguna orden

    Ejemplos:
      | parámetro | valor        |
      | offset    | -1           |
      | offset    | no-numerico  |
      | limit     | 0            |
      | limit     | 101          |

  @corner @critical-path
  Escenario: SC-015-C4 — Una compra iniciada y nunca pagada no aparece en el historial (AC-1, regla de negocio)
    Dado un cliente con sesión que inició un checkout sin confirmar el pago
    Cuando abre su historial
    Entonces esa orden no aparece en el listado
    Y el detalle de esa orden responde 404

  @corner
  Escenario: SC-015-C5 — Una orden anonimizada a pedido sigue apareciendo con ítems y estado intactos (comportamiento documentado)
    Dado una compra propia que el dueño anonimizó a pedido
    Cuando el cliente abre su historial
    Entonces esa orden aparece en el listado con su fecha, estado y total sin cambios
    Y el detalle de esa orden muestra sus ítems y cantidades sin cambios

  # ─── NEGATIVE SPACE ───

  @negative @critical-path
  Esquema del escenario: SC-015-N1 — Sin sesión de cliente válida, ninguna orden se expone (AC-5)
    Cuando un visitante sin sesión pide "<endpoint>"
    Entonces recibe 401
    Y la respuesta no contiene ninguna orden

    Ejemplos:
      | endpoint                                   |
      | su listado de historial                    |
      | el detalle de una orden por su número       |

  @negative @critical-path
  Escenario: SC-015-N2 — El detalle de una orden ajena responde igual que una inexistente (AC-4, IDOR)
    Dado un cliente con sesión que compró estando logueado
    Y otro cliente distinto con sesión propia
    Cuando el segundo cliente pide el detalle de la orden del primero
    Entonces recibe 404
    Y la respuesta es indistinguible de pedir un número de orden que no existe

  @negative @critical-path
  Escenario: SC-015-N3 — Una compra hecha como invitado con el mismo email de una cuenta no aparece en su historial (AC-6, privacidad)
    Dado una compra hecha como invitado con el email de una cuenta que se registra después
    Cuando el dueño de esa cuenta abre su historial con su propia sesión
    Entonces esa compra de invitado NO aparece en el listado
    Y sólo aparecen las órdenes que ese cliente hizo estando logueado
```

**Tooling**: Cucumber-js con `qa/acceptance/steps/historial-compras.steps.ts`
contra Playwright `APIRequestContext`, mismo patrón que
`pago-webhook.steps.ts`/`retencion-ordenes.steps.ts`.
**Location**: `qa/acceptance/features/historial-compras.feature`.
**Test layer**: 1 (backend-aislado) para los 11 escenarios — no hay Layer 3 en
este change (`proposal.md` §Out of scope, `design.md` §D-QA2).

## 5. Stubs de casos de prueba

| id | execution_mode | test_layer | target_tooling | gherkin_scenario |
|---|---|---|---|---|
| QA-015-ACC-1 | automated | 1 | Cucumber-js + Playwright `APIRequestContext` | historial-compras.feature — SC-015-H1, H2, A1, C1 (×2 Examples), C2, C3 (×4 Examples), C4, C5, N1 (×2 Examples), N2, N3 (18 casos ejecutables contando Examples) |
| QA-015-CT-1 | automated | 1 | Script `tsx` (`fetch`, sin jest) | N/A (contract test, no BDD) — los 2 endpoints nuevos de esta US |
| QA-015-PERF-1 | automated | 1 | K6 | N/A (performance, no BDD) — `GET /v1/me/orders`, p95 < 300ms |
| QA-015-PERF-2 | automated | 1 | K6 | N/A (performance, no BDD) — registro del threshold en la fuente única |
| QA-015-EXP-1 | **manual** | — | Charter | Paginación con volumen real, husos horarios en el borde de retención, UX del offset/limit sin cursor |

## 6. Contract testing

- [x] **QA-015-CT-1**: contract test (`tsx`, mismo patrón que
  `pago-webhook.contract.ts`/`retencion-ordenes.contract.ts`) para los 2
  endpoints nuevos contra `apps/api/docs/api/openapi.yaml` (el contrato
  **publicado** — ver `design.md` §D-QA1 para por qué no es el contrato vivo).

  ```yaml
  id: QA-015-CT-1
  execution_mode: automated
  test_layer: 1
  target_tooling: Script tsx (fetch, sin jest)
  gherkin_scenario: N/A (contract test, no BDD)
  ```

  - Exit criterion: `GET /v1/me/orders` responde 200 con `OrderHistoryListResponse`
    (`data[]` con `order_number`/`status`/`total_ars_cents`/`created_at`, sin
    `id` ni datos de comprador; `pagination` con `limit`/`offset`/`total`), 401
    sin sesión, 422 con `offset`/`limit` fuera de rango; `GET
    /v1/me/orders/{order_number}` responde 200 con `OrderHistoryDetail`
    (suma `fulfillment`/`items[]`), 401 sin sesión, 404
    `dsm:checkout/order-not-found` para ajena/inexistente/fuera de retención
    (mismo `type`, indistinguibles); ambos responden 429 con cabeceras
    `RateLimit-*`/`Retry-After` cuando el presupuesto `orders_history`
    (`ORDERS_HISTORY_RATE_LIMIT_MAX`, default 60) se agota — sin propiedades
    extra en ningún shape.
  - Verify: `QA_API_BASE_URL=http://localhost:3009 pnpm --filter @dsm/qa test:contract:order-history`

## 7. Performance (k6)

- [x] **QA-015-PERF-1**: `qa/performance/orders-history-read.js` — target
  p95 < 300ms (US §9, heredado del PRD §4, sin inventar un número nuevo).

  ```yaml
  id: QA-015-PERF-1
  execution_mode: automated
  test_layer: 1
  target_tooling: K6
  gherkin_scenario: N/A (performance, no BDD)
  ```

  - Exit criterion: pre-seed (`seed-orders-history-load.ts`, Node/tsx, corrido
    ANTES de k6) registra N cuentas de cliente reales, cada una con 1 compra
    logueada confirmada (`compraLogueada`, `design.md` §D-QA3), y escribe sus
    credenciales a `data/orders-history-load-accounts.json`. El script de k6
    hace, por iteración: login (no tagueado) + `GET /v1/me/orders` (tagueado
    `orders_history_list`), reusando el jar de cookies automático por VU.
    `checks` valida `status === 200` y `pagination.total >= 1`, gateado por
    `checks: ['rate>0.99']`.
  - Verify: `QA_API_BASE_URL=http://localhost:3009 k6 run qa/performance/orders-history-read.js --summary-trend-stats="p(95)"`

- [x] **QA-015-PERF-2**: threshold agregado a la fuente única
  `qa/performance/lib/thresholds.js`.

  ```yaml
  id: QA-015-PERF-2
  execution_mode: automated
  test_layer: 1
  target_tooling: K6
  gherkin_scenario: N/A (performance, no BDD)
  ```

  - Exit criterion: `thresholds.js` exporta `orders_history_list` con
    `'http_req_duration{endpoint:orders_history_list}': ['p(95)<300']` — entrada
    propia, no reusa `list_orders` (admin) para no diluir la señal de un patrón
    de acceso distinto (mismo criterio que `list_products` vs
    `storefront_product`).
  - Verify: `grep -q "orders_history_list" qa/performance/lib/thresholds.js && grep -q "p(95)<300" qa/performance/lib/thresholds.js`

> **No se planifica k6 para el detalle** (`GET /v1/me/orders/{order_number}`):
> el NFR de la US cuantifica la lectura del historial en general y el listado es
> el camino de mayor volumen (una apertura, N órdenes en una sola llamada); el
> detalle es 1 request por click, volumen bajo — mismo criterio de alcance que
> `QA-023-PERF-1` aplicó a un solo endpoint en vez de a toda la superficie.

## 8. E2E cross-stack (Layer 3)

**Diferido** — no hay UI de esta US construida todavía
(`US-015-historial-compras-frontend-web` en curso, otro worktree, sin cerrar).
Ver `proposal.md` §Out of scope y `design.md` §D-QA2 para el razonamiento
completo. Cuando el FE cierre y el namespace de rutas quede decidido, un change
QA hermano posterior (o una extensión de este mismo change, a decidir por quien
retome) agrega el escenario "el cliente abre su historial en el navegador y ve
sus compras" — reusando `qa/support/seed-order-history.ts` (§9) tal cual, sin
modificarlo.

## 9. Datos y fixtures

### Helpers nuevos requeridos

- **`qa/support/seed-order-history.ts`**: `compraLogueada(slug, sufijoCuenta?)`
  — cliente con sesión (`nuevaCuenta()`, US-014) que compra
  (`Invitado(ctx).fijar()`/`.checkout()`, reusado sin modificar) y confirma vía
  `simulate-payment` (reusado, mismo patrón que `simularPagoAutomatico()` de
  `seed-metricas.ts`); `compraLogueadaPendiente(slug, sufijoCuenta?)` — igual,
  sin el paso de confirmación, para `SC-015-C4`. Ver `design.md` §D-QA3.

### Reuso existente (sin modificar)

- `qa/support/customer-auth.ts` (US-014) — `nuevaCuenta()`, sesión de cliente
  real.
- `qa/support/cart-client.ts` — `Invitado` (agnóstico a si el `ctx` trae
  sesión), `buildCheckoutBody()`.
- `qa/support/backdate-order.ts` (US-010) — para `SC-015-C1` (retención en el
  borde), per `design.md` §D-QA4. Nunca para sembrar el resto de la suite ni
  para simular el efecto que el escenario prueba.
- `qa/support/admin-auth.ts` + `dispararAnonimizacion()` (importado de
  `qa/acceptance/steps/retencion-ordenes.steps.ts`) — para `SC-015-C5`, per
  `design.md` §D-QA5.
- `qa/support/builders.ts` (`buildBuyerData`, `buildCheckoutBody`) — para
  `SC-015-N3` (email del comprador guest = email de la cuenta).

### Estrategia de datos (per `testing-standards.md` §5)

- 100% sintético — ningún dato de producción.
- Defaults determinísticos en los builders existentes; ningún `Math.random()`/
  `Date.now()` salvo IDs opacos que el propio sistema genera.
- Cada escenario siembra su propia cuenta y su propia orden — nunca reusa la de
  otro escenario (evita colisiones entre tests en paralelo, mismo criterio que
  `US-014-registro-login-qa`/`US-010-*-qa` ya aplican).

## 10. Exploratory charters

Agregar a `qa/exploratory/us-015-historial-compras.md`:

1. **Charter: paginación con volumen real** — sembrar 50+ compras logueadas
   para un mismo cliente y navegar página por página con `limit`/`offset`
   manuales — ¿el listado se mantiene consistente (sin duplicados ni saltos) si
   se intercala una compra nueva entre dos páginas leídas?
2. **Charter: husos horarios en el borde de retención** — el corte de 12 meses
   se calcula con `setMonth` sobre el reloj del servidor (UTC); explorar qué ve
   un cliente en un huso horario con offset negativo (ej. Argentina, UTC-3)
   justo en el día del corte — ¿el borde percibido coincide con el que el
   cliente esperaría según su propio reloj local?
3. **Charter: UX del offset/limit sin cursor** — con cientos de órdenes reales,
   explorar si el contrato de paginación por offset (sin cursor) tiene algún
   comportamiento sorprendente para el consumidor (ej. una compra nueva
   corriendo el offset de las páginas ya leídas) — información para quien
   diseñe el FE, no un defecto de este backend.

## 11. Quality gates

| Gate | Bloquea | Disparador |
|---|---|---|
| Contract (`QA-015-CT-1`) | merge | todo PR que toque `apps/api/src/orders/` u `orders-history*` |
| Aceptación BDD (`QA-015-ACC-1`) | merge | todo PR que toque `apps/api/src/orders/` o `apps/api/src/checkout/{checkout.controller,checkout.service,orders.repository}.ts` |
| k6 p95 < 300ms (`QA-015-PERF-1`) | release | pre-release |
| E2E cross-stack | uat promotion | **no aplica todavía** — se agrega cuando exista la UI (§8) |

## 12. Anti-patterns evitados

- ❌ `qa-backend-standards.md` §2.1 ("QA writes all the tests"): unit/
  integration/e2e-nest de `tasks.md` de backend son dev-owned y no se
  re-autoran acá (§2).
- ❌ `testing-standards.md` §14.9 (negative-space ausente): las 4 AC
  negative-space de la US (AC-4, AC-5, AC-6, AC-7) quedan con al menos un
  escenario ejecutable, ninguna declarada `blocked` — esta US no depende de
  ningún proveedor externo.
- ❌ Inventar un escenario E2E cross-stack contra una UI que no existe: se
  prefiere diferir explícitamente (`proposal.md` §Out of scope, `design.md`
  §D-QA2) antes que escribir un test que apunta a una ruta inexistente o que
  queda `@skip` sin fecha (mismo criterio que `US-010-*-qa` ya aplicó a su
  propio bloqueo por credencial externa — acá el bloqueo es de UI, no de
  credencial, pero el principio es el mismo: declarar explícito, nunca
  maquillar).
- ❌ `k6-load-scaffolding` ("sin thresholds" / "sólo promedios"):
  `QA-015-PERF-1` declara `thresholds` con percentil (p95), nunca sólo `avg`,
  con `checks` gateado.
- ❌ `flakiness-detection` — señal 5 (order dependencies): cada escenario
  siembra su propia cuenta y su propia orden, nunca reusa la de otro escenario
  (§9).
- ❌ `bdd-scenario-quality` (implementation leakage): ningún step habla de
  `WHERE customer_id = ...` ni de nombres de columnas — los steps describen
  comportamiento observable ("ve exactamente sus dos órdenes"), nunca la
  query que lo produce.

## 13. Preguntas abiertas / hallazgos

Las dos preguntas abiertas de este plan viven en `proposal.md` §Preguntas
abiertas con su default implementado — ninguna bloquea la ejecución de lo que
sí es alcanzable hoy (los 7 AC completos + las 3 reglas de negocio adyacentes).

**Linear MCP**: no conectado en esta sesión — sin sub-task de tracker que
anotar. Per `tracker-handoff` §2.4, se deja constancia acá en vez de omitirlo
en silencio.

## 14. Dependencias declaradas

| Dependencia | Estado | Efecto |
|---|---|---|
| `US-015-historial-compras-backend` | Mergeado (PR #70 + #71), pendiente de su propio `/archive-change` | Desbloquea todo §4-§10 — sin ningún `blocked` |
| `US-014-registro-login-qa` | Mergeado (PR #57, archivado) | Aporta `qa/support/customer-auth.ts` (`nuevaCuenta()`), reusado sin modificar |
| `US-010-orden-webhook-stock-qa` | Mergeado (PR #57, archivado) | Aporta `qa/support/backdate-order.ts` y el precedente de "contrato publicado, no vivo" (§D-QA1) |
| `US-021-retencion-datos-ordenes-*` | Mergeado, archivado | Aporta `POST /v1/admin/orders/{id}/anonymize` y su step `dispararAnonimizacion()`, reusados para `SC-015-C5` |
| `US-015-historial-compras-frontend-web` | En curso, otro worktree, sin cerrar | Bloquea el E2E cross-stack (Layer 3) — diferido, ver §8 |

## 15. Standards consultados

- `docs/base-standards.md`
- `docs/quality/testing-standards.md` §2 (pirámide), §4.1 (naming), §5 (datos
  de test), §8 (coverage), §14 (patrones de código de test), §14.9 (negative
  space), §18 (anti-patterns)
- `docs/quality/qa-backend-standards.md` §2.1 (ownership matrix), §13
  (performance), §15 (datos sintéticos), §21 (BDD y Gherkin)
- `docs/architecture/api-standards.md` §3, §8 (RFC 7807), §12 (cabeceras de
  rate-limit)
- `docs/architecture/decisions/0011-*` (topología de sesión de cliente —
  gobierna toda la Característica), `0013-*` (sesión de cliente en el FE,
  gobierna el futuro E2E de Layer 3)
- Skills: `qa-three-layer-regression` (modelo de capas, frontmatter
  obligatorio en §5-§7, criterio de diferimiento de Layer 3 sin UI),
  `bdd-scenario-quality` (tense declarativo, Scenario Outline en
  `SC-015-C1`/`SC-015-C3`/`SC-015-N1`), `k6-load-scaffolding` (thresholds
  NFR-atados, un solo endpoint), `threat-modeling-lite` (superficie 4,
  ya cerrada por el backend — este plan la verifica, no la reabre),
  `openspec-workflow`, `tracker-handoff` (constancia de MCP no conectado, §13)

## 16. Referencias

- User Story: `docs/user-stories/US-015-historial-compras.md`
- E2E: `docs/product/design-e2e.md` §8 (DER — `orders.customer_id`), §14
  (STRIDE/trust boundaries)
- Change de backend (mergeado, pendiente de archive): `proposal.md`,
  `design.md`, `tasks.md` — 26/26 tasks, PR #70, más el follow-up de
  publicación de contrato (PR #71)
- Contrato publicado: `apps/api/docs/api/openapi.yaml` (paths `/me/orders`,
  `/me/orders/{order_number}`)
- Changes relacionados: `openspec/changes/archive/US-010-orden-webhook-stock-qa/qa-plan.md`
  (precedente de "contrato publicado, no vivo" y de reuso de
  `backdate-order.ts`), `openspec/changes/US-014-registro-login-qa/`
  (precedente de formato de change hermano con backend/FE en curso paralelo)
