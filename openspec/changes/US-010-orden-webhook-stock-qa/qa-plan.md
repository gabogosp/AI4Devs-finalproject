---
parent-us: US-010
discipline: qa
language: es
---

# US-010 — Plan de QA (capas QA-owned)

> **Service tier**: 1 (derivado — no hay `service-catalog.yaml` en el repo). Mismo
> criterio y misma conclusión que `US-023-pago-manual-offline-backend/qa-plan.md` §1: esta
> capacidad (`pagos`) es el núcleo transaccional del producto — dinero + inventario en la
> misma transacción. Se registra la derivación explícitamente (regla de tier-resolution:
> catálogo ausente → derivar de `proposal.md`/US), no se asume en silencio.

## 1. Perfil de riesgo

| Componente | Clasificación | Por qué |
|---|---|---|
| `POST /v1/webhooks/mercadopago` | **CRÍTICO** | Verificación de firma es la primera línea de defensa de dinero entrante; un bypass confirma órdenes sin que nadie haya pagado. |
| Guard de idempotencia (`orders.status='pending_payment'` + `payments.idempotency_key`) | **CRÍTICO** | AC-5/AC-6 dependen enteramente de esto — un fallo es doble decremento de stock o doble pago, no un bug cosmético. |
| Compensación AC-4 (auto-cancelación + reembolso) | **CRÍTICO** | Es dinero cobrado sin poder cumplirse; un reembolso que se pierde es plata de un cliente perdida en silencio. |
| `POST /v1/checkout/simulate-payment` | Alto | Superficie pública (aunque gateada por flag) que ejercita el mismo camino transaccional que el dinero real — un bug acá es indistinguible de un bug en el camino real. |
| Los 3 jobs admin (reconciliar/limpiar/reintentar) | Alto | Son la red de seguridad para cuando el webhook falla — si ellos también fallan, no hay ningún mecanismo de recuperación. |
| Decremento atómico bajo concurrencia (`stock.decrementForOrder`, US-023, reusado) | **CRÍTICO** | Ya probado dev-owned con Postgres real (`e2e-payments-concurrency.spec.ts`); este plan lo verifica desde afuera, black-box. |

**Journeys críticas identificadas**:

1. Un comprador paga (real o simulado) → la orden se confirma → el stock decrementa
   exactamente una vez → el dueño ve la venta en su panel (AC-1, AC-2, AC-9).
2. Un pago se cobra pero no se puede cumplir → se cancela → se reembolsa sin perderse
   (AC-4).
3. Ningún webhook falso, duplicado, tardío o concurrente produce un efecto que no
   corresponda al pago real (AC-3, AC-5, AC-6, AC-7, AC-8).
4. Si el webhook nunca llega o la orden queda abandonada, hay una vía de recuperación
   administrada (AC-10, AC-11).

## 2. Mapeo de la pirámide de test (capas QA-owned en negrita)

| Capa | Dueño | Estado | Herramienta |
|---|---|---|---|
| Unit (`webhook-signature`, `backoff`, `mercadopago-client`, errores de dominio) | Dev (TDD) | **Hecho** — `tasks.md` Fase 1-4, 12 | Jest |
| Integration (`confirm-order.service` ampliado, repos, Postgres real) | Dev (TDD) | **Hecho** — Fase 2, 5 | Jest + Postgres real |
| e2e-nest (contrato HTTP: webhook, simulate-payment, 3 admin jobs) | Dev (TDD) | **Hecho** — Fase 6, 7, 9, 10, 11 | Jest + supertest + Postgres real |
| Integración cross-cutting (happy, stock insuficiente, duplicado, concurrencia, paridad simulado) | Dev (TDD) | **Hecho** — Fase 14 (5 specs) | Jest + Postgres real (Testcontainers) |
| **Aceptación BDD (Layer 1, backend-aislado, persistente)** | **QA** | Este plan | Cucumber-js + Playwright `APIRequestContext` |
| **Contract testing** | **QA** | Este plan | Script `tsx` contra el OpenAPI vivo |
| **Performance (k6)** | **QA + Dev** | Este plan | k6 |
| **E2E cross-stack (Layer 3)** | **QA** | Este plan | Playwright |
| **Exploratorio** | **QA** | Este plan | Charters manuales |
| Accesibilidad / regresión visual | N/A en este change | Backend puro; las 2 pantallas del escenario cross-stack ya tienen cobertura a11y propia en US-008/US-012 QA | — |

> **Nota de cobertura dev-owned (awareness, no se re-autora)**: `tasks.md` Fase 14 ya
> prueba, contra Postgres real, el camino feliz (T14.1), stock insuficiente con reembolso
> (T14.2), duplicado y fuera de orden (T14.3), concurrencia real con `Promise.allSettled`
> sobre la última unidad de stock (T14.4), y la paridad byte-a-byte entre el webhook y el
> medio simulado (T14.5). Este plan **no duplica** esos specs; construye la capa de
> aceptación **persistente** (per skill `qa-three-layer-regression`) y las capas que
> `tasks.md` no cubre por diseño (contract testing formal, k6, exploratorio, E2E
> cross-stack) — mismo criterio ya aplicado por `US-023-pago-manual-offline-backend/qa-plan.md`
> §2 para la misma capacidad.

## 3. Matriz de trazabilidad AC → escenarios (autocheck F47)

`Q` = ejecutable hoy por este plan · `B` = **bloqueado** (necesita cuenta sandbox de
MercadoPago, ver `design.md` §D-QA1) · `X` = cross-feature (Layer 3).

| AC | Título | Escenario(s) | Capa | Estado |
|---|---|---|---|---|
| AC-1 | Pago aprobado confirma y decrementa stock | `SC-010-H1`, `SC-010-X1` | 1 / 3 | Q |
| AC-2 | La confirmación dispara notificaciones | `SC-010-H2` | 1 | Q |
| AC-3 | Pago rechazado no confirma ni toca stock | `SC-010-N2` | 1 | **B** — ver hallazgo QA-010-F1 |
| AC-4 | Aprobado sin stock → reembolso | `SC-010-N3`, `SC-010-N6`, `SC-010-X2` | 1 / 3 | Q (mecánica); reintento real **B** |
| AC-5 | Duplicado no decrementa dos veces | `SC-010-C1`, `SC-010-N4` | 1 | Q |
| AC-6 | Tardío o fuera de orden | `SC-010-C1` | 1 | Q (delivery-order-agnóstico por diseño, ver §5) |
| AC-7 | Webhook no verificado se rechaza | `SC-010-N1` | 1 | Q |
| AC-8 | El stock nunca queda negativo | `SC-010-C2` | 1 | Q |
| AC-9 | El medio simulado pasa por el mismo camino | `SC-010-H1`, `SC-010-N5`, `SC-010-X1` | 1 / 3 | Q |
| AC-10 | Reconciliación de webhook faltante | `SC-010-C4` | 1 | Q (mecánica); recuperación real **B** |
| AC-11 | Limpieza de abandonadas | `SC-010-C3` | 1 | Q |

Todos los IDs citados arriba (`SC-010-H1/H2`, `SC-010-C1/C2/C3/C4`, `SC-010-N1/N2/N3/N4/N5/N6`,
`SC-010-X1/X2`) están definidos en el `Feature:` de §4. No hay referencias colgantes.

## 4. Escenarios BDD (Gherkin)

```gherkin
# language: es
@pagos @us-010
Característica: Webhook de MercadoPago, medio simulado y decremento de stock (US-010)
  Como sistema
  quiero confirmar la orden al recibir un pago aprobado y verificado, y decrementar el stock de forma atómica e idempotente
  para registrar la venta correctamente con el stock como única fuente de verdad, sin sobrevender ni doble-procesar

  Antecedentes:
    Dado un catálogo sembrado con productos disponibles
    Y un comprador que completó el checkout dejando una orden real en estado "pending_payment"

  # ─── HAPPY PATH ───

  @happy @critical-path
  Escenario: SC-010-H1 — El medio simulado confirma la orden y decrementa el stock (AC-1, AC-9)
    Cuando se confirma el pago de esa orden por el medio simulado "DSM"
    Entonces recibo 200 con la orden confirmada
    Y el stock de cada producto de la orden queda decrementado exactamente en la cantidad pedida
    Y queda registrado un pago aprobado para esa orden

  @happy
  Escenario: SC-010-H2 — La confirmación dispara las notificaciones al comprador y al dueño (AC-2)
    Cuando se confirma el pago de esa orden por el medio simulado "DSM"
    Entonces el puerto de notificaciones recibe exactamente un aviso de confirmación para el comprador
    Y exactamente un aviso de orden nueva para el dueño
    Y ninguno de los dos avisos revela el email del comprador en el registro observable

  # ─── CORNER (concurrencia, límites, mecánica de recuperación) ───

  @corner @critical-path
  Escenario: SC-010-C1 — Dos confirmaciones simultáneas sobre la misma orden nunca decrementan el stock dos veces (AC-5, AC-6)
    Cuando se disparan dos confirmaciones simultáneas para esa orden
    Entonces exactamente una responde con éxito
    Y la otra es rechazada por el estado ya no pendiente
    Y el stock del producto se decrementó una sola vez

  @corner @critical-path
  Escenario: SC-010-C2 — Confirmaciones concurrentes compiten por la última unidad de stock (AC-8)
    Dado un producto con exactamente una unidad de stock, pedido por varias órdenes distintas
    Cuando se disparan confirmaciones simultáneas para todas esas órdenes
    Entonces exactamente una confirma con éxito
    Y el stock del producto termina en cero, nunca por debajo de cero

  @corner
  Esquema del escenario: SC-010-C3 — La limpieza de abandonadas respeta el corte de antigüedad (AC-11)
    Dado una orden "pending_payment" creada hace "<antigüedad>"
    Cuando corre el job de limpieza de abandonadas
    Entonces la orden queda "<resultado>"

    Ejemplos:
      | antigüedad | resultado                                            |
      | 49 horas   | cancelada, y deja de aparecer en la cola operativa   |
      | 47 horas   | intacta en pending_payment                           |

  @corner
  Escenario: SC-010-C4 — La reconciliación sin pagos elegibles no toca nada (AC-10, mecánica)
    Dado que ninguna orden "pending_payment" supera la antigüedad mínima de reconciliación
    Cuando corre el job de reconciliación
    Entonces responde con un resumen de cero órdenes escaneadas y confirmadas
    Y ninguna orden ni pago cambia de estado

  # ─── NEGATIVE SPACE ───

  @negative @critical-path
  Esquema del escenario: SC-010-N1 — Un webhook sin firma verificable se rechaza sin ninguna escritura (AC-7)
    Cuando llega un webhook "<variante de firma>" para esa orden
    Entonces recibo 401
    Y la orden permanece "pending_payment"
    Y el stock no se ve afectado

    Ejemplos:
      | variante de firma                               |
      | con formato correcto pero secreto equivocado    |
      | con el header de firma ausente                  |
      | con el ts fuera de la ventana de tolerancia      |

  @negative @blocked
  Escenario: SC-010-N2 — Un pago rechazado no confirma la orden ni toca el stock (AC-3)
    Cuando llega el webhook de un pago rechazado en MercadoPago para esa orden
    Entonces la orden NO se confirma
    Y el stock no se ve afectado
  # BLOQUEADO (ver `design.md` §D-QA1 y hallazgo QA-010-F1 §12): necesita que
  # MercadoPago responda `rejected` de verdad — sin cuenta sandbox no es ejecutable
  # black-box. La rama de negocio ya está probada dev-owned
  # (`confirm-order.service.spec.ts`, sin cambios por este change).

  @negative @critical-path
  Escenario: SC-010-N3 — Aprobado sin stock suficiente: la orden se cancela y el reembolso no se pierde (AC-4)
    Dado que el stock de un producto de la orden bajó por debajo de lo pedido después del checkout
    Cuando se confirma el pago de esa orden por el medio simulado "DSM"
    Entonces recibo el rechazo por auto-cancelación por falta de stock
    Y la orden queda "cancelled"
    Y el pago queda reembolsado
    Y el stock del producto no decrementó

  @negative @critical-path
  Escenario: SC-010-N4 — Repetir la confirmación de una orden ya confirmada no duplica efectos (AC-5)
    Dado que la orden ya fue confirmada por el medio simulado "DSM"
    Cuando se repite la confirmación de esa misma orden
    Entonces recibo el rechazo por estado ya no pendiente
    Y el stock no se decrementa una segunda vez
    Y sigue existiendo exactamente un pago registrado para esa orden

  @negative
  Esquema del escenario: SC-010-N5 — El medio simulado rechaza lo que no debe confirmar (AC-9, control de superficie)
    Cuando "<condición>"
    Entonces recibo 404
    Y la orden permanece sin cambios

    Ejemplos:
      | condición                                          |
      | el flag del medio simulado está apagado            |
      | el order_token no corresponde a ninguna orden real |

  @negative
  Escenario: SC-010-N6 — El reintento de reembolsos sin pagos elegibles no falla y no toca nada (AC-4, durabilidad — mecánica)
    Dado que ningún pago está en "refund_pending" para el proveedor MercadoPago
    Cuando corre el job de reintento de reembolsos
    Entonces responde con un resumen de cero pagos intentados
  # La recuperación real de un reembolso fallido contra MercadoPago queda bloqueada
  # (ver `design.md` §D-QA1); el camino ya está probado dev-owned con el cliente
  # mockeado (`confirm-order.service.provider.spec.ts`).

  # ─── CROSS-FEATURE (Layer 3) ───

  @cross-feature @critical-path
  Escenario: SC-010-X1 — Loop completo: el comprador paga con el medio simulado y el dueño ve la orden nueva (AC-1, AC-9)
    Dado que el comprador completó el checkout desde el sitio real, con el carrito y los datos propios
    Cuando el pago de esa orden se confirma por el medio simulado "DSM"
    Y el dueño abre su panel de órdenes
    Entonces la orden aparece en la cola operativa como "nueva"
    Y el stock del producto comprado refleja el decremento en el catálogo del dueño

  @cross-feature
  Escenario: SC-010-X2 — Una orden auto-cancelada por falta de stock nunca aparece accionable para el dueño (AC-4)
    Dado que el pago de una orden se auto-canceló por falta de stock al confirmarse
    Cuando el dueño abre su panel de órdenes
    Entonces esa orden no aparece en la cola operativa
```

**Tooling**: Cucumber-js con `qa/acceptance/steps/pago-webhook.steps.ts` (H1-N6) contra
Playwright `APIRequestContext`, mismo patrón que `pago-manual.steps.ts`; X1/X2 en
Playwright puro (`qa/e2e/pago-webhook-cross-stack.spec.ts`) por cruzar dos UIs (checkout +
panel).
**Location**: `qa/acceptance/features/pago-webhook.feature` (H1-N6),
`qa/e2e/pago-webhook-cross-stack.spec.ts` (X1/X2).
**Test layer**: 1 (backend-aislado) para `SC-010-H1/H2/C1/C2/C3/C4/N1/N3/N4/N5/N6`. `SC-010-N2`
es Layer 1 pero `@blocked` — no corre en CI hasta que exista la cuenta sandbox (per
`bdd-scenario-quality`: `@wip`/`@blocked` nunca se cuela verde; se etiqueta y se excluye
explícitamente del tag de ejecución). `SC-010-X1`/`SC-010-X2` son Layer 3.

## 5. Stubs de casos de prueba

| id | execution_mode | test_layer | target_tooling | gherkin_scenario |
|---|---|---|---|---|
| QA-010-ACC-1 | automated | 1 | Cucumber-js + Playwright `APIRequestContext` | pago-webhook.feature — SC-010-H1, H2, C1, C2, C3, C4, N1, N3, N4, N5, N6 (13 escenarios ejecutables) |
| QA-010-ACC-2 | **manual** | 1 | — (checklist, sin scaffold) | SC-010-N2 — bloqueado, ver `design.md` §D-QA1 y hallazgo QA-010-F1 |
| QA-010-CT-1 | automated | 1 | Script `tsx` (`fetch`, sin jest) | N/A (contract test, no BDD) — los 5 endpoints nuevos de esta US |
| QA-010-PERF-1 | automated | 1 | K6 | N/A (performance, no BDD) — `POST /v1/checkout/simulate-payment`, p95 < 200ms |
| QA-010-E2E-1 | automated | 3 | Playwright | SC-010-X1 — Loop completo checkout real → medio simulado → panel del dueño |
| QA-010-E2E-2 | automated | 3 | Playwright | SC-010-X2 — Auto-cancelada nunca accionable para el dueño |
| QA-010-EXP-1 | **manual** | — | Charter | Ventana de tolerancia de la firma, batch de reconciliación, breaker durante retry-refunds |

Nota sobre AC-6 (SC-010-C1): la reordenación de entrega ("tardío o fuera de orden") es,
por diseño del backend (idempotencia por guard de `orders.status`, no por secuencia de
llegada — `design.md` de backend §D3), **agnóstica al orden de llegada**. Dos llamadas
concurrentes ejercitan la misma garantía que dos llamadas en cualquier orden temporal;
no se agrega un escenario separado que sólo cambiaría el *orden* de las mismas dos
llamadas sin ejercitar ningún camino de código distinto.

## 6. Contract testing

- [x] **QA-010-CT-1**: contract test (`tsx`, mismo patrón que `pago-manual.contract.ts`)
  para los 5 endpoints nuevos contra `openspec/specs/pagos/contracts/openapi.yaml` +
  `openapi/paths/{webhook-mercadopago,simulate-payment,reconcile-payments,cleanup-abandoned-orders,retry-refunds}.yaml`
  (el contrato **vivo**, no el draft ya archivado del change de backend).

  ```yaml
  id: QA-010-CT-1
  execution_mode: automated
  test_layer: 1
  target_tooling: Script tsx (fetch, sin jest)
  gherkin_scenario: N/A (contract test, no BDD)
  ```

  - Exit criterion: `POST /v1/webhooks/mercadopago` con firma inválida responde 401
    `application/problem+json` con `type: dsm:payments/webhook-unverified`; `POST
    /v1/checkout/simulate-payment` responde 200 con `PaymentConfirmed`
    (`order_number`, `status`), 404 (flag apagado / token inexistente), 422 (formato
    inválido), 429 (rate limit); los 3 endpoints admin responden 401 sin token, 403 con
    token no-admin, y 200 con la forma de resumen declarada (`scanned/confirmed/stillPending`,
    `cancelled`, `attempted/succeeded/failed` respectivamente) — sin propiedades extra.
  - Verify: `QA_API_BASE_URL=http://localhost:3009 MP_WEBHOOK_SECRET=<mismo valor de la API> ADMIN_BOOTSTRAP_TOKEN=<mismo valor de la API> pnpm --filter @dsm/qa test:contract:pago-webhook`

## 7. Performance (k6)

- [x] **QA-010-PERF-1**: `qa/performance/simulate-payment.js` — target p95 < 200ms
  (`design.md` de backend §D12, propuesto — confirma Ops), heredado sin inventar un
  número nuevo.

  ```yaml
  id: QA-010-PERF-1
  execution_mode: automated
  test_layer: 1
  target_tooling: K6
  gherkin_scenario: N/A (performance, no BDD)
  ```

  - Exit criterion: `setup()` pre-siembra N órdenes `pending_payment` reales (vía
    checkout real, mismo contrato que `seedPendingPaymentOrder`) — una por iteración,
    nunca la misma orden dos veces (confirmar una ya confirmada mide el camino 409, no
    el feliz). Executor `shared-iterations` con `iterations: POOL` (mismo patrón que
    `confirm-payment.js`/`auth-login.js` — un recurso finito pre-sembrado es
    incompatible con `vus`+`duration` abiertos). `check()` valida `status === 200` y
    `body.status` presente, gateado por `checks: ['rate>0.99']`.
  - Verify: `QA_API_BASE_URL=http://localhost:3009 k6 run qa/performance/simulate-payment.js --summary-trend-stats="p(95)"`

- [x] **QA-010-PERF-2**: threshold agregado a la fuente única `qa/performance/lib/thresholds.js`.

  ```yaml
  id: QA-010-PERF-2
  execution_mode: automated
  test_layer: 1
  target_tooling: K6
  gherkin_scenario: N/A (performance, no BDD)
  ```

  - Exit criterion: `thresholds.js` exporta `simulate_payment` con
    `'http_req_duration{endpoint:simulate_payment}': ['p(95)<200']`.
  - Verify: `grep -q "simulate_payment" qa/performance/lib/thresholds.js && grep -q "p(95)<200" qa/performance/lib/thresholds.js`

> **No se planifica k6 para el webhook literal ni para los 3 jobs admin** (mismo criterio
> ya aplicado por `QA-023-PERF-*`): el webhook necesita MercadoPago real (§D-QA1, bloqueado);
> los jobs admin son superficie de bajo volumen, un solo operador.

## 8. E2E cross-stack (Layer 3)

- [ ] **QA-010-E2E-1**: `qa/e2e/pago-webhook-cross-stack.spec.ts` — SC-010-X1.

  ```yaml
  id: QA-010-E2E-1
  scenario: SC-010-X1
  execution_mode: automated
  test_layer: 3
  target_tooling: Playwright
  gherkin_scenario: SC-010-X1 — Loop completo checkout real → medio simulado → panel del dueño
  ```

  - Exit criterion: checkout real por la UI (`CheckoutForm`) hasta el submit; se
    intercepta `POST /v1/checkout` con `page.waitForResponse(...)` para obtener
    `order_token` (no se renderiza en el DOM, es correcto que no lo haga — se extrae de
    la respuesta de red, nunca del código de la app); se confirma el pago vía
    `simulate-payment` por `APIRequestContext` (no existe botón FE para esto, ver
    `design.md` §D-QA8); se navega a `/admin/ordenes` y se verifica que la orden aparece
    como "nueva" y que el stock del catálogo del dueño refleja el decremento.
  - Verify: `pnpm --filter @dsm/qa test:e2e -- --grep "SC-010-X1" --reporter=line`

- [ ] **QA-010-E2E-2**: mismo archivo — SC-010-X2.

  ```yaml
  id: QA-010-E2E-2
  scenario: SC-010-X2
  execution_mode: automated
  test_layer: 3
  target_tooling: Playwright
  gherkin_scenario: SC-010-X2 — Auto-cancelada nunca accionable para el dueño
  ```

  - Exit criterion: una orden cuyo pago se auto-canceló por falta de stock (mismo
    fixture que `SC-010-N3`) nunca aparece en `/admin/ordenes` (que, per la AC-8 de
    US-012, excluye `cancelled`/`pending_payment` del listado por diseño — este
    escenario verifica esa exclusión desde el lado de datos reales que US-010 produce,
    no repite la cobertura de US-012 sobre datos sembrados directo).
  - Verify: `pnpm --filter @dsm/qa test:e2e -- --grep "SC-010-X2" --reporter=line`

**Reuses**: `qa/support/seed-pending-payment-order.ts` (US-023, sin modificar),
`qa/support/admin-auth.ts`, `qa/support/cart-client.ts`/builders de `carrito.spec.ts`
para el checkout por UI.

## 9. Datos y fixtures

### Helpers nuevos requeridos

- **`qa/support/mercadopago-signature.ts`**: replica pura (sin importar código de
  `apps/api/`) del algoritmo de `webhook-signature.ts` — construye headers `x-signature`/
  `x-request-id` válidos o deliberadamente inválidos (secreto equivocado, formato
  malformado, `ts` fuera de ventana), per `design.md` §D-QA4.
- **`qa/support/backdate-order.ts`**: `prisma.order.update({ where: { id }, data:
  { created_at } })` vía `@dsm/db` — excepción angosta, sólo para alcanzar la
  precondición de antigüedad de `SC-010-C3`/`SC-010-C4`, per `design.md` §D-QA5. Nunca
  para sembrar el resto de la suite ni para simular el efecto que el escenario prueba.

### Reuso existente (sin modificar)

- `qa/support/seed-pending-payment-order.ts` (US-023) — orden `pending_payment` real vía
  checkout real, con el `id` interno resuelto vía `GET /pending-payment` (dogfooding).
- `qa/support/admin-auth.ts`, `qa/support/api.ts`, `qa/support/cart-client.ts`.

### Estrategia de datos (per `testing-standards.md` §5)

- 100% sintético — ningún dato de producción.
- Defaults determinísticos en los builders existentes; ningún `Math.random()`/`Date.now()`
  salvo IDs opacos que el propio sistema genera.
- Cada escenario siembra su propia orden — nunca reusa la de otro escenario (evita
  colisiones de `idempotency_key` entre tests en paralelo, mismo criterio que
  `QA-023-ACC-1`).

## 10. Exploratory charters

Agregar a `qa/exploratory/us-010-pagos-webhook.md`:

1. **Charter: ventana de tolerancia de la firma** — reproducir un webhook firmado
   correctamente pero con `ts` apenas dentro/fuera del límite de 300s, y explorar qué ve
   un operador en logs cuando el rechazo ocurre por ventana vs por secreto equivocado —
   ¿el mensaje distingue los dos casos de forma útil para debugging sin filtrar el
   secreto?
2. **Charter: reconciliación con muchas órdenes elegibles a la vez** — sembrar más
   órdenes `pending_payment` viejas que `RECONCILE_BATCH_SIZE` (50) y explorar el
   comportamiento del corte — ¿el resumen (`scanned/confirmed/stillPending`) comunica
   con claridad que quedó trabajo pendiente para la próxima corrida?
3. **Charter: comportamiento del circuit-breaker durante `retry-refunds`** — simular
   varios fallos consecutivos del cliente de MercadoPago (mockeando a nivel de red local,
   sin cuenta real) durante una corrida con varios pagos `refund_pending` y observar si
   el breaker abierto deja el resto del batch en un estado claro (todos `refund_pending`,
   ninguno marcado erróneamente) o si el mensaje de resumen confunde "no reintentado
   por el breaker" con "reintentado y fallido".

## 11. Quality gates

| Gate | Bloquea | Disparador |
|---|---|---|
| Contract (`QA-010-CT-1`) | merge | todo PR que toque `apps/api/src/payments/` |
| Aceptación BDD (`QA-010-ACC-1`) | merge | todo PR que toque `apps/api/src/payments/` o `apps/api/src/checkout/orders.repository.ts` |
| k6 p95 < 200ms (`QA-010-PERF-1`) | release | pre-release |
| E2E cross-stack (`QA-010-E2E-1`, `QA-010-E2E-2`) | uat promotion | pre-uat |
| `SC-010-N2` (AC-3, bloqueado) | — | no gatea nada hasta que exista cuenta sandbox de MercadoPago |

## 12. Anti-patterns evitados

- ❌ `qa-backend-standards.md` §2.1 ("QA writes all the tests"): unit/integration/e2e-nest
  de `tasks.md` son dev-owned y no se re-autoran acá (§2).
- ❌ `testing-standards.md` §14.9 (negative-space ausente): 6 de las 7 AC negative-space
  de la US quedan con al menos un escenario ejecutable; la séptima (AC-3) queda declarada
  `blocked` en vez de simulada con un doble no autorizado (ver hallazgo abajo).
- ❌ Simular una respuesta de MercadoPago con un doble no documentado por el propio
  diseño del backend: se prefiere declarar `SC-010-N2` `blocked` antes que escribir un
  test que miente sobre qué verificó (mismo criterio que `US-023-pago-manual-offline-backend/qa-plan.md`
  §7 ya aplicó a su propio bloqueo — declarar explícito en vez de maquillar).
- ❌ `flakiness-detection` — señal 5 (order dependencies): `SC-010-C1`/`SC-010-C2` usan
  llamadas concurrentes reales (`Promise.all`/paralelo real), nunca `sleep`/timing
  artificial para simular la carrera.
- ❌ `k6-load-scaffolding` ("sin thresholds" / "sólo promedios"): `QA-010-PERF-1`
  declara `thresholds` con percentil (p95), nunca sólo `avg`, con `checks` gateado.
- ❌ `bdd-scenario-quality` (`@wip` colándose verde): `SC-010-N2` está `@blocked` y
  explícitamente excluido del tag que corre en CI (§4/§6, "no corre en CI hasta que
  exista la cuenta sandbox").

## 13. Preguntas abiertas / hallazgos

1. **QA-010-F1 (hallazgo, no sólo pregunta)**: `MercadoPagoClient` se registra en
   `payments.module.ts` con una factory que sólo inyecta `ConfigService` — el `baseUrl`
   real (`https://api.mercadopago.com`) no es configurable por variable de entorno desde
   afuera del proceso. Consecuencia: **ningún test black-box puede hacer que el webhook
   real, la reconciliación real o el reintento de reembolsos real vean una respuesta
   distinta de la de MercadoPago genuino** — sin cuenta sandbox, esas tres superficies
   (AC-3 completo, la recuperación real de AC-10, el reintento real de AC-4) quedan
   `blocked`. El PRD §2.1 (fila "Pagos") ya declara que MercadoPago "soporta el modo
   sandbox/test... para pruebas" — la vía de desbloqueo más barata es provisionar esa
   cuenta, no tocar código. Alternativa (más código, más barata en tiempo de espera):
   un change de backend chico y aditivo que lea `MP_BASE_URL` de env en la factory de
   `payments.module.ts`. Ninguna de las dos vías la ejecuta este plan (excede su
   alcance — no toca `apps/api/src/`). **Owner sugerido**: PO/Infra para la cuenta
   sandbox; quien retome `US-009-pago-mercadopago-backend` si se prefiere la vía de
   código.
2. **OQ-QA-010-1**: ¿cuándo se provisiona la cuenta sandbox? No lo decide este plan —
   ver `proposal.md` §Preguntas abiertas.
3. **OQ-QA-010-2/3**: resueltas en `proposal.md` (reuso del seed de US-023 sin
   modificarlo; backdate vía Prisma para las precondiciones de antigüedad).

## 14. Dependencias declaradas

| Dependencia | Estado | Efecto |
|---|---|---|
| `US-010-orden-webhook-stock-backend` | **Archivado** (PR #49, 42/42 tasks, 200/200 suites verdes) | Desbloquea todo §4-§10 salvo lo declarado `blocked` |
| `US-023-pago-manual-offline-backend` | Mergeado | El seed reusado (`seed-pending-payment-order.ts`) y los helpers del harness (`admin-auth.ts`, `api.ts`) ya existen |
| `US-012-panel-ordenes-dueno-frontend-web` | Mergeado (PR #22) | Desbloquea `SC-010-X1`/`SC-010-X2` (panel del dueño con `OrdersList`, ya construido — a diferencia del bloqueo que sí tuvo `US-023-*-qa` con `PendingPaymentsPanel`) |
| `US-008-checkout-guest-frontend-web` | Mergeado | Desbloquea el tramo de checkout por UI de `SC-010-X1` |
| Cuenta sandbox de MercadoPago | **No existe en este entorno** | Bloquea `SC-010-N2` (AC-3) y la recuperación real de AC-10/AC-4 — ver hallazgo QA-010-F1 |

**Linear MCP**: no conectado en esta sesión — sin sub-task de tracker que anotar. Per
`tracker-handoff` §2.4, se deja constancia acá en vez de omitirlo en silencio.

## 15. Standards consultados

- `docs/base-standards.md`
- `docs/quality/testing-standards.md` §2 (pirámide), §4.1 (naming), §5 (datos de test),
  §8 (coverage), §14 (patrones de código de test), §14.9 (negative space), §18
  (anti-patterns)
- `docs/quality/qa-backend-standards.md` §2.1 (ownership matrix), §13 (performance), §15
  (datos sintéticos), §21 (BDD y Gherkin)
- `docs/architecture/api-standards.md` §3, §8 (RFC 7807)
- `docs/architecture/decisions/0008-stock-decrement-on-payment.md` (gobierna `SC-010-N3`,
  `SC-010-C2`)
- `docs/architecture/decisions/0006-*` (webhook verificado + medio simulado — gobierna
  toda la Característica)
- Skills: `qa-three-layer-regression` (modelo de capas, frontmatter obligatorio en §5-§8),
  `bdd-scenario-quality` (tense declarativo, `@blocked` no se cuela verde, Scenario
  Outline en `SC-010-C3`/`SC-010-N1`/`SC-010-N5`), `k6-load-scaffolding` (thresholds
  NFR-atados, executor `shared-iterations`), `threat-modeling-lite` (STRIDE del webhook
  ya cerrado por el backend en su `design.md` §D11 — este plan lo verifica, no lo reabre),
  `openspec-workflow`, `tracker-handoff` (constancia de MCP no conectado, §14)

## 16. Referencias

- User Story: `docs/user-stories/US-010-orden-webhook-stock.md`
- E2E: `docs/product/design-e2e.md` §9.2 (secuencia + compensación), §14 (STRIDE), §17
  (NFRs), §18.5 (runbook — "reconciliar consultando estado a la API de MP")
- Change de backend (archivado): `proposal.md`, `design.md`, `tasks.md` — los 3 cerrados,
  42/42 tasks
- Contratos vivos: `openspec/specs/pagos/contracts/openapi.yaml` +
  `openapi/paths/{webhook-mercadopago,simulate-payment,reconcile-payments,cleanup-abandoned-orders,retry-refunds}.yaml`
- ADR-0006 (webhook verificado + medio simulado), ADR-0008 (decremento al aprobar el pago)
- Changes relacionados: `openspec/changes/archive/US-023-pago-manual-offline-backend/qa-plan.md`
  (precedente directo, misma capacidad), `openspec/changes/US-014-registro-login-qa/`
  (precedente de formato de change hermano)
