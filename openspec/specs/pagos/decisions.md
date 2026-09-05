# CAP-4 Pagos — Decisiones

Decisiones que gobiernan el estado vivo de la capacidad. Los ADR son la
fuente de verdad; acá se registra **cuál aplica a esta capacidad y por qué**.

## ADRs que aplican

| ADR | Decisión | Impacto en esta capacidad |
|---|---|---|
| [ADR-0008](../../../docs/architecture/decisions/) | El stock se descuenta al aprobarse el pago, sin reserva con TTL. | Gobierna todo este change: el decremento ocurre recién en `confirm()`, dentro de la misma transacción que la transición a `new`. |
| [ADR-0006](../../../docs/architecture/decisions/) | MercadoPago checkout hosted, sin datos de tarjeta en el propio sistema. | `payments` no guarda PAN/CVV/vencimiento/titular en ningún `provider`, incluido `manual`. |
| [ADR-0009](../../../docs/architecture/decisions/) | Seam de auth admin (`AdminGuard`, JWT `role=admin`). | Los 2 endpoints de esta capacidad son admin-only; `confirmed_by` se deriva decodificando (no re-verificando) el mismo bearer que el guard ya validó. |

Ninguna decisión de este change abre un ADR nuevo (verificado contra los ADR
vigentes y el E2E §20).

## Decisiones de implementación

### Desde US-010 backend (archivada 2026-09-05)

| Id | Decisión | Fundamento |
|---|---|---|
| D10 | `ConfirmPaymentInput` se amplía a unión discriminada (`ConfirmManualPaymentInput \| ConfirmWebhookPaymentInput`) en vez de crear un servicio hermano para providers automáticos. | Es lo que vuelve AC-9 estructural: un solo `ConfirmOrderService.confirm()`, una rama que sólo corre para `manual` (sin cambios) y otra para `mercadopago`/`simulated_dsm` (nueva) — nunca dos caminos que puedan divergir. |
| D11 | Idempotencia del webhook por el guard de `orders` (`UPDATE ... WHERE status='pending_payment'`, ya construido por US-023), no por `SELECT ... FOR UPDATE` explícito. | Un `SELECT ... FOR UPDATE` agregaría una segunda forma de lograr lo mismo que el guard ya logra bajo concurrencia, con más superficie para que las dos diverjan. Probado con Postgres real, 10 confirmaciones concurrentes sobre la última unidad de stock. |
| D12 | `MercadoPagoClient` se construye en este change (`getPayment`/`searchByExternalReference`/`refund`), **sin** `createPreference`. La dependencia se invierte respecto al plan original: antes "US-009 construye el cliente, US-010 lo extiende"; ahora "US-010 construye el cliente mínimo, US-009 lo extiende con `createPreference` cuando existan credenciales". | US-009 seguía `Blocked` (sin credenciales) y el cliente no existía en el repo — una US bloqueada por credenciales externas no debe paralizar trabajo que sí puede avanzar (mismo criterio que el regenerate de `US-012-panel-ordenes-dueno-backend`). |
| D13 | Backoff/retry de `MercadoPagoClient` (`payments/mercadopago/backoff.ts`) duplica el patrón puro de `enrichment/ai/backoff.ts` en vez de importarlo. | Evita acoplar `payments` al tipo de error de `enrichment` (`EnrichmentTransientError`) por una utilidad de ~50 líneas — duplicación chica y deliberada, documentada en `design.md` Trade-offs. |
| D14 | El webhook responde siempre 200 salvo firma inválida (401) — incluso ante `OrderNotFoundError` o cualquier error no determinístico al confirmar. `POST /checkout/simulate-payment` NO comparte esta política (responde 409 real ante auto-cancelación). | MercadoPago reintenta ante cualquier no-2xx — un 500 propio desataría una tormenta de reintentos justo cuando el sistema está mal; el fallo transitorio queda para `POST /admin/payments/reconcile`. `simulate-payment` es invocado directamente por el comprador o un test E2E, no por un proveedor con retry storm — sabe si su llamada falló. |
| D15 | `NotificationPort` (de `orders/`) se amplía con 3 métodos nuevos en vez de crear un `PaymentNotificationPort` paralelo en `payments/`. | Ambos conceptos ("avisar algo sobre una orden") son el mismo; un puerto paralelo dejaría a US-011 con dos puertos que implementar para la misma idea de negocio. La dirección `payments → orders` no genera ciclo (`orders` no importa `payments`, verificado). |
| D16 | Los 3 jobs admin (reconcile/cleanup-abandoned/retry-refunds) son endpoints admin sin scheduler in-process — ningún `setInterval` en `apps/api/src` (verificado con `grep`). | Sigue el patrón real del repo (evento + endpoint admin, `import-runner.ts`/`enrichment.runner.ts`) en vez de introducir `@nestjs/schedule`, evitando la dependencia que el resto del repo evitó tres veces antes (ADR-0012/0014). El disparo periódico real es responsabilidad de infraestructura (cron externo). |

| Id | Decisión | Fundamento |
|---|---|---|
| D1 | `PaymentConfirmationPort` + `ConfirmOrderService` en `src/payments/`, mismo nombre/lugar que `US-010-orden-webhook-stock-backend/design.md` §D9 ya había reservado sin construir. | Para que US-009/US-010 lo reusen sin renombrar cuando se planifiquen. |
| D2 | Módulos nuevos `stock/` y `payments/`, en vez de extender `checkout/orders.repository.ts`. | `checkout/ac6-stock-untouched.spec.ts` (US-008 T5.1) escanea estáticamente `checkout/` y falla ante cualquier escritura de stock ahí — descarta la opción "extender el repository existente". |
| D3 | `payments.provider` agrega `'manual'` al enum del DER (que sólo tenía `mercadopago`\|`simulated_dsm`) + columna `confirmed_by` sin FK. | Deviación declarada del DER (E2E §8) — sin esto no hay forma de registrar quién confirmó un pago sin tercero. |
| D4 | El `CHECK` de `provider` ya incluye los tres valores (`mercadopago`\|`simulated_dsm`\|`manual`) aunque este change sólo escribe `'manual'`. | Reconciliación con `US-009-pago-mercadopago-backend/design.md` §Persistencia (planificado, sin construir): evita que la futura migración aditiva de US-009 tenga que tocar el constraint. |
| D5 | `idempotency_key` determinístico: `manual:{orderId}`. | Reusa el patrón UNIQUE que el DER ya declaraba para `payments`, sin inventar un segundo mecanismo de idempotencia. |
| D6 | Identidad del confirmador vía decodificación del JWT en el controller (`jwt.decode`), no extendiendo `AdminGuard` para adjuntar `req.admin`. | `AdminGuard`/`admin-auth.service.ts` está congelado por un `git diff --exit-code` de US-014 contra la base de su rama — tocarlo rompería ese contrato. Decodificar (no re-verificar, el guard ya lo hizo) es una operación local sin costo de red. |
| D7 | `GET /pending-payment` sin paginación. | Volumen esperado: unidades de órdenes pendientes por día, un solo local (MVP). |
| D8 | `GET /pending-payment` **convive** con `GET /admin/orders` de US-012, no se unifican. | Decisión coordinada 2026-08-30 con quien planificó `US-012-panel-ordenes-dueno-backend`/`-frontend-web`: el listado general de US-012 sigue excluyendo `pending_payment` siempre (su AC-8 intacto); el FE de US-012 consume este endpoint en un componente separado (`PendingPaymentsPanel.tsx`). |
| D9 | Transacción Prisma cruzando tres repositorios (`orders`, `stock`, `payments`) — primera vez en el repo. | La alternativa (cada repository sin transacción compartida) rompe la atomicidad que ADR-0008 exige: una orden `new` con stock sin decrementar (o viceversa) es un bug de integridad de datos, no un detalle cosmético. |

## Colisión de rutas con `ordenes` (US-012)

`PaymentConfirmationController` (esta capacidad) y `OrdersController`
(capacidad `ordenes`, US-012) comparten el prefijo `@Controller('v1/admin/orders')`.
Sin restricción de forma, `GET/PATCH /admin/orders/:id` de US-012 podría
interceptar el literal `/admin/orders/pending-payment` de esta capacidad
según el orden de registro de módulos (Express/Nest matchean por orden, no
por especificidad). **Resuelto del lado de US-012**: su `:id` está
restringido a forma UUID (regex de `path-to-regexp`), lo que hace que el
orden de registro deje de importar. No requiere ningún cambio de este lado;
documentado en ambas capacidades.

## Desviaciones conscientes registradas

| Desviación | Motivo |
|---|---|
| `payments.provider` incluye `'manual'`, ausente del DER original (E2E §8, que sólo tenía `mercadopago`\|`simulated_dsm`). | Documentada en `design.md` del change archivado — necesaria para que exista un tercer camino de pago sin tercero. |
| `payments.confirmed_by` sin FK a `customers`. | Soporta el caso bootstrap-token (sesión admin sin fila en `Customer`); un FK real lo rechazaría. Trade-off consciente, revisitable si se introduce una tabla `admins` formal (ver requirements.md D-6). |
| `payments.created_at`/`updated_at` agregadas, ausentes del DER. | Convención universal del esquema (`Order`/`Product`/`Customer` ya las tienen); `US-009-pago-mercadopago-backend/design.md` §Persistencia ya las pide para su propio caso (auditar intentos `pending` sin resolver). |
| `orders.confirmed_at`/`cancelled_at` agregadas (US-010) — el E2E §12 sólo modela `delivered_at`. | Sin ellas no hay insumo para reconstruir cuándo se confirmó una venta (`US-016`) ni para distinguir un abandono (AC-11) de un auto-cancel por falta de stock (AC-4). |
| `payments.status` gana `refund_pending` en su `CHECK` (US-010) — hoy `pending\|approved\|rejected\|refunded`. | Hace durable el reembolso de AC-4: si la llamada a MercadoPago falla, la fila queda para reintento (`POST /admin/payments/retry-refunds`) en vez de perderse en memoria. |

## Threat model (STRIDE lite, desde US-010 — superficie webhook público + endpoint simulado + admin)

| Superficie | Amenaza | Control |
|---|---|---|
| `POST /webhooks/mercadopago` | Spoofing/Tampering (falso "approved") | Firma HMAC en tiempo constante + ventana de `ts` + re-consulta a MP (el body sólo aporta el `id`). |
| idem | Replay | Ventana de 5 min sobre `ts`; y aunque pasara, la idempotencia lo vuelve no-op. |
| idem | DoS | Sin throttler a propósito — el costo de rechazar es un HMAC, nada no verificado toca la base. |
| idem | Information disclosure | `PaymentsEventsService` sólo loguea `order_id`/`payment_id`/`provider`, nunca PII del comprador. |
| `POST /checkout/simulate-payment` | Tampering (uso en producción) | `superRefine` de `env.validation.ts` hace fallar el arranque si el flag está en `true` en prod. |
| idem | Spoofing (adivinar `order_token` ajeno) | Espacio de 256 bits + rate limit propio. |
| Los 3 endpoints admin | Elevation of privilege | `AdminGuard` existente; los tres son idempotentes — dispararlos de más no rompe nada. |
| `payments.refund_pending` | Repudiation ("no me devolvieron") | Estado persistido + `RefundRetryService` + evento `payments.refund_failed`; nunca se marca fallido definitivo. |
