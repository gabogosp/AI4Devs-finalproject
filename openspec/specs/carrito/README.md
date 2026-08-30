# Capacidad: Carrito de compra del invitado (CAP-4)

**Estado**: parcialmente entregada — superficie de **backend** viva; frontend y QA
cross-stack con tasks cerradas pero pendientes de su propio `/archive-change`.

Estado declarado del sistema para la capacidad CAP-4 del PRD §2.1. Este directorio es el
**acumulado** de los changes archivados: se extiende en cada `/archive-change`, nunca se reescribe.

## Qué está vivo hoy

Un carrito que funciona **sin cuenta**, identificado por una cookie propia (US-007):

- `GET /v1/cart` — lectura segura, nunca crea carrito; carrito vacío es `200`, no `404` (AC-7).
- `PUT /v1/cart/items/{slug}` — fija la cantidad (absoluta, idempotente); crea el carrito y
  emite las cookies en la primera escritura (AC-1, AC-2).
- `DELETE /v1/cart/items/{slug}` — quita una línea; idempotente (AC-3).
- Identidad por cookie `httpOnly` `dsm_cart` (token opaco de 256 bits, hasheado en
  `carts.session_token_hash`) + CSRF double-submit firmado (`dsm_cart_csrf`) sobre la
  allowlist de `Origin`.
- Precio **siempre vigente** en la lectura (AC-9); la instantánea guardada sólo alimenta el
  flag `price_changed`.
- Cantidad acotada al stock **sin reservarlo** (AC-5, AC-8 — ADR-0008 sigue gobernando cuándo
  se descuenta stock: al aprobarse el pago, no acá).
- Líneas sin stock suficiente o despublicadas se **marcan**, nunca se borran solas (AC-6).
- Retención de **7 días** deslizantes desde la última escritura (`CART_TTL_DAYS`), purga
  oportunista al resolver.
- Errores en envelope RFC 7807 con extension members (`available_quantity`, `max_items`).

## Qué NO está vivo todavía

- **La UI del carrito** (`US-007-carrito-compra-frontend-web`) y la **suite QA cross-stack**
  (`US-007-carrito-compra-qa`) tienen sus tasks 100% cerradas y sus commits ya están en
  `main`, pero sus changes no pasaron su propio `/archive-change` todavía — este documento
  se extiende cuando lo hagan.
- **Fusión** del carrito del invitado con la cuenta al iniciar sesión — fuera de alcance de
  v1 (US §4); la política ya está decidida (sumar cantidades, tope al stock) pero sin
  implementar. `carts.customer_id` existe en el esquema y queda sin escritor hasta esa US.
- **Job programado de purga** — sólo purga oportunista; el barrido masivo quedó diferido
  (OQ-BE-6) porque Redis/BullMQ no está aprovisionado.
- **Revalidación en checkout** y **descuento de stock al pago aprobado** — viven en US-008 /
  US-010, no en esta capacidad.

## Contratos

El contrato vivo de la superficie REST está en [`contracts/openapi.yaml`](contracts/openapi.yaml):
raíz con `info`/`servers`/`security` y los `components/schemas` compartidos una sola vez, más un
archivo por path bajo [`contracts/openapi/paths/`](contracts/openapi/paths/) referenciado por
`$ref`. Dos paths, tres operaciones:

| Endpoint | Métodos | AC |
|---|---|---|
| `/cart` | GET | AC-4, AC-6, AC-7, AC-9 |
| `/cart/items/{slug}` | PUT, DELETE | AC-1, AC-2, AC-3, AC-5, AC-8, AC-10 |

## Changes que formaron esta capacidad

| Change | Disciplina | Aporte |
|---|---|---|
| [`US-007-carrito-compra-backend`](../../changes/archive/US-007-carrito-compra-backend/) | BE | `CartModule`, identidad por cookie + CSRF, stock sin reserva, precio vigente, RFC 7807 con extension members |
| [`US-007-carrito-compra-frontend-web`](../../changes/US-007-carrito-compra-frontend-web/) | FE | UI del carrito (topología, persistencia entre visitas, a11y, eventos de negocio). Tasks cerradas, pendiente `/archive-change` propio |
| [`US-007-carrito-compra-qa`](../../changes/US-007-carrito-compra-qa/) | QA | E2E de navegador + a11y del carrito. Tasks cerradas, pendiente `/archive-change` propio |

## Estado de la provisión

La capacidad corre hoy en **entorno local** (`docker-compose`). La provisión de nube
(Railway/Neon/Cloudflare) es **US-019**, gated en dependencias externas.
