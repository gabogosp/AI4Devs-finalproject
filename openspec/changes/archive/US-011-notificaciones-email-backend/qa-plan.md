# QA Plan — US-011 Notificaciones por email (Resend) — Backend

> **Ticket**: US-011 — Notificaciones por email (Resend)
> **Author**: qa-engineer agent (assisted by @gosp)
> **Date**: 2026-09-06
> **Status**: Executed (`/develop-qa`, 2026-09-06) — QA-011-BDD-1..4 verdes
> (6/6 escenarios `@us-011`, 39/39 steps); regresión completa
> `pago-webhook.feature` + `ordenes.feature` (`not @blocked`) 36/38 escenarios
> verdes, 2 ambiguous pre-existentes en `SC-010-N5` (colisión de step con
> `cancelacion-ordenes.steps.ts` de US-013, verificada en `HEAD` antes de este
> change — no introducida ni tocada por este plan). Determinismo confirmado
> con una segunda corrida idéntica de ambas suites. TC-011-004/005/006 quedan
> `blocked` sin cambio (§4.6) — sigue sin existir cuenta Resend real
> (`proposal.md` OQ-3).
> **Affected platform(s)**: backend (sin superficie frontend — `disciplines:
> [BE, QA]` en la US, sin `US-011-...-frontend-web`)
> **Service tier(s)**: 2 (`docs/services/dsm-ecommerce/runbook.md` frontmatter
> — única fuente de tier en este repo, sin `service-catalog.yaml`; mismo tier
> que ya resolvió el `qa-plan.md` de US-021 con el mismo razonamiento — no se
> re-deriva)
> **Companion files**: `proposal.md`, `tasks.md`, `design.md`

---

## 0. Mode A — por qué este plan vive acá, y la restricción de Resend

**Mode A** (inline): único change code-generating para US-011
(`US-011-notificaciones-email-backend`), sin `-frontend-web` (la US no tiene
disciplina FE). Sigue el precedente de
`openspec/changes/archive/US-021-retencion-datos-ordenes-backend/qa-plan.md`
(formato, capas, frontmatter de test-case) — Layer 1 vive en el change de
backend, per `qa-three-layer-regression`.

**La restricción central de este plan — resuelta, no evitada**: `proposal.md`
OQ-3 deja explícito que **no hay cuenta real de Resend con dominio verificado
en ningún entorno**, y `qa/scripts/api-up.sh` (verificado leyendo el script)
**nunca exporta `RESEND_API_KEY`**. Por diseño de `notification.provider.ts`
(T7.1), eso significa que en **todo entorno donde este plan se ejecuta**
(local, CI, staging QA) `NOTIFICATION_PORT` sigue resolviendo a
`LoggingNotificationAdapter` — el mismo adapter de log que ya existe hoy, sin
ningún cambio de comportamiento por este change (T8.1 sólo toca su
docstring). Consecuencia directa, verificada leyendo el adapter:

- `LoggingNotificationAdapter` loguea `order.{tipo} order_id=... order_number=...`
  — **nada más**. No loguea `items`, `total_ars_cents`, ni el cuerpo del email.
- Ningún test QA-owned en este entorno puede observar: el contenido real del
  email (texto/HTML, escapado, copy), la entrega real a una casilla, la
  clasificación real de error de Resend (429/5xx reales), ni el
  reintento/backoff ejercitándose de verdad (nunca hay un fallo transitorio
  real que dispare la rama de reintento del adapter).
- Lo que **sí** es observable, y es exactamente el mismo mecanismo que
  `openspec/changes/archive/US-010-orden-webhook-stock-qa/qa-plan.md` (§4,
  `SC-010-H2`) y `openspec/changes/archive/US-012-panel-ordenes-dueno-qa/qa-plan.md`
  ya usan (`qa/support/api-log.ts` — `esperarAviso`/`leerLogApi`, lectura del
  stdout de la API real): **que el puerto fue invocado, exactamente una vez,
  para el `order_id` correcto, en el momento correcto, sin fugar el email del
  comprador en la línea de log**. Ese es el techo real de lo que QA puede
  probar en este repo hoy sin una cuenta de Resend — se documenta acá en vez
  de inventar cobertura.

**Alternativa considerada y rechazada** (para no fingir que el gap no existe):
levantar una instancia QA con `RESEND_API_KEY` seteada a un valor cualquiera
forzaría a `ResendNotificationAdapter` a llamar de verdad a
`https://api.resend.com` (rechazo real por key inválida — un 401 permanente,
ni siquiera ejercita el camino de reintento). Se descarta como parte de la
suite automatizada: es una llamada de red real a un tercero desde un test
(`flakiness-detection` Signal 6 — Critical: "Real network calls in tests"),
no determinística, y no prueba nada que el test unitario con cliente mockeado
(`tasks.md` T6.1, dev-owned) no pruebe ya de forma controlada. Ver §4.4 y
§9 (exploratorio) para dónde sí tiene sentido, manual y fuera de esta suite.

**Qué prueba esto en la práctica**: AC-1/AC-2/AC-3 (el *trigger* dispara,
correlacionado, sin duplicar) son observables y se prueban acá. AC-4/AC-5 (el
reintento real, el fallo persistente real) son **`blocked`** a nivel
aceptación — completamente cubiertos por el test unitario dev-owned con
cliente mockeado (`tasks.md` T6.1, exit criteria b–e), pero no verificables
end-to-end en este entorno. Esto no es una laguna de este plan: es una laguna
real del entorno (sin cuenta Resend, `proposal.md` OQ-3), documentada en vez
de rellenada en falso, mismo criterio que `qa-plan.md` de US-021 (TC-021-004b
`blocked`, TC-021-007 `manual`).

---

## 1. Perfil de riesgo

- **Módulo `orders/ports/` extendido (`ResendNotificationAdapter` + 4
  plantillas + backoff + provider por entorno)**: MEDIO — primer adapter de
  este repo que interpola datos de origen externo (`buyerName`, `productName`)
  en un cuerpo HTML de email (threat model de `design.md`, HTML injection). Sin
  endpoint HTTP nuevo (superficie de entrada no cambia — los dos triggers ya
  están autenticados/autorizados aguas arriba, `design.md` "Threat model").
- **Sin persistencia nueva**: AC-7 se apoya en guardas ya existentes
  (`design.md` Decisión 2) — no hay migración, no hay tabla nueva que este plan
  deba probar contra Postgres real más allá de lo que ya prueban
  `confirm-order.service.provider.spec.ts` / `orders-admin.service.spec.ts`
  (dev-owned).
- **Dependencia externa nueva en producción, no en este entorno**: Resend. El
  adapter real nunca corre en QA (§0) — el riesgo de integración real
  (cuenta, dominio, límites de envío) es 100% post-`/plan-deployment`, fuera
  del alcance de este plan (ver §11 Preguntas abiertas).
- **Stateful**: sí (Postgres real, sin motor nuevo) — vía los dos callers ya
  existentes (`ConfirmOrderService`, `OrdersAdminService`).
- **Performance-sensitive**: parcialmente — el reintento in-process (Decisión
  1 de `design.md`) puede agregar hasta `≈16s` al webhook de MercadoPago y al
  `PATCH /admin/orders/:id` en el peor caso. Ver §7 para por qué esto **no**
  dispara una suite k6 nueva.
- **Accesibilidad**: N/A — sin superficie UI en este change.

Journeys críticas identificadas:
1. Un pago aprobado (webhook real o `simulate-payment`) dispara el aviso al
   comprador y al dueño, exactamente una vez cada uno, sin exponer el email
   del comprador en ningún registro observable (AC-1, AC-2, AC-8).
2. El dueño marca una orden como "lista para retirar" y el comprador recibe
   el aviso correspondiente, exactamente una vez (AC-3, AC-7).
3. Un pago aprobado sin stock suficiente cancela la orden automáticamente y
   avisa de esa cancelación — el puerto ya se invoca en producción
   (`compensarSinStock`, US-010) y esta US es quien primero lo entrega de
   verdad; hasta ahora no tenía ningún test que verificara el *trigger* del
   4º método del puerto (OQ-1 de `proposal.md`).
4. Ningún reintento ni reprocesamiento de un evento ya notificado produce un
   segundo aviso (AC-7) — el caso más caro de fallar en silencio, porque un
   bug acá se traduce en spam real a comprador/dueño una vez que Resend esté
   provisionado.

### 1.1 Ownership — capas dev-owned (coverage-awareness, no se re-planifican acá)

Per `qa-backend-standards.md` §2.1: unit e integration son dev-owned y ya
están planificados en `tasks.md` — no se duplican acá:

- **T1.1/T1.2**: extensión de `OrderConfirmedPayload` (`items`/`totalArsCents`)
  + aserción extendida en `confirm-order.service.provider.spec.ts` — **esta
  es la única superficie que realmente prueba el contenido de AC-1** ("detalle
  de su orden: ítems, total"), porque `LoggingNotificationAdapter` no lo loguea
  (§0). No se re-verifica acá con un doble mecanismo.
- **T2.1/T2.2**: env fail-fast de las 5 vars nuevas.
- **T3.1**: `backoffDelayMs`/`isTransientResendError` — unit puro.
- **T4.1**: las 4 plantillas texto/HTML + `escapeHtml` — **esta es la única
  superficie que prueba el contenido real de AC-8** (grep de
  `payment`/`card`/`tarjeta`/`cvv`/`external_id` en el archivo completo,
  `<script>` no aparece sin escapar). No observable desde HTTP (§0).
- **T5.1**: `NotificationEventsService` — contador `dsm_notifications_events_total`
  (sólo se incrementa cuando `ResendNotificationAdapter` corre — nunca en este
  entorno QA, §0; por eso este plan no usa `/v1/admin/metrics` para
  notificaciones, a diferencia de `ordenes.steps.ts` que sí lo usa para
  `dsm_orders_events_total`).
- **T6.1**: `ResendNotificationAdapter` con cliente Resend **mockeado** — es
  la ÚNICA superficie que ejercita de verdad el reintento/backoff (AC-4) y el
  fallo persistente (AC-5), con los 6 casos (a)-(f) de su exit criterion.
  Ningún test QA-owned intenta duplicar esto (§0).
- **T7.1/T7.2**: selección de adapter por entorno + wiring de DI — cubierto
  por la suite `resend-notification-adapter.spec.ts -t "selección..."` y por
  el gate de regresión completo (`jest --ci`) que exige T7.2.

Este plan (`qa-plan.md`) cubre exclusivamente lo QA-owned: aceptación BDD
(§4) contra la API real con `LoggingNotificationAdapter` (único adapter
observable en este entorno, §0), regresión (§4, tags), y exploratorio (§9)
para lo que sólo será verificable cuando exista una cuenta Resend real.

---

## 2. Matriz de test (QA-owned)

| Capa | Requerida | Herramienta | Qué cubre |
|---|---|---|---|
| Unit / Integration BE | Dev-owned (TDD) | Jest | Payload/plantillas/backoff/adapter con cliente mockeado/provider — **no planificado acá**, ver §1.1 |
| **Acceptance (BDD)** | ✅ Sí | Cucumber-js + Playwright `request` (mismo stack que `pago-webhook.feature`/`ordenes.feature`) | AC-1/2/3/7/8 (trigger, correlación, no-duplicado, no-PII) — Layer 1, API-level |
| **Contract** | ❌ No aplica | — | Sin endpoint HTTP nuevo ni modificado (`proposal.md` "Out of scope") |
| **Performance (k6)** | ❌ No (justificado) | — | Ver §7 — sin NFR propio, endpoints ya excluidos de k6 por decisión previa de `QA-010` |
| **E2E cross-stack (Layer 3)** | ❌ No aplica | — | Sin disciplina frontend en esta US (`disciplines: [BE, QA]`) |
| **Accesibilidad** | ❌ No aplica | — | Sin superficie UI |
| **Exploratory** | ✅ Sí | Charters (`qa/exploratory/charters.md`) | Contenido real del email, latencia real bajo reintento, PII residual — todo gated por una cuenta Resend real (§9) |

---

## 3. Mapeo AC → escenario (las 8 AC, cada una con al menos 1 tratamiento explícito)

| AC | Escenario(s) | Capa | Nota |
|---|---|---|---|
| AC-1 (confirmación comprador, con detalle) | Trigger: `SC-010-H2` (ya existe, sin cambio) — extensión propuesta en §4.4 sólo de alcance (tag `@us-011`) | Acceptance (trigger) + **dev-owned** (T1.1/T1.2, contenido) | El "detalle" (ítems/total) no es observable QA-side (§0) |
| AC-2 (aviso nueva orden al dueño) | `SC-010-H2` (ya existe, sin cambio) | Acceptance | Ya cubierto por `QA-010-ACC-1` — no se duplica |
| AC-3 (listo para retirar) | `H-4` de `ordenes.feature` — **aserción reforzada** (§4.2) | Acceptance | Hoy sólo verifica el HTTP 200 (comentario explícito en el propio `ordenes.steps.ts` diciendo "US-011 sin proveedor real todavía") — se fortalece con `esperarAviso` |
| AC-4 (reintento ante fallo transitorio) | `TC-011-004` | **`blocked`** (acceptance) + dev-owned (T6.1 b/c/e) | Sin fallo transitorio real posible sin cuenta Resend (§0) |
| AC-5 (fallo persistente no revierte la orden) | `TC-011-005` | **`blocked`** (acceptance) + dev-owned (T6.1 c/d) | Idem — no hay forma de forzar un fallo persistente real en este entorno |
| AC-6 (no bloquea confirmación/stock) | Regresión estructural vía `SC-010-H1` (sin cambio — sigue probando que la orden queda confirmada y el stock decrementado, ambos ya comprometidos ANTES de que `notificarConfirmacion` corra) + `TC-011-006` `blocked` para el sub-caso "bajo reintento real" | Acceptance (regresión) + `blocked` (sub-caso) | Ver §4.5 — el guard estructural es previo a esta US (US-010) y no cambia |
| AC-7 (no duplicados) | `SC-010-N4` extendido (§4.2) + `C-2` extendido (§4.3) | Acceptance (regresión) | Cruza los dos triggers (confirmación + transición admin) |
| AC-8 (sin datos sensibles) | `SC-010-H2` (confirmed/owner_new_order, ya existe) + `H-4`/`SC-010-N3` extendidos (§4.2/§4.3, ready_for_pickup/cancelled_no_stock) | Acceptance (regresión, los 4 tipos) + dev-owned (T4.1, contenido real) | Los 4 tipos de aviso quedan cubiertos por "no hay `@` en la línea de log"; el contenido real del HTML es dev-owned |

---

## 4. Escenarios — extender, no duplicar

### 4.1 Decisión explícita (per `qa-three-layer-regression` — "Same scenario in
Layer 1 twice = duplication")

Los triggers de las 4 notificaciones **ya corren en producción** desde
US-010/US-012, y sus qa-plans respectivos **ya** los prueban con escenarios
reales contra la API real:

- `SC-010-H2` (confirmación → `order.confirmed` + `order.owner_new_order`).
- `SC-010-N3` (pago aprobado sin stock → cancelación; **sin** aserción de
  `order.cancelled_no_stock` todavía).
- `SC-010-N4` (repetir confirmación de una orden ya confirmada; **sin**
  aserción de que el aviso no se duplica).
- `H-4`/`C-2` de `ordenes.feature` (transición a "ready"; **sin** aserción
  directa del aviso — sólo status HTTP / contador de `order.status_changed`
  como proxy).

Escribir escenarios nuevos que repitan el mismo `Given`/`When` (misma orden,
mismo pago simulado, misma transición admin) sólo para agregar un `Then` de
notificación sería el anti-patrón exacto que la skill nombra. Este plan
**extiende** esos 4 escenarios en lugar de duplicarlos, y agrega el tag
`@us-011` a los 4 para que la regresión de esta US sea filtrable
(`--tags "@us-011"`) sin re-declarar el escenario.

No se crea un archivo `notificaciones-email.feature` nuevo: no hay ningún
comportamiento de esta US observable end-to-end que no encaje como extensión
de uno de esos 4 escenarios (§0 ya explica por qué el contenido del email y
el reintento real no son observables acá).

**IDs externos citados en este plan (definidos en otro documento, no acá)**:

- **H-4** y **C-2**: escenarios propios de `qa/acceptance/features/ordenes.feature`.
- **TC-1204** y **TC-1207**: los mismos dos escenarios, documentados
  originalmente en `openspec/changes/archive/US-012-panel-ordenes-dueno-qa/qa-plan.md`
  — este plan los extiende (§4.3), no los redefine.
- **TC-021**: prefijo de los test-case ids de
  `openspec/changes/archive/US-021-retencion-datos-ordenes-backend/qa-plan.md`
  (§0), citado ahí como precedente de honestidad de cobertura — sin relación
  funcional con esta US.

### 4.2 Touch-ups a `qa/acceptance/features/pago-webhook.feature` +
`qa/acceptance/steps/pago-webhook.steps.ts`

- [x] **QA-011-BDD-1** — **Ejecutado, verde**: `esperarAviso('cancelled_no_stock', ...)`
  confirma exactamente 1 aviso por corrida, sin flakiness en 2 corridas.
  `SC-010-N3` gana una línea (AC completitud, OQ-1 de
  `proposal.md` — `order.cancelled_no_stock` no tenía ningún test de trigger
  hasta esta US):
  ```gherkin
  @negative @critical-path @us-011
  Escenario: SC-010-N3 — Aprobado sin stock suficiente: la orden se cancela y el reembolso no se pierde (AC-4, AC-4 de US-011)
    Dado que el stock de un producto de la orden bajó por debajo de lo pedido después del checkout
    Cuando se confirma el pago de esa orden por el medio simulado "DSM"
    Entonces recibo el rechazo por auto-cancelación por falta de stock
    Y la orden queda "cancelled"
    Y el pago queda reembolsado
    Y el stock del producto no decrementó
    Y el puerto de notificaciones recibe exactamente un aviso de cancelación por falta de stock para ese comprador
  ```
  Nuevo step (`pago-webhook.steps.ts`, mismo patrón que
  `esperarAviso('confirmed', ...)` ya usado en el mismo archivo):
  ```ts
  Then(
    'el puerto de notificaciones recibe exactamente un aviso de cancelación por falta de stock para ese comprador',
    PASO,
    async function (this: CatalogWorld) {
      const e = est(this);
      const veces = await esperarAviso('cancelled_no_stock', e.orden!.id);
      assert.equal(veces, 1, `se esperaba exactamente 1 aviso "order.cancelled_no_stock" para ${e.orden!.id}, hubo ${veces}`);
    },
  );
  ```
  - **Exit criterion**: el escenario falla si `ResendNotificationAdapter`/
    `LoggingNotificationAdapter` no invoca `orderCancelledNoStock` exactamente
    una vez cuando `compensarSinStock` corre.
  - **Verify**: `pnpm --filter @dsm/qa test:acceptance -- --tags "@us-011"` (exit 0)

- [x] **QA-011-BDD-2** — **Ejecutado, verde**: las dos líneas reusan steps
  existentes (`SC-010-H2`) sin código nuevo; confirmado 1 aviso de cada tipo
  tras la repetición, sin flakiness en 2 corridas.
  `SC-010-N4` gana dos líneas (AC-7 — el caso más
  directo del repo: reintentar la confirmación de una orden ya confirmada es
  EXACTAMENTE el escenario de "reintento de webhook de MercadoPago" que
  `design.md` Decisión 2 usa como ejemplo):
  ```gherkin
  @negative @critical-path @us-011
  Escenario: SC-010-N4 — Repetir la confirmación de una orden ya confirmada no duplica efectos (AC-5, AC-7 de US-011)
    Dado que la orden ya fue confirmada por el medio simulado "DSM"
    Cuando se repite la confirmación de esa misma orden
    Entonces recibo el rechazo por estado ya no pendiente
    Y el stock no se decrementa una segunda vez
    Y sigue existiendo exactamente un pago registrado para esa orden
    Y el puerto de notificaciones recibe exactamente un aviso de confirmación para el comprador
    Y exactamente un aviso de orden nueva para el dueño
  ```
  Las dos últimas líneas reusan steps **ya existentes** (`SC-010-H2`) — cero
  step nuevo.
  - **Exit criterion**: el escenario falla si la rama `OrderNotPendingPaymentError`
    (que corre en la transacción, antes de llegar a `notificarConfirmacion`,
    per `design.md` Decisión 2) llegara a invocar el puerto una segunda vez.
  - **Verify**: `pnpm --filter @dsm/qa test:acceptance -- --tags "@us-011"` (exit 0)

### 4.3 Touch-ups a `qa/acceptance/features/ordenes.feature` +
`qa/acceptance/steps/ordenes.steps.ts`

- [x] **QA-011-BDD-3** — **Ejecutado, verde**: el step reforzado (con
  `esperarAviso('ready_for_pickup', ...)`, import agregado en
  `ordenes.steps.ts`) confirma exactamente 1 aviso por transición a "ready",
  sin flakiness en 2 corridas.
  `H-4` — la implementación del step existente
  ("el sistema dispara el aviso de que el pedido está listo para ese
  comprador") se fortalece; el texto Gherkin **no cambia**, sólo gana el tag
  `@us-011` y su comentario deja de decir "US-011 sin proveedor real todavía"
  (ya aterrizó — aunque siga sin cuenta real, §0):
  ```ts
  Then(
    'el sistema dispara el aviso de que el pedido está listo para ese comprador',
    PASO,
    async function (this: CatalogWorld) {
      const e = est(this);
      assert.equal(est(this).respuesta!.status, 200);
      assert.equal((est(this).respuesta!.body as { status: string }).status, 'ready');
      const veces = await esperarAviso('ready_for_pickup', e.orden!.id);
      assert.equal(veces, 1, `se esperaba exactamente 1 aviso "order.ready_for_pickup" para ${e.orden!.id}, hubo ${veces}`);
    },
  );
  ```
  (requiere importar `esperarAviso` de `../../support/api-log` en
  `ordenes.steps.ts` — no existe ese import hoy en ese archivo).
  - **Exit criterion**: el escenario falla si `orderReadyForPickup` no se
    invoca exactamente una vez cuando `changeStatus` transiciona a "ready".
  - **Verify**: `pnpm --filter @dsm/qa test:acceptance -- --tags "@us-011"` (exit 0)

- [x] **QA-011-BDD-4** — **Ejecutado, verde**: la aserción directa vía
  `esperarAviso` se agregó ADEMÁS de la existente por contador de métricas;
  confirmado que el aviso sigue en 1 tras repetir la transición, sin
  flakiness en 2 corridas.
  `C-2` — el step existente ("el aviso de 'lista para
  retirar' no se dispara una segunda vez") hoy compara el contador
  `dsm_orders_events_total{event="order.status_changed"}` (proxy correcto per
  `design.md` Decisión 2, pero indirecto — nunca lee el propio aviso). Se
  agrega la aserción directa, sin quitar la existente (las dos son válidas y
  se refuerzan):
  ```ts
  Then('el aviso de "lista para retirar" no se dispara una segunda vez', PASO, async function (
    this: CatalogWorld,
  ) {
    const e = est(this);
    const despues = await metricas(this);
    assert.equal(
      despues.applied,
      e.antes!.applied,
      'el contador de transiciones aplicadas subió con una repetición (no-op)',
    );
    const veces = await esperarAviso('ready_for_pickup', e.orden!.id);
    assert.equal(veces, 1, `se esperaba que el aviso siguiera en 1 tras la repetición, hubo ${veces}`);
  });
  ```
  - **Exit criterion**: el escenario falla si repetir el mismo `PATCH` a
    "ready" dispara un segundo `order.ready_for_pickup` para la misma orden.
  - **Verify**: `pnpm --filter @dsm/qa test:acceptance -- --tags "@us-011"` (exit 0)

### 4.4 Ya cubierto, sin cambio (referencia, no duplicación)

- `SC-010-H2` (`pago-webhook.feature`) prueba AC-1/AC-2 (trigger, exactamente
  1 cada uno) y la mitad de AC-8 (ningún aviso de `confirmed`/`owner_new_order`
  revela el email del comprador). Se le agrega el tag `@us-011` (cambio de
  1 línea, sin tocar el `Given`/`When`/`Then`) para que quede en el filtro de
  regresión de esta US.

### 4.5 AC-6 — regresión estructural, sin escenario nuevo

`SC-010-H1` ya prueba que la orden queda confirmada y el stock decrementado
inmediatamente después del 200 del webhook — ese efecto se compromete **dentro**
de la transacción, **antes** de que `notificarConfirmacion` corra
(`design.md` Decisión 1/2, sin cambio de esta US). Nada en `tasks.md` toca esa
secuencia. Este plan no agrega un escenario nuevo para AC-6: `SC-010-H1`
(con `@us-011` agregado como tag de alcance, mismo criterio que §4.4) sigue
siendo la prueba de regresión válida de que la confirmación/stock no dependen
de que la notificación termine.

El sub-caso que AC-6 sí matiza — "ni bajo reintento" — es genuinamente
`blocked` en este entorno: `LoggingNotificationAdapter` nunca reintenta (§0),
así que no hay forma de observar el webhook bajo el peor caso real de latencia
(`≈16s`, `design.md` Decisión 1) sin una cuenta Resend real. Ver `TC-011-006`.

#### TC-011 — Test cases (frontmatter, per `qa-three-layer-regression`)

```yaml
---
id: TC-011-001
scenario: SC-010-N3 (extendido, §4.2)
execution_mode: automated
test_layer: 1
target_tooling: Postman
gherkin_scenario: SC-010-N3 — Aprobado sin stock suficiente (+ aviso de cancelación, AC completitud OQ-1)
---
```
```yaml
---
id: TC-011-002
scenario: SC-010-N4 (extendido, §4.2)
execution_mode: automated
test_layer: 1
target_tooling: Postman
gherkin_scenario: SC-010-N4 — Repetir la confirmación no duplica efectos (+ no duplica avisos, AC-7)
---
```
```yaml
---
id: TC-011-003
scenario: H-4 de ordenes.feature (aserción reforzada, §4.3)
execution_mode: automated
test_layer: 1
target_tooling: Postman
gherkin_scenario: H-4 — Marcar "lista para retirar" dispara el aviso al cliente (AC-3)
---
```
```yaml
---
id: TC-011-004a
scenario: C-2 de ordenes.feature (aserción reforzada, §4.3)
execution_mode: automated
test_layer: 1
target_tooling: Postman
gherkin_scenario: C-2 — Repetir la misma transición no duplica el historial ni el aviso (AC-7)
---
```
```yaml
---
id: TC-011-004b
scenario: SC-010-H2 (sin cambio, §4.4 — referencia)
execution_mode: automated
test_layer: 1
target_tooling: Postman
gherkin_scenario: SC-010-H2 — La confirmación dispara las notificaciones al comprador y al dueño (AC-1/AC-2 trigger, AC-8 parcial)
---
```
```yaml
---
id: TC-011-004
scenario: N/A — sin superficie observable en este entorno (AC-4)
execution_mode: blocked
test_layer: 1
target_tooling: Postman
gherkin_scenario: N/A — reintento real ante fallo transitorio de Resend. Bloqueado por: sin cuenta Resend real (proposal.md OQ-3) ni hook de fault-injection (no existe un RESEND_BASE_URL override en este repo). Cubierto a nivel unit con cliente mockeado — tasks.md T6.1, exit criteria (b)(c)(e).
---
```
```yaml
---
id: TC-011-005
scenario: N/A — sin superficie observable en este entorno (AC-5)
execution_mode: blocked
test_layer: 1
target_tooling: Postman
gherkin_scenario: N/A — fallo persistente no revierte la orden + queda registrado. Bloqueado por: mismo motivo que TC-011-004. Cubierto a nivel unit — tasks.md T6.1, exit criteria (c)(d).
---
```
```yaml
---
id: TC-011-006
scenario: N/A — sin superficie observable en este entorno (AC-6, sub-caso "bajo reintento real")
execution_mode: blocked
test_layer: 1
target_tooling: Postman
gherkin_scenario: N/A — el sub-caso genérico de AC-6 (confirmación/stock no dependen del envío) SIGUE cubierto por SC-010-H1 (§4.5, automated); sólo el sub-caso "ni bajo el peor caso de latencia del reintento real (~16s)" es blocked — requiere cuenta Resend real + forzar un fallo transitorio real.
---
```

> **Nota sobre `target_tooling`**: se declara `Postman` por el mismo motivo
> que documentó `qa-plan.md` de US-021 §4 — la suite real es Cucumber-js +
> Playwright `request` (`qa/acceptance/`), y el catálogo cerrado de la skill
> no tiene un valor propio para eso; `Postman` es la etiqueta más cercana
> ("aserciones HTTP contra un contrato de API") y la discrepancia queda
> documentada acá en vez de inventar un noveno valor.

---

## 5. Contract testing — no aplica

Sin endpoint HTTP nuevo ni modificado (`proposal.md` "Out of scope": "Nuevos
endpoints HTTP — ninguno"). No hay YAML de contrato en
`openspec/changes/US-011-notificaciones-email-backend/contracts/` y
`tasks.md` "Verification" ya lo confirma explícitamente ("Sin endpoint nuevo
— no aplica contract test / OpenAPI lint para este change").

---

## 6. E2E cross-stack (Layer 3) — no aplica

`disciplines: [BE, QA]` en la US — sin `US-011-...-frontend-web`. No hay
Badge, pantalla ni interacción de usuario que verificar en un flujo
cross-stack; los tres disparadores (webhook, `simulate-payment`, `PATCH`
admin) ya se ejercitan en Layer 1 (§4). Si en el futuro se agrega una UI de
"reenviar notificación" o un indicador de estado de envío en el panel del
dueño, ese change abre su propio `qa-plan.md` de frontend — no se anticipa
acá.

---

## 7. Performance (k6) — decisión explícita: NO se arma suite nueva

Razonamiento:

1. **Los dos endpoints que esta US ralentiza ya tienen una decisión previa de
   NO llevar k6**: el `qa-plan.md` de US-010 ya declaró explícitamente "No se
   planifica k6 para el webhook literal ni para los 3 jobs admin" (mismo
   documento, sección Performance). Esta US no revierte esa decisión — sólo
   le agrega una latencia adicional acotada (`≈16s` peor caso, `design.md`
   Decisión 1) al mismo endpoint que ya estaba fuera de alcance de k6.
2. **Sin NFR cuantificado propio**: `design.md` marca el techo de latencia
   como `[propuesto — confirma Ops tras medir en staging]` — sin baseline
   real, fijar un threshold k6 ahora sería el anti-patrón de
   `nfr-quantification` ("p95 razonable — TBD").
3. **El endpoint que sí tiene NFR y k6 (`checkout`, `simulate-payment`) no
   toca esta US**: `notificarConfirmacion` corre después del commit de
   `ConfirmOrderService.confirm`, invocado por el webhook y por
   `simulate-payment` — ninguno de los dos scripts existentes
   (`qa/performance/simulate-payment.js`) mide más allá de la confirmación
   del pago en sí; no se les agrega una medición de notificaciones porque
   `LoggingNotificationAdapter` (§0) no reproduce la latencia real que
   importaría medir.

**Recomendación** (no bloquea este plan): cuando `RESEND_API_KEY` exista en
un entorno con métricas reales (`deployment-plan.md` de este change, si se
escribe uno, o el de un change de infraestructura posterior), medir el p95/p99
real del webhook/`PATCH` con el adapter real antes de decidir si esto necesita
su propio threshold k6 — nunca antes de tener esa medición.

---

## 8. Accesibilidad — no aplica

Sin superficie UI en este change.

---

## 9. Exploratory charters

Agregar a `qa/exploratory/charters.md`, sección nueva "US-011 — Notificaciones
por email":

1. **Charter: Contenido real del email, una vez exista una cuenta Resend de
   prueba** (gated por `proposal.md` OQ-3) — enviar los 4 tipos de aviso a una
   casilla de prueba real y confirmar visualmente: (a) ningún dato de pago;
   (b) el copy coincide con `design-system.md` §10.2 donde exista copy
   definido; (c) un `buyerName`/`productName` con caracteres HTML especiales
   (`<`, `&`, comillas) se ve como texto literal, no como markup roto; (d) la
   dirección de retiro es correcta y estática. Esta es la ÚNICA forma de
   cerrar de verdad el hueco de contenido que §0 documenta como no observable
   hoy.
2. **Charter: Latencia real del webhook bajo un fallo transitorio forzado**
   (gated por OQ-3) — con la cuenta de prueba, forzar un 429/5xx real (o un
   timeout de red) y medir el tiempo de respuesta real del webhook de
   MercadoPago con los 2 reintentos + backoff corriendo de verdad; confirmar
   que cae dentro del techo `≈16s` que `design.md` propone y que MercadoPago
   tolera esa demora sin marcar la entrega como fallida.
3. **Charter: Volumen hacia `OWNER_NOTIFICATION_EMAIL`** — con varias órdenes
   reales seguidas (usando `seed-ordenes.ts` a través del checkout real, no el
   puente directo), confirmar que todos los avisos al dueño llegan a la misma
   casilla sin que el propio límite de envío de la cuenta Resend los descarte
   silenciosamente — relevante porque, a diferencia del comprador, el dueño es
   un único destinatario que acumula el 100% del tráfico de `ownerNewOrder`.
4. **Charter: PII residual en logs no anticipados** — con centinelas
   (`buyerEmail` reconocible) en una orden, disparar los 4 tipos de aviso y
   revisar rutas de logging que el test dirigido (T4.1) no cubre: logs de
   error 5xx de Nest por defecto, trazas de excepción no manejada si el SDK de
   Resend lanza en vez de devolver `{ error }` (rama `catch` del adapter,
   `design.md` Approach). Mismo espíritu que el charter #3 de
   `US-021-retencion-datos-ordenes-backend/qa-plan.md`, adaptado a
   notificaciones.

---

## 10. Datos y fixtures

Sin fixtures nuevos: todos los escenarios de §4 reusan seeds ya construidos
para US-010/US-012 (`qa/support/seed-pending-payment-order.ts`,
`qa/support/mercadopago-signature.ts`, `qa/support/seed-ordenes.ts`) y el
mecanismo de observación ya existente (`qa/support/api-log.ts`). No hace
falta ningún builder nuevo — el único agregado real es el import de
`esperarAviso` en `ordenes.steps.ts` (§4.3), que no existe hoy en ese archivo.

**Nota sobre `crearOrdenEnEstado`/`puentearANew`**: el puente directo a
`status: 'new'` que usa `seed-ordenes.ts` (`prisma.order.update`, sin pasar
por `ConfirmOrderService.confirm`) **NO dispara `notificarConfirmacion`** —
verificado leyendo `puentearANew`. Ningún escenario de este plan usa ese
puente para llegar al estado desde el cual se dispara AC-1/AC-2: `SC-010-H2`/
`SC-010-N3`/`SC-010-N4` confirman el pago por el camino real (webhook o
`simulate-payment`), nunca por el puente. `H-4`/`C-2` sí pueden seguir usando
`crearOrdenEnEstado('ready', ...)` (que usa el puente sólo para
`pending_payment → new`, y el `PATCH` real para `new → ... → ready`) porque
AC-3 sólo depende de la transición `PATCH`, no de la confirmación de pago.

---

## 11. Coverage targets

| Componente | Target | Rationale |
|---|---|---|
| `notification-templates.ts`, `notification-backoff.ts` | Cobertura de línea alta en las ramas de escapado/clasificación (dev-owned, T3.1/T4.1) | Tier 2, pero primer archivo del repo con interpolación HTML externa — mismo criterio de rigor que security-sensitive |
| `resend-notification.adapter.ts` | Los 6 casos (a)-(f) del exit criterion de T6.1 (dev-owned) | Única superficie que ejercita reintento/fallo persistente controladamente |
| Acceptance (este plan) | 8/8 AC con al menos un tratamiento explícito automatizado o `blocked` documentado — 0 AC "cubierta" sin evidencia real | Tier 2, honestidad de cobertura por sobre completitud fabricada (mismo criterio que US-021) |

---

## 12. Quality gates

| Gate | Bloquea | Trigger |
|---|---|---|
| Acceptance BDD extendida (§4.2/§4.3, tag `@us-011`) | merge del PR de este change | todo PR que toque `orders/ports/*notification*` |
| Regresión completa `pago-webhook.feature` + `ordenes.feature` (no sólo `@us-011`) | merge del PR de este change | las 4 extensiones tocan archivos compartidos con US-010/US-012 — correr la suite completa de ambos, no sólo el subconjunto nuevo |
| Suite dev-owned completa (`jest --ci`, `tasks.md` "Verification") | merge | cada PR — T7.2 lo exige explícitamente por el wiring de DI compartido |
| Exploratory charters (§9) | primera promoción a producción CON `RESEND_API_KEY` real | gated por OQ-3, no por este change — ver `/plan-deployment` cuando exista |

---

## 13. Anti-patterns evitados

- ❌ `qa-three-layer-regression` ("Same scenario in Layer 1 twice") — se
  extendieron 4 escenarios existentes (`SC-010-N3`, `SC-010-N4`, `H-4`, `C-2`)
  en vez de duplicarlos con un `Given`/`When` idéntico (§4.1).
- ❌ `qa-backend-standards.md` §2.1 ("QA writes all the tests") — unit/
  integration de payload/plantillas/backoff/adapter son dev-owned (§1.1).
- ❌ `flakiness-detection` Signal 6 ("Real network calls in tests" — Critical)
  — se rechazó explícitamente forzar un 401 real contra `api.resend.com` como
  parte de la suite automatizada (§0, "Alternativa considerada y rechazada").
- ❌ `nfr-quantification` ("p95 razonable — TBD") — se decide explícitamente
  NO fijar un threshold k6 sin baseline (§7).
- ❌ Fingir cobertura de un AC sin superficie real — AC-4/AC-5 y el sub-caso
  de AC-6 se marcan `execution_mode: blocked` con la razón exacta y qué los
  desbloquea, en vez de declarar "cubierto" algo que `LoggingNotificationAdapter`
  no puede ejercitar (§0, §4.6).
- ❌ `bdd-scenario-quality` ("implementation leakage") — ningún `Then` nuevo
  asserta sobre el SDK de Resend o el mecanismo de backoff; todos observan la
  línea de log del puerto (comportamiento observable), igual que los 4
  escenarios que se extienden.
- ❌ "Test con datos de producción" — todo dato es sintético, vía los seeds
  ya existentes de checkout/webhook real (§10).

---

## 14. Preguntas abiertas

1. **OQ-QA-011-1**: cuando `proposal.md` OQ-3 se resuelva (cuenta Resend real
   provisionada), ¿quién ejecuta los charters #1/#2 de §9 — QA de este mismo
   change, o un gate explícito de `/plan-deployment`? Este plan no lo decide;
   recomienda que `/plan-deployment US-011` (si se escribe) lo declare como
   pre-condición de la primera promoción con `RESEND_API_KEY` real seteada.
2. **OQ-QA-011-2**: TC-011-004/005/006 (`blocked`) — ¿vale la pena, como
   fast-follow, agregar un hook de fault-injection (p.ej. un
   `RESEND_BASE_URL` configurable apuntando a un servidor HTTP local de
   prueba) para poder cerrar AC-4/AC-5 a nivel aceptación sin depender de una
   cuenta real? No se construye en este plan (es una decisión de código, no
   de QA) — se deja trazable para quien priorice el fast-follow.

---

## 15. Dependencias declaradas

| Dependencia | Estado | Efecto |
|---|---|---|
| US-010 backend (`NotificationPort`, `ConfirmOrderService`, webhook) | Mergeado a `main` | Resuelto — necesario para `SC-010-H2`/`N3`/`N4` |
| US-012 backend (`OrdersAdminService.changeStatus`, `PATCH` admin) | Mergeado a `main` | Resuelto — necesario para `H-4`/`C-2` |
| US-011 backend (este change) | **Draft, 0/N tasks** | Bloquea todo — este plan no puede ejecutarse hasta que `tasks.md` aterrice (en particular T7.1/T7.2, el wiring de DI) |
| Cuenta Resend real + dominio verificado (OQ-3 de `proposal.md`) | No provisionada | Bloquea únicamente los charters de §9 — el resto de este plan corre igual sin ella (§0) |

---

## 16. Standards consultados

- `docs/base-standards.md` — YAGNI, vocabulario.
- `docs/quality/testing-standards.md` §2 (pirámide), §5 (test data), §14.9
  (negative-space).
- `docs/quality/qa-backend-standards.md` §2.1 (ownership matrix), §13.2/13.3
  (cuándo aplica performance — usado para justificar la ausencia de k6),
  §21.1/21.4 (cuándo BDD, tense imperativo/declarativo).
- `docs/product/design-e2e.md` §6.1, §9.2, §9.4, §18 (mismas secciones que
  `design.md` de este change ya cita para Decisión 1).
- Skill `qa-three-layer-regression` — Layer 1 vive en el change de backend;
  regla de no-duplicación aplicada en §4.1; frontmatter de test-case (§4.6).
- Skill `bdd-scenario-quality` — verificado tense imperativo/declarativo en
  las 2 líneas nuevas de Gherkin de §4.2; sin `Scenario Outline` (nada que
  parametrizar acá).
- Skill `flakiness-detection` — Signal 6 usado para rechazar la llamada de
  red real a Resend como parte de la suite automatizada (§0).
- Skill `nfr-quantification` — razonamiento explícito para NO fijar un
  threshold k6 sin baseline (§7).
- Precedentes: `openspec/changes/archive/US-008-checkout-guest-backend/qa-plan.md`
  (formato, manejo de un gap en el momento de escribir el plan) y
  `openspec/changes/archive/US-021-retencion-datos-ordenes-backend/qa-plan.md`
  (formato Mode A §0, frontmatter `blocked`/`manual`, honestidad de cobertura
  por sobre completitud fabricada).

---

## 17. Referencias

- User story: `docs/user-stories/US-011-notificaciones-email.md`
- `proposal.md`, `tasks.md`, `design.md` de este mismo change.
- `apps/api/src/orders/ports/notification.port.ts`
- `apps/api/src/orders/ports/logging-notification.adapter.ts`
- `apps/api/src/payments/confirm-order.service.ts`
- `apps/api/src/orders/orders-admin.service.ts`
- `qa/support/api-log.ts` (`esperarAviso`/`leerLogApi`)
- `qa/acceptance/features/pago-webhook.feature` +
  `qa/acceptance/steps/pago-webhook.steps.ts`
- `qa/acceptance/features/ordenes.feature` +
  `qa/acceptance/steps/ordenes.steps.ts`
- `openspec/changes/archive/US-010-orden-webhook-stock-qa/qa-plan.md`
- `openspec/changes/archive/US-012-panel-ordenes-dueno-qa/qa-plan.md` (§4,
  TC-1204/TC-1207 — dueño original de `H-4`/`C-2`, con la nota explícita de
  que el envío en sí queda para US-011 — verificado también contra el código
  real de `qa/acceptance/`)
