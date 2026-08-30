# Capacidad: Carrito de compra del invitado (CAP-4)

**Estado**: entregada — backend, UI del carrito y suite QA cross-stack archivados. Falta
sólo el gate humano de la US (regresión en staging + AC manuales + firma del PO, ver
`docs/user-stories/US-007-carrito-compra.md` §Definition of Done): archivar las tres
disciplinas no mueve la US a `Done` por sí solo.

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

Una **UI de cliente** que consume esa superficie (US-007 frontend-web):

- `/carrito` es Client Component + `noindex` — el carrito es dato personalizado, así que
  hereda el guard de `client.ts` que impide que una llamada con sesión salga del servidor
  (design.md D1, evita que la Data Cache de Next sirva un carrito ajeno).
- Rewrite same-origin extendido a `/v1/cart/:path*` (heredado de ADR-0013): sin esto el
  carrito funciona en local y está roto en producción, porque `up.railway.app` está en la
  Public Suffix List.
- Segundo sujeto de CSRF (`dsm_cart_csrf`) sobre el mismo lector único de `document.cookie`
  que US-014 dejó atado a `dsm_csrf` — se parametriza el sujeto, no se duplica el parser.
- Estado por unión discriminada + **reemplazo completo** en cada mutación (no reconciliación
  local): las tres respuestas del backend traen el carrito entero, así que el total nunca
  puede divergir del servidor.
- Stepper **pesimista** con debounce de 400 ms, acotado a `max_quantity`, operable por
  teclado; badge del top-nav como isla cliente dentro de un layout que sigue siendo servidor.
- Cinco eventos de negocio sin PII (`cart.item_added`, `cart.quantity_changed`,
  `cart.item_removed`, `cart.viewed`, `cart.blocked_checkout`).

## Qué NO está vivo todavía

- **Fusión** del carrito del invitado con la cuenta al iniciar sesión — fuera de alcance de
  v1 (US §4); la política ya está decidida (sumar cantidades, tope al stock) pero sin
  implementar. `carts.customer_id` existe en el esquema y queda sin escritor hasta esa US.
- **Job programado de purga** — sólo purga oportunista; el barrido masivo quedó diferido
  (OQ-BE-6) porque Redis/BullMQ no está aprovisionado.
- **Revalidación en checkout** y **descuento de stock al pago aprobado** — viven en US-008 /
  US-010, no en esta capacidad.

## Qué verificó QA

Suite L3 cross-stack (`US-007-carrito-compra-qa`), contra el stack real (API + web + Postgres):

- **Aceptación BDD**: 14/14 escenarios `@carrito` verdes (AC-1..AC-10, incluida la
  invariante AC-8 con **tres invitados independientes** agotando el mismo stock — la
  versión de un solo invitado no habría distinguido un sistema con reserva de uno sin
  ella).
- **E2E de navegador + a11y**: desbloqueados el 2026-08-23 al cerrar `/develop-frontend-web
  US-007` (25/25) — TC-720..725 (recorrido de compra, persistencia entre visitas, los tres
  avisos), TC-730 (axe AA, 0 violaciones en 3 variantes), TC-731 (stepper y quitar por
  teclado con anuncio de total en región viva).
- **Carga de escritura** (PRD §4, `p95 < 500 ms`): medido **p95 4,28 ms** con `checks
  34.794/34.794` y `rate_limited: 0` (corrida con `CART_WRITE_RATE_LIMIT_MAX` elevado sólo
  en el entorno de carga — el presupuesto productivo de 30/min hace irrealizable la
  medición). Lectura de `GET /v1/cart` medida **informativamente** en la misma corrida
  (**p95 1,61 ms**), sin umbral — el PRD no fija un número para esta ruta (NFR-2).
- **Exploratorio**: TC-751 (ventana de 7 días vs. ciclo real de compra del gremio)
  ejecutado; TC-750 (carrito bajo navegadores reales — incógnito, cookies bloqueadas,
  ITP de Safari) queda como charter manual pendiente de sesión con el dueño, ahora que la
  UI existe.

**Hallazgos abiertos, con dueño QA (no bloquean esta capacidad)**:

| Hallazgo | Efecto | Diferido a |
|---|---|---|
| `TC-204`/`TC-208` de la suite de US-002 son frágiles (contaminación de datos entre sesiones; colisión con el teléfono del footer) | Preexistentes, ajenos al carrito | Pase de saneamiento — owner QA |
| `TC-724`/`TC-725` interfieren entre sí en la corrida completa (mutan catálogo real bajo caché de 3600 s del storefront) | Pasan aislados, no en conjunto | Aislamiento de fixtures por spec — owner QA |
| Seeds de US-002/US-003 no son idempotentes contra una base con residuo (H-2) | El gate de aceptación se re-scopeó a lo que el carrito controla (14/14 `@carrito`) | Pase de saneamiento de seeds — owner QA |

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
| [`US-007-carrito-compra-frontend-web`](../../changes/archive/US-007-carrito-compra-frontend-web/) | FE | UI del carrito (topología, persistencia entre visitas, a11y, eventos de negocio) |
| [`US-007-carrito-compra-qa`](../../changes/archive/US-007-carrito-compra-qa/) | QA | Suite L3 cross-stack: 14 aceptación BDD, 6 E2E de navegador, 2 a11y, 1 carga k6, 2 charters. AC-8 con tres invitados independientes |

## Estado de la provisión

La capacidad corre hoy en **entorno local** (`docker-compose`). La provisión de nube
(Railway/Neon/Cloudflare) es **US-019**, gated en dependencias externas.
