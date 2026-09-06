# Proposal — US-015 Historial de compras del cliente (frontend web)

> **Ticket**: US-015 — Historial de compras del cliente registrado
> **Author**: frontend-web-developer agent (assisted by @gabogosp)
> **Date**: 2026-09-06
> **Status**: Archived (2026-09-06) — `archived: true`, `archived_at: 2026-09-06`,
> `merged_commit: 65ced110c5c0609e306d1c908892defded33688f`,
> `pr-url: https://github.com/gabogosp/AI4Devs-finalproject/pull/74`. 14/14 tasks
> cerradas.
> **Affected layers**: components, repository (HTTP client), state, routing
> **Affected platform**: web (`apps/web`, Next.js App Router)

## Why

El backend de US-015 (PR #70, mergeado) ya expone `GET /v1/me/orders` y
`GET /v1/me/orders/{order_number}` — el cliente autenticado puede leer sus propias compras,
paginadas y acotadas a la ventana de retención de 12 meses (PRD §6). El contrato quedó publicado
en `apps/api/docs/api/openapi.yaml` recién por PR #71 (mergeado 2026-09-06, commit `2a0eb62`),
que también regeneró el cliente FE (`listOrderHistory`, `getOrderHistoryDetail`,
`OrderHistorySummary`/`OrderHistoryDetail`/`OrderHistoryItem`).

Hoy `AccountPanel` (`/mi-cuenta`) tiene un placeholder honesto: "Tus compras — Próximamente."
(US-014 T2.6, comentario en el código lo declara explícitamente "el historial es de US-015").
Esta US cierra ese placeholder con la pantalla real: dar continuidad a la relación con el cliente
registrado y reforzar el valor de tener una cuenta (PRD §2.1 cap. 8), dejando que consulte qué
compró y en qué estado está cada pedido sin tener que escribir por WhatsApp.

## What

Una pantalla de **listado** (`/mi-cuenta/compras`) y una de **detalle**
(`/mi-cuenta/compras/{orderNumber}`) dentro del área de cuenta del cliente ya existente
(`(storefront)` route group, ADR-0010 — el storefront es dueño del espacio raíz; esto no es el
panel admin). Ambas viven detrás del mismo `CustomerGuard` que ya protege `/mi-cuenta` — no se
repite el chequeo de sesión, se reusa el guard existente.

El listado muestra fecha, estado (`OrderStatusBadge`, reusado del panel admin — es un componente
presentacional puro, sin acoplamiento a `(admin)`) y total ARS, ordenado por fecha desc **tal
como lo devuelve la API** (sin reordenar en cliente — AC-1 lo fija como regla de negocio, no como
opción). Estado vacío con invitación a comprar (AC-3, mismo patrón que `CartEmptyState`). El
detalle muestra ítems con cantidades y precios, estado actual y retiro en sucursal (AC-2).

AC-4 (sólo las propias), AC-6 (compras guest no vinculadas) y AC-7 (retención) son garantías
**del backend** — la query ya filtra por `customer_id` + corte de retención en el mismo `WHERE`
(IDOR-proof por diseño, ver `US-015-historial-compras-backend/design.md`). Este change no agrega
lógica de autorización ni de fecha propia: consume lo que la API ya filtra y maneja sus
respuestas 401/404 con el patrón inline (`role="alert"`/`role="status"`) ya establecido en
`OrderDetail`/`CustomerGuard`, sin un componente de Toast flotante.

Reemplaza además el placeholder de `AccountPanel` con un link real a `/mi-cuenta/compras`.

## Out of scope

- **Re-comprar / reordenar** desde el historial (US-015 §4, explícito en la US).
- **Vincular compras guest a la cuenta** (US-015 §4, decisión de privacidad — AC-6).
- **Cancelar / reembolsar desde el historial del cliente** — esa acción es del dueño (US-013,
  panel admin), no del cliente.
- **Facturación / comprobantes** — roadmap (AFIP, PRD §2.2).
- **Filtro/orden interactivo del listado** — AC-1 fija orden y filtro (excluye
  `pending_payment`) como reglas de negocio del backend, no como opciones del cliente
  (`ListOrderHistoryParams` sólo acepta `limit`/`offset`, sin `sort`/`status`).
- **Lógica de autorización o de corte de retención en el frontend** — AC-4/AC-6/AC-7 son
  garantías estructurales del backend (`design.md` de `US-015-historial-compras-backend`); este
  change sólo consume las respuestas.
- **Refresh automático de sesión ante un 401 a mitad de sesión** en estas dos pantallas —
  mismo alcance que `OrderDetail` (admin), que tampoco lo hace; `CustomerGuard` ya cubre el caso
  de "sin sesión desde el arranque" (AC-5).

## Affected components / screens

- `apps/web/src/features/order-history/orderHistoryService.ts` — **nuevo**. Repositorio
  (`frontend-standards.md` §11.5) sobre `listOrderHistory`/`getOrderHistoryDetail` generados.
- `apps/web/src/features/order-history/PurchaseHistoryList.tsx` — **nuevo**. Listado (AC-1) +
  composición de estados (`idle`/`loading`/`success`/`error`) + "Cargar más".
- `apps/web/src/features/order-history/PurchaseHistoryEmptyState.tsx` — **nuevo**. Estado vacío
  (AC-3), mismo patrón que `apps/web/src/features/cart/CartEmptyState.tsx`.
- `apps/web/src/features/order-history/PurchaseDetail.tsx` — **nuevo**. Detalle (AC-2).
- `apps/web/app/(storefront)/mi-cuenta/compras/page.tsx` — **nuevo** (listado).
- `apps/web/app/(storefront)/mi-cuenta/compras/[orderNumber]/page.tsx` — **nuevo** (detalle).
- `apps/web/src/features/account/AccountPanel.tsx` — **modificado**: reemplaza el placeholder
  "Próximamente" por un link a `/mi-cuenta/compras`.
- `apps/web/src/lib/observability/events.ts` — **modificado**: nuevos `BusinessEvent`
  (`order_history_shown`, `order_history_load_more_clicked`, `order_detail_shown`,
  `order_detail_not_found`), agregados a `PUBLIC_EVENTS` (superficie de cliente, no de operador).
- **Reusados sin cambios**: `OrderStatusBadge` (`@/features/orders/OrderStatusBadge`),
  `CustomerGuard` (`@/features/account/CustomerGuard`), `formatArs`, `formatDateTime`, `Button`,
  `AsyncState`, `AppErrorException`/`networkError`, `parseContract`.

## API consumption

Contrato: `apps/api/docs/api/openapi.yaml` (publicado, PR #71, commit `2a0eb62`, verificado en
`main` al momento de planificar — ver `design.md` §"Estado del gate de contrato").

- `GET /v1/me/orders` (`operationId: listOrderHistory`, tag `customer-orders`) — `limit`
  (1-100, default 20), `offset` (≥0, default 0). `security: sessionCookie`. `200`
  → `OrderHistoryListResponse` (`{ data: OrderHistorySummary[], pagination }`). `401`, `429`.
- `GET /v1/me/orders/{order_number}` (`operationId: getOrderHistoryDetail`) — `order_number`
  entero público (≥1000), **no el UUID interno**. `security: sessionCookie`. `200` →
  `OrderHistoryDetail`. `401`. `404` (`dsm:checkout/order-not-found` — orden inexistente, ajena,
  o fuera de retención; las tres causas responden igual, IDOR). `429`.

Cliente generado ya regenerado (PR #71): `apps/web/src/api/generated/endpoints.ts` exporta
`listOrderHistory`/`getOrderHistoryDetail`; `apps/web/src/api/generated/zod.ts` exporta
`ListOrderHistoryResponse`/`GetOrderHistoryDetailResponse`; `apps/web/src/api/generated/model/`
exporta `OrderHistorySummary`/`OrderHistoryDetail`/`OrderHistoryItem`. No hace falta correr
codegen en este change — se verifica frescura únicamente (Fase 0 de `tasks.md`).

## Acceptance criteria

- [ ] AC-1: el listado en `/mi-cuenta/compras` muestra fecha, estado y total ARS de cada orden
      propia, ordenado por fecha desc (orden que entrega la API, sin reordenar en cliente).
- [ ] AC-2: al abrir una orden desde el listado (`/mi-cuenta/compras/{orderNumber}`), se ven sus
      ítems (cantidades y precios), el estado actual y el retiro en sucursal.
- [ ] AC-3: un cliente sin compras ve un estado vacío con invitación a comprar (CTA a
      `/categorias`).
- [ ] AC-4 (consumida, no reimplementada): un 401/404 de la API se refleja en la UI sin exponer
      nunca datos de otro cliente — no hay lógica de filtrado propia en el FE.
- [ ] AC-5: sin sesión, `CustomerGuard` redirige a `/ingresar?next=...` antes de montar el
      listado o el detalle — ninguna orden se renderiza mientras la redirección ocurre.
- [ ] AC-6 (consumida): el FE no ofrece ningún mecanismo para vincular compras guest; sólo
      renderiza lo que el listado devuelve.
- [ ] AC-7 (consumida): el FE no aplica ningún corte de fecha propio; muestra exactamente lo que
      la API devuelve dentro de la ventana de retención vigente.

## Standards consulted

- `docs/base-standards.md`
- `docs/code/frontend-standards.md` §3 (codegen obligatorio), §8 (cliente HTTP centralizado),
  §11.2 (guard de sesión), §11.3 (mapeo de errores), §11.4 (estado como unión discriminada),
  §11.5 (repository pattern), §11.9 (composición de estados de carga)
- `docs/architecture/api-standards.md` (RFC 7807, paginación offset/limit)
- `docs/quality/testing-standards.md` §14
- `docs/quality/qa-frontend-standards.md` §19, §23
- `docs/product/design-system.md` §7.7 (Badge/OrderStatusBadge), §7.9 (Table — descartada,
  ver `design.md`), §10.1/§10.2 (patrones + voz/tono)
- ADR-0010 (namespace storefront vs admin — confirma que `/mi-cuenta/*` es storefront, no admin)
- Precedente estructural: `openspec/changes/archive/US-021-retencion-datos-ordenes-frontend-web/`
  (gate de contrato Fase 0, mismo criterio de `Verify:`)

## Open questions

Ninguna bloqueante. Dos decisiones de diseño quedaron resueltas por defecto razonable
(documentadas en `design.md` §Trade-offs, no requieren bloquear el arranque):

1. Paginación del listado: "Cargar más" (append incremental) en vez de Anterior/Siguiente —
   más simple y mobile-first para una lista de cliente (vs. la grilla densa del panel admin,
   design-system §7.9 es explícitamente sólo-backoffice).
2. Un 401 a mitad de sesión en estas pantallas (access token vencido durante la visita) se
   muestra como error inline con reintento — no dispara un refresh automático ni un segundo
   redirect; mismo alcance que `OrderDetail` (admin) hoy.
