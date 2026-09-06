# CAP-8 Historial de compras — Requisitos acumulados

Acumulado de los changes archivados de esta capacidad. Cada requisito es el
**estado declarado del sistema vivo**, no la intención de un change.

## Desde US-015 backend — Historial de compras + vínculo cuenta en checkout (archivada 2026-09-06)

Superficie cubierta: `GET /v1/me/orders`, `GET /v1/me/orders/{order_number}`, más el
escritor de `orders.customer_id` en `POST /v1/checkout`.

### Funcionales

| # | Requisito | Origen |
|---|---|---|
| R-1 | `GET /v1/me/orders` lista las órdenes del cliente autenticado, ordenadas de la más reciente a la más antigua, dentro de la ventana de retención vigente (12 meses), excluyendo `pending_payment`. | AC-1, AC-7 |
| R-2 | `GET /v1/me/orders/{order_number}` devuelve el detalle de una orden propia: ítems (cantidad, precio unitario, subtotal), estado actual y modalidad de retiro. | AC-2 |
| R-3 | Sin sesión de cliente válida, ambos endpoints responden 401 sin exponer ninguna fila. | AC-5 |
| R-4 | El detalle de una orden que no existe, no pertenece al cliente autenticado, o quedó fuera de la ventana de retención responde 404 — las tres causas son indistinguibles hacia afuera (IDOR). | AC-4 |
| R-5 | El checkout (`POST /v1/checkout`) resuelve la sesión del cliente **si existe** (`OptionalCustomerGuard`) y, de haberla, setea `orders.customer_id` al crear la orden. Sin sesión, el comportamiento es idéntico al de antes de esta US (guest). | Alcance ampliado, ver `decisions.md` |
| R-6 | Las compras hechas como invitado con el mismo email de una cuenta NO se vinculan retroactivamente — sólo un checkout nuevo, hecho con sesión activa, produce una orden con `customer_id`. | AC-6 |

### Negative-space (lo que NO debe pasar)

| # | Requisito |
|---|---|
| N-1 | El guest checkout no cambia de comportamiento observable: los 12 archivos de test de `US-008-checkout-guest-backend` pasan sin una sola aserción modificada. |
| N-2 | Ningún endpoint del historial expone el UUID interno de la orden — el identificador público es siempre `order_number`. |
| N-3 | Ningún endpoint del historial expone datos de contacto del comprador (`buyer_email`/`buyer_phone`) — el cliente ya sabe quién es. |
| N-4 | La autorización nunca es un chequeo posterior a la lectura — `customer_id` y el corte de retención están en el `WHERE` de la misma consulta que resuelve la orden. |

### No funcionales

| # | Requisito | Verificación |
|---|---|---|
| NFR-1 | `GET /v1/me/orders` — p95 < 300ms (PRD §4, heredado). | k6, medido p95 = 3.29ms. |
| NFR-2 | El historial tiene su propio presupuesto de rate-limit (`ORDERS_HISTORY_RATE_LIMIT_MAX`/`_TTL_MS`), sin consumir el cupo de auth/storefront/cart/checkout/enrichment/search/payments_simulate. | Suite dev-owned + contract testing. |
