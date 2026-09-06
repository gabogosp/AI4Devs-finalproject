---
tracker-id: null
tracker-source: null
parent-us: US-013
discipline: backend
variant: null
language: es
audit-derived: false
archived: true
archived_at: 2026-09-06
merged_commit: e296d3f1f5d768466f2d699a4479d81917db7a53
pr-url: https://github.com/gabogosp/AI4Devs-finalproject/pull/66
---

# Proposal — Cancelación de orden + reembolso + reintegro de stock (backend)

> **Ticket**: US-013 — Cancelación de orden + reembolso + reintegro de stock
> **Author**: backend-node-developer agent
> **Date**: 2026-09-06
> **Status**: Proposed
> **Affected layers**: controller, service (orquestación cross-módulo), repositorio
> (extensiones aditivas a `orders`/`stock`/`payments`, sin migración), puerto de
> notificación (extensión), observabilidad
> **Affected platform**: `apps/api` (NestJS)

## Why

US-013 cierra el ciclo post-venta del PRD (capacidad 11, §2.1): hoy una orden
pagada (`new`/`preparing`/`ready`) que el comprador o el dueño necesitan anular
no tiene ningún camino — el stock queda decrementado "para siempre" (ADR-0008)
y el dinero cobrado no se devuelve. Este change agrega la única acción que
falta: **cancelar** una orden confirmada, **reintegrando** su stock y
**reembolsando** el pago (real vía MercadoPago, no-op para el medio simulado),
con aviso al comprador y trazabilidad de quién/cuándo/resultado.

No es un gap de producto pendiente de US-009: `MercadoPagoClient.refund` ya
existe y está en uso productivo desde `US-010-orden-webhook-stock-backend`
(reembolso automático por falta de stock) — este change reusa exactamente ese
método y el mismo vocabulario `refund_pending`/`POST /admin/payments/retry-refunds`,
sin inventar un segundo mecanismo. La verificación end-to-end 100% real contra
la cuenta de MercadoPago sigue limitada por la ausencia de credenciales
sandbox (mismo `@blocked` documentado que dejó `US-010-orden-webhook-stock-qa`,
QA-010-F1) — no bloqueante para este desarrollo, que se construye y verifica
igual que esa capacidad: con Postgres real y el cliente HTTP mockeado.

## What changes

- **Endpoint nuevo**: `POST /v1/admin/orders/{id}/cancel` (admin-only,
  `AdminGuard` reusado sin modificar). Sin body — igual que
  `POST /admin/orders/{orderId}/confirm-payment` (US-023), todo sale de la
  orden y del JWT.
- **Vive en `apps/api/src/payments/`, no en `apps/api/src/orders/`** — aunque
  la ruta comparte el prefijo `/v1/admin/orders` con `OrdersController` de la
  capacidad `ordenes` (CAP-5). Es el MISMO patrón ya usado por
  `PaymentConfirmationController` (`confirm-payment`/`pending-payment`, mismo
  prefijo, capacidad `pagos`): la lógica cruza `orders` + `stock` + `payments`
  en una sola transacción, y `payments → orders` es la única dirección
  acíclica ya establecida (D15 de `pagos/decisions.md`) — construirlo del lado
  de `orders/` crearía el ciclo `orders → payments → orders`. Ver `design.md`
  §Approach D1.
- **`CancelOrderService`** (nuevo, `payments/cancel-order.service.ts`):
  - Guard de FSM: sólo cancela desde `new`/`preparing`/`ready` (AC-1); rechaza
    `delivered` con 409 (AC-7); `pending_payment`/inexistente → 404 (fuera de
    alcance de esta acción, mismo criterio que `OrdersAdminService.get()`).
  - Reintegra stock (nuevo `StockRepository.incrementForOrder`) dentro de la
    MISMA transacción que la transición condicional
    `orders.status IN ('new','preparing','ready') → 'cancelled'`
    (`OrdersRepository.transitionToCancelledIfActive`, nuevo) — la idempotencia
    de AC-8 es **estructural** (mismo patrón que `transitionToCancelledIfPending`
    de US-010 y `updateStatusConditional` de US-012): un reintento sobre una
    orden ya `cancelled` no re-dispara el incremento, ni el reembolso, ni la
    notificación.
  - Reembolso: para el pago `approved` de la orden —
    `provider='mercadopago'` → marca `refund_pending` dentro de la transacción,
    llama a `MercadoPagoClient.refund()` **fuera** de la transacción (nunca una
    llamada externa dentro de un `$transaction` abierto) y cierra `refunded` si
    responde bien; si falla, la fila queda `refund_pending` — **elegible sin
    ningún cambio** por el job ya existente `POST /admin/payments/retry-refunds`
    (AC-3, durabilidad reusada, no reinventada). `provider='simulated_dsm'` →
    no-op externo, marca `refunded` directo (AC-5, literal del AC).
    `provider='manual'` → mismo no-op externo que `simulated_dsm` (decisión de
    este change, no un AC literal — ver `design.md` D3: no hay gateway que
    llamar para un pago recibido en efectivo/transferencia offline).
  - Traza AC-10 sin columnas nuevas: `order_status_history` (reusa
    `OrderStatusHistoryRepository` de `orders/`, ahora exportado) registra
    quién/cuándo; `payments.status` (`refunded`/`refund_pending`) registra el
    resultado del reembolso — ambos datos ya existen, ninguna migración.
  - Notifica al comprador vía `NotificationPort.orderCancelledByOwner`
    (método nuevo, mismo puerto de `orders/ports/`, extendido — no un puerto
    paralelo) tras el commit, best-effort (falla ⇒ log, nunca revierte). Sin
    entrega real: `LoggingNotificationAdapter` (log-only) — `Deferred: US-011`,
    mismo criterio que los otros 4 métodos del puerto.
- **Sin migración de Prisma.** `orders.status` ya admite `cancelled` en su
  `CHECK` (migración de US-008); `orders.cancelled_at` ya existe (US-010);
  `payments.status` ya admite `refund_pending`/`refunded` (US-010);
  `order_status_history.to_status` es texto plano sin `CHECK`. Ninguna
  columna ni tabla nueva.
- **Contrato**: draft de staging en
  `openspec/changes/US-013-cancelacion-reembolso-backend/contracts/openapi/cancel-order.yaml`
  (adoptado a la raíz viva `openspec/specs/pagos/contracts/openapi.yaml` en el
  próximo `/archive-change`) + actualización del publicado
  `apps/api/docs/api/openapi.yaml`.

**No toca**: `AdminGuard`, `HttpProblemFilter`, `order-state.ts`/FSM de
fulfillment de 4 estados, `UpdateOrderStatusDto` (sigue sin admitir
`cancelled`), `ConfirmOrderService`, `MercadoPagoClient` (se reusa tal cual,
sin cambiar su firma), `RefundRetryService`/`POST /admin/payments/retry-refunds`
(se reusa sin cambios — es la pieza que hace durable AC-3 cuando la llamada
real falla).

## AC de la US cubiertos por este change

| AC | Cubierto | Nota |
|---|---|---|
| AC-1 cancelar orden no entregada | ✅ | Guard `new/preparing/ready → cancelled`, `POST .../cancel` |
| AC-2 stock se reintegra | ✅ | `StockRepository.incrementForOrder`, misma tx que la transición |
| AC-3 reembolso real MercadoPago | ✅ | Reusa `MercadoPagoClient.refund` + `refund_pending`/`retry-refunds` ya construidos por US-010 |
| AC-4 aviso al comprador | ✅ (seam) | `NotificationPort.orderCancelledByOwner`; entrega real `Deferred: US-011` |
| AC-5 pago simulado — no-op | ✅ | `provider='simulated_dsm'` → `refunded` directo, sin llamada externa |
| AC-6 confirmación de dos pasos | Fuera de alcance (FE) | Ver Out of scope — change de frontend-web separado |
| AC-7 no cancela orden entregada | ✅ | `delivered` → 409 `dsm:payments/order-cannot-be-cancelled` |
| AC-8 reintegro idempotente | ✅ | Idempotencia estructural (guard `UPDATE ... WHERE status IN (...)`) — reintento no re-dispara nada |
| AC-9 sólo admin | ✅ | `AdminGuard` reusado sin modificar, barrido en `e2e-rbac.spec.ts` |
| AC-10 trazabilidad | ✅ | `order_status_history` (quién/cuándo) + `payments.status` (resultado) — sin columnas nuevas |

## Decisiones de este plan

### D1 — Por qué la lógica vive en `payments/` y no en `orders/`

Ver "What changes" arriba y `design.md` §Approach D1 para el detalle completo:
`payments/` ya importa `checkout` (`OrdersRepository`), `stock`
(`StockRepository`) y `orders` (`NOTIFICATION_PORT`) — todo lo que esta acción
necesita está disponible sin abrir un nuevo edge de módulo. Construirlo del
lado de `orders/` obligaría a `orders` a importar `payments`
(`PaymentsRepository`/`MercadoPagoClient`), lo que crea el ciclo
`orders → payments → orders` ya que `payments` importa `orders` desde
`US-010-orden-webhook-stock-backend` (D15, `NotificationPort`). Mismo
razonamiento que ya llevó a `PaymentConfirmationController`
(`confirm-payment`/`pending-payment`) a vivir en `payments/` compartiendo el
mismo prefijo de ruta `/v1/admin/orders` — precedente real, no hipotético.

**Consecuencia para el archive**: cuando este change se archive, el "Spec
delta" (`design.md`) actualiza `openspec/specs/pagos/` (dueño de la
implementación) Y dejará una nota cruzada en `openspec/specs/ordenes/`
(dueño conceptual del ciclo de vida de la orden) — mismo patrón que ya existe
para `pending-payment` en ambas capacidades.

### D2 — Ruta sin colisión, sin necesidad de restringir `:id` a forma UUID

`POST /v1/admin/orders/{id}/cancel` no colisiona con ninguna ruta existente:
es el único `POST` con ese shape de 3 segmentos bajo el prefijo compartido
(`OrdersController` de `ordenes` sólo registra `GET`/`PATCH` de 2 segmentos;
`PaymentConfirmationController` de `pagos` registra `pending-payment` sin
`:id` y `:orderId/confirm-payment` con otro sufijo). Alcanza con
`ParseUUIDPipe` en el parámetro — mismo criterio que
`PaymentConfirmationController` ya usa para su propio `:orderId`, sin el
regex de forma UUID que `OrdersController` sí necesita (ese caso sí competía
por el MISMO shape de 2 segmentos que `pending-payment`).

### D3 — Reembolso no-op para `provider='manual'` (decisión, no AC literal)

AC-5 sólo pide el no-op para el medio simulado «DSM». Un pago `manual`
(efectivo/transferencia confirmado por el dueño, US-023) tampoco tiene un
gateway que llamar — el reembolso físico ocurre fuera del sistema (el dueño
devuelve la plata a mano). Este change trata `manual` igual que
`simulated_dsm`: marca `payments.status='refunded'` sin ninguna llamada
externa, para que el ledger de `payments` quede consistente (AC-10) sin
inventar un tercer estado. Documentado para ratificación humana — no bloquea
el desarrollo (ver Open questions).

### D4 — Orden anonimizada + cancelación: validado, no bloqueante

`orders.anonymized_at` se puebla por antigüedad (`ORDER_RETENTION_MONTHS`,
default 12 meses) independientemente del estado de fulfillment. Una orden
`new`/`preparing`/`ready` anonimizada implicaría que quedó **12 meses** sin
avanzar ni cancelarse — un problema de higiene de datos ajeno a esta US, no
un caso que este change deba resolver. Si ocurre, `orderCancelledByOwner` se
invoca con el email placeholder (`datos-suprimidos@anonimizado.dsm.invalid`,
TLD `.invalid` no resoluble) — falla silenciosamente por diseño, igual que
documentó `order-anonymization.ts` para el mismo escenario. Sin cambios
necesarios.

## Out of scope

- **Confirmación de dos pasos (AC-6)** — es FE (US-012 ya construyó el
  panel; la acción de cancelar con el modal de confirmación destructiva
  es un change de frontend-web separado, per instrucción del orquestador).
  `Deferred: US-013-cancelacion-reembolso-frontend-web`.
- **Cancelación iniciada por el cliente** — fuera de v1 de la US (§4).
- **Reembolso parcial / por ítem** — fuera de v1 de la US (§4); se cancela
  la orden completa con reembolso total.
- **Entrega real del email de cancelación** — `Deferred: US-011 — owner: BE`
  (mismo seam que los otros 4 métodos de `NotificationPort`).
- **Verificación 100% real contra MercadoPago** (cuenta sandbox) — sigue
  limitada por la falta de credenciales, igual que documentó
  `US-010-orden-webhook-stock-qa` (QA-010-F1). No bloqueante: se construye y
  verifica con Postgres real + `MercadoPagoClient` mockeado, mismo patrón que
  `confirm-order.service.spec.ts`/`e2e-payments-mercadopago-happy.spec.ts`.
- **Disparo periódico de `retry-refunds`** — ya resuelto por US-010 (cron
  externo, fuera de `apps/api`); este change no lo toca.

## Open questions (para ratificación humana, no bloqueantes)

- **OQ-BE-1**: ¿el reembolso no-op de `provider='manual'` (D3) es el
  comportamiento correcto, o el PO prefiere que quede en un estado distinto
  (ej. un campo manual de "reembolso confirmado por el dueño" en vez de
  `refunded` automático)? Este plan asume que `refunded` automático es
  correcto porque el dueño ya ejecutó la cancelación deliberadamente — la
  plata offline se resuelve fuera del sistema, el ledger sólo necesita
  reflejar que ya no queda pendiente. Cambiar esto es una condición menos
  en `crearRefund`, sin impacto en el resto del diseño.
- **OQ-BE-2**: ¿la respuesta de `POST .../cancel` debería exponer el campo
  `refund` (nuevo, propio de este endpoint) directamente en
  `AdminOrderDetail`, o mantenerlo como un campo adicional sólo en esta
  respuesta (decisión de este plan, ver `design.md` §Approach D5)? Este plan
  NO extiende `AdminOrderDetail` (usado por `GET`/`PATCH` de `ordenes`) para
  no acoplar dos capacidades por un campo que sólo esta acción necesita.

## Standards consultados

| Standard | Secciones aplicadas |
|---|---|
| `base-standards.md` | §1 KISS/YAGNI (reusa `refund_pending`/`retry-refunds`/`NotificationPort` existentes, sin inventar mecanismos paralelos) |
| `backend-standards.md` | capas, errores tipados, transacciones, persistencia sin migración |
| `backend-node-standards.md` | §2 capas · §3 DI por token (`NOTIFICATION_PORT`) · §5 `$transaction` cruzando repositorios (patrón ya establecido por `ConfirmOrderService`) · §6 errores de dominio + RFC 7807 (filtro genérico, sin cambios) · §8 idempotencia estructural + resiliencia (llamada externa fuera de la tx) |
| `api-standards.md` | §8 RFC 7807 · §10 idempotencia (estructural, `Idempotency-Key` aceptado-e-ignorado, mismo criterio que `PATCH /admin/orders/{id}`) · §11 auth en OpenAPI |
| `security-standards.md` | §4 autorización server-side · §4.5 IDOR (UUID no enumerable) · §7 heredado de `AdminGuard`, sin cambios |
| `observability-standards.md` | §9 sin PII en logs/métricas (evento `payments.owner_cancelled` sólo con `orderId`) |
| `testing-standards.md` / `qa-backend-standards.md` | §14 pirámide — service-level contra Postgres real + HTTP-level delgado; QA cross-stack es un change separado |
| `data-architecture-patterns` (skill) | evaluación trivial — sin migración, sin invocar `data-architect` Mode B (ver `design.md` §Persistence) |
| `threat-modeling-lite` (skill) | STRIDE en `design.md` §Approach D6 |
| `api-contract-completeness` (skill) | draft `contracts/openapi/cancel-order.yaml` de este change, 1 archivo por endpoint |
| `openspec-workflow` (skill) | 3-file convention, Spec delta cross-capacidad (D1) |

## Dependencias

**Ninguna dependencia bloqueante de código.** US-010 y US-012 (bloqueantes
declaradas de la US) están ambas archivadas — `MercadoPagoClient.refund`,
`refund_pending`/`retry-refunds`, `NotificationPort`, `order_status_history`
y el `CHECK` de 6 estados de `orders.status` ya existen y se verificaron en
producción de test. Este plan se ejecuta hoy, sin gate en rojo.

**No bloqueante, informativa**: US-011 (entrega real de email) sigue
`Ready`, sin arrancar — el aviso de este change queda en el mismo seam
log-only que ya usan los otros 4 métodos de `NotificationPort`.

## Linear

MCP de Linear no conectado — proyecto local-only. No se crean sub-tasks en Linear.

## References

- User story: [`docs/user-stories/US-013-cancelacion-reembolso.md`](../../../docs/user-stories/US-013-cancelacion-reembolso.md)
- PRD: [`docs/product/prd.md`](../../../docs/product/prd.md) §2.1 capacidad 11
- E2E: [`docs/product/design-e2e.md`](../../../docs/product/design-e2e.md) §6, §12 (FSM), §14 (auth), §17 (NFR), §18 (observabilidad), §20 (ADR triggers)
- Capacidad `pagos` (CAP-4): [`openspec/specs/pagos/requirements.md`](../../specs/pagos/requirements.md), [`decisions.md`](../../specs/pagos/decisions.md), [`README.md`](../../specs/pagos/README.md)
- Capacidad `ordenes` (CAP-5): [`openspec/specs/ordenes/requirements.md`](../../specs/ordenes/requirements.md), [`decisions.md`](../../specs/ordenes/decisions.md)
- Capacidad `catalogo`: [`openspec/specs/catalogo/requirements.md`](../../specs/catalogo/requirements.md) (ADR-0008, stock única fuente de verdad)
- Changes relacionados: US-010 (`refund`/`refund_pending`/`retry-refunds`, precedente directo), US-012 (`order_status_history`, `NotificationPort`, `AdminGuard`), US-011 (entrega real de email, no arrancada), US-013-cancelacion-reembolso-frontend-web (confirmación de dos pasos, change separado)
