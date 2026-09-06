# Checkout (US-008)

`POST /v1/checkout` convierte el carrito del invitado en una orden
`pending_payment`. Lo llama el frontend al confirmar el checkout; su
`order_token` lo consume `POST /v1/payments` (US-009) para iniciar el pago.

## El carrito viene de la cookie, no del cuerpo

`dsm_cart` (US-007) identifica el carrito. El cuerpo trae sólo los datos del
comprador, el consentimiento y `fulfillment` — sin `cart_id`, así que no hay
identificador que enumerar. `CartCsrfGuard` se reusa tal cual: la escritura
se autoriza con esa misma cookie.

## Qué se congela en el snapshot, y por qué

`order_items` copia precio, nombre y SKU **dentro de la transacción** que
crea la orden: es un registro comercial, no una vista del catálogo. Si el
dueño cambia un precio mañana, la venta de hoy no se mueve (AC-2, invariante
de US-001 AC-10).

## Consentimiento

`consent_accepted` + `consent_accepted_at` + `consent_terms_version` (desde
`LEGAL_TERMS_VERSION`, contrato con `apps/web/src/features/legal/`). Un
`CHECK` de la base impide una orden sin consentimiento (AC-4/AC-8).

## El seam que US-009 consume

`order_token`: hex de 64 (32 bytes CSPRNG), devuelto **una sola vez** en el
201; en base sólo vive su SHA-256 (`orders.access_token_hash`).
`OrderTokenService` no usa `newToken()` (base64url) — US-009 exige hex.

## Retención y anonimización (US-021)

`OrdersRetentionController` / `OrdersRetentionService` / `OrdersRetentionRunner`
viven acá, y no en un módulo de órdenes admin dedicado, porque ese módulo
todavía no existe (US-012, el panel de órdenes del dueño, sigue sin backend).

- `POST /v1/admin/orders/:id/anonymize` — a pedido del comprador (AC-3, AC-9).
- `POST /v1/admin/orders/retention-sweep` — barrido manual por plazo cumplido
  (AC-1); `OrdersRetentionRunner.onApplicationBootstrap()` corre el mismo
  barrido, best-effort, al arrancar la API (ADR-0012 aplicado a este dominio).
- Anonimiza, no borra (AC-6): sólo sobrescribe `buyer_name`/`buyer_email`/
  `buyer_phone` + marca `anonymized_at`/`anonymization_reason`. El
  consentimiento (`consent_*`) no se toca (AC-7).
- Guardado por `WHERE anonymized_at IS NULL` — la idempotencia (AC-8) es
  estructural, no una excepción atrapada.

**Resuelto (2026-09-05, `fix/US-021-publish-order-anonymization-contract`)**:
`AdminOrderDetailDto` (`apps/api/src/orders/dto/order.dto.ts`) ya proyecta
`anonymized_at`/`anonymization_reason` — el panel puede mostrar "datos
anonimizados" en vez del nombre/email/teléfono real (AC-5). El gap quedó
abierto entre el archive de este change y el de `US-012-panel-ordenes-dueno-backend`
(ninguno de los dos lo cerró); lo cerró el plan de FE de US-021 al necesitarlo
para codegen.

## `customer_id` ahora tiene escritor — US-015

`orders.customer_id` ~~queda SIN ESCRITOR en esta US~~ — **US-015 le agregó
el escritor**, sin tocar el comportamiento guest.

- `OptionalCustomerGuard` (`apps/api/src/auth/resolve-customer-session.ts`) es
  la variante de `CustomerGuard` que **nunca bloquea**: resuelve la sesión de
  cliente si hay una cookie válida, y sigue de largo sin ella. Cuelga de
  `CheckoutController.create` junto a `CartCsrfGuard`.
- Si hay sesión, `CheckoutService.customerIdDe(req)` (espejo de `traceDe`) lee
  `req.customerId` y lo pasa a `OrdersRepository.createPendingOrder`, que
  escribe `customer_id: data.customerId ?? null` en el mismo `INSERT` — sin
  transacción nueva, columna/FK/índice ya existían.
- Sin sesión, `customer_id` sigue siendo `null` — **exactamente el
  comportamiento actual**. La respuesta pública de `POST /v1/checkout` no
  cambia: `customer_id` nunca sale a la red.
- La vinculación es **sólo** para checkouts nuevos con sesión activa — nunca
  retroactiva sobre órdenes guest existentes (AC-6 de US-015, decisión de
  privacidad ya tomada, no se reabre).
- Detalle completo en
  `openspec/changes/archive/US-015-historial-compras-backend/design.md` §D2
  (una vez archivado el change).

## `OrdersRepository` gana 2 métodos consumidos desde `account/` — US-020

`listBlockingForCustomer` y `anonymizeAllForCustomer` (este último ya existía para
US-021, sólo ensanchó su `AnonymizationReason` a `account_deletion`) los llama
`AccountDeletionService` (`apps/api/src/account/`) dentro de la transacción del
borrado de cuenta. `CheckoutModule` no sabe nada de `account/` — es `AccountModule`
el que importa `CheckoutModule` para usar `OrdersRepository`, nunca al revés (mismo
motivo por el que `AccountModule` no vive dentro de `AuthModule`, ver
`account/README.md`).

## Qué NO hace este módulo

- No cobra ni conoce MercadoPago — US-009.
- No confirma la orden ni descuenta stock — US-010 (ADR-0008).
- No notifica por email — US-011.
- No aparece en el panel del dueño (`pending_payment` es invisible a
  propósito) hasta US-012.
