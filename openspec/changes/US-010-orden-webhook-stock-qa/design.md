---
parent-us: US-010
discipline: qa
language: es
---

# US-010 QA — Design

## Context

Este plan diseña la arquitectura de test para la superficie **automática** de la
capacidad `pagos` (webhook de MercadoPago, medio simulado «DSM», tres jobs admin) que
`US-010-orden-webhook-stock-backend` construyó y archivó el 2026-09-05. El riesgo real de
este plan no es dejar un AC sin probar — es (a) duplicar lo que la suite dev-owned de
`tasks.md` Fase 14 ya prueba con Postgres real, y (b) escribir escenarios que prometen
ejercitar MercadoPago de verdad cuando el entorno no tiene esa cuenta. §D-QA1 resuelve
(b) explícitamente; el resto de las decisiones resuelve (a).

## Goals

- Construir la suite de aceptación **persistente** (BDD, black-box) que le falta a esta
  capacidad — el contrato de comportamiento que sobrevive a la entrega, distinto de los
  specs de Jest efímeros de `tasks.md`.
- Dejar explícito, escenario por escenario, cuál corre **hoy** contra la API real y cuál
  queda **bloqueado** por falta de cuenta sandbox de MercadoPago — nunca maquillar un
  bloqueo con un doble no autorizado por el propio diseño del backend.
- Cubrir con contract testing los 5 endpoints nuevos contra el OpenAPI vivo de `pagos`.
- Cargar `POST /v1/checkout/simulate-payment` (el único endpoint de escritura de esta US
  alcanzable sin MercadoPago) contra el presupuesto propuesto en `design.md` de backend
  §D12.
- Un escenario E2E cross-stack que cierre el loop completo: comprador paga (simulado) →
  el dueño ve la orden nueva con stock decrementado en su panel.

## Non-goals

- Reescribir o repetir los 5 specs de integración de `tasks.md` Fase 14
  (`e2e-payments-mercadopago-happy/-insufficient-stock-auto/-webhook-duplicate/-concurrency/-simulated-parity`)
  — son dev-owned, ya están, y corren contra Postgres real igual que esta suite lo haría.
- Tocar `apps/api/src/` — ninguna task de este plan modifica código de aplicación, ni
  siquiera para hacer `MercadoPagoClient.baseUrl` configurable (ver §D-QA1, recomendación
  para un change de backend futuro, no para este).
- Accesibilidad o regresión visual — esta US no tiene UI propia; las dos pantallas que
  el escenario cross-stack toca (checkout, panel del dueño) tienen su propia cobertura
  a11y en las QA de US-008/US-012.

## Approach

### D-QA1 — Qué se puede probar black-box sin cuenta de MercadoPago, y qué no

Es la decisión que gobierna todo el resto del plan. `MercadoPagoClient` (`apps/api/src/
payments/mercadopago/mercadopago-client.ts`) recibe `baseUrl` como parámetro de
constructor con default `MP_BASE_URL = 'https://api.mercadopago.com'` — pero
`payments.module.ts` lo registra con una **factory que sólo inyecta `ConfigService`**
(`useFactory: (config) => new MercadoPagoClient(config)`, ver `tasks.md` T5.1-T5.6 del
backend). Es decir: **el proceso real de la API, corriendo como lo levanta
`qa/scripts/api-up.sh`, siempre apunta a la MercadoPago real** — no hay ninguna variable
de entorno que un test QA pueda setear para redirigirlo a un doble local, y este plan no
va a agregar una (tocaría `apps/api/src/`, fuera de alcance).

Consecuencia, verificada leyendo el código real de cada endpoint:

| Superficie | Necesita que MercadoPago responda | Alcanzable hoy (black-box) |
|---|---|---|
| `POST /v1/webhooks/mercadopago` — verificación de firma (AC-7) | No — el chequeo HMAC corre **antes** de cualquier llamada a `getPayment` (`mercadopago-webhook.controller.ts`, T6.1) | ✅ Sí |
| `POST /v1/webhooks/mercadopago` — confirmar/rechazar/duplicado según el pago (AC-1, AC-3, AC-5, AC-6) | Sí — necesita que `getPayment` devuelva `approved`/`rejected` reales | ❌ No, salvo sustitución estructural (ver abajo) |
| `POST /v1/checkout/simulate-payment` (AC-1, AC-2, AC-4, AC-5, AC-9) | **No, nunca** — su única razón de ser es saltar MercadoPago (`design.md` de backend §D7) | ✅ Sí, ejercita el **mismo** `ConfirmOrderService.confirm()` |
| `POST /admin/orders/cleanup-abandoned` (AC-11) | No — `updateMany` puro sobre `created_at`, sin llamada externa | ✅ Sí |
| `POST /admin/payments/reconcile` (AC-10) | Sí, para la recuperación real — `searchByExternalReference` contra MercadoPago | ⚠️ Mecánica (auth, resumen con 0 elegibles) sí; recuperación real, no |
| `POST /admin/payments/retry-refunds` (AC-4, durabilidad) | Sí, para el reintento real — `refund` contra MercadoPago | ⚠️ Mecánica (auth, resumen con 0 elegibles) sí; reintento real, no |

**La sustitución estructural no es un workaround — es el diseño**: AC-9 exige,
literalmente, que "el medio simulado siga el mismo flujo de confirmación, decremento
atómico e idempotencia que un pago real", y el propio dev ya lo probó a nivel Jest
(`e2e-payments-simulated-parity.spec.ts`, comparando ambos caminos byte a byte salvo
`provider`/`external_id`). Este plan reusa esa misma garantía para validar, vía
`POST /v1/checkout/simulate-payment`, el comportamiento de `ConfirmOrderService.confirm()`
que AC-1/AC-2/AC-4/AC-5/AC-6/AC-8 describen — sin necesitar que el webhook literal
reciba nada de MercadoPago. Lo que SÍ es exclusivo del webhook y no tiene equivalente en
el medio simulado es la verificación de firma (AC-7, probada directo) y el `status`
`rejected` (AC-3, que el medio simulado nunca produce — **queda `blocked`**).

**Recomendación registrada, no ejecutada por este plan**: el PRD §2.1 (fila "Pagos") dice
que MercadoPago "soporta el modo sandbox/test... para pruebas" — cuando esa cuenta
exista, AC-3, la recuperación real de AC-10 y el reintento real de AC-4 dejan de estar
`blocked` sin rediseñar ningún escenario (el Gherkin ya está escrito). Alternativa más
barata si la cuenta sandbox tarda: un cambio de backend chico y aditivo que lea
`MP_BASE_URL` de env en la factory de `payments.module.ts` (mismo patrón que ya usa el
parámetro de constructor, sólo falta cablearlo) para apuntar a un stub HTTP local
—decisión de quien planifique ese change, no de este plan.

### D-QA2 — Suite de aceptación: Cucumber-js + Playwright `APIRequestContext`, no supertest

Mismo hallazgo que ya registró `US-023-pago-manual-offline-backend/qa-plan.md` al
ejecutarse: la convención **real** de `qa/acceptance/` (`world.ts`,
`carrito.steps.ts`, `pago-manual.steps.ts`) es Cucumber-js + Playwright
`APIRequestContext` — nunca `supertest`, que es exclusivamente dev-owned dentro de
`apps/api/**/*.spec.ts`. Este plan escribe ese patrón desde el inicio (no lo "descubre"
en ejecución): `qa/acceptance/features/pago-webhook.feature` +
`qa/acceptance/steps/pago-webhook.steps.ts`, reusando `qa/support/api.ts` y
`qa/support/admin-auth.ts`.

### D-QA3 — Reuso del seed de US-023, sin modificarlo

`qa/support/seed-pending-payment-order.ts` ya existe (construido para
`US-023-pago-manual-offline-backend`, código real en el harness aunque esa capacidad no
tiene un change QA hermano propio): drives el checkout real (nunca INSERT directo),
resuelve el `id` interno vía `GET /v1/admin/orders/pending-payment` (dogfooding de AC-2
de US-023). Es exactamente la orden `pending_payment` que este plan necesita como punto
de partida. **Se reusa tal cual, sin tocarlo** — la única pieza nueva que este plan
agrega es la llamada a `simulate-payment`/al webhook por encima de esa orden sembrada,
en los steps/specs propios de este change.

### D-QA4 — Firma HMAC del webhook: helper puro, sin depender del backend

Para probar AC-7 (firma inválida) hace falta poder construir tanto una firma **inválida**
como el **formato correcto** del header (para probar que el *formato* correcto pero con
secreto equivocado también se rechaza). `webhook-signature.ts` del backend (T4.1)
documenta el algoritmo exacto: HMAC-SHA256 sobre
`id:{data.id};request-id:{x-request-id};ts:{ts};` con `MP_WEBHOOK_SECRET`, comparación en
tiempo constante. Se agrega `qa/support/mercadopago-signature.ts`, un helper **puro** que
replica ese cálculo (no importa código de `apps/api/`, evita acoplar el harness de QA al
árbol de fuente del backend) para construir:

- una firma **válida en formato pero con secreto incorrecto** (`v1` recalculado con un
  secreto distinto al `MP_WEBHOOK_SECRET` real del entorno de test),
- un header **malformado** (sin `ts=`/`v1=`),
- un `ts` **fuera de la ventana de tolerancia** (300s) con una firma por lo demás válida
  para ese `ts`.

Ninguno de los tres necesita que `MP_WEBHOOK_SECRET` real sea secreto para el propio
test — es la misma variable que `qa/scripts/api-up.sh` ya exporta para levantar la API
(un valor de test fijo, nunca el de producción).

### D-QA5 — Backdate de `created_at` vía `@dsm/db`: excepción angosta, con precedente

`ORDER_ABANDON_HOURS` (48h, AC-11) y `RECONCILE_MIN_AGE_MS` (5 min, AC-10) necesitan una
orden `pending_payment` más vieja que el corte. Esperar 48h en un test es absurdo;
esperar 5 min para el segundo es lento y no escala si la suite corre en CI seguido.
Mismo criterio que `US-023-pago-manual-offline-backend/qa-plan.md` §4 ya documentó y
ejecutó para su propio caso (transicionar una orden a `cancelled` sin que exista todavía
un endpoint que lo haga, vía `prisma.order.update`): se agrega
`qa/support/backdate-order.ts`, que hace **exclusivamente** `prisma.order.update({
where: { id }, data: { created_at } })` — nunca para sembrar el resto de la suite, nunca
para simular el efecto que el escenario debe probar (el `updateMany` de
`cleanupAbandoned`/la consulta de `reconcile` siguen corriendo de verdad contra esa
fila).

### D-QA6 — Contract testing: script `tsx`, mismo patrón que `pago-manual.contract.ts`

`qa/contract/pago-manual.contract.ts` (US-023) ya estableció la convención real de este
repo: no hay un runner jest-style para contract tests, es un script `tsx` standalone con
`fetch` contra el servidor real, registrado como su propio script de `qa/package.json`.
`qa/contract/pago-webhook.contract.ts` sigue ese mismo patrón para los 5 endpoints de
esta US, validando forma de respuesta (`additionalProperties`-equivalente manual, mismo
estilo) y catálogo de errores RFC 7807 contra `openspec/specs/pagos/contracts/openapi.yaml`
(el contrato **vivo**, no el draft del change ya archivado).

### D-QA7 — Performance: sólo `simulate-payment`, mismo criterio que `confirm-payment.js`

`qa/performance/confirm-payment.js` (US-023) ya resolvió, ejecutando, dos problemas que
este script hereda sin repetir la investigación: (1) `SharedArray` no sirve para datos
creados en `setup()` (necesita un archivo estático) — se usa el valor de retorno de
`setup()` en su lugar; (2) un recurso finito pre-sembrado (N órdenes) es incompatible con
`vus`+`duration` abiertos — executor `shared-iterations` con `iterations: POOL`. El
`design.md` de backend §D12 propone el presupuesto **`p95 < 200ms`** para
`simulate-payment` (sin llamada externa) — se hereda ese número, no se inventa uno
nuevo. No se planifica `baseline`/`stress`/`soak` (per `k6-load-scaffolding` "cuándo NO
usar"): es un solo endpoint de escritura con presupuesto propio, mismo criterio que
`QA-023-PERF-1` ya aplicó para `confirm-payment`.

No hay un `QA-010-PERF` para el webhook literal ni para los jobs admin — el primero
necesita MercadoPago (§D-QA1), y los segundos son superficie admin de bajo volumen, un
solo operador (mismo criterio ya aplicado por `QA-023-*` — "no se planifica
baseline/stress/soak... la superficie es admin").

### D-QA8 — E2E cross-stack: checkout vía UI, confirmación vía API, verificación vía UI

No existe ningún botón de "pagar con medio simulado" en `apps/web` (verificado:
`grep -rn "simulate-payment" apps/web/src` no devuelve nada — el endpoint es superficie
de test/demo, sin consumidor FE, `design.md` de backend lo dice explícito). El escenario
cross-stack (X1/X2) por lo tanto:

1. Dirige el checkout real por la UI (`CheckoutForm`, mismos builders/fixtures que
   `carrito.spec.ts`) hasta el submit.
2. Intercepta la respuesta de `POST /v1/checkout` con `page.waitForResponse(...)` para
   extraer `order_token` — el componente lo guarda en estado de React pero **no lo
   renderiza** (verificado en `CheckoutPage.tsx`; es correcto que no lo haga, es un
   secreto de un solo uso). Extraerlo de la respuesta de red, no del DOM, es la única vía
   legítima sin tocar el código de la app.
3. Llama a `simulate-payment` vía `APIRequestContext` (no hay botón que lo dispare).
4. Navega a `/admin/ordenes` (panel del dueño, ya cubierto por `US-012-panel-ordenes-dueno-qa`
   para su propio alcance) y verifica el efecto observable: la orden aparece "nueva" con
   el stock reflejando el decremento.

## Trade-offs

**Sustituir el webhook literal por `simulate-payment` para AC-1/2/4/5/6/8/9, en vez de
escribir esos escenarios como `blocked` también.** Se acepta porque AC-9 hace esta
sustitución **estructuralmente válida** (no es un doble no autorizado, es la misma
función de negocio con otro nombre de proveedor) — la alternativa (dejar 6 de 11 AC sin
ningún escenario ejecutable) sería peor cobertura por una pureza de "sólo el endpoint
literal" que el propio diseño del backend no exige.

**No agregar un stub HTTP local de MercadoPago en este plan.** Sería la vía más rápida
para desbloquear AC-3/AC-10/AC-4-real, pero requeriría tocar `payments.module.ts` para
hacer `baseUrl` configurable por env — fuera del alcance de un change QA-only. Se
documenta como recomendación para quien retome, no se ejecuta acá.

**Backdatear `created_at` vía Prisma en vez de esperar tiempo real.** Mismo trade-off ya
aceptado por `US-023` — la excepción es angosta (sólo la precondición, nunca la
aserción) y tiene precedente documentado.

## Open questions

Las tres viven en `proposal.md` §Preguntas abiertas con su default. Ninguna bloquea la
ejecución de lo que SÍ es alcanzable hoy.

## References

- `qa-plan.md` de este change (matriz AC×capa, escenarios Gherkin completos, stubs)
- Backend archivado: [`US-010-orden-webhook-stock-backend`](../archive/US-010-orden-webhook-stock-backend/design.md)
  §D2 (secuencia + compensación), §D3 (idempotencia por guard), §D6 (qué necesita
  cuenta real), §D7 (medio simulado), §D8 (jobs admin sin scheduler)
- Precedente directo, misma capacidad: [`US-023-pago-manual-offline-backend/qa-plan.md`](../archive/US-023-pago-manual-offline-backend/qa-plan.md)
  (D-QA2, D-QA3, D-QA5, D-QA6, D-QA7 heredan decisiones ya ejecutadas ahí)
- Precedente de formato de change hermano: [`US-014-registro-login-qa/design.md`](../US-014-registro-login-qa/design.md)
- Skills: `qa-three-layer-regression` (Layer 1 persistente vs Jest efímero),
  `bdd-scenario-quality`, `k6-load-scaffolding` (SharedArray/executor,
  thresholds NFR-atados), `threat-modeling-lite` (STRIDE del webhook ya cerrado por el
  backend, §D11 de su design; este plan lo verifica, no lo reabre), `openspec-workflow`
- Standards: `qa-backend-standards.md` §2.1/§13/§15/§21 · `testing-standards.md`
  §2/§4.1/§5/§8/§14/§14.9/§18 · `api-standards.md` §3/§8 · `performance-standards.md` §7
