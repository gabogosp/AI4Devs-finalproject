---
tracker-id: null
tracker-source: null
parent-us: US-013
discipline: frontend-web
variant: null
language: es
audit-derived: false
archived: true
archived_at: 2026-09-06
merged_commit: 62437f77675b3d0b6c0433f3d0f0860b3e28a152
pr-url: https://github.com/gabogosp/AI4Devs-finalproject/pull/67
---

# Proposal — Cancelación de orden + reembolso + reintegro de stock (frontend-web)

> **Ticket**: US-013 — Cancelación de orden + reembolso + reintegro de stock
> **Author**: frontend-web-developer agent
> **Date**: 2026-09-06
> **Status**: Proposed
> **Affected layers**: repository (servicio de órdenes), componente de acción
> destructiva, wiring en `OrderDetail`, observabilidad (eventos de negocio)
> **Affected platform**: `apps/web` (Next.js App Router — panel del dueño,
> route group `(admin)`)

## Why

`US-013-cancelacion-reembolso-backend` (PR #66, mergeado) construyó el
endpoint `POST /v1/admin/orders/{id}/cancel` — cancela una orden pagada no
entregada, reintegra su stock, gestiona el reembolso (real por MercadoPago,
no-op para pago simulado/manual) y notifica al comprador. Cubre 9 de los 10 AC
de la US. El único que quedó explícitamente diferido a este change es
**AC-6 — confirmación de dos pasos**: cancelar es una acción destructiva e
irreversible (reintegra stock, dispara un reembolso, avisa al comprador) que
el dueño ejecuta desde el panel de órdenes (US-012, ya construido y
mergeado) — necesita un gate de confirmación explícita antes de disparar la
llamada, no un botón de un solo click.

Este change agrega esa acción — "Cancelar orden" — al panel de detalle de una
orden que US-012 ya construyó, gateada detrás del mismo patrón de
confirmación destructiva de dos pasos que el panel **ya usa dos veces**
(`ProductActions.archive` en productos, `OrderAnonymizeAction` en el propio
detalle de orden). No hay nada nuevo que diseñar en la UX de confirmación —
`design-system.md` §7.5 ya cita literalmente "confirmación de 'cancelar
orden' (destructive, dos pasos)" como uno de los dos usos canónicos del
Modal/Dialog del sistema.

## What changes

- **`ordersService.cancel(id)`** (nuevo método en
  `apps/web/src/features/orders/ordersService.ts`): envuelve la operación
  **generada** `cancelOrder` (`apps/web/src/api/generated/endpoints.ts`,
  regenerada por el orquestador antes de este plan) con `parseContract` +
  el schema Zod `CancelOrderResponse` generado — nunca `fetch` crudo (F48).
- **`OrderCancelAction`** (nuevo componente,
  `apps/web/src/features/orders/OrderCancelAction.tsx`): botón destructivo
  "Cancelar orden" + `ConfirmDialog` **reusado tal cual**
  (`apps/web/src/components/ui/ConfirmDialog.tsx` — el mismo componente que ya
  usan `ProductActions.archive` y `OrderAnonymizeAction`, sin ninguna
  modificación). Sólo se ofrece desde `new`/`preparing`/`ready` (AC-1/AC-7 en
  la superficie — el backend sigue siendo la autoridad real vía 409, mismo
  criterio que `OrderStatusActions`/`NEXT_STATUS`). En éxito, reconcilia
  `OrderDetail` con el `CancelOrderResponse` completo que el backend devuelve
  (self-contained, mismo shape que `AdminOrderDetail` + `refund` — no hace
  falta un segundo `GET`, a diferencia de `OrderAnonymizeAction`) y muestra un
  mensaje distinto según `refund.status` (`refunded` / `refund_pending` /
  `not_applicable`). En error 409 (`dsm:payments/order-cannot-be-cancelled`)
  muestra un mensaje específico ("la orden ya no puede cancelarse") en vez del
  genérico — es el caso que el backend señaló explícitamente como el que
  necesita distinguirse.
- **Wiring en `OrderDetail.tsx`**: se agrega `<OrderCancelAction>` junto a
  `OrderStatusActions`/`OrderAnonymizeAction` ya presentes, reusando el mismo
  callback `onConfirmed` que ya reconcilia el estado local con la respuesta
  del backend.
- **3 eventos de negocio nuevos** (`order_cancel_attempted/succeeded/failed`)
  en `apps/web/src/lib/observability/events.ts`, mismo criterio sin PII que
  `order_status_change_*`/`order_anonymize_*` (sólo `order_id`).
- **Sin ruta nueva, sin componente de diálogo nuevo, sin cambio de
  arquitectura.** Todo el trabajo es "agregar una acción más" a una pantalla
  que ya existe, con un patrón de confirmación que ya existe dos veces en el
  mismo codebase.

## Out of scope

- **Confirmación de dos pasos como concepto/componente nuevo** — ya existe
  (`ConfirmDialog`), se reusa sin modificar.
- **AC-2/AC-3/AC-5/AC-8/AC-9/AC-10** — ya cubiertos por el backend (US-013
  backend, PR #66); este change sólo consume la respuesta que ya los refleja
  (p.ej. AC-10 trazabilidad ya se ve en `OrderStatusHistory`, componente
  existente que renderiza `status_history` — la respuesta de `cancel()` ya
  trae la fila nueva, sin cambios en ese componente).
- **AC-4 (aviso al comprador)** — lo dispara el backend (`NotificationPort`,
  best-effort, log-only hasta US-011); la única superficie FE es el copy del
  `ConfirmDialog`, que menciona que el comprador recibe un aviso (para que el
  dueño sepa qué va a pasar antes de confirmar).
- **README de `apps/web`** — evaluado y descartado explícitamente (ver
  "Standards consultados" abajo): ni `OrderAnonymizeAction` ni
  `ProductActions.archive` — los dos precedentes de esta misma confirmación
  de dos pasos — están documentados ahí; el README documenta decisiones
  arquitectónicas (namespace de rutas, modelo de sesión, ADRs), no acciones
  puntuales de un panel ya documentado. No se crea una asimetría nueva
  agregando una tercera acción sin documentar cuando las otras dos tampoco lo
  están.
- **Cobertura Playwright E2E del flujo completo** — el E2E (`design-e2e.md`
  §L3) menciona "cancelación" como parte del loop completo, pero **ningún**
  flujo de `apps/web/features/orders/` tiene hoy specs Playwright (todo el
  panel de US-012 se verificó a nivel componente/integración con Vitest +
  RTL + MSW + axe-core) — este change sigue el mismo nivel de la pirámide que
  ya estableció US-012; la cobertura E2E cross-stack, si se decide, es tarea
  de QA (`QA-US-013`, todavía sin planificar).
- **Refetch en el listado (`OrdersList`)** — cancelar se ofrece sólo desde el
  detalle (mismo criterio que `OrderAnonymizeAction`, que tampoco se ofrece
  desde la lista); el listado ya refleja el nuevo estado la próxima vez que
  se carga (mismo comportamiento que cualquier otro cambio de estado).

## Affected components / screens

- `apps/web/src/features/orders/ordersService.ts` — método nuevo `cancel(id)`.
- `apps/web/src/features/orders/OrderCancelAction.tsx` — componente nuevo.
- `apps/web/src/features/orders/OrderCancelAction.test.tsx` — tests nuevos.
- `apps/web/src/features/orders/OrderDetail.tsx` — wiring del componente
  nuevo.
- `apps/web/src/features/orders/OrderDetail.test.tsx` — casos nuevos
  (visibilidad condicional del botón por estado).
- `apps/web/src/features/orders/orders.events.test.tsx` — casos nuevos
  (eventos sin PII).
- `apps/web/src/features/orders/a11y.test.tsx` — caso nuevo (axe sobre
  `OrderDetail` con la acción de cancelar visible).
- `apps/web/src/lib/observability/events.ts` — 3 literales nuevos en
  `BusinessEvent`.
- **Sin cambios** en `apps/web/app/(admin)/admin/ordenes/[id]/page.tsx` (ya
  monta `OrderDetail` completo, sin props nuevas que pasar).

## API consumption

- `POST /v1/admin/orders/{id}/cancel` — sin body, `AdminGuard`. Contrato
  publicado en `apps/api/docs/api/openapi.yaml` (actualizado por el backend,
  T9.2 de su change) y draft de staging en
  `openspec/changes/US-013-cancelacion-reembolso-backend/contracts/openapi/cancel-order.yaml`.
  Cliente + Zod + MSW **ya regenerados** por el orquestador antes de este
  plan (`apps/web/src/api/generated/endpoints.ts` tiene `cancelOrder`;
  `apps/web/src/api/generated/model/cancelOrderResponse*.ts` y
  `apps/web/src/api/generated/zod.ts#CancelOrderResponse` existen) — este
  change **no regenera nada nuevo**, sólo verifica que el código ya generado
  siga siendo el vigente (T1.1 de `tasks.md`).
- Respuestas de error consumidas: `401`/`403` (manejados globalmente por
  `AdminGuard` de FE + el interceptor HTTP centralizado, sin caso especial en
  este componente — mismo criterio que `OrderStatusActions`/
  `OrderAnonymizeAction`, ninguno de los dos distingue 401/403 tampoco);
  `404` (`dsm:payments/order-not-found` — orden inexistente o
  `pending_payment`, fuera del alcance de esta acción; mensaje "la orden ya no
  existe", igual que `OrderAnonymizeAction`); `409`
  (`dsm:payments/order-cannot-be-cancelled` — entregada o carrera perdida;
  mensaje específico nuevo).

## Acceptance criteria

- [ ] AC-6 (US-013): desde el detalle de una orden `new`/`preparing`/`ready`,
      el dueño ve un botón "Cancelar orden"; al click se abre un diálogo de
      confirmación que exige tipear la palabra "CANCELAR"; el botón de
      confirmar queda deshabilitado hasta que el texto coincide exactamente;
      sólo entonces se dispara `POST .../cancel`.
- [ ] AC-1/AC-7 (superficie FE): el botón "Cancelar orden" no se renderiza
      cuando `order.status` es `delivered` o `cancelled`.
- [ ] AC-3/AC-5 (superficie FE): en éxito, el mensaje mostrado distingue
      `refunded` (reembolso ya resuelto) de `refund_pending` (reembolso en
      curso, se reintentará) de `not_applicable` (sin pago que reembolsar).
- [ ] AC-7 (negative space, error): un 409 del backend (orden `delivered` o
      carrera perdida) muestra "la orden ya no puede cancelarse" — el diálogo
      NO se cierra, permitiendo reintentar o cancelar la acción.
- [ ] AC-10 (superficie FE): tras cancelar con éxito, `OrderStatusHistory`
      (componente ya existente, sin cambios) refleja la fila nueva
      (`to_status='cancelled'`, `changed_by`) sin recargar la página.
- [ ] Ningún evento de telemetría (`order_cancel_*`) lleva `buyer_name` /
      `buyer_email`.
- [ ] `OrderDetail` con la acción de cancelar visible no tiene violaciones
      axe-core `serious`/`critical`.

## Standards consultados

- `docs/base-standards.md` — KISS/YAGNI: cero componente nuevo de
  confirmación, cero mecanismo nuevo de reporte de error; se reusa lo que
  US-012/US-021 ya construyeron.
- `docs/code/frontend-standards.md` §3.1/§3.2 (contract-derived artifacts
  generados, nunca a mano) · §11.2 (auth/guard heredado) · §11.3 (mapeo de
  errores tipados) · §11.4/§11.9 (estado como unión discriminada, estados
  explícitos) · §11.5 (repositorio por feature) · §11.8 (observabilidad)
  · §11.bis.4/§11.bis.5 (audit-trail surfacing, confirmación destructiva de
  dos pasos) · §12 (sin `dangerouslySetInnerHTML`, validación client+server —
  no aplica cambio acá, sin inputs nuevos de usuario más allá de la palabra
  de confirmación).
- `docs/code/frontend-next-standards.md` (stack `next` per precedente de
  todo el resto de `apps/web` — no hay `project-config.yml` en el repo, pero
  `US-016-panel-metricas-frontend-web` y el resto del árbol `apps/web` usan
  App Router de Next.js; se sigue el mismo overlay).
- `docs/architecture/api-standards.md` §8 (RFC 7807) · §10 (idempotencia —
  estructural del lado del backend, el FE no necesita generar
  `Idempotency-Key` para este endpoint porque no lo declara el contrato).
- `docs/quality/testing-standards.md` §14 · `docs/quality/qa-frontend-standards.md`
  §23 (RTL + MSW + axe-core — mismo nivel de pirámide que el resto del panel
  de órdenes, sin Playwright E2E nuevo — ver "Out of scope").
- `docs/product/design-system.md` §7.5 (Modal/Dialog — cita literalmente
  "confirmación de 'cancelar orden' (destructive, dos pasos)" como uso
  canónico) · §7.6 (Toast/notification — reusa el mismo patrón `role="status"`/
  `role="alert"` que el resto del panel, sin toast library nueva) · §7.7
  (OrderStatusBadge — sin cambios, ya tiene el bucket "Cancelada").
- `docs/ai/documentation-standards.md` §4/§8/§11 — evaluado: sin ADR (ninguna
  decisión arquitectónica nueva), sin README (ver "Out of scope").
- Skills aplicadas: `openapi-client-codegen` (verificación de que el cliente
  ya generado sigue vigente, sin regenerar nada nuevo) · `msw-setup` (mocks
  por-test, mismo patrón que `OrderAnonymizeAction.test.tsx`) ·
  `frontend-resilience-patterns` (idempotencia visual — botón de confirmar
  deshabilitado durante la mutación, mismo patrón #3/#4/#9 que
  `OrderAnonymizeAction`) · `openspec-workflow` (contrato closure-grade).

## Open questions

Ninguna que bloquee este plan. Las dos preguntas propias de la superficie de
producto (OQ-BE-1: no-op de reembolso para `provider='manual'`; OQ-BE-2:
shape de la respuesta self-contained) son del backend y no afectan el diseño
de esta acción — el FE consume la respuesta tal como el contrato la declara,
cualquiera sea el resultado de esas dos preguntas.

## References

- User story: [`docs/user-stories/US-013-cancelacion-reembolso.md`](../../../docs/user-stories/US-013-cancelacion-reembolso.md)
- PRD: [`docs/product/prd.md`](../../../docs/product/prd.md) §2.1 capacidad 11
- E2E: [`docs/product/design-e2e.md`](../../../docs/product/design-e2e.md) §12 (FSM),
  §14 (auth) — sección L3 de la pirámide de pruebas menciona "cancelación"
  dentro del loop E2E completo, hoy no implementado para ningún flujo de
  `orders/` (ver "Out of scope")
- Backend (change hermano, ya mergeado): [`openspec/changes/US-013-cancelacion-reembolso-backend/`](../US-013-cancelacion-reembolso-backend/)
  (`proposal.md`, `design.md` — contrato exacto, D6 self-contained response)
- Capacidad `ordenes` (CAP-5): [`openspec/specs/ordenes/`](../../specs/ordenes/)
- Change hermano de origen del panel: `US-012-panel-ordenes-dueno-frontend-web`
  (archivado) — `OrderDetail`, `OrderStatusActions`, `OrderAnonymizeAction`
  son el precedente directo reusado por este change. `ConfirmDialog` en sí es
  más viejo todavía (`US-001` — acciones de estado publicar/archivar de
  productos; extendido con la prop `busy` por el change de anonimización de
  órdenes) — el componente que reusa este change ya tiene 2 consumidores
  reales en producción, no es un patrón hipotético.
- Design-system: [`docs/product/design-system.md`](../../../docs/product/design-system.md)
  §7.5 (Modal/Dialog), §7.7 (Badge/OrderStatusBadge)
