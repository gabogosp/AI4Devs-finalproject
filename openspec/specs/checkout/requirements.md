# CAP-10 Checkout — Requisitos acumulados

Acumulado de los changes archivados de esta capacidad. Cada requisito es el **estado
declarado del sistema vivo**, no la intención de un change.

## Desde US-008 backend — Checkout del invitado: orden pendiente, snapshot de precios y consentimiento (archivada 2026-09-02)

Superficie cubierta: `POST /v1/checkout`.

### Funcionales

| # | Requisito | Origen |
|---|---|---|
| R-1 | Un checkout válido (carrito comprable + datos del comprador + consentimiento) crea la orden en `pending_payment` y devuelve `201` con `order_token`, `order_number`, `status` y `total_ars_cents`. | AC-1 |
| R-2 | Cada `order_items` guarda una **instantánea** del precio, nombre y SKU del producto al momento de la compra; el total de la orden se calcula del snapshot, no del carrito ni del catálogo vigente. | AC-2 |
| R-3 | Datos del comprador (`name`, `email`, `phone`) inválidos o ausentes se rechazan con `422` y `errors[]` por campo. | AC-3 |
| R-4 | `consent` distinto de `true` (o ausente) se rechaza con `422`; ningún camino del código crea una orden sin consentimiento, respaldado por un `CHECK` de la base. | AC-4 |
| R-5 | Un carrito vacío o con líneas bloqueadas (`has_blocking_issues: true`) rechaza el checkout con `409`, distinguiendo `cart-empty` de `cart-not-purchasable` (con el slug y el motivo por línea en `errors[]`). | AC-5 |
| R-6 | Ninguna sentencia de este endpoint escribe `products.stock`; el checkout sólo lee stock para validar. El descuento ocurre sólo al aprobarse el pago (US-010, ADR-0008). | AC-6 |
| R-7 | Ninguna columna de `orders`/`order_items` puede alojar un PAN, CVV, titular o token de tarjeta; ningún DTO del request los acepta. | AC-7 |
| R-8 | El consentimiento queda registrado con marca temporal (`consent_accepted_at`) y versión de los textos legales (`consent_terms_version`), no sólo un booleano. | AC-8 |
| R-9 | La identidad de la orden es un token opaco de 256 bits (CSPRNG) hasheado (SHA-256) en `orders.access_token_hash`; el claro se entrega **una sola vez**, en el 201. El `order_id` UUID interno nunca se expone. | Design §1 — seam que resuelve OQ-BE-1 de `US-009-pago-mercadopago-backend` |
| R-10 | La orden expone un `order_number` legible (entero de una `SEQUENCE START WITH 1000`); no autoriza nada — la autorización sigue siendo `order_token`. | OQ-BE-4 |

### Negative-space (lo que NO debe pasar)

| # | Requisito |
|---|---|
| N-1 | El cuerpo del `POST /v1/checkout` no acepta `total_ars_cents`, `items`, `cart_id` ni `status`: `forbidNonWhitelisted` los rechaza con 422, nunca los ignora en silencio. |
| N-2 | El carrito no viaja en el cuerpo ni en la URL: la superficie no tiene un identificador de carrito que enumerar (se identifica por la cookie `dsm_cart`). |
| N-3 | Ninguna escritura de este endpoint toca `products.stock`, en ningún camino (éxito o rechazo). |
| N-4 | Ninguna PII del comprador (nombre, email, teléfono) aparece en logs, métricas o mensajes de error — `CheckoutEventsService.emit` sólo acepta `orderId`. |
| N-5 | Una petición sin `X-CSRF-Token` válido, o con `Origin`/`Referer` fuera de la allowlist, se rechaza con `403`, igual que el carrito. |

### No funcionales

| # | Requisito | Verificación |
|---|---|---|
| NFR-1 | Latencia de escritura `POST /v1/checkout` **p95 < 500 ms**. Cumple sin asteriscos: transacción corta, dos `INSERT`, dos `SELECT` indexados, cero llamadas salientes. | Hereda E2E §17; sin carga k6 propia todavía (queda en `/plan-qa`). |
| NFR-2 | Throttler `checkout` nombrado: **10 / 10 min por IP** (`CHECKOUT_RATE_LIMIT_MAX` / `CHECKOUT_RATE_LIMIT_TTL_MS`), cubo independiente de `auth`, `storefront` y `cart`. | Suite dev-owned. |
| NFR-3 | `Cache-Control: no-store` en toda la superficie `/v1/checkout` — la respuesta lleva un token de acceso a la orden y el total de la compra. | Suite dev-owned. |
| NFR-4 | Email del comprador normalizado (trim + NFKC + lowercase, `normalizeEmail` de US-014) antes de persistir. | Suite dev-owned. |

### Diferidos con dueño

| # | Requisito | Dueño / disparador |
|---|---|---|
| D-1 | UI del checkout (formulario, validación inline, checkbox de consentimiento, resumen, CTA "Ir al pago"). | `US-008-checkout-guest-frontend-web` — construida y mergeada (PR #23), pendiente `/archive-change` propio. |
| D-2 | Inicio del pago (`payments`, preferencia de MercadoPago, medio simulado). | `US-009-pago-mercadopago-backend` — este change resuelve su OQ-BE-1. |
| D-3 | Confirmación de la orden, decremento de stock, transición a `new`. | US-010 (ADR-0008). |
| D-4 | Limpieza de órdenes `pending_payment` abandonadas (doble submit, pago nunca iniciado). | US-010 (E2E §18.5). |
| D-5 | Notificación por email de la orden creada. | US-011. |
| D-6 | Panel del dueño y transiciones de la FSM; `orders.delivered_at` existe sin escritor. | US-012. |
| D-7 | Vincular la orden a una cuenta registrada; `orders.customer_id` existe sin escritor. | US-015. |
| D-8 | Retención y anonimización de la PII del comprador invitado a los 12 meses (PRD §6). | `US-021-retencion-datos-ordenes` — Ready, `blocked_by: [US-008]`. |
| D-9 | Tests de carga (k6) y E2E cross-service (Playwright) de esta superficie. | `/plan-qa`. |
