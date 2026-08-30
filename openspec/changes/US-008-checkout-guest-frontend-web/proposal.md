---
parent-us: US-008
discipline: frontend-web
variant: null
language: es
created: 2026-08-30
---

# US-008 Frontend Web — Checkout del invitado: formulario, consentimiento y resumen

## Why

US-007 dejó el carrito completo pero con el CTA "Ir al pago" **deshabilitado a propósito**:
`CartSummary.tsx` lo dice en su propio código —`checkoutAvailable` nace en `false`, con un
comentario `Deferred: US-008 — owner: FE`— porque `/checkout` todavía no existe. Este change
construye esa pantalla y cierra el loop de compra sin cuenta que el PRD §2.1 capacidad 4 pide.

El backend (`US-008-checkout-guest-backend`, PR #11, 20/20 tasks) ya entrega `POST /v1/checkout`
completo: valida el carrito, exige el consentimiento, snapshotea precios y devuelve un
`order_token` opaco de un solo uso. Lo que falta es la mitad que ese change dejó explícitamente
para acá: *"La parte de UI (formulario, validación inline, checkbox con enlaces legales, resumen
de la orden, CTA «Ir al pago») es de la capa FE."*

Este change tiene además una restricción que no es opcional: el checkbox de consentimiento **no
se escribe a mano**. US-017 construyó exactamente el seam que esta US necesita —`LEGAL_ROUTES` y
`CONSENT_COPY` en `apps/web/src/features/legal/routes.ts`, con un guard (`routes.test.ts`) que
falla si el literal `'/legales/` aparece en cualquier archivo que no sea ese módulo— y
`LEGAL_TERMS_VERSION` es un contrato cruzado con el backend, ya verificado en cada CI por
`versionContract.test.ts`. Reescribir cualquiera de los dos duplicaría un texto legal que va a
divergir la primera vez que alguien lo edite en un solo lado.

Y hay una pieza de trazabilidad que le pertenece a este change y a nadie más: el `order_token`
que el 201 devuelve **una sola vez**. El diseño de `US-009-pago-mercadopago-backend` ya cuenta con
que "el FE puede conservarlo del 201 del checkout" — este change es quien lo recibe primero y
decide dónde vive hasta que la pantalla de pago (US-009 FE, todavía sin planificar) lo consuma.

## What

Construye `/checkout` (`app/(storefront)/checkout/page.tsx`): un formulario de una sola pantalla
con los tres campos del comprador (nombre, email, teléfono), la confirmación de retiro en la
sucursal única, el checkbox de consentimiento (wireado al seam de US-017) y el resumen de la
orden (ítems + total, tomados del carrito ya cargado). Al confirmar, llama a `POST /v1/checkout`
a través del cliente generado y muestra una pantalla de confirmación con el `order_number`, el
total y un CTA "Continuar al pago" **deshabilitado** con el mismo patrón `Deferred:` que dejó
US-007 — porque la pantalla de pago es de US-009 y ese change ni siquiera tiene su plan de
frontend todavía.

También **un-defiere** el CTA del carrito: `CartSummary.tsx` deja de mostrar "El pago se habilita
en la próxima entrega" y navega de verdad a `/checkout`.

## Out of scope

- **Iniciar el pago, la preferencia de MercadoPago o el medio simulado** — US-009 (sin plan de
  frontend todavío; el CTA de la confirmación queda deshabilitado con marcador `Deferred: US-009`).
- **Redactar el copy legal o las rutas `/legales/*`** — ya existen (US-017); este change las
  **consume**, no las escribe.
- **El versionado de los términos aceptados** — ya es un contrato verificado (US-017
  `versionContract.test.ts` + backend `LEGAL_TERMS_VERSION`); este change sólo manda
  `consent: true` y confía en que el backend registra la versión vigente.
- **Selección de sucursal** — hay una sola (Av. Córdoba y Av. Pueyrredón); el formulario la
  muestra como información fija, no como un control elegible.
- **Envío a domicilio, cupones, facturación AFIP** — roadmap (PRD §2.2).
- **Confirmación por email** — US-011.
- **Verificar del lado del cliente que el stock no se descontó antes del pago (AC-6)** ni que
  **ninguna columna puede alojar datos de tarjeta (AC-7)** — son invariantes estructurales del
  backend (T5.1/T5.2 de `US-008-checkout-guest-backend`, ya cerradas), no observables desde la
  UI. La responsabilidad de este change respecto de AC-7 es *no construir ningún campo de tarjeta
  en el formulario* — trivialmente cierto porque no se agrega ninguno.

## Affected components / screens

- `apps/web/app/(storefront)/checkout/page.tsx` — nueva ruta, Server Component que sólo compone
  (mismo patrón que `carrito/page.tsx`).
- `apps/web/src/features/checkout/` — feature nuevo: `checkoutService.ts`, `useCheckout.ts`,
  `checkoutResolver.ts`, `checkoutFieldMessages.ts`, `checkoutCopy.ts`, `orderToken.ts`,
  `checkoutMetadata.ts`, `CheckoutPage.tsx`, `CheckoutForm.tsx`, `ConsentCheckbox.tsx`,
  `OrderSummary.tsx`, `CheckoutBlocked.tsx`, `CheckoutConfirmation.tsx`.
- `apps/web/src/features/cart/CartSummary.tsx` — un-defer del CTA (quita `checkoutAvailable` /
  `MOTIVO_PENDIENTE`).
- `apps/web/src/features/cart/CartPage.tsx` — pasa `onCheckout={() => router.push('/checkout')}`.
- `apps/web/next.config.mjs` — extiende el rewrite same-origin (ADR-0013) a `/v1/checkout/:path*`.
- `apps/web/src/lib/observability/events.ts` — cinco eventos nuevos de checkout.
- `apps/web/README.md` — documenta la ruta, el `Deferred: US-009` y la fuente del `order_token`.

## API consumption

- `POST /v1/checkout` — `apps/api/docs/api/openapi.yaml` (ya publicado; PR #11 merged a `main`).
  Cliente ya **regenerado** (`chore(codegen): regenera cliente tras endpoints de checkout` —
  commit ya en `main`): `createGuestCheckout` en `src/api/generated/endpoints.ts`,
  `CreateGuestCheckoutBody`/`CreateGuestCheckoutResponse` en `src/api/generated/zod.ts`,
  `CheckoutCreated`/`CreateCheckoutRequest*` en `src/api/generated/model/`, mock MSW
  `getCreateGuestCheckoutMockHandler`.
- Referencia de forma exacta: `openspec/changes/US-008-checkout-guest-backend/design.md` (no se
  restata acá) — 201 con `order_token` (hex 64, un solo uso) + `order_number` (≥1000) + `status:
  pending_payment` + `total_ars_cents` + `items_count`; 409 `dsm:checkout/cart-empty` |
  `dsm:checkout/cart-not-purchasable`; 422 validación por campo; 403 CSRF; 429 rate-limit.
- La escritura viaja con `session: 'cart'` en el cliente centralizado (mismo sujeto de CSRF que
  el carrito — `dsm_cart_csrf` — porque el backend reusa `CartCsrfGuard` tal cual sobre la misma
  cookie `dsm_cart`). **No hace falta tocar `client.ts` ni `csrf.ts`**: el sujeto `'cart'` ya
  existe (US-007) y cubre exactamente lo que este endpoint pide.

## Acceptance criteria — qué prueba este change

De las 8 AC de la US, este change es responsable de construir y **probar desde la UI**:

- **AC-1** (checkout válido crea la orden y avanza al pago) — construido: el submit exitoso crea
  la orden vía `POST /v1/checkout`. La mitad "avanza al pago" queda como un CTA deshabilitado con
  `Deferred: US-009` — no hay pantalla de pago que probar todavía.
- **AC-3** (validación de los datos del comprador) — construido: validación inline por campo
  (`aria-describedby`) usando el schema **generado** del contrato + mapeo de errores 422.
- **AC-4** (consentimiento obligatorio) — construido: checkbox requerido, bloquea el submit en el
  cliente y el 422 del servidor es la autoridad real.
- **AC-5** (carrito inválido bloquea el checkout) — construido: chequeo de entrada (carrito vacío
  o con líneas bloqueadas) antes de mostrar el formulario, más manejo del 409 si el carrito
  cambió entre que se cargó y que se envió el submit.
- **AC-8** (mitad FE): el checkbox manda `consent: true` wireado al copy/rutas de US-017; el
  **registro** con marca temporal es 100% backend (ya probado en `US-008-checkout-guest-backend`
  T5.3).

**Backend-verificado, no observable desde la UI de este change**: AC-2 (snapshot de precios —
este change sólo *muestra* el `total_ars_cents` que el servidor calculó, nunca lo recalcula),
AC-6 (stock intacto), AC-7 (sin datos de tarjeta — cierto por construcción: el formulario no
tiene campos de tarjeta).

## Standards consulted

- `docs/base-standards.md` — KISS/YAGNI (fulfillment de una sola opción no se modela como control
  elegible; sin store global para un solo consumidor).
- `docs/code/frontend-standards.md` §3 (codegen mandatorio — nunca hand-write mirrors), §11.3
  (error mapping), §11.4 (estado como unión discriminada), §11.5 (repositorio por feature), §11.8
  (observabilidad), §11.9 (composición de estados de carga), §12.1/§12.2 (sanitización, validación
  cliente=UX/servidor=seguridad), §12.3 (sin secretos en el bundle — no aplica ninguno nuevo).
- `docs/code/frontend-next-standards.md` §1 (route groups), §2 (frontera Server/Client — hereda la
  restricción de US-007/US-014: `session: 'cart'` no puede salir del servidor), §6 (Metadata API,
  `noindex`).
- `docs/architecture/api-standards.md` §5.5 (dinero en centavos, nunca recalculado en cliente),
  §8 (RFC 7807).
- `docs/cross-cutting/security-standards.md` — token de un solo uso: dónde se persiste
  client-side (nunca en la URL — mismo razonamiento que el backend aplicó para no exponer el
  `order_id`).
- `docs/quality/testing-standards.md` §14; `docs/quality/qa-frontend-standards.md` §19, §23, §24.
- Skills: `openapi-client-codegen` (verificar frescura, no re-wirear), `frontend-resilience-patterns`
  (mapeo de 409/422/403/429/network), `msw-setup`, `playwright-stability`, `observability-patterns`
  §9.5 (eventos canónicos), `openspec-workflow`.

## Open questions

Ninguna bloquea el arranque; las cuatro tienen default implementado y quedan para ratificación de
PO/Arquitecto:

- **OQ-FE-19** — ¿Dónde persiste el FE el `order_token` entre el 201 de este change y la futura
  pantalla de pago (US-009, sin plan de FE todavía)? **Default: `sessionStorage`** (clave
  `dsm_order_token`), nunca en la URL — mismo razonamiento que el backend usó para no exponer el
  `order_id` (termina en el `Referer` que el navegador manda a MercadoPago al redirigir).
- **OQ-FE-20** — ¿La confirmación post-checkout es un estado in-place en `/checkout` o una ruta
  propia (`/checkout/confirmacion`)? **Default: estado in-place** (sin ruta nueva) — evita
  inventar una URL que el plan de US-009 FE podría preferir diseñar distinto.
- **OQ-FE-21** — AC-1 pide "confirma el retiro en sucursal", pero `fulfillment` tiene un solo
  valor posible (`pickup`). **Default: información fija** (dirección + horario, sin checkbox
  redundante) — el propio submit del formulario es la confirmación; una segunda casilla para una
  única opción es fricción sin señal (KISS).
- **OQ-FE-22** — ¿El checkout revalida el carrito (`GET /v1/cart`) al montar, o confía en el
  estado que ya cargó `CartProvider`? **Default: `reload()` al montar** `/checkout` (igual que
  `CartPage`), para no ofrecer un submit sobre un carrito potencialmente stale de otra pestaña.
