# US-011 backend — Notificaciones por email (Resend)

## Why

El bucle de compra ya dispara los tres eventos que necesitan aviso por email —
pago confirmado (US-010), nueva orden para el dueño (US-010) y "lista para
retirar" (US-012) — pero los tres hoy caen en `LoggingNotificationAdapter`: el
`NotificationPort` (US-010) escribe una línea de log y no manda nada. Los dos
puntos de invocación en producción (`ConfirmOrderService.notificarConfirmacion`,
`OrdersAdminService.changeStatus`) ya están construidos, ya corren después del
commit, y ya están marcados en `openspec/specs/ordenes/requirements.md` (R-4) y
`openspec/specs/pagos/requirements.md` (R-17) como `Deferred: US-011`.

Esta US cierra ese diferido: construye el adapter real de Resend y lo enchufa
en el seam ya existente. **No** es el trabajo de adapter-pattern en sí —eso lo
adelantó US-014 para `PasswordResetMailer`, con exactamente este mismo seam
como precedente— sino su aplicación al segundo puerto de email del proyecto.

## What changes

- **`ResendNotificationAdapter implements NotificationPort`** — envía los 4
  emails del puerto (`orderConfirmed`, `ownerNewOrder`, `orderReadyForPickup`,
  `orderCancelledNoStock`) vía el SDK de Resend (ya en `package.json`,
  instalado por US-014 — sin dependencia nueva). Mismo contrato que
  `ResendPasswordResetMailer`: nunca propaga, timeout acotado, sin PII en logs.
- **Reintento con backoff dentro del propio adapter** (AC-4/AC-5) — sin cola:
  ver `design.md` "Decisión 1" para la justificación completa contra
  BullMQ/Redis.
- **Selección de adapter por entorno** (`notification.provider.ts`) — mismo
  patrón que `passwordResetMailerProvider`: con `RESEND_API_KEY` presente
  resuelve al adapter real, sin ella al de log (local/CI sin credenciales).
  Reemplaza el binding fijo `useClass: LoggingNotificationAdapter` en
  `OrdersModule`.
- **4 plantillas de email** (texto + HTML, sin librería de templating —
  precedente `ResendPasswordResetMailer.cuerpoTexto`/`cuerpoHtml`): confirmación
  al comprador (AC-1), aviso de nueva orden al dueño (AC-2), "listo para
  retirar" (AC-3), y aviso de cancelación por falta de stock (implícito por
  completitud del puerto — ver "Open questions" OQ-1).
- **Extensión mínima de `OrderConfirmedPayload`** (`items`, `totalArsCents`) —
  ver OQ-2: el payload actual no alcanza para cumplir AC-1 ("detalle de su
  orden: ítems, total, retiro en sucursal"). Cambio aditivo, tipado más ancho
  en `ConfirmOrderService.notificarConfirmacion` (ya tiene los datos en runtime
  — `OrderWithItems`, no una query nueva).
- **`NotificationEventsService`** (nuevo, `apps/api/src/observability/`) —
  mismo esqueleto que `PaymentsEventsService`/`OrderEventsService`: delega el
  contador en `MetricsService`, evento `notification.sent.{type}` /
  `notification.failed.{type}`, cero PII.
- **5 env vars nuevas** en `env.validation.ts`: `ORDER_NOTIFICATIONS_FROM`,
  `OWNER_NOTIFICATION_EMAIL`, `NOTIFICATION_RETRY_MAX_ATTEMPTS`,
  `NOTIFICATION_RETRY_BASE_MS`, `NOTIFICATION_RETRY_CAP_MS`. Las dos primeras
  se suman al fail-fast de producción (mismo grupo que `RESEND_API_KEY`).
  Reutiliza `RESEND_API_KEY`/`RESEND_TIMEOUT_MS` (ya existentes, genéricos —
  no específicos de password-reset pese al nombre del archivo que los
  introdujo).
- **Escapado HTML de campos interpolados** (`buyerName`, `product_name`) en
  las 4 plantillas — primer caso del repo donde un email HTML interpola un
  string de origen externo (comprador / catálogo importado); ver
  `design.md` "Threat model".

## Out of scope

- El **patrón de adapter en sí** (puerto + selección por entorno como
  mecanismo) — ya construido por US-014 para `PasswordResetMailer`. Esta US
  sólo lo replica para `NotificationPort`.
- **Nuevos endpoints HTTP** — ninguno. Cambio encapsulado en un adapter
  interno; no aplica `api-contract-completeness` (sin contrato OpenAPI nuevo
  ni modificado).
- **Nueva persistencia** — ninguna tabla ni columna nueva. AC-7 (no
  duplicados) se resuelve con las guardas estructurales ya existentes en los
  dos callers (ver `design.md` "Decisión 2") + `Idempotency-Key` del SDK de
  Resend como defensa adicional — no con una tabla `sent_notifications`.
- **WhatsApp / SMS / email marketing** — explícitamente fuera de v1 (US-011
  §4 "Out of scope explícito").
- **Reabrir el diseño de `ConfirmOrderService`/`OrdersAdminService`** más allá
  del cambio mínimo aditivo de OQ-2 (ampliar el tipo de un parámetro +
  construir el payload con datos que ya existen en runtime). Ninguna otra
  línea de esos dos archivos cambia.
- **Cuenta real de Resend con dominio verificado en producción** — requiere
  secrets/DNS fuera del alcance de este change (ver "Deployment
  recommendation" al final del reporte de planificación).

## AC cubiertos

| AC | Cubierto por |
|---|---|
| AC-1 (confirmación comprador, con detalle) | `ResendNotificationAdapter.orderConfirmed` + plantilla + payload extendido (OQ-2) |
| AC-2 (aviso nueva orden al dueño) | `ResendNotificationAdapter.ownerNewOrder` + plantilla + `OWNER_NOTIFICATION_EMAIL` |
| AC-3 (listo para retirar) | `ResendNotificationAdapter.orderReadyForPickup` + plantilla |
| AC-4 (reintento ante fallo transitorio, async) | Backoff acotado dentro del adapter — `design.md` Decisión 1 |
| AC-5 (fallo persistente no revierte la orden) | Contrato "nunca propaga" heredado de `ResendPasswordResetMailer`; log de fallo vía `NotificationEventsService.emitFailed` |
| AC-6 (no bloquea confirmación/decremento de stock) | Ya estructural en los dos callers (invocación **después** del commit) — sin cambio de este change |
| AC-7 (no duplicados) | Guardas estructurales de los callers (ya existentes) + `Idempotency-Key` de Resend como defensa en profundidad — `design.md` Decisión 2 |
| AC-8 (sin datos sensibles) | Payloads ya limpios (confirmado, sin cambio) — `design.md` "AC-8" |

## Standards consultados

- `docs/code/backend-node-standards.md` §3 (DI/puertos), §6 (nunca propagar,
  contrato del adapter), §7 (env fail-fast), §8 (timeouts/retries/resiliencia).
- `docs/code/backend-standards.md` (capas, error handling).
- `docs/cross-cutting/security-standards.md` §9 (PII en logs — vía
  `observability-patterns`), output encoding (vía `threat-modeling-lite`).
- `docs/architecture/api-standards.md` — no aplica (sin endpoints nuevos).
- `docs/quality/testing-standards.md` §14 + `docs/quality/qa-backend-standards.md`
  — pirámide de test (unit adapter/backoff/templates, sin integración nueva
  contra Postgres real porque no hay persistencia nueva).
- ADR-0004 (Redis+BullMQ) + su nota de enmienda (Redis sin aprovisionar,
  "runners de notificaciones... del webhook de pago" ya anticipado como
  cubierto por la enmienda) — decide Decisión 1 sin ADR propio.
- `docs/ai/documentation-standards.md` §11.1 — actualización de
  `openspec/specs/ordenes/requirements.md` (R-4) y
  `openspec/specs/pagos/requirements.md` (R-17) al archivar (quitar
  `Deferred: US-011`).

## Open questions

- **OQ-1** `[Resolved: implementar la 4ª plantilla]` — El puerto declara 4
  métodos; US-011 §3 sólo redacta AC para 3. `orderCancelledNoStock` ya se
  invoca en producción (`ConfirmOrderService.compensarSinStock`, US-010) y
  quedaría silenciosamente sin entrega real si el adapter la implementa como
  no-op. Se agrega una 4ª plantilla mínima (mismo patrón, sin AC propio del
  US) porque el costo marginal es una plantilla más sobre la infraestructura
  ya construida, y dejarla muda reabre exactamente el problema que el puerto
  fue diseñado para evitar.
- **OQ-2** `[Resolved: extender `OrderConfirmedPayload`]` — AC-1 pide "detalle
  de su orden (ítems, total, retiro en sucursal)" pero el payload de US-010
  sólo trae `orderId/orderNumber/buyerName/buyerEmail`. El total y los ítems
  ya están en runtime (`OrderWithItems`, con `total_ars_cents` y `items[]`
  snapshot con `product_name`/`quantity`/`unit_price_ars_cents`) — sin query
  nueva. El "retiro en sucursal" es texto estático (dirección única, ver
  design-system §7.14) y no necesita campo de payload. Cambio: ampliar
  `OrderConfirmedPayload` + el tipo del parámetro `orden` en
  `notificarConfirmacion` de `Order` a `OrderWithItems` (ya es el tipo en
  runtime). Los tests existentes (`confirm-order.service.provider.spec.ts`)
  usan `expect.objectContaining(...)` — no se rompen con campos nuevos.
- **OQ-3** `[Deferred: fuera de esta US]` — Cuenta de Resend con dominio
  verificado + `RESEND_API_KEY`/`ORDER_NOTIFICATIONS_FROM`/
  `OWNER_NOTIFICATION_EMAIL` reales de producción. Es un secret/DNS a
  provisionar, no código; se recomienda `/plan-deployment` (ver reporte).
- **OQ-4** `[Resolved: sin nueva capability spec]` — no se crea
  `openspec/specs/notificaciones/`; el delta de esta US actualiza
  `ordenes/requirements.md` (R-4) y `pagos/requirements.md` (R-17), que ya
  son dueños de la mención del `NotificationPort`. Crear una capability nueva
  para un adapter interno sin endpoints propios sería sobre-estructurar.

## References

- User story: `docs/user-stories/US-011-notificaciones-email.md`
- Puerto (US-010): `apps/api/src/orders/ports/notification.port.ts`
- Adapter de log actual: `apps/api/src/orders/ports/logging-notification.adapter.ts`
- Precedente directo (mismo seam, T7.2): `apps/api/src/auth/mail/resend-password-reset-mailer.ts`,
  `apps/api/src/auth/mail/password-reset-mailer.provider.ts`
- Precedente de retry/backoff: `apps/api/src/payments/mercadopago/backoff.ts`
- ADR-0004 (Redis/BullMQ, enmendada) — `docs/architecture/decisions/0004-redis-bullmq-async-processing.md`
- Specs afectadas: `openspec/specs/ordenes/requirements.md` (R-4),
  `openspec/specs/pagos/requirements.md` (R-17)
