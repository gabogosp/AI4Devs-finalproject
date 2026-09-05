---
tracker-id: null
tracker-source: null
parent-us: US-023
discipline: backend
variant: null
language: es
archived: true
archived_at: 2026-09-05
merged_commit: f717dc3
pr-url: https://github.com/gabogosp/AI4Devs-finalproject/pull/27
---

# US-023 Backend — Pago manual / offline: confirmación del dueño

## Why

Hoy el loop de venta tiene un agujero: US-008 deja la orden en `pending_payment` y
ahí se frena. No hay forma de que avance a `new`, porque **nada en el código
decrementa stock ni confirma un pago** — ni siquiera existe la tabla `payments`
que el DER (E2E §8) ya declaró. US-009 (MercadoPago) y US-010 (webhook) están
planificados en `openspec/` pero **cero líneas de código**: 1 de 40 tasks hecha
en US-009, 0 de 40 en US-010. Y US-009 se pausa (`Blocked`, US-023 §10) porque no
tenemos credenciales de MercadoPago.

Este change es, en los hechos, **la primera vez que alguien escribe en
`payments` o decrementa `products.stock`**. No hay nada que extender — hay que
sentar la base, y la base que se sienta acá es la que US-010 va a **reusar**
cuando llegue: `design.md` de US-010 (escrito, sin construir) ya planificó el
mismo `PaymentConfirmationPort` y el mismo `ConfirmOrderService` que este
change construye, en el mismo lugar (`src/payments/`) y con la misma separación
de módulos (`src/stock/` como único escritor de `products.stock`). Este plan
sigue esa arquitectura ya documentada — no inventa una nueva —, y agrega **un
solo elemento** que US-009/US-010 no necesitaban: `provider: 'manual'`, sin
gateway externo, confirmado por el dueño en persona.

**La restricción dura que dicta dónde vive el código**: `checkout/ac6-stock-untouched.spec.ts`
(T5.1 de US-008) escanea cada archivo no-spec de `apps/api/src/checkout/` y
falla si aparece una línea con "stock" + una palabra de escritura
(`update`/`decrement`/`set`). Ese test es la prueba de que `products.stock`
**no puede** tocarse desde `checkout/` — por eso el decremento vive en un
módulo nuevo (`src/stock/`), no en una extensión de `OrdersRepository`.

**Por qué el pago manual sí decrementa stock (y no es "otra cosa" que MercadoPago)**:
ADR-0008 fija que el stock se descuenta **al aprobarse el pago**, sin
distinguir el canal. El dueño confirmando "me transfirieron" es una aprobación
de pago tan real como un webhook — la orden no puede llegar a `new` (E2E §12:
"pago aprobado + stock decrementado OK") sin que el decremento atómico
efectivamente ocurra. Tratar la confirmación manual como un simple cambio de
`status` sin tocar stock dejaría el invariante de ADR-0008 roto para el único
canal de pago que el proyecto tiene funcionando hoy.

**El otro requisito nuevo que esta US le fija a US-012** (todavía sin
planificar): el panel del dueño hoy está pensado para NO mostrar
`pending_payment` (E2E §12, nota bajo el FSM). Sin verlas, el dueño no tiene
forma de llegar a la acción de confirmar. Este change agrega el endpoint de
lectura que esa vista va a necesitar (`GET /v1/admin/orders/pending-payment`)
— deliberadamente angosto: no reemplaza el futuro listado general de US-012
(paginación/orden/filtros por cualquier estado), sólo resuelve lo que esta US
necesita hoy.

## What changes

- **Nueva tabla `payments`** (Prisma) — el `PAYMENTS` que el DER (E2E §8) ya
  declaraba, migrada por primera vez. Ver `design.md` §Persistence para el
  detalle columna por columna y la deviación declarada (`provider: 'manual'` +
  `confirmed_by`, ninguno de los dos en el DER original).
- **Nuevo módulo `src/stock/`** — `StockRepository`, único punto de ORM que
  escribe `products.stock`. Decremento atómico condicional
  (`WHERE stock >= qty`, ADR-0008), igual al patrón que `cart-view.ts` ya usa
  para **leer** disponibilidad (US-007).
- **Nuevo módulo `src/payments/`** — `PaymentConfirmationPort` (la interfaz que
  US-023 extrae/posee, per su §10), `ConfirmOrderService` (la implementa:
  orquesta `PaymentsRepository` + `StockRepository` + una extensión de
  `OrdersRepository` dentro de una única transacción Prisma), `PaymentsRepository`
  (único punto de ORM de `payments`), y `PaymentConfirmationController`
  (admin, dos rutas — confirmar + listar pendientes).
- **Extiende `checkout/orders.repository.ts`** con dos métodos de sólo
  lectura/transición controlada — sigue siendo el único archivo que llama
  `prisma.order`/`prisma.orderItem` (convención local, ver `design.md`):
  - `transitionToNewIfPending(orderId, tx)`: `UPDATE … WHERE status = 'pending_payment'`
    dentro de la transacción de `ConfirmOrderService` (guard de idempotencia y
    de concurrencia — AC-5).
  - `listByStatus(status)`: lectura simple para el endpoint de listado (AC-2).
- `CheckoutModule` exporta `OrdersRepository` (hoy sólo la provee) para que
  `PaymentsModule` pueda importarla.
- `POST /v1/admin/orders/{orderId}/confirm-payment` — confirma el pago manual
  (AC-1, AC-3, AC-4, AC-5, AC-6).
- `GET /v1/admin/orders/pending-payment` — lista mínima para que el dueño vea
  qué confirmar (AC-2; extiende el requisito para la futura US-012, ver
  `docs/user-stories/US-012-panel-ordenes-dueno.md` §10).
- **Identidad del que confirma sin tocar `AdminGuard`**: `AdminGuard` no
  adjunta el payload del JWT a `req` (US-014 tiene un test que congela ese
  archivo, ver `design.md`). `ConfirmOrderService` decodifica (no re-verifica —
  el guard ya lo hizo) el mismo bearer token para leer el claim `sub`.

## Out of scope

- **Integración con MercadoPago** — US-009 (`Blocked`).
- **Webhook + reconciliación + reembolso automático sin stock** — US-010, parte
  MP (la parte de "aprobado pero sin stock → auto-refund", AC-4 de US-010, es
  específica del webhook async; acá, si falta stock al confirmar, la
  confirmación simplemente se rechaza con 409 — el dueño no cobró nada
  automáticamente que haya que devolver).
- **El panel de órdenes en sí (UI, listado completo, transiciones nueva→…→entregada)**
  — US-012. Este change sólo entrega el endpoint mínimo de lectura que US-012
  va a necesitar.
- **Mover `OrdersRepository` fuera de `checkout/` hacia un `OrdersModule` dedicado**
  — es el layout que el `design.md` de US-010 ya bosquejó (D9), pero moverlo
  ahora es un refactor de código ya shippeado (US-008) sin necesidad funcional
  para esta US. Se extiende el archivo existente; la migración de módulo queda
  para cuando US-010 (que sí necesita más lecturas/escrituras de `orders`) se
  planifique — no se preempta esa decisión acá.
- **Conciliación de transferencias bancarias, recordatorios automáticos al
  comprador, facturación AFIP** — declarados fuera de alcance en la US (§4).

## References

- User Story: `docs/user-stories/US-023-pago-manual-offline.md`
- E2E: `docs/product/design-e2e.md` §8 (DER — `PAYMENTS`), §12 (FSM de orden),
  §14 (STRIDE)
- ADR-0008 (decremento de stock al aprobar el pago — gobierna este change)
- ADR-0009 (seam de auth admin — `AdminGuard`, `role=admin`)
- Changes relacionados (planificados, sin construir):
  [`../US-009-pago-mercadopago-backend/design.md`](../US-009-pago-mercadopago-backend/design.md)
  (declaró `PaymentConfirmationPort` por primera vez — este change lo
  construye),
  [`../US-010-orden-webhook-stock-backend/design.md`](../US-010-orden-webhook-stock-backend/design.md)
  §D9 (el layout de módulos `orders/`/`stock/`/`payments/` que este change
  sigue)
- Código existente reusado como referencia de patrón: `apps/api/src/checkout/orders.repository.ts`
  (único escritor de `orders`), `apps/api/src/checkout/ac6-stock-untouched.spec.ts`
  (la restricción dura sobre dónde puede vivir el decremento de stock),
  `apps/api/src/auth/admin.guard.ts` + `admin-auth.service.ts` (identidad del
  dueño)
