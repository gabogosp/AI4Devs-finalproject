---
parent-us: US-012
discipline: backend
variant: null
language: es
---

# US-012 Backend — Design

## Context

Este documento se apoya en dos decisiones que **no reabre**:

- **E2E §12 (FSM de la orden)**: seis estados, `new → preparing → ready → delivered` son
  las cuatro transiciones que este panel gestiona; `pending_payment` y `cancelled` son de
  otras US (US-010 y US-013 respectivamente).
- **`US-010-orden-webhook-stock-backend/design.md` §D9**: declara el árbol de
  `src/orders/` (`orders.module.ts`, `orders.repository.ts`, `order-state.ts`,
  `ports/notification.port.ts` + `logging.notification.adapter.ts`) y por qué vive
  separado de `src/payments/` (dirección acíclica de dependencias, sin `forwardRef`). Este
  change **extiende ese árbol** — agrega el controller, el service de caso de uso y los
  métodos de repositorio que faltan; no crea un segundo módulo de órdenes ni redefine la
  FSM.

El resto del panel admin del repo (`ProductsController`/`ProductsService`,
`AdminGuard`, `HttpProblemFilter`, `MetricsService`) establece los patrones que este
change reutiliza sin modificarlos.

## Goals

- Que el dueño vea sólo las órdenes que le corresponde gestionar (pagadas, no
  canceladas) y las pueda paginar/ordenar/filtrar.
- Que **el backend sea la autoridad real** de AC-6 (transición inválida), AC-7 (acceso) y
  AC-8 (solo pagadas) — la UI del FE es UX, nunca el mecanismo de seguridad
  (`security-standards.md` §4.3).
- Que cada transición que el dueño ejecuta quede trazada de forma consultable (AC-9), sin
  inventar una segunda fuente de verdad para el estado (la FSM sigue siendo `orders.status`;
  el historial es un log append-only de esa misma verdad).
- Reusar `order-state.ts`, `NotificationPort`, `AdminGuard` y `HttpProblemFilter` de
  US-010/anteriores sin tocarlos donde no hace falta.

## Non-goals

- Rediseñar la FSM o las columnas de US-010 (`confirmed_at`, `cancelled_at`).
- Cancelación / reintegro de stock — US-013 (aunque `canTransition` ya declara esas
  transiciones, este `PATCH` no las expone).
- Métricas agregadas / gráficos — US-016.

## Approach

### D1 — Superficie: extiende `src/orders/`, no crea un segundo módulo

```
src/orders/                          ← creado por US-010, extendido acá
├─ orders.module.ts                  ← +OrdersController, +OrdersAdminService, +DTOs
├─ orders.controller.ts              ← NUEVO — los tres endpoints admin
├─ orders-admin.service.ts           ← NUEVO — caso de uso: list/get/changeStatus
├─ orders-errors.ts                  ← NUEVO — OrderNotFoundError, OrderInvalidTransitionError
├─ orders.repository.ts              ← EXTENDIDO — +list, +findDetailById, +applyStatusChange
├─ order-state.ts                    ← SIN TOCAR (US-010) — se reusa `canTransition`
├─ dto/order.dto.ts                  ← NUEVO — DTOs de query/body/respuesta
└─ ports/
   ├─ notification.port.ts           ← EXTENDIDO — +orderReadyForPickup
   └─ logging.notification.adapter.ts ← EXTENDIDO — implementa el método nuevo
```

`AppModule` importa `OrdersModule` directamente (hoy no lo hace porque US-010 aún no
existe; se agrega explícitamente en vez de depender de que llegue transitivamente vía
`PaymentsModule`, para no acoplar el arranque de este endpoint al orden exacto en que
US-010 registre sus propios módulos).

### D2 — Persistencia: `order_status_history`, tabla nueva y aditiva

**Evaluación per `data-architecture-patterns`**: workload = relacional, append-only,
lookup por `order_id` + rango por `changed_at`, escala pequeña (~100 órdenes/mes × ≤4
transiciones = ~400 filas/mes, PRD §6 retención 12 meses ⇒ ~4.800 filas). Esto es
PostgreSQL puro — el baseline del proyecto — sin ningún candidato alternativo que
considerar. **No se invoca `data-architect` Mode B**: es una tabla nueva, sin datos
existentes que migrar (proyecto pre-lanzamiento, no hay órdenes reales en producción
hoy), sin dual-write, sin motor distinto, FK simple a una tabla que ya existe. La única
decisión no trivial —si esto necesitaba tabla propia en vez de reconstruir desde columnas
puntuales— ya la resolvió el FE en su OQ-FE-1 y este proposal la ratificó.

```prisma
model OrderStatusHistory {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  order_id    String   @db.Uuid
  order       Order    @relation(fields: [order_id], references: [id], onDelete: Cascade)
  from_status String?
  to_status   String
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
  "changed_at" timestamp(3) NOT NULL DEFAULT now()
);
CREATE INDEX "order_status_history_order_id_changed_at_idx"
  ON "order_status_history" ("order_id", "changed_at");
```

**Backfill: ninguno.** El proyecto es pre-lanzamiento — cualquier orden que exista hoy en
un ambiente de desarrollo/staging es de prueba. No hay órdenes reales cuya historia haya
que reconstruir. Si esto se descubriera falso al ejecutar (hay datos que importan en algún
ambiente), el gap se declara en `tasks.md` como hallazgo AS-BUILT, no se resuelve
silenciosamente.

**Sin índice nuevo sobre `orders(confirmed_at)`** para el `sort` del listado: al volumen
proyectado (~1.200 filas/año en `orders`), un `ORDER BY` sin índice es un scan
submilisegundo. Ver Trade-offs.

### D3 — Contrato HTTP

Los tres endpoints, en `apps/api/docs/api/openapi.yaml` (T8.1 de `tasks.md`):

```yaml
GET /v1/admin/orders
  query:
    status?: enum [new, preparing, ready, delivered]   # allowlist cerrada (OQ-BE-2)
    limit: integer, default 20, min 1, max 100
    offset: integer, default 0, min 0
    sort?: string, default "-confirmed_at"             # api-standards §7.2
           # allowlist de campo: order_number | confirmed_at | total_ars_cents
           # prefijo "-" = descendente; sin prefijo = ascendente
  200:
    AdminOrderListResponse:
      data: AdminOrderSummary[]
      pagination: { limit, offset, total }
  401/403: Problem (AdminGuard)

GET /v1/admin/orders/{id}
  200: AdminOrderDetail
  401/403: Problem
  404: Problem (dsm:orders/not-found — incluye pending_payment, AC-8)

PATCH /v1/admin/orders/{id}
  body: { status: enum [preparing, ready, delivered] }   # NUNCA "cancelled" (US-013)
  headers:
    Idempotency-Key?: string   # aceptado, documentado como IGNORADO (ver D4)
  200: AdminOrderDetail (actualizado; no-op si status ya era el pedido)
  401/403: Problem
  404: Problem (dsm:orders/not-found)
  409: Problem (dsm:orders/invalid-transition)
  400: Problem (ValidationPipe — status fuera del enum, id no-UUID)

AdminOrderSummary:
  id: uuid, order_number: int, buyer_name: string, total_ars_cents: int,
  status: enum [new, preparing, ready, delivered], confirmed_at: date-time

AdminOrderDetail: AdminOrderSummary +
  buyer_email: string, buyer_phone: string, fulfillment: enum [pickup],
  items: AdminOrderItem[], status_history: AdminOrderStatusChange[]

AdminOrderItem:
  product_name, product_sku, quantity, unit_price_ars_cents, subtotal_ars_cents

AdminOrderStatusChange:
  from_status: string | null, to_status: string, changed_at: date-time
```

Este shape **ratifica** `design.md` §D2 del FE, con la única revisión de `sort` (D5 abajo).

**Status code de la transición inválida — 409, no 422.** El proyecto ya tiene
`InvalidTransitionError` (422, `dsm:catalog/invalid-transition`) para productos. Se decide
**no reusarla** y crear `OrderInvalidTransitionError` (409) porque:

1. **Semántica HTTP**: RFC 7231 §6.5.8 describe 409 como "la solicitud entra en conflicto
   con el estado actual del recurso destino" — exactamente lo que es un salto de FSM
   inválido (a diferencia de una violación de regla de negocio sobre el contenido
   enviado, que es lo que 422 describe mejor). El propio catálogo de
   `api-standards.md` §8.7 lista `<RESOURCE>_VERSION_CONFLICT | 409` para conflicto de
   concurrencia optimista — un salto de FSM es la misma familia.
2. **Compatibilidad con el FE ya planificado**: `design.md` §D2 del FE asumió 409 y su
   `errors.ts` ya sabe convertir un 409 en `AppError` de tipo `conflict` (el mismo
   mecanismo que usa `dsm:cart/insufficient-stock`), con el mensaje "la orden ya cambió de
   estado (probablemente en otra pestaña)". Usar 422 obligaría a ese código a re-derivarse
   o a mostrar el mensaje de validación genérico, que no describe la carrera de pestañas.

Es una decisión **local a `orders`**, no reabre el 422 de `products` (dominios distintos,
sin acoplamiento).

### D4 — Idempotencia del PATCH: estructural, no por clave almacenada (revisión de OQ-FE-2)

Igual razonamiento que ADR-0008/`ConfirmOrderService` de US-010 ("idempotente por la base,
no por un `if`"):

```ts
async changeStatus(orderId: string, target: OrderAdminStatus): Promise<OrderDetail> {
  const current = await this.repo.findDetailById(orderId);   // 404 si no existe / pending_payment
  if (current.status === target) {
    return current;                       // no-op: ya está donde se pidió, no re-dispara nada
  }
  if (!canTransition(current.status, target)) {
    throw new OrderInvalidTransitionError(current.status, target);   // 409
  }
  const updated = await this.repo.applyStatusChange(orderId, current.status, target);
  // fuera de la transacción, tras el commit (mismo patrón que ConfirmOrderService D7 de US-010):
  if (target === 'ready') {
    await this.notifications.orderReadyForPickup({ orderId, orderNumber: updated.order_number,
      buyerName: updated.buyer_name, buyerEmail: updated.buyer_email });
  }
  this.events.emit('order.status_changed', orderId, 'admin', undefined,
    { from_status: current.status, to_status: target });
  return updated;
}
```

`applyStatusChange` hace, en **una** transacción: `UPDATE orders SET status=$to, [delivered_at=now() si to='delivered'] WHERE id=$id AND status=$from` (condicional — protege contra la carrera de dos pestañas: si otra transición ganó entremedio, esto afecta 0 filas) + `INSERT INTO order_status_history`. Si el `UPDATE` condicional afecta 0 filas, el repositorio relee el estado actual: si ya es `target`, se trata como el caso no-op de arriba (alguien más aplicó exactamente esta transición); si es otro estado, es un 409 real (alguien saltó más allá).

Esto cubre exactamente lo que preocupaba al FE en OQ-FE-2 (un reintento de red tras que el
email ya salió no lo duplica, porque el reintento entra al branch no-op) sin agregar un
segundo mecanismo de idempotencia (clave + almacén de respuestas,
`api-standards.md` §10.2) al proyecto. El header `Idempotency-Key` que el FE ya decidió
mandar se acepta (no rompe nada, CORS ya lo permite desde US-006) y se ignora — se
documenta así en el contrato en vez de fingir que se usa.

### D5 — `sort`: formato canónico de un solo parámetro (revisión de OQ-FE-3)

`api-standards.md` §7.2: `sort=-confirmed_at` (comma-list + prefijo `-` para descendente).
Parser puro en `orders-admin.service.ts` (testeable sin HTTP):

```ts
const SORTABLE = ['order_number', 'confirmed_at', 'total_ars_cents'] as const;

export function parseSort(raw: string | undefined): { field: string; desc: boolean } {
  const value = raw ?? '-confirmed_at';
  const desc = value.startsWith('-');
  const field = desc ? value.slice(1) : value;
  if (!SORTABLE.includes(field as (typeof SORTABLE)[number])) {
    throw new ValidationError('Campo de orden inválido', [{ field: 'sort', message: `debe ser uno de ${SORTABLE.join(', ')}, con prefijo - opcional` }]);
  }
  return { field, desc };
}
```

No hay precedente local que romper (`ProductsController` no ordena hoy). **Quien retome el
plan de FE necesita ajustar `ordersService.list()`** de `{sort, order}` a
`{sort: '-confirmed_at'}` — anotado en `proposal.md` para no perderse.

### D6 — AC-8 como autoridad real: reglas de exclusión

| Endpoint | Regla | Por qué |
|---|---|---|
| `GET /v1/admin/orders` | `status IN ('new','preparing','ready','delivered')` **siempre**, sin excepción por filtro | El panel de fulfillment no gestiona nada más (US §out of scope); `cancelled` no es una opción del `<select>` del FE tampoco (OQ-BE-2) |
| `GET /v1/admin/orders/{id}` | 404 si `status = 'pending_payment'`; **sí** devuelve `cancelled`/`delivered` | AC-8 dice "solo pagadas" — una orden que llegó a estar `cancelled` fue pagada y luego revertida (US-010 D1, falta de stock) o es terminal (`delivered`); ambas son trazables por id sin estar en el listado. Ninguna es enumerable desde afuera hoy (OQ-BE-1) |
| `PATCH /v1/admin/orders/{id}` | DTO sólo acepta `preparing\|ready\|delivered` | `cancelled` ni siquiera llega a la validación de la FSM — es US-013 |

Este es el punto donde el backend es **la autoridad real** que el FE (D9 de su `design.md`)
declaró no poder ser: la UI nunca ofrece un salto inválido, pero si lo hiciera (bug, cliente
custom, curl), esta tabla es lo que efectivamente lo bloquea.

### D7 — `NotificationPort` (de US-010): un método nuevo, mismo seam

```ts
// src/orders/ports/notification.port.ts — EXTENDIDO
export interface NotificationPort {
  orderConfirmed(payload: OrderConfirmedPayload): Promise<void>;          // US-010
  orderCancelledNoStock(payload: OrderCancelledPayload): Promise<void>;   // US-010
  orderReadyForPickup(payload: {                                         // NUEVO (US-012)
    orderId: string;
    orderNumber: number;
    buyerName: string;
    buyerEmail: string;
  }): Promise<void>;
}
```

`LoggingNotificationAdapter.orderReadyForPickup` registra **una línea sin PII** — sólo
`order_id`/`order_number` — el mismo criterio que US-010 aplicó a `orderConfirmed` (T6.5
de su `tasks.md`: "ninguna línea de log... contiene el email, el nombre o el teléfono del
comprador"). US-011 reemplaza el adaptador completo, no este archivo.

La invocación va **después del commit** de `applyStatusChange` (D4) — un fallo del
`NotificationPort` (hoy, un log; mañana, Resend caído) nunca puede revertir una transición
de estado que el dueño ya confirmó que hizo.

### D8 — Observabilidad

`OrderEventsService` (creado por US-010, `src/observability/order-events.service.ts` — a
confirmar el path exacto al ejecutar, según dónde lo deje US-010) gana dos nombres de
evento:

- `order.status_changed` — cada transición aplicada con éxito. Campos del **log** (nunca
  dimensión de métrica): `from_status`, `to_status` — dos enums acotados, no PII, no alta
  cardinalidad.
- `order.transition_rejected` — cada `PATCH` que `canTransition` rechaza (AC-6 como
  invariante observable: si este contador sube, hay una UI vieja ofreciendo un salto que
  ya no existe, o un intento directo contra la API).

Ambos siguen el patrón `metrics?.increment('orders', name)` que la auditoría
`AUDIT-dsm-api-006` fijó — el contador aparece en `GET /v1/admin/metrics`, no vive sólo en
un `Map` privado invisible desde afuera.

### D9 — Threat model (STRIDE lite — `threat-modeling-lite`, superficie "GET/PATCH admin")

| Amenaza | Vector específico | Control |
|---|---|---|
| **Elevation of privilege** | acceder sin rol admin | `AdminGuard` en los tres endpoints; barrido en `e2e-rbac.spec.ts` (extendido, no un spec nuevo) |
| **IDOR** | `GET/PATCH /admin/orders/{id}` con un id ajeno — no aplica multi-tenant (un solo dueño), pero sí aplica "orden que no le corresponde ver acá" | `id` es UUID no enumerable; `pending_payment` responde 404 uniforme, no 403 (no confirma existencia de un estado que no le toca) |
| **Tampering** | el body del `PATCH` pide `status=cancelled` o un salto (`new→delivered`) | DTO whitelist (`preparing\|ready\|delivered` solamente) + `canTransition` server-side — dos capas, ninguna depende de qué mostró la UI |
| **Repudiation** | "yo no cambié ese estado" | `order_status_history` transaccional con cada transición (AC-9); no hay forma de que el estado avance sin dejar la fila |
| **Information disclosure** | el payload de `orderReadyForPickup` lleva email/nombre del comprador | Va al **puerto**, nunca al log (`observability-standards.md` §9); el log del adapter interino sólo tiene `order_id`/`order_number` |
| **DoS** | flood de `PATCH` sobre una orden | Volumen real ~100 órdenes/mes con un único operador; sin rate-limit dedicado (mismo criterio que `ProductsController`, que tampoco lo lleva) — si se observa abuso, es un `@Throttle` de una línea |

### D10 — NFRs

- **Lectura** (`GET`): p95 < 300ms (PRD §4, heredado). A ~1.200 filas/año con filtro por
  `status` (índice existente `orders(status, created_at)`) y sin índice nuevo sobre
  `confirmed_at` (D2), el presupuesto sobra por dos órdenes de magnitud.
- **Escritura** (`PATCH`): p95 < 500ms (PRD §4). La transacción es un `UPDATE` condicional
  + un `INSERT` — comparable a `applyStatusChange` de US-010, sin llamadas externas dentro
  de la transacción (la notificación va después del commit, D7).
- **Volumetría**: ~100 órdenes/mes, retención 12 meses (PRD §6) ⇒ ~1.200 filas en `orders`,
  ~4.800 en `order_status_history` al año. Ningún ajuste de infraestructura.

## Trade-offs

**Sin índice nuevo sobre `orders(confirmed_at)`.** El `sort` por defecto barre toda la
tabla en cada request. Al volumen proyectado (§D10) es submilisegundo; si el proyecto
crece un orden de magnitud (~10.000 órdenes/mes), agregar `@@index([status, confirmed_at])`
es una migración de una línea sin downtime. No se anticipa ahora (YAGNI,
`base-standards.md` §1).

**`OrderInvalidTransitionError` propia en vez de reusar `InvalidTransitionError`
(productos).** Cuesta una clase más en `common/errors` (bueno: `orders-errors.ts` local,
igual que `checkout-errors.ts`), pero evita acoplar el status code de dos dominios que no
tienen por qué compartirlo — productos usa 422 para su propia razón (validación de
publicación), órdenes usa 409 por semántica de conflicto de estado + compatibilidad con el
FE ya planificado (D3).

**Idempotencia estructural en vez de `Idempotency-Key` almacenada.** Es una desviación
documentada del mandato genérico de `api-standards.md` §10.1 ("todo POST/PATCH que
modifica un recurso acepta la clave"). Se acepta porque el proyecto ya tiene un precedente
de mayor peso para esta clase exacta de mutación (transición de estado con efecto lateral
externo) — ADR-0008 — y agregar una segunda máquina de idempotencia sería inconsistencia,
no rigor. Si en el futuro el `PATCH` gana un efecto lateral que la reconstrucción por
estado no cubre (por ejemplo, contenido variable por intento), esta decisión se revisita.

## Resiliencia

No hay llamadas salientes en este change (el `NotificationPort` interino es un log local,
igual que US-010 lo dejó). Cuando US-011 reemplace el adaptador por Resend real, la
resiliencia de esa llamada (timeout/retry/circuit breaker) es responsabilidad de esa US,
con la misma disciplina que `backend-node-standards.md` §8 exige — no se anticipa acá.

## Deployment considerations

- **Migración aditiva** (`order_status_history`), dependiente de que la migración de
  US-010 (`confirmed_at`/`cancelled_at`) ya esté aplicada — mismo orden no negociable que
  la cadena US-008 → US-009 → US-010 ya estableció, extendida: **US-010 → US-012-backend**.
- **Sin secretos nuevos, sin feature flag, sin dependencia externa nueva.** No amerita
  `/plan-deployment` propio.
- **Se recomienda desplegar junto con US-010** (si no fue ya) — un `AppModule` que registre
  `OrdersModule` con el controller de este change pero sin la migración de US-010 aplicada
  falla el arranque (columnas inexistentes). El gate de Fase 0 de `tasks.md` existe
  precisamente para que esto no pueda pasar en desarrollo tampoco.
- **Rollback**: la migración es aditiva — revertir el código deja la tabla
  `order_status_history` sin escritores, inerte. Sin pérdida de datos ni de disponibilidad.

## Spec delta (para `/archive-change`)

Los tres endpoints (`/admin/orders`, `/admin/orders/{id}` con `GET`/`PATCH`) se suman a la
capacidad `ordenes` que inaugura `US-010-orden-webhook-stock-backend`
(`openspec/specs/ordenes/`) — no crean una capacidad nueva. `order_status_history` se
documenta en `openspec/specs/ordenes/decisions.md` como deviación aditiva del DER del E2E
§8, igual que `confirmed_at`/`cancelled_at`.

## Open questions

Las dos preguntas propias de este backend (OQ-BE-1, OQ-BE-2) están en `proposal.md`, con
default implementado; ninguna bloquea el arranque.

## References

- E2E §6.1 (`OrdersModule`), §8 (DER), §9.4 (secuencia de fulfillment), §12 (FSM), §14
  (STRIDE), §17 (NFRs), §18 (observabilidad)
- Change del que depende: [`US-010-orden-webhook-stock-backend/design.md`](../US-010-orden-webhook-stock-backend/design.md)
  §D9 (árbol de `src/orders/`), §D2 (idempotencia por la base — patrón reusado en D4), §D7
  (notificación después del commit — patrón reusado en D7)
- Sibling FE (solo lectura): [`US-012-panel-ordenes-dueno-frontend-web/design.md`](../US-012-panel-ordenes-dueno-frontend-web/design.md)
  §D2 (contrato propuesto, ratificado con la revisión de `sort`), §D7 (por qué un solo
  botón — refuerza por qué el backend también valida un solo paso adelante)
- Precedentes de código: `apps/api/src/products/{products.controller,products.service,
  products.state,dto/product.dto}.ts`, `apps/api/src/common/errors/domain-errors.ts`,
  `apps/api/src/common/filters/http-problem.filter.ts`, `apps/api/src/observability/
  catalog-events.service.ts`, `apps/api/src/auth/e2e-rbac.spec.ts`
- Standards: `backend-node-standards.md` §2-§9 · `api-standards.md` §6, §7.2, §8, §10, §11
  · `security-standards.md` §4, §4.5, §7 · `observability-standards.md` §9 ·
  `testing-standards.md` §14 · `data-architecture-patterns` (evaluación §D2, sin Mode B)
