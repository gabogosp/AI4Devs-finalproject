---
parent-us: US-015
discipline: qa
language: es
---

# US-015 QA — Tasks

> Cada task se cierra cuando su `Verify:` pasa. Los comandos asumen la **raíz
> del repo** como cwd y el entorno de `qa/scripts/api-up.sh` levantado (mismo
> entorno que `US-014-registro-login-qa`/`US-010-orden-webhook-stock-qa` ya
> usan — `QA_API_BASE_URL`, `QA_WEB_BASE_URL`, Postgres real). Ninguna task de
> este plan toca `apps/api/src/`. **Ninguna task está ejecutada todavía** — este
> plan queda para `/develop-qa`.

## Mapa de cobertura (definición de cada caso)

Cada fila **define** su `SC-`/`QA-` en este documento; el escenario Gherkin
completo vive en `qa-plan.md` §4. `manual` no se scaffoldea: queda como
checklist humano.

| id | Task | AC | Capa | Estado |
|---|---|---|---|---|
| SC-015-H1 | T1.1 | AC-1, AC-4 | 1 | pendiente |
| SC-015-H2 | T1.1 | AC-2 | 1 | pendiente |
| SC-015-A1 | T1.2 | AC-3 | 1 | pendiente |
| SC-015-C1 | T2.1 | AC-7 | 1 | pendiente |
| SC-015-C2 | T2.2 | (paginación) | 1 | pendiente |
| SC-015-C3 | T2.2 | (paginación) | 1 | pendiente |
| SC-015-C4 | T2.3 | AC-1 | 1 | pendiente |
| SC-015-C5 | T2.4 | (default documentado) | 1 | pendiente |
| SC-015-N1 | T3.1 | AC-5 | 1 | pendiente |
| SC-015-N2 | T3.2 | AC-4 | 1 | pendiente |
| SC-015-N3 | T3.3 | AC-6 | 1 | pendiente |
| QA-015-CT-1 | T4.1 | (contrato de los 2 endpoints) | 1 | pendiente |
| QA-015-PERF-1/2 | T5.2, T5.3 | (NFR §9) | 1 | pendiente |
| QA-015-EXP-1 | T6.1 | (exploratorio) | — | pendiente (charter a redactar; ejecución humana posterior) |

---

## Pre-requisitos

- [ ] **Backend de US-015 mergeado, superficie viva.** No es una planificación
  pendiente — el código corre (PR #70 + #71, 26/26 tasks).
  - **Verify**: `test -f apps/api/src/orders/orders-history.controller.ts && test -f apps/api/src/auth/resolve-customer-session.ts`
- [ ] **Entorno de QA arriba**, con la API real + Postgres real
  (`qa/scripts/api-up.sh`).
  - **Verify**: `curl -sS -m 10 -o /dev/null -w "%{http_code}" "${QA_API_BASE_URL:-http://localhost:3009}/health" | grep -qx 200`
- [ ] **`PAYMENTS_SIMULATED_ENABLED=true` está seteado en el entorno de QA**
  (sin esto, `compraLogueada()` de T0.1 no puede confirmar ninguna orden — el
  historial de cualquier escenario listaría siempre cero filas).
  - **Verify**: `curl -sS -m 10 -o /dev/null -w "%{http_code}" "${QA_API_BASE_URL:-http://localhost:3009}/v1/checkout/simulate-payment" -X POST -H "content-type: application/json" -d '{"order_token":"0000000000000000000000000000000000000000000000000000000000000000"}' | grep -qE '^(404|422)$'` (404 = token inexistente / 422 = formato — cualquiera de los dos confirma que la ruta existe, el flag está prendido, y responde)
- [ ] **`TRUST_PROXY_HOPS=1` en el entorno de QA** (sin esto, `nuevaCuenta()`
  de `customer-auth.ts` — reusada por T0.1 — agota su propio rate-limit de
  registro al sembrar varias cuentas en la misma corrida).
  - **Verify**: revisión de `qa/scripts/api-up.sh` (ya lo exporta — mismo pre-requisito que `US-014-registro-login-qa` documentó)

---

## Fase 0: Soporte del harness — cliente con sesión que compra y confirma

- [x] T0.1 `qa/support/seed-order-history.ts` +
  `qa/support/seed-order-history.smoke.ts` — `compraLogueada()` /
  `compraLogueadaPendiente()`.
  - **Pattern**: `nuevaCuenta()` (`customer-auth.ts`, US-014) → envolver el
    `ctx` resultante en `new Invitado(ctx)` (`cart-client.ts`, agnóstico a si
    el `ctx` trae sesión) → `fijar(slug, 1)` → `checkout(buildCheckoutBody({
    buyer: buildBuyerData({ email: cuenta.email }) }))` → (sólo
    `compraLogueada`) `fetch('/v1/checkout/simulate-payment', { order_token
    })`, sin cookie (el endpoint no la exige) — mismo patrón de forma que
    `simularPagoAutomatico()` de `seed-metricas.ts` — per `design.md` §D-QA3.
    El `.smoke.ts` sigue la convención ya establecida en `qa/support/`
    (`.smoke.ts` standalone que se auto-verifica sin cucumber).
  - **Exit criterion**: `compraLogueada(slug)` deja una orden con
    `status !== 'pending_payment'` y `customer_id` igual al `id` de la cuenta
    creada (verificado consultando `GET /v1/me/orders` con esa misma sesión —
    aparece exactamente 1 orden); `compraLogueadaPendiente(slug)` deja la
    orden en `pending_payment` (no aparece en `GET /v1/me/orders` con esa
    sesión).
  - **Verify**: `pnpm --filter @dsm/qa exec tsx support/seed-order-history.smoke.ts` (exit 0; siembra una cuenta real, compra, confirma, y falla si la orden no aparece en su propio historial o si aparece con estado `pending_payment`)

---

## Fase 1: Suite de aceptación — happy path y estado vacío

- [x] T1.1 `qa/acceptance/features/historial-compras.feature` +
  `qa/acceptance/steps/historial-compras.steps.ts` — SC-015-H1, SC-015-H2.
  - **Pattern**: `Característica`/`Antecedentes`/`Escenario` en español, mismo
    estilo que `pago-webhook.feature`; steps contra `APIRequestContext` (nunca
    `supertest`, per `design.md` §D-QA6). Reusa el step ya registrado
    globalmente "Dado un catálogo sembrado con productos disponibles"
    (`pago-manual.steps.ts`) — no se re-registra. Cada escenario siembra su
    propia cuenta con `compraLogueada` (T0.1).
  - **Exit criterion**: SC-015-H1 verde — dos compras propias aparecen
    ordenadas `-created_at` con fecha/estado/total, y la orden de un segundo
    cliente NUNCA aparece en el listado del primero; SC-015-H2 verde — el
    detalle trae `items[]` (con cantidad/precio), `status` y `fulfillment`.
  - **Verify**: `pnpm --filter @dsm/qa test:acceptance --tags "@us-015 and @happy"`

- [x] T1.2 SC-015-A1 (estado vacío, AC-3).
  - **Pattern**: cliente registrado sin ninguna compra (`nuevaCuenta()` sola,
    sin `compraLogueada`) → `GET /v1/me/orders`.
  - **Exit criterion**: responde 200 con `data: []` y `pagination.total === 0`
    — nunca un error, nunca un caso especial (el backend no distingue "sin
    compras" de "0 resultados por cualquier filtro").
  - **Verify**: `pnpm --filter @dsm/qa test:acceptance --tags "@us-015 and @alternative"`

---

## Fase 2: Suite de aceptación — corner

- [x] T2.1 SC-015-C1 (retención en el borde exacto, AC-7).
  - **Pattern**: `compraLogueada()` (T0.1) para producir la orden, luego
    `backdateOrder(orderId, horas)` (`backdate-order.ts`, US-010, sin
    modificar) para dejar `created_at` exactamente en el corte de 12 meses y,
    en el segundo Ejemplo, 1ms antes — per `design.md` §D-QA4. El `id` interno
    se resuelve directo por Prisma (el historial nunca lo expone).
  - **Exit criterion**: en el corte exacto (`gte`), la orden aparece en el
    listado y su detalle responde 200; 1ms antes del corte, no aparece y su
    detalle responde 404 — sin off-by-one.
  - **Verify**: `pnpm --filter @dsm/qa test:acceptance --tags "@us-015 and @corner and @critical-path"`

- [x] T2.2 SC-015-C2, SC-015-C3 (paginación — offset fuera de rango, parámetros
  inválidos).
  - **Pattern**: `compraLogueada()` una vez → `GET /v1/me/orders?offset=<N>`
    con `N` mayor al total (SC-015-C2, boundary) y con
    `offset=-1`/`offset=no-numerico`/`limit=0`/`limit=101` (SC-015-C3, Esquema
    del escenario) — el `ValidationPipe` (`class-validator`,
    `ListOrderHistoryQueryDto`) rechaza los cuatro con 422 antes de tocar la
    base.
  - **Exit criterion**: SC-015-C2 verde — 200 con `data: []` y
    `pagination.total` igual al total real (no 0); SC-015-C3 verde — los 4
    casos responden 422 `application/problem+json`, y ninguno ejecuta la
    query (verificado indirectamente: la cuenta sigue teniendo exactamente 1
    orden visible con parámetros válidos, antes y después).
  - **Verify**: `pnpm --filter @dsm/qa test:acceptance --tags "@us-015 and @corner and not @critical-path"`

- [x] T2.3 SC-015-C4 (compra pending_payment excluida, regla de negocio de
  AC-1).
  - **Pattern**: `compraLogueadaPendiente()` (T0.1) — la orden queda
    `pending_payment`, nunca confirmada.
  - **Exit criterion**: esa orden no aparece en `GET /v1/me/orders`, y su
    detalle (`GET /v1/me/orders/{order_number}`) responde 404 — mismo
    tratamiento que "no existe" (una orden `pending_payment` no es una
    "compra" en el sentido de AC-1, `design.md` de backend §Approach).
  - **Verify**: `pnpm --filter @dsm/qa test:acceptance --tags "@us-015 and @corner and @critical-path"` (mismo tag que T2.1; corren juntos)

- [x] T2.4 SC-015-C5 (orden anonimizada sigue visible, default documentado).
  - **Pattern**: `compraLogueada()` (T0.1) → resolver el `id` interno vía
    `GET /v1/admin/orders` (US-012, expone `id` en `AdminOrderSummaryDto`) con
    `adminAuthWithSource()` (`admin-auth.ts`) → `dispararAnonimizacion(w, id)`
    (importado de `retencion-ordenes.steps.ts`, sin copiarlo) — per `design.md`
    §D-QA5.
  - **Exit criterion**: tras anonimizar, `GET /v1/me/orders` sigue mostrando
    esa orden con `total_ars_cents`/`status`/`created_at` sin cambios, y su
    detalle sigue mostrando `items[]` con cantidades/precios sin cambios
    (verifica el default que `design.md` de backend documenta en
    Trade-offs — no filtrar por estado de anonimización).
  - **Verify**: `pnpm --filter @dsm/qa test:acceptance --tags "@us-015 and @corner and not @critical-path"` (mismo tag que T2.2; corren juntos)

---

## Fase 3: Suite de aceptación — negative space

- [x] T3.1 SC-015-N1 (sin sesión, AC-5, Esquema del escenario: listado y
  detalle).
  - **Pattern**: `request.newContext()` sin ninguna cookie de sesión →
    `GET /v1/me/orders` y `GET /v1/me/orders/{n}` (cualquier `n`).
  - **Exit criterion**: ambos responden 401 `application/problem+json`, y el
    cuerpo de la respuesta no contiene ninguna clave `order_number`/`data`
    con filas (verificado con `Object.keys()`/longitud, no sólo por status).
  - **Verify**: `pnpm --filter @dsm/qa test:acceptance --tags "@us-015 and @negative and @critical-path"`

- [x] T3.2 SC-015-N2 (detalle ajena — IDOR, AC-4).
  - **Pattern**: dos `compraLogueada()` de cuentas distintas → el segundo
    cliente pide `GET /v1/me/orders/{order_number del primero}`.
  - **Exit criterion**: responde 404 con el mismo `type`
    (`dsm:checkout/order-not-found`) y `title` que pedir un `order_number` que
    no existe en absoluto — indistinguibles (verificado comparando ambos
    cuerpos de respuesta, no sólo el status).
  - **Verify**: `pnpm --filter @dsm/qa test:acceptance --tags "@us-015 and @negative and @critical-path"` (mismo tag que T3.1; corren juntos)

- [x] T3.3 SC-015-N3 (guest con mismo email no se vincula, AC-6, privacidad).
  - **Pattern**: `nuevoInvitado()` (`cart-client.ts`, sin sesión) →
    `fijar()`/`checkout(buildCheckoutBody({ buyer: buildBuyerData({ email:
    EMAIL_COMPARTIDO }) }))` → confirmar vía `simulate-payment` — produce una
    orden real con `customer_id = null`. Luego `nuevaCuenta()` **con ese mismo
    `EMAIL_COMPARTIDO`** (override del builder de cuentas de
    `customer-auth.ts`, si lo soporta; si no, registrar directo con
    `POST /v1/auth/register` usando ese email) → `GET /v1/me/orders` con esa
    sesión.
  - **Exit criterion**: el listado de la cuenta nueva NO incluye la orden de
    invitado (mismo email) — `pagination.total` cuenta únicamente las compras
    hechas con esa sesión activa, cero para este escenario si no se agrega
    ninguna compra logueada.
  - **Verify**: `pnpm --filter @dsm/qa test:acceptance --tags "@us-015 and @negative and @critical-path"` (mismo tag que T3.1/T3.2; corren juntos)

---

## Fase 4: Contract testing

- [x] T4.1 `qa/contract/order-history.contract.ts` — QA-015-CT-1.
  - **Pattern**: script `tsx` standalone con `fetch`, mismo estilo que
    `pago-webhook.contract.ts`/`retencion-ordenes.contract.ts` (sin jest, sin
    `supertest`), per `design.md` §D-QA1 — valida contra
    `apps/api/docs/api/openapi.yaml` (el contrato **publicado**, no el vivo,
    que todavía no existe). Registrar `test:contract:order-history` en
    `qa/package.json`, sin tocar los `test:contract:*` existentes.
  - **Exit criterion**: valida forma de respuesta + catálogo RFC 7807 de los 2
    endpoints — ver `qa-plan.md` §6 para el detalle completo de casos (200,
    401, 404, 422, 429 con cabeceras `RateLimit-*`).
  - **Verify**: `QA_API_BASE_URL=http://localhost:3009 pnpm --filter @dsm/qa test:contract:order-history`

---

## Fase 5: Performance (k6)

- [x] T5.1 `qa/performance/seed-orders-history-load.ts` — pre-seed Node/tsx.
  - **Pattern**: mismo estilo que `seed-orders-load.ts` (US-012), pero
    produciendo cuentas de cliente reales con `compraLogueada()` (T0.1) en
    vez de órdenes admin directas — N cuentas, cada una con exactamente 1
    compra confirmada. Escribe `data/orders-history-load-accounts.json` con
    `[{email, password}]` (contraseña sintética fija,
    `PASSWORD_VALIDA` de `customer-auth.ts`).
  - **Exit criterion**: el archivo generado tiene `N` entradas con `email`
    único por corrida (prefijo `qa-us015-carga-{timestamp}-{i}`); cada cuenta
    tiene exactamente 1 orden confirmada verificable vía `GET /v1/me/orders`.
  - **Verify**: `QA_ORDERS_HISTORY_POOL_SIZE=20 pnpm --filter @dsm/qa exec tsx performance/seed-orders-history-load.ts && test -f qa/performance/data/orders-history-load-accounts.json && node -e "const a=require('./qa/performance/data/orders-history-load-accounts.json'); process.exit(a.length===20?0:1)"`

- [x] T5.2 `qa/performance/orders-history-read.js` — QA-015-PERF-1.
  - **Pattern**: lee `data/orders-history-load-accounts.json` con `open()`
    (nunca descubre cuentas por la API — la base es compartida por otras
    sesiones QA en paralelo). Por iteración: `POST /v1/auth/login` (no
    tagueado) + `GET /v1/me/orders` (tagueado `orders_history_list`),
    reusando el jar de cookies automático por VU de k6 (documentado inline en
    el script, sin manipular headers `Cookie` a mano) — per `design.md`
    §D-QA7. `check()` valida `status === 200` y `pagination.total >= 1`,
    gateado por `checks: ['rate>0.99']`.
  - **Exit criterion**: `http_req_duration{endpoint:orders_history_list}` con
    threshold `p(95)<300` (heredado de la US §9, no inventado).
  - **Verify**: `QA_API_BASE_URL=http://localhost:3009 k6 run qa/performance/orders-history-read.js --summary-trend-stats="p(95)"`

- [x] T5.3 `qa/performance/lib/thresholds.js` — QA-015-PERF-2.
  - **Exit criterion**: exporta `orders_history_list` con
    `'http_req_duration{endpoint:orders_history_list}': ['p(95)<300']` —
    entrada propia, no reusa `list_orders` (admin).
  - **Verify**: `grep -q "orders_history_list" qa/performance/lib/thresholds.js && grep -q "p(95)<300" qa/performance/lib/thresholds.js`

---

## Fase 6: Exploratorio y cierre

- [ ] T6.1 Charter `qa/exploratory/us-015-historial-compras.md` —
  QA-015-EXP-1 (manual).
  - **Exit criterion**: documenta los 3 charters de `qa-plan.md` §10 con su
    tiempo asignado, el riesgo que exploran y dónde se registran los
    hallazgos. Queda como checklist humano; `/develop-qa` no lo scaffoldea.
  - **Verify**: `test -f qa/exploratory/us-015-historial-compras.md && grep -c "^## Charter" qa/exploratory/us-015-historial-compras.md | grep -qx 3`

- [ ] T6.2 Trazabilidad AC → escenario, sin huecos.
  - **Exit criterion**: los 7 AC de US-015 aparecen en la matriz de
    `qa-plan.md` §3 con al menos un escenario ejecutable; cada `SC-`/`QA-` de
    la matriz existe como escenario Gherkin, contract test, script k6 o
    charter.
  - **Verify**: `python3 -c "
import re,pathlib
plan=pathlib.Path('openspec/changes/US-015-historial-compras-qa/qa-plan.md').read_text()
acs=set(re.findall(r'AC-(\d+)', pathlib.Path('docs/user-stories/US-015-historial-compras.md').read_text()))
faltan=[a for a in acs if f'AC-{a} ' not in plan and f'AC-{a},' not in plan and f'AC-{a})' not in plan and f'AC-{a}\`' not in plan]
scs=set(re.findall(r'SC-015-[A-Z]\d', plan))
import sys; sys.exit(0 if not faltan and len(scs)>=11 else 1)"`

---

## Verification (suite-level)

- [ ] Suite de aceptación completa verde: `pnpm --filter @dsm/qa test:acceptance --tags "@us-015"` — objetivo 18/18 casos verdes (11 `SC-015-*`, contando Examples de los 3 Esquemas: C1×2, C3×4, N1×2).
- [ ] Contract test verde: `pnpm --filter @dsm/qa test:contract:order-history`
- [ ] Carga dentro del presupuesto: `k6 run qa/performance/orders-history-read.js` — p95 dentro de 300ms, `rate>0.99` en checks.
- [ ] **Sin regresión en las suites QA ya existentes** (`pago-manual`,
  `pago-webhook`, `retencion-ordenes`): `pnpm --filter @dsm/qa test:acceptance --tags "@pagos or @retencion-ordenes"` — debe seguir verde, sin interferencia de las cuentas/órdenes nuevas de `@us-015` (cada escenario siembra su propia cuenta, §9 de `qa-plan.md`).
- [ ] El charter manual ejecutado y sus hallazgos registrados (humano) —
  el charter se ESCRIBE en T6.1; su ejecución queda para el humano, fuera del
  alcance automatizable de este plan.

## Trazabilidad AC → escenario

| AC de US-015 | Escenarios QA-owned | Estado |
|---|---|---|
| AC-1 ver el listado de mis compras | SC-015-H1, SC-015-C4 | planificado |
| AC-2 ver el detalle de una compra | SC-015-H2 | planificado |
| AC-3 cliente sin compras | SC-015-A1 | planificado |
| AC-4 solo ve sus propias órdenes | SC-015-H1, SC-015-N2 | planificado |
| AC-5 requiere sesión | SC-015-N1 | planificado |
| AC-6 compras guest no se vinculan | SC-015-N3 | planificado |
| AC-7 retención del historial | SC-015-C1 | planificado |
