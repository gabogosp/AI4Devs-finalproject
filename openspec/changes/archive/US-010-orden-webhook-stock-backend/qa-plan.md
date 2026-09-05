# QA Plan — US-010 Webhook de pago + registro de orden + decremento de stock (Backend)

> **Ticket**: US-010 — Webhook de pago + registro de orden + decremento de stock
> **Author**: qa-engineer agent
> **Date**: 2026-08-23
> **Status**: Proposed
> **Affected platform(s)**: backend
> **Service tier(s)**: 1 (núcleo transaccional — dinero + stock)
> **Companion files**: `proposal.md`, `tasks.md`, `design.md`

---

## 1. Perfil de riesgo

- **Webhook MercadoPago**: CRÍTICO — es la puerta por la que entra el dinero. Spoofing/tampering = confirmaciones falsas. Idempotencia obligatoria.
- **Decremento atómico de stock**: CRÍTICO — ADR-0008; stock = única fuente de verdad. Concurrencia real es el escenario de fallo.
- **Reembolso automático por falta de stock**: involucra dinero; un reembolso perdido = plata del cliente.
- **Reconciliación + limpieza**: jobs que corren en proceso; sin ellos, órdenes se pierden.

Journeys críticas identificadas:
1. Pago aprobado (webhook) → orden confirmada → stock decrementado → notificación disparada.
2. Webhook duplicado → procesamiento exactamente-una-vez (idempotencia).
3. Pago aprobado pero sin stock → rollback + cancelación + reembolso automático.
4. Webhook con firma inválida → rechazo total, nada se toca.
5. Órdenes abandonadas → limpieza automática.
6. Webhook perdido → reconciliación recupera la orden.

---

## 2. Matriz de test (QA-owned)

| Capa | Requerida | Herramienta | Qué cubre |
|---|---|---|---|
| Unit / Integration BE | Dev-owned (TDD) | Jest + Postgres real | FSM, stock repo, confirm service, signature, idempotencia, concurrencia — **no planificado acá** |
| **Acceptance (BDD)** | ✅ Sí | Cucumber-js + supertest (`qa/acceptance/`) | AC-1..AC-11 |
| **Contract** | ✅ Sí | Spectral + supertest vs OpenAPI | Endpoint webhook + admin jobs |
| **Performance (k6)** | ✅ Sí | k6 | Webhook throughput bajo concurrencia |
| **E2E cross-stack (Playwright)** | ✅ Sí | Playwright — **con pago simulado DSM** | Loop completo: buscar → comprar → preparar → entregar |
| **Exploratory** | ✅ Sí | Charters | Replay attack, race conditions, reembolso fallido |

> **Nota dev-owned**: tasks.md cubre 26 tasks con test de concurrencia (10 requests parallel), idempotencia por FOR UPDATE, signature verification, FSM completa (36 pares), stock repository con ordering por product_id. No se duplica.

---

## 3. Escenarios BDD (Gherkin)

```gherkin
# language: es
@webhook @stock @us-010
Característica: Webhook de pago + confirmación + decremento de stock (US-010)
  Como sistema
  quiero confirmar la orden cuando el pago es aprobado y verificado
  para mantener el stock como única fuente de verdad

  Antecedentes:
    Dado una orden "pending_payment" con pago "pending" iniciado

  # ─── HAPPY PATH ───

  @happy @critical-path
  Escenario: SC-010-H1 — Pago aprobado confirma la orden y decrementa stock (AC-1)
    Cuando llega un webhook con firma válida y pago aprobado
    Entonces la orden pasa a estado "new"
    Y el stock de cada producto se decrementó en la cantidad pedida
    Y el pago pasa a status "approved" con processed_at

  @happy
  Escenario: SC-010-H2 — La confirmación dispara notificaciones (AC-2)
    Cuando un pago se aprueba y la orden se confirma
    Entonces se invoca NotificationPort.orderConfirmed con el order_id

  # ─── ALTERNATIVE PATH ───

  @alternative
  Escenario: SC-010-A1 — Pago rechazado no confirma ni toca stock (AC-3)
    Cuando llega un webhook con firma válida y pago rechazado
    Entonces la orden permanece en "pending_payment"
    Y el stock no se modificó
    Y el pago pasa a status "rejected"

  @alternative @critical-path
  Escenario: SC-010-A2 — Pago aprobado pero sin stock → reembolso automático (AC-4)
    Dado un producto de la orden con stock insuficiente (stock=0, pedido=2)
    Cuando llega el webhook con pago aprobado y firma válida
    Entonces el decremento falla y la transacción se revierte
    Y la orden pasa a "cancelled"
    Y el pago pasa a "refund_pending"
    Y se solicita el reembolso a MercadoPago
    Y se notifica al comprador de la cancelación

  # ─── NEGATIVE SPACE ───

  @negative @critical-path
  Escenario: SC-010-N1 — Webhook duplicado no decrementa dos veces (AC-5)
    Dado un pago YA procesado (mismo payment_id)
    Cuando llega un webhook duplicado para ese pago
    Entonces el stock NO se decrementa otra vez
    Y la respuesta es 200 (idempotente)
    Y el estado de la orden y del pago no cambian

  @negative
  Escenario: SC-010-N2 — Webhook tardío o fuera de orden es consistente (AC-6)
    Dado un pago ya confirmado
    Cuando llegan webhooks en orden inesperado (approved → rejected → approved)
    Entonces el resultado final refleja el primer "approved" procesado
    Y el stock se decrementó una sola vez

  @negative @critical-path
  Escenario: SC-010-N3 — Webhook con firma inválida se rechaza (AC-7)
    Cuando llega un webhook con firma inválida
    Entonces recibe 401
    Y la orden NO se confirma
    Y el stock NO se toca
    Y no se re-consulta el pago a MercadoPago

  @negative @critical-path
  Escenario: SC-010-N4 — El stock nunca queda negativo bajo concurrencia (AC-8)
    Dado un producto con stock = 1
    Y dos órdenes pendientes que piden ese producto (cantidad = 1 cada una)
    Cuando ambos webhooks llegan simultáneamente con pago aprobado
    Entonces exactamente una orden se confirma con stock decrementado
    Y la otra se cancela y reembolsa
    Y el stock final es 0 (nunca negativo)

  @negative
  Escenario: SC-010-N5 — El medio simulado pasa por el mismo camino (AC-9)
    Dado un pago aprobado por el medio "simulated_dsm"
    Cuando se procesa la confirmación
    Entonces sigue el mismo flujo: decremento atómico + idempotencia + transición a "new"

  @negative
  Escenario: SC-010-N6 — Reconciliación de webhook faltante (AC-10)
    Dado un pago aprobado en MercadoPago cuyo webhook nunca llegó
    Y la orden lleva más de RECONCILE_MIN_AGE_MS en "pending_payment"
    Cuando corre la reconciliación (POST /v1/admin/jobs/reconcile-payments)
    Entonces la orden se confirma igual que si el webhook hubiera llegado

  @negative
  Escenario: SC-010-N7 — Limpieza de órdenes abandonadas (AC-11)
    Dado una orden "pending_payment" con más de ORDER_ABANDON_HOURS sin actividad
    Cuando corre el job de limpieza (POST /v1/admin/jobs/cleanup-abandoned-orders)
    Entonces la orden pasa a "cancelled"
    Y deja de aparecer como activa

  # ─── CROSS-FEATURE ───

  @cross-feature @critical-path
  Escenario: SC-010-X1 — Loop completo: checkout → pago simulado → confirmación → stock
    Dado un carrito con 2 productos disponibles
    Cuando el cliente hace checkout y paga con el simulado "DSM"
    Entonces la orden pasa a "new"
    Y el stock de cada producto se decrementó correctamente
    Y las notificaciones se dispararon

  @cross-feature
  Escenario: SC-010-X2 — Reembolso fallido reintenta (robustez)
    Dado un pago aprobado sin stock que dispara reembolso
    Y MercadoPago devuelve un error transitorio en el refund
    Cuando se procesa
    Entonces el pago queda en "refund_pending"
    Y el runner de reintentos lo volverá a intentar
```

**Tooling**: Cucumber-js con `qa/acceptance/steps/webhook-stock.steps.ts`.
**Location**: `qa/acceptance/features/webhook-stock.feature`.
**Reuses**: seed-carrito → checkout → pago; `qa/support/` + builders.

---

## 4. Contract testing

- [ ] **QA-010-CT-1**: Supertest contract test para `POST /webhooks/mercadopago` vs OpenAPI
  - Exit criterion: un spec valida que el webhook endpoint responde 200 (procesado), 401 (firma inválida), conforme al schema.
  - Verify: `pnpm --filter @dsm/qa test:contract -- --testPathPattern=webhook` (exit 0)

- [ ] **QA-010-CT-2**: Supertest contract test para admin jobs endpoints vs OpenAPI
  - Exit criterion: `POST /v1/admin/jobs/reconcile-payments` y `POST /v1/admin/jobs/cleanup-abandoned-orders` matcheen sus schemas.
  - Verify: `pnpm --filter @dsm/qa test:contract -- --testPathPattern=admin-jobs` (exit 0)

---

## 5. Performance (k6) — webhook throughput

- [ ] **QA-010-PERF-1**: Script k6 para webhook bajo concurrencia con target p95 < 500 ms
  - Exit criterion: `qa/performance/webhook.js` simula 10+ webhooks concurrentes (firmados) contra productos con stock suficiente. Threshold: `'http_req_duration{endpoint:webhook}': ['p(95)<500']`. Ningún webhook pierde stock ni duplica el decremento.
  - Verify: `k6 run --vus 5 --duration 15s qa/performance/webhook.js --summary-trend-stats="p(95)" 2>&1 | grep -q "✓"`

- [ ] **QA-010-PERF-2**: Threshold de webhook agregado a `thresholds.js`
  - Exit criterion: `qa/performance/lib/thresholds.js` exporta `webhook` con threshold p95 < 500 ms.
  - Verify: `grep -q "webhook" qa/performance/lib/thresholds.js && grep -q "p(95)<500" qa/performance/lib/thresholds.js`

---

## 6. E2E Playwright — Loop completo con pago simulado "DSM"

> Este es **EL** test E2E principal del producto (E2E §19): buscar → comprar → preparar → entregar. Usa el medio simulado "DSM" como load-bearing para no depender del sandbox de MercadoPago.

- [ ] **QA-010-E2E-1**: Spec Playwright — loop completo buscar → comprar → orden confirmada
  - Exit criterion: `qa/e2e/loop-compra-completo.spec.ts` ejecuta: (1) busca un producto, (2) lo agrega al carrito, (3) hace checkout con datos válidos, (4) paga con simulado "DSM", (5) verifica que la orden aparece como "new" (o la página muestra confirmación). Todo sin transacción real.
  - Verify: `pnpm --filter @dsm/qa test:e2e -- --grep "loop-compra" --reporter=list` (exit 0)

- [ ] **QA-010-E2E-2**: Spec Playwright — el dueño ve la orden nueva y puede prepararla
  - Exit criterion: tras el loop de compra, el admin navega al panel de órdenes, ve la orden nueva, la marca como "preparing" → "ready" → "delivered".
  - Verify: `pnpm --filter @dsm/qa test:e2e -- --grep "preparar-orden" --reporter=list` (exit 0)

**Dependencia**: `Blocked-by: FE-US-008 + FE-US-009 + FE-US-012 (UI de checkout, pago y panel)`.

---

## 7. Datos y fixtures

### Seeds requeridos

- Pipeline completo: producto publicado con stock → carrito → checkout → orden pending_payment → pago pending.
- `seed-webhook.ts` (nuevo): crea el estado completo listo para recibir webhooks en los tests de acceptance.
- Usa el `MP_WEBHOOK_SECRET` de prueba (hardcodeado en test, no el real).

### Builders requeridos

- `buildWebhookPayload(overrides?)`: genera el body del webhook con `type: "payment"` y `data.id`.
- `signWebhook(payload, secret)`: firma el webhook con HMAC para los tests.
- `buildReconcileState()`: crea una orden con pago aprobado en MP pero sin webhook procesado.

---

## 8. Exploratory charters

Agregar a `qa/exploratory/charters.md`:

1. **Charter: Replay attack del webhook** — capturar un webhook válido y reenviarlo 5 minutos después; verificar que la ventana de `ts` lo rechaza.
2. **Charter: Race condition de stock** — con 10 órdenes sobre la última unidad de un producto, disparar 10 webhooks simultáneos; verificar stock final = 0 y exactamente 1 orden confirmada.
3. **Charter: Reembolso que falla permanentemente** — después de REFUND_MAX_ATTEMPTS (5), ¿qué pasa? Verificar que queda en `refund_pending` con alerta (no se pierde).
4. **Charter: Reconciliación con MP caído** — la reconciliación consulta MP; si MP no responde, ¿reintenta o aborta? Verificar que no confirma órdenes con datos viejos.

---

## 9. Quality gates

| Gate | Blocks | Trigger |
|---|---|---|
| Contract (webhook + admin jobs) | merge | todo PR que toque `src/payments/` o `src/orders/` |
| Acceptance BDD (API-level) | merge | todo PR del módulo |
| Concurrencia (test de stock negativo) | merge | todo PR que toque `stock.repository.ts` |
| k6 webhook throughput | release | pre-release |
| E2E loop completo (simulado) | uat promotion | post-deploy staging |

---

## 10. Anti-patterns evitados

- ❌ "Test de idempotencia que solo verifica el response code" — hay que verificar que el **stock** no cambió (el 200 es necesario pero insuficiente).
- ❌ "Test de concurrencia con sleep/timing" — usar `Promise.all` real contra el endpoint, no delays artificiales.
- ❌ "Testear contra el sandbox real de MP en CI" — el simulado + adaptador falso cubren; el sandbox es para verificación manual.
- ❌ "QA duplica el test de firma" — la verificación de firma (unit/pure function) es dev-owned; QA verifica el comportamiento end-to-end (firma inválida → 401 → nada se toca).

---

## 11. Preguntas abiertas

1. **OQ-QA-010-1**: ¿El test de concurrencia de stock (SC-010-N4) se ejecuta en CI o solo pre-release? Recomendación: en CI (es determinista con `Promise.all` contra Postgres local, tarda < 5s).
2. **OQ-QA-010-2**: ¿El loop E2E completo (QA-010-E2E-1) necesita que el admin confirme la orden (US-012), o basta verificar que el status pasó a "new"? Recomendación: verificar status "new" es suficiente para US-010; el panel se testea en QA-010-E2E-2 cuando US-012 exista.

---

## 12. Dependencias declaradas

| Dependencia | Estado | Efecto |
|---|---|---|
| US-008 backend (orders) | Draft | **BLOQUEA** toda la suite |
| US-009 backend (payments + simulado) | Draft | **BLOQUEA** toda la suite |
| FE-US-008 + FE-US-009 + FE-US-012 | No planificado | **BLOQUEA** E2E Playwright |
| US-005 (para que el loop incluya búsqueda) | In Progress | BLOQUEA QA-010-E2E-1 si se quiere buscar con IA; sin ella se puede buscar por categoría |

---

## 13. Standards consultados

- `docs/quality/testing-standards.md` §2, §5, §12, §13, §14.9 (negative space)
- `docs/quality/qa-backend-standards.md` §2.1, §9 (edge cases), §13 (performance), §21 (BDD)
- `docs/product/design-e2e.md` §12 (FSM), §17 (p95 < 500 ms escritura), §19 (7 capas, simulado load-bearing)
- ADR-0006 (simulado), ADR-0008 (decremento atómico)
