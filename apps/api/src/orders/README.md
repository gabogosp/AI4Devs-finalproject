# `src/orders/` — Panel admin de órdenes (US-012)

`GET/PATCH /v1/admin/orders` — el dueño gestiona el fulfillment de una orden
ya pagada: verla, filtrarla, y avanzarla por los cuatro estados activos
(`new → preparing → ready → delivered`).

## Qué transiciones expone este módulo, y cuáles no

Este módulo es dueño **sólo** de la FSM de fulfillment (`order-state.ts`, 4
estados). Dos transiciones vecinas de la orden viven en otro lado, a
propósito:

- **`pending_payment → new`**: la resuelve `payments/` (US-023,
  `ConfirmOrderService`) cuando el dueño confirma un pago manual/offline —
  fuera de este módulo, en el otro extremo del ciclo de vida de la orden.
  Este panel nunca ve una orden `pending_payment` (AC-8: `get`/`list` la
  excluyen siempre, sin excepción por filtro).
- **`* → cancelled`**: la resuelve un futuro US-013 (cancelación /
  reembolso / reintegro de stock). El `PATCH` de este módulo NUNCA acepta
  `"cancelled"` como valor de `status` — ni siquiera llega a la FSM, el DTO
  lo rechaza antes.

`get(id)` sí devuelve una orden `cancelled` (defensiva, OQ-BE-1) — es
trazable por id aunque este módulo no la haya cancelado ni pueda actuar sobre
ella.

## Por qué el `PATCH` es idempotente por estado, no por `Idempotency-Key`

El header `Idempotency-Key` se acepta (no rompe nada si un cliente lo manda)
pero se **ignora** — no hay almacenamiento de clave ni tabla de respuestas
cacheadas. La idempotencia real es **estructural**: `updateStatusConditional`
hace `UPDATE orders SET status=$to WHERE id=$id AND status=$from` — un
reintento de red que llega después de que la transición ya se aplicó
encuentra `status !== from` y no hace nada (ni una fila nueva de historial,
ni una segunda notificación). Mismo criterio que `ConfirmOrderService` de
US-023 estableció primero en el repo (design.md §D4).

La ventaja sobre una clave almacenada: cubre también la carrera de **dos
pestañas** (dos operadores, o el mismo operador con dos tabs), no sólo el
reintento de un mismo cliente — un caso que una clave por request no
resuelve.

## Por qué `order_status_history` no incluye `pending_payment→new`

Esa fila la escribe `payments/` (US-023), no este módulo — el historial que
expone `GET /{id}` empieza en la primera transición que efectivamente aplicó
el panel de fulfillment. Una orden que pasó por 3 `PATCH` (`preparing`,
`ready`, `delivered`) tiene exactamente 3 entradas, no 4.

## Colisión de rutas con `pending-payment` (design.md §D6)

`PaymentConfirmationController` (US-023) registra `GET
/v1/admin/orders/pending-payment` bajo el mismo prefijo `@Controller`. Nest
matchea rutas por **orden de registro de módulos**, no por especificidad —
sin mitigación, `GET /v1/admin/orders/:id` de este módulo intercepta esa
request si se registra primero, tratando `"pending-payment"` como si fuera un
uuid y devolviendo un 400 de `ParseUUIDPipe` en vez de la respuesta real de
US-023.

La mitigación: `:id` está restringido a **forma UUID** directamente en el
path (`orders.controller.ts`, sintaxis `path-to-regexp` de Nest/Express) —
`GET /admin/orders/pending-payment` nunca matchea `get(UUID_PATH)`, sin
importar qué módulo se registre primero en `app.module.ts`. `T7.2` prueba
esto montando **sólo** `OrdersModule` (sin el controller de US-023 presente)
y confirmando 404 de Nest, no 400.
