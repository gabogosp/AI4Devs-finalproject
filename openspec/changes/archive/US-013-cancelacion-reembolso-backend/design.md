---
parent-us: US-013
discipline: backend
variant: null
language: es
---

# US-013 Backend — Design

## Context

Leído antes de diseñar (per instrucción del orquestador):

- `openspec/specs/pagos/` (CAP-4): `MercadoPagoClient` (`getPayment`/
  `searchByExternalReference`/`refund`), `PaymentsRepository`
  (`createManualPayment`/`createApprovedPayment`/`createRefundPendingPayment`/
  `markRefunded`/`listRefundPending`), `ConfirmOrderService` (transacción
  cruzando `orders`+`stock`+`payments`), `RefundRetryService` +
  `POST /admin/payments/retry-refunds` (reintento durable de reembolsos
  `refund_pending`, sólo `provider='mercadopago'`).
- `openspec/specs/ordenes/` (CAP-5): `OrdersController`/`OrdersAdminService`
  (FSM propia de 4 estados activos, `order-state.ts`, `pending_payment`/
  `cancelled` explícitamente fuera de su alcance), `OrderStatusHistoryRepository`
  (único punto de ORM de `order_status_history`, NO exportado hoy fuera de
  `OrdersModule`), `NotificationPort`/`LoggingNotificationAdapter` (4 métodos:
  `orderReadyForPickup`, `orderConfirmed`, `ownerNewOrder`,
  `orderCancelledNoStock` — este último ya cubre la cancelación AUTOMÁTICA por
  falta de stock, US-010; **no** la cancelación manual del dueño que pide esta
  US).
- `openspec/specs/catalogo/` (ADR-0008): el stock se descuenta al aprobar el
  pago, sin reserva con TTL — `StockRepository` es el único escritor de
  `products.stock`, hoy sólo con `decrementForOrder` (sin inverso).
- Schema real (`packages/db/prisma/schema.prisma` + migraciones ya aplicadas):
  - `orders.status` — `CHECK` ya declara los 6 valores completos
    (`pending_payment, new, preparing, ready, delivered, cancelled` —
    migración `20260829172227_add_orders`). `cancelled_at` ya existe
    (`20260905201343_add_order_confirmed_cancelled_at`, US-010).
  - `payments.status` — `CHECK` ya admite `pending, approved, rejected,
    refunded, refund_pending` (migración `20260830143351_add_payments` +
    `20260905201343_...`, US-010). `payments.provider` ya admite `mercadopago,
    simulated_dsm, manual`.
  - `order_status_history.to_status`/`from_status` son `text` planos, **sin**
    `CHECK` (migración `20260830180000_add_order_status_history`) — cualquier
    string, incluido `'cancelled'`, es válido para el schema.
  - **Ninguna columna ni tabla nueva hace falta.** Confirmado leyendo las
    migraciones ya aplicadas, no asumido.
- `apps/api/src/orders/order-state.ts` declara explícitamente en su propio
  comentario: "`* → cancelled` es de US-013" — la FSM de fulfillment de 4
  estados nunca gestiona esta transición; este change no la toca.

## Goals

- Cancelar una orden pagada no entregada, reintegrando su stock y
  reembolsando el pago, con aviso al comprador y trazabilidad completa
  (los 10 AC de la US).
- Reusar el vocabulario y los mecanismos que `US-010-orden-webhook-stock-backend`
  ya construyó y verificó para el reembolso (`refund_pending` + `retry-refunds`)
  — no inventar un segundo camino de reembolso.
- Cero migración de schema — toda la superficie de datos necesaria ya existe.
- Preservar la dirección acíclica de módulos `payments → orders`/`checkout`/
  `stock` ya establecida (D15 de `pagos/decisions.md`) — no introducir
  `orders → payments`.

## Non-goals

- Confirmación de dos pasos (AC-6) — FE, change separado.
- Cancelación iniciada por el cliente, reembolso parcial/por ítem, RMA físico
  — fuera de v1 de la US (§4 de la US).
- Entrega real del email de cancelación — US-011 (seam, no adaptador real).
- Tocar `order-state.ts`/`UpdateOrderStatusDto`/`OrdersController` de la
  capacidad `ordenes` — la FSM de fulfillment de 4 estados queda intacta;
  `cancelled` sigue sin ser un valor de tipo válido en el `PATCH` existente.
- Modificar `MercadoPagoClient`, `RefundRetryService` o el job
  `POST /admin/payments/retry-refunds` — se reusan tal cual.

## Approach

### D1 — Superficie: nuevo controller/servicio dentro de `apps/api/src/payments/`

```
apps/api/src/payments/
├─ cancel-order.service.ts              ← NUEVO — orquesta orders+stock+payments+notif
├─ cancel-order.controller.ts           ← NUEVO — POST /v1/admin/orders/{id}/cancel
├─ dto/
│  └─ cancel-order-response.dto.ts      ← NUEVO
├─ payment-confirmation-errors.ts       ← EXTENDIDO: +OrderCannotBeCancelledError
├─ payments.repository.ts               ← EXTENDIDO: +findApprovedByOrderId,
│                                          +findLatestByOrderId,
│                                          +markApprovedAsRefundPending,
│                                          +markApprovedAsRefunded
└─ payments.module.ts                   ← EXTENDIDO: +providers, +controllers

apps/api/src/stock/stock.repository.ts       ← EXTENDIDO: +incrementForOrder
apps/api/src/checkout/orders.repository.ts   ← EXTENDIDO: +transitionToCancelledIfActive
apps/api/src/orders/orders.module.ts         ← EXTENDIDO: +exports OrderStatusHistoryRepository
apps/api/src/orders/ports/notification.port.ts          ← EXTENDIDO: +orderCancelledByOwner
apps/api/src/orders/ports/logging-notification.adapter.ts ← EXTENDIDO: implementa el método nuevo
apps/api/src/observability/payments-events.service.ts   ← EXTENDIDO: +emitOwnerCancelled,
                                                             +reason 'already-delivered'
```

**Por qué NO vive en `apps/api/src/orders/`** (mismo shape de ruta,
`/v1/admin/orders/{id}/...`, capacidad conceptual `ordenes`): la acción
necesita `StockRepository` (de `stock/`) y `PaymentsRepository`/
`MercadoPagoClient` (de `payments/`) en la MISMA transacción que la
transición de estado. `PaymentsModule` ya importa `CheckoutModule` (por
`OrdersRepository`), `StockModule` y `OrdersModule` (por `NOTIFICATION_PORT`,
desde US-010 T8.2) — construir esto del lado de `payments/` no abre ningún
edge de módulo nuevo. La alternativa (construirlo en `orders/`) obligaría a
`OrdersModule` a importar `PaymentsModule`, lo que crea el ciclo
`orders → payments → orders` (`payments` ya importa `orders` desde US-010).
Es exactamente el mismo razonamiento — y el mismo precedente real, no
hipotético — que ya llevó a `PaymentConfirmationController`
(`confirm-payment`/`pending-payment`) a vivir en `payments/` compartiendo el
prefijo `/v1/admin/orders` con `OrdersController` de `orders/`.

**Colisión de rutas — no aplica una restricción de forma UUID esta vez**: a
diferencia de `OrdersController` (que sí restringe `:id` a forma UUID porque
compite por el MISMO shape de 2 segmentos que el literal `pending-payment`),
`POST /v1/admin/orders/{id}/cancel` tiene 3 segmentos y método `POST` — no
hay ninguna ruta existente con ese shape. `ParseUUIDPipe` alcanza (mismo
criterio que `PaymentConfirmationController.confirmPayment`'s `:orderId`).

### D2 — Persistencia: ninguna migración

Evaluación per `data-architecture-patterns`: el workload es 100% relacional
sobre tablas ya existentes (`orders`, `payments`, `order_status_history`,
`products`), con `CHECK`s que YA admiten los valores que este change escribe.
No hay dato nuevo que modelar, ni tabla, ni columna, ni índice — **caso
trivial, no se invoca `data-architect` Mode B**. Precedente citado por el
orquestador (US-016/US-021) es para migraciones aditivas pequeñas; este
change es un escalón más trivial todavía: cero migración.

Confirmado leyendo las 3 migraciones relevantes ya aplicadas:
`20260829172227_add_orders` (`orders_status_check` ya con los 6 valores),
`20260830143351_add_payments` + `20260905201343_add_order_confirmed_cancelled_at`
(`payments_status_check` ya con `refund_pending`), y
`20260830180000_add_order_status_history` (`to_status text NOT NULL`, sin
`CHECK`).

### D3 — Algoritmo de `CancelOrderService.cancel(orderId, changedBy)`

```ts
async cancel(orderId: string, changedBy: string): Promise<CancelOrderResult> {
  const actual = await this.orders.findById(orderId);
  if (!actual || actual.status === 'pending_payment') {
    throw new OrderNotFoundError();               // fuera de alcance de esta acción
  }
  if (actual.status === 'delivered') {
    this.events.emitRejected(orderId, 'already-delivered');
    throw new OrderCannotBeCancelledError(actual.status);   // AC-7, 409
  }

  if (actual.status !== 'cancelled') {
    const cancelada = await this.prisma.$transaction(async (tx) => {
      const c = await this.orders.transitionToCancelledIfActive(orderId, tx);
      if (!c) return null;                        // carrera: alguien ganó entremedio

      await this.stock.incrementForOrder(
        c.items.map((i) => ({ productId: i.product_id, quantity: i.quantity })),
        tx,
      );
      await this.history.insert(
        { orderId, fromStatus: actual.status, toStatus: 'cancelled', changedBy },
        tx,
      );

      const pago = await this.payments.findApprovedByOrderId(orderId, tx);
      if (pago?.provider === 'mercadopago') {
        await this.payments.markApprovedAsRefundPending(pago.id, tx);
      } else if (pago) {
        // 'simulated_dsm' (AC-5) y 'manual' (D3 de proposal.md) — mismo no-op externo.
        await this.payments.markApprovedAsRefunded(pago.id, tx);
      }
      return c;
    });

    if (!cancelada) {
      const ahora = await this.orders.findById(orderId);
      if (ahora?.status !== 'cancelled') {
        throw new OrderCannotBeCancelledError(ahora?.status ?? 'desconocido');
      }
      // ya está cancelada (otra llamada ganó la carrera) — cae al camino idempotente abajo.
    } else {
      // FUERA de la transacción: la llamada externa real, nunca dentro de un $transaction.
      const pago = await this.payments.findLatestByOrderId(orderId);
      if (pago?.status === 'refund_pending' && pago.provider === 'mercadopago') {
        try {
          await this.mercadoPago.refund(pago.external_id!, pago.amount_ars_cents);
          await this.payments.markRefunded(pago.id);      // reusa el método de US-010
        } catch {
          this.events.emitRefundFailed(orderId, pago.id); // reusa el evento de US-010
          // Fila queda refund_pending — POST /admin/payments/retry-refunds la recoge
          // sin ningún cambio (listRefundPending ya filtra por status+provider, no por
          // "quién" la puso en refund_pending).
        }
      }
      this.events.emitOwnerCancelled(orderId);
      try {
        await this.notifications.orderCancelledByOwner({
          orderId: cancelada.id,
          orderNumber: cancelada.order_number,
          buyerName: cancelada.buyer_name,
          buyerEmail: cancelada.buyer_email,
        });
      } catch (error) {
        this.logger.error(`NotificationPort falló tras cancelar ${orderId}: ${(error as Error).message}`);
      }
    }
  }

  // Camino idempotente (AC-8) y camino feliz convergen acá: reporta el estado PERSISTIDO.
  const orden = (await this.orders.findById(orderId)) as OrderWithItems;
  const historial = await this.history.listByOrderId(orderId);
  const pagoFinal = await this.payments.findLatestByOrderId(orderId);
  return {
    order: orden,
    history: historial,
    refund: pagoFinal
      ? { status: pagoFinal.status as 'refunded' | 'refund_pending', provider: pagoFinal.provider as 'mercadopago' | 'simulated_dsm' | 'manual' }
      : { status: 'not_applicable', provider: null },
  };
}
```

**Por qué reportar el refund re-consultando la DB al final, en vez de
encadenar el resultado a través de la transacción**: el camino idempotente
(orden ya `cancelled`) y el camino feliz (recién cancelada) necesitan el
MISMO shape de respuesta. Re-consultar el estado persistido en un solo punto
evita duplicar la lógica de construcción de la respuesta en dos ramas —
además es la fuente de verdad real después de que la llamada externa a
MercadoPago (fuera de la tx) haya podido cambiar `refund_pending → refunded`.

**Idempotencia (AC-8), en dos capas**:
1. **Orden**: `transitionToCancelledIfActive` es un `UPDATE ... WHERE status
   IN ('new','preparing','ready')` — un reintento sobre una orden ya
   `cancelled` afecta 0 filas, la rama `if (actual.status !== 'cancelled')`
   ni siquiera abre la transacción de nuevo.
2. **Pago**: `markApprovedAsRefundPending`/`markApprovedAsRefunded` son
   `UPDATE ... WHERE status='approved'` — defensa en profundidad, redundante
   con la capa 1 pero gratis (mismo patrón que `markRefunded` de US-010).

**Nunca se re-dispara la notificación ni el intento de reembolso en un
reintento** — ambos viven exclusivamente en la rama `else` (transición real
aplicada esta vez), igual que `OrdersAdminService.changeStatus` sólo notifica
cuando `transitioned: true`.

### D4 — Reembolso: reuso literal de `refund_pending` + `retry-refunds` (US-010)

Sin cambios a `RefundRetryService`/`PaymentsRepository.listRefundPending`
(que ya filtra `status='refund_pending' AND provider='mercadopago'`, más
viejas primero). Una fila que este change deja `refund_pending` por un fallo
transitorio de MercadoPago es indistinguible — a propósito — de una que
`ConfirmOrderService.compensarSinStock` dejó `refund_pending` por la
auto-cancelación de US-010: el job de reintento no necesita saber POR QUÉ una
fila quedó pendiente, sólo que lo está. Cero líneas nuevas en ese archivo.

### D5 — Contrato HTTP

```yaml
POST /v1/admin/orders/{id}/cancel
  # Sin body — todo sale de la orden (líneas para reintegro, provider/monto
  # del pago) y del JWT admin (quién cancela), nunca de un campo que el
  # cliente pudiera falsificar (mismo criterio que confirm-payment).
  headers:
    Idempotency-Key?: string   # aceptado y IGNORADO — idempotencia estructural (D3),
                                 mismo criterio que PATCH /admin/orders/{id} (US-012 D4/D5)
  200:
    CancelOrderResponse: AdminOrderDetail (reusa el shape de `ordenes`, NO su
      clase — self-contained en el schema de esta capacidad, ver D6) +
      refund: { status: refunded|refund_pending|not_applicable,
                provider: mercadopago|simulated_dsm|manual|null }
  401/403: Problem (AdminGuard)
  404: Problem (dsm:payments/order-not-found — inexistente o pending_payment)
  409: Problem (dsm:payments/order-cannot-be-cancelled — delivered, o carrera
       que no resolvió a cancelled)
```

**Status code de "no cancelable" — 409, no 422.** Mismo razonamiento que
`OrderInvalidTransitionError` (`ordenes`) y `OrderNotPendingPaymentError`
(`pagos`): RFC 7231 §6.5.8, "la solicitud entra en conflicto con el estado
actual del recurso" — exactamente cancelar una orden ya entregada.

### D6 — Por qué el response schema es self-contained, no un `$ref` cruzado a `ordenes`

`CancelOrderResponse` (en el `openapi.yaml` de `pagos`) declara sus propios
campos (mismo shape que `AdminOrderDetail` de `ordenes` + `refund`) en vez de
un `$ref` cruzado (`../../ordenes/contracts/openapi.yaml#/components/schemas/AdminOrderDetail`).
Precedente: `pagos/contracts/openapi.yaml` ya declara su propio
`PaymentConfirmed` en vez de reusar nada de `ordenes` — cada capacidad
mantiene sus propios schemas de respuesta aunque el shape se superponga
parcialmente, evitando acoplar dos raíces vivas por un `$ref`. Duplicación
pequeña y deliberada (mismo criterio que D13 de `pagos/decisions.md`,
`backoff.ts` duplicado en vez de importado).

En el código TypeScript (`cancel-order-response.dto.ts`), en cambio, SÍ se
reusa `AdminOrderDetailDto.fromWithHistory` de `orders/dto/order.dto.ts` por
composición (no herencia) — es una clase plana sin DI, importable desde
cualquier módulo sin abrir un edge nuevo:

```ts
import { AdminOrderDetailDto } from '../orders/dto/order.dto';

export interface RefundInfo {
  status: 'refunded' | 'refund_pending' | 'not_applicable';
  provider: 'mercadopago' | 'simulated_dsm' | 'manual' | null;
}

export class CancelOrderResponseDto {
  static from(
    order: OrderWithItems,
    history: OrderStatusHistory[],
    refund: RefundInfo,
  ): AdminOrderDetailDto & { refund: RefundInfo } {
    return { ...AdminOrderDetailDto.fromWithHistory(order, history), refund };
  }
}
```

### D7 — Threat model (STRIDE lite — `threat-modeling-lite`, superficie "POST admin sin body")

| Amenaza | Vector específico | Control |
|---|---|---|
| **Elevation of privilege** | acceder sin rol admin | `AdminGuard` (reusado, sin modificar); barrido agregado a `e2e-rbac.spec.ts` |
| **Tampering** | el cliente intenta indicar qué reembolsar/reintegrar | Sin body — todo se deriva server-side de la orden y del pago `approved` encontrado; `changedBy` sale del JWT (`sub`), nunca de un campo del request |
| **IDOR** | cancelar una orden ajena por id adivinado | `id` UUID no enumerable; superficie ya admin-only, mismo criterio que `ordenes`/`pagos` |
| **Repudiation** | "yo no cancelé esa orden" / "nunca me reembolsaron" | `order_status_history.changed_by` (quién/cuándo) + `payments.status` (resultado del reembolso) — ambos persistidos, consultables por `GET /admin/orders/{id}` (`ordenes`) |
| **Information disclosure** | el payload de `orderCancelledByOwner` lleva email/nombre del comprador al log | Va al **puerto**, nunca al log (mismo criterio que los otros 4 métodos); el evento `payments.owner_cancelled` sólo lleva `orderId` |
| **DoS** | flood de `POST .../cancel` sobre una orden | Volumen real ~100 órdenes/mes, un solo operador — sin rate-limit dedicado (mismo criterio que `PaymentConfirmationController`/`ProductsController`) |

### D8 — NFRs

- **Escritura** (`POST .../cancel`, camino feliz): p95 < 800ms `[propuesto —
  confirma Ops]` — dominado por la llamada real a MercadoPago cuando
  `provider='mercadopago'` (timeout `MP_HTTP_TIMEOUT_MS`, default 4000ms,
  igual que el webhook de US-010); sin llamada externa para
  `simulated_dsm`/`manual`, p95 < 200ms en ese caso.
- **Escritura** (camino idempotente, orden ya `cancelled`): p95 < 100ms — sólo
  lecturas, ninguna transacción ni llamada externa.
- **Volumetría**: ~100 órdenes/mes (E2E §17); cancelaciones son una fracción
  de ese volumen — sin impacto de capacidad.

## Trade-offs

**`OrderCannotBeCancelledError` propio (`payments/`) en vez de compartir
clase con `OrderInvalidTransitionError` (`orders/`)** — mismo criterio que ya
documentaron `ordenes/decisions.md` y `pagos/decisions.md`: dominios que no
se acoplan a una clase compartida, aunque compartan convención de naming
(`dsm:{módulo}/{condición}`) y código HTTP (409).

**`manual` tratado igual que `simulated_dsm` para el reembolso (D3 de
proposal.md)** — decisión de este plan, no un AC literal. Riesgo aceptado:
si el PO prefiere un tercer estado o un paso manual explícito, es una
condición menos en `crearRefund`, sin impacto en el resto del diseño (ver
Open questions de `proposal.md`).

**`CancelOrderResponse` self-contained, sin `$ref` cruzado a `ordenes` (D6)**
— pequeña duplicación de schema entre las dos raíces vivas, aceptada por
consistencia con el precedente ya establecido (`PaymentConfirmed` tampoco
reusa nada de `ordenes`).

**Sin rate-limit dedicado en `POST .../cancel`** — mismo criterio que el
resto de la superficie admin de bajo volumen (`ProductsController`,
`PaymentConfirmationController`).

## Resiliencia

La única llamada externa (`MercadoPagoClient.refund`) ya tiene timeout +
retry con backoff+jitter + circuit-breaker in-process (construido por
US-010, sin cambios). Se invoca **fuera** de cualquier `$transaction` abierto
(`backend-node-standards.md` §8) — un fallo no revierte la cancelación ya
aplicada (la orden queda `cancelled` con stock reintegrado
independientemente de si el reembolso resolvió al toque o quedó
`refund_pending` para el reintento durable). `NotificationPort` es best-effort
(catch + log), igual que el resto de los triggers de este puerto.

## Deployment considerations

- **Sin migración de Prisma** (D2) — nada que expandir/contraer.
- **Sin secretos nuevos** — reusa `MP_ACCESS_TOKEN`/`MP_HTTP_TIMEOUT_MS`/
  `MP_MAX_RETRIES` ya provisionados por US-010.
- **Sin feature flag nuevo.**
- **Sin dependencia externa nueva** — `MercadoPagoClient` ya existe y está en
  uso productivo (webhook + reconciliación + retry-refunds).
- **Nuevo endpoint público (admin-only)** bajo una superficie ya existente y
  ya guardada por `AdminGuard` — mismo criterio que llevó a
  `US-012-panel-ordenes-dueno-backend`/`US-023-pago-manual-offline-backend` a
  concluir "no amerita `/plan-deployment` propio": ninguna pieza de
  infraestructura nueva que aprovisionar, ningún cambio de configuración de
  plataforma, ningún cron nuevo (el único job periódico relevante,
  `retry-refunds`, ya está desplegado por US-010).
- **Rollback**: revertir el código deja el endpoint inexistente (404 genérico
  de Nest); ninguna migración que revertir; ninguna fila `refund_pending`
  quedaría huérfana (el job `retry-refunds` existente la sigue procesando
  igual, sin importar si el endpoint que la originó sigue desplegado).

## Spec delta (para `/archive-change`)

Este change agrega a la capacidad **`pagos`** (dueña de la implementación,
D1): endpoint `POST /admin/orders/{id}/cancel` en
`contracts/openapi/paths/cancel-order.yaml` (nuevo, `$ref`'d desde la raíz),
schema `CancelOrderResponse` en `components.schemas` de la raíz, y un nuevo
error `dsm:payments/order-cannot-be-cancelled` (409) en el catálogo de
`Problem` de esa capacidad. `requirements.md`/`decisions.md` de `pagos` ganan
una sección "Desde US-013 backend" (nuevo AC-1..AC-10 cubiertos, D1-D8 de
este documento).

Deja además una nota cruzada en `openspec/specs/ordenes/README.md`/
`requirements.md` (dueña conceptual del ciclo de vida de la orden): "D-2
Cancelación / reintegro de stock" (hoy listado como diferido a US-013) queda
**resuelto por la capacidad hermana `pagos`, no por esta** — mismo patrón que
ya existe para `GET /admin/orders/pending-payment` (capacidad hermana, no
anidada).

## Open questions

Las dos preguntas propias de este backend (OQ-BE-1, OQ-BE-2) están en
`proposal.md`, con default implementado; ninguna bloquea el desarrollo.

## References

- E2E §6, §12 (FSM de orden), §14 (auth), §17 (NFR), §18 (observabilidad),
  §20 (ADR triggers)
- Capacidad `pagos`: [`openspec/specs/pagos/requirements.md`](../../specs/pagos/requirements.md)
  (R-7 a R-17, N-6 a N-11 — webhook/medio simulado/jobs admin de US-010),
  [`decisions.md`](../../specs/pagos/decisions.md) (D10-D16, D1-D9 —
  precedente de módulos/transacción cruzada/`NotificationPort` compartido),
  [`README.md`](../../specs/pagos/README.md)
- Capacidad `ordenes`: [`openspec/specs/ordenes/requirements.md`](../../specs/ordenes/requirements.md)
  (R-1 a R-8 — FSM de fulfillment, `order_status_history`),
  [`decisions.md`](../../specs/ordenes/decisions.md) (idempotencia
  estructural, `:id` UUID-shaped, `changed_by` sin FK)
- Código existente citado: `apps/api/src/payments/{confirm-order.service.ts,
  payments.repository.ts, payment-confirmation.controller.ts,
  payment-confirmation-errors.ts, payments.module.ts, refund-retry.service.ts,
  mercadopago/mercadopago-client.ts}`, `apps/api/src/checkout/orders.repository.ts`,
  `apps/api/src/stock/{stock.repository.ts,stock-errors.ts}`,
  `apps/api/src/orders/{orders.module.ts,orders-admin.service.ts,order-state.ts,
  order-status-history.repository.ts,ports/notification.port.ts,
  ports/logging-notification.adapter.ts,dto/order.dto.ts}`,
  `apps/api/src/observability/payments-events.service.ts`,
  `packages/db/prisma/schema.prisma`, migraciones
  `20260829172227_add_orders`, `20260830143351_add_payments`,
  `20260830180000_add_order_status_history`,
  `20260905201343_add_order_confirmed_cancelled_at`
- Standards: `backend-node-standards.md` §2-§9 · `api-standards.md` §8, §10,
  §11 · `security-standards.md` §4, §4.5, §7 · `observability-standards.md` §9
  · `testing-standards.md` §14 · `data-architecture-patterns` (evaluación §D2,
  sin Mode B) · `threat-modeling-lite` (§D7) · `api-contract-completeness`
  (draft `contracts/openapi/cancel-order.yaml`)
