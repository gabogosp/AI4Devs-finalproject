---
tracker-id: null
tracker-source: null
parent-us: US-010
discipline: backend
variant: null
language: es
---

# US-010 Backend — Webhook de MercadoPago, medio simulado y decremento atómico de stock

## Why

**Este plan reemplaza la versión del 2026-08-22** (respaldada en
`openspec/changes/_backups/2026-09-05-US-010-orden-webhook-stock-backend/`). La regeneración
no es cosmética: la versión anterior asumía crear `src/orders/` desde cero con una FSM de 6
estados, y dependía literalmente de que **US-009 (MercadoPago) estuviera construido**
(`MercadoPagoClient`, `PaymentConfirmationPort` con un adaptador no-op). Verificado leyendo
el código real, hoy:

- `src/orders/` **ya existe y está mergeado** (US-012) — con su propia FSM de 4 estados
  activos, que este change no toca.
- `US-009` sigue **`Blocked`** (sin credenciales de MercadoPago) y `MercadoPagoClient`
  **no existe** en el repo.
- `US-023-pago-manual-offline-backend` **está mergeado** y construyó exactamente el seam que
  esta US necesita: `PaymentConfirmationPort` con `ConfirmOrderService` implementándolo para
  `provider: 'manual'`, con un docstring que dice literalmente que **esta US amplía el mismo
  contrato** (`provider: 'mercadopago' | 'simulated_dsm'`) sin renombrar nada.
- La tabla `payments` **ya tiene** el `CHECK` de `provider` con los tres valores del dominio,
  anticipando este momento.

Mismo criterio que ya se aplicó al regenerate de `US-012-panel-ordenes-dueno-backend`
(2026-08-30): **una US bloqueada por credenciales externas no debe paralizar trabajo que sí
puede avanzar**. Este regenerate evalúa, pieza por pieza, qué de las 11 AC se puede construir
y **verificar hoy con mocks** (todo, salvo tráfico real en vivo) — no reescribe el objetivo de
la US, cambia el punto de partida y la forma de llegar.

**Lo que hace difícil esta US no cambió**: sigue siendo el núcleo transaccional del producto
— una falla acá es plata mal cobrada o stock inconsistente — y sigue siendo cierto que
**siete de los once AC son negative space** (duplicado, tardío, firma inválida, stock
insuficiente, reconciliación, limpieza, medio simulado).

## What changes

**Esquema** — tres adiciones acotadas, todas sobre tablas que ya existen (US-008, US-023):

- `orders` gana **`confirmed_at`** y **`cancelled_at`** (timestamptz, nullable). La FSM del
  E2E §12 tiene seis estados y hoy sólo `delivered_at` está modelada; sin estas dos no se
  puede reconstruir cuándo se confirmó una venta (insumo de US-016) ni distinguir un abandono
  de un auto-cancel por falta de stock.
- `payments.status` gana **`refund_pending`** en su `CHECK` (hoy
  `pending|approved|rejected|refunded`). Hace **durable** el reembolso de AC-4: si la llamada
  a MercadoPago falla, la fila queda para un reintento en vez de perderse en memoria.

**Superficie HTTP** — cinco endpoints, dos públicos y tres admin:

| Endpoint | Qué hace | AC |
|---|---|---|
| `POST /v1/webhooks/mercadopago` | Verifica la firma, **re-consulta el pago a MercadoPago** y, si está aprobado, confirma la orden y decrementa stock. Idempotente. Siempre 200 salvo firma inválida. | AC-1, AC-3, AC-5, AC-6, AC-7, AC-8 |
| `POST /v1/checkout/simulate-payment` | El medio simulado "DSM" de ADR-0006 (`POST /checkout/simulate`) — salta MercadoPago, autorizado por el `order_token` de la orden, gateado por `PAYMENTS_SIMULATED_ENABLED` (falla el arranque si está prendido en producción). Dispara el mismo camino que el webhook. | AC-9 |
| `POST /v1/admin/payments/reconcile` | Consulta a MercadoPago las órdenes `pending_payment` vencidas y las procesa por el mismo `ConfirmOrderService`. | AC-10 |
| `POST /v1/admin/orders/cleanup-abandoned` | Cancela `pending_payment` más viejas que `ORDER_ABANDON_HOURS`. | AC-11 |
| `POST /v1/admin/payments/retry-refunds` | Reintenta los reembolsos que quedaron `refund_pending` tras un fallo transitorio. | AC-4 (durabilidad) |

**Un solo camino de confirmación, ampliado — no uno nuevo** (AC-9 estructural): se amplía
`ConfirmOrderService.confirm()` (US-023) con una unión discriminada en `ConfirmPaymentInput`
(`provider: 'manual' | 'mercadopago' | 'simulated_dsm'`). La rama `manual` queda **exactamente
igual** — este change no le cambia una línea, y sus tests de US-023 siguen verdes sin
tocarse. La rama nueva reusa **tal cual** `orders.transitionToNewIfPending` y
`stock.decrementForOrder`, y agrega la creación del pago + la compensación de AC-4.

**Confianza cero en el payload del webhook** (AC-7): firma `x-signature` verificada con HMAC
en tiempo constante + ventana de tolerancia sobre `ts`, y después **re-consulta a la API de
MP** — la verdad del pago sale de esa consulta, nunca del cuerpo recibido.

**Idempotencia por el guard de la orden, no por un lock explícito** (AC-5, AC-6): el mismo
`UPDATE … WHERE status='pending_payment'` que US-023 ya construyó y probó sirve tal cual bajo
concurrencia — Postgres serializa dos transacciones sobre la misma fila, y la segunda
encuentra cero filas afectadas quedando en un no-op idempotente (200). No se reintroduce el
`SELECT … FOR UPDATE` que proponía la versión anterior: es una segunda forma de lograr lo
mismo que el guard ya logra.

**Compensación: cobrado y no se puede cumplir** (AC-4). Sólo para `mercadopago`/
`simulated_dsm` (el manual no cambia): la transacción del decremento revierte, una segunda
transacción cancela la orden y registra el pago como `refund_pending`, y el reembolso corre
**fuera** de toda transacción. Si falla, la fila queda `refund_pending` para siempre —
`RefundRetryService` la reintenta a pedido; nunca se pierde un reembolso por un error
transitorio.

**`MercadoPagoClient` se construye en este change, con alcance mínimo** (`getPayment`,
`searchByExternalReference`, `refund`) — **no** `createPreference`, que sigue siendo de
US-009. La dependencia entre las dos US se **invierte** respecto al plan original: antes
"US-009 construye el cliente, US-010 lo extiende"; ahora "US-010 construye el cliente
mínimo, US-009 lo extiende cuando existan credenciales".

**Sin scheduler nuevo** (AC-10, AC-11): verificado que no hay `setInterval` ni
`@nestjs/schedule` en ningún lado del repo — el patrón real (`import-runner.ts`,
`enrichment.runner.ts`) es evento + endpoint admin a pedido. Este change sigue ese patrón,
no el de "runner cada 15 min" de la versión anterior.

**Notificaciones** (AC-2): se **reusa** el `NotificationPort` que US-012 ya construyó en
`src/orders/`, ampliado con 3 métodos (`orderConfirmed`, `orderCancelledNoStock`,
`ownerNewOrder`) en vez de crear un puerto paralelo — evita que US-011 tenga que implementar
dos puertos para el mismo concepto.

## Qué se puede construir y verificar HOY vs qué necesita la cuenta real de MercadoPago

| Pieza | Hoy, con mocks | Necesita cuenta MP real |
|---|---|---|
| Verificación de firma, `MercadoPagoClient` (transporte/timeout/retry), `ConfirmOrderService` ampliado, idempotencia, concurrencia, compensación AC-4, reconciliación, limpieza | ✅ — unit + integration tests con Postgres real (Testcontainers) y el cliente HTTP mockeado en el DI | — |
| `POST /v1/checkout/simulate-payment` (AC-9, real, no sólo estructural) | ✅ — no llama a MercadoPago nunca | — |
| Tráfico real de producción en `POST /v1/webhooks/mercadopago` | — | ✅ cuenta MP + `MP_ACCESS_TOKEN`/`MP_WEBHOOK_SECRET` reales + webhook configurado en el dashboard |
| `POST /v1/payments` (crear preferencia, redirigir al comprador) | — | Sigue siendo US-009 |

Ver `design.md` §D6 para el detalle completo.

## ACs de US-010 cubiertos

| AC | Cubierto | Nota |
|---|---|---|
| AC-1 pago aprobado confirma y decrementa | ✅ | reusa la transacción de US-023, rama nueva para el pago |
| AC-2 dispara notificaciones | ✅ (seam) | reusa `NotificationPort` de US-012, ampliado. `Deferred: US-011` (entrega real) |
| AC-3 pago rechazado no confirma ni toca stock | ✅ | `getPayment` devuelve `!= approved` → no-op, 200 |
| AC-4 aprobado sin stock → reembolso | ✅ | rollback → `cancelled` → `refund_pending` → reembolso con reintento durable vía endpoint admin |
| AC-5 duplicado no decrementa dos veces | ✅ | guard de `orders` (US-023) + `idempotency_key` como segunda red |
| AC-6 tardío o fuera de orden | ✅ | el estado final depende del pago re-consultado, no del orden de llegada |
| AC-7 webhook no verificado se rechaza | ✅ | firma en tiempo constante + ventana de `ts` + re-consulta; 401 sin tocar nada |
| AC-8 el stock nunca queda negativo | ✅ | `stock.decrementForOrder` (US-023), sin cambios, probado con concurrencia real |
| AC-9 el simulado pasa por el mismo camino | ✅ **real, no sólo estructural** | `POST /v1/checkout/simulate-payment` ejercita el mismo `confirm()` por HTTP, hoy, sin MercadoPago |
| AC-10 reconciliación del webhook faltante | ✅ | endpoint admin + `searchByExternalReference` + el mismo `ConfirmOrderService` |
| AC-11 limpieza de abandonadas | ✅ | endpoint admin, `updateMany` guardado por antigüedad |

## Out of scope

- **La entrega real de los emails** — US-011. Acá se invoca el puerto. `Deferred: US-011 —
  owner: BE`
- **El panel de órdenes del dueño** — US-012, ya construido; este change no lo modifica.
- **Cancelación a pedido del dueño con reintegro de stock** — US-013. Este change construye
  la capacidad de reembolso (la necesita AC-4) y US-013 la reusa; lo que no construye es el
  reintegro de stock (sólo aplica a una orden ya confirmada, E2E §9.5). `Deferred: US-013 —
  owner: BE`
- **`MercadoPagoClient.createPreference` y la redirección a Checkout Pro** — sigue siendo
  US-009, cuando existan credenciales. `Deferred: US-009 — owner: BE/INFRA`
- **Tráfico real de producción contra MercadoPago** — requiere la cuenta real; ver tabla de
  arriba y `design.md` §D6/"Deployment considerations".
- **Un scheduler in-process real** (cron cada N minutos) — se recomienda un disparador de
  infraestructura (Railway Cron / GitHub Actions) contra los 3 endpoints admin; no se agrega
  `@nestjs/schedule` (ADR-0012/0014, cuarta instancia del mismo desvío).
- **Métricas y gráficos** — US-016 (este change deja `confirmed_at`, su insumo).
- **Anonimización por retención** — US-021.
- **Tests de carga y E2E cross-service con Playwright** — `/plan-qa`. Sí van acá los tests de
  concurrencia y de idempotencia con Postgres real, que son dev-owned.

## Standards consultados

| Standard | Secciones aplicadas |
|---|---|
| `base-standards.md` | §1 KISS (sin scheduler nuevo, sin `SELECT … FOR UPDATE` redundante) |
| `backend-standards.md` | capas, errores tipados, transacciones, resiliencia |
| `backend-node-standards.md` | §2 capas · §3 DI por token · §4 DTO · §5 `$transaction` + migración aditiva · §6 errores de dominio · §7 config fail-fast + secretos · §8 timeouts/reintentos/breaker en salientes + idempotencia · §9 logs sin PII |
| `api-standards.md` | §3.2 status codes · §10 idempotencia · §8 RFC 7807 · webhooks |
| `security-standards.md` | §2 STRIDE (la fila del webhook es la más crítica del E2E §14) · §5 secretos · §6 validación · §7.1 headers |
| `observability-standards.md` | §9 sin PII |
| `testing-standards.md` / `qa-backend-standards.md` | §14 pirámide; tests de concurrencia con Postgres real |
| **ADR-0008** | decremento al aprobar el pago — gobierna todo el change |
| **ADR-0006** | webhook verificado + medio simulado — nombra literal el endpoint que este change implementa |
| ADR-0012 / ADR-0014 | ausencia de scheduler/Redis mientras no estén aprovisionados |

## Decisiones de este regenerate (para quien retome)

1. **Se desacopla de US-009**: este change no depende de que exista `MercadoPagoClient` ni
   de que US-009 se desbloquee. Construye el cliente mínimo que necesita y lo deja listo
   para que US-009 lo extienda con `createPreference`.
2. **Se ubica en `src/payments/`**, ampliando lo que US-023 ya construyó — no un módulo
   nuevo, no un servicio hermano de `ConfirmOrderService`.
3. **AC-4 vive dentro de `ConfirmOrderService.confirm()`** como una rama que sólo corre para
   proveedores automáticos — el manual no cambia.
4. **Reconciliación y limpieza son endpoints admin, sin scheduler** — el patrón real del
   repo, no el "runner cada 15 min" del plan anterior.
5. **Se reusa `NotificationPort` de `orders/`** en vez de crear uno paralelo.
6. **`POST /v1/checkout/simulate-payment` se construye en este change** (no en US-009) —
   ADR-0006 lo nombra literal y no depende de MercadoPago.

## References

- User story: [`docs/user-stories/US-010-orden-webhook-stock.md`](../../../docs/user-stories/US-010-orden-webhook-stock.md)
- PRD: [`docs/product/prd.md`](../../../docs/product/prd.md) §2.1 capacidad 6
- E2E: [`docs/product/design-e2e.md`](../../../docs/product/design-e2e.md) §8, §9.2, §9.5,
  §12, §14, §17, §18, §18.5, §22
- **ADR-0008**, **ADR-0006**, ADR-0012, ADR-0014
- Changes cuyo código real se reusa:
  [`US-023-pago-manual-offline-backend`](../US-023-pago-manual-offline-backend/design.md),
  [`US-012-panel-ordenes-dueno-backend`](../US-012-panel-ordenes-dueno-backend/design.md),
  [`US-008-checkout-guest-backend`](../archive/US-008-checkout-guest-backend/design.md) (archivado)
- Versión anterior (insumo, no verdad):
  [`_backups/2026-09-05-US-010-orden-webhook-stock-backend/`](../_backups/2026-09-05-US-010-orden-webhook-stock-backend/)
- Contratos draft: [`contracts/openapi/`](contracts/openapi/)
- Ver `design.md` para el detalle de diseño, el threat model y el trade-off analysis completo.
