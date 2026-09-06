# CAP-5 Panel de fulfillment — Requisitos acumulados

Acumulado de los changes archivados de esta capacidad. Cada requisito es el **estado
declarado del sistema vivo**, no la intención de un change.

## Desde US-012 backend — Panel de órdenes del dueño: FSM de fulfillment, historial y notificación (archivada 2026-09-05)

Superficie cubierta: `GET /v1/admin/orders`, `GET /v1/admin/orders/{id}`,
`PATCH /v1/admin/orders/{id}`.

### Funcionales

| # | Requisito | Origen |
|---|---|---|
| R-1 | `GET /v1/admin/orders` lista las órdenes en los 4 estados activos de fulfillment, paginada (`limit` 1-100 default 20, `offset`), ordenable por `order_number`/`created_at`/`total_ars_cents` (asc/desc, default `-created_at`) y filtrable por `status`. | AC-1, AC-5 |
| R-2 | `GET /v1/admin/orders/{id}` devuelve el detalle con ítems (nombre, SKU, cantidad, precio, subtotal), contacto del comprador, modo de retiro e historial de transiciones. | AC-2, AC-9 |
| R-3 | `PATCH /v1/admin/orders/{id} { status }` avanza **un** paso de la FSM de fulfillment (`new→preparing→ready→delivered`); `status` fuera de `preparing\|ready\|delivered` es `422` (`cancelled` nunca es un valor de tipo válido acá). | AC-3, AC-6 |
| R-4 | Una transición a `status=ready` invoca `NotificationPort.orderReadyForPickup` (seam) — la entrega real del aviso es `Deferred: US-011 — owner: BE`. | AC-4 |
| R-5 | El listado y el detalle **nunca** incluyen `pending_payment` ni `cancelled` como resultado del listado sin filtro explícito; el detalle de una orden `pending_payment` responde `404` (`dsm:orders/not-found`); `cancelled` sí responde `200` (defensivo, trazable por id). | AC-8 |
| R-6 | Cada transición aplicada (o rechazada) escribe una fila en `order_status_history` (`from_status`, `to_status`, `changed_by`, `changed_at`) — consultable en el detalle, en orden cronológico. La transición inicial `pending_payment→new` no se escribe acá (la escribe `payments/`, US-023). | AC-9 |
| R-7 | Los tres endpoints están detrás de `AdminGuard` — sin token, `401`; con rol distinto de `admin`, `403`. El backend es la autoridad real; la UI del panel es UX, no el mecanismo de seguridad. | AC-7 |
| R-8 | Un salto de FSM inválido (ej. `new→delivered` directo) se rechaza con `409` (`dsm:orders/invalid-transition`), sin importar qué haya mostrado el cliente; el estado de la orden no cambia. | AC-6 |

### Negative-space (lo que NO debe pasar)

| # | Requisito |
|---|---|
| N-1 | Repetir la misma transición (`status` ya es el pedido) es idempotente **por estructura** (`UPDATE ... WHERE status=$from`): responde `200` sin re-disparar la notificación ni agregar una segunda fila en `order_status_history`. |
| N-2 | El header `Idempotency-Key` que el FE manda se acepta y se **ignora** — la idempotencia real es estructural, no por clave almacenada. |
| N-3 | Ninguna PII del comprador (nombre, email, teléfono) sale por el `NotificationPort`/eventos hacia el log — `OrderEventsService.emit` sólo acepta `orderId` y los dos enums de estado. |
| N-4 | `:id` fuera de forma UUID nunca matchea `GET/PATCH /admin/orders/{id}` (regex de forma en el path de Nest) — evita que `pending-payment` (ruta de US-023 bajo el mismo prefijo) sea interpretado como un `id`, sin importar el orden de registro de los dos módulos. |

### No funcionales

| # | Requisito | Verificación |
|---|---|---|
| NFR-1 | Latencia de lectura (`GET`) **p95 < 300 ms** (PRD §4). Índice existente `orders(status, created_at)` cubre el caso por defecto. | Medido bajo carga (k6, QA): p95 = 1.81 ms. |
| NFR-2 | Latencia de escritura (`PATCH`) **p95 < 500 ms**. Transacción corta: un `UPDATE` condicional + un `INSERT`, sin llamadas externas dentro (notificación después del commit). | Medido bajo carga (k6, QA): p95 = 3.11 ms. |
| NFR-3 | Volumetría: ~100 órdenes/mes, retención 12 meses ⇒ ~1.200 filas/año en `orders`, ~3.600 en `order_status_history`. Sin ajuste de infraestructura. | Diseño (E2E §17). |

### Diferidos con dueño

| # | Requisito | Dueño / disparador |
|---|---|---|
| D-1 | Entrega real del aviso "lista para retirar" (el seam ya dispara; el adaptador es un log local). | US-011. |
| D-2 | Cancelación / reintegro de stock. | US-013. |
| D-3 | Métricas agregadas / gráficos del panel. | US-016. |
| D-4 | ~~Reconciliación con `US-010-orden-webhook-stock-backend`~~ | **Resuelta** (archivada 2026-09-05): US-010 vivió del lado de la capacidad hermana `pagos`, sin tocar `OrdersModule`/FSM de fulfillment de esta capacidad. |
| D-5 | `PendingPaymentsPanel` (confirmar pagos manuales desde el panel) — endpoints propios de `pagos` (US-023), consumidos por el FE de esta US. | `US-012-panel-ordenes-dueno-frontend-web` (PR #31). |
| D-6 | Tests de carga adicionales bajo volumen realista prod-shaped. | `/plan-qa` de un ciclo futuro. |
