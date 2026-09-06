# US-011 backend — Design

## Context

`NotificationPort` (US-010) y sus dos puntos de invocación
(`ConfirmOrderService.notificarConfirmacion`, `OrdersAdminService.changeStatus`)
ya existen y ya corren después del commit de la transacción que confirman.
Este change no diseña el seam — lo consume. Lo que sí requiere decisión propia
es: (1) cómo se implementa el reintento ante fallo transitorio sin la
infraestructura de cola que el E2E menciona en un componente pero no en sus
diagramas de secuencia, y (2) si hace falta una tabla de idempotencia nueva o
las guardas existentes alcanzan.

## Goals

- Entrega real de los 4 emails del `NotificationPort` vía Resend.
- AC-4/AC-5 (reintento + fail-open) sin introducir Redis/BullMQ, que ADR-0004
  documenta como no aprovisionado.
- AC-7 (no duplicados) sin tabla nueva, apoyado en las guardas ya existentes.
- Cero PII nueva en logs/métricas.

## Non-goals

- No se construye un worker BullMQ ni se provisiona Redis (ver Decisión 1).
- No se modifica la FSM de órdenes ni la lógica de confirmación de pago más
  allá del cambio aditivo de payload (OQ-2 en `proposal.md`).
- No se agrega un endpoint de reenvío manual de notificaciones (no pedido por
  ningún AC).

## Decisión 1 — Reintento in-process con backoff, NO cola BullMQ

**La tensión textual**: `docs/product/design-e2e.md` §6.1 describe
`NotificationsModule` como "Encola emails (Resend)" (componente C4), y el DER
de contexto (línea ~125/155) menciona Redis como parte del backend. Pero los
diagramas de secuencia que efectivamente ejercitan las notificaciones —§9.2
(checkout) y §9.4 (fulfillment)— muestran una flecha **directa** `API->>R:
email ... (async)` sin ningún paso de cola/worker, a diferencia de §9.3
(import + enriquecimiento), que sí dibuja explícitamente `API->>R: encola
job` seguido de `K->>R: toma job` (Redis/BullMQ/Worker como pasos propios).
La palabra "async" en §9.2/§9.4 describe que el envío ocurre **después del
commit de la orden**, no que pase por una cola — es la misma lectura que ya
hicieron US-010/US-012 al invocar el puerto fuera de la transacción.

**La decisión que resuelve la tensión ya está tomada, y no por esta US.**
ADR-0004 (Redis+BullMQ), en su nota de cabecera, dice explícitamente:

> "el patrón «contrato asíncrono + estado durable ahora, ejecutor en proceso,
> swap a BullMQ después» se aplicó en: import masivo (ADR-0012),
> enriquecimiento + embeddings (ADR-0014) [...] y los **runners de
> notificaciones**, reconciliación y limpieza del webhook de pago (plan de
> US-010 §D7/§D8). Las dos últimas no llevan ADR propio a propósito: no
> introducen una decisión nueva, aplican esta enmienda."

Es decir: el propio ADR-0004 ya nombra "runners de notificaciones" como
territorio cubierto por la enmienda in-process, anticipando exactamente esta
US. Construir una cola ahora sería introducir una dependencia
(`REDIS_URL`) que US-019 todavía no provisionó (gated en cuentas externas,
parqueado — ver memoria de sesión), para un problema que el propio ADR ya
resolvió con el patrón que el resto del repo usa.

**Diseño elegido**: el reintento vive **dentro del adapter**, en la misma
llamada síncrona que ya hace el caller (mismo lugar donde hoy espera el
`RESEND_TIMEOUT_MS` único intento). Bounded: 1 intento inicial +
`NOTIFICATION_RETRY_MAX_ATTEMPTS` reintentos (default 2, mismo valor que
`MP_MAX_RETRIES`), backoff exponencial con jitter (`backoffDelayMs`, copiado
de `payments/mercadopago/backoff.ts` — duplicación chica y deliberada, mismo
criterio que ese archivo documenta para no acoplar el módulo de pagos al de
notificaciones). Clasificación transitorio/permanente por el `statusCode` que
el SDK de Resend devuelve en el resultado (`null`/`>=500`/`429` → transitorio,
cualquier otro 4xx → permanente) — mismo criterio que
`MercadoPagoClient` (429/5xx/timeout reintentable).

**Costo aceptado**: el peor caso (todos los intentos agotan el timeout)
agrega hasta `~(1+intentos) × RESEND_TIMEOUT_MS + backoff` de latencia al
webhook de MercadoPago o al `PATCH /admin/orders/:id`. Con los defaults
(2 reintentos, 5s de timeout, backoff corto) el techo es ≈16s
`[propuesto — confirma Ops tras medir en staging]`. Es aceptable porque: (a)
el webhook de MercadoPago no tiene guard de rate-limit propio y ya tolera
reintentos externos (D5 de US-010); (b) responde 200 igual pase lo que pase
(el `try/catch` del controller ya lo garantiza); (c) el `PATCH` admin es un
endpoint de back-office de un solo operador, no un camino de alto tráfico. Si
Ops mide que esto es inaceptable en producción, la migración al ejecutor
BullMQ (cuando `REDIS_URL` exista) es exactamente el "swap" que ADR-0004
diseñó — mismo contrato, mismo estado, sólo cambia quién invoca.

**Alternativa considerada y rechazada**: cola in-memory con `setTimeout`
fire-and-forget (no bloquear el caller en absoluto). Rechazada porque en un
restart del proceso (deploy, crash) pierde silenciosamente cualquier
reintento pendiente sin dejar rastro — a diferencia del import (ADR-0012),
acá no hay una fila `pending` que un reaper pueda recuperar, y el propio
AC-5 exige que "el fallo queda registrado para revisión": un reintento en
vuelo que el proceso mata no se registra como fallo, se pierde. El reintento
síncrono-acotado sí termina (éxito o `emitFailed`) antes de que el caller siga.

## Decisión 2 — AC-7 (no duplicados): sin tabla nueva

Los dos callers ya garantizan invocación **a lo sumo una vez** por evento de
negocio, de forma estructural, sin que este change tenga que agregar nada:

- **`ConfirmOrderService.confirm`**: `orders.transitionToNewIfPending` es un
  `UPDATE ... WHERE status = 'pending_payment'` condicional. Un reintento del
  webhook de MercadoPago para el mismo pago (`x-signature` válida, mismo
  `payment_id`) encuentra la orden ya en `new`, el `UPDATE` no afecta filas,
  el método lanza `OrderNotPendingPaymentError` **dentro** de la transacción
  — la rama que llama a `notificarConfirmacion()` sólo se alcanza cuando la
  transacción *recién* commitea la transición. Verificado leyendo
  `confirm-order.service.ts` líneas 78-111 y el webhook controller (llama a
  `confirm()` en cada entrega, incluidas las reintentadas por MP).
- **`OrdersAdminService.changeStatus`**: si `current.status === target`
  (reintento de red / doble click) es un no-op explícito
  (`transitioned: false`) *antes* de tocar `order_status_history`; la
  notificación sólo se dispara `if (result.transitioned)`. Verificado en
  `orders-admin.service.ts` líneas 93-96 y 126-138.

Ninguno de los dos callers cambia en este change — la garantía es previa
(US-010/US-012) y ya documentada en `openspec/specs/ordenes/requirements.md`
N-1.

**Defensa en profundidad agregada por este change**: el SDK de Resend acepta
un `Idempotency-Key` por llamada
(`resend.emails.send(payload, { idempotencyKey })`, confirmado en
`node_modules/resend/dist/index.mjs` — pasa el header `Idempotency-Key`).
El adapter construye una clave determinística `{tipo}:{orderId}` (p.ej.
`order-confirmed:{orderId}`), estable entre los reintentos internos del
adapter (Decisión 1). Esto cierra el único hueco que las guardas
estructurales NO cubren por sí solas: un timeout del lado cliente
(`conTimeout` corta la espera) cuando el envío **sí llegó a procesarse** en
Resend — sin idempotency key, el reintento subsiguiente mandaría un segundo
email real al mismo destinatario para el mismo evento. Con la key, Resend
deduplica del lado del proveedor.

**Por qué no una tabla `sent_notifications`**: agregaría una migración, un
índice único y una escritura extra por email — para cerrar un caso que el
`Idempotency-Key` de Resend ya cierra sin persistencia propia y que las
guardas de los callers ya cierran para el caso general. Sería
sobre-ingeniería (`base-standards.md` §1, YAGNI) para un problema sin
instancia real.

## Approach

```
ConfirmOrderService.notificarConfirmacion (post-commit)
  → NotificationPort.orderConfirmed(payload)
  → [DI] ResendNotificationAdapter.orderConfirmed
       → construye texto/html (notification-templates.ts, con escapado HTML)
       → intenta enviar con Idempotency-Key determinística
       → si falla y es transitorio: backoff (notification-backoff.ts) y reintenta
         (hasta NOTIFICATION_RETRY_MAX_ATTEMPTS)
       → nunca propaga; éxito → NotificationEventsService.emitSent
                                 fallo agotado → NotificationEventsService.emitFailed
```

`notification.provider.ts` decide en el arranque, por `RESEND_API_KEY`, si
`NOTIFICATION_PORT` resuelve a `ResendNotificationAdapter` o se queda en
`LoggingNotificationAdapter` — exactamente `passwordResetMailerProvider`.

### Archivos nuevos

- `apps/api/src/orders/ports/notification-backoff.ts` — `backoffDelayMs`
  (copiado de `payments/mercadopago/backoff.ts`) + `NotificationTransientError`
  / clasificación por `statusCode`.
- `apps/api/src/orders/ports/notification-templates.ts` — 4 pares
  texto/HTML + `escapeHtml`.
- `apps/api/src/orders/ports/resend-notification.adapter.ts` — el adapter.
- `apps/api/src/orders/ports/notification.provider.ts` — selección por env.
- `apps/api/src/observability/notification-events.service.ts` — contador.

### Archivos modificados

- `apps/api/src/orders/orders.module.ts` — swap del binding + nuevo provider.
- `apps/api/src/orders/ports/notification.port.ts` — `OrderConfirmedPayload`
  gana `items`/`totalArsCents` (OQ-2).
- `apps/api/src/payments/confirm-order.service.ts` —
  `notificarConfirmacion(resultado, orden: OrderWithItems)` (antes `Order`) +
  construcción del payload extendido. Ninguna otra línea cambia.
- `apps/api/src/config/env.validation.ts` — 5 vars nuevas + fail-fast de
  producción.

## AC-8 (sin datos sensibles) — confirmado, sin cambio de diseño

Los 4 payloads del puerto (`orderId`, `orderNumber`, `buyerName`,
`buyerEmail`, y ahora `items`/`totalArsCents` en `OrderConfirmedPayload`) no
incluyen ningún campo de pago (`payment_id`, `external_id`, tarjeta). Las
plantillas sólo consumen esos campos. No se rediseña el payload por AC-8 —
sólo se confirma.

## Threat model (lite — superficie outbound-only, sin endpoint nuevo)

Esta US no agrega un endpoint HTTP ni cruza un trust boundary de entrada —
es una llamada saliente disparada por eventos ya autenticados/autorizados
aguas arriba (webhook con firma verificada, PATCH admin con `AdminGuard`). El
riesgo relevante es distinto al catálogo STRIDE de un endpoint:

| Riesgo | Vector | Control |
|---|---|---|
| **Tampering / Information disclosure** (HTML injection) | `buyerName` (dato del comprador en checkout) y `product_name` (catálogo, importable vía CSV) se interpolan en el `html` del email. Sin escapar, un nombre con `<img onerror=...>` o un link de phishing se renderiza en un email que sale con remitente legítimo (`ORDER_NOTIFICATIONS_FROM`). | `escapeHtml()` en `notification-templates.ts` para **todo** campo string interpolado en el cuerpo HTML (no en el texto plano, que no renderiza markup). Primer caso del repo con este vector — `ResendPasswordResetMailer` no interpola strings externos. Test: `notification-templates.spec.ts` asegura que `<script>` en `buyerName` no aparece sin escapar en el HTML resultante. |
| **Denial of service** (costo del proveedor) | Un evento de negocio malformado o repetido en ráfaga podría multiplicar llamadas a Resend. | Ya acotado aguas arriba: los callers sólo invocan el puerto una vez por evento (Decisión 2); el reintento interno tiene techo (`NOTIFICATION_RETRY_MAX_ATTEMPTS`). |
| **Repudiation** | Ninguna — no hay acción de usuario que negar; el evento de negocio (orden confirmada / transición) ya tiene su propio log/evento en `PaymentsEventsService`/`OrderEventsService`. `NotificationEventsService` agrega el resultado del envío. | — |
| **Elevation of privilege / Spoofing** | No aplica — sin autenticación nueva, sin superficie de entrada. | — |

No dispara la regla de escalamiento de `threat-modeling-lite` (sin PCI, sin
PHI, sin criptografía nueva, sin trust boundary nuevo) — lite es suficiente.

## Observabilidad

Nuevo `NotificationEventsService` (`apps/api/src/observability/`), mismo
esqueleto que `PaymentsEventsService`/`OrderEventsService`:

- `emitSent(type, orderId, attempts)` → `dsm_notifications_events_total{event="notification.sent.{type}"}`
- `emitFailed(type, orderId, attempts)` → `dsm_notifications_events_total{event="notification.failed.{type}"}`
- `type ∈ {order_confirmed, owner_new_order, order_ready_for_pickup, order_cancelled_no_stock}`
  — único label permitido junto a `event`; `orderId`/`attempts` van al log,
  nunca a la métrica (cardinalidad, mismo criterio que
  `PaymentsEventsService`).
- Cero PII: ni `buyerName` ni `buyerEmail` llegan al log del evento (mismo
  criterio que `LoggingNotificationAdapter` ya documentaba).

**NFR propuesto** `[propuesto — confirma Ops tras medir en staging]`: tasa de
fallo sostenida de `notification.failed.*` > 10% en 15 min → señal de alerta
(revisar cuenta de Resend / dominio verificado) — no hay alerta automatizada
todavía (Railway + Sentry, sin scraper propio, mismo estado que documenta
`design-e2e.md` §18 para el resto de contadores `dsm_*_events_total`); queda
como lectura manual del endpoint de métricas hasta que exista un scraper.

## Spec delta (aplicado por `/archive-change`)

- `openspec/specs/ordenes/requirements.md` R-4: quitar "la entrega real del
  aviso es `Deferred: US-011`" — el aviso ya se entrega.
- `openspec/specs/pagos/requirements.md` R-17: quitar "Entrega real:
  `Deferred: US-011`" — idem.
- No se crea `openspec/specs/notificaciones/` (OQ-4 en `proposal.md`) — sin
  contrato propio que viva ahí.
- Sin cambios en `contracts/openapi.yaml` de ninguna capability — sin
  endpoints nuevos ni modificados.

## Trade-offs

- **Reintento síncrono-acotado agrega latencia al request/webhook** en vez de
  ser verdaderamente asíncrono — aceptado (Decisión 1) porque la alternativa
  (fire-and-forget) pierde reintentos en un restart y viola AC-5 ("el fallo
  queda registrado"), y la alternativa (BullMQ) requiere infra no
  provisionada para un problema que ADR-0004 ya resolvió con este patrón.
- **`Idempotency-Key` depende del proveedor** (Resend) en vez de una garantía
  100% local — aceptado porque el caso que cubre (timeout cliente / éxito
  servidor) es raro y de bajo impacto (un email duplicado, no una orden
  duplicada ni un cargo duplicado), y la alternativa (tabla propia) es
  sobre-ingeniería para ese caso.
- **4ª plantilla no pedida explícitamente por ningún AC de esta US** (OQ-1) —
  aceptado por completitud del puerto; si se considera fuera de alcance,
  es un `-` de una tarea en `tasks.md`, no un rediseño.

## Open questions

Ver `proposal.md` "Open questions" (OQ-1 a OQ-4) — todas resueltas o
deferidas explícitamente, ninguna bloquea `tasks.md`.

## References

- `apps/api/src/orders/ports/notification.port.ts`
- `apps/api/src/payments/confirm-order.service.ts`
- `apps/api/src/orders/orders-admin.service.ts`
- `apps/api/src/auth/mail/resend-password-reset-mailer.ts` (patrón directo)
- `apps/api/src/payments/mercadopago/backoff.ts` (patrón de retry)
- `docs/architecture/decisions/0004-redis-bullmq-async-processing.md`
- `docs/product/design-e2e.md` §6.1, §9.2, §9.4, §18
- `openspec/specs/ordenes/requirements.md` (R-4, N-1)
- `openspec/specs/pagos/requirements.md` (R-17)
