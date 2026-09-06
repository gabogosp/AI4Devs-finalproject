---
parent-us: US-015
discipline: qa
language: es
---

# US-015 QA — Design

## Context

Este plan diseña la arquitectura de test para las dos superficies que
`US-015-historial-compras-backend` cerró (mergeado, PR #70/#71): el lector
(`GET /v1/me/orders`, `GET /v1/me/orders/{order_number}`) y el escritor
(`orders.customer_id` seteado en el checkout vía `OptionalCustomerGuard`). El
riesgo real de este plan no es dejar un AC sin probar — los 7 AC de la US tienen
superficie 100% ejecutable hoy, sin ningún bloqueo externo (a diferencia de
`US-010-orden-webhook-stock-qa`, que necesitaba una cuenta sandbox de
MercadoPago) — sino (a) duplicar lo que la suite dev-owned ya prueba con Postgres
real, y (b) inventar un Layer 3 cross-stack sobre una UI que no existe todavía.
§D-QA2 resuelve (b) explícitamente; el resto de las decisiones resuelve (a).

## Goals

- Construir la suite de aceptación **persistente** (BDD, black-box) que le falta a
  esta capacidad — el contrato de comportamiento que sobrevive a la entrega,
  distinto de los specs de Jest efímeros de `tasks.md`.
- Cubrir los 7 AC de la US con al menos un escenario ejecutable cada uno, más las
  3 reglas de negocio adyacentes que el propio `design.md` de backend documenta
  como decisiones deliberadas (exclusión de `pending_payment`, retención en el
  borde, comportamiento con órdenes anonimizadas).
- Cubrir con contract testing los 2 endpoints nuevos contra el contrato
  **publicado** (no hay contrato "vivo" en `openspec/specs/` todavía — el backend
  no se archivó).
- Cargar `GET /v1/me/orders` contra el único NFR cuantificado de la US (§9,
  p95 < 300ms).
- Dejar explícito, en `proposal.md`, que el E2E cross-stack (Layer 3) queda
  diferido a que exista una UI — no inventar un escenario Playwright contra una
  página que no existe.

## Non-goals

- Reescribir o repetir los specs de integración de `tasks.md`
  (`orders.repository.spec.ts`, `orders-history.service.spec.ts`,
  `orders-history.controller.spec.ts`, `e2e-orders-history-{list,detail}.spec.ts`,
  `e2e-checkout-customer-link.spec.ts`) — son dev-owned, ya están, y corren
  contra Postgres real igual que esta suite lo haría.
- Tocar `apps/api/src/` — ninguna task de este plan modifica código de
  aplicación.
- Resolver la open question del backend sobre excluir órdenes anonimizadas del
  historial — este plan **verifica el default ya implementado** (se muestran),
  no decide si ese default debe cambiar.
- Accesibilidad o regresión visual — no hay UI de esta US construida todavía.

## Approach

### D-QA1 — Contract testing contra el contrato PUBLICADO, no el "vivo"

`US-015-historial-compras-backend` está mergeado pero **no archivado** — no
existe `openspec/specs/historial-compras/contracts/openapi.yaml` todavía (ese
directorio lo crea el primer `/archive-change` de ese change, per su propio
`design.md` §Spec delta). Lo que SÍ existe, real y versionado, es
`apps/api/docs/api/openapi.yaml` — el contrato **publicado** que
`fix/US-015-publish-order-history-contract` (PR #71) fusionó al `openapi.yaml`
único que lee `orval` (codegen del FE) — confirmado: `grep -n "me/orders"
apps/api/docs/api/openapi.yaml` devuelve las dos rutas con sus componentes
(`OrderHistoryListResponse`, `OrderHistoryDetail`, `sessionCookie`).

Este plan valida contra **ese** archivo, no contra el draft del change de
backend (`openspec/changes/US-015-historial-compras-backend/contracts/openapi/
*.yaml`, que es staging de ese change y no la fuente que consume nadie en
runtime) ni contra un contrato vivo que todavía no existe. Cuando el backend se
archive, el contract test de este change se re-apunta a
`openspec/specs/historial-compras/contracts/openapi.yaml` — cambio de una sola
constante (`CONTRACT_PATH`) en `qa/contract/order-history.contract.ts`, no un
rediseño. Se deja anotado en el propio script (comentario), no como tarea de
este plan (no bloquea: el contrato publicado es una fuente válida y real hoy).

### D-QA2 — Layer 3 (E2E cross-stack) no se inventa sin UI

Precedente que este plan **no** repite: `US-010-orden-webhook-stock-qa` construyó
su escenario cross-stack (`SC-010-X1`) porque el checkout y el panel del dueño
YA estaban construidos por otras disciplinas al momento de planificar. Acá,
`US-015-historial-compras-frontend-web` está **en curso, en otro worktree, sin
cerrar** — no hay ninguna página `/cuenta/pedidos` (o el namespace que el PO
decida) que un Playwright pueda visitar. Escribir un escenario "el cliente abre
su historial en el navegador" contra una ruta que no existe sería el mismo
anti-pattern que `US-010-*-qa` evitó explícitamente para `SC-010-N2` (declarar
bloqueado en vez de simular con un doble no autorizado) — sólo que acá el
bloqueo es de **UI inexistente**, no de credencial externa. Se declara
`Deferred` en `proposal.md`, con el mismo criterio: nunca maquillar la ausencia,
nunca escribir un escenario que miente sobre qué verificó.

Lo que SÍ es Layer 1 (backend-aislado) y cubre el escritor+lector juntos sin
necesitar ninguna UI: el propio `qa/support/seed-order-history.ts` (§D-QA3)
ejercita el checkout real con sesión de cliente real — es el mismo camino que
recorrería un navegador, sólo que disparado por `APIRequestContext` en vez de
por clics. Es la sustitución estructural correcta (mismo criterio que
`US-010-*-qa` §D-QA1 aplicó al medio simulado): valida el comportamiento de
punta a punta del backend sin necesitar la UI que todavía no existe.

### D-QA3 — `qa/support/seed-order-history.ts`: el helper que le falta al harness

El harness (`qa/support/`) ya tiene `customer-auth.ts` (sesión de cliente real,
US-014) y `cart-client.ts` (`Invitado`, un wrapper genérico de
`APIRequestContext` con `fijar()`/`checkout()` — no exige que el contexto sea de
un invitado sin sesión). Ningún helper existente compone ambos para producir
"un cliente CON sesión que compra y confirma el pago" — es exactamente lo que
`CheckoutController.create` ahora soporta (`OptionalCustomerGuard`) y que AC-1
necesita como precondición para ser verificable en absoluto (sin una orden con
`customer_id` seteado, el historial siempre lista cero filas — el mismo
razonamiento que `US-015-historial-compras-backend/proposal.md` usa para
justificar por qué el escritor tenía que construirse primero).

```ts
// qa/support/seed-order-history.ts
import { nuevaCuenta, type Sesion } from './customer-auth';
import { Invitado } from './cart-client';
import { buildCheckoutBody } from './builders';
import { QA_API_BASE_URL } from './qa-env';

export interface CompraLogueada {
  sesion: Sesion;
  orderNumber: number;
  orderToken: string;
}

/** Cliente con sesión que compra un producto y CONFIRMA el pago (medio simulado).
 *  AC-1 sólo cuenta compras hechas logueado — sin este helper, el historial de
 *  cualquier escenario listaría siempre cero filas. */
export async function compraLogueada(
  slug: string,
  sufijoCuenta = '',
): Promise<CompraLogueada> { /* nuevaCuenta → Invitado(ctx).fijar/checkout → simulate-payment */ }

/** Misma compra, SIN confirmar — la orden queda `pending_payment` (AC-1 la excluye). */
export async function compraLogueadaPendiente(
  slug: string,
  sufijoCuenta = '',
): Promise<CompraLogueada> { /* igual, sin el paso de simulate-payment */ }
```

**Por qué reusar `Invitado` para un cliente CON sesión, en vez de escribir una
clase nueva**: `Invitado` (pese al nombre — heredado de cuando sólo existía el
camino guest) es un wrapper genérico de `APIRequestContext`; no verifica en
ningún lado que el contexto carezca de sesión. El `ctx` que produce
`nuevaCuenta()` (US-014) ya trae la cookie `dsm_access` puesta; envolverlo en
`new Invitado(ctx)` y llamar `fijar()`/`checkout()` sobre él ejercita
exactamente el camino que `OptionalCustomerGuard` intercepta: el mismo request
HTTP, con la cookie de cliente puesta, así que el checkout ve `req.customerId`
resuelto. Escribir una clase `ClienteConSesion` paralela duplicaría toda la
lógica de CSRF/carrito que `Invitado` ya tiene correcta y probada por las
suites de `carrito.feature`/`checkout.feature`.

**`simulate-payment` no necesita la cookie de sesión** (verificado en
`apps/api/src/checkout/checkout.controller.ts` — el endpoint toma sólo
`order_token` en el body, sin guard de cliente): se llama con `fetch` simple,
mismo patrón que `simularPagoAutomatico()` en `qa/support/seed-metricas.ts`
(reusado como referencia de forma, no importado — ese helper vive en el
namespace de `metricas`, no en el de `orders`/`checkout`).

### D-QA4 — Retención en el borde: reuso de `backdate-order.ts` sin modificarlo

`qa/support/backdate-order.ts` (US-010) ya existe: `prisma.order.update({ where:
{ id }, data: { created_at } })`, excepción angosta y documentada, sólo para
alcanzar la precondición de antigüedad. Este plan lo reusa tal cual para
`SC-015-C1` (retención en el borde) — necesita una orden con `created_at`
exactamente en el corte de 12 meses y otra 1ms antes, y esperar 12 meses en un
test es absurdo. El `id` interno que `backdateOrder` necesita se resuelve por
la ORM directamente (Prisma, vía `@dsm/db`), no por ningún endpoint — el
historial del cliente nunca expone el UUID interno (AC-1/AC-2, por diseño), así
que no hay otra vía.

### D-QA5 — Orden anonimizada: reuso del endpoint admin de US-021

`SC-015-C5` verifica el default que el backend documentó (`design.md`
Trade-offs: "no se excluyen del historial las órdenes anonimizadas a pedido").
Para producir la precondición se reusa `POST /v1/admin/orders/{id}/anonymize`
(US-021, ya construido y con su propio helper `dispararAnonimizacion()` en
`qa/acceptance/steps/retencion-ordenes.steps.ts`) — el `id` interno se resuelve
vía `GET /v1/admin/orders` (US-012, expone `id` en `AdminOrderSummaryDto`,
confirmado en `apps/api/src/orders/dto/order.dto.ts`). Se reusa `admin-auth.ts`
para el token; no se escribe ningún helper nuevo para esto, sólo se componen
los tres que ya existen (`compraLogueada`, `adminAuthWithSource`,
`dispararAnonimizacion` — este último se **importa** del step file de
`retencion-ordenes`, no se copia).

### D-QA6 — Suite de aceptación: Cucumber-js + Playwright `APIRequestContext`

Mismo hallazgo que `US-010-*-qa`/`US-023-*` ya registraron: la convención real
de `qa/acceptance/` es Cucumber-js + Playwright `APIRequestContext`, nunca
`supertest` (exclusivamente dev-owned dentro de `apps/api/**/*.spec.ts`). Este
plan escribe `qa/acceptance/features/historial-compras.feature` +
`qa/acceptance/steps/historial-compras.steps.ts` desde el inicio, reusando el
step ya registrado globalmente "Dado un catálogo sembrado con productos
disponibles" (`pago-manual.steps.ts`) — no se re-registra (mismo criterio que
`checkout.steps.ts`/`retencion-ordenes.steps.ts` ya documentan con su propio
comentario "NO se registra acá").

### D-QA7 — Performance: un solo endpoint, sin baseline/stress/soak

El único NFR cuantificado de la US (§9) es "Latencia p95 lectura < 300ms
(hereda PRD §4)" para el listado. Mismo criterio que `QA-010-PERF-1`/
`QA-023-PERF-1` ya aplicaron: no se planifica baseline/stress/soak (per
`k6-load-scaffolding` "cuándo NO usar") — es un solo endpoint de lectura con
presupuesto propio. El pre-seed (`seed-orders-history-load.ts`, Node/tsx, fuera
de k6 porque necesita Prisma/Playwright para producir cuentas con órdenes
reales — mismo patrón que `seed-orders-load.ts` de US-012) registra N cuentas,
cada una con 1 compra logueada confirmada (vía `compraLogueada`, §D-QA3), y
escribe sus credenciales a `data/orders-history-load-accounts.json`. El script
de k6 (`orders-history-read.js`) hace login + GET en cada iteración —
**el login no está tagueado** para el threshold (sólo mide el GET); se apoya en
el jar de cookies automático por VU que k6 mantiene durante todo el test (sin
necesidad de manipular headers `Cookie` a mano), documentado inline en el
script.

No hay k6 para `GET /v1/me/orders/{order_number}` (detalle): el NFR de la US
sólo cuantifica el "listado" (§9 dice "lectura" en general, pero el listado es
el camino de mayor volumen — un cliente abre su historial una vez y ve N
órdenes en una sola llamada; el detalle es 1 request por click, volumen mucho
menor). Mismo criterio de alcance que `QA-023-PERF-1` aplicó a un solo endpoint
de escritura en vez de a toda la superficie de pagos.

## Trade-offs

**Reusar `Invitado` (nombrado por el camino guest) para un cliente con sesión**,
en vez de escribir una clase `ClienteConSesion` dedicada. Se acepta porque la
clase ya es agnóstica al contenido del `ctx` — el nombre es un artefacto
histórico, no una restricción de comportamiento — y duplicar la lógica de
CSRF/carrito sería el anti-pattern real (drift entre dos implementaciones del
mismo protocolo).

**Contract testing contra el contrato publicado (`apps/api/docs/api/openapi.yaml`),
no contra un contrato vivo que no existe.** Alternativa descartada: esperar a
que el backend se archive antes de escribir este plan — inaceptable, porque
dejaría el historial de compras sin ninguna cobertura de aceptación mientras
tanto, y el archive de un change de backend no depende de que exista su QA
hermano (son changes independientes, per `openspec-workflow`).

**Sin E2E cross-stack (Layer 3) en este change.** Alternativa descartada:
escribir el escenario contra un namespace de ruta "propuesto" (`/cuenta/pedidos`)
que el propio backend deja como decisión pendiente del FE — produciría un test
que rompe apenas el FE elija un namespace distinto, o peor, uno que nunca se
ejecuta porque la ruta no existe y queda `@skip` indefinidamente (anti-pattern
de `flakiness-detection` señal 3, "disabled sin razón documentada" — acá SÍ hay
razón documentada, pero el test en sí no debería existir todavía).

## Open questions

Las dos viven en `proposal.md` §Preguntas abiertas con su default. Ninguna
bloquea la ejecución de lo que sí es alcanzable hoy (que es, estructuralmente,
el 100% de los 7 AC de la US).

## References

- `qa-plan.md` de este change (matriz AC×capa, escenarios Gherkin completos,
  stubs)
- Backend mergeado: [`US-015-historial-compras-backend`](../US-015-historial-compras-backend/design.md)
  §D1 (`resolveCustomerSession`/`OptionalCustomerGuard`), §D2 (escritor del
  checkout), §D3 (autorización en el WHERE, IDOR-proof), §D4 (corte de
  retención compartido), §Threat model (superficie 4 ya cerrada, este plan la
  verifica sin reabrirla)
- Precedente directo de "contrato publicado, no vivo, porque el backend no está
  archivado" y de reuso de `backdate-order.ts`: [`US-010-orden-webhook-stock-qa/design.md`](../archive/US-010-orden-webhook-stock-qa/design.md)
  §D-QA1, §D-QA5, §D-QA6
- Precedente de harness de sesión de cliente real: `qa/support/customer-auth.ts`
  (construido para `US-014-registro-login-qa`)
- Skills: `qa-three-layer-regression` (Layer 1 persistente vs Jest efímero;
  criterio de diferimiento de Layer 3 sin UI), `bdd-scenario-quality`,
  `k6-load-scaffolding` (thresholds NFR-atados, un solo endpoint sin
  baseline/stress/soak), `threat-modeling-lite` (superficie 4, ya cerrada por
  el backend), `openspec-workflow`
- Standards: `qa-backend-standards.md` §2.1/§13/§15/§21 · `testing-standards.md`
  §2/§4.1/§5/§8/§14/§14.9/§18 · `api-standards.md` §3/§8/§12 ·
  `performance-standards.md` §7
