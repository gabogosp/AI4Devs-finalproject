# QA Plan — US-008 Checkout guest (Backend)

> **Ticket**: US-008 — Checkout guest — datos, consentimiento y retiro
> **Author**: qa-engineer agent
> **Date**: 2026-08-23
> **Status**: Proposed
> **Affected platform(s)**: backend
> **Service tier(s)**: 1 (loop de compra — camino crítico)
> **Companion files**: `proposal.md`, `tasks.md`, `design.md`

---

## 1. Perfil de riesgo

- **Módulo `checkout`**: CRÍTICO — primera PII en reposo del proyecto (nombre, email, teléfono); registro de consentimiento legal (Ley 25.326); snapshot de precios (dinero).
- **Endpoint `POST /v1/checkout`**: escritura con CSRF, rate-limit propio, consentimiento obligatorio.
- **Interacción con carrito**: consume CartModule para leer el carrito; no modifica stock ni cobra.

Journeys críticas identificadas:
1. Cliente con carrito válido → completa datos → orden creada en `pending_payment`.
2. Carrito inválido o consentimiento no aceptado → el checkout bloquea con mensaje claro.
3. La PII del comprador queda protegida y no aparece en logs ni errores.

---

## 2. Matriz de test (QA-owned)

| Capa | Requerida | Herramienta | Qué cubre |
|---|---|---|---|
| Unit / Integration BE | Dev-owned (TDD) | Jest + Postgres real | Repos, service, order-draft, PII guard — **no planificado acá** |
| **Acceptance (BDD)** | ✅ Sí | Cucumber-js + supertest (`qa/acceptance/`) | AC-1..AC-8 |
| **Contract** | ✅ Sí | Spectral + supertest vs OpenAPI | `POST /v1/checkout` responde conforme al spec |
| **Performance (k6)** | ✅ Sí | k6 (`qa/performance/checkout.js`) | p95 escritura < 500 ms (PRD §4) |
| **E2E cross-stack (Playwright)** | ✅ Sí | Playwright (`qa/e2e/`) | Formulario checkout → orden creada (con pago simulado en US-009/010) |
| **Exploratory** | ✅ Sí | Charters | PII en logs, doble-submit, timezone del consentimiento |

> **Nota dev-owned**: tasks.md cubre 20 tasks con unit de order-draft, integration de OrdersRepository, e2e-nest de validación/CSRF/rate-limit/PII/cache/esquema, y los 4 AC negativos como invariantes. No se duplica.

---

## 3. Escenarios BDD (Gherkin)

```gherkin
# language: es
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
  Escenario Outline: SC-008-A2 — Validación de cada campo obligatorio (AC-3)
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
```

**Tooling**: Cucumber-js con `qa/acceptance/steps/checkout.steps.ts`.
**Location**: `qa/acceptance/features/checkout.feature`.
**Reuses**: seed de `qa/support/seed-carrito.ts` + `qa/support/cart-client.ts`.

---

## 4. Contract testing

- [ ] **QA-008-CT-1**: Supertest contract test para `POST /v1/checkout` vs OpenAPI
  - Exit criterion: un spec valida que el 201 matchee el schema de response, que el 409 y 422 matcheen `application/problem+json`, y que el 429 incluya las cabeceras `RateLimit-*`.
  - Verify: `pnpm --filter @dsm/qa test:contract -- --testPathPattern=checkout` (exit 0)

---

## 5. Performance (k6)

- [ ] **QA-008-PERF-1**: Script k6 para `POST /v1/checkout` con target p95 < 500 ms
  - Exit criterion: `qa/performance/checkout.js` crea carritos → ejecuta checkouts con datos válidos, midiendo la escritura. Threshold: `'http_req_duration{endpoint:checkout}': ['p(95)<500']`. Requiere seed previo.
  - Verify: `k6 run --vus 3 --duration 15s qa/performance/checkout.js --summary-trend-stats="p(95)" 2>&1 | grep -q "✓"`

- [ ] **QA-008-PERF-2**: Threshold de checkout agregado a `thresholds.js`
  - Exit criterion: `qa/performance/lib/thresholds.js` exporta `checkout` con `'http_req_duration{endpoint:checkout}': ['p(95)<500']`.
  - Verify: `grep -q "p(95)<500" qa/performance/lib/thresholds.js && grep -q "checkout" qa/performance/lib/thresholds.js`

---

## 6. E2E Playwright (cross-stack)

> El E2E del **loop completo** (checkout → pago → confirmación) se planifica en el qa-plan de US-010, porque depende del pago simulado "DSM" (US-009) y del webhook (US-010). Acá se cubre el formulario de checkout en aislamiento.

- [ ] **QA-008-E2E-1**: Spec Playwright — formulario de checkout con validación inline
  - Exit criterion: `qa/e2e/checkout-form.spec.ts` navega al checkout con un carrito, deja campos vacíos, verifica mensajes de error por campo, luego completa correctamente y verifica que avanza al paso de pago.
  - Verify: `pnpm --filter @dsm/qa test:e2e -- --grep "checkout-form" --reporter=list` (exit 0 cuando FE existe)

**Dependencia**: `Blocked-by: FE-US-008 (formulario de checkout construido)`.

---

## 7. Datos y fixtures

### Seeds requeridos

- Reusa `qa/support/seed-carrito.ts` (ya existe: crea carrito con productos disponibles).
- `seed-checkout.ts` (nuevo): crea un carrito poblado + datos de comprador válidos como defaults para los BDD steps.

### Builders requeridos

- `buildBuyerData(overrides?)`: genera `{ name, email, phone }` con defaults válidos.
- `buildCheckoutBody(overrides?)`: genera el body completo del `POST /v1/checkout`.

---

## 8. Exploratory charters

Agregar a `qa/exploratory/charters.md`:

1. **Charter: Doble-submit del checkout** — enviar el POST dos veces rápido con el mismo carrito; verificar que se crean 2 órdenes (ADR: no se previene) y que ninguna descuenta stock.
2. **Charter: PII en logs del checkout** — con centinelas como email, verificar que no aparecen en ningún log ni en respuestas de error.
3. **Charter: Timezone del consentimiento** — verificar que `consent_accepted_at` se graba en UTC y no en la zona del servidor.

---

## 9. Quality gates

| Gate | Blocks | Trigger |
|---|---|---|
| Contract (supertest vs OpenAPI) | merge | todo PR que toque `src/checkout/` |
| Acceptance BDD (API-level) | merge | todo PR de `src/checkout/` |
| k6 p95 < 500 ms | release | pre-release |
| E2E Playwright checkout | uat promotion | post-deploy staging |

---

## 10. Anti-patterns evitados

- ❌ `testing-standards.md` §18: "Testing implementation details" — los BDD no verifican que Prisma haga una transacción; verifican el resultado observable (orden creada con los datos correctos).
- ❌ `qa-backend-standards.md` §22: "QA writes all the tests" — unit/integration del snapshot de precios, repo, PII guard son dev-owned.
- ❌ "Test con datos de producción" — todo PII es sintético (centinelas).

---

## 11. Preguntas abiertas

1. **OQ-QA-008-1**: ¿El test k6 del checkout necesita un carrito nuevo por cada iteración? Sí: cada checkout consume un carrito. El setup script debe crear carritos pre-poblados.

---

## 12. Dependencias declaradas

| Dependencia | Estado | Efecto |
|---|---|---|
| US-007 backend (carrito) | In Progress (37/37, pending commit) | Necesario para crear carritos en los tests |
| FE-US-008 (formulario checkout) | No planificado | **BLOQUEA** E2E Playwright |
| OpenAPI de `/v1/checkout` publicado | En tasks.md T6.1 | Requerido para contract testing |

---

## 13. Standards consultados

- `docs/quality/testing-standards.md` §2, §5, §12, §13
- `docs/quality/qa-backend-standards.md` §2.1, §13, §21
- `docs/product/design-e2e.md` §17 (p95 escritura < 500 ms), §19
