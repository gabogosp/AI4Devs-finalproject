---
parent-us: US-012
discipline: qa
variant: null
language: es
---

# US-012 QA — Diseño de la suite

## Context

El paquete `@dsm/qa` acumula la regresión de US-001, US-002, US-003, US-007, US-014 y
US-006 (import): aceptación (Cucumber + Playwright), E2E de navegador, a11y con axe,
funcional con Newman y carga con k6. US-012 le agrega **la primera superficie admin de
escritura sobre un recurso que otro módulo crea** (la orden nace en `checkout/`, US-008,
y este panel solo la lee/transiciona) — hasta ahora todo lo que el dueño escribía por
`/v1/admin/*` (US-001, productos/categorías) era dueño de punta a punta de sus propios
recursos.

Las dos capas dev de esta US están planificadas y en **0 tasks ejecutadas** cada una,
mismo PR (#22), mismo branch. No hay contrato publicado (`grep '/admin/orders'
apps/api/docs/api/openapi.yaml` → vacío) ni ruta en `apps/web` todavía. Esa simetría —a
diferencia de US-007, donde el backend ya estaba construido cuando se planificó QA— es el
hecho que ordena todo este diseño: **todo** queda `blocked_by`, y la única capa que no
depende del frontend es la aceptación API-level.

Una asimetría adicional que no existía en changes anteriores: **no hay ningún camino de
API para sembrar una orden en `new`**. La transición `pending_payment → new` la escribe
`ConfirmOrderService` de `US-023-pago-manual-offline-backend` (worktree separado, también
0 tasks). El propio backend de US-012 resuelve esto para su capa dev-owned sembrando con
Prisma directo en sus tests (`design.md` del backend, T8.4). Esta suite necesita un
criterio análogo, pero sin renunciar a que la orden nazca de un checkout real.

## Goals

- Certificar las 9 AC con escenarios de aceptación API-level, ejecutables en cuanto el
  backend publique su contrato — sin esperar al frontend.
- Dejar armada la capa de navegador y accesibilidad contra criterios observables, para
  que el frontend se construya contra ellos (mismo criterio que US-007 aplicó a su propia
  capa de UI).
- Verificar la costura que **ningún test de un solo módulo puede ver**: que la orden que
  el dueño gestiona es la que el checkout real (US-008) registró, y que una sesión válida
  de otro rol (cliente real, US-014) no alcanza.
- Ser la red que detecta, cuando `US-013` (cancelación) o la reconciliación con
  `US-010` toquen este módulo, que la invariante "solo pagadas" (AC-8) se rompió.
- No repetir una sola aserción de la capa dev-owned de ninguno de los dos changes
  hermanos.

## Non-goals

- Re-probar la FSM en aislamiento (unit `order-state.ts`), el 404/409 por status code en
  aislamiento, o el mapeo RFC 7807: eso lo cubre la TDD del backend con Postgres real.
- Re-probar el estado optimista + rollback de `OrderStatusActions` a nivel de componente
  (RTL + MSW): eso lo cubre la TDD del frontend. Esta suite lo verifica **contra el
  backend real** (E-4, TC-1223), que es una cosa distinta.
- Testear `PendingPaymentsPanel` con tratamiento de AC completo — no tiene AC formal (ver
  `proposal.md` y §9 de este documento).
- Resolver la tensión de reconciliación con `US-010` (backend `design.md` decisión 2).

## Approach

### D1 — Qué agrega la capa QA sobre la capa dev-owned (por qué esta suite existe)

1. **El proceso y la configuración reales.** El backend arma su suite e2e-nest en memoria
   con env de test. Acá se habla con la API arrancada: `AdminGuard` real,
   `HttpProblemFilter` real, y el filtro de rutas UUID vs. `pending-payment` (D6 del
   backend) resuelto en el proceso real, no en una unidad aislada.
2. **El cruce de superficies.** Las órdenes nacen por `POST /v1/checkout` (US-008, público,
   ya mergeado) y se leen por `/v1/admin/orders*` (US-012, admin). El backend de US-012 no
   arma ese cruce: siembra directo en el estado que necesita.
3. **La identidad del rol, no solo la ausencia de sesión.** El backend prueba "sin token"
   y "token con rol no-admin minteado en el propio test". Esta suite agrega una **cuenta
   de cliente real**, registrada y logueada por el flujo real de US-014 — la sesión que un
   atacante con una cuenta legítima (pero del rol equivocado) efectivamente tendría.
4. **La observabilidad como contrato, no como implementación.** `order.status_changed` /
   `order.transition_rejected` alimentan `/v1/admin/metrics`, construido por otro change.
   Nadie en el backend de US-012 prueba esa costura porque no es su AC.
5. **Toda la mitad de UI** de las 9 AC, más los dos requisitos de accesibilidad que la US
   §9 pide por su nombre (tabla navegable por teclado, `aria-sort`), contra un browser
   real.

### D2 — El puente de siembra: checkout real + un `UPDATE` documentado (OQ-QA-1)

`qa/support/seed-ordenes.ts` (hermano, no extensión de ningún seed existente) construye
cada orden de prueba en dos pasos:

```ts
// Paso 1 — 100% API real, ningún acceso directo a la base.
const checkout = await ctx.post('/v1/checkout', { data: { items: [...], buyer: {...} } });
const { order_id } = await checkout.json();   // nace en pending_payment (US-008)

// Paso 2 — puente documentado, temporal, hasta que exista
// POST /v1/admin/orders/{orderId}/confirm-payment (US-023).
// Deliberadamente el ÚNICO acceso a @dsm/db de todo este seed — todo lo demás
// pasa por la API real, exactamente como seed-carrito.ts / seed-categorias.ts.
await prisma.order.update({ where: { id: order_id }, data: { status: 'new' } });
```

**Por qué no se sortea con `qa-backend-standards.md` §15** ("datos sintéticos por la API
real"): la norma asume que existe una API que produce el estado necesario. Acá no existe
— el propio backend de US-012 resuelve el mismo problema con Prisma directo en su propia
capa (T8.4). El criterio que sí se preserva es que **lo que la API real puede producir, lo
produce la API real**: los ítems, el comprador, el total y el snapshot de precio nacen
100% del checkout verdadero. Solo el único salto de estado que ningún endpoint expone
todavía se puentea, con el `grep` de `! grep -q "PrismaClient" qa/support/seed-ordenes.ts`
del smoke **reemplazado** por una aserción que confirma que **es el único** import de
`@dsm/db` en el archivo (a diferencia de `seed-carrito.smoke.ts`, que assertea su
ausencia total — acá la excepción está declarada y acotada).

**Revisitar cuando `US-023` aterrice**: cambiar el paso 2 por
`POST /v1/admin/orders/{orderId}/confirm-payment` real. El día que eso pase, este archivo
dejará de ser el único punto de `@dsm/db` de la suite de aceptación de órdenes — ver
`proposal.md` OQ-QA-1 y el charter TC-1251.

**Órdenes que el puente no puede producir por sí solo** (necesitan un paso extra, todos
documentados en el mismo archivo):

- **`cancelled`** (para C-1): no hay ninguna transición que la alcance desde este panel
  (US-013 no existe). Se puentea igual, con la misma disciplina: checkout real → `new`
  (puente de arriba) → `UPDATE` directo a `cancelled`. Revisar cuando `US-013` aterrice.
- **`pending_payment`** (para N-3): no necesita puente — es exactamente lo que el checkout
  real produce sin tocar nada más.
- **Historial con más de una transición** (para H-3, C-2): se produce con `PATCH` reales
  sucesivos contra el endpoint del propio backend de US-012, nunca con `INSERT` directo en
  `order_status_history`.

### D3 — Identidad de cliente real para X-2 (cross-feature con US-014)

`qa/support/customer-auth.ts` ya expone `nuevaCuenta()`: registra y loguea una cuenta real
contra `/v1/auth/register` + `/v1/auth/login`, devolviendo un `APIRequestContext` con la
sesión activa. Esta suite lo reusa sin modificarlo — es exactamente la pieza que hace que
X-2 sea un cross-feature real y no una negativa genérica: la sesión que se rechaza es una
que el sistema **de verdad emitió**, para otro propósito.

### D4 — Aceptación BDD: feature nueva, tag propio

`qa/acceptance/features/ordenes.feature` (`# language: es`, tag de feature `@ordenes`),
13 escenarios en las 4 categorías canónicas (`testing-standards.md` §14.9,
`qa-three-layer-regression` §"Qué define el regression suite"). Steps en
`qa/acceptance/steps/ordenes.steps.ts`, reusando `this.admin` del world existente para las
llamadas admin y `customer-auth.ts` para X-2. Contenido completo en `qa-plan.md` §5.

### D5 — E2E de navegador y accesibilidad: escritos contra el contrato ratificado del FE

`qa/e2e/ordenes.spec.ts` y `qa/e2e/ordenes-a11y.spec.ts` (mismo naming que
`carrito.spec.ts`/`carrito-a11y.spec.ts`), contra las rutas que el `design.md` de FE ya
fijó (`/admin/ordenes`, `/admin/ordenes/{id}`) y los componentes que ya nombra
(`OrdersList`, `OrderDetail`, `OrderStatusActions`, `OrderStatusBadge`,
`OrderStatusHistory`). Selectores por rol/etiqueta accesible — nunca CSS ni índice
(`playwright-stability` §Selectors). El login del panel usa `adminSession.ts` +
`sessionStorage` (Bearer, no cookie) — a diferencia del carrito, no hace falta un cliente
con manejo de CSRF; se reusa `admin-auth.ts` para obtener el token y se lo inyecta en
`sessionStorage` antes de navegar, mismo patrón que cualquier E2E de un panel con auth por
`sessionStorage` en este repo.

### D6 — Carga: los dos números ya están ratificados en la propia US

A diferencia de US-007 (donde el número de lectura del carrito estaba
`[propuesto — confirma Arquitecto]`), la US §9 de este change fija los dos sin
condicional: **`p95 lectura < 300ms`** y **`p95 escritura (transición) < 500ms`**,
heredados de PRD §4. Se agregan `list_orders` y `order_transition` a
`qa/performance/lib/thresholds.js` (fuente única), consumidos por
`qa/performance/orders-read.js` y `qa/performance/orders-write.js` respectivamente —
scripts separados, mismo criterio que `storefront-product.js`/`cart-write.js` (patrones de
acceso distintos: un listado paginado vs. una escritura puntual por id).

`orders-write.js` necesita, igual que el carrito, datos sembrados antes de correr
(`setup()` vía `seed-ordenes.ts`) y una orden distinta por iteración para no medir el
`UPDATE` condicional sobre una fila caliente (`k6-load-scaffolding` §Data and
correlation). El volumen real de esta US es bajísimo (~100 órdenes/mes, PRD §6) — el valor
del load test no es simular ese volumen, es la regresión de latencia: que un `JOIN` nuevo,
un índice que se cae o una migración futura no degraden el p95 por debajo del piso que la
propia US promete.

### D7 — Exploratorio

Dos charters (`qa/exploratory/charters.md`, apéndice sin reescribir lo anterior):

- **El panel en un día real de operación** (bloqueado por el FE): multi-pestaña con dos
  operadores (aunque el proyecto asuma un único dueño, ADR-0009 — nada impide que dos
  pestañas del mismo dueño avancen la misma orden a la vez), conectividad intermitente en
  el local, y el volumen real de un día (unas pocas órdenes, no miles).
- **La reconciliación del ciclo completo cuando `US-023` aterrice** (bloqueado por
  backend propio + `US-023-pago-manual-offline-backend`): repetir el ciclo completo
  `pending_payment → new → preparing → ready → delivered` **sin el puente de `@dsm/db`**
  de D2, usando `POST /v1/admin/orders/{orderId}/confirm-payment` real. Es la salida
  esperada del puente temporal: el día que este charter se pueda correr sin el puente, D2
  queda obsoleto y se puede borrar.

## Trade-offs

| Decisión | Alternativa descartada | Por qué |
|---|---|---|
| Puente `@dsm/db` acotado a un único `UPDATE` por orden (D2) | Esperar a que `US-023` aterrice para planificar toda esta suite | Dejaría las 9 AC sin ninguna red mientras el backend de US-012 se desarrolla; el propio backend ya acepta el mismo trade-off en su capa dev (T8.4) |
| Checkout real + puente, en vez de `INSERT` directo de la orden completa | Sembrar la orden entera con Prisma, como hace la capa dev del backend | Perdería la única cosa que esta capa agrega sobre la capa dev: que la orden es la que un cliente real compró (X-1) |
| Seed **hermano** (`seed-ordenes.ts`) | Extender `seed-carrito.ts` (mismo dominio de checkout) | Acoplaría fixtures de dos suites con ciclos de vida distintos — mismo criterio que ya fijó `US-007-carrito-compra-qa` frente a `seed-categorias.ts` |
| `customer-auth.ts` sin modificar para X-2 | Mintear un JWT con rol `customer` a mano | Un JWT minteado prueba que el guard lee el claim; una cuenta real prueba que el sistema, de punta a punta, nunca le da a un cliente una sesión que el panel acepte |
| Dos scripts de k6 (lectura/escritura) | Un solo script con dos escenarios | Mismo criterio que el resto de `qa/performance/`: patrones de acceso distintos, presupuestos distintos, un solo `endpoint:` tag por archivo |
| `PendingPaymentsPanel` sin tratamiento de AC (ver §9) | Inventar un AC-10 para poder planificarlo igual | Fuera de la autoridad de este plan — el pedido ya está hecho en el `proposal.md` de FE (OQ-FE-4) y en el de este change (OQ-QA-3) |

## Test plan (resumen — detalle cerrado en `qa-plan.md`/`tasks.md`)

Aceptación BDD (13, capa 3, bloqueada por backend) → E2E de navegador (5, bloqueada por
backend+frontend) → Accesibilidad (2, bloqueada por frontend) → Carga (2, bloqueada por
backend) → Exploratorio (2, bloqueado según corresponda). Ninguna capa dev-owned se
re-autora; se referencian como cobertura consciente en `qa-plan.md` §3.

## §9 — `PendingPaymentsPanel`: por qué este documento no lo diseña

`design.md` del frontend (§D9) ya diseñó el componente, el servicio y los estados
explícitos de esta vista — con la salvedad, declarada en su propio documento, de que
**no tiene un AC Gherkin formal** en la US (nace de una nota informal §10, `proposal.md`
de FE OQ-FE-4). Diseñar acá una capa QA completa (Gherkin + test cases con
`execution_mode`/`test_layer`/`target_tooling`) sería tratar esa nota informal como si
fuera una de las 9 AC ratificadas — exactamente lo que las instrucciones de este plan piden
no hacer. `qa-plan.md` §9 documenta, en cambio, un boceto no comprometido de qué
escenarios QA-owned haría falta el día que se ratifique, y dos bloqueos explícitos: la
falta de AC y la falta de un plan de QA para `US-023-pago-manual-offline-backend` (que
posee los dos endpoints que esa vista consume).

## References

- `qa-three-layer-regression` (L3 cross-stack, 4 categorías) · `bdd-scenario-quality` ·
  `playwright-stability` · `k6-load-scaffolding` · `flakiness-detection`
- `docs/quality/testing-standards.md` §2, §5, §14, §14.9, §18
- `docs/quality/qa-backend-standards.md` §2.1 (ownership), §13 (performance), §15 (datos)
- `docs/quality/qa-frontend-standards.md` §19 (a11y), §23 (Playwright), §24 (BDD web)
- `docs/cross-cutting/performance-standards.md` §7, §8
- Backend: `openspec/changes/US-012-panel-ordenes-dueno-backend/design.md` (D1-D10, STRIDE
  D9, decisiones 1-5, OQ-BE-1..3)
- Frontend: `openspec/changes/US-012-panel-ordenes-dueno-frontend-web/design.md` (D1-D10,
  OQ-FE-1..4)
- Precedente de forma: `openspec/changes/US-007-carrito-compra-qa/design.md`
- ADR-0008 (stock al aprobar el pago), ADR-0009 (seam de admin, operador único)
