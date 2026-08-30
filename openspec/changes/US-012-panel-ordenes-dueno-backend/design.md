---
parent-us: US-012
discipline: backend
variant: null
language: es
---

# US-012 Backend — Design

## Context

Este documento reemplaza la versión anterior (respaldada en
`openspec/changes/_backups/2026-08-30-US-012-panel-ordenes-dueno-backend/`),
que diseñaba este change como una extensión de `src/orders/` de
`US-010-orden-webhook-stock-backend`. Verificado 2026-08-30: ese árbol no
existe, `orders` no tiene `confirmed_at`/`cancelled_at`, y no hay
`NotificationPort` en el repo. Este documento diseña sobre lo que **existe de
verdad** hoy:

- `orders` (migración `20260829172227_add_orders`, US-008): columnas
  `id, order_number, access_token_hash, customer_id, buyer_name, buyer_email,
  buyer_phone, fulfillment, status, total_ars_cents, consent_*, created_at,
  updated_at, delivered_at`. El `CHECK orders_status_check` ya declara los 6
  valores de la FSM completa: `pending_payment, new, preparing, ready,
  delivered, cancelled`.
- `checkout/orders.repository.ts`: único punto de ORM de `orders`/`order_items`
  hoy (convención de comentario, sin test que la blinde — mismo hallazgo que
  documentó `US-023-pago-manual-offline-backend/design.md` §Trade-offs). Hoy
  expone `createPendingOrder` y `findByTokenHash`.
- `checkout.module.ts`: NO exporta `OrdersRepository` todavía (sólo la
  provee). `US-023-pago-manual-offline-backend` (worktree separado, staged,
  sin commitear) planea agregar ese `exports` — este change lo agrega también,
  de forma idempotente, sin asumir en qué orden van a mergear los dos PRs.
- `AdminGuard`: valida JWT + `role=admin`, no adjunta el payload a `req`
  (congelado por el `git diff --exit-code` de US-014).

## Goals

- Que el dueño vea sólo las órdenes que le corresponde gestionar en
  fulfillment (pagadas, no canceladas) y las pueda paginar/ordenar/filtrar.
- Que **el backend sea la autoridad real** de AC-6, AC-7 y AC-8 — la UI del FE
  es UX, nunca el mecanismo de seguridad (`security-standards.md` §4.3).
- Que cada transición que el dueño ejecuta en fulfillment quede trazada de
  forma consultable (AC-9).
- **No depender de ningún artefacto que no existe hoy** — ni de
  `US-010-orden-webhook-stock-backend` (indefinidamente pospuesta), ni de que
  `US-023-pago-manual-offline-backend` haya sido ejecutado (change hermano, en
  planificación).
- Coexistir sin colisión con la superficie HTTP que US-023 ya planificó bajo
  el mismo path base (`/v1/admin/orders`).

## Non-goals

- Construir la FSM de 6 estados completa (`pending_payment`/`cancelled`
  incluidos) — sólo las 4 transiciones de fulfillment que este panel gestiona.
- Cancelación / reintegro de stock — US-013.
- Métricas agregadas / gráficos — US-016.
- Escribir la fila inicial de `order_status_history`
  (`pending_payment → new`) — pertenece al `ConfirmOrderService` de US-023,
  archivo que este agente no puede tocar (change distinto, en curso).
- Reproducir el árbol completo de `src/orders/` que el `design.md` de US-010
  bosquejó en su D9 (ports genéricos, FSM de 6 estados compartida). Ver D9
  (Riesgo de reconciliación) para lo que esto implica más adelante.

## Approach

### D1 — Superficie: módulo nuevo `src/orders/`, extensión puntual de `checkout/`

```
apps/api/src/orders/                       ← NUEVO — nadie lo había creado
├─ orders.module.ts
├─ orders.controller.ts                    ← los tres endpoints admin
├─ orders-admin.service.ts                 ← caso de uso: list/get/changeStatus
├─ orders-errors.ts                        ← OrderNotFoundError, OrderInvalidTransitionError
├─ order-state.ts                          ← FSM propia, 4 estados activos
├─ order-status-history.repository.ts      ← único punto de ORM de order_status_history
├─ dto/order.dto.ts
├─ ports/
│  ├─ notification.port.ts                 ← NUEVO — orderReadyForPickup (un solo método)
│  └─ logging-notification.adapter.ts      ← NUEVO
└─ README.md

apps/api/src/checkout/orders.repository.ts ← EXTENDIDO: +list, +findById, +updateStatusConditional
apps/api/src/checkout/checkout.module.ts   ← +exports: [OrdersRepository] (idempotente)
apps/api/src/observability/order-events.service.ts ← NUEVO (mismo esqueleto que CheckoutEventsService)
apps/api/src/app.module.ts                 ← +OrdersModule
```

`OrdersModule` importa `CheckoutModule` (para inyectar `OrdersRepository`) —
mismo patrón que `PaymentsModule` de US-023 en su propio worktree. Sin
`forwardRef`: `orders → checkout`, dirección acíclica (`checkout` no conoce
`orders`).

**Por qué un módulo nuevo y no extender `checkout/` directamente para todo**:
el controller/servicio de este change (paginación, `sort`, FSM de
fulfillment, notificación, historial) no tiene relación funcional con el
checkout guest (`CheckoutController`, rate-limited, CSRF) — mezclar ambos en
el mismo módulo acopla superficies con ciclos de vida y audiencias distintas
(guest anónimo vs. admin autenticado). La única pieza compartida es el acceso
a `orders`/`order_items`, que se resuelve importando el repositorio, no el
módulo entero.

### D2 — Persistencia: `order_status_history`, tabla nueva y aditiva

**Evaluación per `data-architecture-patterns`**: workload relacional,
append-only, lookup por `order_id` + rango por `changed_at`, escala pequeña
(~100 órdenes/mes × ≤3 transiciones de fulfillment = ~300 filas/mes, retención
12 meses ⇒ ~3.600 filas/año). PostgreSQL puro, el baseline del proyecto. **No
se invoca `data-architect` Mode B**: tabla nueva sin datos que migrar
(pre-lanzamiento), FK simple a una tabla ya existente.

```prisma
model OrderStatusHistory {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  order_id    String   @db.Uuid
  order       Order    @relation(fields: [order_id], references: [id], onDelete: Cascade)
  from_status String?
  to_status   String
  changed_by  String?
  changed_at  DateTime @default(now())

  @@index([order_id, changed_at])
  @@map("order_status_history")
}
```

```sql
CREATE TABLE "order_status_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_id" uuid NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
  "from_status" text,
  "to_status" text NOT NULL,
  "changed_by" text,
  "changed_at" timestamp(3) NOT NULL DEFAULT now()
);
CREATE INDEX "order_status_history_order_id_changed_at_idx"
  ON "order_status_history" ("order_id", "changed_at");
```

`changed_by` (nullable, sin FK — mismo criterio que `payments.confirmed_by` de
US-023: guarda el claim `sub` del JWT admin, un uuid de `Customer` o el
literal `'admin'` del token de bootstrap, que no tiene fila en `Customer`) es
un agregado deliberado de este change, no un requisito literal de AC-9 (OQ-BE-3).
Se decodifica el mismo bearer token que `AdminGuard` ya verificó
(`JwtService.decode`, sin re-verificar) — el mismo patrón que
`PaymentConfirmationController` de US-023 estableció para no tocar
`AdminGuard` (congelado por US-014).

**Backfill: ninguno.** Proyecto pre-lanzamiento, sin órdenes reales.

**Sin índice nuevo sobre `orders(created_at)`** para el `sort` del listado —
el índice existente `orders(status, created_at)` ya cubre el filtro por
`status` + orden por fecha, que es el caso por defecto. Ver Trade-offs.

### D3 — Contrato HTTP

```yaml
GET /v1/admin/orders
  query:
    status?: enum [new, preparing, ready, delivered]   # allowlist cerrada (OQ-BE-2)
    limit: integer, default 20, min 1, max 100
    offset: integer, default 0, min 0
    sort?: enum [order_number, -order_number, created_at, -created_at,
                 total_ars_cents, -total_ars_cents]
           default "-created_at"                        # api-standards §7.2
  200:
    AdminOrderListResponse: { data: AdminOrderSummary[], pagination: {limit, offset, total} }
  401/403: Problem (AdminGuard)

GET /v1/admin/orders/{id([0-9a-fA-F-]{36})}    # regex de forma UUID — ver D6
  200: AdminOrderDetail
  401/403: Problem
  404: Problem (dsm:orders/not-found — incluye pending_payment, AC-8)

PATCH /v1/admin/orders/{id([0-9a-fA-F-]{36})}
  body: { status: enum [preparing, ready, delivered] }   # NUNCA "cancelled" (US-013)
  headers:
    Idempotency-Key?: string   # aceptado, documentado como IGNORADO (ver D5)
  200: AdminOrderDetail (actualizado; no-op si status ya era el pedido)
  401/403/404/409: Problem
  400: Problem (ValidationPipe — status fuera del enum, id fuera de la forma UUID)

AdminOrderSummary:
  id: uuid, order_number: int, buyer_name: string, total_ars_cents: int,
  status: enum [new, preparing, ready, delivered], created_at: date-time

AdminOrderDetail: AdminOrderSummary +
  buyer_email: string, buyer_phone: string, fulfillment: enum [pickup],
  items: AdminOrderItem[], status_history: AdminOrderStatusChange[]

AdminOrderItem:
  product_name, product_sku, quantity, unit_price_ars_cents, subtotal_ars_cents

AdminOrderStatusChange:
  from_status: string | null, to_status: string, changed_by: string | null,
  changed_at: date-time
```

**Corrección respecto al contrato que asumió el sibling FE**: su `design.md`
§D2 asume un campo `confirmed_at` y `sort` por defecto `-confirmed_at`.
Ninguno de los dos existe — la columna real es `created_at`. Queda anotado en
`proposal.md` References para que la sesión que retome el plan de FE lo
ajuste antes de ejecutar.

**`sort` como enum cerrado de 6 valores, no un parser custom** (simplificación
respecto a la versión anterior, `base-standards.md` §1 KISS): con sólo 3
campos ordenables × 2 direcciones, `@IsIn([...])` en el DTO valida y devuelve
400 por el `ValidationPipe` global — sin una función que lance una excepción
de dominio a mano. `parseSort(raw)` queda como una función pura de
`string → {field, desc}` sin rama de error (el DTO ya garantizó que `raw` es
uno de los 6 valores válidos).

**Status code de la transición inválida — 409, no 422.** Mismo razonamiento
que la versión anterior (RFC 7231 §6.5.8: 409 es "la solicitud entra en
conflicto con el estado actual del recurso"), reforzado ahora por un
precedente real: `OrderNotPendingPaymentError` de US-023 usa exactamente el
mismo código para la misma clase de conflicto (salto de FSM), con el mismo
prefijo de naming `dsm:{módulo}/{condición}`. Se decide **no compartir la
clase** entre los dos módulos (cada uno con su propio archivo de errores,
mismo criterio que `checkout-errors.ts` vs `orders-errors.ts`), pero sí
compartir la convención.

### D4 — Idempotencia del PATCH: estructural, no por clave almacenada

```ts
async changeStatus(id: string, target: FulfillmentStatus, changedBy: string): Promise<OrderWithHistory> {
  return this.prisma.$transaction(async (tx) => {
    const current = await this.orders.findById(id, tx);
    if (!current || current.status === 'pending_payment') {
      throw new OrderNotFoundError();               // AC-8: pending_payment no es gestionable acá
    }
    if (current.status === target) {
      return current;                                // no-op: reintento de red, no re-dispara nada
    }
    if (!canTransition(current.status, target)) {
      this.events.emit('order.transition_rejected', id, current.status, target);
      throw new OrderInvalidTransitionError(current.status, target);   // 409
    }
    const updated = await this.orders.updateStatusConditional(id, current.status, target, tx);
    if (!updated) {
      // carrera: otra transición ganó entre la lectura y el UPDATE condicional
      const now = await this.orders.findById(id, tx);
      if (now?.status === target) return now;        // alguien más aplicó justo esta transición
      throw new OrderInvalidTransitionError(current.status, target);
    }
    await this.history.insert({ orderId: id, fromStatus: current.status, toStatus: target, changedBy }, tx);
    return updated;
  }).then(async (result) => {
    if (target === 'ready') {
      await this.notifications.orderReadyForPickup({
        orderId: id, orderNumber: result.order_number,
        buyerName: result.buyer_name, buyerEmail: result.buyer_email,
      });
    }
    this.events.emit('order.status_changed', id, result.status, target);
    return this.orders.findById(id) /* con items + historial, fuera de la tx, para la respuesta */;
  });
}
```

`updateStatusConditional` hace, dentro de la **misma transacción**: `UPDATE
orders SET status=$to, [delivered_at=now() si to='delivered'] WHERE id=$id AND
status=$from` (Prisma `updateMany` — `update()` no acepta `status` en el
`where` sin un índice único compuesto) + el `INSERT` en `order_status_history`
vía `OrderStatusHistoryRepository.insert(..., tx)`. Esto es exactamente el
patrón que `ConfirmOrderService` de US-023 usa para cruzar
`OrdersRepository`/`StockRepository`/`PaymentsRepository` con un `tx`
compartido — la primera vez que ese patrón apareció en el repo fue en ese
change hermano; este lo reusa, no lo reinventa.

La notificación va **después del commit** — un fallo del `NotificationPort`
nunca revierte una transición que el dueño ya confirmó que hizo.

El header `Idempotency-Key` que el FE ya decidió mandar se acepta y se ignora
— documentado así en el contrato. Ver justificación completa en la versión
respaldada de este documento (mismo razonamiento, ahora con el precedente
real de US-023 en vez de uno hipotético).

### D5 — `sort`: enum cerrado (revisión respecto a la versión anterior)

Ver D3. `api-standards.md` §7.2 (comma-list + prefijo `-`), pero con la lista
de campos acotada a 3 (`order_number`, `created_at`, `total_ars_cents`) el
enum cerrado de 6 valores es más simple que un parser con rama de error y
cubre exactamente los mismos casos.

### D6 — Colisión de rutas con `US-023-pago-manual-offline-backend` (resuelta, order-independiente)

`PaymentConfirmationController` (US-023, worktree separado) registra
`GET /v1/admin/orders/pending-payment` bajo el mismo
`@Controller('v1/admin/orders')` base. NestJS/Express matchean rutas por
**orden de registro**, no por especificidad — si el módulo de este change se
registra en `app.module.ts` antes que el de US-023, una request a
`/v1/admin/orders/pending-payment` matchea primero `GET /v1/admin/orders/:id`
(este change), tratando `"pending-payment"` como el `:id` y rompiendo el
endpoint de US-023 con un 400 de `ParseUUIDPipe` en vez de la respuesta real.

**Resolución**: restringir `:id` a forma UUID directamente en el path de Nest
(sintaxis de `path-to-regexp`, soportada por el adaptador Express de Nest):

```ts
@Get(':id([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})')
get(@Param('id', new ParseUUIDPipe()) id: string) { ... }

@Patch(':id([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})')
patch(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateOrderStatusDto) { ... }
```

Esto hace la resolución **independiente del orden de merge**: `pending-payment`
nunca tiene forma UUID, así que jamás matchea `:id` sin importar qué
controller se registró primero. `ParseUUIDPipe` sigue corriendo después del
match para el 400 de validación fina (versión inválida de UUID, etc.).

**Trade-off aceptado**: una request con un segmento que no tiene forma UUID
(ej. `/v1/admin/orders/no-es-un-id`) ya no cae en el `ParseUUIDPipe` (400
limpio) — como ninguna ruta matchea, Nest devuelve su 404 genérico (no
RFC 7807). Es un caso de borde (nadie construye esa URL a mano salvo
exploración manual) y no afecta ningún AC — se documenta acá, no se
"arregla" con un catch-all nuevo que no pidió ningún AC.

### D7 — `NotificationPort`: nuevo, no una extensión

```ts
// apps/api/src/orders/ports/notification.port.ts — NUEVO
export interface NotificationPort {
  orderReadyForPickup(payload: {
    orderId: string;
    orderNumber: number;
    buyerName: string;
    buyerEmail: string;
  }): Promise<void>;
}
```

A diferencia de la versión anterior (que asumía `orderConfirmed`/
`orderCancelledNoStock` ya declarados por US-010), este puerto nace con un
solo método porque es el primero en existir en el repo. `LoggingNotificationAdapter`
registra **una línea sin PII** (`order_id`/`order_number` solamente) —
mismo criterio que `observability-standards.md` §9. US-011 reemplaza el
adaptador completo cuando exista un proveedor real (Resend u otro).

### D8 — Observabilidad

`OrderEventsService` (nuevo, `src/observability/order-events.service.ts`,
mismo esqueleto que `CheckoutEventsService`) — delega el contador en
`MetricsService` (`@Optional()`), firma que sólo acepta `orderId | null` y
los dos enums de estado (nunca PII):

- `order.status_changed` — cada transición aplicada con éxito.
- `order.transition_rejected` — cada `PATCH` que la FSM rechaza (AC-6 como
  invariante observable).

Se registra como provider dentro de `OrdersModule` (no un módulo global
propio) — mismo patrón que `CheckoutEventsService` dentro de `CheckoutModule`,
ya que sólo este módulo lo consume.

### D9 — Threat model (STRIDE lite — `threat-modeling-lite`, superficie "GET/PATCH admin")

| Amenaza | Vector específico | Control |
|---|---|---|
| **Elevation of privilege** | acceder sin rol admin | `AdminGuard` en los tres endpoints; barrido en `e2e-rbac.spec.ts` |
| **IDOR** | `GET/PATCH /admin/orders/{id}` con una orden que no le toca ver acá | `id` UUID no enumerable; `pending_payment` responde 404 uniforme |
| **Tampering** | el body del `PATCH` pide `status=cancelled` o un salto (`new→delivered`) | DTO whitelist (`preparing\|ready\|delivered`) + FSM server-side — dos capas |
| **Repudiation** | "yo no cambié ese estado" | `order_status_history` transaccional, con `changed_by` (D2) |
| **Information disclosure** | el payload de `orderReadyForPickup` lleva email/nombre del comprador | Va al **puerto**, nunca al log |
| **DoS** | flood de `PATCH` sobre una orden | Volumen real ~100 órdenes/mes, un solo operador; sin rate-limit dedicado (mismo criterio que `ProductsController`) |

### D10 — NFRs

- **Lectura** (`GET`): p95 < 300ms (PRD §4). Índice existente `orders(status,
  created_at)` cubre el caso por defecto.
- **Escritura** (`PATCH`): p95 < 500ms. Transacción: un `UPDATE` condicional +
  un `INSERT`, sin llamadas externas dentro (notificación después del commit).
- **Volumetría**: ~100 órdenes/mes, retención 12 meses ⇒ ~1.200 filas/año en
  `orders`, ~3.600 en `order_status_history`. Sin ajuste de infraestructura.

## Trade-offs

**Sin índice nuevo sobre `orders(created_at)` en solitario** — el compuesto
`orders(status, created_at)` ya existente cubre el filtro + orden por defecto;
un índice adicional sólo por `created_at` sería redundante hoy.

**`:id` restringido por regex de forma UUID (D6)** — pierde el 400 limpio de
`ParseUUIDPipe` para segmentos que no tienen forma UUID (cae en el 404
genérico de Nest). Se acepta porque resuelve la colisión de rutas con US-023
de forma robusta e independiente del orden de merge, sin coordinar
manualmente el orden de `imports` en `app.module.ts` entre dos changes que se
desarrollan en worktrees separados.

**`OrderInvalidTransitionError` propia en vez de compartir clase con
`OrderNotPendingPaymentError` (US-023)** — mismo criterio que la versión
anterior: dominios (`orders` vs `payments`) que no tienen por qué acoplarse a
una clase compartida, aunque sigan la misma convención de naming y el mismo
código HTTP.

**`order_status_history.changed_by` sin FK** — igual trade-off que
`payments.confirmed_by` de US-023 (OQ-BE-3): cubre el caso de bootstrap
(`sub: 'admin'`, sin fila en `Customer`) a costa de integridad referencial.

## Resiliencia

Sin llamadas externas en este change (el `NotificationPort` interino es un
log local). Cuando US-011 reemplace el adaptador, la resiliencia de esa
llamada es responsabilidad de esa US (`backend-node-standards.md` §8).

## Deployment considerations

- **Migración aditiva** (`order_status_history`), sin dependencia de ninguna
  otra migración pendiente — a diferencia de la versión anterior, no hay
  orden no-negociable con otro change: `orders` ya tiene todo lo que este
  change necesita.
- **Sin secretos nuevos, sin feature flag, sin dependencia externa nueva.** No
  amerita `/plan-deployment` propio.
- **Orden de merge respecto a US-023**: no importa (D6 lo hace
  order-independiente) para la colisión de rutas. Si `US-023` mergea después
  y también agrega `exports: [OrdersRepository]` a `checkout.module.ts`, el
  merge de esa línea es trivial (misma línea, sin conflicto semántico) — el
  task de este change lo agrega de forma idempotente (verifica antes de
  escribir).
- **Rollback**: migración aditiva — revertir el código deja
  `order_status_history` sin escritores, inerte. Sin pérdida de datos.

## Spec delta (para `/archive-change`)

Este change inaugura `openspec/specs/ordenes/` (capacidad nueva — no existe
todavía porque `US-010-orden-webhook-stock-backend`, que originalmente iba a
inaugurarla, nunca se ejecutó) con los tres endpoints
(`/admin/orders`, `/admin/orders/{id}` GET/PATCH) y `order_status_history`
documentada en `decisions.md` como deviación aditiva del DER del E2E §8.
Cuando `US-023-pago-manual-offline-backend` archive su propio change, su
capacidad `pagos` (con `GET /admin/orders/pending-payment`) queda como
capacidad hermana, no anidada dentro de `ordenes`.

## Open questions

Las tres preguntas propias de este backend (OQ-BE-1, OQ-BE-2, OQ-BE-3) están
en `proposal.md`, con default implementado; ninguna bloquea el arranque. El
riesgo de reconciliación con US-010 (decisión 2 de `proposal.md`) tampoco
bloquea — es una nota para quien re-planifique esa US.

## References

- E2E §6.1, §8, §9.4, §12, §14, §17, §18
- Change hermano (informativo, worktree separado, no editado por este
  agente): [`US-023-pago-manual-offline-backend/design.md`](../../../../US-023-pago-manual-offline/openspec/changes/US-023-pago-manual-offline-backend/design.md)
  — precedente de: extender `checkout/orders.repository.ts` en vez de crear
  un módulo `orders/` para el acceso a `orders`, transacción cruzando
  repositorios con `tx` compartido, `JwtService.decode` sin tocar
  `AdminGuard`, 409 para conflicto de FSM, `payments.confirmed_by` (precedente
  de `changed_by`).
- Sibling FE (solo lectura): [`US-012-panel-ordenes-dueno-frontend-web/design.md`](../US-012-panel-ordenes-dueno-frontend-web/design.md)
  §D2 (contrato asumido — corregido en D3: `created_at` no `confirmed_at`)
- Código existente citado: `apps/api/src/checkout/orders.repository.ts`,
  `apps/api/src/checkout/checkout.module.ts`, `apps/api/src/products/{products.controller,
  products.state}.ts` (precedente de controller delgado + FSM en archivo propio),
  `apps/api/src/common/errors/domain-errors.ts`,
  `apps/api/src/common/filters/http-problem.filter.ts`,
  `apps/api/src/observability/checkout-events.service.ts`,
  `apps/api/src/auth/{admin.guard.ts,e2e-rbac.spec.ts}`,
  `packages/db/prisma/schema.prisma` (`model Order`),
  `packages/db/prisma/migrations/20260829172227_add_orders/migration.sql`
  (`orders_status_check` — ya declara los 6 estados)
- Standards: `backend-node-standards.md` §2-§9 · `api-standards.md` §6, §7.2,
  §8, §10, §11 · `security-standards.md` §4, §4.5, §7 ·
  `observability-standards.md` §9 · `testing-standards.md` §14 ·
  `data-architecture-patterns` (evaluación §D2, sin Mode B) ·
  `threat-modeling-lite` (§D9)
