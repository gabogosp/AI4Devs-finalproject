# US-012 QA — Plan del panel de órdenes del dueño

> **Alcance**: capas **owned-by-QA** (Layer 3 cross-stack, aceptación BDD, E2E de
> navegador, accesibilidad, carga, exploratorio). Las dev-owned (unit / integration /
> e2e-nest del backend; unit / component-RTL+MSW del frontend) son la TDD de cada
> disciplina y **no se re-autoran acá** (ownership matrix `qa-backend-standards.md` §2.1 /
> `qa-frontend-standards.md` §2.1).
> **Numeración**: `TC-12NN` — 4 dígitos a propósito (evita colisión con el rango de 3
> dígitos que ya usan US-001..US-014: `TC-0NN`, `TC-2NN`, `TC-3NN`, `TC-7NN`, `TC-14N`).
> **Estado del stack**: backend **0/17** tasks y frontend **0/25** tasks, ambos
> planificados en el mismo PR #22. **Ningún test case de este plan es ejecutable hoy** —
> los 13 de aceptación se desbloquean con solo el backend; los 9 restantes (E2E, a11y,
> exploratorio-FE) necesitan además el frontend. Se escriben igual, completos, para que
> ambos changes se construyan contra criterios observables — mismo criterio que
> `US-007-carrito-compra-qa` aplicó a su propia capa de navegador.

## 1. Perfil de riesgo

US-012 es la mitad de fulfillment del loop E2E del PRD (§9.4) y el primer módulo admin
que **lee y transiciona un recurso que otro módulo crea** (la orden nace en `checkout/`,
US-008).

| Riesgo | Por qué importa acá |
|---|---|
| **La orden que el dueño ve no es la que el cliente compró** | El backend de US-012 siembra sus propias fixtures con Prisma directo (T8.4 de su `design.md`); ningún test suyo compara la orden del panel contra un checkout real. Si el mapeo `checkout → admin` divergiera en un campo (ítems, comprador, total), ningún test de un solo módulo lo notaría |
| **Una sesión de cliente real cuela por el panel** | El backend prueba "sin token" y "rol no-admin minteado en el test". Una regresión que solo rompiera la verificación contra sesiones *reales* de otro rol (por ejemplo, un cambio futuro que decodifique el JWT distinto) no la vería ningún test que mintea su propio token |
| **AC-8 se rompe cuando lleguen US-013/US-016/la reconciliación con US-010** | La propia `design.md` del backend deja flageada, sin resolver, la tensión de reconciliación con `US-010` (FSM de 6 vs. 4 estados). Es exactamente el tipo de cambio futuro que puede filtrar `pending_payment`/`cancelled` al listado sin que nadie lo note en el momento |
| **El seam de observabilidad se corta en silencio** | `order.status_changed`/`order.transition_rejected` alimentan `/v1/admin/metrics` (otro change, `AUDIT-dsm-api-006`). Ningún AC de US-012 lo pide explícitamente, pero US-016 lo va a necesitar; si el contador deja de incrementar, nadie lo nota hasta que se intente construir el dashboard |
| **El puente de siembra (`@dsm/db`) queda como deuda silenciosa** | Mientras `US-023-pago-manual-offline-backend` no aterrice, esta suite depende de un `UPDATE` directo para alcanzar `new`. Si nadie lo revisita, el día que el endpoint real exista, la suite sigue probando el puente y no el camino real |
| **El panel es la primera superficie con datos de terceros (comprador) mostrados a un operador** | AC-2 expone email y teléfono del comprador en el detalle. Es superficie sensible que merece su propio recorrido de accesibilidad y de RBAC, no solo el genérico ya cubierto en otros paneles admin |

Journeys críticos identificados: **listar → abrir el detalle → avanzar el estado hasta
entregada** (AC-1/2/3/4/9) y **el negativo de todo lo anterior sin sesión de dueño**
(AC-7).

## 2. Mapeo de la pirámide (capas QA en negrita)

| Capa | Dueño | Estado |
|---|---|---|
| Unit backend (`order-state.ts`, `orders-errors.ts`) | dev | planificado, 0 tasks — awareness §3.1 |
| Integration backend (`orders.repository`, `order_status_history.repository`, Postgres real) | dev | planificado, 0 tasks — awareness §3.1 |
| E2E backend en proceso (supertest, `e2e-admin-orders`, `e2e-rbac` extendido) | dev | planificado, 0 tasks — awareness §3.1 |
| Unit / component frontend (Vitest+RTL+MSW, `OrdersList`/`OrderDetail`/`OrderStatusActions`/`OrderStatusHistory`) | dev | planificado, 0 tasks — awareness §3.1 |
| **Aceptación BDD cross-stack (API-level)** | **QA** | este plan — **bloqueada por el backend** |
| **E2E de navegador del panel** | **QA** | este plan — **bloqueada por backend + frontend** |
| **Accesibilidad (axe + teclado + `aria-sort`)** | **QA** | este plan — **bloqueada por el frontend** |
| **Carga (k6) lectura + escritura** | **QA + dev** | este plan — **bloqueada por el backend** |
| **Exploratorio** | **QA** | este plan (manual) — bloqueado según corresponda |

### 3.1 Nota de cobertura dev-owned (awareness, no se re-autora)

Backend (`US-012-panel-ordenes-dueno-backend/tasks.md`, cuando se ejecute): FSM de 4
estados en aislamiento, 404/409 por código de estado, idempotencia estructural del
`UPDATE` condicional (incluida la carrera de dos `PATCH` simultáneos, T8.1), el barrido de
RBAC extendido (T8.2), que el payload de la notificación no lleva PII a los logs (T8.3),
que solo las órdenes pagadas entran (T8.4) y la trazabilidad punta a punta contra Postgres
real (T8.5).

Frontend (`US-012-panel-ordenes-dueno-frontend-web/tasks.md`, cuando se ejecute): la FSM
proyectada en el cliente (`orderStatus.ts`), el estado optimista + rollback de
`OrderStatusActions` contra MSW, los estados de carga/error/vacío de `OrdersList`, y el
gate de `check-consumer-contract.sh` (F48 — ningún `fetch` crudo fuera del choke-point).

**Nada de eso se repite acá.** Este plan ejercita lo que vive fuera de esos dos procesos:
el cruce con el checkout real (US-008), la identidad de un rol real (US-014), el seam de
observabilidad compartido, y toda la mitad de UI contra un navegador y un backend reales.

## 3. Matriz de trazabilidad: AC × capa

Leyenda: **DEV** = TDD de la disciplina (planificada, 0 tasks) · **QA-API** = aceptación
API-level, este plan · **QA-UI** = E2E de navegador, este plan · **a11y** = este plan ·
**Carga** = este plan · **—** = no aplica.

| AC | DEV (awareness) | **QA-API** | **QA-UI** | **a11y** | **Carga** |
|---|---|---|---|---|---|
| **AC-1** listado paginado/ordenable/filtrable | DEV | **TC-1201** | **TC-1220** | — | **TC-1240** |
| **AC-2** detalle (ítems, contacto, retiro) | DEV | **TC-1202**, **TC-1206**, **TC-1211** | **TC-1221** | — | — |
| **AC-3** avanzar estado | DEV | **TC-1203**, **TC-1207** | **TC-1222** | — | **TC-1241** |
| **AC-4** "lista" avisa al cliente (trigger) | DEV | **TC-1204** | **TC-1222** | — | — |
| **AC-5** filtrar por estado | DEV | **TC-1205** | **TC-1220** | — | — |
| **AC-6** transición inválida bloqueada | DEV | **TC-1208** | **TC-1223** | — | — |
| **AC-7** acceso restringido | DEV | **TC-1209**, **TC-1212** | **TC-1224** | — | — |
| **AC-8** solo pagadas | DEV | **TC-1206**, **TC-1210** | — | — | — |
| **AC-9** trazabilidad de cambios | DEV | **TC-1203**, **TC-1207**, **TC-1213** | **TC-1221** | — | — |
| **NFR** WCAG 2.1 AA + `aria-sort` + teclado (US §9) | — | — | — | **TC-1230**, **TC-1231** | — |
| **NFR** p95 lectura < 300ms (US §9 / PRD §4) | — | — | — | — | **TC-1240** |
| **NFR** p95 escritura (transición) < 500ms (US §9 / PRD §4) | — | — | — | — | **TC-1241** |

**Las 9 AC tienen ≥1 escenario QA definido.** Ninguno queda sin al menos un escenario de
aceptación API-level, que es la capa que se desbloquea primero (solo backend).

## 4. Escenarios Gherkin (aceptación API-level)

Feature: `qa/acceptance/features/ordenes.feature`, tag de feature `@ordenes`. Gherkin en
español (`# language: es`), como el resto de la suite.

Antecedente común (no un `Background` literal — cada escenario declara su precondición
explícita, mismo criterio que `US-007-carrito-compra-qa`): las órdenes nacen de un
checkout real (`POST /v1/checkout`, US-008) y se puentean al estado activo que cada
escenario necesita — ver `design.md` §D2 para el detalle del puente y por qué es
temporal.

### 4.1 Happy path

- **H-1** — el listado muestra las órdenes pagadas, paginado y ordenable
- **H-2** — el detalle muestra los ítems, el contacto del comprador y el retiro
- **H-3** — avanzar la orden completa deja un historial consultable
- **H-4** — marcar "lista para retirar" dispara el aviso al cliente
- **H-5** — filtrar por estado muestra solo las órdenes de ese estado

```gherkin
@happy @critical-path
Escenario: H-1 — El listado muestra las órdenes pagadas, paginado y ordenable
  Dado tres órdenes reales de distintos clientes, en distintos estados activos
  Cuando el dueño abre el listado de órdenes sin filtro
  Entonces ve cada orden con cliente, total en ARS, estado y fecha de creación
  Y la lista respeta el límite y el desplazamiento que pidió
  Y ordenar por fecha, por número de orden o por total cambia el orden de la página

@happy @critical-path
Escenario: H-2 — El detalle muestra los ítems, el contacto del comprador y el retiro
  Dado una orden real con dos ítems de distinto producto
  Cuando el dueño abre esa orden desde el listado
  Entonces ve cada ítem con su cantidad y su precio
  Y ve el nombre, el email y el teléfono del comprador
  Y ve que el retiro es en sucursal

@happy @critical-path
Escenario: H-3 — Avanzar la orden completa deja un historial consultable
  Dado una orden real en estado "new"
  Cuando el dueño la avanza a "preparing", luego a "ready" y luego a "delivered"
  Entonces cada transición queda registrada con su estado anterior, el nuevo y una marca temporal
  Y el detalle de la orden expone esas tres transiciones en orden cronológico
  Y la orden entregada queda con su fecha de entrega poblada

@happy @critical-path
Escenario: H-4 — Marcar "lista para retirar" dispara el aviso al cliente
  Dado una orden real en estado "preparing"
  Cuando el dueño la marca como "lista para retirar"
  Entonces la transición se confirma
  Y el sistema dispara el aviso de que el pedido está listo para ese comprador
  # El envío en sí (US-011) es un seam sin proveedor real todavía; acá se verifica que
  # el disparo ocurre exactamente una vez por esta transición, no el envío.

@happy
Escenario: H-5 — Filtrar por estado muestra solo las órdenes de ese estado
  Dado órdenes reales en los cuatro estados activos de fulfillment
  Cuando el dueño filtra el listado por "preparando"
  Entonces ve únicamente las órdenes en ese estado
  Y ninguna orden de otro estado activo aparece en la página
```

### 4.2 Corner (condiciones de borde)

- **C-1** — el detalle de una orden cancelada sigue siendo consultable por id
- **C-2** — repetir la misma transición no duplica el historial ni el aviso

```gherkin
@corner
Escenario: C-1 — El detalle de una orden cancelada sigue siendo consultable por id
  Dado una orden real que fue cancelada
  Cuando el dueño abre esa orden por su id
  Entonces ve su detalle igual, sin que el sistema la trate como inexistente
  Y esa orden no aparece en el listado sin filtro

@corner
Escenario: C-2 — Repetir la misma transición no duplica el historial ni el aviso
  Dado una orden real que el dueño ya marcó como "ready"
  Cuando el dueño repite exactamente esa misma transición
  Entonces la respuesta sigue siendo exitosa
  Y el historial de la orden no gana una segunda entrada
  Y el aviso de "lista para retirar" no se dispara una segunda vez
```

### 4.3 Negative (negative-space — lo que NO tiene que pasar)

- **N-1** — saltar un paso de la FSM se rechaza y el estado no cambia
- **N-2** — sin sesión de dueño, el panel deniega el acceso
- **N-3** — las órdenes pendientes de pago no se gestionan desde este panel

```gherkin
@negative @critical-path
Escenario: N-1 — Saltar un paso de la FSM se rechaza y el estado no cambia
  Dado una orden real en estado "new"
  Cuando el dueño intenta marcarla directamente como "delivered"
  Entonces el sistema rechaza la transición
  Y la orden sigue en estado "new"
  Y el historial de la orden no gana ninguna entrada nueva

@negative @critical-path
Escenario: N-2 — Sin sesión de dueño, el panel deniega el acceso
  Dado un visitante que no inició ninguna sesión
  Cuando intenta abrir el panel de órdenes o cambiar el estado de una orden real
  Entonces el sistema deniega la solicitud

@negative @critical-path
Escenario: N-3 — Las órdenes pendientes de pago no se gestionan desde este panel
  Dado una orden real recién generada por checkout, todavía sin confirmar el pago
  Cuando el dueño abre el listado de órdenes sin filtro
  Entonces esa orden no aparece
  Cuando el dueño intenta abrir esa orden por su id
  Entonces el sistema responde que no existe
  Cuando el dueño intenta avanzar su estado
  Entonces el sistema también responde que no existe
```

### 4.4 Cross-feature (Layer 3 — cruzan disciplinas o US)

- **X-1** — la orden que ve el dueño es la que el cliente realmente compró (cruza US-008)
- **X-2** — una cuenta de cliente real no es una cuenta de dueño (cruza US-014)
- **X-3** — cada transición queda visible en las métricas del panel de observabilidad

```gherkin
@cross-feature @critical-path
Escenario: X-1 — La orden que ve el dueño es la que el cliente realmente compró
  Dado un cliente que completó un checkout real con dos productos y sus cantidades
  Cuando el dueño abre esa orden en el panel
  Entonces ve los mismos productos con las mismas cantidades y los mismos precios que el cliente pagó
  Y ve el mismo nombre, email y teléfono que el cliente cargó en el checkout
  # Cruza US-008 (checkout guest) con US-012. El backend de este panel no arma fixtures
  # propias para esto: lee la orden real que otro módulo escribió.

@cross-feature @critical-path
Escenario: X-2 — Una cuenta de cliente real no es una cuenta de dueño
  Dado una cuenta de cliente registrada y logueada por el flujo real de US-014
  Cuando esa cuenta intenta abrir el panel de órdenes
  Entonces el sistema la deniega igual que a un visitante sin sesión
  # Cruza US-014 (cuentas de cliente) con US-012. La negación no depende de la ausencia
  # de sesión sino del rol: una sesión válida de otro tipo no alcanza.

@cross-feature
Escenario: X-3 — Cada transición queda visible en las métricas del panel de observabilidad
  Dado una orden real en estado "new"
  Cuando el dueño la avanza a "preparing"
  Y el dueño intenta después saltarla directo a "delivered"
  Entonces el contador de transiciones aplicadas subió en uno
  Y el contador de transiciones rechazadas también subió en uno
  # Cruza el módulo de órdenes con /v1/admin/metrics (AUDIT-dsm-api-006), una superficie
  # que otro change ya construyó y que ningún test de un solo módulo ejercita junta.
```

## 5. Test cases owned-by-QA

### 5.0 Índice — 24 test cases, 0 ejecutables hoy (bloqueados por los dos changes dev)

| Test case | Escenario | Herramienta | Bloqueado por |
|---|---|---|---|
| TC-1201 | H-1 | Cucumber+Playwright | backend |
| TC-1202 | H-2 | Cucumber+Playwright | backend |
| TC-1203 | H-3 | Cucumber+Playwright | backend |
| TC-1204 | H-4 | Cucumber+Playwright | backend |
| TC-1205 | H-5 | Cucumber+Playwright | backend |
| TC-1206 | C-1 | Cucumber+Playwright | backend |
| TC-1207 | C-2 | Cucumber+Playwright | backend |
| TC-1208 | N-1 | Cucumber+Playwright | backend |
| TC-1209 | N-2 | Cucumber+Playwright | backend |
| TC-1210 | N-3 | Cucumber+Playwright | backend |
| TC-1211 | X-1 | Cucumber+Playwright | backend |
| TC-1212 | X-2 | Cucumber+Playwright | backend |
| TC-1213 | X-3 | Cucumber+Playwright | backend |
| TC-1220 | E-1 | Playwright | backend + frontend |
| TC-1221 | E-2 | Playwright | backend + frontend |
| TC-1222 | E-3 | Playwright | backend + frontend |
| TC-1223 | E-4 | Playwright | backend + frontend |
| TC-1224 | E-5 | Playwright | backend + frontend |
| TC-1230 | A-1 | axe-core+Playwright | backend + frontend |
| TC-1231 | A-2 | Playwright | backend + frontend |
| TC-1240 | L-1 | k6 | backend |
| TC-1241 | L-2 | k6 | backend |
| TC-1250 | charter | manual | frontend |
| TC-1251 | charter | manual | backend propio + `US-023-pago-manual-offline-backend` |

**Por herramienta**: Cucumber+Playwright 13 · Playwright 7 · axe-core+Playwright 1 · k6 2
· charter manual 2.

### 5.1 Aceptación BDD API-level (Cucumber + Playwright) — bloqueada por el backend

```yaml
- id: TC-1201
  scenario: H-1
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "H-1 — listado paginado y ordenable"
  name: OrdenesAdmin_ListadoSinFiltro_MuestraClienteTotalEstadoYFechaPaginadoYOrdenable
  blocked_by: "US-012-panel-ordenes-dueno-backend planificado, 0 tasks"

- id: TC-1202
  scenario: H-2
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "H-2 — detalle con ítems, contacto y retiro"
  name: OrdenAdmin_Detalle_MuestraItemsContactoDelCompradorYRetiroEnSucursal
  blocked_by: "US-012-panel-ordenes-dueno-backend planificado, 0 tasks"

- id: TC-1203
  scenario: H-3
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "H-3 — ciclo completo con historial consultable"
  name: OrdenAdmin_CicloCompletoNewAPreparingAReadyADelivered_DejaHistorialCronologicoYFechaDeEntrega
  blocked_by: "US-012-panel-ordenes-dueno-backend planificado, 0 tasks"

- id: TC-1204
  scenario: H-4
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "H-4 — 'lista' dispara el aviso"
  name: OrdenAdmin_MarcarLista_DisparaElAvisoAlCompradorUnaSolaVez
  blocked_by: "US-012-panel-ordenes-dueno-backend planificado, 0 tasks"

- id: TC-1205
  scenario: H-5
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "H-5 — filtrar por estado"
  name: OrdenesAdmin_FiltrarPorEstado_MuestraSoloLasDeEseEstado
  blocked_by: "US-012-panel-ordenes-dueno-backend planificado, 0 tasks"

- id: TC-1206
  scenario: C-1
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "C-1 — detalle de una orden cancelada, consultable por id"
  name: OrdenAdmin_Cancelada_DetalleVisiblePorIdPeroAusenteDelListadoSinFiltro
  blocked_by: "US-012-panel-ordenes-dueno-backend planificado, 0 tasks"

- id: TC-1207
  scenario: C-2
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "C-2 — repetir la misma transición no duplica nada"
  name: OrdenAdmin_RepetirLaMismaTransicion_NoDuplicaHistorialNiReDisparaElAviso
  blocked_by: "US-012-panel-ordenes-dueno-backend planificado, 0 tasks"

- id: TC-1208
  scenario: N-1
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "N-1 — saltar un paso de la FSM"
  name: OrdenAdmin_SaltarDePasoEnLaFSM_RechazaYElEstadoNoCambia
  blocked_by: "US-012-panel-ordenes-dueno-backend planificado, 0 tasks"

- id: TC-1209
  scenario: N-2
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "N-2 — sin sesión de dueño"
  name: PanelDeOrdenes_SinSesion_DeniegaListadoDetalleYTransicion
  blocked_by: "US-012-panel-ordenes-dueno-backend planificado, 0 tasks"

- id: TC-1210
  scenario: N-3
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "N-3 — pendientes de pago fuera del panel"
  name: OrdenPendingPayment_NoAvanzaSinPago_AusenteDelListadoYNotFoundEnDetalleYTransicion
  blocked_by: "US-012-panel-ordenes-dueno-backend planificado, 0 tasks"

- id: TC-1211
  scenario: X-1
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "X-1 — la orden del panel es la que el cliente compró"
  name: OrdenAdmin_ContraElCheckoutReal_MismosItemsCompradorYPreciosQueUS008Registro
  blocked_by: "US-012-panel-ordenes-dueno-backend planificado, 0 tasks"

- id: TC-1212
  scenario: X-2
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "X-2 — una cuenta de cliente real no es una cuenta de dueño"
  name: PanelDeOrdenes_ConSesionDeClienteRealDeUS014_DeniegaIgualQueSinSesion
  blocked_by: "US-012-panel-ordenes-dueno-backend planificado, 0 tasks"

- id: TC-1213
  scenario: X-3
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Playwright
  gherkin_scenario: "X-3 — las métricas de observabilidad se incrementan"
  name: OrdenAdmin_TransicionAplicadaYRechazada_IncrementaLosDosContadoresDeMetricas
  blocked_by: "US-012-panel-ordenes-dueno-backend planificado, 0 tasks"
```

### 5.2 E2E de navegador (Playwright) — bloqueada por backend + frontend

| Escenario | Definición | AC |
|---|---|---|
| **E-1** | `/admin/ordenes`: listado con paginación, orden por columna (`aria-sort` en Nº de orden/total/fecha) y filtro por estado | AC-1, AC-5 |
| **E-2** | `/admin/ordenes/{id}`: detalle con ítems, contacto, retiro y el historial de estado visible | AC-2, AC-9 |
| **E-3** | Avanzar el estado desde la UI: el badge cambia optimistamente, y al confirmar "lista para retirar" aparece el mensaje de aviso al cliente | AC-3, AC-4 |
| **E-4** | Con el backend rechazando (409, carrera de dos pestañas), el estado optimista revierte y aparece el mensaje de conflicto | AC-6 |
| **E-5** | Un visitante sin sesión de admin, navegando directo a `/admin/ordenes`, no ve el panel | AC-7 |

```yaml
- id: TC-1220
  scenario: E-1
  execution_mode: automated
  test_layer: 3
  target_tooling: Playwright
  gherkin_scenario: "E-1 — listado en el navegador con paginación, orden y filtro (AC-1/AC-5)"
  name: PanelOrdenesUI_Listado_PaginaOrdenaConAriaSortYFiltraPorEstado
  blocked_by: "US-012-panel-ordenes-dueno-backend y -frontend-web planificados, 0 tasks"

- id: TC-1221
  scenario: E-2
  execution_mode: automated
  test_layer: 3
  target_tooling: Playwright
  gherkin_scenario: "E-2 — detalle con historial visible (AC-2/AC-9)"
  name: PanelOrdenesUI_Detalle_ItemsContactoRetiroEHistorialDeEstadoVisibles
  blocked_by: "US-012-panel-ordenes-dueno-backend y -frontend-web planificados, 0 tasks"

- id: TC-1222
  scenario: E-3
  execution_mode: automated
  test_layer: 3
  target_tooling: Playwright
  gherkin_scenario: "E-3 — avanzar con UI optimista y aviso de 'lista' (AC-3/AC-4)"
  name: PanelOrdenesUI_AvanzarEstado_BadgeOptimistaYMensajeDeAvisoAlMarcarLista
  blocked_by: "US-012-panel-ordenes-dueno-backend y -frontend-web planificados, 0 tasks"

- id: TC-1223
  scenario: E-4
  execution_mode: automated
  test_layer: 3
  target_tooling: Playwright
  gherkin_scenario: "E-4 — rollback ante 409 real de carrera entre pestañas (AC-6)"
  name: PanelOrdenesUI_Conflicto409DelBackendReal_RevierteElEstadoOptimistaYAvisaElConflicto
  blocked_by: "US-012-panel-ordenes-dueno-backend y -frontend-web planificados, 0 tasks"

- id: TC-1224
  scenario: E-5
  execution_mode: automated
  test_layer: 3
  target_tooling: Playwright
  gherkin_scenario: "E-5 — acceso denegado end-to-end (AC-7)"
  name: PanelOrdenesUI_SinSesionDeAdmin_NoVeElPanelDeOrdenes
  blocked_by: "US-012-panel-ordenes-dueno-backend y -frontend-web planificados, 0 tasks"
```

### 5.3 Accesibilidad (axe-core + teclado) — bloqueada por el frontend

| Escenario | Definición | Origen |
|---|---|---|
| **A-1** | 0 violaciones WCAG 2.1 AA en `OrdersList` (con datos, vacío, con error) y `OrderDetail` | US §9 |
| **A-2** | Tabla navegable por teclado: `aria-sort` en las 3 columnas ordenables, foco visible y orden lógico, y foco gestionado al entrar al detalle | US §9 + design-system §11 |

**Sin duplicación con la capa dev-owned**: el plan de FE corre `axe(container)` a nivel
componente (RTL + `vitest-axe`, T10.1 de su `tasks.md`). A-1 corre sobre la **página
servida** en un browser real: incluye el layout del route group `(admin)` completo, que
ningún test de componente aislado renderiza.

```yaml
- id: TC-1230
  scenario: A-1
  execution_mode: automated
  test_layer: 3
  target_tooling: axe-core+Playwright
  gherkin_scenario: "A-1 — NFR WCAG 2.1 AA en OrdersList y OrderDetail (US §9)"
  name: PanelOrdenesUI_SinViolacionesAA_EnListadoYDetalleConDatosYEnVacio
  blocked_by: "US-012-panel-ordenes-dueno-frontend-web planificado, 0 tasks"

- id: TC-1231
  scenario: A-2
  execution_mode: automated
  test_layer: 3
  target_tooling: Playwright
  gherkin_scenario: "A-2 — NFR teclado + aria-sort + foco gestionado (US §9)"
  name: PanelOrdenesUI_NavegableConTecladoConAriaSortYFocoGestionadoAlDetalle
  blocked_by: "US-012-panel-ordenes-dueno-frontend-web planificado, 0 tasks"
```

### 5.4 Carga (k6) — bloqueada por el backend, umbrales ya ratificados en la propia US

| Escenario | Definición | Presupuesto |
|---|---|---|
| **L-1** | `GET /v1/admin/orders` sin filtro, con datos sembrados | **p95 < 300ms** — US §9 ("Latencia p95 lectura"), hereda PRD §4 |
| **L-2** | `PATCH /v1/admin/orders/{id}` (transición válida), una orden distinta por iteración | **p95 < 500ms** — US §9 ("escritura (transición)"), hereda PRD §4 |

A diferencia de `US-007-carrito-compra-qa` (donde el número de lectura del carrito no
tenía ratificación y el stub se rechazó a propósito), acá **los dos números ya están en la
US sin condicional** — se emiten los dos.

```yaml
- id: TC-1240
  scenario: L-1
  execution_mode: automated
  test_layer: 3
  target_tooling: k6
  gherkin_scenario: "L-1 — NFR p95 lectura < 300ms (US §9 / PRD §4)"
  name: OrdenesAdmin_ListadoBajoCarga_P95MenorATrescientosMs
  blocked_by: "US-012-panel-ordenes-dueno-backend planificado, 0 tasks"

- id: TC-1241
  scenario: L-2
  execution_mode: automated
  test_layer: 3
  target_tooling: k6
  gherkin_scenario: "L-2 — NFR p95 escritura (transición) < 500ms (US §9 / PRD §4)"
  name: OrdenAdmin_TransicionBajoCarga_P95MenorAQuinientosMsConOrdenDistintaPorIteracion
  blocked_by: "US-012-panel-ordenes-dueno-backend planificado, 0 tasks"
```

Se agregan `list_orders` y `order_transition` a `qa/performance/lib/thresholds.js`
(fuente única de presupuestos), con `checks` de status **y** de cuerpo
(`k6-load-scaffolding` §Checks vs thresholds) — un 200 con un body vacío no puede pasar el
gate. El volumen real de esta US es bajísimo (~100 órdenes/mes, PRD §6); el valor del load
test no es simular ese volumen sino la **regresión** de latencia contra el piso que la
propia US promete.

### 5.5 Exploratorio (manual, justificado)

```yaml
- id: TC-1250
  execution_mode: manual
  test_layer: 3
  target_tooling: charter
  gherkin_scenario: "—"
  name: Charter_ElPanelDeFulfillmentEnUnDiaRealDeOperacion
  blocked_by: "US-012-panel-ordenes-dueno-frontend-web planificado, 0 tasks"
  justification: >-
    El volumen real es bajo (unas pocas órdenes por día) pero el operador puede tener
    dos pestañas abiertas del mismo panel (ADR-0009 es un solo dueño, no impide dos
    pestañas), con conectividad intermitente en el local. Ningún test determinista
    reproduce ese patrón de uso real; se explora con el navegador de verdad.

- id: TC-1251
  execution_mode: manual
  test_layer: 3
  target_tooling: charter
  gherkin_scenario: "—"
  name: Charter_ReconciliacionDelCicloCompletoCuandoAterriceUS023
  blocked_by: "US-012-panel-ordenes-dueno-backend propio Y US-023-pago-manual-offline-backend, ambos 0 tasks"
  justification: >-
    Es la salida esperada del puente de siembra de design.md §D2: repetir el ciclo
    completo pending_payment → new → preparing → ready → delivered usando
    POST /v1/admin/orders/{orderId}/confirm-payment real, sin el UPDATE directo vía
    @dsm/db. No es un assert determinista porque su propósito es confirmar que el
    puente ya no hace falta, no verificar una propiedad nueva del producto.
```

## 6. `PendingPaymentsPanel` — coverage-awareness, sin tratamiento de AC completo

`US-012-panel-ordenes-dueno-frontend-web` (Fase 12) planifica esta vista — segunda
pestaña de `/admin/ordenes`, para que el dueño confirme pagos manuales — consumiendo dos
endpoints que **`US-023-pago-manual-offline-backend`** ya diseñó
(`GET /v1/admin/orders/pending-payment`, `POST /v1/admin/orders/{orderId}/confirm-payment`).
Su propio `proposal.md` (OQ-FE-4) ya deja explícito que **no tiene un AC Gherkin formal**
en `docs/user-stories/US-012-panel-ordenes-dueno.md` — nace de una nota informal §10, no
de una de las 9 AC ratificadas.

Por eso esta sección **no** le da el mismo tratamiento que a las 9 AC de §3-§5: no hay
Gherkin, no hay `execution_mode`/`test_layer`/`target_tooling` comprometidos, y ningún
TC-12NN de este plan lo cubre. Inventar esa AC para poder planificarlo excede la
autoridad de este agente (ver `proposal.md` OQ-QA-3, que reitera el mismo pedido que ya
dejó el `proposal.md` de FE).

**Boceto no comprometido — cómo lucirían sus escenarios el día que se ratifique un AC**:

| Boceto | Qué probaría | Bloqueado hoy por |
|---|---|---|
| PP-1 (happy) | El dueño ve el listado de pendientes de pago (sin paginar) y confirma una; la fila desaparece del listado tras el refetch | Ambos backends hermanos: `US-012-panel-ordenes-dueno-backend` no existe (necesario para que la orden confirmada aparezca en `OrdersList`) y `US-023-pago-manual-offline-backend` tampoco (dueño de los dos endpoints que consume) |
| PP-2 (negative) | Confirmar el pago de una orden que ya no está `pending_payment` (doble click, o ya la confirmó otra pestaña) responde 409 y la fila permanece con el mensaje de conflicto | ídem |
| PP-3 (cross-feature) | Una orden confirmada por `PendingPaymentsPanel` aparece **inmediatamente** en `OrdersList` (la cola de fulfillment que este mismo change QA cubre en §3-§5) sin refresco manual del listado principal | ídem — es exactamente el punto de costura entre este plan y el que falta de `US-023` |

**Coordinación cruzada explícita (no una suposición silenciosa)**: el testing completo de
esta vista necesita el plan de QA de `US-023-pago-manual-offline-backend`, que **no
existe** (worktree y sesión distintos). Este documento no asume que "ya está cubierto en
otro lado" — queda como punto de coordinación abierto en `proposal.md` OQ-QA-2.

## 7. Bloqueos y dependencias (declarados)

| # | Qué | Estado | Dueño / disparador |
|---|---|---|---|
| B-1 | **Backend de US-012 planificado, 0 tasks ejecutadas.** Sin contrato publicado (`/admin/orders*` no existe en `apps/api/docs/api/openapi.yaml`), ningún test de aceptación (§4/§5.1) puede correr. | Bloquea las 13 aceptaciones + carga | `/develop-backend US-012` |
| B-2 | **Frontend de US-012 planificado, 0 tasks ejecutadas.** Sin la ruta `/admin/ordenes` construida, E2E de navegador y a11y no pueden correr. | Bloquea E-1..E-5, A-1, A-2, TC-1250 | `/develop-frontend-web US-012` |
| B-3 | **No existe ningún camino de API para alcanzar `new`.** `ConfirmOrderService` de `US-023-pago-manual-offline-backend` (0 tasks, worktree separado) es quien lo va a exponer. `seed-ordenes.ts` puentea con `@dsm/db` mientras tanto (design.md §D2). | Bloquea el charter TC-1251, no la ejecución del resto | `US-023-pago-manual-offline-backend` |
| B-4 | **`PendingPaymentsPanel` sin AC formal ni plan de QA de `US-023`.** Ver §6. | No bloquea nada de este plan (está fuera de su matriz de trazabilidad) | PO (CR/enmienda) + sesión de QA de `US-023` |
| B-5 | **Entorno**: la API tiene que arrancar con `ADMIN_BOOTSTRAP_TOKEN` (login admin real) y con las cuentas de cliente de `customer-auth.ts` operativas (US-014, ya mergeado) para X-2. | Bloquea la corrida, no el plan | ver `qa/support/qa-env.ts` (ya existe) |

## 8. Infraestructura de test

### Se reusa de `qa/` (sin modificar)

| Pieza | Para qué |
|---|---|
| `qa/acceptance/steps/world.ts` | contexto admin autenticado + contexto anónimo, aislados por escenario |
| `qa/support/admin-auth.ts` | login **real** con `ADMIN_BOOTSTRAP_TOKEN` |
| `qa/support/customer-auth.ts` (`nuevaCuenta`) | sesión de cliente **real** (US-014), para X-2 |
| `qa/support/api.ts` (`apiCall`) | llamadas admin que fallan ruidoso ante cualquier no-2xx |
| `qa/support/builders.ts` | `nuevaCategoria`/`nuevoProducto`, para los ítems del checkout de siembra |
| `qa/performance/lib/thresholds.js` | fuente única de budgets; se le suman `list_orders` y `order_transition` |
| `qa/e2e/playwright.config.ts` · `playwright.a11y.config.ts` | los dos runners ya configurados |
| `qa/exploratory/charters.md` | se le agrega un apéndice; no se reescribe lo anterior |
| scripts de `qa/package.json` | `test:acceptance`, `test:e2e`, `test:a11y`, `test:load` |

### Se agrega (dueño: este change)

| Archivo | Qué hace |
|---|---|
| `qa/support/seed-ordenes.ts` | **hermano** de `seed-carrito.ts`. Checkout real (`POST /v1/checkout`) + el puente documentado vía `@dsm/db` para alcanzar `new`/`cancelled` (design.md §D2). Produce: 1 orden por cada estado activo (`new`/`preparing`/`ready`/`delivered`), 1 `cancelled`, 1 `pending_payment` sin tocar, y helpers para avanzar vía `PATCH` real |
| `qa/support/seed-ordenes.smoke.ts` | smoke del seed, mismo patrón que `seed-carrito.smoke.ts`, con la aserción de que `@dsm/db` se usa **una sola vez** y solo para el `UPDATE` de estado (no para nada más) |
| `qa/acceptance/features/ordenes.feature` | los 13 escenarios de §4, tag `@ordenes` |
| `qa/acceptance/steps/ordenes.steps.ts` | steps del panel; reusa `admin-auth`/`customer-auth`/`api` sin modificarlos |
| `qa/e2e/ordenes.spec.ts` | E-1..E-5 |
| `qa/e2e/ordenes-a11y.spec.ts` | A-1, A-2 |
| `qa/performance/orders-read.js` | L-1 |
| `qa/performance/orders-write.js` | L-2 |

## 9. Estrategia de datos de test

- **Órdenes sintéticas nacidas de un checkout real** (`POST /v1/checkout`, US-008) siempre
  que sea posible — solo el salto `pending_payment → new` (y `→ cancelled`, sin
  transición real todavía) se puentea con `@dsm/db`, documentado y acotado a un único
  `UPDATE` por orden (`design.md` §D2, OQ-QA-1). El resto de las transiciones
  (`new → preparing → ready → delivered`) siempre pasa por el `PATCH` real del backend
  de US-012, nunca por `INSERT`/`UPDATE` directo en `order_status_history`.
- **Identidad de cliente real** para X-2, vía `customer-auth.ts` (US-014) — nunca un JWT
  minteado con `role: 'customer'` a mano.
- **Defaults deterministas**; el único valor no determinista es el prefijo de corrida
  (reusa `builders.ts`), nunca aserido (`testing-standards.md` §5).
- **Aislamiento**: cada escenario crea sus propias órdenes vía el seed; ningún escenario
  depende del residuo de otro (mismo criterio que `qa-three-layer-regression`
  §Cross-layer rules).

## 10. Quality gates

| Gate | Cuándo | Bloquea |
|---|---|---|
| Aceptación API-level (TC-1201…TC-1213) | PR y nightly, **desde que exista el backend** | sí (cuando aplique) |
| E2E de navegador (TC-1220…TC-1224) | PR y nightly, **desde que existan backend y frontend** | sí (cuando aplique) |
| a11y 0 violaciones AA + teclado + `aria-sort` | pre-release, **desde que exista el frontend** | sí (cuando aplique) |
| Carga lectura/escritura bajo presupuesto (TC-1240/1241) | pre-release, **desde que exista el backend** | sí (cuando aplique) |
| Charters exploratorios | pre-release | no (informan) |

## 11. Anti-patrones evitados a propósito

- ❌ **Autorar capas dev-owned** (`qa-backend-standards.md` §2.1 / `qa-frontend-standards.md`
  §2.1): cero stubs de unit, component, integration o e2e-nest/en-proceso en este plan.
- ❌ **Duplicar la carrera de dos `PATCH` simultáneos que el backend ya prueba en
  aislamiento** (T8.1 de su `tasks.md`): se descartó a propósito un escenario de "dos
  pestañas" en la capa de aceptación — no agrega nada sobre "el proceso real" que el
  backend no cubra ya con Postgres real; en su lugar, C-2 (repetir la misma transición)
  cubre una propiedad distinta (no-doble-efecto) que el backend no verifica igual.
- ❌ **Inventar un AC para `PendingPaymentsPanel`** (`qa-plan.md` §6): se documenta como
  boceto no comprometido, nunca como cobertura ya planificada.
- ❌ **Un k6 sin umbral atado a un NFR** (`k6-load-scaffolding`): los dos números de esta
  US ya están ratificados (US §9), así que ninguno se emite "sin threshold" como pasó con
  la lectura del carrito en US-007.
- ❌ **Esperas fijas** (`playwright-stability`, `flakiness-detection` señal 1): ninguna
  `waitForTimeout`; los cambios de estado se asertan re-navegando o esperando el badge
  siguiente, nunca con un `sleep`.
- ❌ **Escenarios sin ejecutar disfrazados de ejecutables**: los 24 test cases de este
  plan llevan `blocked_by` explícito — ninguno cuenta como cobertura verde todavía.
- ❌ **Fixtures compartidas mutables entre suites**: `seed-ordenes.ts` es hermano, no
  extensión de `seed-carrito.ts` ni de `seed-categorias.ts`.
- ❌ **Sembrar la orden completa con `INSERT` directo** (lo que sí hace la capa dev-owned
  del backend en su propia fixture): la capa QA usa el checkout real para todo lo que la
  API real puede producir, y acota el `UPDATE` directo al único salto que ningún endpoint
  expone todavía (§9, `design.md` §D2).

## 12. Standards consultados

`testing-standards.md` (§2 pirámide, §5 datos, §14 patrones, §14.9 negative-space, §18
anti-patterns) · `qa-backend-standards.md` (§2.1 ownership, §13 performance, §15 datos) ·
`qa-frontend-standards.md` (§19 accesibilidad, §23 Playwright, §24 BDD web) ·
`performance-standards.md` (§7 diseño del load test, §8 budgets en CI) ·
`base-standards.md` (§1 KISS) · skills `qa-three-layer-regression`, `bdd-scenario-quality`,
`playwright-stability`, `k6-load-scaffolding`, `flakiness-detection`, `nfr-quantification`
(consultado para confirmar que los NFR de US §9 ya vienen ratificados, sin necesidad de
proponer un número nuevo).

## 13. Open questions

Ver `proposal.md` §Open questions (OQ-QA-1 a OQ-QA-4). Resumen:

- **OQ-QA-1** — el puente de siembra vía `@dsm/db` (design.md §D2) es temporal hasta que
  `US-023-pago-manual-offline-backend` publique `confirm-payment`.
- **OQ-QA-2** — coordinación cruzada con la QA de `US-023` para el testing completo de
  `PendingPaymentsPanel` (§6), que todavía no existe.
- **OQ-QA-3** — recomendación de un CR/enmienda a la US para un AC formal nuevo de
  `PendingPaymentsPanel`; QA no tiene autoridad para crearla.
- **OQ-QA-4** — los NFR de esta US ya vienen ratificados (no `[propuesto]`); si un E2E los
  revisa, `qa/performance/lib/thresholds.js` es la fuente única a actualizar.
