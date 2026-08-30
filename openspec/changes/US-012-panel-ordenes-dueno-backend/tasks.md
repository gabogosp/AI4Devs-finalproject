---
parent-us: US-012
discipline: backend
variant: null
language: es
---

# US-012 Backend — Tasks

> Cada task es closure-grade: atómica, con `Exit criterion:` observable y `Verify:` con el
> comando exacto que `/develop-backend` corre — nunca watch (F49):
> `pnpm --filter @dsm/api test -- --testPathPattern=<patrón>` corre Jest en su forma
> **terminante**. Integration/e2e corren contra el Postgres real de `docker-compose`
> (`ai4devs-finalproject-postgres-1`, host `:55432`). Los comandos asumen la **raíz del
> repo** como cwd.
>
> **Estimación dual**: **7,0 h AI-asistido** / **~13,3 h tradicional** (19 tasks, suma de
> las fases: 0,5 + 0,4 + 1,2 + 0,8 + 1,0 + 1,0 + 1,2 + 0,4 + 0,5). La US §7 presupuesta
> `BE-US-012` en 8-12 h tradicional: el plan excede el techo ~1,3 h por tres cosas que la
> US resume en una línea cada una — extender `NotificationPort` (nuevo método +
> adaptador, US-010 dejó dos, éste agrega el tercero), `order_status_history` como tabla
> transaccional (no una reconstrucción de columnas puntuales, per OQ-FE-1 ratificada) y la
> idempotencia estructural del `PATCH` (`UPDATE` condicional + relectura, per D4 — la
> alternativa barata de un `if` no sobrevive a la carrera de dos pestañas de AC-6). La FSM,
> `AdminGuard` y el filtro RFC 7807 ya los deja construidos US-010, así que el CRUD en sí
> son ~2 h.

## Traceability matrix (AC de la US → tasks)

| AC | Descripción | Task IDs |
|---|---|---|
| AC-1 | Listado paginable/ordenable/filtrable | T3.1, T5.1, T6.1 |
| AC-2 | Detalle (ítems, contacto, retiro) | T3.1, T5.1, T6.1 |
| AC-3 | Avanzar estado | T5.2, T6.1 |
| AC-4 | "Lista" avisa al cliente (trigger) | T4.1, T5.2, T7.3 |
| AC-5 | Filtrar por estado | T3.1, T6.1 |
| AC-6 | Transición inválida bloqueada — autoridad real | T2.1, T5.2, T7.1 |
| AC-7 | Acceso restringido — autoridad real | T6.1, T7.2 |
| AC-8 | Solo pagadas — autoridad real | T3.1, T7.4 |
| AC-9 | Trazabilidad de cambios | T1.1, T3.1, T4.2, T7.5 |

## Pre-requisitos

- [ ] **T0.1 — Gate: `US-010-orden-webhook-stock-backend` construido**
  - Este change extiende `src/orders/` y necesita `order-state.ts` (la FSM),
    `orders.confirmed_at`/`cancelled_at`, `payments` y `NotificationPort` — ninguno existe
    hoy (verificado 2026-08-30: `apps/api/src/orders/` no existe;
    `US-010-orden-webhook-stock-backend` está `draft`, 0 tasks cerradas).
  - **Exit criterion**: `apps/api/src/orders/order-state.ts` existe y exporta
    `canTransition`; `packages/db/prisma/schema.prisma` declara `Order.confirmed_at` y
    `Order.cancelled_at`; `apps/api/src/orders/ports/notification.port.ts` existe.
  - **Verify**: `test -f apps/api/src/orders/order-state.ts && rg -q "confirmed_at" packages/db/prisma/schema.prisma && rg -q "cancelled_at" packages/db/prisma/schema.prisma && test -f apps/api/src/orders/ports/notification.port.ts`
    (hoy los cuatro fallan — esta task **falla a propósito** hasta que US-010 aterrice;
    ninguna task de las Fases 1+ puede cerrarse mientras esta siga en rojo, mismo patrón
    que el T0.1 del plan de FE)
- [ ] **T0.2 — `apps/api` limpio antes de empezar**
  - **Exit criterion**: no hay cambios sin commitear en `apps/api/src/orders/`,
    `apps/api/src/payments/confirm-order.service.ts` ni
    `packages/db/prisma/schema.prisma` de otra sesión en vuelo.
  - **Verify**: `git status --porcelain apps/api/src/orders apps/api/src/payments/confirm-order.service.ts packages/db/prisma/schema.prisma` vacío

---

## Fase 1: Esquema — `order_status_history` — 0,5 h

- [ ] T1.1 Migración aditiva + modelo Prisma
  - **Pattern**: tabla nueva con FK `ON DELETE CASCADE` a `orders`, igual estilo que las
    migraciones aditivas de US-007/US-008 — `per backend-node-standards.md §5 — migración
    aditiva, nunca destructiva en un solo deploy` y `per design.md §D2`.
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
  - **Exit criterion**: la tabla existe con las 5 columnas, la FK con `ON DELETE CASCADE`
    y el índice compuesto. `Order` gana la relación `status_history OrderStatusHistory[]`
    en el schema (sin tocar ninguna columna existente de `Order`).
  - **Verify**: `pnpm --filter @dsm/db migrate:deploy && pnpm --filter @dsm/api test -- --testPathPattern=order-status-history-schema`
    (spec nuevo: `INSERT` con `from_status=NULL` pasa; `INSERT` sin `order_id` falla;
    borrar la orden borra sus filas de historial —cascade—; el índice
    `order_status_history_order_id_changed_at_idx` aparece en `pg_indexes`)

---

## Fase 2: Dominio — errores y parser de `sort` — 0,4 h

- [ ] T2.1 `orders-errors.ts` — `OrderNotFoundError` (404) + `OrderInvalidTransitionError` (409)
  - **Pattern**: mismo estilo que `checkout-errors.ts` — extienden `DomainError`, sin
    tipos de NestJS — `per design.md §D3` (por qué 409 y no el 422 de productos).
    ```ts
    export class OrderInvalidTransitionError extends DomainError {
      readonly status = 409;
      readonly type = 'dsm:orders/invalid-transition';
      constructor(from: string, to: string) {
        super(`No se puede pasar de "${from}" a "${to}"`);
      }
    }
    ```
  - **Exit criterion**: los dos errores existen, con los `type`/`status` declarados. El
    `HttpProblemFilter` (sin tocar — es genérico) los mapea correctamente.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=orders-errors`
    (`mapErrorToProblem(new OrderInvalidTransitionError('new','delivered'), '/x').status === 409`
    y `.type === 'dsm:orders/invalid-transition'`; ídem `OrderNotFoundError` → 404,
    `dsm:orders/not-found`)

- [ ] T2.2 `parseSort` — parser puro del query param `sort`
  - **Pattern**: función pura, sin framework — `per design.md §D5` (revisión de OQ-FE-3,
    `api-standards.md §7.2`).
    ```ts
    const SORTABLE = ['order_number', 'confirmed_at', 'total_ars_cents'] as const;
    export function parseSort(raw: string | undefined): { field: string; desc: boolean }
    ```
  - **Exit criterion**: `undefined` → `{field:'confirmed_at', desc:true}` (default);
    `'-confirmed_at'` → `{field:'confirmed_at', desc:true}`; `'order_number'` →
    `{field:'order_number', desc:false}`; `'-precio'` (campo fuera de la allowlist) →
    lanza `ValidationError` con `field: 'sort'`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=parse-sort`

---

## Fase 3: Repositorio — extender `OrdersRepository` — 1,2 h

- [ ] T3.1 `list`, `findDetailById`, `applyStatusChange`
  - **Pattern**: el repositorio envuelve Prisma; el service no llama a `PrismaService`
    directo — `per backend-node-standards.md §5`. El `UPDATE` de `applyStatusChange` es
    **condicional** por `WHERE id=$id AND status=$from` (protege la carrera de dos
    pestañas, `per design.md §D4`) y corre en la **misma transacción** que el `INSERT` en
    `order_status_history`.
    ```ts
    list(filter: { status?: string[]; sort: {field:string; desc:boolean}; limit: number; offset: number })
      : Promise<{ data: OrderWithSummary[]; total: number }>;
    findDetailById(id: string): Promise<OrderWithItemsAndHistory | null>;   // null si no existe O si status='pending_payment'
    applyStatusChange(id: string, from: string, to: string)
      : Promise<'applied' | 'already_applied' | 'conflict'>;
    ```
  - **Exit criterion**: `list` excluye siempre `pending_payment`/`cancelled` (AC-8),
    respeta `status` (allowlist de 4 valores), ordena por el campo/dirección de
    `parseSort` y pagina con `limit`/`offset` devolviendo `total` real (sin el filtro de
    paginación). `findDetailById` devuelve `null` para `pending_payment` y para ids
    inexistentes; sí devuelve `cancelled`/`delivered`. `applyStatusChange` devuelve
    `'applied'` cuando el `UPDATE` afectó 1 fila (y escribió el historial),
    `'already_applied'` cuando 0 filas afectadas pero el estado actual ya es `to`, y
    `'conflict'` cuando 0 filas afectadas y el estado actual es distinto de `from` y de
    `to`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=orders.repository`
    (integration contra Postgres real: `list` con 3 órdenes `new`/`preparing`/
    `pending_payment`/`cancelled` sembradas → devuelve sólo las 2 activas, `total=2`;
    `sort=order_number` ascendente vs `-order_number` descendente cambia el orden de
    `data`; `findDetailById` de una `pending_payment` → `null`; de una `cancelled` →
    objeto no nulo; `applyStatusChange('new'→'preparing')` en una orden `preparing` →
    `'already_applied'` y **cero** filas nuevas en `order_status_history`;
    `applyStatusChange('new'→'preparing')` en una orden ya `ready` → `'conflict'`)

---

## Fase 4: `NotificationPort` + historial inicial — 0,8 h

- [ ] T4.1 `NotificationPort` gana `orderReadyForPickup`
  - **Pattern**: mismo seam que `orderConfirmed`/`orderCancelledNoStock` de US-010 — el
    archivo del puerto se **extiende**, `LoggingNotificationAdapter` implementa el método
    nuevo sin loguear PII — `per design.md §D7`.
  - **Exit criterion**: `NotificationPort.orderReadyForPickup({orderId, orderNumber,
    buyerName, buyerEmail})` existe en la interfaz y en el adapter. El log del adapter
    contiene `order_id`/`order_number` y **no** contiene `buyerName`/`buyerEmail`. El TODO
    nombra `US-011` como dueño del reemplazo (igual que los otros dos métodos).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=notification.port`
    (spec de US-010 extendido: `orderReadyForPickup` resuelve, loguea una línea con
    `order_id`/`order_number`, y `expect(JSON.stringify(lineaDeLog)).not.toContain(email
    centinela)` / `.not.toContain(nombre centinela)`)

- [ ] T4.2 Extender `ConfirmOrderService` (de US-010): fila inicial de historial
  - **Ubicación**: `apps/api/src/payments/confirm-order.service.ts` — archivo de US-010,
    extendido acá con el mínimo diff posible (una llamada más dentro de la transacción
    existente, `per proposal.md` "Extiende, no redefine").
  - **Exit criterion**: cuando la transacción de confirmación transiciona
    `pending_payment → new`, se inserta —**dentro de la misma transacción**— una fila en
    `order_status_history` con `from_status: null, to_status: 'new'`. Ningún otro cambio
    de comportamiento del servicio (los tests existentes de US-010 sobre
    `confirm-order.service` siguen pasando sin editarse salvo la aserción nueva).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=confirm-order.service`
    (test existente de US-010 + una aserción nueva: tras confirmar,
    `order_status_history` tiene exactamente 1 fila para esa orden con
    `from_status=null, to_status='new'`; el caso `already_processed` —pago ya
    `approved`— **no** agrega una segunda fila)

---

## Fase 5: Servicio de caso de uso — `OrdersAdminService` — 1,0 h

- [ ] T5.1 `list` y `get`
  - **Exit criterion**: `list(query)` valida `status`/`sort`/`limit`/`offset` (usa
    `parseSort` de T2.2), delega en el repositorio (T3.1) y arma
    `{data: AdminOrderSummary[], pagination: {limit, offset, total}}` —mismo shape que
    `ProductListResponse`—. `get(id)` delega en `findDetailById`; si devuelve `null`,
    lanza `OrderNotFoundError`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=orders-admin.service`
    (unit con repositorio mockeado: `list` propaga el filtro parseado; `get` con
    repositorio devolviendo `null` lanza `OrderNotFoundError`)

- [ ] T5.2 `changeStatus` — la transición completa (AC-3, AC-4, AC-6)
  - **Pattern**: idempotencia estructural — `per design.md §D4`.
    ```ts
    async changeStatus(id: string, target: OrderAdminStatus): Promise<AdminOrderDetail> {
      const current = await this.repo.findDetailById(id) ?? throw new OrderNotFoundError();
      if (current.status === target) return toDetailDto(current);           // no-op
      if (!canTransition(current.status, target)) throw new OrderInvalidTransitionError(current.status, target);
      const outcome = await this.repo.applyStatusChange(id, current.status, target);
      if (outcome === 'conflict') throw new OrderInvalidTransitionError(current.status, target);
      const updated = await this.repo.findDetailById(id);
      if (target === 'ready') await this.notifications.orderReadyForPickup({...});
      this.events.emit('order.status_changed', id, 'admin', undefined, { from_status: current.status, to_status: target });
      return toDetailDto(updated);
    }
    ```
  - **Exit criterion**: transición válida → `orders.status` actualizado, fila en
    `order_status_history`, y si el destino es `ready`, `orderReadyForPickup` invocado
    **exactamente una vez** después de que el `UPDATE` sea consultable (no dentro de la
    transacción). Transición inválida (`canTransition` rechaza) → `OrderInvalidTransitionError`,
    **cero** cambios en `orders` ni en `order_status_history`, **cero** invocaciones al
    puerto. Estado ya igual al pedido → 200 sin re-invocar el puerto ni escribir una
    segunda fila de historial. Orden inexistente → `OrderNotFoundError`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=orders-admin.service`
    (unit con repositorio y `NotificationPort` mockeados, los 4 escenarios de arriba,
    incluido el conteo exacto de invocaciones al puerto: 1 para `ready`, 0 para
    `preparing`/`delivered`, 0 en el caso no-op y en el caso inválido)

---

## Fase 6: Superficie HTTP — 1,0 h

- [ ] T6.1 `OrdersController` + DTOs + wiring
  - **Pattern**: controller delgado (valida vía DTO, delega, mapea respuesta) gateado por
    `AdminGuard` — igual forma que `ProductsController` — `per backend-node-standards.md
    §2`.
    ```ts
    @Controller('v1/admin/orders')
    @UseGuards(AdminGuard)
    export class OrdersController {
      @Get() list(@Query() q: ListOrdersQueryDto) { ... }
      @Get(':id') get(@Param('id', new ParseUUIDPipe()) id: string) { ... }
      @Patch(':id') patch(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateOrderStatusDto) { ... }
    }
    ```
    `UpdateOrderStatusDto.status` con `@IsIn(['preparing','ready','delivered'])` —
    `cancelled` no es un valor aceptable a nivel de tipo, no sólo de lógica.
  - **Exit criterion**: los tres endpoints responden con los DTOs de `design.md §D3`.
    `OrdersModule` los registra y `AppModule` importa `OrdersModule` **directamente**
    (`per design.md §D1` — no depender de que llegue transitivo vía `PaymentsModule`).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-admin-orders`
    (`e2e-admin-orders.spec.ts` con supertest, contra Postgres real, sembrando órdenes en
    los 4 estados activos + una `pending_payment` + una `cancelled`: `GET` lista 200 con
    sólo las activas y `pagination.total` correcto; `GET /{id}` de la `pending_payment` →
    404; `PATCH` con `status='ready'` sobre una `preparing` → 200, `orders.status='ready'`
    en la base, y una fila nueva en `order_status_history`)

---

## Fase 7: Invariantes negative-space — 1,2 h

> AC-6, AC-7, AC-8 y AC-9 son la mitad del valor de esta US (igual razón que la Fase 6 de
> US-010): son las propiedades que, si se rompen, dejan al dueño gestionando mal un pedido
> real o exponiendo datos que no le corresponden.

- [ ] T7.1 AC-6 — transición inválida bloqueada, incluida la carrera de dos pestañas
  - **Exit criterion**: `PATCH {status:'delivered'}` sobre una orden `new` (salto de dos
    pasos) → 409, `orders.status` sigue `new`, **cero** filas nuevas en
    `order_status_history`. Carrera: dos `PATCH {status:'ready'}` simultáneos sobre una
    orden `preparing` (`Promise.all`) → exactamente **una** fila nueva de historial, un
    solo 200 "real" y el otro request también 200 (idempotente, D4) o 409 según el orden
    de llegada, pero `orders.status` termina en `ready` de forma determinística y
    `orderReadyForPickup` se invocó **una sola vez**.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=ac6-invalid-transition`

- [ ] T7.2 AC-7 — extender el barrido de RBAC existente
  - **Pattern**: agregar las 3 rutas nuevas al array `routes` de `e2e-rbac.spec.ts`
    existente (US-001) — **no** un spec nuevo, el invariante "ninguna ruta `/v1/admin/*`
    responde sin auth" se mantiene por construcción — `per design.md §D9`.
  - **Exit criterion**: `['get','/v1/admin/orders']`, `['get','/v1/admin/orders/{uuid}']`,
    `['patch','/v1/admin/orders/{uuid}']` están en el array y pasan sin token → 401, con
    token no-admin → 403, igual que las rutas existentes.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-rbac`
    (el spec extendido corre completo, incluidas las rutas preexistentes — no hay
    regresión sobre lo que ya cubría)

- [ ] T7.3 AC-4 — la notificación se invoca con el payload correcto, sin PII en logs
  - **Exit criterion**: `changeStatus(id, 'ready')` invoca `orderReadyForPickup` con
    `order_id`, `order_number`, `buyer_name`, `buyer_email` reales de la orden. Ninguna
    línea de log de todo el flujo (`OrderEventsService` incluido) contiene el email o el
    nombre del comprador.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=ac4-notification-ready`
    (con centinelas sembrados en `buyer_email`/`buyer_name`,
    `expect(JSON.stringify(todasLasLineas)).not.toContain(centinela)` para los dos)

- [ ] T7.4 AC-8 — sólo pagadas, probado end-to-end
  - **Exit criterion**: con 6 órdenes sembradas (una por estado de la FSM, incluida
    `pending_payment` y `cancelled`), `GET /v1/admin/orders` sin filtro devuelve
    exactamente las 4 activas; `GET .../{id}` de la `pending_payment` → 404; de la
    `cancelled` → 200 (defensivo, D6). El filtro `status=cancelled` (fuera de la
    allowlist del DTO) → 400, no 200 con la orden cancelada.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=ac8-only-paid-orders`

- [ ] T7.5 AC-9 — trazabilidad consultable de punta a punta
  - **Exit criterion**: una orden que pasa por `new → preparing → ready → delivered` vía
    tres `PATCH` sucesivos tiene, en su `GET /{id}`, un `status_history` con **4** entradas
    (la inicial `null→new` de T4.2 + las 3 transiciones), en orden cronológico, cada una
    con `from_status`/`to_status`/`changed_at` correctos.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=ac9-status-history`

---

## Fase 8: Observabilidad — 0,4 h

- [ ] T8.1 `OrderEventsService` (de US-010) gana `order.status_changed` y `order.transition_rejected`
  - **Pattern**: mismo servicio, mismo `metrics?.increment('orders', name)` —
    `per design.md §D8` y `per AUDIT-dsm-api-006` (el contador tiene que ser legible desde
    `GET /v1/admin/metrics`, no sólo un `Map` privado).
  - **Exit criterion**: los dos nombres tipan en el union type del servicio; `emit` los
    acepta y el valor sale por `MetricsService.render()` como
    `dsm_orders_events_total{event="order.status_changed"}` (y análogo para
    `transition_rejected`). Los campos `from_status`/`to_status` van al log, nunca como
    dimensión de la métrica.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=order-events`
    (spec de US-010 extendido: los 2 nombres nuevos incrementan y aparecen en
    `MetricsService.render()`)

---

## Fase 9: Contratos y documentación — 0,5 h

- [ ] T9.1 OpenAPI publicado
  - **Exit criterion**: `apps/api/docs/api/openapi.yaml` declara los 3 endpoints con sus
    status (`GET` lista: 200/401/403; `GET` detalle: 200/401/403/404; `PATCH`:
    200/400/401/403/404/409), el `Idempotency-Key` documentado como opcional-e-ignorado
    (con la razón, `per design.md §D4`), y el envelope `Problem` por `$ref`. Lintea
    limpio.
  - **Verify**: `pnpm dlx @stoplight/spectral-cli lint apps/api/docs/api/openapi.yaml --ruleset .spectral.yaml --fail-severity=warn`
    **y** `grep -E "^  /admin/orders" apps/api/docs/api/openapi.yaml | wc -l` → `2` (esto
    es lo mismo que el gate T0.1 del plan de FE verifica — al cerrar esta task, ese gate
    deja de fallar)

- [ ] T9.2 README de `src/orders/`
  - **Exit criterion**: `apps/api/src/orders/README.md` (si no existe, créalo; si US-010
    ya lo dejó, extiéndelo ≤ 15 líneas más) explica qué transiciones expone este endpoint
    vs. las que sólo `order-state.ts` conoce (US-013), por qué el `PATCH` es idempotente
    por estado y no por `Idempotency-Key`, y por qué `order_status_history` es una tabla
    propia y no una reconstrucción de columnas puntuales.
  - **Verify**: `test -f apps/api/src/orders/README.md && rg -q "order_status_history" apps/api/src/orders/README.md && rg -q "idempotente" apps/api/src/orders/README.md`

---

## Verification (suite-level)

- [ ] Type-check limpio: `pnpm --filter @dsm/api typecheck`
- [ ] Lint limpio: `pnpm --filter @dsm/api lint`
- [ ] Esquema aplicado desde cero: `pnpm --filter @dsm/db migrate:deploy`
- [ ] Suite completa verde: `pnpm --filter @dsm/api test -- --ci`
- [ ] Sin regresión en lo que este change tocó de US-010:
      `pnpm --filter @dsm/api test -- --ci --testPathPattern='confirm-order.service|notification.port|order-events|order-state'`
- [ ] Contrato publicado lintea limpio:
      `pnpm dlx @stoplight/spectral-cli lint apps/api/docs/api/openapi.yaml --ruleset .spectral.yaml --fail-severity=warn`
- [ ] **Gate para el FE**: `grep -E "^  /admin/orders" apps/api/docs/api/openapi.yaml | wc -l` → `2` (desbloquea el T0.1 de `US-012-panel-ordenes-dueno-frontend-web`)
