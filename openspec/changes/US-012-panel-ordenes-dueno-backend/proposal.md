---
tracker-id: null
tracker-source: null
parent-us: US-012
discipline: backend
variant: null
language: es
audit-derived: false
---

# Proposal — Panel de órdenes del dueño (backend)

> **Ticket**: US-012 — Panel de órdenes del dueño + gestión de estados
> **Author**: backend-node-developer agent (assisted by @gabogosp)
> **Date**: 2026-08-30
> **Status**: Proposed
> **Affected layers**: controller, service, repository, DTO, dominio (FSM reusada de
> US-010), persistencia (tabla nueva aditiva), observabilidad
> **Affected platform**: `apps/api` (NestJS)

## Why

US-012 es la mitad "el dueño prepara y entrega" del loop E2E del PRD (§9.4). US-010
confirma la orden (`pending_payment → new`) pero no expone ninguna forma de que el dueño
la vea ni la avance — sin este change, una orden pagada queda invisible. El E2E fija el
contrato a nivel componente (`Rel(web, orders, "GET/PATCH /admin/orders")`, §6.1) y la
secuencia exacta de fulfillment (§9.4): listar sólo pagadas, marcar "lista para retirar"
(dispara el aviso de US-011), marcar "entregada". La FSM de la orden (§12, `order-state.ts`
de US-010) ya declara las transiciones `new → preparing → ready → delivered`; este change
es quien las **expone** por HTTP y quien decide qué pasa alrededor de ellas (autorización,
filtro server-side, trazabilidad).

Esta es la mitad **BE** de US-012. El sibling
[`US-012-panel-ordenes-dueno-frontend-web`](../US-012-panel-ordenes-dueno-frontend-web/)
ya está planificado (bloqueado por este change) y dejó una forma de contrato propuesta en
su `design.md` §D2 junto con tres preguntas abiertas (OQ-FE-1/2/3) dirigidas explícitamente
a quien planificara este backend. Este proposal las resuelve una por una (ver
"Decisiones sobre las preguntas del FE" abajo) — la más importante ratifica el shape de
listado/detalle y dos revisan el shape de `sort` y el mecanismo de idempotencia.

## What

**Extiende `src/orders/` (creado por US-010)** — no crea un segundo módulo de órdenes, no
reabre la FSM ni las columnas que US-010 declaró (`confirmed_at`, `cancelled_at`,
`order-state.ts`). Agrega:

- **Tres endpoints admin** en `OrdersController` (nuevo, `src/orders/orders.controller.ts`,
  gateado por `AdminGuard` — reusado, sin modificar):
  - `GET /v1/admin/orders` — listado paginado/ordenable/filtrable, **excluye
    `pending_payment` y `cancelled` siempre** (AC-1, AC-5, AC-8).
  - `GET /v1/admin/orders/{id}` — detalle con ítems, contacto del comprador, retiro en
    sucursal e historial de cambios de estado (AC-2, AC-9). 404 si la orden es
    `pending_payment` (AC-8) — `cancelled`/`delivered` sí son visibles por id (defensivo,
    no gestionable, no enumerable desde el listado).
  - `PATCH /v1/admin/orders/{id}` `{ status }` — única transición hacia adelante
    (`preparing`/`ready`/`delivered`), validada contra `canTransition` de
    `order-state.ts` (AC-3, AC-6). `ready` dispara `NotificationPort.orderReadyForPickup`
    (AC-4, seam — la entrega real es US-011, igual que US-010 dejó `orderConfirmed`).
- **Tabla nueva `order_status_history`** (aditiva, FK a `orders`) — resuelve AC-9 con una
  trazabilidad real (estado anterior, nuevo, marca temporal), no una aproximación con
  columnas puntuales. Cada transición de este endpoint escribe una fila en la misma
  transacción que el `UPDATE` de `orders.status`. Se extiende también
  `ConfirmOrderService` (de US-010) para escribir la fila inicial
  (`null → new`) en su propia transacción — sin esa fila, el historial de una orden
  recién confirmada empezaría vacío en vez de mostrar su origen.
- **`NotificationPort` (de US-010) gana `orderReadyForPickup`** — mismo seam, mismo
  `LoggingNotificationAdapter` (sin PII en el log), mismo dueño del reemplazo (US-011).
- **Dos errores de dominio nuevos** en `src/orders/orders-errors.ts`:
  `OrderNotFoundError` (404, `dsm:orders/not-found`) y `OrderInvalidTransitionError` (409,
  `dsm:orders/invalid-transition` — ver justificación del status code abajo).
- **`OrderEventsService` (de US-010) gana** `order.status_changed` y
  `order.transition_rejected`.
- Contrato publicado en `apps/api/docs/api/openapi.yaml` (los tres paths, el `Idempotency-Key`
  declarado como opcional-e-ignorado con su razón documentada).

**No toca**: `order-state.ts` (se reusa `canTransition` tal cual), las columnas
`confirmed_at`/`cancelled_at` (de US-010), `AdminGuard`, el filtro global RFC 7807
(`HttpProblemFilter` ya mapea cualquier `DomainError` genéricamente), el middleware
`no-store` de `bootstrap.ts` (`/v1/admin` ya está cubierto) ni la allowlist CORS
(`idempotency-key` ya está permitido desde US-006).

## AC de la US cubiertos por este change

| AC | Cubierto | Nota |
|---|---|---|
| AC-1 listado paginado/ordenable/filtrable | ✅ | `GET /v1/admin/orders` — offset/limit + `sort` + `status` |
| AC-2 detalle con ítems/contacto/retiro | ✅ | `GET /v1/admin/orders/{id}` |
| AC-3 avanzar estado | ✅ | `PATCH` — un paso adelante, validado contra la FSM |
| AC-4 "lista" avisa al cliente | ✅ (seam) | `NotificationPort.orderReadyForPickup` invocado; entrega real `Deferred: US-011` |
| AC-5 filtrar por estado | ✅ | `status` query param, allowlist de 4 valores activos |
| AC-6 transición inválida bloqueada — **autoridad real** | ✅ | `canTransition` server-side; 409 sin importar qué mostró la UI |
| AC-7 acceso restringido — **autoridad real** | ✅ | `AdminGuard` en los tres endpoints; barrido en `e2e-rbac.spec.ts` |
| AC-8 solo pagadas — **autoridad real** | ✅ | Listado excluye `pending_payment`/`cancelled` siempre; detalle excluye `pending_payment` |
| AC-9 trazabilidad — **autoridad real** | ✅ | `order_status_history`, escrita transaccionalmente en cada transición |

## Decisiones sobre las preguntas del FE (OQ-FE-1/2/3)

El FE dejó estas tres explícitamente para quien planificara este backend
(`US-012-panel-ordenes-dueno-frontend-web/proposal.md` §Open questions). Cada una se
resuelve acá; **quien retome el plan de FE debe leer esta sección antes de ejecutar** (este
change no edita los archivos del FE — son de solo lectura para este agente).

- **OQ-FE-1 (forma del historial de estado) — RATIFICADA tal cual la propuso el FE.** Se
  crea `order_status_history` (tabla nueva, aditiva, deviación declarada del DER igual que
  `confirmed_at`/`cancelled_at` de US-010) y el detalle expone `status_history: []` con
  `{from_status, to_status, changed_at}` — exactamente el shape de `design.md` §D2 del FE.
  Es la única opción que satisface AC-9 literalmente ("estado anterior, nuevo y marca
  temporal" por cada transición, no sólo hitos puntuales).
- **OQ-FE-2 (Idempotency-Key en el PATCH) — REVISADA.** El backend **no** implementa
  almacenamiento de `Idempotency-Key` (la máquina de `api-standards.md` §10.2). En su
  lugar, el `PATCH` es **idempotente por el estado de los datos**, el mismo patrón que
  ADR-0008/US-010 ya establecieron para el pago ("idempotente por la base, no por un
  `if`"): si `orders.status` ya es el estado pedido, la respuesta es 200 sin re-disparar el
  aviso ni tocar `order_status_history` de nuevo; si el estado actual no admite la
  transición pedida, 409. Esto cubre exactamente el caso que preocupaba al FE (un reintento
  de red tras que el email ya salió no lo duplica) sin agregar un segundo mecanismo de
  idempotencia al proyecto. El header `Idempotency-Key` que el FE ya decidió mandar
  (defensivo) se **acepta y se ignora** — el propio `design.md` del FE ya contemplaba este
  desenlace ("no rompe nada si el backend lo ignora"). CORS ya permite el header desde
  US-006; no hace falta tocar `bootstrap.ts`.
- **OQ-FE-3 (forma de `sort`/`order`) — REVISADA.** En vez de dos query params separados
  (`sort` + `order`), se usa el formato canónico de `api-standards.md` §7.2: un único
  `sort` con lista separada por comas y prefijo `-` para descendente (ej.
  `sort=-confirmed_at`). No hay precedente en el repo de un listado admin ordenable hoy
  (`ProductsController` sólo pagina), así que no hay convención local que romper, y el
  estándar del proyecto ya documenta esta forma. **Quien retome el plan de FE necesita
  ajustar `ordersService.list()` de `{sort, order}` a `{sort: '-confirmed_at'}`** antes de
  ejecutar su Fase 2/5 — queda anotado acá para que no se pierda.

## Standards consultados

| Standard | Secciones aplicadas |
|---|---|
| `base-standards.md` | §1 KISS/YAGNI (sin índice nuevo para ~1.200 filas/año, sin tabla de idempotencia cuando el estado alcanza) |
| `backend-standards.md` | capas, errores tipados, transacciones, persistencia aditiva |
| `backend-node-standards.md` | §2 capas (controller delgado → service → repository) · §3 DI por token (`NotificationPort`) · §4 DTO + `ValidationPipe` (ya global) · §5 `$transaction` + migración aditiva · §6 errores de dominio + filtro RFC 7807 (ya genérico, sin cambios) · §8 idempotencia estructural para mutaciones reintentables |
| `api-standards.md` | §6 paginación offset (`{data, pagination:{limit,offset,total}}`, mismo shape que `ProductListResponse`) · §7.2 `sort` (lista + prefijo `-`) · §8 RFC 7807 · §10 idempotencia (evaluada y revisada a estructural, ver OQ-FE-2) · §11 auth en OpenAPI · §12 rate-limit headers (no aplica — endpoint admin de bajo volumen) |
| `security-standards.md` | §4 autorización (deny-by-default, `AdminGuard` en los tres endpoints, chequeo server-side de la transición — nunca confía en lo que ofreció la UI) · §4.5 IDOR (ids UUID no enumerables, 404 uniforme para `pending_payment`) · §7.1 headers (heredados del borde, sin cambios) · §7.5 CSRF (no aplica — superficie Bearer, no cookie) |
| `observability-standards.md` | §9 sin PII en logs/métricas (el payload de `orderReadyForPickup` lleva email/nombre del comprador; el log del adapter no) |
| `testing-standards.md` / `qa-backend-standards.md` | §14 pirámide (unit del FSM ya cubierto por US-010, integration del repositorio + servicio, e2e del contrato); §2 ownership — E2E cross-stack y BDD son QA-owned, no se planifican acá |

## Dependencia cruzada (bloqueante)

**Este change depende de que `US-010-orden-webhook-stock-backend` esté construido**
(`draft`, 0 tasks cerradas hoy, verificado 2026-08-30): necesita
`orders.confirmed_at`/`cancelled_at`, `src/orders/order-state.ts` (la FSM,
`canTransition`), `src/orders/ports/notification.port.ts` +
`LoggingNotificationAdapter`, y la tabla `payments` (para que "solo pagadas" tenga
sentido). La Fase 0 de `tasks.md` lo convierte en un gate verificable que **falla a
propósito** hoy — mismo patrón que el T0.1 del plan de FE.

El plan de FE (`US-012-panel-ordenes-dueno-frontend-web`) queda desbloqueado por este
change: al cerrar la Fase de contratos (T8.x), `apps/api/docs/api/openapi.yaml` declara
`/admin/orders` y su gate T0.1 deja de fallar.

## Out of scope

- **Cancelación / reembolso / reintegro de stock** — US-013. La transición a `cancelled`
  no es alcanzable desde este `PATCH` (el DTO ni siquiera acepta ese valor).
  `Deferred: US-013 — owner: BE`
- **El envío del email en sí** (contenido, proveedor) — US-011. Este change invoca
  `NotificationPort.orderReadyForPickup`, no lo implementa. `Deferred: US-011 — owner: BE`
- **Panel de métricas/gráficos** — US-016. `order_status_changed` es insumo, no se
  construye ningún agregado acá.
- **Historial para la rama de cancelación automática** (`pending_payment → cancelled` por
  falta de stock o abandono, ambas de US-010) — no escribe en `order_status_history`. AC-9
  de esta US está scoped a transiciones **iniciadas por el dueño**; las automáticas de
  US-010 no tienen "dueño" que trazar en este panel.
- **Índice nuevo sobre `orders(confirmed_at)`** — a ~100 órdenes/mes (PRD §6, 1.200
  filas/año), un scan secuencial es submilisegundo. Si el volumen crece un orden de
  magnitud, es una migración de una línea — se deja anotado en `design.md` Trade-offs.

## Open questions (propias de este backend)

- **OQ-BE-1**: ¿el detalle de una orden `cancelled` debería ser visible por id (`GET
  /v1/admin/orders/{id}`) aunque nunca aparezca en el listado? Este plan dice que sí
  (defensivo, sin riesgo de disclosure porque no es enumerable desde el listado y hoy no
  hay ningún link que lleve a esa id — US-013 todavía no existe). Si el PO prefiere 404
  también para `cancelled` hasta que US-013 exista, es un cambio de una condición en el
  repositorio.
- **OQ-BE-2**: ¿el filtro `status=` del listado debería aceptar `cancelled` como opción
  aunque el default nunca lo muestre? Este plan dice que no (el FE nunca ofrece esa opción
  en el `<select>`, así que aceptarla server-side sin que nadie la pida es superficie sin
  uso). Queda cerrado (allowlist de 4 valores activos) salvo objeción.

## Linear

MCP de Linear no conectado — proyecto local-only. No se crean sub-tasks en Linear.

## References

- User story: [`docs/user-stories/US-012-panel-ordenes-dueno.md`](../../../docs/user-stories/US-012-panel-ordenes-dueno.md)
- PRD: [`docs/product/prd.md`](../../../docs/product/prd.md) §2.1 capacidad 5, §6 (volumetría, retención 12 meses)
- E2E: [`docs/product/design-e2e.md`](../../../docs/product/design-e2e.md) §6.1 (`OrdersModule`), §8 (DER), §9.4 (secuencia de fulfillment), §12 (FSM), §14 (STRIDE — endpoints admin), §17 (NFRs), §18 (observabilidad)
- Change del que depende: [`US-010-orden-webhook-stock-backend`](../US-010-orden-webhook-stock-backend/design.md) (crea `order-state.ts`, `confirmed_at`/`cancelled_at`, `NotificationPort`, `payments`)
- Sibling FE (bloqueado por este change, solo lectura): [`US-012-panel-ordenes-dueno-frontend-web`](../US-012-panel-ordenes-dueno-frontend-web/design.md) §D2 (forma de contrato propuesta), §Open questions (OQ-FE-1/2/3, resueltas arriba)
- Changes relacionados: US-011 (implementa `orderReadyForPickup`), US-013 (reusa `canTransition` para `cancelled` + reintegro de stock), US-016 (consume `order.status_changed`)
