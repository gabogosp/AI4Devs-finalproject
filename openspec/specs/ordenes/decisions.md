# CAP-5 Panel de fulfillment — Decisiones

Decisiones que gobiernan el estado vivo de la capacidad. Los ADR son la fuente de verdad;
acá se registra **cuál aplica a esta capacidad y por qué**.

## ADRs que aplican

| ADR | Decisión | Impacto en esta capacidad |
|---|---|---|
| [ADR-0009](../../../docs/architecture/decisions/) | Seam mínimo de auth admin, JWT + claim `role=admin`. | `AdminGuard` gatea los tres endpoints, congelado (US-014 lo declara con un `git diff --exit-code`) — este change no lo toca. |
| [ADR-0008](../../../docs/architecture/decisions/) | El stock se descuenta al aprobarse el pago, sin reserva con TTL. | Fuera de alcance directo de este panel (la orden ya llega pagada), pero la FSM de fulfillment nunca decrementa stock — eso sigue siendo US-010/pagos. |
| [ADR-0007](../../../docs/architecture/decisions/) | Monolito modular en NestJS. | `OrdersModule` es un módulo nuevo dentro del mismo deployable, importa `CheckoutModule` sólo para inyectar `OrdersRepository` (sin `forwardRef`, dirección acíclica `orders → checkout`). |

Ninguna decisión de este change enmienda o bordea un ADR existente — no se abrió ADR
nuevo (verificado contra los ADR vigentes y el E2E §20).

## Decisiones de implementación tomadas durante la construcción

| Decisión | Motivo |
|---|---|
| Módulo nuevo `src/orders/`, no extensión de `checkout/`. | El controller/servicio de este panel (paginación, `sort`, FSM de fulfillment, notificación, historial) no tiene relación funcional con el checkout guest (rate-limited, CSRF, anónimo) — mezclar ambos acopla superficies con audiencias y ciclos de vida distintos. La única pieza compartida (`orders`/`order_items`) se resuelve importando el repositorio, no el módulo entero. |
| `order_status_history` — tabla nueva y aditiva, sin invocar `data-architect` Mode B. | Workload relacional simple, append-only, FK a una tabla ya existente, escala pequeña (~3.600 filas/año) — cae del lado trivial de `data-architecture-patterns`. |
| Idempotencia del `PATCH`: **estructural** (`UPDATE ... WHERE status=$from`), no por `Idempotency-Key` almacenada. | El header que el FE manda se acepta y se ignora — el mecanismo real de idempotencia es el `WHERE` condicional dentro de la transacción, mismo patrón que `ConfirmOrderService` de US-023 introdujo primero en el repo. |
| `:id` restringido por regex de forma UUID en el path de Nest (`path-to-regexp`), no un `ParseUUIDPipe` suelto. | Resuelve la colisión de rutas con `GET /admin/orders/pending-payment` (US-023, mismo prefijo) de forma **independiente del orden de merge/registro** de los dos módulos en `app.module.ts` — sin coordinar manualmente qué import va primero. Trade-off aceptado: un segmento sin forma UUID cae en el 404 genérico de Nest en vez de un 400 de `ParseUUIDPipe` — caso de borde sin AC que lo pida. |
| Status `409` (no `422`) para una transición inválida. | RFC 7231 §6.5.8: 409 es "la solicitud entra en conflicto con el estado actual del recurso" — exactamente un salto de FSM inválido. Mismo código que `OrderNotPendingPaymentError` de US-023 para la misma clase de conflicto, mismo prefijo de naming `dsm:{módulo}/{condición}`, sin compartir la clase entre los dos módulos. |
| `sort` como enum cerrado de 6 valores, no un parser custom. | Con sólo 3 campos ordenables × 2 direcciones, `@IsIn([...])` en el DTO valida y devuelve 422 por el `ValidationPipe` global — sin una función que lance una excepción de dominio a mano (`base-standards.md` §1 KISS). |
| `order_status_history.changed_by` sin FK a `Customer`. | Mismo trade-off que `payments.confirmed_by` de US-023: cubre el caso de bootstrap (`sub: 'admin'`, sin fila en `Customer`) a costa de integridad referencial — se decodifica el mismo bearer token que `AdminGuard` ya verificó (`JwtService.decode`, sin re-verificar), sin tocar el guard congelado. |
| `NotificationPort.orderReadyForPickup` — nuevo, un solo método (no una extensión de un puerto de US-010 que no existe). | Es el primer puerto de notificación del repo; `LoggingNotificationAdapter` registra una línea sin PII (sólo `order_id`/`order_number`). US-011 reemplaza el adaptador completo cuando exista un proveedor real, sin tocar el contrato del puerto. |
| Sin índice nuevo sobre `orders(created_at)` en solitario. | El compuesto `orders(status, created_at)` ya existente (de US-008) cubre el filtro por `status` + orden por fecha, que es el caso por defecto — un índice adicional sería redundante. |

## Riesgo de reconciliación con US-010 (nota para quien la retome)

`US-010-orden-webhook-stock-backend` está indefinidamente pospuesta (US-009 `Blocked`,
sin credenciales de MercadoPago) y **no** inauguró esta capacidad como su diseño
original preveía. Si se retoma, su plan tendrá que reconciliarse contra lo que este
change ya construyó (`OrdersModule`, FSM de 4 estados propia, `order_status_history`),
en vez de asumir un árbol `src/orders/` vacío — ver `design.md` archivado de US-012
backend, sección Context, para el detalle de qué verificó y descartó de la versión
anterior del diseño.

## Desviaciones conscientes registradas

| Desviación | Motivo |
|---|---|
| `:id` sin el 400 limpio de `ParseUUIDPipe` para segmentos sin forma UUID (cae en el 404 genérico de Nest). | Ver decisión de arriba — resuelve la colisión de rutas de forma robusta e independiente del orden de merge entre dos changes desarrollados en worktrees separados. Caso de borde, sin AC que lo pida. |
