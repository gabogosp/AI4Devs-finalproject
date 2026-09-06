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

## Desde US-010 backend — Webhook de MercadoPago, medio simulado y decremento atómico de stock (archivada 2026-09-05)

Superficie cubierta: `POST /webhooks/mercadopago`, `POST /checkout/simulate-payment`,
`POST /admin/payments/reconcile`, `POST /admin/orders/cleanup-abandoned`,
`POST /admin/payments/retry-refunds`. **Resuelve D-2 y D-3 de arriba.**

`ConfirmOrderService.confirm()` (US-023) se amplía con una unión discriminada de
`provider` (`'manual' | 'mercadopago' | 'simulated_dsm'`) — un solo método, la rama
`manual` sin una línea de cambio (AC-9 estructural: el medio simulado ejercita
literalmente el mismo código que el webhook real).

### Funcionales

| # | Requisito | Origen |
|---|---|---|
| R-7 | `POST /webhooks/mercadopago` verifica la firma (`x-signature`, HMAC-SHA256 en tiempo constante + ventana de tolerancia sobre `ts`), **re-consulta el pago a la API de MercadoPago** (la verdad nunca sale del payload recibido) y, si `status=approved`, confirma la orden por el mismo camino que el pago manual. | AC-1, AC-3, AC-7 |
| R-8 | El webhook es idempotente por el guard `orders.status='pending_payment'` (US-023, `UPDATE ... WHERE`) — un duplicado/tardío/fuera-de-orden es un no-op, nunca decrementa stock dos veces ni produce un segundo pago. `payments.idempotency_key` (`{provider}:{externalId}`) es la segunda red. | AC-5, AC-6 |
| R-9 | El webhook responde **siempre 200 salvo firma inválida (401)** — MercadoPago reintenta ante cualquier no-2xx; un 500 propio desataría una tormenta de reintentos. Un fallo transitorio (orden inexistente, error no determinístico) se loguea y queda para la reconciliación admin. | AC-7, Design D2 |
| R-10 | Si el stock de alguna línea no alcanza al confirmar un pago automático (`mercadopago`/`simulated_dsm`), la orden se cancela (`cancelled_at`), el pago queda `refund_pending` y se intenta el reembolso (no-op para `simulated_dsm`, llamada real a MercadoPago para `mercadopago`) — si el reembolso falla, la fila **nunca se cierra como fallido definitivo**, queda para `POST /admin/payments/retry-refunds`. | AC-4 |
| R-11 | `POST /checkout/simulate-payment` (autorizado por `order_token` de la orden, no por JWT) ejercita el mismo `ConfirmOrderService.confirm()` que el webhook real, con `provider='simulated_dsm'` — AC-9 es estructural, no sólo declarado. Gateado por `PAYMENTS_SIMULATED_ENABLED`, que **hace fallar el arranque** si está en `true` con `NODE_ENV=production` (ADR-0006 enforced en código, no sólo checklist). Responde 404 (no 403) cuando el flag está apagado. | AC-9 |
| R-12 | `POST /admin/payments/reconcile` toma hasta `RECONCILE_BATCH_SIZE` órdenes `pending_payment` con más de `RECONCILE_MIN_AGE_MS`, re-consulta a MercadoPago por `external_reference` y procesa las aprobadas por el mismo `ConfirmOrderService.confirm()` — idempotente por construcción, reconciliar un pago que el webhook ya procesó es un no-op. | AC-10 |
| R-13 | `POST /admin/orders/cleanup-abandoned` cancela, en un `updateMany` guardado por `created_at`, las `pending_payment` más viejas que `ORDER_ABANDON_HOURS` (default 48h). | AC-11 |
| R-14 | `POST /admin/payments/retry-refunds` reintenta hasta `REFUND_RETRY_BATCH_SIZE` pagos `refund_pending` contra `MercadoPagoClient.refund`. | AC-4 (durabilidad) |
| R-15 | Los tres endpoints admin (reconcile/cleanup-abandoned/retry-refunds) no tienen scheduler in-process — un cron externo (Railway/GitHub Actions) les pega periódicamente. Verificado con `grep`: no hay `setInterval` en `apps/api/src`. | Design D8 |
| R-16 | `orders` gana `confirmed_at`/`cancelled_at` (timestamptz, nullable, aditivo); `payments.status` gana `refund_pending` en su `CHECK`. | Design §Persistencia |
| R-17 | `NotificationPort` (de `orders/`, no un puerto paralelo) gana `orderConfirmed`/`ownerNewOrder`/`orderCancelledNoStock` — invocados **después** del commit, nunca dentro de la transacción; un fallo de notificación no revierte una venta ya cobrada. Adaptador de log real, sin PII (`buyerName`/`buyerEmail` nunca logueados). Entrega real: `Deferred: US-011`. | AC-2 |

### Negative-space (lo que NO debe pasar)

| # | Requisito |
|---|---|
| N-6 | Un webhook con firma inválida, ausente o con `ts` fuera de ventana nunca consulta a MercadoPago ni toca la base — 401 antes de cualquier escritura. |
| N-7 | El webhook nunca confía en `status`/`external_reference`/`transaction_amount` del body recibido — sólo usa `data.id` para re-consultar; la verdad sale exclusivamente de esa re-consulta. |
| N-8 | El webhook nunca lleva throttler ni CSRF — limitar por IP la puerta de entrada de dinero descartaría pagos legítimos cuando MercadoPago reintenta en ráfaga. |
| N-9 | `PAYMENTS_SIMULATED_ENABLED=true` nunca arranca la app con `NODE_ENV=production` — gate de arranque (`superRefine`), no checklist humano. |
| N-10 | Un reembolso automático fallido nunca se pierde en memoria ni se marca fallido definitivo — el estado `refund_pending` es persistido y reintentable indefinidamente. |
| N-11 | La rama `provider='manual'` de `ConfirmOrderService.confirm()` no cambia una línea por este change — `confirm-order.service.spec.ts` (US-023, frozen) permanece con cero diff. |

### No funcionales

| # | Requisito | Verificación |
|---|---|---|
| NFR-3 | Webhook: p95 < 800ms (la re-consulta a MP domina, timeout 4s). Simulate-payment: p95 < 200ms (sin llamada externa). `[propuesto — confirma Ops]` | Design D12, sin medición en producción todavía (sin tráfico real de MercadoPago). |
| NFR-4 | Resiliencia del `MercadoPagoClient`: timeout por request (`MP_HTTP_TIMEOUT_MS`, default 4000ms), backoff+jitter sobre 429/5xx/timeout, circuit-breaker in-process (cooldown tras N fallos consecutivos). | Suite dev-owned (mocks — sin cuenta real de MercadoPago todavía). |
| NFR-5 | Concurrencia probada con Postgres real (no mocks): N confirmaciones simultáneas sobre la última unidad de stock de una orden. | `e2e-payments-concurrency.spec.ts`. |

### Diferidos con dueño

| # | Requisito | Dueño / disparador |
|---|---|---|
| D-1 | Adaptador MercadoPago del `PaymentConfirmationPort`. | ~~`US-009-pago-mercadopago-backend` — `Blocked`, sin credenciales de MP.~~ **Parcialmente resuelto**: US-010 construyó `MercadoPagoClient` (alcance mínimo: `getPayment`/`searchByExternalReference`/`refund`). Sigue faltando `createPreference` (crear preferencia, redirigir al comprador a Checkout Pro) — eso sigue siendo `US-009`, `Blocked` sin credenciales. |
| D-2 | ~~Webhook async de confirmación + reconciliación + limpieza de `pending_payment` abandonadas.~~ **Resuelto por `US-010-orden-webhook-stock-backend`** (ver arriba). |
| D-3 | ~~Medio de pago simulado «DSM» (aprobación instantánea test/demo).~~ **Resuelto por `US-010-orden-webhook-stock-backend`** (ver arriba). |
| D-4 | ¿El E2E §8 DER debería incluir `'manual'` en `payments.provider` + `confirmed_by`? | Owner: `tech-architect`. Revisit: próxima vez que se toque `design-e2e.md` §8. |
| D-5 | ¿El job mensual de retención/anonimización de `orders` ya cascadea a `payments` (primera tabla hija por FK desde que ese job se escribió)? | Owner: quien planifique el próximo touch de retención. Revisit: antes de que `payments` acumule 12 meses de filas. |
| D-6 | `confirmed_by` sin FK — ¿trade-off permanente o hay una US de administradores futura? | Owner: Arquitecto/Producto. Revisit: si se introduce gestión de administradores. |
| D-7 | Test que blinde "único escritor" de `orders.repository.ts` (existe para stock vía `ac6-stock-untouched.spec.ts`, no para orders). | Sin AC que lo pida; deuda documentada, no de esta capacidad. |
| D-8 | Tráfico real de producción contra MercadoPago (webhook recibiendo notificaciones reales, `createPreference`) — todo lo demás (código, tests unitarios, integración con Postgres real, medio simulado end-to-end) se construyó y verificó en US-010 con mocks. | `US-009-pago-mercadopago-backend` — necesita cuenta real de MercadoPago (`MP_ACCESS_TOKEN`/`MP_WEBHOOK_SECRET` reales + webhook URL configurada en el dashboard de MP). |
| D-9 | Disparo periódico real de los 3 jobs admin (reconcile/cleanup-abandoned/retry-refunds) — decisión de infraestructura (Railway Cron Job / GitHub Actions), no de código de aplicación. | Owner: `infrastructure-developer` / `deployment-planner`, próximo `/plan-deployment` de esta capacidad. |
| D-10 | 5 preguntas abiertas de US-010 (`design.md` §Open questions — plazo de abandono, tope de reintentos de reembolso, prefijo de `simulate-payment`, ventana de tolerancia de firma, si reconciliar también pagos rechazados), ninguna bloqueó el arranque, todas con default implementado. | Owner: quien retome ajustes de estos parámetros. Revisit: si el comportamiento observado en producción difiere del supuesto. |
