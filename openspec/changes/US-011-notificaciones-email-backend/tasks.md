# US-011 backend — Tasks

> **QA (Mode A)**: el plan de pruebas QA-owned de este change (aceptación BDD
> — extensión de escenarios existentes de US-010/US-012, no duplicación —,
> regresión y exploratorio) vive en `qa-plan.md`, agregado `inline` a este
> mismo change — no hay un change de QA dedicado. Ver ahí §0 para la
> restricción central: sin `RESEND_API_KEY` en ningún entorno de QA, sólo el
> *trigger* de cada aviso es observable (AC-1/2/3/7/8); AC-4/AC-5 quedan
> `execution_mode: blocked` a nivel aceptación (sin cuenta Resend real) y
> totalmente cubiertas a nivel unit por T6.1.

## Traceability (AC → tasks)

| AC | Task IDs |
|---|---|
| AC-1 | T1.1, T4.1, T6.1 |
| AC-2 | T4.1, T6.1 |
| AC-3 | T4.1, T6.1 |
| AC-4 | T3.1, T6.1 |
| AC-5 | T5.1, T6.1 |
| AC-6 | (ya estructural — sin task, ver `design.md` Decisión 1) |
| AC-7 | (ya estructural — sin task, ver `design.md` Decisión 2) + T6.1 (Idempotency-Key) |
| AC-8 | (confirmado sin cambio — ver `design.md` "AC-8") |

## Pre-requisitos

- [x] US-010 y US-012 archivadas — `NotificationPort`, `LoggingNotificationAdapter`
      y los dos puntos de invocación ya existen en `main`.

## Phase 1: Puerto — extensión mínima del payload (OQ-2)

- [x] T1.1 Ampliar `OrderConfirmedPayload` con `items` y `totalArsCents`;
      ensanchar el tipo del parámetro `orden` de
      `ConfirmOrderService.notificarConfirmacion` de `Order` a `OrderWithItems`
      (ya es el tipo real en runtime — `transitionToNewIfPending` devuelve
      `OrderWithItems`); construir el payload con
      `orden.items.map(i => ({ productName: i.product_name, quantity: i.quantity, unitPriceArsCents: i.unit_price_ars_cents }))`
      y `totalArsCents: orden.total_ars_cents`.
  - **Pattern**: `apps/api/src/orders/ports/notification.port.ts` hoy declara
    `OrderConfirmedPayload` con sólo 4 campos — agregar los 2 nuevos como
    campos requeridos (no opcionales: el adapter los necesita siempre para
    AC-1). Importar `OrderWithItems` desde
    `../checkout/orders.repository` en `confirm-order.service.ts` (ya
    exportado, usado por otros métodos del mismo archivo).
  - **Exit criterion**: `OrderConfirmedPayload` tiene
    `items: Array<{ productName: string; quantity: number; unitPriceArsCents: number }>`
    y `totalArsCents: number`; `ConfirmOrderService` compila sin agregar
    ninguna query nueva a la base.
  - **Verify**: `pnpm --filter api exec tsc --noEmit -p tsconfig.json`
- [x] T1.2 Extender la aserción existente en
      `confirm-order.service.provider.spec.ts` ("notifica orderConfirmed +
      ownerNewOrder tras el commit (T5.3)") para además comprobar
      `items`/`totalArsCents` en el `objectContaining` de `orderConfirmed`.
  - **Exit criterion**: el test falla si `items` no incluye el producto
    creado en el fixture (`crearProducto('CONF-MP-NOTIF', 10)`) con su
    `quantity`/`unitPriceArsCents` correctos.
  - **Verify**: `pnpm --filter api exec jest confirm-order.service.provider.spec.ts --ci`

## Phase 2: Configuración (env fail-fast)

- [x] T2.1 Agregar a `envSchema` (`apps/api/src/config/env.validation.ts`):
      `ORDER_NOTIFICATIONS_FROM` (`z.string().email().optional()`),
      `OWNER_NOTIFICATION_EMAIL` (`z.string().email().optional()`),
      `NOTIFICATION_RETRY_MAX_ATTEMPTS` (`z.coerce.number().int().min(0).default(2)`),
      `NOTIFICATION_RETRY_BASE_MS` (`z.coerce.number().int().positive().default(300)`),
      `NOTIFICATION_RETRY_CAP_MS` (`z.coerce.number().int().positive().default(2_000)`).
      Sumar `ORDER_NOTIFICATIONS_FROM` y `OWNER_NOTIFICATION_EMAIL` al loop de
      producción existente (mismo criterio que `RESEND_API_KEY`/
      `PASSWORD_RESET_FROM`) — **no** agregar `RESEND_API_KEY` de nuevo (ya
      está en el loop desde T7.2, se reutiliza tal cual).
  - **Pattern**: el bloque `for (const campo of ['RESEND_API_KEY', 'PASSWORD_RESET_FROM', 'PASSWORD_RESET_URL_BASE'] as const) { if (!env[campo]) ctx.addIssue(...) }`
    en `env.validation.ts` (líneas ~399-412) — replicar la misma forma con un
    segundo loop (o extender el array) para las 2 nuevas vars de esta US, con
    mensaje propio: `'requerida en producción: sin ella el aviso de {tipo} no se envía'`.
  - **Exit criterion**: `NODE_ENV=production` sin `ORDER_NOTIFICATIONS_FROM`
    u `OWNER_NOTIFICATION_EMAIL` hace fallar `validateEnv`; fuera de
    producción ambas son opcionales; las 3 vars numéricas tienen default y
    nunca rompen el arranque si están ausentes.
  - **Verify**: `pnpm --filter api exec jest env.validation.spec.ts --ci`
    (nuevo `describe('Notificaciones de órdenes (US-011) — defaults y fail-fast', ...)`)
- [x] T2.2 Actualizar el test "en producción con las tres presentes, arranca"
      (y su vecino "en producción también exige...") en
      `apps/api/src/auth/mail/resend-mailer.spec.ts` para incluir
      `ORDER_NOTIFICATIONS_FROM`/`OWNER_NOTIFICATION_EMAIL` en el fixture de
      producción válida — sin esto, ese test (que ya construye "un entorno de
      producción válido" acumulando los requeridos de cada US, según sus
      propios comentarios de US-005/US-010) empieza a fallar en cuanto T2.1
      aterriza, porque ahora faltarían 2 campos requeridos nuevos.
  - **Pattern**: el propio archivo ya documenta la convención en su
    comentario ("US-005 sumó su propia exigencia...", "US-010 sumó la
    suya...") — agregar el mismo tipo de línea de comentario + los 2 campos
    al objeto que se le pasa a `validateEnv` en ese test.
  - **Exit criterion**: el test "arranca" sigue en verde con los 2 campos
    nuevos incluidos; si se los quita, el test falla (falsable).
  - **Verify**: `pnpm --filter api exec jest resend-mailer.spec.ts --ci`

## Phase 3: Backoff / clasificación de errores transitorios

- [ ] T3.1 Crear `apps/api/src/orders/ports/notification-backoff.ts` con
      `backoffDelayMs(attempt, opts)` (copiado de
      `payments/mercadopago/backoff.ts`, duplicación chica y deliberada, mismo
      criterio que ese archivo documenta) y
      `isTransientResendError(statusCode: number | null | undefined): boolean`
      (`true` si `statusCode` es `null`/`undefined`/`429`/`>=500`; `false`
      para cualquier otro 4xx).
  - **Pattern**: `payments/mercadopago/backoff.ts` líneas 55-61
    (`backoffDelayMs`: `min(cap, base * 2^attempt)` con jitter multiplicativo
    en `[0.5, 1)`) — copiar tal cual, sin generalizar contra el módulo de
    pagos (mismo criterio que el comentario de cabecera de ese archivo).
    Clasificación por `statusCode` en vez de por `instanceof` (Resend no
    lanza tipos propios, devuelve `{ error: { name, message, statusCode } }`
    en el resultado — confirmado en `node_modules/resend/dist/index.mjs`).
  - **Exit criterion**: `backoffDelayMs(0, {baseMs:300, capMs:2000})` está en
    `[150, 300]`; `backoffDelayMs(10, {baseMs:300, capMs:2000})` nunca supera
    2000; `isTransientResendError(429)` y `isTransientResendError(500)` y
    `isTransientResendError(null)` son `true`; `isTransientResendError(400)`
    y `isTransientResendError(422)` son `false`.
  - **Verify**: `pnpm --filter api exec jest notification-backoff.spec.ts --ci`

## Phase 4: Plantillas (texto + HTML, con escapado)

- [ ] T4.1 Crear `apps/api/src/orders/ports/notification-templates.ts` con
      `escapeHtml(s: string): string` (escapa `& < > " '`) y 4 pares de
      funciones puras `{tipo}Text(payload)` / `{tipo}Html(payload)`:
      `orderConfirmed`, `ownerNewOrder`, `orderReadyForPickup`,
      `orderCancelledNoStock` (OQ-1). El texto de `orderConfirmed` incluye la
      lista de ítems (`productName × quantity — $unitPriceArsCents`) y el
      total; el de `orderReadyForPickup` incluye la dirección estática del
      local. Todo campo string de origen externo (`buyerName`, `productName`)
      pasa por `escapeHtml` en la variante HTML; la variante texto no
      necesita escapado (no renderiza markup).
  - **Pattern**: `resend-password-reset-mailer.ts`
    `cuerpoTexto`/`cuerpoHtml` (arrays de líneas + `.join('\n')`, sin
    librería de templating). Copy exacto de `docs/product/design-system.md`
    §10.2: `"¡Listo! Tu compra está confirmada. Te enviamos el detalle por email."`
    (orderConfirmed) y
    `"Tu pedido está listo para retirar en el local (Córdoba y Pueyrredón)."`
    (orderReadyForPickup). `ownerNewOrder`/`orderCancelledNoStock` no tienen
    copy en §10.2 — tono "práctico y confiable" (§10.2 intro), redactar
    consistente.
  - **Exit criterion**: cada `{tipo}Text` contiene la frase exacta de §10.2
    donde exista; `orderConfirmedHtml` con `buyerName = '<script>x</script>'`
    NO contiene la subcadena literal `<script>` en su salida; ningún template
    (grep del archivo completo) contiene las subcadenas `payment`, `card`,
    `tarjeta`, `cvv`, `external_id` (AC-8, defensivo — los payloads ya no las
    traen, pero el test cierra el caso "alguien agrega el campo al payload
    después").
  - **Verify**: `pnpm --filter api exec jest notification-templates.spec.ts --ci`

## Phase 5: Observabilidad

- [ ] T5.1 Crear `apps/api/src/observability/notification-events.service.ts`
      — `NotificationEventsService` con
      `emitSent(type: NotificationType, orderId: string, attempts: number): void`
      y `emitFailed(type: NotificationType, orderId: string, attempts: number): void`,
      más `countSent`/`countFailed` para tests (precedente: `countConfirmed`
      de `PaymentsEventsService`).
      `NotificationType = 'order_confirmed' | 'owner_new_order' | 'order_ready_for_pickup' | 'order_cancelled_no_stock'`.
  - **Pattern**: `apps/api/src/observability/payments-events.service.ts`
    completo (constructor con `@Optional() metrics?: MetricsService`, delega
    `metrics?.increment('notifications', \`notification.sent.${type}\`)`,
    `logger.log({ event: ..., entity_id: orderId, attempts })` — nunca
    `buyerName`/`buyerEmail` en el log).
  - **Exit criterion**: `emitSent('order_confirmed', 'ord-1', 1)` incrementa
    `dsm_notifications_events_total{event="notification.sent.order_confirmed"}`
    en 1 (leído vía `MetricsService.value`); el log emitido no contiene las
    claves `buyerName` ni `buyerEmail`.
  - **Verify**: `pnpm --filter api exec jest notification-events.spec.ts --ci`

## Phase 6: Adapter real de Resend

- [ ] T6.1 Crear `apps/api/src/orders/ports/resend-notification.adapter.ts`
      — `ResendNotificationAdapter implements NotificationPort`, constructor
      `(resend: Resend, config: ConfigService, events: NotificationEventsService)`.
      Cada uno de los 4 métodos: construye texto/HTML (T4.1), intenta enviar
      con `{ idempotencyKey: \`${tipo}:${payload.orderId}\` }`, en caso de
      fallo transitorio (T3.1) reintenta con backoff hasta
      `NOTIFICATION_RETRY_MAX_ATTEMPTS`, cada intento acotado por
      `RESEND_TIMEOUT_MS` (mismo `conTimeout` que `ResendPasswordResetMailer`
      — duplicado, no importado, mismo criterio de "duplicación chica y
      deliberada"). Nunca propaga: agotados los reintentos, loguea vía
      `events.emitFailed` y resuelve `undefined`. Éxito → `events.emitSent`.
      Destinatario: `payload.buyerEmail` para `orderConfirmed`/
      `orderReadyForPickup`/`orderCancelledNoStock`; `OWNER_NOTIFICATION_EMAIL`
      (vía `config.getOrThrow`) para `ownerNewOrder`. Remitente:
      `ORDER_NOTIFICATIONS_FROM` (vía `config.getOrThrow`) en los 4.
  - **Pattern**: `resend-password-reset-mailer.ts` completo — el try/catch
    que distingue `{ error }` devuelto por el SDK (nunca lanzado) de una
    excepción lanzada, el `conTimeout` con `Promise.race`, el log sin PII
    (`customer_id`/acá `order_id`, nunca el email). Envolver ese mismo patrón
    en un loop `for (intento = 0; intento <= maxRetries; intento++)` que
    reintenta sólo si `isTransientResendError(error.statusCode)` (T3.1) y
    `intento < maxRetries`, esperando `backoffDelayMs(intento, {baseMs, capMs})`
    entre intentos (mismo shape que `withRetry` de
    `payments/mercadopago/backoff.ts`, sin reusar la función porque está
    acoplada a `MercadoPagoTransientError`).
  - **Exit criterion**: (a) envío exitoso al primer intento llama a
    `resend.emails.send` una vez con `idempotencyKey` presente y dispara
    `emitSent` con `attempts=1`; (b) un `{ error: { statusCode: 500 } }` en
    el primer intento y éxito en el segundo llama a `send` exactamente 2
    veces y dispara `emitSent` con `attempts=2`; (c) `{ error: { statusCode: 400 } }`
    (permanente) llama a `send` **una sola vez** y dispara `emitFailed`
    inmediatamente, sin esperar backoff; (d) fallo transitorio en todos los
    intentos (`1 + NOTIFICATION_RETRY_MAX_ATTEMPTS` llamadas) dispara
    `emitFailed` y el método **resuelve `undefined`** (no rechaza); (e) un
    `send` que lanza (`ECONNRESET`) se trata como transitorio y reintenta;
    (f) ningún log emitido por el adapter contiene `buyerName` ni
    `buyerEmail` (grep de los args capturados del logger, precedente exacto
    del 4º test de `resend-mailer.spec.ts`).
  - **Verify**: `pnpm --filter api exec jest resend-notification-adapter.spec.ts --ci`

## Phase 7: Selección por entorno + wiring

- [ ] T7.1 Crear `apps/api/src/orders/ports/notification.provider.ts` —
      `notificationPortProvider: Provider` con
      `provide: NOTIFICATION_PORT`, `inject: [ConfigService, NotificationEventsService]`,
      `useFactory`: con `RESEND_API_KEY` presente devuelve
      `new ResendNotificationAdapter(new Resend(apiKey), config, events)`; sin
      ella, `logger.warn(...)` + devuelve `new LoggingNotificationAdapter()`
      (comportamiento sin cambios respecto a hoy).
  - **Pattern**: `apps/api/src/auth/mail/password-reset-mailer.provider.ts`
    completo — mismo `if (!apiKey) { warn; return Logging...; } return new Resend...(...)`.
  - **Exit criterion**: con `RESEND_API_KEY` seteada, `useFactory` devuelve
    una instancia de `ResendNotificationAdapter`; sin ella, devuelve
    `LoggingNotificationAdapter` y loguea un `warn` que menciona que no se
    envían los avisos.
  - **Verify**: `pnpm --filter api exec jest resend-notification-adapter.spec.ts --ci -t "selección del adapter por entorno"`
- [ ] T7.2 En `apps/api/src/orders/orders.module.ts`: reemplazar
      `{ provide: NOTIFICATION_PORT, useClass: LoggingNotificationAdapter }`
      por `notificationPortProvider` (T7.1); agregar `NotificationEventsService`
      (T5.1) a `providers`. Actualizar el comentario de cabecera del módulo
      (ya no dice "US-010 T8.1" solamente — ahora también resuelve al adapter
      real).
  - **Pattern**: `apps/api/src/auth/auth.module.ts` línea 133
    (`passwordResetMailerProvider` en el array de `providers`, sin import de
    `LoggingPasswordResetMailer` ni `ResendPasswordResetMailer` en el módulo
    — el factory ya los importa).
  - **Exit criterion**: `OrdersModule` ya no importa
    `LoggingNotificationAdapter` como clase de binding directo (sigue
    importado sólo dentro de `notification.provider.ts`); sin
    `RESEND_API_KEY` en el entorno de test, toda la suite existente que
    construye `OrdersModule`/`PaymentsModule` (incluida
    `e2e-payments-insufficient-stock-auto.spec.ts`, que hace
    `.overrideProvider(NOTIFICATION_PORT)`) sigue verde sin ningún cambio en
    esos archivos de test.
  - **Verify**: `pnpm --filter api exec jest --ci` (suite completa — gate de
    regresión de la única tarea que toca el wiring de DI compartido)
- [ ] T8.1 Actualizar el docstring de
      `apps/api/src/orders/ports/logging-notification.adapter.ts`: quitar el
      bloque `TODO(US-011): reemplazar por el adapter de Resend cuando esa US
      aterrice` (ya aterrizó) y reemplazarlo por una línea que describa su
      rol actual: adapter de desarrollo/test y fallback cuando
      `RESEND_API_KEY` no está presente.
  - **Exit criterion**: el archivo ya no contiene la subcadena literal
    `TODO(US-011)`.
  - **Verify**: `git grep -n "TODO(US-011)" -- apps/api/src/orders/ports/logging-notification.adapter.ts`
    no devuelve ninguna línea (exit code 1)

## Verification (suite-level)

- [ ] Todos los unit tests nuevos + existentes pasan:
      `pnpm --filter api exec jest --ci`
- [ ] Typecheck limpio: `pnpm --filter api exec tsc --noEmit -p tsconfig.json`
- [ ] Lint limpio: `pnpm --filter api exec eslint src --max-warnings 0`
- [ ] Sin endpoint nuevo — no aplica contract test / OpenAPI lint para este
      change (confirmado en `proposal.md` "Out of scope").
- [ ] `git grep -n "Deferred: US-011"` sobre
      `openspec/specs/ordenes/requirements.md` y
      `openspec/specs/pagos/requirements.md` sigue devolviendo las 2 líneas
      hasta el archive (el delta de `design.md` "Spec delta" las quita
      recién ahí, no en este change) — confirmar que **este** change no las
      toca prematuramente.
