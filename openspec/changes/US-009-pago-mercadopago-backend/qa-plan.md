# QA Plan — US-009 Pago con MercadoPago + medio simulado "DSM" (Backend)

> **Ticket**: US-009 — Pago con MercadoPago (hosted) + medio simulado "DSM"
> **Author**: qa-engineer agent
> **Date**: 2026-08-23
> **Status**: Proposed
> **Affected platform(s)**: backend
> **Service tier(s)**: 1 (loop de compra — integración con dinero)
> **Companion files**: `proposal.md`, `tasks.md`, `design.md`

---

## 1. Perfil de riesgo

- **Módulo `payments`**: CRÍTICO — involucra dinero real (MercadoPago); el medio simulado "DSM" es load-bearing para test E2E.
- **Integración con MercadoPago**: dependencia externa con circuit breaker; errores significan cobros fallidos o perdidos.
- **Feature flag del simulado**: mal configurado en producción = aprobación de pagos sin cobrar (ADR-0006).
- **Endpoint `POST /v1/payments`**: inicia el pago; devuelve `init_point` de MercadoPago.

Journeys críticas identificadas:
1. Cliente con orden pending_payment → paga con MP → redirect al checkout hosted.
2. Pago simulado "DSM" → aprobación inmediata sin transacción real → dispara US-010.
3. Flag del simulado deshabilitado en producción → el medio no está disponible.
4. MP caído → circuit breaker abierto → error claro al cliente.

---

## 2. Matriz de test (QA-owned)

| Capa | Requerida | Herramienta | Qué cubre |
|---|---|---|---|
| Unit / Integration BE | Dev-owned (TDD) | Jest + Postgres real | Repos, service, circuit breaker, adaptador falso — **no planificado acá** |
| **Acceptance (BDD)** | ✅ Sí | Cucumber-js + supertest (`qa/acceptance/`) | AC-1..AC-9 |
| **Contract** | ✅ Sí | Spectral + supertest vs OpenAPI | Endpoints de payments (`POST`, `GET /latest`, `POST /simulate`) |
| **E2E cross-stack (Playwright)** | ✅ Sí | Playwright (`qa/e2e/`) | Loop pago simulado → página de retorno |
| **Exploratory** | ✅ Sí | Charters | Doble pago, flag en prod, orden ajena |

> **Nota dev-owned**: tasks.md cubre 28 tasks con unit del circuit breaker, integration del adaptador HTTP de MP, e2e-nest del controller con CSRF/throttler/flag, schema de `payments`, y los AC negativos. No se duplica.

---

## 3. Escenarios BDD (Gherkin)

```gherkin
# language: es
@pagos @us-009
Característica: Pago con MercadoPago y medio simulado DSM (US-009)
  Como cliente
  quiero pagar mi pedido con MercadoPago o con el medio simulado
  para completar la compra de forma segura

  Antecedentes:
    Dado una orden en estado "pending_payment" con order_token válido

  # ─── HAPPY PATH ───

  @happy @critical-path
  Escenario: SC-009-H1 — Iniciar pago real crea preferencia y devuelve init_point (AC-1)
    Cuando el cliente inicia el pago con method "mercadopago"
    Entonces recibe 201 con payment_id, status "pending" e init_point (URL de MP)
    Y se crea un registro en payments con provider "mercadopago" y preference_id no vacío

  @happy @critical-path
  Escenario: SC-009-H2 — Pago simulado aprueba sin transacción real (AC-3)
    Dado el sistema con PAYMENTS_SIMULATED_ENABLED=true
    Cuando el cliente paga con method "simulated_dsm"
    Entonces recibe 201 con status "approved"
    Y se dispara la confirmación al PaymentConfirmationPort
    Y no se hizo ninguna llamada a MercadoPago

  @happy
  Escenario: SC-009-H3 — Retorno exitoso muestra página de resultado (AC-2)
    Dado un pago iniciado con init_point
    Cuando el cliente vuelve del checkout hosted con status=approved
    Entonces puede consultar GET /v1/payments/latest con su order_token
    Y ve payment_status y order_status

  # ─── ALTERNATIVE PATH ───

  @alternative
  Escenario: SC-009-A1 — Pago rechazado: orden sigue pending (AC-4)
    Dado un pago iniciado
    Cuando MercadoPago devuelve al cliente con status=rejected
    Entonces la orden sigue en "pending_payment"
    Y el stock no se afectó

  @alternative
  Escenario: SC-009-A2 — Pago pendiente de aprobación (AC-5)
    Dado un pago iniciado
    Cuando MercadoPago devuelve con status=pending
    Entonces el cliente ve "pago en proceso" al consultar /latest
    Y la orden permanece en "pending_payment"

  # ─── NEGATIVE SPACE ───

  @negative @critical-path
  Escenario: SC-009-N1 — El simulado no está disponible en producción (AC-7)
    Dado NODE_ENV=production y PAYMENTS_SIMULATED_ENABLED=false
    Cuando el cliente intenta pagar con method "simulated_dsm"
    Entonces recibe 422 (método no disponible)

  @negative
  Escenario: SC-009-N2 — No se almacenan datos de tarjeta (AC-6)
    Cuando el cliente envía un body con un campo "card_number"
    Entonces recibe 422 (campo no permitido)
    Y la tabla payments no tiene columnas de tarjeta

  @negative
  Escenario: SC-009-N3 — La confirmación NO se basa en la URL de retorno (AC-8)
    Cuando el cliente llega a la URL de retorno con status=approved
    Entonces la orden NO pasa a "new" solo por eso
    Y el cambio de estado depende del webhook verificado (US-010)

  @negative
  Escenario: SC-009-N4 — No se puede pagar una orden ajena (AC-9)
    Dado una orden de otro comprador
    Cuando el cliente intenta pagarla con un order_token distinto
    Entonces recibe 404 (orden no encontrada)
    Y no se crea ningún pago

  @negative
  Escenario: SC-009-N5 — No se puede pagar una orden inexistente (AC-9)
    Cuando el cliente envía un order_token inventado
    Entonces recibe 404

  # ─── CROSS-FEATURE ───

  @cross-feature
  Escenario: SC-009-X1 — El pago simulado dispara el mismo flujo que el real (AC-3 + AC-9 de US-010)
    Dado el sistema con simulado habilitado
    Cuando el cliente paga con "simulated_dsm"
    Entonces el PaymentConfirmationPort se invoca con los mismos parámetros que un pago real aprobado
```

**Tooling**: Cucumber-js con `qa/acceptance/steps/pagos.steps.ts`.
**Location**: `qa/acceptance/features/pagos.feature`.
**Reuses**: seed de `qa/support/seed-carrito.ts` → checkout para crear la orden.

---

## 4. Contract testing

- [ ] **QA-009-CT-1**: Supertest contract test para endpoints de payments vs OpenAPI
  - Exit criterion: un spec valida que `POST /v1/payments` (201, 404, 422, 429), `GET /v1/payments/latest` (200, 404) y `POST /v1/payments/simulate` (201, 404, 422) matcheen los schemas declarados en OpenAPI.
  - Verify: `pnpm --filter @dsm/qa test:contract -- --testPathPattern=payments` (exit 0)

---

## 5. E2E Playwright (cross-stack) — con pago simulado

> El pago simulado "DSM" es **load-bearing** para el E2E de Playwright (ADR-0006, E2E §19): permite ejercer el flujo completo sin depender del sandbox de MercadoPago.

- [ ] **QA-009-E2E-1**: Spec Playwright — flujo de pago simulado desde la UI
  - Exit criterion: `qa/e2e/pago-simulado.spec.ts` (o dentro del spec del loop completo en US-010) navega: carrito → checkout → selecciona medio "DSM" → ve confirmación de pago aprobado.
  - Verify: `pnpm --filter @dsm/qa test:e2e -- --grep "pago-simulado" --reporter=list` (exit 0 cuando FE existe)

**Dependencia**: `Blocked-by: FE-US-008 + FE-US-009 (formularios de checkout y pago construidos)`.

---

## 6. Datos y fixtures

### Seeds requeridos

- Reusa el carrito de `qa/support/seed-carrito.ts` + un paso de checkout para crear la orden.
- `seed-pagos.ts` (nuevo): crea una orden `pending_payment` con `order_token` conocido, lista para testear pagos directamente.

### Builders requeridos

- `buildPaymentBody(overrides?)`: genera `{ order_token, method }` con defaults.

---

## 7. Exploratory charters

Agregar a `qa/exploratory/charters.md`:

1. **Charter: Doble pago sobre la misma orden** — enviar `POST /v1/payments` dos veces con la misma orden; verificar que el índice parcial `payments_one_pending_per_order` lo bloquea.
2. **Charter: Flag simulado en producción** — con `NODE_ENV=production`, verificar que el arranque con `PAYMENTS_SIMULATED_ENABLED=true` **falla** (nunca arranca).
3. **Charter: Circuit breaker de MP** — simular 5 errores 5xx consecutivos del adaptador y verificar que la 6ta llamada falla inmediatamente sin intentar la red.

---

## 8. Quality gates

| Gate | Blocks | Trigger |
|---|---|---|
| Contract (supertest vs OpenAPI) | merge | todo PR que toque `src/payments/` |
| Acceptance BDD (API-level) | merge | todo PR de `src/payments/` |
| E2E Playwright (pago simulado) | uat promotion | post-deploy staging |
| Flag deshabilitado en prod | release (manual gate) | pre-deploy a producción |

---

## 9. Anti-patterns evitados

- ❌ "Testear con sandbox de MP en CI" — el CI usa el medio simulado "DSM" y el adaptador falso; el sandbox de MP es para verificación manual pre-release.
- ❌ "QA escribe los tests del circuit breaker" — eso es dev-owned (unit test del breaker); QA verifica el comportamiento observable (error claro al cliente).
- ❌ "Test E2E que depende de la red" — Playwright usa el simulado; ningún test automático llama a api.mercadopago.com.

---

## 10. Preguntas abiertas

1. **OQ-QA-009-1**: ¿Se corre un test manual de sandbox de MP antes de cada release, o solo en el primer deploy? Recomendación: primer deploy + cada vez que se toque el módulo de pagos.

---

## 11. Dependencias declaradas

| Dependencia | Estado | Efecto |
|---|---|---|
| US-008 backend (orders exist) | Draft (0 tasks) | **BLOQUEA** toda la suite de pagos |
| US-010 backend (webhook + confirmación) | Draft (0 tasks) | Necesario para verificar que el simulado dispara la confirmación real |
| FE-US-008 + FE-US-009 | No planificado | **BLOQUEA** E2E Playwright |
| INFRA-US-009 (secrets MP) | Todo | Necesario para test manual de sandbox |

---

## 12. Standards consultados

- `docs/quality/testing-standards.md` §2, §5, §12
- `docs/quality/qa-backend-standards.md` §2.1, §21
- `docs/product/design-e2e.md` §17, §19
- ADR-0006 (MercadoPago hosted + simulado)
