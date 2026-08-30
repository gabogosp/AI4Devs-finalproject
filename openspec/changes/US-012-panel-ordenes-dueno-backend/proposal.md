---
tracker-id: null
tracker-source: null
parent-us: US-012
discipline: backend
variant: null
language: es
audit-derived: false
regenerated-at: 2026-08-30
regenerated-reason: >
  US-009 pasó a Blocked (sin credenciales MercadoPago) y US-010 queda
  indefinidamente pospuesta. US-023-pago-manual-offline nace como camino
  interino de pago y ya tiene un backend plan completo (sin construir, en su
  propio worktree) que NO crea `src/orders/` — extiende
  `checkout/orders.repository.ts` en su lugar. Este regenerate desacopla el
  plan de US-012 de ambas dependencias fantasma (`order-state.ts`,
  `confirmed_at`/`cancelled_at`, `NotificationPort`, `payments` — ninguna
  existe en código) y lo funda sobre lo que el schema real de `orders` (US-008,
  ya migrado) efectivamente tiene hoy. Ver "Qué cambió respecto a la versión
  anterior" abajo.
---

# Proposal — Panel de órdenes del dueño (backend)

> **Ticket**: US-012 — Panel de órdenes del dueño + gestión de estados
> **Author**: backend-node-developer agent (assisted by @gabogosp)
> **Date**: 2026-08-30 (regenerado; versión original respaldada en
> `openspec/changes/_backups/2026-08-30-US-012-panel-ordenes-dueno-backend/`)
> **Status**: Proposed
> **Affected layers**: controller, service, repositorio (extensión de
> `checkout/orders.repository.ts` + repositorio nuevo de historial), DTO,
> dominio (FSM propia, 4 estados activos), persistencia (tabla nueva aditiva),
> observabilidad
> **Affected platform**: `apps/api` (NestJS)

## Por qué (y qué cambió respecto a la versión anterior)

US-012 es la mitad "el dueño prepara y entrega" del loop E2E del PRD (§9.4). La
versión anterior de este plan asumía que `US-010-orden-webhook-stock-backend`
ya habría construido `src/orders/` (FSM de 6 estados, columnas
`confirmed_at`/`cancelled_at`, `NotificationPort`, tabla `payments`) y se limitaba
a **extender** ese árbol. Esa dependencia nunca se materializó — hoy (verificado
2026-08-30): `apps/api/src/orders/` no existe, `orders` no tiene columnas
`confirmed_at` ni `cancelled_at` (sólo `created_at`/`updated_at`/`delivered_at`),
y no existe ningún `NotificationPort` en el repo. US-009 (MercadoPago) pasó a
`Blocked` y US-010 queda pospuesta sin fecha.

En el interín, `US-023-pago-manual-offline` (status `Backlog`/en planificación
activa, 0 tasks ejecutadas, código sólo staged sin commitear en su propio
worktree) es quien de hecho va a construir la primera confirmación de pago real
del proyecto — y **decidió explícitamente no crear `src/orders/`**: extiende
`checkout/orders.repository.ts` en el lugar donde ya vive (ver su `design.md`
§Non-goals: "mover `OrdersRepository`... es una decisión que le corresponde a
quien planifique US-010... no se preempta acá").

Este regenerate seguí el mismo criterio para US-012, con una diferencia
importante: **no depende de que US-023 aterrice ninguna pieza de código**. La
tabla `orders` (migrada por US-008, con su `CHECK` de `status` ya declarando
las 6 fases de la FSM: `pending_payment, new, preparing, ready, delivered,
cancelled`) es autosuficiente para todo lo que este panel necesita gestionar
(las 4 fases activas de fulfillment). El resultado es un plan **desbloqueado
hoy** — sin ningún gate en rojo — a diferencia de la versión anterior, cuyo
T0.1 fallaba a propósito porque `US-010` seguía en `draft` sin tasks cerradas.

## Qué

**Crea un módulo nuevo, angosto: `apps/api/src/orders/`** — nadie lo había
creado todavía (ni US-010 en la práctica, ni US-023, que deliberadamente se
quedó en `checkout/`). No reproduce el árbol completo que el `design.md` de
US-010 bosquejó (D9) — sólo lo que este panel necesita: controller, servicio de
caso de uso, una FSM propia de 4 estados, el repositorio del historial y el
`NotificationPort` (nuevo, no una extensión — no hay nada que extender). Ver
"Riesgo de reconciliación futura" abajo para lo que esto implica cuando
alguien retome US-010.

- **Tres endpoints admin** en `OrdersController`
  (`apps/api/src/orders/orders.controller.ts`, gateado por `AdminGuard` —
  reusado, sin modificar):
  - `GET /v1/admin/orders` — listado paginado/ordenable/filtrable, **excluye
    `pending_payment` y `cancelled` siempre** (AC-1, AC-5, AC-8).
  - `GET /v1/admin/orders/{id}` — detalle con ítems, contacto del comprador,
    retiro en sucursal e historial de cambios de estado (AC-2, AC-9). 404 si
    la orden es `pending_payment` (AC-8). `{id}` está restringido por regex de
    forma UUID en la ruta — ver "Colisión de rutas con US-023" abajo, es la
    pieza que hace que este plan sea seguro sin importar qué change mergea
    primero.
  - `PATCH /v1/admin/orders/{id}` `{ status }` — única transición hacia
    adelante (`preparing`/`ready`/`delivered`), validada server-side contra una
    FSM propia de 4 estados (AC-3, AC-6). `ready` dispara
    `NotificationPort.orderReadyForPickup` (AC-4, seam — la entrega real es
    US-011).
- **Tabla nueva `order_status_history`** (aditiva, FK a `orders`) — resuelve
  AC-9. Cada transición de este endpoint escribe una fila (`from_status`,
  `to_status`, `changed_by`, `changed_at`) en la misma transacción que el
  `UPDATE` de `orders.status`. **No** escribe la fila inicial
  `pending_payment → new` — esa transición la dispara la confirmación de pago
  de US-023, un change distinto que este plan no toca ni depende de que exista
  (ver Out of scope).
- **Extiende `checkout/orders.repository.ts`** (no lo reemplaza, mismo patrón
  que ya usa US-023 ahí mismo) con `list`, `findById`,
  `updateStatusConditional` — sigue siendo el único punto de ORM para
  `orders`/`order_items` (convención local del archivo, §5 del repo).
- **`NotificationPort` — nuevo** (`apps/api/src/orders/ports/`), con un único
  método `orderReadyForPickup`. `LoggingNotificationAdapter` lo implementa sin
  loguear PII. US-011 reemplaza el adaptador cuando exista un proveedor real.
- **`OrderEventsService` — nuevo** (`apps/api/src/observability/`, mismo
  esqueleto que `CheckoutEventsService`), con `order.status_changed` y
  `order.transition_rejected`.
- **Dos errores de dominio nuevos** en `apps/api/src/orders/orders-errors.ts`:
  `OrderNotFoundError` (404, `dsm:orders/not-found`) y
  `OrderInvalidTransitionError` (409, `dsm:orders/invalid-transition`).
- Contrato publicado en `apps/api/docs/api/openapi.yaml`.

**No toca**: `AdminGuard`, el filtro global RFC 7807 (`HttpProblemFilter`),
`checkout.controller.ts`/`checkout.service.ts` (sólo se agrega un `exports` a
`checkout.module.ts`), ni ningún archivo de
`openspec/changes/US-023-pago-manual-offline-backend/` (fuera de alcance de
este agente, por instrucción explícita).

## AC de la US cubiertos por este change

| AC | Cubierto | Nota |
|---|---|---|
| AC-1 listado paginado/ordenable/filtrable | ✅ | `GET /v1/admin/orders` — offset/limit + `sort` + `status` |
| AC-2 detalle con ítems/contacto/retiro | ✅ | `GET /v1/admin/orders/{id}` |
| AC-3 avanzar estado | ✅ | `PATCH` — un paso adelante, validado contra la FSM propia |
| AC-4 "lista" avisa al cliente | ✅ (seam) | `NotificationPort.orderReadyForPickup` invocado; entrega real `Deferred: US-011 — owner: BE` |
| AC-5 filtrar por estado | ✅ | `status` query param, allowlist de 4 valores activos |
| AC-6 transición inválida bloqueada — **autoridad real** | ✅ | FSM propia server-side; 409 sin importar qué mostró la UI |
| AC-7 acceso restringido — **autoridad real** | ✅ | `AdminGuard` en los tres endpoints; barrido en `e2e-rbac.spec.ts` |
| AC-8 solo pagadas — **autoridad real** | ✅ | Listado excluye `pending_payment`/`cancelled` siempre; detalle excluye `pending_payment` |
| AC-9 trazabilidad | ✅ (scope: transiciones iniciadas por el dueño en fulfillment) | `order_status_history`, transaccional. La transición inicial `pending_payment → new` NO entra acá — ver Out of scope |

## Decisiones de este regenerate (mandato del agente orquestador)

### 1 — Dónde vive la superficie admin de órdenes

**Se crea `apps/api/src/orders/`** para el controller/servicio/FSM/puerto de
notificación/repositorio de historial, pero **la lectura/escritura de
`orders`/`order_items` se agrega a `checkout/orders.repository.ts`**, no a un
repositorio nuevo. Es el mismo patrón que US-023 ya aplicó ahí mismo
(`transitionToNewIfPending`, `listByStatus`) — dos changes hermanos
extendiendo el mismo archivo por el mismo motivo (convención local: un solo
punto de ORM por tabla), sin pisarse porque tocan métodos distintos.
`OrdersModule` importa `CheckoutModule` para inyectar `OrdersRepository` —
igual que `PaymentsModule` de US-023 — y agrega el `exports: [OrdersRepository]`
a `checkout.module.ts` de forma **idempotente** (si US-023 ya lo agregó cuando
esta task se ejecute, es un no-op verificado, no una segunda declaración).

### 2 — Riesgo de reconciliación futura con US-010 (flageado, no resuelto acá)

Cuando US-009 salga de `Blocked` y alguien retome
`US-010-orden-webhook-stock-backend`, su propio `design.md` §D9 todavía
describe un módulo `src/orders/` con una FSM de 6 estados y un
`NotificationPort` compartido. Para entonces, `src/orders/` **va a existir
ya** — con una FSM de sólo 4 estados (la que este change construye) y un
`NotificationPort` con un solo método. Quien planifique US-010 en ese momento
va a tener que decidir: ampliar la FSM de este módulo a los 6 estados
(consolidando `pending_payment→new` y `→cancelled` acá), o mantener las
transiciones federadas por módulo (`payments/` decide `pending_payment→new`,
`orders/` decide las 4 activas, un futuro `US-013` decide `→cancelled`). **Esa
decisión no se toma en este change** — es una tensión estructural legítima que
se deja explícita para quien re-planifique US-010, no una resolución
silenciosa.

### 3 — Vista de "pendientes de pago": coexistencia, no absorción

La nota del 2026-08-30 en `docs/user-stories/US-012-panel-ordenes-dueno.md`
§10 (agregada — todavía sólo *staged*, sin commitear — en el worktree de
US-023; confirmado vía `git diff --cached` ahí, no visible en este worktree
hasta que esa sesión commitee) pide que el dueño tenga una vista separada de
órdenes `pending_payment` para poder confirmarles el pago, **distinta** de la
cola operativa de fulfillment.

Se decide **coexistencia, reusando el endpoint que US-023 ya planificó**
(`GET /v1/admin/orders/pending-payment`) en vez de duplicarlo:

- `GET /v1/admin/orders` (este change) sigue excluyendo `pending_payment`
  siempre — AC-8 literal ("solo pagadas") queda intacto, sin agregar
  `pending_payment` a la allowlist del filtro `status`.
- La vista de "pendientes de pago" que la nota de la US pide es
  `GET /v1/admin/orders/pending-payment` (US-023, ya diseñado: angosto, sin
  paginación, sin email/teléfono del comprador). El FE compone ambos
  endpoints en dos tabs — decisión que le corresponde al plan de FE, no a
  este documento (que no lo edita).
- Se descarta que este change absorba/reemplace ese endpoint: duplicaría un
  endpoint ya planificado y forzaría a este change a depender de la tabla
  `payments` de US-023, que este plan explícitamente evita.

### 4 — Colisión de rutas con US-023 (encontrada y resuelta, no sólo flageada)

`PaymentConfirmationController` de US-023 registra
`GET /v1/admin/orders/pending-payment` bajo el mismo `@Controller('v1/admin/orders')`
base que este change. Sin mitigación, `GET /v1/admin/orders/:id` (este change)
puede **interceptar** esa ruta literal si el módulo de este change se registra
antes que el de US-023 en `app.module.ts` — Express/Nest resuelven rutas en
orden de registro, no por especificidad. Se resuelve **sin depender del orden
de merge de los dos changes**: `:id` se restringe con una forma UUID
(`:id([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})`)
en la ruta de Nest, de forma que `pending-payment` (no tiene forma UUID) nunca
matchea `:id` sin importar qué controller se registró primero. Ver `design.md`
§D6.

### 5 — Idempotencia / 409, consistencia con US-023

Se mantiene `OrderInvalidTransitionError` propio (409,
`dsm:orders/invalid-transition`) y la idempotencia estructural (`UPDATE`
condicional `WHERE status=$from` + relectura) — el mismo criterio que la
versión anterior ya había fijado, ahora con un precedente más fuerte: US-023
implementa el **mismo patrón exacto** (`OrderNotPendingPaymentError`, 409,
`dsm:payments/order-not-pending-payment`, `UPDATE ... WHERE status='pending_payment'`)
para su propia transición. Los dos nombres de error siguen la misma
convención `dsm:{módulo}/{condición}` — consistencia de naming entre los dos
changes hermanos del dominio de órdenes, sin que ninguno dependa del código
del otro.

## Out of scope

- **La fila inicial de `order_status_history` (`pending_payment → new`)** —
  esa transición la dispara `ConfirmOrderService` de US-023, un archivo que
  todavía no existe en este worktree/rama y que este agente no puede editar
  (change distinto, en curso, sin commitear). El historial de esta US empieza
  desde la primera transición **iniciada por el dueño** en fulfillment
  (`new → preparing`, etc.) — consistente con la letra de AC-9 ("dado que el
  dueño cambia el estado de una orden"). La auditoría de *quién y cuándo*
  confirmó el pago ya la cubre `payments.confirmed_by`/`processed_at` (US-023
  AC-6), sin necesidad de una segunda fila acá. `Deferred: US-023 — owner: BE
  del próximo touch de ConfirmOrderService, si se decide unificar el
  historial completo de una orden en una sola tabla`.
- **Cancelación / reembolso / reintegro de stock** — US-013. La transición a
  `cancelled` no es alcanzable desde este `PATCH`. `Deferred: US-013 — owner: BE`
- **El envío del email en sí** (contenido, proveedor) — US-011.
  `Deferred: US-011 — owner: BE`
- **Panel de métricas/gráficos** — US-016.
- **`GET /v1/admin/orders/pending-payment`** — ya construido por US-023, este
  change lo referencia, no lo duplica (ver decisión 3).
- **Índice nuevo sobre `orders(created_at)`** — a ~100 órdenes/mes, un scan
  secuencial (ya cubierto por el índice existente `orders(status, created_at)`)
  es submilisegundo.

## Open questions (propias de este backend)

- **OQ-BE-1**: ¿el detalle de una orden `cancelled` debería ser visible por id
  aunque nunca aparezca en el listado? Este plan dice que sí (defensivo, sin
  disclosure porque no es enumerable desde el listado). Si el PO prefiere 404
  también para `cancelled`, es un cambio de una condición.
- **OQ-BE-2**: ¿el filtro `status=` del listado debería aceptar `cancelled`
  como opción? Este plan dice que no (el FE nunca la ofrece). Allowlist
  cerrada de 4 valores salvo objeción.
- **OQ-BE-3 (nueva)**: `order_status_history.changed_by` (agregado por
  consistencia con `payments.confirmed_by` de US-023, no por un AC literal de
  US-012) — ¿vale la pena, o es scope creep de un solo campo? Se incluye
  porque el costo es una columna nullable + una línea de identidad (mismo
  patrón `JwtService.decode` que US-023 ya estableció para no tocar
  `AdminGuard`), y refuerza el control de Repudiation de AC-9. Si el PO lo
  considera innecesario, es una columna menos, sin romper nada más.

## Standards consultados

| Standard | Secciones aplicadas |
|---|---|
| `base-standards.md` | §1 KISS/YAGNI (sin índice nuevo, sin `sort` parseado a mano pudiendo ser `@IsIn`, sin FSM de 6 estados para lo que sólo necesita 4) |
| `backend-standards.md` | capas, errores tipados, transacciones, persistencia aditiva |
| `backend-node-standards.md` | §2 capas (controller delgado → service → repository) · §3 DI por token (`NotificationPort`) · §4 DTO + `ValidationPipe` (ya global) · §5 `$transaction` cruzando repositorios (patrón ya establecido por US-023) · §6 errores de dominio + filtro RFC 7807 (genérico, sin cambios) · §8 idempotencia estructural |
| `api-standards.md` | §6 paginación offset · §7.2 `sort` (lista + prefijo `-`) · §8 RFC 7807 · §10 idempotencia (revisada a estructural) · §11 auth en OpenAPI |
| `security-standards.md` | §4 autorización server-side · §4.5 IDOR (ids UUID no enumerables, regex de ruta) · §7.1/§7.5 heredados, sin cambios |
| `observability-standards.md` | §9 sin PII en logs/métricas |
| `testing-standards.md` / `qa-backend-standards.md` | §14 pirámide; ownership — E2E cross-stack y BDD son QA-owned |
| `data-architecture-patterns` (skill) | evaluación §D2 de `design.md` — PostgreSQL puro, sin Mode B |
| `threat-modeling-lite` (skill) | STRIDE §D8 de `design.md` |

## Dependencias

**Ninguna dependencia bloqueante de código.** `orders` (tabla, con su `CHECK`
de 6 estados) ya existe desde la migración de US-008. `AdminGuard` y
`HttpProblemFilter` ya existen. Este es el cambio estructural principal de
este regenerate: la versión anterior tenía un gate T0.1 en rojo contra
US-010; esta versión no tiene ningún gate — se puede ejecutar hoy.

**Dependencia no bloqueante, informativa**: `US-023-pago-manual-offline-backend`
(en planificación, 0 tasks) es quien hace que las órdenes lleguen a `new` en
primer lugar. Sin ese change ejecutado, este panel puede construirse y
probarse igual (los tests siembran órdenes directo en el estado que
necesitan, sin pasar por el flujo de pago real) pero no tendría datos reales
que gestionar en producción hasta que US-023 aterrice. No es un `blocked_by`
de este plan.

## Linear

MCP de Linear no conectado — proyecto local-only. No se crean sub-tasks en Linear.

## References

- User story: [`docs/user-stories/US-012-panel-ordenes-dueno.md`](../../../docs/user-stories/US-012-panel-ordenes-dueno.md)
- PRD: [`docs/product/prd.md`](../../../docs/product/prd.md) §2.1 capacidad 5, §6
- E2E: [`docs/product/design-e2e.md`](../../../docs/product/design-e2e.md) §6.1, §8, §9.4, §12, §14, §17, §18
- Change relacionado (informativo, no bloqueante, no editado por este agente):
  [`US-023-pago-manual-offline-backend`](../../../../US-023-pago-manual-offline/openspec/changes/US-023-pago-manual-offline-backend/design.md)
  (worktree separado) — precedente de patrón (extender `checkout/orders.repository.ts`,
  409 por conflicto de estado, `JwtService.decode` sin tocar `AdminGuard`) y
  dueño de `GET /v1/admin/orders/pending-payment` (decisión 3).
- Nota §10 de la US (staged, sin commitear, en el worktree de US-023):
  requiere la vista separada de `pending_payment` — resuelta en decisión 3.
- Sibling FE (bloqueado por este change, solo lectura):
  [`US-012-panel-ordenes-dueno-frontend-web`](../US-012-panel-ordenes-dueno-frontend-web/design.md)
  §D2 — **su contrato asumido difiere del de este plan** en dos campos:
  `confirmed_at` no existe (se usa `created_at`, la columna real) y el
  default de `sort` es `-created_at`, no `-confirmed_at`. Queda anotado para
  que la sesión que retome el plan de FE lo ajuste.
- Changes relacionados: US-011 (implementa `orderReadyForPickup`), US-013
  (reintegro de stock + `cancelled`), US-016 (consume `order.status_changed`)
- Versión anterior de este plan (contexto histórico, no vigente):
  `openspec/changes/_backups/2026-08-30-US-012-panel-ordenes-dueno-backend/`
