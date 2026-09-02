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

**Open question para quien planifique US-012**: su DTO de lectura de orden
todavía no expone `anonymized_at`/`anonymization_reason` (esas columnas nacen
en este change). Sin eso, el panel no puede mostrar "datos anonimizados" en
vez del nombre/email/teléfono real (AC-5) — agregarlos al DTO es tarea de esa
US, no de esta.

## Qué NO hace este módulo

- No cobra ni conoce MercadoPago — US-009.
- No confirma la orden ni descuenta stock — US-010 (ADR-0008).
- No notifica por email — US-011.
- No aparece en el panel del dueño (`pending_payment` es invisible a
  propósito) hasta US-012.
