---
tracker-id: null
tracker-source: null
parent-us: US-010
discipline: qa
variant: null
language: es
archived: true
archived_at: 2026-09-06
merged_commit: ed9512a
pr-url: https://github.com/gabogosp/AI4Devs-finalproject/pull/57
---

# US-010 QA — Webhook de MercadoPago, medio simulado y decremento de stock

## Why

El backend de US-010 (archivado 2026-09-05, PR #49) es, por su propio `proposal.md`, "el
núcleo transaccional del producto — una falla acá es plata mal cobrada o stock
inconsistente" y "siete de los once AC son negative space" (duplicado, tardío, firma
inválida, stock insuficiente, reconciliación, limpieza, medio simulado). Ese change cerró
con una suite dev-owned excepcionalmente profunda: 5 specs de integración contra Postgres
real (`e2e-payments-mercadopago-happy`, `-insufficient-stock-auto`, `-webhook-duplicate`,
`-concurrency`, `-simulated-parity`), cada uno ejercitando la transacción real, no mocks de
repositorio (`tasks.md` Fase 14). **Nada de eso se repite acá.**

Lo que falta es exactamente lo que ese mismo `tasks.md` diefiere explícitamente a este
plan: *"Tests de carga y E2E cross-service con Playwright — `/plan-qa`."* Y hay una capa
adicional que tampoco existe todavía: una **suite de aceptación persistente** (BDD,
black-box, contra el proceso HTTP real) — los specs de Jest de Fase 14 son *dev-owned* y
*efímeros* por diseño (viven y mueren con la task que los originó); esta capacidad todavía
no tiene el contrato de comportamiento que sobrevive a la entrega, el que exige
`qa-three-layer-regression`. `US-023-pago-manual-offline-backend` (misma capacidad
`pagos`, camino manual) ya construyó ese contrato para su propia superficie
(`qa/acceptance/features/pago-manual.feature`, `qa/contract/pago-manual.contract.ts`,
`qa/performance/confirm-payment.js`) — este plan es su continuación natural para la
superficie automática (webhook + medio simulado + jobs admin) que US-010 agregó.

**Hallazgo que gobierna el diseño de este plan** (documentado en `design.md` §D-QA1,
no descubierto a mitad de ejecución como en otros planes hermanos): el propio
`design.md` archivado de US-010 es explícito en que el tráfico **real** contra
MercadoPago necesita cuenta y credenciales que este entorno no tiene — pero el PRD §2.1
(fila "Pagos") aclara que el proveedor **"soporta el modo sandbox/test de MercadoPago
para pruebas"**, así que el bloqueo es de credenciales, no de arquitectura. Mientras esa
cuenta sandbox no exista, la superficie que SÍ depende de una respuesta real de
MercadoPago (`getPayment`/`searchByExternalReference` con `status='rejected'`, o la
recuperación real de un webhook faltante) queda fuera del alcance ejecutable de este
plan — declarada `blocked`, nunca simulada con un doble no autorizado por el propio
`design.md`. Todo lo demás — que es, estructuralmente, la mayoría de los 11 AC, gracias a
que AC-9 garantiza que el medio simulado corre por el **mismo** `ConfirmOrderService.confirm()`
que el webhook real — es 100% ejecutable hoy, black-box, contra la API real + Postgres
real.

## What changes

Un change hermano `US-010-orden-webhook-stock-qa/` con el plan y su ejecución, en el
harness cross-stack que ya existe (`qa/`), **sin tocar código de producción**:

| Capa | Herramienta | Qué cubre |
|---|---|---|
| Aceptación BDD (Layer 1, backend-aislado) | Cucumber-js + Playwright `APIRequestContext` | Contrato de comportamiento persistente para AC-1, AC-2, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10 (mecánica), AC-11 — contra la API real + Postgres real, sin mockear la transacción |
| Contract testing | Script `tsx` (mismo patrón que `pago-manual.contract.ts`, sin jest) | Los 5 endpoints nuevos de esta US contra el OpenAPI vivo de `pagos` (`openspec/specs/pagos/contracts/`) |
| Carga (k6) | k6 | `POST /v1/checkout/simulate-payment` contra el presupuesto propuesto de `design.md` §D12 (p95 < 200ms) — el único endpoint de escritura de esta US alcanzable sin MercadoPago |
| E2E cross-stack (Layer 3) | Playwright | Loop completo checkout real → medio simulado → panel del dueño (cruza US-008 FE + US-010 BE + US-012 FE) |
| Exploratorio | Charters manuales | Ventana de tolerancia de la firma, batch de reconciliación, comportamiento del breaker durante `retry-refunds` |

**Lo que este plan NO hace** (ownership matrix, `qa-backend-standards.md` §2.1): no
escribe unit, component, integration ni e2e-nest — esas son TDD del dev en
`/develop-backend`, y en US-010 **ya están**, con 200/200 test suites verdes (`tasks.md`
T16.2). Se registran como nota de cobertura para que nadie las duplique.

## Out of scope

- **Tráfico real de producción contra MercadoPago** (webhook recibiendo notificaciones
  reales, reconciliación consultando un pago real) — necesita la cuenta
  sandbox/producción que hoy no existe en este entorno. `Deferred: cuenta sandbox de
  MercadoPago — owner: PO/Infra`, ver `design.md` §D-QA1.
- **La entrega real de los emails** (US-011) — AC-2 se verifica sobre el puerto
  (`NotificationPort`), no sobre una bandeja de entrada.
- **El reintegro de stock en cancelación a pedido del dueño** — US-013.
- **Accesibilidad / regresión visual** — este change es backend puro (webhook, jobs
  admin); las dos superficies FE que sí se tocan en el escenario cross-stack (checkout,
  panel del dueño) ya tienen su propia cobertura a11y en `US-008`/`US-012` QA, no se
  repite acá.

## Standards consultados

| Standard | Secciones aplicadas |
|---|---|
| `qa-backend-standards.md` | §2.1 ownership · §13 performance · §15 datos sintéticos · §21 BDD y Gherkin |
| `testing-standards.md` | §2 pirámide · §4.1 naming · §5 datos de test · §8 coverage · §14 patrones de código de test · §14.9 negative space · §18 anti-patterns |
| `api-standards.md` | §3, §8 RFC 7807 |
| `performance-standards.md` | §7 un test de carga necesita umbral numérico |
| `observability-standards.md` | §9 sin PII en logs/eventos |
| `security-standards.md` | §2 STRIDE (webhook, la fila más crítica del E2E §14) |

## Preguntas abiertas

| Id | Pregunta | Default implementado | Estado |
|---|---|---|---|
| OQ-QA-010-1 | ¿Cuándo se provisiona la cuenta sandbox de MercadoPago que desbloquea AC-3/AC-10(recuperación real)/AC-4(retry real)? | Se documenta el bloqueo y qué queda testeado por sustitución estructural (AC-9) mientras tanto | `[Deferred — owner: PO/Infra]` |
| OQ-QA-010-2 | ¿El escenario cross-stack (X1/X2) reusa `seedPendingPaymentOrder` de US-023 o necesita una variante propia que también dispare `simulate-payment`? | Se reusa el seed existente sin modificarlo (checkout real) y se agrega la llamada a `simulate-payment` como paso adicional del escenario, no como cambio al seed | `[Resolved]` |
| OQ-QA-010-3 | ¿`RECONCILE_MIN_AGE_MS` (5 min) y `ORDER_ABANDON_HOURS` (48h) se esperan en tiempo real o se backdatea `created_at`? | Se backdatea vía `@dsm/db` (Prisma), la misma excepción angosta ya documentada y precedida por `QA-023-CT-1`/`SC-023-A2` — sólo para alcanzar la precondición, nunca para sembrar el resto de la suite ni para afirmar el resultado | `[Resolved]` |

## Referencias

- User story: [`docs/user-stories/US-010-orden-webhook-stock.md`](../../../docs/user-stories/US-010-orden-webhook-stock.md)
- Change de backend (archivado): [`US-010-orden-webhook-stock-backend`](../archive/US-010-orden-webhook-stock-backend/design.md) — `proposal.md`, `design.md`, `tasks.md`
- Capacidad viva: [`openspec/specs/pagos/`](../../specs/pagos/) (README, requirements, decisions, contratos)
- PRD §2.1 fila "Pagos" (soporte de sandbox MercadoPago), E2E §9.2/§14/§17/§18.5
- Precedente estructural de este harness para la misma capacidad:
  [`US-023-pago-manual-offline-backend/qa-plan.md`](../archive/US-023-pago-manual-offline-backend/qa-plan.md)
  (Layer 1 embebido en el change de backend — este plan es su continuación como change
  hermano, no una repetición)
- Precedente de formato de change hermano de QA:
  [`US-014-registro-login-qa`](../US-014-registro-login-qa/proposal.md)
- ADR-0006 (webhook verificado + medio simulado), ADR-0008 (decremento al aprobar el pago)
- **Nota**: `openspec/changes/archive/US-010-orden-webhook-stock-backend/qa-plan.md` existe
  (fechado 2026-08-22, previo al regenerate del 2026-09-05) y **no se usó como insumo** —
  asume `SELECT ... FOR UPDATE` y un scheduler que el sistema real no tiene. Este plan se
  basa exclusivamente en el `design.md`/`proposal.md`/`tasks.md` archivados post-regenerate
  y en el código real de `apps/api/src/payments/`.
