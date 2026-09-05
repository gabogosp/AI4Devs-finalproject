# Capacidad: Checkout del invitado (CAP-10)

**Estado**: entregada — backend y UI del checkout vivos. Falta el inicio del pago
(`payments`, US-009) para que el flujo llegue a una orden pagada.

Estado declarado del sistema para la capacidad CAP-10 del PRD §2.1. Este directorio es el
**acumulado** de los changes archivados: se extiende en cada `/archive-change`, nunca se
reescribe.

## Qué está vivo hoy

Un endpoint que convierte un carrito comprable en una orden `pending_payment`, sin
requerir cuenta (US-008 backend):

- `POST /v1/checkout` — valida el carrito de la cookie `dsm_cart` (US-007), valida los
  datos del comprador y el consentimiento, y crea la orden con el snapshot de precios en
  una sola transacción (AC-1, AC-2).
- **El carrito no viaja en el cuerpo**: se identifica por la cookie; el cuerpo trae sólo
  `buyer` (nombre, email, teléfono), `consent` y `fulfillment`.
- **El cliente no propone precios**: total y líneas salen del carrito/catálogo leídos
  dentro de la transacción (`buildCartView` de US-007, reusado); `forbidNonWhitelisted`
  rechaza con 422 cualquier intento de inyectar `total_ars_cents` o `items`.
- Identidad de la orden por **token opaco de 256 bits** (CSPRNG), hasheado en
  `orders.access_token_hash`; el claro se devuelve una sola vez en el 201
  (`order_token`). El `order_id` UUID no se expone.
- **Número de pedido legible** (`order_number`, `SEQUENCE START WITH 1000`) para que el
  comprador y el dueño hablen del mismo pedido por teléfono; no autoriza nada.
- La orden nace **inerte**: no retiene stock (AC-6, ADR-0008), no mueve plata y es
  invisible para el panel del dueño (US-012) hasta que el pago se apruebe y confirme
  (US-009 → US-010).
- Consentimiento con **marca temporal y versión de los textos legales**
  (`consent_accepted_at`, `consent_terms_version`) — trazabilidad legal Ley 25.326
  (AC-8), no sólo un booleano.
- **Sin datos de tarjeta**: ninguna columna de `orders`/`order_items` puede alojarlos
  (AC-7 — ADR-0006, checkout hosted de MercadoPago).
- Sin `Idempotency-Key`: doble submit crea dos órdenes, ambas inertes; la abandonada la
  cancela la limpieza de US-010 (deviación declarada de `api-standards.md` §10.1).
- Errores en envelope RFC 7807: `409` (carrito vacío / no comprable, con motivo por
  línea), `422` (datos inválidos / sin consentimiento), `403` (CSRF).
- Throttler `checkout` propio (10/10 min por IP), independiente de `auth`, `storefront` y
  `cart`.

Una **UI de cliente** sobre esta superficie (US-008 frontend-web, `/checkout`, ruta de
cliente forzada + `noindex`, mismo patrón que `/carrito`):

- Formulario (nombre, email, teléfono) con validación via el schema **generado** del
  contrato (`CreateGuestCheckoutBody`) — un resolver custom traduce los mensajes de Zod al
  español sin redeclarar ninguna constraint (nunca un segundo schema).
- Checkbox de consentimiento que consume `CONSENT_COPY`/`LEGAL_ROUTES` de US-017 (seam ya
  construido, no reescrito).
- Retiro mostrado como información fija (dirección + horario), no un control — un único
  valor posible en todo el sistema (`fulfillment: pickup`).
- Al `201`, confirmación **in-place** en `/checkout` (sin ruta nueva): `order_number` +
  total + CTA "Continuar al pago" deshabilitado (`Deferred: US-009`).
- `order_token` persistido en `sessionStorage` (nunca la URL ni una cookie) — es la
  credencial de la orden; hoy nada lo lee, lo consumirá la futura pantalla de pago.
- El CTA "Ir al pago" del carrito (`CartSummary.tsx`) quedó un-diferido: navega a
  `/checkout` salvo `has_blocking_issues`.
- 5 eventos de observabilidad sin PII ni `order_token` (`checkout_started/_blocked/
  _submitted/_succeeded/_failed`).
- WCAG 2.1 AA: foco gestionado al fallar validación y al confirmar, `role="alert"` en
  errores, `aria-describedby` en el consentimiento.

## Qué NO está vivo todavía

- **Inicio del pago** (`payments`, MercadoPago) — US-009. El `order_token` que el FE ya
  persiste queda sin consumidor hasta entonces.
- **Confirmación de la orden, decremento de stock, transición a `new`** — US-010
  (ADR-0008).
- **Limpieza de órdenes `pending_payment` abandonadas** — US-010 (E2E §18.5).
- **Notificaciones por email** — US-011.
- **Panel del dueño y transiciones de la FSM** — US-012. `orders.delivered_at` existe en
  el esquema, sin escritor.
- **Vincular la orden a una cuenta registrada** — US-015. `orders.customer_id` existe en
  el esquema, sin escritor.
- **Retención / anonimización de la PII del comprador invitado** — `US-021-retencion-datos-ordenes`
  (Ready, `blocked_by: [US-008]`). Este change guarda la PII pero no la purga.
- **Envío a domicilio, cupones, facturación AFIP** — roadmap (PRD §2.2).

## Contratos

El contrato vivo de la superficie REST está en [`contracts/openapi.yaml`](contracts/openapi.yaml):
raíz con `info`/`servers`/`security` y los `components/schemas` propios, más un archivo
por path bajo [`contracts/openapi/paths/`](contracts/openapi/paths/) referenciado por
`$ref`. Un path, una operación:

| Endpoint | Métodos | AC |
|---|---|---|
| `/checkout` | POST | AC-1..AC-8 |

## Changes que formaron esta capacidad

| Change | Disciplina | Aporte |
|---|---|---|
| [`US-008-checkout-guest-backend`](../../changes/archive/US-008-checkout-guest-backend/) | BE | `CheckoutModule`, `orders`/`order_items`, token opaco de la orden, snapshot de precios, consentimiento con trazabilidad legal |
| [`US-008-checkout-guest-frontend-web`](../../changes/archive/US-008-checkout-guest-frontend-web/) | FE | Formulario, consentimiento y resumen del checkout; `order_token` en `sessionStorage`, CTA del carrito un-diferido |

## Estado de la provisión

La capacidad corre hoy en **entorno local** (`docker-compose`). La provisión de nube
(Railway/Neon/Cloudflare) es **US-019**, gated en dependencias externas.
