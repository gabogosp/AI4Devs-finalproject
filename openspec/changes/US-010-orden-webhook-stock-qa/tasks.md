---
parent-us: US-010
discipline: qa
language: es
---

# US-010 QA — Tasks

> Cada task se cierra cuando su `Verify:` pasa. Los comandos asumen la **raíz del repo**
> como cwd y el entorno de `qa/scripts/api-up.sh` levantado (mismo entorno que
> `US-014-registro-login-qa`/`US-012-panel-ordenes-dueno-qa` ya usan — `QA_API_BASE_URL`,
> `QA_WEB_BASE_URL`, Postgres real). Ninguna task de este plan toca `apps/api/src/`.

## Mapa de cobertura (definición de cada caso)

Cada fila **define** su `SC-`/`QA-` en este documento; el escenario Gherkin completo vive
en `qa-plan.md` §4. `manual` no se scaffoldea: queda como checklist humano o hallazgo
documentado.

| id | Task | AC | Capa | Estado |
|---|---|---|---|---|
| SC-010-H1 | T1.1 | AC-1, AC-9 | 1 | hecho |
| SC-010-H2 | T1.1 | AC-2 | 1 | hecho |
| SC-010-C1 | T1.2 | AC-5, AC-6 | 1 | hecho |
| SC-010-C2 | T1.2 | AC-8 | 1 | hecho |
| SC-010-C3 | T1.3 | AC-11 | 1 | hecho |
| SC-010-C4 | T1.3 | AC-10 | 1 | hecho |
| SC-010-N1 | T1.4 | AC-7 | 1 | hecho |
| SC-010-N2 | T1.5 | AC-3 | 1 | **bloqueado**, ver QA-010-F1 |
| SC-010-N3 | T1.4 | AC-4 | 1 | hecho |
| SC-010-N4 | T1.4 | AC-5 | 1 | hecho |
| SC-010-N5 | T1.4 | AC-9 | 1 | hecho |
| SC-010-N6 | T1.3 | AC-4 | 1 | hecho |
| QA-010-CT-1 | T2.1 | (contrato de los 5 endpoints) | 1 | por hacer |
| QA-010-PERF-1/2 | T3.1, T3.2 | AC-1/AC-9 (NFR) | 1 | por hacer |
| SC-010-X1 | T4.1 | AC-1, AC-9 | 3 | por hacer |
| SC-010-X2 | T4.2 | AC-4 | 3 | por hacer |
| QA-010-EXP-1 | T5.1 | (exploratorio) | — | por hacer |

---

## Pre-requisitos

- [x] **Backend de US-010 archivado, capacidad `pagos` viva.** No es una planificación
  pendiente — el código corre.
  - **Verify**: `test -d openspec/changes/archive/US-010-orden-webhook-stock-backend && grep -qx "archived: true" openspec/changes/archive/US-010-orden-webhook-stock-backend/proposal.md`
- [x] **Entorno de QA arriba**, con la API real + Postgres real (`qa/scripts/api-up.sh`).
  - **Verify**: `curl -sS -m 10 -o /dev/null -w "%{http_code}" "${QA_API_BASE_URL:-http://localhost:3009}/v1/checkout/simulate-payment" -X POST -H "content-type: application/json" -d '{"order_token":"0000000000000000000000000000000000000000000000000000000000000000"}' | grep -qE '^(404|422)$'` (404 = flag apagado o token no existe / 422 = formato — cualquiera de los dos confirma que la ruta existe y responde)
- [x] **`MP_WEBHOOK_SECRET` y `PAYMENTS_SIMULATED_ENABLED=true` están seteados en el
  entorno de QA** (sin esto, T1.1/T1.3/T1.4/T3.1/T4.1 no tienen nada que ejercitar).
  - **Verify**: `curl -sS -m 10 -o /dev/null -w "%{http_code}" "${QA_API_BASE_URL:-http://localhost:3009}/v1/checkout/simulate-payment" -X POST -H "content-type: application/json" -d '{"order_token":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}' | grep -qx 404` (con el flag apagado por accidente, este mismo 404 no distinguiría — si el resto de la suite falla en T1.1 con "flag apagado" hay que revisar `qa/scripts/api-up.sh`)

---

## Fase 0: Soporte del harness — firma HMAC y backdate de antigüedad

- [x] T0.1 `qa/support/mercadopago-signature.ts` + `qa/support/mercadopago-signature.smoke.ts`
  — construir headers `x-signature`/`x-request-id` válidos o deliberadamente inválidos.
  - **Pattern**: réplica pura del algoritmo de `apps/api/src/payments/mercadopago/
    webhook-signature.ts` (HMAC-SHA256 sobre `id:{dataId};request-id:{requestId};ts:{ts};`)
    — **sin importar código de `apps/api/`** (el harness de QA no depende del árbol de
    fuente del backend), per `design.md` §D-QA4. El `.smoke.ts` sigue la convención ya
    establecida en `qa/support/` (`admin-auth.smoke.ts`, `cart-client.smoke.ts`) — script
    `tsx` standalone que se auto-verifica sin necesitar la API arriba.
  - **Exit criterion**: expone `firmaValida(secret, dataId, requestId, ts)`,
    `firmaConSecretoEquivocado(...)`, `headerMalformado()`, `firmaFueraDeVentana(...)`;
    `firmaValida` y `firmaConSecretoEquivocado` producen un `v1` **distinto** para los
    mismos `dataId`/`requestId`/`ts`; `headerMalformado()` no matchea el formato
    `ts=...,v1=...`.
  - **Verify**: `pnpm --filter @dsm/qa exec tsx support/mercadopago-signature.smoke.ts` (exit 0; el smoke falla si `firmaValida === firmaConSecretoEquivocado` o si `headerMalformado()` accidentalmente matchea el formato válido)

- [x] T0.2 `qa/support/backdate-order.ts` + `qa/support/backdate-order.smoke.ts` —
  backdatear `created_at` de una orden vía `@dsm/db` (Prisma), excepción angosta y
  documentada.
  - **Pattern**: `prisma.order.update({ where: { id }, data: { created_at } })` —
    **sólo** para alcanzar la precondición de antigüedad; nunca para sembrar el resto de
    la suite ni para simular el efecto que el escenario prueba (mismo criterio que
    `SC-023-A2` de `US-023-pago-manual-offline-backend/qa-plan.md` §4), per `design.md`
    §D-QA5. Mismo estilo `.smoke.ts` que T0.1.
  - **Exit criterion**: `backdateOrder(orderId, horasAtras)` deja `created_at` en
    `now() - horasAtras` horas (±5s de margen), y no toca ninguna otra columna de la
    fila (verificado leyendo la orden completa antes/después del backdate).
  - **Verify**: `DATABASE_URL="${DATABASE_URL:-postgresql://dsm:dsm@localhost:55433/dsm?schema=public}" pnpm --filter @dsm/qa exec tsx support/backdate-order.smoke.ts` (exit 0; siembra una orden real vía `seedPendingPaymentOrder`, la backdatea, y falla si `created_at` no cae dentro del margen o si cualquier otra columna cambió)

---

## Fase 1: Suite de aceptación (Cucumber-js + Playwright `APIRequestContext`)

- [x] T1.1 `qa/acceptance/features/pago-webhook.feature` + `qa/acceptance/steps/
  pago-webhook.steps.ts` — SC-010-H1, SC-010-H2 (happy path, AC-1, AC-2, AC-9).
  - **Pattern**: `Característica`/`Antecedentes`/`Escenario` en español, mismo estilo
    que `pago-manual.feature`; steps contra `APIRequestContext` (nunca `supertest`, per
    `design.md` §D-QA2). Cada escenario siembra su propia orden con
    `seedPendingPaymentOrder` (US-023, sin modificar).
  - **Exit criterion**: SC-010-H1 verde — `POST /v1/checkout/simulate-payment` sobre una
    orden `pending_payment` real responde 200, el stock del producto queda decrementado
    exactamente en la cantidad de la orden, y existe una fila `payments` con
    `status='approved'` para esa orden; SC-010-H2 verde — el aviso al comprador y el
    aviso al dueño se verifican sobre evidencia observable del proceso (log/evento sin
    PII), no sobre una bandeja de entrada real.
  - **Verify**: `pnpm --filter @dsm/qa test:acceptance -- --tags "@us-010 and @happy"`

- [x] T1.2 SC-010-C1, SC-010-C2 (concurrencia real, AC-5, AC-6, AC-8).
  - **Pattern**: `Promise.all` sobre llamadas HTTP reales a `simulate-payment` — nunca
    `sleep`/timing artificial para simular la carrera, per `flakiness-detection` señal 5.
  - **Exit criterion**: SC-010-C1 verde — de dos confirmaciones simultáneas sobre la
    misma orden, exactamente una responde 200 y la otra 409
    `dsm:payments/order-not-pending-payment`, y el stock decrementó una sola vez;
    SC-010-C2 verde — de N órdenes que comparten un producto con stock=1 confirmadas en
    paralelo, exactamente una gana y el stock termina en 0, nunca negativo.
  - **Verify**: `pnpm --filter @dsm/qa test:acceptance -- --tags "@us-010 and @corner and @critical-path"`

- [x] T1.3 SC-010-C3, SC-010-C4, SC-010-N6 (jobs admin — mecánica, AC-10, AC-11, AC-4
  durabilidad).
  - **Pattern**: usa `backdateOrder` (T0.2) para las precondiciones de antigüedad; los
    jobs corren de verdad (`POST /admin/orders/cleanup-abandoned`,
    `POST /admin/payments/reconcile`, `POST /admin/payments/retry-refunds`) con
    `AdminGuard` real vía `adminAuth()`.
  - **Exit criterion**: SC-010-C3 verde — una orden backdateada 49h queda `cancelled` y
    desaparece de `GET /admin/orders` (US-012); una de 47h permanece intacta; SC-010-C4
    verde — con cero órdenes elegibles para reconciliar, el resumen es
    `{scanned:0,confirmed:0,stillPending:0}` y ninguna fila cambia; SC-010-N6 verde — con
    cero pagos `refund_pending`, el resumen es `{attempted:0,succeeded:0,failed:0}`.
  - **Verify**: `pnpm --filter @dsm/qa test:acceptance -- --tags "@us-010 and @corner"` (cubre SC-010-C3/C4 de esta task; SC-010-N6 queda confirmado en la corrida agregada de T1.4)

- [x] T1.4 SC-010-N1, SC-010-N3, SC-010-N4, SC-010-N5 (negative space restante, AC-7,
  AC-4, AC-5, AC-9).
  - **Pattern**: SC-010-N1 usa `mercadopago-signature.ts` (T0.1) para las 3 variantes de
    firma inválida; ninguna llega a llamar a `MercadoPagoClient` (el chequeo de firma
    corre antes, per `design.md` §D-QA1 — por eso SC-010-N1 no está bloqueado pese a
    hablar del webhook literal).
  - **Exit criterion**: SC-010-N1 verde — las 3 variantes responden 401 y no producen
    ninguna escritura (orden sigue `pending_payment`, stock intacto — verificado
    consultando el estado antes/después); SC-010-N3 verde — con stock insuficiente,
    `simulate-payment` responde 409 `dsm:payments/auto-cancelled-insufficient-stock`, la
    orden queda `cancelled`, el pago `refunded` (reembolso no-op del proveedor
    simulado), y el stock del producto no bajó; SC-010-N4 verde — repetir la
    confirmación de una orden ya `new` responde 409
    `dsm:payments/order-not-pending-payment` sin segundo decremento ni segundo pago;
    SC-010-N5 verde — flag apagado y token inexistente responden ambos 404 sin tocar
    la base.
  - **Verify**: `pnpm --filter @dsm/qa test:acceptance -- --tags "@us-010 and not @blocked"` (13/13 escenarios de T1.1-T1.4 verdes en una sola corrida)

- [x] T1.5 SC-010-N2 — declarar el bloqueo, no simularlo.
  - **Exit criterion**: `pago-webhook.feature` contiene el escenario `SC-010-N2` tageado
    `@blocked` con el comentario que explica por qué (necesita que MercadoPago responda
    `rejected` de verdad); **no** se escribe ningún step que lo implemente con un doble
    no autorizado por `design.md` §D-QA1.
  - **Verify**: `grep -q "@negative @blocked" qa/acceptance/features/pago-webhook.feature && grep -q "SC-010-N2" qa/acceptance/features/pago-webhook.feature && pnpm --filter @dsm/qa test:acceptance -- --tags "@us-010 and not @blocked" 2>&1 | grep -qv "SC-010-N2"` (con el tag de exclusión, `SC-010-N2` no debe aparecer en la salida de la corrida — ni como pasado ni como fallido, sólo ausente)

---

## Fase 2: Contract testing

- [ ] T2.1 `qa/contract/pago-webhook.contract.ts` — QA-010-CT-1.
  - **Pattern**: script `tsx` standalone con `fetch`, mismo estilo que
    `pago-manual.contract.ts` (sin jest, sin `supertest`), per `design.md` §D-QA6.
    Registrar `test:contract:pago-webhook` en `qa/package.json`, sin tocar
    `test:contract`/`test:contract:pago-manual` existentes.
  - **Exit criterion**: valida forma de respuesta + catálogo RFC 7807 de los 5
    endpoints contra `openspec/specs/pagos/contracts/openapi.yaml` (raíz viva) — ver
    `qa-plan.md` §6 para el detalle completo de casos.
  - **Verify**: `QA_API_BASE_URL=http://localhost:3009 ADMIN_BOOTSTRAP_TOKEN=<mismo valor de la API> pnpm --filter @dsm/qa test:contract:pago-webhook`

---

## Fase 3: Performance (k6)

- [ ] T3.1 `qa/performance/simulate-payment.js` — QA-010-PERF-1.
  - **Pattern**: `setup()` pre-siembra N órdenes reales vía checkout (mismo contrato que
    `seedPendingPaymentOrder`), executor `shared-iterations` con `iterations: POOL`
    (nunca `vus`+`duration` abierto sobre un recurso finito — mismo hallazgo ya resuelto
    por `confirm-payment.js`/`auth-login.js`), `thresholds` con percentil —
    `per k6-load-scaffolding` + `performance-standards.md §7`.
  - **Exit criterion**: `http_req_duration{endpoint:simulate_payment}` con threshold
    `p(95)<200` (heredado de `design.md` de backend §D12, no inventado), `checks:
    ['rate>0.99']`, `http_req_failed` bajo el umbral estándar del repo.
  - **Verify**: `QA_API_BASE_URL=http://localhost:3009 k6 run qa/performance/simulate-payment.js --summary-trend-stats="p(95)"`

- [ ] T3.2 `qa/performance/lib/thresholds.js` — QA-010-PERF-2.
  - **Exit criterion**: exporta `simulate_payment` con
    `'http_req_duration{endpoint:simulate_payment}': ['p(95)<200']`.
  - **Verify**: `grep -q "simulate_payment" qa/performance/lib/thresholds.js && grep -q "p(95)<200" qa/performance/lib/thresholds.js`

---

## Fase 4: E2E cross-stack

- [ ] T4.1 `qa/e2e/pago-webhook-cross-stack.spec.ts` — SC-010-X1.
  - **Pattern**: selectores por rol/nombre accesible en el tramo de checkout (nunca
    CSS/índices), `page.waitForResponse('**/v1/checkout')` para extraer `order_token` de
    la respuesta de red (no se renderiza en el DOM), `APIRequestContext` para la llamada
    a `simulate-payment` (no hay botón FE) — per `playwright-stability §Selectors` +
    `design.md` §D-QA8.
  - **Exit criterion**: tras completar el checkout por UI y confirmar por
    `simulate-payment`, `/admin/ordenes` muestra la orden como "nueva" y el catálogo del
    dueño refleja el stock decrementado.
  - **Verify**: `pnpm --filter @dsm/qa test:e2e -- --grep "SC-010-X1" --reporter=line 2>&1 | grep -qE '^ *1 passed'`

- [ ] T4.2 mismo archivo — SC-010-X2.
  - **Exit criterion**: una orden auto-cancelada por falta de stock (mismo fixture que
    SC-010-N3, sembrado vía API para no repetir el tramo de checkout por UI) nunca
    aparece en `/admin/ordenes`.
  - **Verify**: `pnpm --filter @dsm/qa test:e2e -- --grep "SC-010-X2" --reporter=line 2>&1 | grep -qE '^ *1 passed'`

---

## Fase 5: Exploratorio y cierre

- [ ] T5.1 Charter `qa/exploratory/us-010-pagos-webhook.md` — QA-010-EXP-1 (manual).
  - **Exit criterion**: documenta los 3 charters de `qa-plan.md` §10 con su tiempo
    asignado, el riesgo que exploran y dónde se registran los hallazgos. Queda como
    checklist humano; `/develop-qa` no lo scaffoldea.
  - **Verify**: `test -f qa/exploratory/us-010-pagos-webhook.md && grep -c "^## Charter" qa/exploratory/us-010-pagos-webhook.md | grep -qx 3`

- [ ] T5.2 Trazabilidad AC → escenario, sin huecos.
  - **Exit criterion**: los 11 AC de US-010 aparecen en la matriz de `qa-plan.md` §3 con
    al menos un escenario (ejecutable o `blocked` explícito); cada `SC-`/`QA-` de la
    matriz existe como escenario Gherkin, contract test, script k6, spec Playwright o
    charter.
  - **Verify**: `python3 -c "
import re,sys,pathlib
plan=pathlib.Path('openspec/changes/US-010-orden-webhook-stock-qa/qa-plan.md').read_text()
acs=set(re.findall(r'AC-(\d+)', pathlib.Path('docs/user-stories/US-010-orden-webhook-stock.md').read_text()))
faltan=[a for a in acs if f'AC-{a} ' not in plan and f'AC-{a},' not in plan and f'AC-{a})' not in plan and f'AC-{a}\`' not in plan]
scs=set(re.findall(r'SC-010-[A-Z]\d', plan))
sys.exit(0 if not faltan and len(scs)>=13 else 1)"`

---

## Verification (suite-level)

- [ ] Suite de aceptación completa verde (excepto lo bloqueado):
  `pnpm --filter @dsm/qa test:acceptance -- --tags "@us-010 and not @blocked"`
- [ ] Contract test verde: `pnpm --filter @dsm/qa test:contract:pago-webhook`
- [ ] Carga dentro del presupuesto: `k6 run qa/performance/simulate-payment.js`
- [ ] E2E cross-stack verde: `pnpm --filter @dsm/qa test:e2e -- --grep "SC-010-X1|SC-010-X2" --reporter=line`
- [ ] **Sin regresión en las suites QA ya existentes** (`pago-manual`, `ordenes`,
  `carrito`, `cuenta`): `pnpm --filter @dsm/qa test:acceptance -- --tags "@pagos"` (incluye
  `@us-010` y el `@us-023` de `pago-manual.feature`, ambos deben seguir verdes juntos)
- [ ] El charter manual ejecutado y sus hallazgos registrados (humano)

## Trazabilidad AC → escenario

| AC de US-010 | Escenarios QA-owned | Estado |
|---|---|---|
| AC-1 pago aprobado confirma y decrementa | SC-010-H1, SC-010-X1 | ejecutable |
| AC-2 dispara notificaciones | SC-010-H2 | ejecutable |
| AC-3 rechazado no confirma ni toca stock | SC-010-N2 | **bloqueado** |
| AC-4 aprobado sin stock → reembolso | SC-010-N3, SC-010-N6, SC-010-X2 | ejecutable (mecánica); reintento real bloqueado |
| AC-5 duplicado no decrementa dos veces | SC-010-C1, SC-010-N4 | ejecutable |
| AC-6 tardío o fuera de orden | SC-010-C1 | ejecutable |
| AC-7 webhook no verificado se rechaza | SC-010-N1 | ejecutable |
| AC-8 stock nunca negativo | SC-010-C2 | ejecutable |
| AC-9 medio simulado, mismo camino | SC-010-H1, SC-010-N5, SC-010-X1 | ejecutable |
| AC-10 reconciliación de webhook faltante | SC-010-C4 | ejecutable (mecánica); recuperación real bloqueada |
| AC-11 limpieza de abandonadas | SC-010-C3 | ejecutable |
