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

## Desde US-008 frontend-web — Formulario, consentimiento y resumen del checkout (archivada 2026-09-05)

Superficie cubierta: `/checkout` (ruta de cliente, `noindex`), consumiendo `POST /v1/checkout`.

### Funcionales

| # | Requisito | Origen |
|---|---|---|
| R-11 | `/checkout` valida el carrito con el mismo estado que expone `useCartContext()`; un carrito vacío o con líneas bloqueadas (`has_blocking_issues`) muestra `CheckoutBlocked` con link a `/carrito`, sin llegar a mostrar el formulario. | AC-5 (entrada) |
| R-12 | El formulario valida con el resolver custom sobre `CreateGuestCheckoutBody` (schema generado del contrato, D3) — un mapa de mensajes traduce los issues de Zod a copy en español, sin redeclarar ninguna constraint. Si el backend cambia una constraint, la próxima regeneración del cliente cambia el comportamiento sin tocar este código. | AC-3 |
| R-13 | El checkbox de consentimiento consume `CONSENT_COPY`/`LEGAL_ROUTES` de US-017 (seam ya construido) — nunca redeclara el texto legal. | AC-8 (mitad FE) |
| R-14 | Al `201`, `CheckoutConfirmation` se renderiza in-place en `/checkout` (sin navegar a una ruta nueva) con `order_number` + total + un CTA "Continuar al pago" deshabilitado (`Deferred: US-009`). | AC-1 (parcial — "avanza al pago" queda para US-009 FE) |
| R-15 | El `order_token` del `201` se persiste en `sessionStorage` (`dsm_order_token`), nunca en la URL ni en una cookie — es la credencial de la orden, no un identificador. Hoy nada lo lee (`Deferred: US-009 — owner: FE`). | Design §D7 (OQ-FE-19) |
| R-16 | El CTA "Ir al pago" del carrito (`CartSummary.tsx`) se un-diferió: navega a `/checkout` salvo `has_blocking_issues`. | Continuación de US-007 (`Deferred: US-008` cerrado) |

### Negative-space (lo que NO debe pasar)

| # | Requisito |
|---|---|
| N-6 | El formulario nunca declara un segundo schema de validación — toda constraint sale de `CreateGuestCheckoutBody` generado; un mensaje amigable traduce, no redefine. |
| N-7 | El `order_token` nunca viaja en la URL ni en un querystring: quedaría en el historial del navegador, en logs de proxies intermedios y en el `Referer` al salir del sitio. |
| N-8 | `fulfillment` no es un control editable en el formulario (valor fijo `pickup`) — no existe un segundo valor posible en el sistema, así que un checkbox sería fricción sin decisión real detrás. |
| N-9 | Los eventos de observabilidad del checkout (`checkout_started`, `_blocked`, `_submitted`, `_succeeded`, `_failed`) nunca llevan PII ni el `order_token` — sólo `order_number` (no-PII, contador público) y `error_kind`. |

### No funcionales

| # | Requisito | Verificación |
|---|---|---|
| NFR-5 | p95 de escritura del formulario < 500 ms (E2E §17, US §9) — llamada same-origin vía el rewrite de ADR-0013, mismo costo aceptado que el carrito. | Suite dev-owned. |
| NFR-6 | WCAG 2.1 AA: foco al primer campo con error, `role="alert"` en el banner, `aria-describedby` en el checkbox de consentimiento, heading propio en la confirmación para gestionar el foco al cambiar de estado sin navegar. | Suite dev-owned + a11y. |

### Diferidos con dueño

| # | Requisito | Dueño / disparador |
|---|---|---|
| D-1 | ~~UI del checkout~~ — **resuelto por este change** (formulario, validación inline, checkbox de consentimiento, resumen, CTA "Ir al pago" un-diferido). | Cerrado. |
| D-2 | Inicio del pago (`payments`, preferencia de MercadoPago, medio simulado) — consume el `order_token` que este change sólo escribe. | `US-009-pago-mercadopago-backend` (BE) + FE de US-009 (sin plan todavía). |
| D-3 | Confirmación de la orden, decremento de stock, transición a `new`. | US-010 (ADR-0008). |
| D-4 | Limpieza de órdenes `pending_payment` abandonadas (doble submit, pago nunca iniciado). | US-010 (E2E §18.5). |
| D-5 | Notificación por email de la orden creada. | US-011. |
| D-6 | Panel del dueño y transiciones de la FSM; `orders.delivered_at` existe sin escritor. | US-012. |
| D-7 | Vincular la orden a una cuenta registrada; `orders.customer_id` existe sin escritor. | US-015. |
| D-8 | Retención y anonimización de la PII del comprador invitado a los 12 meses (PRD §6). | `US-021-retencion-datos-ordenes` — Ready, `blocked_by: [US-008]`. |
| D-9 | Tests de carga (k6) y E2E cross-service (Playwright) de esta superficie. | `/plan-qa`. |
