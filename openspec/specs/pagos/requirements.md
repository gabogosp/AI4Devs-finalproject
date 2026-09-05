# CAP-4 Pagos — Requisitos acumulados

Acumulado de los changes archivados de esta capacidad. Cada requisito es el
**estado declarado del sistema vivo**, no la intención de un change.

## Desde US-023 backend — Confirmación de pago manual/offline (archivada 2026-09-05)

Superficie cubierta: `POST /admin/orders/{orderId}/confirm-payment`,
`GET /admin/orders/pending-payment`.

### Funcionales

| # | Requisito | Origen |
|---|---|---|
| R-1 | Confirmar el pago de una orden `pending_payment` transiciona su estado a `new`, decrementa el stock de cada línea y registra un pago `provider=manual`, las tres escrituras en una sola transacción. | AC-1, AC-6 |
| R-2 | `GET /admin/orders/pending-payment` lista las órdenes `pending_payment` con `id`, `order_number`, `buyer_name`, `total_ars_cents`, `created_at` — sin email/teléfono, sin paginación. | AC-2 |
| R-3 | Confirmar una orden que ya no está `pending_payment` (`new`, `cancelled`, o repetición de una ya confirmada) devuelve `409 dsm:payments/order-not-pending-payment` — mismo resultado observable en los tres casos. | AC-4, AC-5 |
| R-4 | Si el stock de alguna línea no alcanza al momento de confirmar, la confirmación se rechaza con `409 dsm:payments/insufficient-stock` y la transacción entera revierte (la orden no queda `new` sin stock decrementado). | AC-3 |
| R-5 | `payments.confirmed_by` registra el `sub` del JWT admin (uuid de `Customer` o el literal `'admin'` del bootstrap token) — auditoría por fila, sin log adicional. | AC-6 |
| R-6 | Quien confirma, el monto y el `provider` se derivan siempre server-side de la orden y del JWT — ningún campo del request los acepta (el endpoint no tiene body). | Design §Threat model — Tampering |

### Negative-space (lo que NO debe pasar)

| # | Requisito |
|---|---|
| N-1 | Un doble click o un reintento de red sobre `POST /confirm-payment` nunca produce dos pagos ni un doble descuento de stock — `idempotency_key = manual:{orderId}` UNIQUE lo bloquea (`P2002` en el segundo intento). |
| N-2 | `GET /pending-payment` nunca expone `buyer_email` ni `buyer_phone` — lista deliberadamente angosta (mínimo necesario para identificar y accionar). |
| N-3 | Ninguna columna de `payments` puede alojar PAN/CVV/vencimiento/titular — sin expansión de alcance PCI (ADR-0006). |
| N-4 | El decremento de stock nunca ocurre dentro de `apps/api/src/checkout/` — `ac6-stock-untouched.spec.ts` (T5.1 de US-008) lo prohíbe estáticamente; vive en el módulo `stock/` nuevo. |
| N-5 | Ningún evento de observabilidad (`payments.manual_confirmed`, `.manual_confirm_rejected`) lleva PII — sólo `orderId` (nunca como label de métrica) y el motivo del rechazo como argumento tipado, nunca como label libre. |

### No funcionales

| # | Requisito | Verificación |
|---|---|---|
| NFR-1 | La transacción de confirmación no hace llamadas externas — sin timeout/retry/circuit-breaker que planificar; el único riesgo es contención de fila, cubierta por el `WHERE` guardado de cada `UPDATE`. | Suite dev-owned. |
| NFR-2 | Sin throttler dedicado en ninguno de los 2 endpoints — superficie admin de bajo volumen, un solo operador (mismo criterio que `ProductsController`/`CategoriesController`). | Decisión documentada, no verificación automatizada. |

### Diferidos con dueño

| # | Requisito | Dueño / disparador |
|---|---|---|
| D-1 | Adaptador MercadoPago del `PaymentConfirmationPort`. | `US-009-pago-mercadopago-backend` — `Blocked`, sin credenciales de MP. |
| D-2 | Webhook async de confirmación + reconciliación + limpieza de `pending_payment` abandonadas. | `US-010-orden-webhook-stock-backend` — sin planificar. |
| D-3 | Medio de pago simulado «DSM» (aprobación instantánea test/demo). | US-009/US-010, según el PRD §3.2. |
| D-4 | ¿El E2E §8 DER debería incluir `'manual'` en `payments.provider` + `confirmed_by`? | Owner: `tech-architect`. Revisit: próxima vez que se toque `design-e2e.md` §8. |
| D-5 | ¿El job mensual de retención/anonimización de `orders` ya cascadea a `payments` (primera tabla hija por FK desde que ese job se escribió)? | Owner: quien planifique el próximo touch de retención. Revisit: antes de que `payments` acumule 12 meses de filas. |
| D-6 | `confirmed_by` sin FK — ¿trade-off permanente o hay una US de administradores futura? | Owner: Arquitecto/Producto. Revisit: si se introduce gestión de administradores. |
| D-7 | Test que blinde "único escritor" de `orders.repository.ts` (existe para stock vía `ac6-stock-untouched.spec.ts`, no para orders). | Sin AC que lo pida; deuda documentada, no de esta capacidad. |
