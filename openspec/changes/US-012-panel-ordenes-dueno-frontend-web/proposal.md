---
tracker-id: null
tracker-source: null
parent-us: US-012
discipline: frontend-web
variant: null
language: es
audit-derived: false
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
  confirmación.
- **Detalle** (`/admin/ordenes/[id]`): ítems (cantidad + precio), datos de contacto del
  comprador, retiro en sucursal, acciones de avance de estado, historial de cambios de estado
  (§11.bis.4 — audit trail).
- **Acciones de estado** (`OrderStatusActions`): un solo botón visible por orden — el único
  paso siguiente válido de la FSM — con UI optimista + rollback (frontend-resilience-patterns
  #4) y bloqueo estructural de transiciones inválidas (AC-6: la UI nunca ofrece un salto
  inválido; si el backend igual lo rechaza — carrera entre dos pestañas —, se revierte el
  estado optimista y se muestra el error).
- **`OrderStatusBadge`**: texto + color por estado, siguiendo design-system §7.7.

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

**El contrato `GET/PATCH /admin/orders` no existe todavía.** Verificado en
`apps/api/docs/api/openapi.yaml`: no hay ningún path `/admin/orders*`. Dos changes previos
tienen que aterrizar antes de que este FE pueda generar tipos y desarrollarse:

1. **`US-010-orden-webhook-stock-backend`** — crea las tablas `orders`/`order_items` y la FSM
   (`order-state.ts`). Estado real: `docs/_index/openspec-changes.yaml` lo marca `status:
   draft`, `assignee: sin-asignar`, **0 tasks cerradas**.
2. **`US-012-panel-ordenes-dueno-backend`** — todavía no planificado (no existe el directorio
   en `openspec/changes/`). Es quien declara el contrato OpenAPI de listado/detalle/PATCH que
   este FE consume vía codegen (`orval`, `frontend-standards.md` §3.1/§3.2).

Este plan documenta en `design.md` la forma de contrato **esperada** (derivada del E2E §6.2,
§9.4 y §8 DER) para que la planificación de backend tenga un punto de partida, pero **ningún
task de este `tasks.md` puede cerrarse antes de que el contrato exista** — la Fase 0 lo
convierte en un gate explícito y verificable, no solo en una nota de esta sección.

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
- `apps/web/orval.config.ts` — sin cambios de configuración (el mismo `dsmCatalog`/
  `dsmCatalogZod` ya apunta al contrato completo; solo hace falta re-generar cuando el
  contrato tenga los paths nuevos).

## API consumption

Contrato **esperado** (no existe aún — ver dependencia cruzada), derivado del E2E §6.2/§9.4:

| Endpoint | Uso | AC |
|---|---|---|
| `GET /v1/admin/orders?status=&limit=&offset=&sort=` | Listado paginado/ordenable/filtrable, solo pagadas — `sort` es un solo param (`-confirmed_at` = desc), no `sort`/`order` separados (ver OQ-FE-3, resuelta) | AC-1, AC-5, AC-8 |
| `GET /v1/admin/orders/{id}` | Detalle: ítems, comprador, retiro, historial de estado | AC-2, AC-9 |
| `PATCH /v1/admin/orders/{id}` `{ status }` | Transición de estado | AC-3, AC-4, AC-6, AC-9 |

Detalle completo de los shapes propuestos y de los campos que la US necesita y el DER del E2E
§8 todavía no nombra (p. ej. un registro de historial de estado) en `design.md` §Approach D2.

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
      historial que el contrato debe exponer (§11.bis.4 — audit trail).

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

> **Actualización 2026-08-30**: `US-012-panel-ordenes-dueno-backend` ya está planificado y
> resuelve las tres preguntas de abajo. Se dejan con su redacción original (contexto) + la
> resolución al final de cada una.

- **OQ-FE-1**: el DER del E2E §8 no modela una tabla/registro de "historial de cambio de
  estado" (solo `orders.delivered_at` y timestamps puntuales). AC-9 pide "estado anterior,
  nuevo y marca temporal" consultable. ¿El backend expone esto como una tabla nueva
  (`order_status_history`, deviación declarada del DER, mismo patrón que
  `orders.confirmed_at`/`cancelled_at` en US-010) o reconstruye una vista simplificada a
  partir de columnas puntuales (`confirmed_at`, `updated_at`, `delivered_at`)? Este plan
  asume lo primero (un array `status_history` en el detalle) porque es lo único que satisface
  AC-9 literalmente (estado anterior *y* nuevo, no solo timestamps de hitos) — a ratificar
  con quien planifique `US-012-panel-ordenes-dueno-backend`.
  **Resuelta — RATIFICADA tal cual** (`US-012-panel-ordenes-dueno-backend` design.md §D2):
  tabla `order_status_history`, mismo shape propuesto acá. Nada que cambiar en este plan.
- **OQ-FE-2**: ¿el backend soporta `Idempotency-Key` en el `PATCH` de transición? La
  transición a `ready` tiene un efecto lateral externo (dispara el email de US-011); sin
  dedupe server-side, un reintento de red del mismo intento podría re-disparar el aviso. Este
  plan envía el header igual (defensivo, no rompe nada si el backend lo ignora) y **no**
  hace retry automático de la mutación (solo manual, reusando la misma clave) — a confirmar
  si el backend lo aprovecha.
  **Resuelta — REVISADA** (`US-012-panel-ordenes-dueno-backend` design.md §D4): el backend
  NO almacena la clave; usa idempotencia estructural por estado (un `UPDATE` condicional que
  no re-dispara el efecto lateral si la orden ya está en el estado pedido). El header se
  acepta pero se ignora — documentado así en el contrato. Nada que cambiar en este plan: el
  envío defensivo del header sigue siendo correcto, solo no hace lo que se especulaba.
- **OQ-FE-3**: ¿`sort`/`order` como query params del listado, o el backend prefiere un único
  parámetro combinado (`sort=-confirmed_at`)? Este plan asume dos params separados, mismo
  estilo que `limit`/`offset` ya establecido en `productsService`. A confirmar con backend.
  **Resuelta — REVISADA** (`US-012-panel-ordenes-dueno-backend` design.md §D5): un solo
  param `sort` (`api-standards.md` §7.2 — prefijo `-` = descendente, default
  `-confirmed_at`), no dos separados. **Este plan se actualizó** (`design.md` §D2/D3/D5,
  `tasks.md` T4.1/T4.3) para reflejar el param único — ver esos archivos.
- **Bloqueante de todo lo anterior**: el contrato no existe todavía (ver "Dependencia
  cruzada"). Nada de este plan puede ejecutarse hasta que `US-010-orden-webhook-stock-backend`
  y `US-012-panel-ordenes-dueno-backend` (ambos planificados, 0 tasks cerradas) publiquen su
  OpenAPI.

## Linear

MCP de Linear no conectado — proyecto local-only. No se crean sub-tasks en Linear.
