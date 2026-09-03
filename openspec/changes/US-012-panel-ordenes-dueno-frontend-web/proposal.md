---
tracker-id: null
tracker-source: null
parent-us: US-012
discipline: frontend-web
variant: null
language: es
audit-derived: false
realigned-at: 2026-08-30
realigned-reason: >
  `US-012-panel-ordenes-dueno-backend` fue regenerado (ver su proposal.md,
  `regenerated-reason`): la columna real de `orders` es `created_at`, no
  `confirmed_at` (que nunca existió); `sort` es un enum cerrado de 6 valores,
  no un parser libre; `AdminOrderStatusChange` ganó `changed_by`. Este plan de
  FE se realinea a ese contrato ratificado. Además se agrega la vista de
  "pendientes de pago" (nota §10 de la US, coexistencia decidida por el
  backend regenerado, decisión 3 de su proposal.md) — ver sección nueva abajo.
  No es una de las 9 AC formales de la US — ver Open questions.
---

# Proposal — Panel de órdenes del dueño (frontend)

> **Ticket**: US-012 — Panel de órdenes del dueño + gestión de estados
> **Author**: frontend-web-developer agent (assisted by @gabogosp)
> **Date**: 2026-08-30
> **Status**: Proposed
> **Affected layers**: routing, componentes, repository (HTTP client generado), state
> **Affected platform**: web (Next.js, admin route group)

## Why

US-012 es la mitad "el dueño prepara y entrega" del loop E2E del PRD (E2E §9.4). Hoy el
dueño no tiene forma de ver qué se vendió ni de avanzar una orden de "nueva" a "entregada":
sin este panel, US-010 confirma órdenes que nadie puede gestionar. El E2E fija el contrato a
nivel componente (`Rel(web, orders, "GET/PATCH /admin/orders")`, §6.2) y la secuencia exacta
(§9.4): listar, marcar "lista para retirar" (dispara el aviso de US-011), marcar "entregada".
La FSM de la orden (§12) tiene 6 estados; este panel opera sobre los 4 activos que le
corresponden al dueño (`new → preparing → ready → delivered`) — `pending_payment` nunca se
muestra (AC-8) y `cancelled` es de US-013.

Esta es la mitad **FE** de US-012. El backend que expone `GET/PATCH /admin/orders` es un
change separado (`US-012-panel-ordenes-dueno-backend`) que **todavía no existe** — ver
"Dependencia cruzada" abajo.

## What

Un nuevo módulo `admin/ordenes` dentro del route group `(admin)` existente
(`apps/web/app/(admin)/`), reutilizando `AdminGuard` (`apps/web/src/features/auth/guard.tsx`)
sin modificarlo:

- **Listado** (`/admin/ordenes`): tabla TanStack (mismo patrón que
  `ProductList.tsx`) con paginación server-side, orden por columna (`aria-sort`) y filtro por
  estado. Columnas: Nº de orden, cliente, total (ARS), estado (`OrderStatusBadge`), fecha de
  creación (`created_at` — columna real de `orders`, no `confirmed_at`, que nunca existió; ver
  "Actualización" en el frontmatter y `design.md` §D2).
- **Detalle** (`/admin/ordenes/[id]`): ítems (cantidad + precio), datos de contacto del
  comprador, retiro en sucursal, acciones de avance de estado, historial de cambios de estado
  (§11.bis.4 — audit trail).
- **Acciones de estado** (`OrderStatusActions`): un solo botón visible por orden — el único
  paso siguiente válido de la FSM — con UI optimista + rollback (frontend-resilience-patterns
  #4) y bloqueo estructural de transiciones inválidas (AC-6: la UI nunca ofrece un salto
  inválido; si el backend igual lo rechaza — carrera entre dos pestañas —, se revierte el
  estado optimista y se muestra el error).
- **`OrderStatusBadge`**: texto + color por estado, siguiendo design-system §7.7.
- **Vista de "pendientes de pago"** (`PendingPaymentsPanel`, nueva — segunda pestaña de
  `/admin/ordenes`, **no** un tab dentro de `OrdersList` ni una opción de su filtro de estado):
  permite al dueño confirmar manualmente el pago de una orden `pending_payment` (botón
  "Confirmar pago" por fila). Consume dos endpoints **ya planificados por
  `US-023-pago-manual-offline-backend`** (`GET /v1/admin/orders/pending-payment`,
  `POST /v1/admin/orders/{orderId}/confirm-payment`), no construidos por este change ni por su
  backend hermano — ver "Vista de pendientes de pago" abajo y `design.md` §D9.
  **Importante**: esto NO es una de las 9 AC Gherkin formales de esta US — nace de una nota
  informal §10 de la US, no de un AC ratificado. Se planifica igual porque el backend
  regenerado ya decidió reusarla (coexistencia, no absorción); ver Open questions.

## Out of scope

- Cancelación / reembolso / reintegro de stock — US-013.
- El envío del email en sí (contenido, proveedor) — US-011. Esta US solo dispara la
  transición que el backend usa como trigger.
- Panel de métricas / gráficos — US-016.
- Creación / confirmación de la orden — US-010 (backend, aún Draft — ver dependencia).
- Envío a domicilio — roadmap.
- Migrar `adminSession`/el cliente HTTP a cookies `httpOnly` — ese endurecimiento es
  `AUDIT-dsm-web-007-endurecimiento-panel-frontend-web` (change ya planificado, 0/15 tasks
  cerradas). Este change usa el mecanismo de auth **actual** del panel (Bearer +
  `sessionStorage`, `adminSession.ts`), igual que `ProductList`/`ImportScreen` hoy.
- Nav/shell persistente del admin (sidebar con links a todas las secciones) — no existe hoy
  (cada página admin es standalone, ver `app/(admin)/admin/productos/page.tsx`); no se
  introduce acá para no re-arquitecturar el shell del panel fuera de esta US.

## Dependencia cruzada (bloqueante)

**El contrato `GET/PATCH /admin/orders` no existe todavía construido.** Verificado en
`apps/api/docs/api/openapi.yaml`: no hay ningún path `/admin/orders*`. **Actualización tras la
regeneración del backend**: la tabla `orders`/`order_items` **ya existe** (migrada por
`US-008-checkout-guest-backend`, ya mergeado) — el backend regenerado dejó de depender de
`US-010-orden-webhook-stock-backend` (que sigue `Draft` indefinidamente, sin fecha) y se
funda directamente sobre esa tabla real. El único change que sigue bloqueando a este FE es:

1. **`US-012-panel-ordenes-dueno-backend`** — planificado (regenerado 2026-08-30), 0 tasks
   ejecutadas todavía. Es quien declara el contrato OpenAPI de listado/detalle/PATCH que este
   FE consume vía codegen (`orval`, `frontend-standards.md` §3.1/§3.2).

Adicionalmente, la vista de pendientes de pago (ver arriba) depende de
`US-023-pago-manual-offline-backend` (planificado, 0 tasks ejecutadas, worktree separado) —
esa dependencia es específica de `PendingPaymentsPanel`, no del panel de fulfillment
(`OrdersList`/`OrderDetail`/`OrderStatusActions`), que sólo depende del punto 1.

Este plan documenta en `design.md` §D2/§D9 la forma de contrato **ratificada** (ya no una
propuesta abierta) para que el desarrollo de FE tenga tipos exactos que generar en cuanto el
backend publique su OpenAPI, pero **ningún task de este `tasks.md` puede cerrarse antes de que
el contrato exista** — la Fase 0 lo convierte en un gate explícito y verificable, no solo en
una nota de esta sección.

## Affected components / screens

- `apps/web/app/(admin)/admin/ordenes/page.tsx` — nueva ruta, listado.
- `apps/web/app/(admin)/admin/ordenes/[id]/page.tsx` — nueva ruta, detalle.
- `apps/web/src/features/orders/ordersService.ts` — nuevo repositorio (tipos derivados del
  contrato, igual que `productsService.ts`).
- `apps/web/src/features/orders/orderStatus.ts` — helper puro de la FSM (vista FE).
- `apps/web/src/features/orders/OrderStatusBadge.tsx` — nuevo.
- `apps/web/src/features/orders/OrdersList.tsx` — nuevo.
- `apps/web/src/features/orders/OrderDetail.tsx` — nuevo.
- `apps/web/src/features/orders/OrderStatusActions.tsx` — nuevo.
- `apps/web/src/features/orders/OrderStatusHistory.tsx` — nuevo.
- `apps/web/src/features/orders/PendingPaymentsPanel.tsx` — nuevo (vista de pendientes de
  pago, ver `design.md` §D9).
- `apps/web/src/features/orders/pendingPaymentsService.ts` — nuevo repositorio, separado de
  `ordersService.ts` (concern distinto, endpoints de un backend hermano — `design.md` §D9).
- `apps/web/orval.config.ts` — sin cambios de configuración (el mismo `dsmCatalog`/
  `dsmCatalogZod` ya apunta al contrato completo; solo hace falta re-generar cuando el
  contrato tenga los paths nuevos).

## API consumption

Contrato **ratificado** por el backend regenerado (`US-012-panel-ordenes-dueno-backend`
design.md §D3 — todavía sin construir, pero ya no es una propuesta abierta de este plan):

| Endpoint | Uso | AC |
|---|---|---|
| `GET /v1/admin/orders?status=&limit=&offset=&sort=` | Listado paginado/ordenable/filtrable, solo pagadas — `sort` es un **enum cerrado de 6 valores** (`order_number`, `-order_number`, `created_at`, `-created_at`, `total_ars_cents`, `-total_ars_cents`; default `-created_at`), no un parser libre ni dos params separados (ver OQ-FE-3, resuelta) | AC-1, AC-5, AC-8 |
| `GET /v1/admin/orders/{id}` | Detalle: ítems, comprador, retiro, historial de estado (incluye `changed_by`, nuevo) | AC-2, AC-9 |
| `PATCH /v1/admin/orders/{id}` `{ status }` | Transición de estado | AC-3, AC-4, AC-6, AC-9 |

Endpoints de la vista de pendientes de pago (planificados por
`US-023-pago-manual-offline-backend`, no por este change ni por su backend hermano — ver
"Vista de pendientes de pago" arriba y `design.md` §D9):

| Endpoint | Uso | Cubre |
|---|---|---|
| `GET /v1/admin/orders/pending-payment` | Listado sin paginación de órdenes `pending_payment` (`order_number`, `buyer_name`, `total_ars_cents`, `created_at`) | Nota §10 de la US (no AC formal) |
| `POST /v1/admin/orders/{orderId}/confirm-payment` | Confirma el pago manual; `200 { order_number, status: "new" }` | Nota §10 de la US (no AC formal) |

Detalle completo de los shapes en `design.md` §D2 (contrato de fulfillment) y §D9 (pendientes
de pago).

## Acceptance criteria (mapeo con las 9 AC de la US)

- [ ] **AC-1** (ver listado): `OrdersList` — tabla con cliente/total/estado/fecha, paginable,
      ordenable (`aria-sort`) y filtrable.
- [ ] **AC-2** (ver detalle): `OrderDetail` — ítems, contacto del comprador, retiro en
      sucursal.
- [ ] **AC-3** (avanzar estado): `OrderStatusActions` — un botón por el único paso siguiente
      válido de la FSM (nueva→preparando→lista→entregada).
- [ ] **AC-4** (aviso al marcar "lista"): la transición a `ready` es la que dispara el aviso
      — el trigger es 100% backend (US-011); el trabajo de FE es únicamente emitir el `PATCH
      {status: ready}` en el momento correcto y comunicar en la UI que "se avisó al cliente"
      tras el 200.
- [ ] **AC-5** (filtrar por estado): filtro controlado en `OrdersList` sobre `status=`.
- [ ] **AC-6** (transición inválida bloqueada): la UI solo ofrece el siguiente estado válido
      (bloqueo estructural); si el backend igual rechaza (409, carrera entre pestañas),
      rollback del estado optimista + mensaje — nunca se asume éxito sin confirmación del
      backend.
- [ ] **AC-7** (acceso restringido): heredado de `AdminGuard` + el route group `(admin)` —
      las rutas nuevas se colocan dentro de ese group, sin tocar el guard.
- [ ] **AC-8** (solo pagadas): el filtro de estado del FE nunca ofrece `pending_payment` como
      opción; el listado confía en que el backend ya excluye esas órdenes (autoridad real es
      server-side, per US §9 NFR de autorización).
- [ ] **AC-9** (trazabilidad): `OrderStatusHistory` en el detalle, alimentado por el campo de
      historial que el contrato debe exponer (§11.bis.4 — audit trail); incluye `changed_by`
      cuando el backend lo provee (campo nuevo, no un AC literal — ver `design.md` §D2/§D8).

> **`PendingPaymentsPanel` no tiene un AC propio en esta lista** — las 9 son las de la US tal
> como está escrita hoy. Se construye igual por la decisión de coexistencia del backend
> regenerado (ver "Vista de pendientes de pago" arriba); ver Open questions para el pedido de
> formalizarla.

## Standards consulted

- `docs/base-standards.md`
- `docs/code/frontend-standards.md` §3 (API consumption / codegen), §8 (HTTP client), §9
  (state), §11.1-11.9 (implementation patterns), §11.bis (backoffice — tablas, permisos,
  confirmación destructiva, auditoría), §12 (seguridad)
- `docs/code/frontend-next-standards.md` (overlay — App Router, Server/Client Components)
- `docs/architecture/api-standards.md` (RFC 7807, idempotencia, paginación)
- `docs/cross-cutting/security-standards.md` §7 (cookies/CSRF — sin cambios en este change,
  ver "Out of scope")
- `docs/quality/testing-standards.md` §14
- `docs/quality/qa-frontend-standards.md` §19 (a11y), §23 (Vitest+RTL+MSW), §24 (referencia,
  BDD es QA-owned)

## Open questions

> **Actualización 2026-08-30 (realineación)**: `US-012-panel-ordenes-dueno-backend` fue
> **regenerado** (ver su proposal.md `regenerated-reason`) desde la versión que había resuelto
> OQ-FE-1/2/3 la primera vez. Las tres siguen resueltas, pero dos de ellas cambiaron de
> respuesta concreta en la regeneración (columna real `created_at`, no `confirmed_at`; `sort`
> ahora es un enum cerrado de 6 valores, no un param libre con prefijo). Se deja la redacción
> original (contexto histórico) + la resolución vigente al final de cada una. Se agrega
> OQ-FE-4, nueva de esta realineación.

- **OQ-FE-1**: el DER del E2E §8 no modela una tabla/registro de "historial de cambio de
  estado" (solo `orders.delivered_at` y timestamps puntuales). AC-9 pide "estado anterior,
  nuevo y marca temporal" consultable. ¿El backend expone esto como una tabla nueva
  (`order_status_history`) o reconstruye una vista simplificada a partir de columnas
  puntuales? Este plan asume lo primero (un array `status_history` en el detalle) porque es
  lo único que satisface AC-9 literalmente — a ratificar con quien planifique
  `US-012-panel-ordenes-dueno-backend`.
  **Resuelta — RATIFICADA, con un campo extra** (`US-012-panel-ordenes-dueno-backend`
  design.md §D2): tabla `order_status_history`, mismo shape propuesto acá, **más**
  `changed_by` (nullable — no estaba en la propuesta original de este plan). Este plan se
  actualizó (`design.md` §D2/§D8) para reflejarlo.
- **OQ-FE-2**: ¿el backend soporta `Idempotency-Key` en el `PATCH` de transición? Este plan
  envía el header igual (defensivo) y no hace retry automático de la mutación.
  **Resuelta — REVISADA** (`US-012-panel-ordenes-dueno-backend` design.md §D4): el backend NO
  almacena la clave; usa idempotencia estructural por estado (`UPDATE` condicional). El header
  se acepta pero se ignora — documentado así en el contrato. Nada que cambiar en este plan.
- **OQ-FE-3**: ¿`sort`/`order` como query params separados, o un único parámetro combinado?
  Este plan asumía originalmente dos params separados, luego un solo param libre
  (`-confirmed_at`).
  **Resuelta — REVISADA de nuevo, tras la regeneración del backend** (design.md §D5): un solo
  param `sort`, pero como **enum cerrado de 6 valores** (`order_number`, `-order_number`,
  `created_at`, `-created_at`, `total_ars_cents`, `-total_ars_cents`; default `-created_at` —
  ni `confirmed_at` existe como columna, ni `sort` acepta valores fuera del enum). **Este plan
  se actualizó de nuevo** (`design.md` §D2/D3/D5, `tasks.md` T4.1) para: (a) usar `created_at`
  en vez de `confirmed_at` en todo el plan, (b) restringir las columnas ordenables de
  `OrdersList` a las 3 que el enum permite (Nº de orden, total, fecha — **no** cliente ni
  estado, que nunca tuvieron un campo `sort` que las respalde).
- **OQ-FE-4 (nueva)**: la vista de "pendientes de pago" (nota §10 de la US, ver "Vista de
  pendientes de pago" y `design.md` §D9) **no tiene un AC Gherkin formal** en
  `docs/user-stories/US-012-panel-ordenes-dueno.md` — nace de una nota informal, no de una de
  las 9 AC ratificadas. Este plan la construye igual porque el backend regenerado ya decidió
  reusar el endpoint de `US-023-pago-manual-offline-backend` (coexistencia, decisión 3 de su
  proposal.md) y dejarlo sin consumidor FE sería peor. **Recomendación**: que el PO o quien
  mantenga la US considere un CR (change request) o una enmienda a la US agregando un AC-10
  formal para esta vista — este plan no tiene autoridad para inventar esa AC por su cuenta.
  Hasta que eso ocurra, `PendingPaymentsPanel` queda documentado como "feature aditiva sin AC
  propio", con sus propias tasks y Exit criteria en `tasks.md`, pero fuera de la matriz de
  trazabilidad de las 9 AC.
- **Bloqueante de todo lo anterior**: el contrato no existe todavía construido (ver
  "Dependencia cruzada"). Nada de este plan puede ejecutarse hasta que
  `US-012-panel-ordenes-dueno-backend` publique su OpenAPI — su plan ya no depende de
  `US-010-orden-webhook-stock-backend` (regenerado sobre la tabla real de US-008; ver su
  proposal.md), así que ese gate de T0.1 se angosta a un solo change bloqueante, no dos.

## Linear

MCP de Linear no conectado — proyecto local-only. No se crean sub-tasks en Linear.
