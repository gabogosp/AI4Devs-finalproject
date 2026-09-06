# language: es
#
# Verbatim de qa-plan.md §3 (US-008-checkout-guest-backend, regenerado
# 2026-08-30). SC-008-X3 (`@cross-feature @frontend`) NO corre acá — no hay UI
# que renderizar a nivel API/supertest — vive en `qa/e2e/checkout.spec.ts`
# (`QA-008-E2E-1`). Se ejecuta esta suite con
# `--tags "@us-008 and not @frontend"` para excluirla sin tocar el Gherkin.
@checkout @us-008
Característica: Checkout guest — datos, consentimiento y retiro (US-008)
  Como cliente sin cuenta
  quiero confirmar mi compra dejando mis datos y aceptando los términos
  para completar el pedido sin registrarme

  Antecedentes:
    Dado un catálogo sembrado con productos disponibles
    Y un invitado con un carrito con 2 productos

  # ─── HAPPY PATH ───

  @happy @critical-path
  Escenario: SC-008-H1 — Checkout válido crea la orden en pending_payment (AC-1)
    Cuando el cliente completa nombre, email y teléfono válidos
    Y acepta los términos y confirma retiro en sucursal
    Entonces recibe 201 con order_token y order_number ≥ 1000
    Y la orden en base tiene status "pending_payment"
    Y el stock de los productos no se modificó

  @happy
  Escenario: SC-008-H2 — La orden registra ítems con precio al momento (AC-2)
    Cuando el checkout se confirma exitosamente
    Entonces cada order_item tiene el unit_price_ars_cents vigente al crear
    Y el total_ars_cents es la suma de (quantity × unit_price) de sus líneas

  # ─── ALTERNATIVE PATH ───

  @alternative
  Escenario: SC-008-A1 — Validación rechaza datos incompletos (AC-3)
    Cuando el cliente envía email vacío
    Entonces recibe 422 con error que nombra el campo "email"
    Y no se crea ninguna orden

  @alternative
  Esquema del escenario: SC-008-A2 — Validación de cada campo obligatorio (AC-3)
    Cuando el cliente envía <campo> con valor <valor>
    Entonces recibe 422 con error que nombra "<campo>"

    Ejemplos:
      | campo | valor |
      | email | "no-es-email" |
      | name  | "" |
      | phone | "" |

  @alternative
  Escenario: SC-008-A3 — Consentimiento no aceptado bloquea el avance (AC-4)
    Cuando el cliente envía consent: false
    Entonces recibe 422
    Y no se crea ninguna orden

  @alternative
  Escenario: SC-008-A4 — Carrito vacío bloquea el checkout (AC-5)
    Dado un invitado con un carrito vacío
    Cuando intenta hacer checkout
    Entonces recibe 409 con código "dsm:checkout/cart-empty"

  @alternative
  Escenario: SC-008-A5 — Carrito con producto despublicado bloquea (AC-5)
    Dado un invitado con un carrito con un producto que se despublicó
    Cuando intenta hacer checkout
    Entonces recibe 409 con código "dsm:checkout/cart-not-purchasable"
    Y el error nombra el slug del producto problemático

  # ─── NEGATIVE SPACE ───

  @negative
  Escenario: SC-008-N1 — El stock NO se descuenta antes del pago (AC-6)
    Cuando el checkout se confirma y la orden queda en pending_payment
    Entonces el stock de cada producto en la orden es idéntico al de antes del checkout

  @negative
  Escenario: SC-008-N2 — No se solicitan ni almacenan datos de tarjeta (AC-7)
    Cuando el cliente manda un body con un campo "card_number"
    Entonces recibe 422 (campo no permitido)
    Y las tablas orders y order_items no tienen columnas de tarjeta

  @negative
  Escenario: SC-008-N3 — El consentimiento queda registrado con marca temporal (AC-8)
    Cuando el checkout se confirma exitosamente
    Entonces la orden tiene consent_accepted = true
    Y consent_accepted_at dentro de los 5s del request
    Y consent_terms_version igual a LEGAL_TERMS_VERSION del entorno

  # ─── CROSS-FEATURE ───

  @cross-feature
  Escenario: SC-008-X1 — Cambio de precio entre carrito y checkout no altera la orden
    Dado un invitado con un producto en su carrito a $1000
    Y el dueño sube el precio a $2000 después
    Cuando el cliente hace checkout
    Entonces la orden registra el precio VIGENTE al momento del checkout (el nuevo)

  @cross-feature
  Escenario: SC-008-X2 — CSRF requerido en la escritura
    Cuando el cliente envía el checkout sin el header X-CSRF-Token
    Entonces recibe 403

  # Hereda la MITAD FRONTEND de US-017 AC-4. La mitad backend de ese AC ya está arriba
  # (SC-008-A3) y la de AC-8 en SC-008-N3. Un-deferido 2026-08-30: `US-008-checkout-guest-
  # frontend-web` (PR #23, mergeado) construyó `ConsentCheckbox.tsx`, que consume
  # `CONSENT_COPY`/`LEGAL_ROUTES` de `features/legal/routes.ts` tal cual — verificado
  # leyendo el componente real, no especulado. Ejecutor: la mitad de renderizado/markup la
  # prueba el componente del FE (`ConsentCheckbox.test.tsx`, dev-owned, Layer 2 — no se
  # duplica acá); la aserción **cross-stack** (los href resuelven de verdad en el navegador,
  # contra el build real) vive en `QA-008-E2E-1` (§6), que ahora la implementa.
  @cross-feature @frontend
  Escenario: SC-008-X3 — El consentimiento enlaza a las dos páginas legales (US-017 AC-4)
    Dado el formulario de checkout renderizado con un carrito válido
    Cuando el cliente mira el checkbox de consentimiento
    Entonces ve un enlace con el texto "política de privacidad" que apunta a /legales/privacidad
    Y ve un enlace con el texto "términos" que apunta a /legales/terminos
    Y ninguno de los dos href es "#"
    Y ambos href provienen de CONSENT_COPY.links (src/features/legal/routes.ts) — el componente ConsentCheckbox.tsx no declara ningún literal "/legales/"
