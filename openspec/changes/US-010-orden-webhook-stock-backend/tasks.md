# US-010 Backend — Tasks

> Convención de este repo: `pnpm --filter @dsm/api test -- --testPathPattern=<patrón>` corre
> Jest en su forma no-watch por defecto (termina solo, F49). `pnpm --filter @dsm/db migrate:dev`
> aplica una migración nueva contra la base local; `migrate:deploy` la aplica en CI/test.

## Traceability matrix (AC → tasks)

| AC | Título | Task IDs |
|---|---|---|
| AC-1 | pago aprobado confirma y decrementa | T5.1, T5.2, T6.1, T14.1 |
| AC-2 | dispara notificaciones | T8.1, T8.2, T5.3 |
| AC-3 | rechazado no confirma ni toca stock | T6.1, T6.2 |
| AC-4 | aprobado sin stock → reembolso | T5.4, T5.5, T5.6, T14.2 |
| AC-5 | duplicado no decrementa dos veces | T14.3 |
| AC-6 | tardío / fuera de orden | T14.3 |
| AC-7 | webhook no verificado se rechaza | T4.1, T4.2, T6.3 |
| AC-8 | stock nunca negativo | T14.4 |
| AC-9 | medio simulado, mismo camino | T7.1, T7.2, T7.3, T14.5 |
| AC-10 | reconciliación de webhook faltante | T9.1, T9.2 |
| AC-11 | limpieza de abandonadas | T10.1, T10.2 |

## Pre-requisites

- [x] Working tree limpio en `main`, sin cambios sin commitear en `apps/api/`.
  - **Exit criterion**: `git status --porcelain apps/api packages/db` no imprime nada.
  - **Verify**: `git status --porcelain apps/api packages/db`
  - **Nota de ejecución (2026-09-05)**: worktree aislado desde `origin/main` — limpio por
    construcción.

## Phase 0: Baseline de regresión (US-023 no se rompe)

- [x] T0.1 Correr la suite completa de `payments/` y `checkout/` ANTES de tocar nada, como
  baseline.
  - **Exit criterion**: todos los specs de `payments/`, `checkout/`, `orders/`, `stock/`
    pasan en el estado actual del repo (antes de cualquier cambio de este change).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern='payments|checkout|orders|stock'`
  - **Nota de ejecución (2026-09-05)**: 184/184 test suites, 1610/1610 tests verdes (Postgres
    aislado propio, `localhost:55433` — el `:55432` compartido tiene una migración ajena
    en vuelo de `US-021-retencion-datos-backend`, `20260902120000_add_order_anonymization`,
    todavía sin mergear a `main`).

## Phase 1: Migración (aditiva — `orders.confirmed_at`/`cancelled_at`, `payments.status` gana `refund_pending`)

- [x] T1.1 Migración Prisma aditiva: `orders.confirmed_at TIMESTAMPTZ NULL`,
  `orders.cancelled_at TIMESTAMPTZ NULL`, y `payments_status_check` recreado con
  `refund_pending` agregado al `IN (...)`.
  - **Pattern**: seguir el precedente de `20260829172227_add_orders/migration.sql` y
    `20260830143351_add_payments/migration.sql` — los `CHECK` se agregan **a mano** en el
    `.sql` (Prisma no los declara en el schema); si `prisma migrate dev` propone drift sobre
    columnas `Unsupported` (vector, tsvector) o sequences con `dbgenerated`, se elimina esa
    parte del SQL generado a mano, dejando sólo lo de este change — per
    `backend-node-standards.md` §5.
  - **Exit criterion**: `packages/db/prisma/schema.prisma` declara los 2 campos nuevos en
    `Order`; la migración SQL generada agrega las 2 columnas + recrea el CHECK de
    `payments.status` con 5 valores, y NO modifica ninguna otra tabla.
  - **Verify**: `pnpm --filter @dsm/db migrate:deploy && psql "$DATABASE_URL" -c "\d+ orders" | grep -q confirmed_at && psql "$DATABASE_URL" -c "\d+ orders" | grep -q cancelled_at && psql "$DATABASE_URL" -c "\d+ payments" | grep -q "refund_pending"`
  - **Nota de ejecución (2026-09-05)**: sin `psql` local instalado — mismo check vía
    `docker exec <contenedor-postgres> psql -U dsm -d dsm -c '\d+ orders|payments'` contra el
    Postgres aislado (`localhost:55433`). `confirmed_at`/`cancelled_at` presentes en
    `orders`; `payments_status_check` con los 5 valores (incluye `refund_pending`). Ninguna
    otra tabla tocada — el drift de Prisma sobre columnas `Unsupported` (vector/tsvector) y
    la sequence de `order_number` se descartó a mano, igual que en las migraciones
    precedentes de US-008/US-009.

- [x] T1.2 `orders.repository.spec.ts` (existente, US-023) sigue verde sin ninguna
  modificación — confirma que la migración es aditiva y no rompe nada tipado.
  - **Exit criterion**: cero diffs en `checkout/orders.repository.spec.ts`.
  - **Verify**: `git diff --stat apps/api/src/checkout/orders.repository.spec.ts | wc -l` da `0`, y `pnpm --filter @dsm/api test -- --testPathPattern=orders.repository`
  - **Nota de ejecución (2026-09-05)**: 0 diffs, 14/14 tests verdes.

## Phase 2: Puerto + repositorios (extienden US-023, sin romper el camino `manual`)

- [x] T2.1 `payment-confirmation.port.ts`: reemplazar `ConfirmPaymentInput` (interfaz única)
  por una unión discriminada `ConfirmManualPaymentInput | ConfirmWebhookPaymentInput`, con
  `ConfirmWebhookPaymentInput { orderId; provider: 'mercadopago' | 'simulated_dsm'; externalId: string; amountArsCents: number }`.
  El literal `provider: 'manual'` de la variante manual no cambia.
  - **Pattern**: unión discriminada por `provider` — TS estrecha el tipo dentro de
    `confirm-order.service.ts` por el valor de ese campo, sin necesitar un type-guard manual.
  - **Exit criterion**: `payment-confirmation.controller.ts` (US-023, sin tocar) sigue
    compilando construyendo `{ orderId, provider: 'manual', confirmedBy }` sin cast.
  - **Verify**: `pnpm --filter @dsm/api typecheck`
  - **Nota de ejecución (2026-09-05)**: `confirm-order.service.ts` se actualizó para importar
    `ConfirmManualPaymentInput` (antes `ConfirmPaymentInput`) como tipo de su parámetro
    `confirm(input)` — sólo el nombre del tipo, cero cambios de lógica. `PaymentConfirmationPort.confirm`
    en la interfaz acepta la unión completa; TS lo permite (chequeo bivariante de parámetros
    en sintaxis de método) sin necesitar ensanchar `confirm-order.service.ts` todavía —
    ese ensanche es T5.1. `payment-confirmation.controller.ts` sin tocar, typecheck limpio.

- [x] T2.2 `checkout/orders.repository.ts`: agregar `transitionToCancelledIfPending(orderId, tx)`
  (guardado por `WHERE status='pending_payment'`, setea `status='cancelled'` +
  `cancelled_at=now()`, `null` si 0 filas) y `cancelAbandonedPending(cutoff: Date): Promise<number>`
  (bulk `updateMany` por `created_at < cutoff`). También agregar `confirmed_at: new Date()`
  al `data` de `transitionToNewIfPending` (sin cambiar su firma).
  - **Pattern**: `UPDATE ... WHERE id=$id AND status='pending_payment'` guardado — mismo
    compare-and-set que `transitionToNewIfPending` ya usa, per `design.md` §D3.
  - **Exit criterion**: sobre una orden `pending_payment`, `transitionToCancelledIfPending`
    la deja `cancelled` con `cancelled_at` no-nulo y devuelve la orden; sobre una orden ya
    `new`, devuelve `null` sin tocarla. `cancelAbandonedPending` cancela sólo las órdenes con
    `created_at` anterior al corte, deja intactas las más nuevas.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=orders.repository`
  - **Nota de ejecución (2026-09-05)**: 18/18 tests verdes (14 preexistentes + 4 nuevos).
    `transitionToCancelledIfPending` recibe `tx` opcional (default `this.prisma`), igual que
    `transitionToNewIfPending` — se usó `tx` explícito en los tests para poder aislar la
    escritura, mismo patrón que `updateStatusConditional`.

- [x] T2.3 `payments.repository.ts`: agregar `createApprovedPayment` (provider
  `mercadopago`/`simulated_dsm`, `status='approved'`, `idempotency_key='{provider}:{externalId}'`),
  `createRefundPendingPayment` (mismos campos, `status='refund_pending'`,
  `idempotency_key='{provider}:{externalId}:refund'`) y `markRefunded(paymentId, tx?)`
  (`UPDATE ... WHERE id=$id AND status='refund_pending'` → `refunded`, guardado). Las dos
  creaciones traducen `PRISMA_UNIQUE_VIOLATION` a `OrderNotPendingPaymentError`, mismo
  criterio que `createManualPayment`.
  - **Exit criterion**: crear dos pagos con el mismo `{provider, externalId}` lanza
    `OrderNotPendingPaymentError` en el segundo intento, nunca un error crudo de Prisma;
    `markRefunded` sobre una fila que NO está `refund_pending` no la toca (guardado).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=payments.repository`
  - **Nota de ejecución (2026-09-05)**: 7/7 tests verdes (2 preexistentes + 5 nuevos).

## Phase 3: Cliente de MercadoPago (alcance mínimo: `getPayment`, `searchByExternalReference`, `refund` — sin `createPreference`)

- [x] T3.1 `payments/mercadopago/backoff.ts`: función pura de backoff exponencial + jitter y
  `withRetry`, con su propio `MercadoPagoTransientError`/`MercadoPagoPermanentError` (NO
  reusar `AiTransientError` de `enrichment/` — duplicación chica y deliberada, `design.md`
  Trade-offs).
  - **Pattern**: copiar la forma de `enrichment/ai/backoff.ts` (`backoffDelayMs`,
    `withRetry` con `sleep`/`random` inyectables para tests deterministas) — per
    `backend-node-standards.md` §8, sin fake timers reales en el test.
  - **Exit criterion**: `withRetry` reintenta sólo `MercadoPagoTransientError`, respeta
    `retryAfterSeconds` sobre el backoff calculado, y NO reintenta
    `MercadoPagoPermanentError`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=payments/mercadopago/backoff`
  - **Nota de ejecución (2026-09-05)**: 9/9 tests verdes. Duplicación deliberada de
    `enrichment/ai/backoff.ts` con `MercadoPagoTransientError`/`MercadoPagoPermanentError`
    propios (`dsm:payments/mercadopago-{transient,permanent}`), sin tocar el módulo de
    enrichment.

- [x] T3.2 `payments/mercadopago/mercadopago-client.ts`: `getPayment(paymentId)`,
  `searchByExternalReference(orderId)`, `refund(paymentId, amountArsCents?)`. `fetch` con
  `AbortSignal.timeout(MP_HTTP_TIMEOUT_MS)`, `Authorization: Bearer {MP_ACCESS_TOKEN}`
  (nunca en la URL), `withRetry` sobre 429/5xx/timeout, y un circuit-breaker in-process
  simple (cooldown tras N fallos consecutivos, mismo estilo que `EnrichmentRunner`, sin
  librería nueva).
  - **Pattern**: `AbortSignal.timeout` + header de auth + traducción de status a
    transitorio/permanente, calcado de `enrichment/ai/gemini-http.client.ts` §"POST con la
    clave en header" — per `backend-node-standards.md` §8.
  - **Exit criterion**: `getPayment` mapea `transaction_amount` (decimal, ARS) a
    `amountArsCents` (entero); un 5xx o timeout de MP dispara reintento; tras N fallos
    consecutivos configurables, una llamada siguiente falla rápido sin llamar a `fetch`
    (breaker abierto); ningún mensaje de error incluye el `MP_ACCESS_TOKEN`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=mercadopago-client`
  - **Nota de ejecución (2026-09-05)**: 12/12 tests verdes. Breaker con umbral y cooldown
    configurables por constructor (seams), no por env — no hay una var `MP_BREAKER_*`
    declarada en el plan (T4.2 no la lista); el umbral por defecto es 5 fallos
    consecutivos / 60s de cooldown.

## Phase 4: Verificación de firma del webhook (pura, sin cuenta real)

- [x] T4.1 `payments/mercadopago/webhook-signature.ts`: `parseSignatureHeader(raw)` (formato
  `ts=...,v1=...`) y `verifyWebhookSignature({ dataId, requestId, ts, v1, secret, toleranceSec, now })`
  — recalcula HMAC-SHA256 sobre `id:{dataId};request-id:{requestId};ts:{ts};` y compara en
  tiempo constante.
  - **Pattern**: `timingSafeEqual` con chequeo de largo previo (`a.length !== b.length ||
    !timingSafeEqual(a, b)`), calcado de `cart/cart-csrf.guard.ts` — per
    `security-standards.md` §6, nunca `===` para comparar HMACs.
  - **Exit criterion**: firma válida dentro de la ventana → `true`; firma válida pero `ts`
    fuera de la ventana de tolerancia → `false`; firma recalculada con secreto distinto →
    `false`; header malformado → `false` sin lanzar.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=webhook-signature`
  - **Nota de ejecución (2026-09-05)**: 10/10 tests verdes.

- [x] T4.2 `env.validation.ts`: agregar `MP_ACCESS_TOKEN`/`MP_WEBHOOK_SECRET` (opcionales a
  nivel de campo, requeridas en producción vía `superRefine`), `MP_HTTP_TIMEOUT_MS` (4000),
  `MP_WEBHOOK_TOLERANCE_SEC` (300), `MP_MAX_RETRIES` (2).
  - **Pattern**: mismo bloque que `RESEND_API_KEY`/`GEMINI_API_KEY` — opcional + `for (const
    campo of [...])` en el `superRefine` de producción — per `backend-node-standards.md` §7
    fail-fast.
  - **Exit criterion**: con `NODE_ENV=production` y sin `MP_ACCESS_TOKEN` o sin
    `MP_WEBHOOK_SECRET`, `validateEnv` lanza; con `NODE_ENV=development` sin ninguno de los
    dos, `validateEnv` NO lanza.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=env.validation`
  - **Nota de ejecución (2026-09-05)**: 48/48 tests verdes. Se actualizaron también 2 tests
    de producción preexistentes (`resend-mailer.spec.ts`, `env.validation.spec.ts` — el caso
    "arranca" de cada uno) para incluir `MP_ACCESS_TOKEN`/`MP_WEBHOOK_SECRET`, igual que ya
    incluían `GEMINI_API_KEY` — un entorno de producción válido las incluye todas.
  - **Hallazgo F40 al correr la suite completa (fuera de esta task, documentado acá porque se
    resolvió en el mismo momento)**: `order-schema.spec.ts` (US-008) y
    `order-status-history-schema.spec.ts` (US-012-backend, ya mergeado) tenían un ancla
    negativa — "`confirmed_at`/`cancelled_at` nunca existieron" — que reflejaba el estado del
    2026-08-30 (US-010 todavía no construido), no una prohibición permanente. Con
    confirmación del usuario, se actualizaron esos 2 tests para reflejar que T1.1 las agrega
    a propósito (26/26 tests de ambos archivos verdes). Detalle completo en el historial de
    `git log` de esos 2 archivos.

## Phase 5: `ConfirmOrderService` ampliado (el corazón del change — AC-1, AC-4, AC-9 estructural)

- [x] T5.1 `confirm-order.service.ts`: extraer la creación del pago a un método privado
  `crearPago(input, confirmada, tx)` que despacha por `input.provider` — `'manual'` llama
  `createManualPayment` (sin cambios de comportamiento), `'mercadopago'`/`'simulated_dsm'`
  llaman `createApprovedPayment` (T2.3). El resto del método (`findById`, guard de status,
  `transitionToNewIfPending`, `decrementForOrder`) queda **idéntico** — ninguna línea de la
  rama `manual` cambia.
  - **Exit criterion**: `confirm-order.service.spec.ts` (US-023, existente) pasa **sin
    ninguna modificación**; un `confirm({ provider: 'manual', ... })` produce exactamente
    el mismo resultado que antes de este change.
  - **Verify**: `git diff --stat apps/api/src/payments/confirm-order.service.spec.ts | wc -l` da `0`, y `pnpm --filter @dsm/api test -- --testPathPattern=confirm-order.service`

- [x] T5.2 Extender `confirm()`: para `provider !== 'manual'`, tras el `$transaction` exitoso,
  invocar `PaymentsEventsService.emitProviderConfirmed(orderId, provider)` (nuevo método,
  Phase 12) en vez de `emitConfirmed` (que queda exclusivo de `manual` — evita mal-etiquetar
  el evento, `design.md` §D1).
  - **Exit criterion**: confirmar con `provider: 'mercadopago'` emite
    `payments.provider_confirmed` con `provider` en el campo del log, nunca
    `payments.manual_confirmed`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=confirm-order.service`

- [x] T5.3 Tras el commit exitoso (fuera de la transacción), para `provider !== 'manual'`:
  invocar `NotificationPort.orderConfirmed(...)` y `.ownerNewOrder(...)` (puerto ampliado en
  Phase 8). Un fallo del puerto se loguea pero NO revierte la confirmación ya comiteada.
  - **Exit criterion**: con un `NotificationPort` mockeado que lanza, `confirm()` igual
    devuelve `ConfirmedPayment` (la orden queda confirmada) y el error del puerto queda
    logueado, no propagado.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=confirm-order.service`

- [x] T5.4 AC-4: en el `catch` de `InsufficientStockError`, para `provider !== 'manual'`,
  invocar un nuevo método privado `compensarSinStock(input)` en vez de simplemente
  re-lanzar (la rama `manual` conserva el re-lanzamiento sin cambios).
  `compensarSinStock` abre una NUEVA transacción: `transitionToCancelledIfPending(orderId, tx)`
  (T2.2) + `createRefundPendingPayment(...)` (T2.3). Si `transitionToCancelledIfPending`
  devuelve `null` (carrera: otra llamada ya la canceló/confirmó), no hace nada más.
  - **Pattern**: segunda transacción independiente de la primera (que ya revirtió) — per
    `design.md` §D2, el reembolso NO puede ejecutarse dentro de una transacción abierta.
  - **Exit criterion**: sobre una orden `pending_payment` con un ítem sin stock suficiente,
    tras `confirm({ provider: 'mercadopago', ... })`: la orden queda `cancelled` con
    `cancelled_at` no-nulo, y existe una fila en `payments` con `status='refund_pending'`
    para esa orden. El stock del producto NO decrementó (el rollback de la primera
    transacción lo garantiza).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=confirm-order.service`

- [x] T5.5 Dentro de `compensarSinStock`, fuera de toda transacción: si `provider ===
  'simulated_dsm'`, llamar `markRefunded` directamente (no-op externo, E2E §9.5); si
  `provider === 'mercadopago'`, llamar `MercadoPagoClient.refund(externalId, amountArsCents)`
  — éxito → `markRefunded`; fallo → loguear `payments.refund_failed` (Phase 12) y dejar la
  fila en `refund_pending` (NUNCA se marca fallido definitivo, AC-4 durable, OQ-BE-2).
  - **Exit criterion**: con `MercadoPagoClient.refund` mockeado para fallar, la fila de
    `payments` queda `refund_pending` (no `refunded`, no ningún estado terminal de error) y
    se emite el evento de fallo; con el mock devolviendo éxito, la fila pasa a `refunded`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=confirm-order.service`

- [x] T5.6 Al final de `compensarSinStock` (tras el intento de reembolso, exitoso o no):
  invocar `NotificationPort.orderCancelledNoStock(...)`, y hacer que `confirm()` termine
  lanzando `OrderAutoCancelledInsufficientStockError` (409, `dsm:payments/auto-cancelled-insufficient-stock`
  — nuevo, en `payment-confirmation-errors.ts`) en vez de `InsufficientStockError` cruda,
  para que el llamador (controller) distinga "ya se compensó" de "el manual simplemente
  falló".
  - **Exit criterion**: `confirm({ provider: 'mercadopago', ... })` sobre una orden sin
    stock lanza `OrderAutoCancelledInsufficientStockError`, nunca `InsufficientStockError`
    sin envolver; el `NotificationPort` recibe exactamente un llamado a
    `orderCancelledNoStock` con `orderId`/`orderNumber`/`buyerName`/`buyerEmail`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=confirm-order.service`
  - **Nota de ejecución conjunta T5.1-T5.6 (2026-09-05)**: implementadas en una sola pasada
    (están todas en el mismo método). Nueva cobertura en
    `confirm-order.service.provider.spec.ts` (archivo separado — `confirm-order.service.spec.ts`,
    US-023, queda con 0 diffs per T5.1 Exit criterion): 8/8 tests nuevos verdes cubriendo
    happy path mercadopago/simulated_dsm, el evento `provider_confirmed` (nunca
    `manual_confirmed`), notificación post-commit + resiliencia a que el puerto lance,
    compensación completa (cancelled + refund_pending + refund real + notificación) y el
    caso de fallo de reembolso (queda `refund_pending`, nunca terminal). `NOTIFICATION_PORT`
    y `MercadoPagoClient` se inyectan como parámetros OPCIONALES del constructor (ver nota de
    T8.2) — los tests los pasan como mocks explícitos. `crearPago` usa `input.amountArsCents`
    (lo que MP reportó) para el pago del provider automático, no `confirmada.total_ars_cents`
    (validado igual en el happy path porque ambos coinciden en los fixtures). Suite combinada
    de ambos archivos: 14/14 tests verdes, typecheck limpio.
  - **Fix de wiring detectado al correr la suite completa**: `payments.module.ts` registraba
    `MercadoPagoClient` como provider directo (`providers: [..., MercadoPagoClient]`) — Nest
    no puede resolver por reflexión de tipos los parámetros `baseUrl: string` / `seams:
    object` de su constructor (mismo problema que `GeminiHttpClient`, que por eso nunca se
    registra directo — ver `ai.providers.ts`). Corregido a un provider factory
    (`{ provide: MercadoPagoClient, inject: [ConfigService], useFactory: (config) => new
    MercadoPagoClient(config) }`). Confirmado con `e2e-payments-bootstrap.spec.ts` (antes
    fallaba con `Nest can't resolve dependencies... MercadoPagoClient at index [6]`).
    Regresión completa (188/188 suites, 1676/1676 tests) verde tras el fix.

## Phase 6: `POST /v1/webhooks/mercadopago`

- [x] T6.1 `webhooks/mercadopago-webhook.controller.ts` + `dto/mercadopago-webhook-body.dto.ts`:
  parsea `{ type, data: { id } }`, extrae `x-signature`/`x-request-id` de headers. Si la
  firma es inválida (T4.1) → `UnauthorizedException` (401), **sin** llamar a
  `MercadoPagoClient` ni tocar la base (AC-7). Si es válida: `getPayment(data.id)`; si
  `status !== 'approved'` → responder `{ received: true }` (200, no-op, AC-3) sin llamar a
  `confirm()`.
  - **Exit criterion**: firma inválida → 401 y cero queries de escritura ejecutadas (verificable
    con un spy sobre `PrismaService` o contando filas antes/después); pago `rejected` →
    200, orden sigue `pending_payment`, stock intacto.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=mercadopago-webhook.controller`

- [x] T6.2 En el `catch` alrededor de `confirmOrder.confirm(...)` dentro del controller:
  capturar **cualquier** error (`OrderNotFoundError`, `OrderNotPendingPaymentError`,
  `OrderAutoCancelledInsufficientStockError`, o cualquier otro) y responder igual `{ received:
  true }` (200) — nunca 5xx, per `design.md` §D2 ("siempre 200 salvo firma inválida"). Cada
  rama emite su propio evento de observabilidad antes de responder.
  - **Exit criterion**: un webhook para una orden ya `new` (duplicado) responde 200 y NO
    modifica el stock ni el estado de la orden; un webhook para un `external_reference`
    inexistente responde 200 y queda logueado como anomalía.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=mercadopago-webhook.controller`

- [x] T6.3 Registrar el controller en `payments.module.ts`, sin throttler dedicado (decisión
  explícita, `design.md` §D5 — limitar por IP la puerta de entrada de dinero descarta pagos
  legítimos en ráfaga de reintentos del proveedor).
  - **Exit criterion**: `POST /v1/webhooks/mercadopago` responde sin pasar por ningún guard
    de `ThrottlerModule`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=mercadopago-webhook.controller`
  - **Nota de ejecución conjunta T6.1-T6.3 (2026-09-05)**: `MercadoPagoWebhookBodyDto`
    declara TODOS los campos reales del body de MercadoPago (`action`/`api_version`/
    `date_created`/`id`/`live_mode`/`user_id`, opcionales) — el `ValidationPipe` global
    corre con `forbidNonWhitelisted: true` (`bootstrap.ts`), así que un webhook real con
    esos campos se hubiera rechazado con 422 si el DTO sólo declaraba `type`/`data.id`.
    7/7 tests verdes vía HTTP real (`supertest`) contra Postgres real,
    `MercadoPagoClient` overrideado con un mock (`getPayment`/`refund`) — no se testea
    que MercadoPago funcione, sólo el controller. Sin `@UseGuards` de ningún throttler
    (no hay un `APP_GUARD` global en este repo — el throttling es siempre explícito por
    controller), así que "sin throttler" es la ausencia de decorador, no una config a
    apagar.

## Phase 7: `POST /v1/checkout/simulate-payment` (AC-9 real, sin MercadoPago)

- [x] T7.1 `dto/simulate-payment.dto.ts` (`order_token` con `@Matches(/^[0-9a-f]{64}$/)`,
  mismo patrón que el contrato ya declarado para `POST /v1/payments` de US-009) y
  `simulate-payment.controller.ts`: hashea el token (`hashToken`, reusado de
  `auth/tokens/opaque-token.ts`), busca la orden con `OrdersRepository.findByTokenHash`
  (existente desde US-023, hasta ahora sin consumidor), y si existe llama
  `confirmOrder.confirm({ orderId, provider: 'simulated_dsm', externalId: 'sim_' + randomUUID(), amountArsCents: orden.total_ars_cents })`.
  - **Exit criterion**: con un `order_token` válido de una orden `pending_payment`, el
    endpoint responde 200 con `PaymentConfirmedDto` y la orden queda `new` con stock
    decrementado; con un token que no matchea ninguna orden, responde 404
    (`OrderNotFoundError`).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=simulate-payment.controller`

- [x] T7.2 Gate de feature flag: `env.validation.ts` agrega `PAYMENTS_SIMULATED_ENABLED`
  (enum `'true'|'false'`, default `'false'`) con un `superRefine` que **hace fallar el
  arranque** si `NODE_ENV === 'production' && PAYMENTS_SIMULATED_ENABLED === 'true'`
  (ADR-0006, enforced en código, no sólo checklist). El controller responde 404 (no 403)
  cuando el flag está apagado.
  - **Pattern**: mismo bloque `superRefine` que T4.2, pero con la condición invertida
    (rechaza el `true` en vez de exigirlo) — per `backend-node-standards.md` §7.
  - **Exit criterion**: `validateEnv({ NODE_ENV: 'production', PAYMENTS_SIMULATED_ENABLED: 'true', ... })`
    lanza; con el flag apagado, un `POST /v1/checkout/simulate-payment` responde 404 sin
    tocar la base.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern='env.validation|simulate-payment.controller'`

- [x] T7.3 Rate limit propio (`PAYMENTS_SIMULATE_RATE_LIMIT_MAX`/`_TTL_MS` en
  `env.validation.ts`, default 10/600000ms) sobre el endpoint, mismo criterio que
  `CheckoutThrottlerGuard`.
  - **Exit criterion**: la request número `PAYMENTS_SIMULATE_RATE_LIMIT_MAX + 1` dentro de
    la ventana responde 429.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=simulate-payment.controller`
  - **Nota de ejecución conjunta T7.1-T7.3 (2026-09-05)**: 10/10 tests verdes (2 describe
    blocks con app propia — el de rate-limit necesita su propia instancia, el throttler
    cuenta por IP+ruta y compartirla con los otros tests consumiría presupuesto antes de
    tiempo, mismo criterio que `e2e-checkout-ratelimit.spec.ts`).
  - **Hallazgo de testing (`ConfigService`/env-flags)**: `AppConfigModule` valida
    `process.env` una única vez por proceso de Jest (el `@Module({imports:
    [ConfigModule.forRoot(...)]})` se evalúa al importar `config.module.ts`, no en cada
    `Test.createTestingModule().compile()`) — mutar `process.env.PAYMENTS_SIMULATED_ENABLED`
    en un `beforeAll` llega tarde. Además, un `new ConfigService({...process.env})` a mano
    tampoco alcanza: `.get()` revisa el `process.env` VIVO (ya contaminado con STRINGS de
    valores validados por OTROS tests, vía `assignVariablesToProcess`) antes que el
    `internalConfig` propio. La solución: `new ConfigService({ _PROCESS_ENV_VALIDATED:
    validateEnv({...process.env, ...overrides}) })` — la misma clave interna que usa
    `ConfigModule.forRoot()`, con la coerción real de Zod. `simulate-payment.controller.spec.ts`
    documenta el hallazgo completo.
  - **Throttler #7**: `payments_simulate` sumado al array de `ThrottlerModule.forRootAsync`
    en `auth.module.ts` (mismo criterio que `checkout`/`enrichment`/`search` — techo
    inalcanzable acá, presupuesto real en el `@Throttle` del handler). Actualizado
    `e2e-auth-ratelimit.spec.ts` (contaba "SEIS throttlers nombrados", ahora son 7).
  - **Nota sobre la corrida completa de la suite**: `pnpm --filter @dsm/api test` (sin
    filtro, 190 archivos) mostró un timeout de 30s en `e2e-auth-password-reset.spec.ts`
    (bcrypt real, cost 12, bajo la carga de correr la suite entera + otras sesiones en la
    máquina) — no reproduce en corridas acotadas ni en corridas anteriores/posteriores de
    la misma suite completa (que sí pasan 190/190), y el archivo no toca nada de este
    change. Tratado como flakiness de entorno, no como regresión.

## Phase 8: `NotificationPort` ampliado (reusa el de `orders/`, no crea uno paralelo)

- [x] T8.1 `orders/ports/notification.port.ts`: agregar `orderConfirmed`,
  `orderCancelledNoStock`, `ownerNewOrder` a la interfaz `NotificationPort`, con sus
  payloads (`orderId`, `orderNumber`, `buyerName`, `buyerEmail`, `totalArsCents` según
  corresponda). `orders.module.ts` agrega `NOTIFICATION_PORT` a su array `exports` (hoy
  vacío) para que `PaymentsModule` pueda inyectarlo.
  - **Exit criterion**: `LoggingNotificationAdapter` (US-012, existente) implementa los 3
    métodos nuevos, logueando sólo `order_id`/`order_number` — nunca `buyerName`/
    `buyerEmail` (mismo criterio ya documentado ahí para `orderReadyForPickup`).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=notification.port`
  - **Nota de ejecución (2026-09-05, adelantada desde Phase 8)**: T5.3 (Phase 5) necesita
    estos 3 métodos para compilar — se ejecutó T8.1 antes en la secuencia real, aunque
    tasks.md la liste después. 4/4 tests verdes (1 preexistente + 3 nuevos).

- [x] T8.2 `payments.module.ts`: importar `OrdersModule` (nuevo edge `payments → orders`,
  acíclico — `orders` no importa `payments`, verificado). Inyectar `NOTIFICATION_PORT` en
  `ConfirmOrderService`.
  - **Exit criterion**: `pnpm --filter @dsm/api typecheck` no reporta dependencia circular
    de módulos; `ConfirmOrderService` resuelve `NOTIFICATION_PORT` sin `forwardRef`.
  - **Verify**: `pnpm --filter @dsm/api typecheck && pnpm --filter @dsm/api test -- --testPathPattern='payments.module|confirm-order.service'`
  - **Nota de ejecución (2026-09-05, adelantada desde Phase 8)**: mismo motivo que T8.1.
    `NOTIFICATION_PORT` se inyectó como parámetro OPCIONAL del constructor
    (`notifications?: NotificationPort`) — `confirm-order.service.spec.ts` (US-023, T5.1)
    construye la clase con 5 argumentos sin DI, y el Exit criterion de T5.1 exige cero
    modificación a ese archivo. Nest siempre lo provee en producción (`payments.module.ts`);
    sólo la rama `provider !== 'manual'` lo usa (guardado con `?.`). No existe
    `payments.module.spec.ts` (nunca existió); typecheck limpio, 6/6 tests de
    `confirm-order.service` verdes sin diff.

## Phase 9: Reconciliación (AC-10)

- [x] T9.1 `reconcile-payments.service.ts`: `reconcile()` toma hasta `RECONCILE_BATCH_SIZE`
  órdenes `pending_payment` con `created_at` anterior a `now() - RECONCILE_MIN_AGE_MS`,
  llama `MercadoPagoClient.searchByExternalReference(order.id)`; si devuelve un pago
  `approved`, llama `ConfirmOrderService.confirm({ orderId, provider: 'mercadopago', externalId, amountArsCents })`
  (el **mismo** servicio del webhook — reconciliar un pago ya procesado es un no-op por la
  idempotencia de T2.2/T5).
  - **Exit criterion**: con `searchByExternalReference` mockeado devolviendo `approved` para
    una orden `pending_payment` sin webhook recibido nunca, tras `reconcile()` la orden queda
    `new` con stock decrementado — idéntico resultado a si el webhook hubiera llegado.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=reconcile-payments.service`
  - **Nota de ejecución (2026-09-05)**: 4/4 tests verdes. `listByStatus('pending_payment')`
    filtrada/paginada en el SERVICE (no se agregó un método nuevo a `orders.repository.ts` —
    el design no lo declara, y el volumen es bajo por criterio del propio design D12).
    Agregadas `RECONCILE_MIN_AGE_MS`/`RECONCILE_BATCH_SIZE`/`ORDER_ABANDON_HOURS`/
    `REFUND_RETRY_BATCH_SIZE` a `env.validation.ts` en un solo bloque (las 4 juntas, para
    Phase 9-11).

- [x] T9.2 `admin-jobs.controller.ts`: `POST /v1/admin/payments/reconcile` (AdminGuard, sin
  throttler dedicado — mismo criterio que `PaymentConfirmationController`, superficie admin
  de bajo volumen).
  - **Exit criterion**: sin token admin, 401; con token admin, dispara `reconcile()` y
    devuelve un resumen (`{ scanned, confirmed, stillPending }`).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=admin-jobs.controller`
  - **Nota de ejecución (2026-09-05)**: 2/2 tests verdes. `@Controller()` sin prefijo de
    clase — las 3 rutas de este controller (reconcile/cleanup-abandoned/retry-refunds, T10.2
    y T11.2) NO comparten base (`v1/admin/payments/*` los dos primeros y último, pero
    cleanup-abandoned vive en `v1/admin/orders/*` — `design.md` §D8), cada handler declara
    su path completo.

## Phase 10: Limpieza de abandonadas (AC-11)

- [x] T10.1 `cleanup-abandoned-orders.service.ts`: `cleanupAbandoned()` llama
  `OrdersRepository.cancelAbandonedPending(new Date(Date.now() - ORDER_ABANDON_HOURS * 3_600_000))`
  (T2.2).
  - **Exit criterion**: una orden `pending_payment` con `created_at` de hace 49h (con
    `ORDER_ABANDON_HOURS=48`) queda `cancelled`; una de hace 47h no se toca.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=cleanup-abandoned-orders.service`
  - **Nota de ejecución (2026-09-05)**: 3/3 tests verdes.

- [x] T10.2 `admin-jobs.controller.ts`: agregar `POST /v1/admin/orders/cleanup-abandoned`
  (AdminGuard).
  - **Exit criterion**: devuelve `{ cancelled: N }` con el conteo real de filas afectadas.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=admin-jobs.controller`
  - **Nota de ejecución (2026-09-05)**: 4/4 tests verdes (2 preexistentes + 2 nuevos). Sin
    conflicto de ruta con `orders.controller.ts` (US-012, `v1/admin/orders/:id` restringido
    a forma UUID vía regex) — `cleanup-abandoned` nunca matchea ese `:id`.

## Phase 11: Reintento de reembolsos (AC-4 durable)

- [x] T11.1 `refund-retry.service.ts`: `retryPending()` toma hasta
  `REFUND_RETRY_BATCH_SIZE` pagos `refund_pending` con `provider='mercadopago'` (el
  simulado nunca se atasca — no hay llamada externa), reintenta
  `MercadoPagoClient.refund(external_id, amount_ars_cents)` por cada uno; éxito →
  `markRefunded`; fallo → sigue con el siguiente, sin abortar el lote entero.
  - **Exit criterion**: de 3 pagos `refund_pending`, si el mock de `refund` falla para el
    segundo, el primero y el tercero quedan `refunded` y el segundo sigue `refund_pending`
    tras `retryPending()`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=refund-retry.service`
  - **Nota de ejecución (2026-09-05)**: 2/2 tests verdes. Se agregó `PaymentsRepository.
    listRefundPending(limit)` (no declarado explícitamente en el design, pero necesario —
    único punto de ORM de `payments`, mismo criterio que las demás queries de esta tabla),
    filtrando `status='refund_pending' AND provider='mercadopago'`, más viejas primero.
    2 tests nuevos en `payments.repository.spec.ts` para el método.

- [x] T11.2 `admin-jobs.controller.ts`: agregar `POST /v1/admin/payments/retry-refunds`
  (AdminGuard).
  - **Exit criterion**: devuelve `{ attempted, succeeded, failed }` reflejando el resultado
    real de `retryPending()`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=admin-jobs.controller`
  - **Nota de ejecución (2026-09-05)**: 6/6 tests verdes (2+2 preexistentes + 2 nuevos).
    `admin-jobs.controller.ts` completo: los 3 endpoints de `design.md` §D8.

## Phase 12: Observabilidad

- [x] T12.1 `payments-events.service.ts`: agregar `emitProviderConfirmed(orderId, provider)`,
  `emitAutoCancelled(orderId)`, `emitRefundFailed(orderId, paymentId)`,
  `emitWebhookReceived(paymentId)`, `emitSignatureRejected()`,
  `emitReconcileRecovered(orderId)`, `emitCleanupCancelled(count)` — sin renombrar ni tocar
  `emitConfirmed`/`emitRejected` existentes (US-023). Ningún método nuevo recibe
  `buyerName`/`buyerEmail`/`amountArsCents` como parámetro (sólo IDs y counts,
  `observability-standards.md` §9).
  - **Exit criterion**: cada evento nuevo incrementa su propio contador en `MetricsService`
    (`GET /v1/admin/metrics`), distinguible de `payments.manual_confirmed`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=payments-events`
  - **Nota de ejecución (2026-09-05, adelantada desde Phase 12)**: T5.2/T5.5/T5.6 (Phase 5)
    necesitan `emitProviderConfirmed`/`emitRefundFailed`/`emitAutoCancelled` para compilar
    — mismo motivo que T8.1/T8.2. 14/14 tests verdes (6 preexistentes + 8 nuevos).

## Phase 13: Wiring final del módulo

- [x] T13.1 `payments.module.ts`: registrar todos los providers/controllers nuevos
  (`MercadoPagoClient`, `MercadoPagoWebhookController`, `SimulatePaymentController`,
  `ReconcilePaymentsService`, `CleanupAbandonedOrdersService`, `RefundRetryService`,
  `AdminJobsController`). Confirmar que `PaymentsModule` sigue exportando sólo
  `ConfirmOrderService` (sin exponer internals nuevos que nadie más necesita).
  - **Exit criterion**: la app arranca (`onModuleInit` de todos los módulos) sin errores de
    DI, con `MP_ACCESS_TOKEN`/`MP_WEBHOOK_SECRET` en variables de test.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=payments.module`
  - **Nota de ejecución (2026-09-05)**: todo el wiring ya estaba hecho incrementalmente
    (cada fase registró lo suyo al cerrar su propia task — T3.2/T6.3/T7.1/T8.2/T9.2/T10.2/
    T11.2). Este archivo era el ÚNICO que faltaba: `payments.module.spec.ts`, boot test
    contra `bootTestApp`. 1/1 test verde. `exports` sigue siendo sólo `ConfirmOrderService`
    (verificado por lectura, no hay un test automatizado dedicado a "nada más se exporta" —
    el chequeo real es que ningún otro módulo del repo necesitó importar un internal nuevo
    de `PaymentsModule`, cosa que ya se hubiera notado como error de compilación).

## Phase 14: Tests de integración cross-cutting (Postgres real — AC-1, AC-4, AC-5, AC-6, AC-8, AC-9)

- [x] T14.1 `e2e-payments-mercadopago-happy.spec.ts`: webhook con firma válida + `getPayment`
  mockeado `approved` sobre una orden real `pending_payment` con stock suficiente → 200,
  orden `new` con `confirmed_at`, stock decrementado, pago `approved` con
  `idempotency_key='mercadopago:{externalId}'`.
  - **Exit criterion**: ejercita la secuencia completa contra Postgres real
    (Testcontainers), no mocks de repositorio.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-payments-mercadopago-happy`

- [x] T14.2 `e2e-payments-insufficient-stock-auto.spec.ts`: mismo flujo pero con stock
  insuficiente en un ítem → orden `cancelled` con `cancelled_at`, pago `refund_pending` →
  `refunded` (mock de `refund` exitoso), `NotificationPort.orderCancelledNoStock` invocado
  una vez, stock del producto sin cambios (nunca bajó de 0 ni quedó decrementado a medias).
  - **Exit criterion**: prueba explícitamente que NINGÚN ítem de la orden decrementó stock
    (no sólo el que falló) — el rollback fue completo.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-payments-insufficient-stock-auto`

- [x] T14.3 `e2e-payments-webhook-duplicate.spec.ts`: el mismo webhook (mismo `data.id`)
  enviado dos veces, y también enviado con una versión "vieja"/reordenada tras uno más
  nuevo (AC-6) — en ambos casos, sólo la PRIMERA aplicación efectiva cambia el estado; las
  siguientes responden 200 sin modificar nada.
  - **Exit criterion**: tras N llamadas al mismo webhook, `payments` tiene **una sola** fila
    para ese `external_id`, y `products.stock` decrementó **una sola vez**.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-payments-webhook-duplicate`

- [x] T14.4 `e2e-payments-concurrency.spec.ts`: `Promise.all` con 10 llamadas concurrentes a
  `confirm()` para 10 órdenes distintas que comparten un producto con stock=1 — exactamente
  UNA de las 10 confirma, las otras 9 reciben `InsufficientStockError` o quedan
  `refund_pending`+`cancelled` según el `provider`, y `products.stock` termina en 0 (nunca
  negativo).
  - **Pattern**: `Promise.all` sobre llamadas reales a `ConfirmOrderService.confirm()` contra
    Postgres real — no un mock del repositorio, per `qa-backend-standards.md` §14 (probar el
    comportamiento bajo concurrencia real, no simulada).
  - **Exit criterion**: el test falla si `products.stock` queda negativo, o si más de una
    orden termina `new` habiendo un solo producto en stock.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-payments-concurrency`

- [x] T14.5 `e2e-payments-simulated-parity.spec.ts`: correr el MISMO caso (happy path e
  insuficiente-stock) una vez con `provider: 'mercadopago'` (mock de `MercadoPagoClient`) y
  otra con `provider: 'simulated_dsm'` (sin ningún mock de red — el simulado nunca llama a
  MercadoPago) y comparar el resultado final en `orders`/`payments`/`products.stock` — deben
  ser estructuralmente idénticos salvo `provider`/`external_id`.
  - **Exit criterion**: prueba, no supone, que AC-9 es real y no sólo estructural —
    ejercita `POST /v1/checkout/simulate-payment` end-to-end.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-payments-simulated-parity`
  - **Nota de ejecución conjunta T14.1-T14.5 (2026-09-05)**: 7/7 tests verdes en 5 archivos.
    T14.4 (concurrencia) construye `ConfirmOrderService` directo (no vía HTTP) — 10 llamadas
    reales en paralelo con `Promise.allSettled` contra Postgres real, exactamente 1 confirma
    y `products.stock` termina en 0. T14.5 ejercita AMBOS caminos por HTTP real
    (`POST /v1/webhooks/mercadopago` y `POST /v1/checkout/simulate-payment`, este último
    con el truco `_PROCESS_ENV_VALIDATED` de T7 para el feature flag) y compara
    `orders`/`payments`/`products.stock` — idénticos salvo `provider`.

## Phase 15: Contratos + documentación

- [x] T15.1 Actualizar/crear `contracts/openapi/{webhook-mercadopago,simulate-payment,reconcile-payments,cleanup-abandoned-orders,retry-refunds}.yaml`
  per skill `api-contract-completeness` (1 archivo por endpoint, request/response DTOs con
  `$ref`, catálogo de errores RFC 7807 con `type` URI, ejemplo funcional).
  - **Exit criterion**: cada yaml valida contra OpenAPI 3.x (`servers`, `paths`,
    `components.schemas`, `components.responses` completos, sin `TODO`).
  - **Verify**: `npx @redocly/cli lint openspec/changes/US-010-orden-webhook-stock-backend/contracts/openapi/*.yaml`
  - **Nota de ejecución (2026-09-05)**: los 5 archivos ya existían (adoptados del regenerate,
    ver commit de adopción) y validaban estructuralmente, pero la reconciliación contra el
    código REAL encontró 2 gaps reales, corregidos acá:
    1. `webhook-mercadopago.yaml` declaraba `401 → dsm:payments/webhook-unverified`, pero el
       controller lanzaba `UnauthorizedException` genérico (built-in de Nest), que
       `HttpProblemFilter` mapea a `dsm:catalog/http-401` — un `type` distinto al contrato.
       Se agregó `WebhookUnverifiedError` (`DomainError`, 401,
       `dsm:payments/webhook-unverified`) en `payment-confirmation-errors.ts` y el controller
       ahora la lanza. Regresión completa re-verificada tras el fix.
    2. `simulate-payment.yaml` declaraba `PaymentConfirmed` con `order_id`/`payment_id`, pero
       `PaymentConfirmedDto` real (compartido con US-023, congelado) sólo tiene
       `order_number`/`status`. Corregido el contrato para reflejar el DTO real — no se tocó
       el DTO (evita romper `payment-confirmation.controller.ts`, US-023).
    También se removió `securitySchemes.bearerAuth` sin uso de `webhook-mercadopago.yaml`
    (el endpoint no usa JWT, usa HMAC). `npx @redocly/cli lint` → válido, 12 warnings
    (todos preexistentes en el estilo del repo: `example.com` en servers, sin `info.license`
    — mismo patrón que los contratos ya archivados de US-001).

- [x] T15.2 `src/payments/README.md`: documentar el alcance ampliado (qué reusa de US-023,
  qué es nuevo, la tabla "hoy con mocks vs necesita cuenta real" de `design.md` §D6) — mismo
  estilo que `checkout/README.md`.
  - **Exit criterion**: el README explica en 2 párrafos por qué `MercadoPagoClient` no tiene
    `createPreference` y quién lo agrega.
  - **Verify**: `test -f apps/api/src/payments/README.md && grep -q "createPreference" apps/api/src/payments/README.md`

## Phase 16: Pre-merge

- [ ] T16.1 Lint + typecheck limpios en todo `apps/api`.
  - **Exit criterion**: cero errores.
  - **Verify**: `pnpm --filter @dsm/api lint && pnpm --filter @dsm/api typecheck`

- [ ] T16.2 Suite completa de `apps/api` verde, incluyendo TODA la de `payments/`,
  `checkout/`, `orders/`, `stock/` sin ninguna regresión respecto al baseline de T0.1.
  - **Exit criterion**: 100% verde; ningún spec de US-023/US-012/US-008 modificado salvo los
    explícitamente listados en este plan (T1.2, T2.2 no toca specs existentes de más).
  - **Verify**: `pnpm --filter @dsm/api test`

- [ ] T16.3 Cobertura diff ≥ 80% sobre los archivos nuevos/modificados de este change (`qa-backend-standards.md`).
  - **Exit criterion**: el reporte de cobertura de Jest para `src/payments/**` cumple el
    umbral.
  - **Verify**: `pnpm --filter @dsm/api test -- --coverage --testPathPattern=payments`

## Verification (suite-level)

- [ ] Todos los tests unitarios pasan: `pnpm --filter @dsm/api test`
- [ ] Migración aplica limpio contra una base nueva: `pnpm --filter @dsm/db migrate:deploy`
- [ ] Lint / type-check limpios: `pnpm --filter @dsm/api lint && pnpm --filter @dsm/api typecheck`
- [ ] Contratos OpenAPI válidos: `npx @redocly/cli lint openspec/changes/US-010-orden-webhook-stock-backend/contracts/openapi/*.yaml`
- [ ] Ningún spec de US-023/US-012/US-008 quedó modificado fuera de lo declarado en T1.2/T2.2: `git diff --stat apps/api/src/checkout/orders.repository.spec.ts apps/api/src/payments/confirm-order.service.spec.ts`
