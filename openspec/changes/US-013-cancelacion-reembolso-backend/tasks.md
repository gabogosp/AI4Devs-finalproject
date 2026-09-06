---
parent-us: US-013
discipline: backend
variant: null
language: es
---

# US-013 Backend — Tasks

> Cada task es closure-grade: atómica, con `Exit criterion:` observable y
> `Verify:` con el comando exacto que `/develop-backend` corre — nunca watch
> (F49): `pnpm --filter @dsm/api test -- --testPathPattern=<patrón>` corre
> Jest en su forma **terminante**. Los tests service-level e integration
> corren contra el Postgres real de `docker-compose` (`:55432`), mismo
> criterio que `confirm-order.service.spec.ts`/`e2e-payments-*.spec.ts`. Los
> comandos asumen la **raíz del repo** como cwd.
>
> **Sin migración de Prisma** (`design.md` §D2) — no hay Fase de "expand" de
> schema: `orders.status`/`payments.status`/`order_status_history.to_status`
> ya admiten todo lo que este change escribe.
>
> **Estimación dual**: **~8,0 h AI-asistido** / **~15 h tradicional** (19
> tasks, 12 fases). La US §7 presupuesta `BE-US-013` en 8-12h tradicional —
> este plan lo excede moderadamente por la orquestación cross-módulo real
> (orders + stock + payments + refund + notification en una sola
> transacción, más el reembolso real fuera de ella) — misma clase de
> complejidad que `US-010-orden-webhook-stock-backend`, que también superó
> su estimado original. Flageado, no oculto.

## Traceability matrix (AC de la US → tasks)

| AC | Descripción | Task IDs |
|---|---|---|
| AC-1 | Cancelar orden no entregada | T2.2, T5.1, T7.2 |
| AC-2 | Stock se reintegra | T2.1, T5.1, T5.2 |
| AC-3 | Reembolso real MercadoPago (reusa refund_pending/retry-refunds) | T2.3, T5.1, T5.2, T8.1 |
| AC-4 | Aviso al comprador (seam) | T3.1, T5.1, T5.2 |
| AC-5 | Pago simulado — no-op | T5.1, T5.2 |
| AC-6 | Confirmación de dos pasos | Out of scope (FE, `proposal.md`) |
| AC-7 | No cancela orden entregada | T1.1, T5.1, T5.2 |
| AC-8 | Reintegro de stock idempotente | T2.2, T5.1, T5.2 |
| AC-9 | Sólo admin puede cancelar | T7.2 (reusa `AdminGuard`), T8.2 |
| AC-10 | Trazabilidad quién/cuándo/resultado | T2.3, T4.1, T5.1, T5.2 |

## Pre-requisitos

- [x] **T0.1 — `apps/api` limpio antes de empezar**
  - **Exit criterion**: no hay cambios sin commitear en
    `apps/api/src/payments/`, `apps/api/src/orders/`,
    `apps/api/src/stock/stock.repository.ts`,
    `apps/api/src/checkout/orders.repository.ts` de otra sesión en vuelo en
    **este** worktree.
  - **Verify**: `git status --porcelain apps/api/src/payments apps/api/src/orders apps/api/src/stock/stock.repository.ts apps/api/src/checkout/orders.repository.ts` vacío
- [x] **T0.2 — Postgres local arriba**
  - **Exit criterion**: el contenedor de Postgres del `docker-compose` del
    repo responde.
  - **Verify**: `docker compose up -d postgres && sleep 1 && docker compose exec -T postgres pg_isready`

## Fase 1 — Errores de dominio

- [ ] **T1.1 — `OrderCannotBeCancelledError` (409) + razón `already-delivered`**
  - **Pattern**: clase de dominio calcada a `OrderNotPendingPaymentError`
    (`payment-confirmation-errors.ts`) — `per backend-node-standards.md §6 —
    errores de dominio tipados, RFC 7807`:
    ```ts
    export class OrderCannotBeCancelledError extends DomainError {
      readonly status = 409;
      readonly type = 'dsm:payments/order-cannot-be-cancelled';
      constructor(currentStatus: string) {
        super(`La orden está "${currentStatus}" — no se puede cancelar`);
      }
    }
    ```
    Extender también `PaymentsRejectedReason` (en
    `observability/payments-events.service.ts`) con el literal
    `'already-delivered'`.
  - **Exit criterion**: `OrderCannotBeCancelledError` existe en
    `payments/payment-confirmation-errors.ts`, extiende `DomainError`, con
    `status=409` y `type='dsm:payments/order-cannot-be-cancelled'`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=payment-confirmation-errors`

## Fase 2 — Repositorios (stock / orders / payments)

- [ ] **T2.1 — `StockRepository.incrementForOrder` (reintegro)**
  - **Pattern**: inverso simétrico de `decrementForOrder`, sin guard `gte`
    (un incremento nunca puede fallar por cantidad) — `per
    data-architecture-patterns` (workload trivial, mismo store):
    ```ts
    async incrementForOrder(
      lines: StockDecrementLine[],
      tx: Prisma.TransactionClient | PrismaService = this.prisma,
    ): Promise<void> {
      for (const linea of lines) {
        await tx.product.update({
          where: { id: linea.productId },
          data: { stock: { increment: linea.quantity } },
        });
      }
    }
    ```
    `FK RESTRICT` de `order_items.product_id` garantiza que el producto
    exista siempre — sin necesidad de `updateMany`/guard de existencia.
  - **Exit criterion**: `incrementForOrder([{productId, quantity: N}])` sobre
    un producto con stock `S` deja `stock = S + N` en Postgres real.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=stock.repository`

- [ ] **T2.2 — `OrdersRepository.transitionToCancelledIfActive` (guard estructural, AC-1/AC-8)**
  - **Pattern**: mismo compare-and-set que `transitionToCancelledIfPending`
    (US-010) y `updateStatusConditional` (US-012), guardado por los 3 estados
    activos en vez de `pending_payment` — `per design.md §D3`:
    ```ts
    async transitionToCancelledIfActive(
      orderId: string,
      tx: Prisma.TransactionClient | PrismaService = this.prisma,
    ): Promise<OrderWithItems | null> {
      const { count } = await tx.order.updateMany({
        where: { id: orderId, status: { in: ['new', 'preparing', 'ready'] } },
        data: { status: 'cancelled', cancelled_at: new Date() },
      });
      if (count === 0) return null;
      return tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
    }
    ```
  - **Exit criterion**: sobre una orden `new`/`preparing`/`ready`, el método
    devuelve la orden con `status='cancelled'` y `cancelled_at` seteado; sobre
    una orden `delivered`/`cancelled`/`pending_payment`, devuelve `null` sin
    escribir nada (0 filas afectadas).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=orders.repository`

- [ ] **T2.3 — `PaymentsRepository`: `findApprovedByOrderId`, `findLatestByOrderId`, `markApprovedAsRefundPending`, `markApprovedAsRefunded`**
  - **Pattern**: los dos `markApprovedAs*` son `UPDATE ... WHERE
    status='approved'` guardado, calcado a `markRefunded` (US-010) —
    `per design.md §D3`:
    ```ts
    async findApprovedByOrderId(orderId: string, tx = this.prisma) {
      return tx.payment.findFirst({ where: { order_id: orderId, status: 'approved' }, orderBy: { created_at: 'desc' } });
    }
    async findLatestByOrderId(orderId: string, tx = this.prisma) {
      return tx.payment.findFirst({ where: { order_id: orderId }, orderBy: { created_at: 'desc' } });
    }
    async markApprovedAsRefundPending(paymentId: string, tx = this.prisma) {
      const { count } = await tx.payment.updateMany({ where: { id: paymentId, status: 'approved' }, data: { status: 'refund_pending' } });
      if (count === 0) return null;
      return tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    }
    async markApprovedAsRefunded(paymentId: string, tx = this.prisma) {
      const { count } = await tx.payment.updateMany({ where: { id: paymentId, status: 'approved' }, data: { status: 'refunded' } });
      if (count === 0) return null;
      return tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    }
    ```
  - **Exit criterion**: los 4 métodos existen en `PaymentsRepository`;
    `markApprovedAsRefundPending`/`markApprovedAsRefunded` no tocan una fila
    que no está `approved` (guard verificado con una fila `refunded`
    preexistente — 0 filas afectadas, `null` devuelto).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=payments.repository`

## Fase 3 — `NotificationPort`: método nuevo (AC-4)

- [ ] **T3.1 — `orderCancelledByOwner` en `NotificationPort` + `LoggingNotificationAdapter`**
  - **Pattern**: quinto método del puerto, mismo shape que
    `orderCancelledNoStock` — `per backend-node-standards.md §3 — puerto por
    token de DI`, sin PII en el adapter (`per observability-standards.md §9`):
    ```ts
    export interface OrderCancelledByOwnerPayload {
      orderId: string;
      orderNumber: number;
      buyerName: string;
      buyerEmail: string;
    }
    // NotificationPort: + orderCancelledByOwner(payload): Promise<void>;
    // LoggingNotificationAdapter:
    async orderCancelledByOwner(payload: OrderCancelledByOwnerPayload): Promise<void> {
      this.logger.log(`order.cancelled_by_owner order_id=${payload.orderId} order_number=${payload.orderNumber}`);
    }
    ```
  - **Exit criterion**: `NotificationPort` declara `orderCancelledByOwner`;
    `LoggingNotificationAdapter` lo implementa sin loguear `buyerName`/
    `buyerEmail`; `notification.port.spec.ts` cubre el método nuevo.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=notification.port`

## Fase 4 — Cross-module wiring

- [ ] **T4.1 — Exportar `OrderStatusHistoryRepository` desde `OrdersModule`**
  - **Pattern**: agregar al array `exports` existente (hoy sólo
    `NOTIFICATION_PORT`) — `per backend-node-standards.md §3`, ningún edge de
    módulo nuevo (ya es `payments → orders`):
    ```ts
    exports: [NOTIFICATION_PORT, OrderStatusHistoryRepository],
    ```
  - **Exit criterion**: `PaymentsModule` puede inyectar
    `OrderStatusHistoryRepository` sin declararlo como provider propio.
  - **Verify**: `grep -c "OrderStatusHistoryRepository" apps/api/src/orders/orders.module.ts` → `2` (provider + export) **y** `pnpm --filter @dsm/api test -- --testPathPattern=orders.module`

## Fase 5 — `CancelOrderService`

- [ ] **T5.1 — Implementación del servicio**
  - **Pattern**: algoritmo completo en `design.md` §D3 (guard de estado →
    transacción con reintegro+historial+marca de reembolso → llamada externa
    FUERA de la tx → notificación best-effort → reporte final re-consultado)
    — `per backend-node-standards.md §5 — $transaction cruzando repositorios`,
    `§8 — resiliencia (llamada externa fuera de la tx)`.
  - **Exit criterion**: `CancelOrderService.cancel(orderId, changedBy)` existe
    con la firma y el comportamiento de `design.md` §D3; compila con
    `StockRepository`, `OrdersRepository`, `PaymentsRepository`,
    `OrderStatusHistoryRepository`, `MercadoPagoClient` (opcional, mismo
    patrón que `ConfirmOrderService`), `NotificationPort` y
    `PaymentsEventsService` inyectados.
  - **Verify**: `pnpm --filter @dsm/api typecheck`

- [ ] **T5.2 — `cancel-order.service.spec.ts` (Postgres real, mismo estilo que `confirm-order.service.spec.ts`)**
  - **Pattern**: construcción directa sin DI (`new CancelOrderService(prisma,
    orders, stock, payments, history, events, notifications, mercadoPago)`),
    `MercadoPagoClient` como `jest.Mocked<Pick<MercadoPagoClient, 'refund'>>`
    — `per` el mismo patrón de `e2e-payments-mercadopago-happy.spec.ts`.
  - **Escenarios obligatorios** (uno por `it`):
    1. Happy path `provider='mercadopago'`: orden `new` con pago `approved` →
       cancela, stock reintegrado, `mercadoPago.refund` llamado con
       `external_id`/`amount_ars_cents` correctos, `payments.status='refunded'`,
       `order_status_history` con `to_status='cancelled'`+`changed_by`,
       `notifications.orderCancelledByOwner` llamado (AC-1, AC-2, AC-3, AC-4,
       AC-10).
    2. `provider='simulated_dsm'`: cancela, `payments.status='refunded'` SIN
       llamar `mercadoPago.refund` (AC-5).
    3. `provider='manual'`: mismo no-op externo que (2) — `design.md` D3.
    4. AC-7: orden `delivered` → `OrderCannotBeCancelledError` (409), stock
       SIN modificar, sin fila nueva en `order_status_history`.
    5. AC-8: llamar `cancel()` dos veces sobre la misma orden → la segunda
       NO reintegra stock una segunda vez, NO re-llama `mercadoPago.refund`,
       NO re-notifica; ambas respuestas reportan `status='cancelled'`.
    6. Reembolso falla: `mercadoPago.refund` rechaza → `payments.status`
       queda `refund_pending` (nunca `refunded` ni "fallido definitivo") —
       reusa el vocabulario de AC-3 durabilidad de US-010.
    7. Orden `pending_payment` → `OrderNotFoundError` (404).
  - **Exit criterion**: los 7 escenarios pasan contra Postgres real.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=cancel-order.service`

## Fase 6 — Observabilidad

- [ ] **T6.1 — `PaymentsEventsService.emitOwnerCancelled` + razón `already-delivered`**
  - **Pattern**: mismo esqueleto que `emitAutoCancelled` — `per
    observability-standards.md §9`, sin PII, sólo `orderId`:
    ```ts
    emitOwnerCancelled(orderId: string): void {
      this.metrics?.increment('payments', 'payments.owner_cancelled');
      this.logger.log({ event: 'payments.owner_cancelled', entity_id: orderId });
    }
    ```
  - **Exit criterion**: `emitOwnerCancelled` existe; `PaymentsRejectedReason`
    incluye `'already-delivered'`; `payments-events.spec.ts` cubre ambos.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=payments-events`

## Fase 7 — DTO + Controller + wiring del módulo

- [ ] **T7.1 — `CancelOrderResponseDto`**
  - **Pattern**: composición (no herencia) sobre `AdminOrderDetailDto` — `per
    design.md §D6`:
    ```ts
    export class CancelOrderResponseDto {
      static from(order: OrderWithItems, history: OrderStatusHistory[], refund: RefundInfo) {
        return { ...AdminOrderDetailDto.fromWithHistory(order, history), refund };
      }
    }
    ```
  - **Exit criterion**: `CancelOrderResponseDto.from(...)` devuelve un objeto
    con todos los campos de `AdminOrderDetailDto` más `refund`.
  - **Verify**: `pnpm --filter @dsm/api typecheck`

- [ ] **T7.2 — `OrderCancellationController` — `POST /v1/admin/orders/{id}/cancel`**
  - **Pattern**: calcado a `PaymentConfirmationController` — mismo
    `@Controller('v1/admin/orders')`, `AdminGuard`, `ParseUUIDPipe` (sin regex
    de forma UUID, `design.md` §D1), `JwtService.decode` sin re-verificar
    (`AdminGuard` congelado, no se toca) — `per design.md §D1, §D5`:
    ```ts
    @Controller('v1/admin/orders')
    @UseGuards(AdminGuard)
    export class OrderCancellationController {
      constructor(private readonly cancelOrder: CancelOrderService, private readonly jwt: JwtService) {}

      @Post(':id/cancel')
      @HttpCode(200)
      async cancel(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: Request) {
        const changedBy = this.changedByFrom(req);
        const resultado = await this.cancelOrder.cancel(id, changedBy);
        return CancelOrderResponseDto.from(resultado.order, resultado.history, resultado.refund);
      }
      // changedByFrom: idéntico a OrdersController/PaymentConfirmationController
    }
    ```
  - **Exit criterion**: `POST /v1/admin/orders/{uuid}/cancel` sin token → 401;
    con token no-admin → 403; con token admin sobre una orden `new` → 200 con
    el shape de `CancelOrderResponseDto`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-payments-cancel-order`

- [ ] **T7.3 — Registrar en `payments.module.ts`**
  - **Pattern**: agregar `CancelOrderService` a `providers`,
    `OrderCancellationController` a `controllers` — sin nuevo `imports`
    (`CheckoutModule`/`StockModule`/`OrdersModule` ya están, `design.md` §D1).
  - **Exit criterion**: `PaymentsModule` arranca (Nest resuelve todas las
    dependencias de `CancelOrderService` sin `forwardRef`).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=payments.module`

## Fase 8 — Tests HTTP-level

- [ ] **T8.1 — `e2e-payments-cancel-order.spec.ts` (supertest, Postgres real, `MercadoPagoClient` mockeado)**
  - **Pattern**: mismo armazón que `e2e-payments-mercadopago-happy.spec.ts`
    (`Test.createTestingModule` + `.overrideProvider(MercadoPagoClient)`).
    Cubre la capa HTTP que T5.2 no ejercita: status codes exactos vía
    `HttpProblemFilter` (404/409/401/403), shape JSON de la respuesta 200
    (incluye `refund`), y que `changedBy` sale del JWT `sub` del token admin
    de test (no de ningún campo del body — no hay body).
  - **Exit criterion**: 200 con `refund.status` correcto en el happy path
    mercadopago; 404 `dsm:payments/order-not-found` sobre una orden
    inexistente; 409 `dsm:payments/order-cannot-be-cancelled` sobre una orden
    `delivered`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-payments-cancel-order`

- [ ] **T8.2 — Agregar la ruta al barrido de `e2e-rbac.spec.ts` (AC-9)**
  - **Pattern**: una línea nueva en el array `routes` — `per
    e2e-rbac.spec.ts` ya existente:
    ```ts
    ['post', `/v1/admin/orders/${uuid}/cancel`],
    ```
    Importar `PaymentsModule` (+ sus imports transitivos ya cubiertos por
    `bootTestApp`) si el `describe` no lo incluye todavía.
  - **Exit criterion**: `POST /v1/admin/orders/{uuid}/cancel` sin token → 401;
    con token no-admin → 403 — verificado en el MISMO barrido que ya cubre
    los otros endpoints admin (ningún endpoint admin queda fuera del
    invariante "ninguna ruta `/v1/admin/*` responde sin auth").
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-rbac`

## Fase 9 — Contratos

- [ ] **T9.1 — Draft `contracts/openapi/cancel-order.yaml` (staging del change)**
  - **Pattern**: `per api-contract-completeness` — 1 archivo por endpoint,
    plantilla canónica (paths + components.schemas + components.responses),
    calcado al estilo de `pagos/contracts/openapi/paths/confirm-payment.yaml`.
  - **Exit criterion**: `openspec/changes/US-013-cancelacion-reembolso-backend/contracts/openapi/cancel-order.yaml`
    existe con `post./{id}/cancel`, `security: [adminBearer]`, `parameters`
    (`id`, UUID), `responses` 200/401/403/404/409 con `$ref` a
    `CancelOrderResponse`/`Problem`.
  - **Verify**: `test -f openspec/changes/US-013-cancelacion-reembolso-backend/contracts/openapi/cancel-order.yaml`

- [ ] **T9.2 — Actualizar `apps/api/docs/api/openapi.yaml` (publicado, vivo)**
  - **Pattern**: agregar `paths./admin/orders/{id}/cancel` (mismo estilo que
    el bloque `/admin/orders/{orderId}/confirm-payment` ya existente en este
    mismo archivo) + `components.schemas.CancelOrderResponse` (self-contained,
    `design.md` §D6) + `components.responses` para el 409 nuevo.
  - **Exit criterion**: el spec lintea limpio y declara el endpoint nuevo.
  - **Verify**: `pnpm dlx @stoplight/spectral-cli lint apps/api/docs/api/openapi.yaml --ruleset .spectral.yaml --fail-severity=warn` **y** `grep -c "  /admin/orders/{id}/cancel:" apps/api/docs/api/openapi.yaml` → `1`

## Fase 10 — Documentación

- [ ] **T10.1 — Actualizar `payments/README.md` y `orders/README.md`**
  - **Pattern**: sección nueva "Qué se sumó con US-013" en
    `payments/README.md` (mismo estilo que la sección "Qué se sumó con
    US-010"); nota cruzada en `orders/README.md` señalando que la cancelación
    vive en `payments/`, no acá (`design.md` §D1, Spec delta).
  - **Exit criterion**: ambos README mencionan `POST /admin/orders/{id}/cancel`
    y la razón de por qué vive en `payments/`.
  - **Verify**: `grep -q "cancel" apps/api/src/payments/README.md && grep -q "US-013" apps/api/src/orders/README.md`

## Fase 11 — Pre-merge

- [ ] **T11.1 — Suite completa verde + lint + typecheck**
  - **Exit criterion**: lint, typecheck y la suite completa de `apps/api`
    pasan sin fallos ni skips inesperados.
  - **Verify**: `pnpm --filter @dsm/api lint && pnpm --filter @dsm/api typecheck && pnpm --filter @dsm/api test -- --ci`

## Verification (suite-level)

- [ ] Todos los tests unitarios/service-level pasan: `pnpm --filter @dsm/api test -- --testPathPattern="cancel-order|payments.repository|orders.repository|stock.repository|notification.port|payments-events|payment-confirmation-errors" --ci`
- [ ] Suite HTTP-level (e2e) pasa: `pnpm --filter @dsm/api test -- --testPathPattern="e2e-payments-cancel-order|e2e-rbac" --ci`
- [ ] Lint / typecheck limpios: `pnpm --filter @dsm/api lint && pnpm --filter @dsm/api typecheck`
- [ ] Contrato publicado lintea limpio: `pnpm dlx @stoplight/spectral-cli lint apps/api/docs/api/openapi.yaml --ruleset .spectral.yaml --fail-severity=warn`
