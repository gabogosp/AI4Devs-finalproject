# QA Plan — US-008 Checkout guest (Backend)

> **Ticket**: US-008 — Checkout guest — datos, consentimiento y retiro
> **Author**: qa-engineer agent
> **Date**: 2026-08-23 (regenerado 2026-08-30)
> **Status**: Proposed
> **Affected platform(s)**: backend
> **Service tier(s)**: 1 (loop de compra — camino crítico)
> **Companion files**: `proposal.md`, `tasks.md`, `design.md`

> **Nota de regeneración (2026-08-30)**: este plan se escribió el 2026-08-23, cuando la disciplina
> `US-008-checkout-guest-frontend-web` todavía no existía y dos ítems quedaron explícitamente
> bloqueados a la espera de ella: `SC-008-X3` (§3, escenario `@cross-feature @frontend`) y
> `QA-008-E2E-1` (§6, E2E Playwright cross-stack). Ese change ya está **planificado y construido**
> (PR #23, mergeado a `main` — `bacffc5`, 39/39 tasks cerradas, suite verde). Esta regeneración
> **un-diferra** ambos ítems contra el formulario real (`apps/web/src/features/checkout/`) y el
> seam de consentimiento real (`apps/web/src/features/legal/routes.ts`). El resto del plan —
> contract testing (§4), k6 (§5), exploratory (§8), y los escenarios BDD de AC-1/3/4/5/8 que no
> dependían del FE— queda igual: seguía correcto y no requería el FE para ejecutarse.

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
| **E2E cross-stack (Playwright)** | ✅ Sí | Playwright (`qa/e2e/`) | Carrito → checkout → orden creada en `pending_payment` (FE+BE reales); el loop con pago queda en US-010 |
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
    Y ambos href provienen de CONSENT_COPY.links (src/features/legal/routes.ts) — el
      componente ConsentCheckbox.tsx no declara ningún literal "/legales/"
```

**Tooling**: Cucumber-js con `qa/acceptance/steps/checkout.steps.ts` para los escenarios
API-level (`@happy`, `@alternative`, `@negative`, `SC-008-X1`, `SC-008-X2`) contra `supertest`.

**Los escenarios `@frontend` (`SC-008-X3`) NO corren en Cucumber-js/supertest** — no hay UI que
renderizar a ese nivel. Se ejecutan como aserciones dentro del spec Playwright cross-stack
`qa/e2e/checkout.spec.ts` (§6, `QA-008-E2E-1`), que es quien tiene un navegador real montado
contra el build real del FE.

**Location**: `qa/acceptance/features/checkout.feature` (API-level) + `qa/e2e/checkout.spec.ts`
(cross-stack, cubre `SC-008-X3`).
**Reuses**: seed de `qa/support/seed-carrito.ts` + `qa/support/cart-client.ts`.

- [x] **QA-008-BDD-1**: `checkout.feature` — los 12 escenarios API-level (Cucumber-js + supertest)

  ```yaml
  id: QA-008-BDD-1
  scenario: SC-008-H1, SC-008-H2, SC-008-A1, SC-008-A2, SC-008-A3, SC-008-A4, SC-008-A5, SC-008-N1, SC-008-N2, SC-008-N3, SC-008-X1, SC-008-X2
  execution_mode: automated
  test_layer: 3
  target_tooling: Cucumber+Supertest
  gherkin_scenario: "AC-1..AC-8 — qa/acceptance/features/checkout.feature completo"
  ```

  - Exit criterion: `qa/acceptance/features/checkout.feature` existe con los 12 escenarios
    API-level de §3 (todo menos `SC-008-X3`, que corre en `QA-008-E2E-1`) y sus steps en
    `qa/acceptance/steps/checkout.steps.ts` (reusando `seed-carrito.ts`/`cart-client.ts`); los 12
    pasan contra el backend real.
  - Verify: `pnpm --filter @dsm/qa test:acceptance:us008` (exit 0, 14 escenarios passing —
    12 + 2 ejemplos extra del Esquema del escenario SC-008-A2 —, 0 pending/undefined)
  - **Corrección de Verify**: `test:acceptance` no reenvía flags extra (el script no deja un
    `--` para pnpm) — el mismo problema que ya tenía `@importar`, resuelto ahí con un script
    dedicado. Se agregó `test:acceptance:us008`, mismo patrón.

---

## 4. Contract testing

- [x] **QA-008-CT-1**: Contract test para `POST /v1/checkout` vs OpenAPI

  ```yaml
  id: QA-008-CT-1
  scenario: contract
  execution_mode: automated
  test_layer: 3
  target_tooling: fetch (script standalone, mismo estilo que search.contract.ts)
  gherkin_scenario: "AC-1/AC-3/AC-4/AC-5 — contrato de POST /v1/checkout vs OpenAPI"
  ```

  - Exit criterion: `qa/contract/checkout.contract.ts` valida que el 201 matchee el
    schema de `CheckoutCreated`, que el 409 y 422 matcheen `application/problem+json`
    (`Problem`), y que el 429 incluya las cabeceras `RateLimit-*` — el 429 corre
    contra una instancia dedicada de rate-limit bajo (`QA_CHECKOUT_LOWLIMIT_BASE_URL`,
    mismo patrón que TC-613 de `importar.steps.ts`) para no quemar el cupo de la
    instancia compartida.
  - Verify: `QA_CHECKOUT_LOWLIMIT_BASE_URL=http://localhost:3014 pnpm --filter @dsm/qa
    test:contract:checkout` (exit 0)
  - **Corrección de tooling declarado en el plan**: `test:contract` es un script
    hardcodeado a `search.contract.ts` (no acepta `--testPathPattern`, no es
    Supertest sino `fetch` contra un servidor real, igual que el resto de
    `qa/contract/`) — se agregó `test:contract:checkout` como script propio, mismo
    patrón que ya existía, en vez de forzar el nombre que el plan asumía sin
    verificar el runner real.

---

## 5. Performance (k6)

- [x] **QA-008-PERF-1**: Script k6 para `POST /v1/checkout` con target p95 < 500 ms

  ```yaml
  id: QA-008-PERF-1
  scenario: L-1
  execution_mode: automated
  test_layer: 3
  target_tooling: k6
  gherkin_scenario: "US-008 §9 / NFR p95 escritura < 500ms"
  name: Checkout_OrdenPendingPayment_P95BajoQuinientosMs
  ```

  - Exit criterion: `qa/performance/checkout.js` crea carritos → ejecuta checkouts con datos válidos, midiendo la escritura. Threshold: `'http_req_duration{endpoint:checkout}': ['p(95)<500']`. Requiere seed previo.
  - Verify: `k6 run --vus 3 --duration 15s qa/performance/checkout.js --summary-trend-stats="p(95)" 2>&1 | grep -q "✓"`

- [x] **QA-008-PERF-2**: Threshold de checkout agregado a `thresholds.js`

  ```yaml
  id: QA-008-PERF-2
  scenario: L-1
  execution_mode: automated
  test_layer: 3
  target_tooling: k6
  gherkin_scenario: "US-008 §9 / NFR p95 escritura < 500ms"
  ```

  - Exit criterion: `qa/performance/lib/thresholds.js` exporta `checkout` con `'http_req_duration{endpoint:checkout}': ['p(95)<500']`.
  - Verify: `grep -q "p(95)<500" qa/performance/lib/thresholds.js && grep -q "checkout" qa/performance/lib/thresholds.js`

---

## 6. E2E Playwright (cross-stack)

> El E2E del **loop completo** (checkout → pago → confirmación) sigue planificado en el qa-plan de
> US-010 (`QA-010-E2E-1`), porque depende del pago simulado "DSM" (US-009) y del webhook (US-010) —
> ninguno de los dos tiene todavía plan de frontend (`US-010/qa-plan.md` §12 lo sigue marcando
> `Blocked-by: FE-US-009 + FE-US-012`). Lo que **este** ítem cubre ya no es "el formulario en
> aislamiento" — desde que `US-008-checkout-guest-frontend-web` existe (PR #23, mergeado a `main`),
> es el checkout **completo contra FE y BE reales**: agregar al carrito → `/carrito` → "Ir al
> pago" → `/checkout` → completar → confirmar → orden creada de verdad en `pending_payment`. Se
> detiene ahí porque no hay nada más que hacer con la orden hasta que exista la pantalla de pago
> (US-009 FE, sin planificar).

- [ ] **QA-008-E2E-1**: Spec Playwright cross-stack — checkout completo (FE real + BE real)

  ```yaml
  id: QA-008-E2E-1
  scenario: SC-008-H1, SC-008-A3, SC-008-X3
  execution_mode: automated
  test_layer: 3
  target_tooling: Playwright
  gherkin_scenario: SC-008-H1 — Checkout válido crea la orden en pending_payment
  ```

  - Exit criterion: `qa/e2e/checkout.spec.ts` (Layer 3 de `qa-three-layer-regression` — real
    backend + real frontend, **sin** el stub de `apps/web/e2e/support/api-stub.mjs`) ejecuta,
    contra un producto sembrado por `qa/support/seed-carrito.ts`:
    1. Agrega el producto desde `/productos/{slug}` (`getByRole('button', { name: /agregar al
       carrito/i })`), navega a `/carrito`.
    2. Verifica que el botón `getByRole('button', { name: /ir al pago/i })` está habilitado (sin
       `has_blocking_issues`) y hace click — navega a `/checkout` (URL real).
    3. Completa nombre/email/teléfono válidos (`getByLabel(/nombre|email|teléfono/i)`).
    4. Verifica **SC-008-X3**: el checkbox de consentimiento muestra un enlace con texto
       `/política de privacidad/i` cuyo `href` resuelve `/legales/privacidad` y uno con texto
       `/términos/i` cuyo `href` resuelve `/legales/terminos` — ninguno de los dos es `#` (contra
       el build real, no el markup leído en el código).
    5. Marca el checkbox, click en `getByRole('button', { name: /confirmar pedido/i })`.
    6. Espera la respuesta real de `POST /v1/checkout` (`page.waitForResponse('**/v1/checkout')`),
       status `201`.
    7. Verifica el heading `/pedido quedó registrado/i` y que el `order_number` visible en pantalla
       coincide con el del body de la respuesta real (SC-008-H1).
    8. Segundo caso (SC-008-A3, mitad UI): mismo flujo sin marcar el consentimiento → el submit
       **no** navega, el banner "Tenés que aceptar los términos…" queda visible, y no se dispara
       ningún `POST /v1/checkout` (`page.waitForResponse` con timeout corto debe **no** resolver).
  - Verify: `pnpm --filter @dsm/qa test:e2e -- --grep "checkout" --reporter=list` (exit 0)

  **Nota de alcance (evita duplicar con el FE)**: este spec es el E2E **QA-owned** de Layer 3 —
  corre contra API y UI reales, con datos sembrados por la API. **No** duplica el E2E dev-owned de
  Layer 2 que ya vive en `apps/web/e2e/checkout-happy-path.spec.ts` y
  `apps/web/e2e/checkout-topology.spec.ts`: esos son smoke del FE en aislamiento, corren contra el
  stub `apps/web/e2e/support/api-stub.mjs` (sin backend real, sin base de datos) y prueban que la
  app **compilada** llama a la ruta correcta y que el rewrite same-origin (ADR-0013) no se rompió
  — cubren la topología, no el contrato con un backend vivo. `QA-008-E2E-1` es el único spec que
  prueba el **acuerdo real** entre las tres capas (Postgres real, `POST /v1/checkout` real,
  navegador real).

  **Dependencia resuelta**: ~~`Blocked-by: FE-US-008 (formulario de checkout construido)`~~ — el
  formulario existe y está mergeado. `/develop-qa` puede escribir y correr esta suite ahora mismo
  contra el `main` actual sin esperar ningún merge adicional (ver §12).

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
| US-007 backend (carrito) | Mergeado a `main` | Necesario para crear carritos en los tests — resuelto |
| FE-US-008 (formulario checkout) | **Mergeado a `main`** (PR #23, `bacffc5`; 39/39 tasks) | Ya no bloquea — desbloquea `QA-008-E2E-1` (§6) y `SC-008-X3` (§3) |
| OpenAPI de `/v1/checkout` publicado | En tasks.md T6.1 (backend) | Requerido para contract testing |

> **Nota sobre el estado de PR #23**: al momento de escribir esta regeneración (2026-08-30) PR #23
> ya está **mergeado** a `main` (no "abierto" como se asumió al encargar esta regeneración) — se
> verificó con `gh pr view 23` y `git log origin/main`. Esto no cambia el plan: los ítems
> desbloqueados (§3, §6) ya eran ejecutables aun si el PR siguiera abierto contra una rama propia,
> porque `/develop-qa` puede trabajar sobre esa rama; estando mergeado, simplemente no hace falta
> ninguna coordinación adicional — la suite se escribe y corre directo contra `main`.

---

## 13. Standards consultados

- `docs/quality/testing-standards.md` §2, §5, §12, §13
- `docs/quality/qa-backend-standards.md` §2.1, §13, §21
- `docs/product/design-e2e.md` §17 (p95 escritura < 500 ms), §19
- Skill `qa-three-layer-regression` — modelo de capas aplicado en la regeneración de §6
  (`QA-008-E2E-1` es Layer 3: real BE + real FE, no duplica el smoke Layer 2 dev-owned de
  `apps/web/e2e/`) y frontmatter (`execution_mode`/`test_layer`/`target_tooling`/`gherkin_scenario`)
  del ítem desbloqueado.
- Skill `bdd-scenario-quality` — verificado que `SC-008-X3` un-deferido mantiene tense
  declarativo/imperativo y no filtra detalle de implementación (asserta sobre `href` observable,
  no sobre el árbol de componentes React).
