---
tracker-id: null
tracker-source: null
parent-us: US-021
discipline: frontend-web
variant: null
language: es
---

# Proposal — Retención y anonimización de datos de órdenes (panel del dueño)

> **Ticket**: US-021 — Retención y anonimización de los datos personales de las órdenes
> **Author**: frontend-web-developer agent (asistido por @Gabriel Suarez)
> **Date**: 2026-09-05
> **Status**: Proposed — **BLOQUEADO** en la pieza descrita en "Gap de contrato" (ver abajo)
> **Affected layers**: components, repository (HTTP client generado), state
> **Affected platform**: web (Next.js App Router, `apps/web`)

## Why

El PRD §6 fija retención de 12 meses para las órdenes con anonimización, no borrado. El
backend de US-021 (`openspec/changes/US-021-retencion-datos-ordenes-backend/`, 30/30 tasks,
PR #41 mergeado a `main` el 2026-09-05) ya construyó los dos disparadores (`POST
/v1/admin/orders/:id/anonymize` a pedido del comprador, `POST
/v1/admin/orders/retention-sweep` por plazo) y las dos columnas de auditoría
(`anonymized_at`, `anonymization_reason`) sobre `orders`. Falta la mitad visible para el
dueño: **AC-3** (ejecutar la anonimización a pedido desde el panel, con confirmación de dos
pasos porque es irreversible) y **AC-4/AC-5** (que quede visible en la orden que fue
anonimizada, cuándo y por qué motivo, y que la orden anonimizada siga siendo operable —
productos, cantidades, importes, estado y fechas visibles, con una indicación en lugar de
los datos del comprador).

El panel del dueño de órdenes ya existe (`apps/web/src/features/orders/`, construido por
US-012 y extendido por el flujo de pagos manuales de US-023, PR #22/#31/#35). Este change es
una extensión de ese mismo módulo — reusa sus convenciones de estado (`AsyncState`
discriminado), su cliente HTTP generado (`customFetch` + orval), su componente de
confirmación destructiva ya existente (`@/components/ui/ConfirmDialog`, usado hoy por
`ProductActions` para "Archivar producto") y su convención de "Toast" implementada como
banner `role="status"`/`role="alert"` inline (no hay componente de Toast flotante en el
proyecto; `OrderStatusActions`/`ProductActions`/`PendingPaymentsPanel` usan todos el mismo
patrón). AC-9 (sólo el dueño autenticado puede disparar la acción) ya está cubierto en el
frontend por el `AdminGuard` de `apps/web/app/(admin)/layout.tsx`, que envuelve toda la
`route group` `(admin)` — no hace falta nada nuevo del lado FE para esa AC; la autoridad real
es el `AdminGuard` del backend (design.md del backend, sección Threat model).

## What

Agrega, dentro de `OrderDetail` (la vista de detalle de una orden en el panel del dueño), una
acción **"Anonimizar datos del comprador"** que:

- Sólo aparece cuando la orden todavía **no** está anonimizada.
- Al presionarla, abre el `ConfirmDialog` existente (dos pasos: escribir una palabra de
  confirmación, sin cierre por click-outside) explicando que la acción es irreversible.
- Al confirmar, llama a `POST /v1/admin/orders/{id}/anonymize` (vía el cliente **generado**
  desde el contrato — nunca `fetch` directo) y, si tiene éxito, reemplaza los datos de
  contacto visibles por una indicación de que fueron anonimizados, junto con el momento y
  el motivo (AC-4/AC-5).
- Comunica el resultado (éxito o error) con el mismo patrón `role="status"`/`role="alert"`
  que ya usa el resto del panel.

**No agrega ninguna pantalla nueva ni ninguna ruta nueva** — todo vive dentro del componente
`OrderDetail` existente en `/admin/ordenes/[id]`.

## Gap de contrato descubierto (más amplio que lo que se asumió al delegar esta tarea)

El encargo de esta tarea asumía que el único hueco era que `AdminOrderDetail` (el schema del
`GET /admin/orders/{id}` que ya usa el panel) no expone `anonymized_at`/
`anonymization_reason`. **Verificado: ese hueco es real** (`apps/api/src/orders/dto/order.dto.ts`,
clase `AdminOrderDetailDto.fromWithHistory` — no copia esas dos columnas aunque
`OrderWithItems`/Prisma ya las tenga; el propio `apps/api/src/checkout/README.md` §"Retención
y anonimización" lo declara explícitamente como open question sin resolver).

**Pero hay un segundo hueco, más severo, que bloquea AC-3 completa (no sólo el badge de
AC-4/AC-5)**: el contrato **publicado** que el codegen del frontend consume —
`apps/api/docs/api/openapi.yaml` (ver `orval.config.ts`, constante `CONTRACT`) — **no incluye
en absoluto** los paths `/admin/orders/{id}/anonymize` ni `/admin/orders/retention-sweep`.
Verificado con `git log -- apps/api/docs/api/openapi.yaml`: el último commit que tocó ese
archivo es el merge del frontend de US-012 (`4f44c42`); ningún commit de US-021 backend lo
tocó, y su propio `tasks.md` no tiene ninguna task de sincronizarlo (a diferencia de US-006,
US-007, US-008, US-012, US-014, US-023, que sí publicaron su contrato ahí como parte de su
cierre, per `documentation-standards.md`). Los dos endpoints SÍ existen como yaml draft
completos y ya coherentes con el controller real
(`openspec/changes/US-021-retencion-datos-ordenes-backend/contracts/openapi/anonymize-order.yaml`,
`retention-sweep.yaml`), pero nunca se fusionaron al archivo que `orval` lee.

**Consecuencia por `frontend-standards.md` §3.2 (mandatorio, sin excepción)**: los DTOs,
la validación runtime (Zod) y los mocks (MSW) del cliente del panel se **generan** desde
`apps/api/docs/api/openapi.yaml` — nunca se escriben a mano. Sin los dos paths publicados
ahí, el codegen **no puede** producir la operación `anonymizeOrder` ni sus tipos, así que
este change **no puede** cablear la llamada real sin violar esa regla (que es,
literalmente, la que impidió que se colara `POST /v1/admin/auth/login` sin backend real —
ver comentario en `apps/web/src/lib/http/client.ts`). Escribir el DTO/Zod a mano "mientras
tanto" es exactamente el anti-patrón que la propia skill `openapi-client-codegen` prohíbe.

**Decisión tomada para este plan** (ver `design.md` para el detalle completo):

1. **Se recomienda abrir un follow-up chico de backend** (documentación/contrato, no lógica
   nueva: los dos endpoints y las dos columnas YA existen y funcionan) que:
   - Fusione `anonymize-order.yaml` y `retention-sweep.yaml` a
     `apps/api/docs/api/openapi.yaml` bajo el tag `admin-orders-retention`.
   - Agregue `anonymized_at`/`anonymization_reason` (nullable) al schema `AdminOrderDetail`
     de ese mismo archivo, y el pass-through de 2 campos en `AdminOrderDetailDto`
     (`apps/api/src/orders/dto/order.dto.ts`) — los datos ya están en `OrderWithItems`, es
     sólo exponerlos.
   - El change de backend `US-021-retencion-datos-ordenes-backend` **todavía no está
     archivado** (30/30 tasks, PR #41 abierto sin merge confirmado a `main` de forma
     definitiva en el índice) — el lugar más barato para este follow-up es una task
     adicional en ESE change antes de archivarlo, o un change nuevo y chico si ya se
     archivó para cuando esto se ejecute. Fuera del alcance de este agente (frontend-web).
2. **Este `tasks.md` sí queda escrito completo y ejecutable** — la Fase 0 documenta la
   dependencia con un `Exit criterion` verificable (el contrato publicado contiene los
   paths + los 2 campos) y **todas las tasks de codegen/servicio/UI que dependen de eso
   quedan marcadas `Depends on: T0.1`**, para que `/develop-frontend-web` no intente
   cablear la llamada real contra un contrato que no la declara. El resto del change
   (estructura del componente, `ConfirmDialog`, copy, tracking, tests con MSW usando el
   **mismo** contrato una vez sincronizado) se planifica igual, listo para ejecutar en
   cuanto T0.1 se resuelva.

## Fuera de alcance

- **`POST /v1/admin/orders/retention-sweep` no tiene UI en el panel del dueño.** AC-1 dice
  "corre el proceso de retención" — el sujeto es el proceso automático
  (`OrdersRetentionRunner.onApplicationBootstrap()` + el disparador externo real, cron de
  Railway u operación manual, que el propio `design.md` del backend deja fuera de su
  alcance y remite a `/plan-deployment`). Ningún AC de la US dice "el dueño ve un botón de
  barrido masivo" — sólo AC-3 nombra una acción del dueño, y es puntual, sobre una orden.
  Exponer un botón de "barrido manual" en el panel sería alcance no pedido (YAGNI,
  `base-standards.md` §1) sobre una ruta que el propio backend rate-limita a 5/hora
  precisamente porque está pensada como palanca operativa, no como interacción de UI
  frecuente. Si en el futuro Operaciones necesita dispararlo sin `curl`/Postman, es una US
  aparte (herramienta operativa, no parte del panel de negocio del dueño).
- **El GAP de contrato descrito arriba no se resuelve en este change** — es responsabilidad
  de un follow-up de backend (documentación + 2 campos de DTO), fuera del rol de este
  agente.
- **Indicación de "anonimizada" en `OrdersList` (listado)**: `AdminOrderSummary` no expone
  ni expondrá esas columnas (el schema del listado no las necesita: AC-5 dice
  explícitamente "el dueño **la abre** en el panel de órdenes", es decir, el detalle). No se
  inventa un requisito de UI en el listado que ningún AC pide.
- **Exportación / derecho de acceso a datos personales** — otra US, ya excluida por el US §4.
- **Botón "deshacer anonimización"** — AC-8 declara la operación no reversible por diseño;
  no hay ningún control de deshacer.

## Componentes / pantallas afectados

- `apps/web/src/features/orders/ordersService.ts` — nuevo método `anonymize(id)`
  (**bloqueado** en la operación generada del cliente hasta T0.1; ver `design.md` §Servicio).
- `apps/web/src/features/orders/OrderAnonymizeAction.tsx` — **nuevo** componente (acción +
  `ConfirmDialog` + resultado), inyectado dentro de `OrderDetail.tsx`.
- `apps/web/src/features/orders/OrderDetail.tsx` — modificado: monta
  `OrderAnonymizeAction`, y la sección "Datos de contacto" muestra la indicación de
  anonimizado en lugar de nombre/email/teléfono cuando corresponde (AC-5).
- `apps/web/src/lib/observability/events.ts` — nuevos eventos
  `order_anonymize_attempted` / `_succeeded` / `_failed`, sin PII (mismo criterio que
  `order_status_change_*`).
- `apps/web/src/api/generated/*` — regenerado (no escrito a mano) una vez resuelto T0.1.

## Consumo de API

- `POST /v1/admin/orders/{id}/anonymize` — contrato draft:
  `openspec/changes/US-021-retencion-datos-ordenes-backend/contracts/openapi/anonymize-order.yaml`.
  Responde `{ order_id, anonymized_at, anonymization_reason }`. 401/403/404/422/429.
  **Bloqueado para codegen real hasta que se publique en
  `apps/api/docs/api/openapi.yaml`** (ver Gap de contrato arriba).
- `GET /v1/admin/orders/{id}` — capacidad viva `openspec/specs/ordenes/`, ya consumida por
  `ordersService.get`. **Necesita extender `AdminOrderDetail`** con
  `anonymized_at`/`anonymization_reason` (nullable) para que AC-4/AC-5 se pinten con datos
  reales — mismo follow-up de backend.
- `POST /v1/admin/orders/retention-sweep` — fuera de alcance de este FE (ver arriba); no se
  consume desde el panel.

## Acceptance criteria (mapeadas al scope FE)

- [ ] AC-3: el dueño puede ejecutar "anonimizar" desde `OrderDetail`, con confirmación de
      dos pasos (`ConfirmDialog`, no cierra por click-outside, palabra de confirmación).
- [ ] AC-4: la orden anonimizada muestra cuándo se anonimizó y si fue por plazo o a pedido.
- [ ] AC-5: la orden anonimizada sigue mostrando productos/cantidades/importes/estado/fechas;
      en lugar de nombre/email/teléfono se ve una indicación de anonimización.
- [ ] AC-9 (FE): la acción sólo es alcanzable dentro de `(admin)`, gateado por `AdminGuard`
      — sin cambios nuevos, se verifica que sigue así.
- (AC-1, AC-2, AC-6, AC-7, AC-8 son responsabilidad de backend/QA; el FE no los reimplementa,
  pero AC-8 sí condiciona la UI: la acción no debe ofrecerse dos veces con apariencia de que
  "hace algo" sobre una orden ya anonimizada — se oculta, no se deshabilita mudo.)

## Standards consulted

- `spekode/docs/base-standards.md`
- `spekode/docs/code/frontend-standards.md` §3 (API consumption / codegen mandatorio), §5
  (error handling), §9/§11.3/§11.4/§11.9 (state + error mapping + loading composition),
  §11.bis.4 (audit trail surfacing), §11.bis.5 (destructive action confirmation), §12
  (security)
- `spekode/docs/code/frontend-next-standards.md` (overlay — `apps/web` es Next.js App
  Router, confirmado por `apps/web/app/(admin)/...`)
- `spekode/docs/architecture/api-standards.md` (RFC 7807, idempotencia, rate limit)
- `spekode/docs/quality/testing-standards.md` §14
- `spekode/docs/quality/qa-frontend-standards.md` §23 (Vitest+RTL+MSW — mismo patrón que
  `orders.events.test.tsx`/`a11y.test.tsx` ya existentes), §19 (a11y)
- Skills: `openapi-client-codegen` (regla de no hand-write, F48), `msw-setup`,
  `fe-design-without-figma` (no hay Figma; `docs/product/design-system.md` es la fuente),
  `frontend-resilience-patterns` (#9 idempotencia del lado del cliente),
  `observability-patterns` §9.5 (eventos sin PII)

## Open questions

1. **[BLOQUEANTE — owner: backend]** ¿Quién y cuándo sincroniza
   `apps/api/docs/api/openapi.yaml` con los dos endpoints de retención + los 2 campos de
   `AdminOrderDetail`? Recomendación: una task adicional en
   `openspec/changes/US-021-retencion-datos-ordenes-backend/tasks.md` (todavía no
   archivado) antes de `/archive-change`, o un change de backend nuevo y chico si ya se
   archivó. Este FE no puede codegenerar la operación `anonymizeOrder` ni el campo
   `anonymized_at` del detalle sin esto (`frontend-standards.md` §3.2, sin excepción).
2. ¿El texto exacto de confirmación y de la indicación de "datos anonimizados" necesita
   revisión legal (Ley 25.326) antes de ir a producción? Se propone copy en `design.md`
   siguiendo el tono §10.2 del design-system, pero no hay AC que exija redacción legal
   específica — se deja abierto para que Producto/Legal lo confirme si corresponde.
