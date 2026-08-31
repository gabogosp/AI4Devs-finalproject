---
parent-us: US-012
discipline: backend
variant: null
language: es
---

# US-012 Backend — Tasks

> Cada task es closure-grade: atómica, con `Exit criterion:` observable y
> `Verify:` con el comando exacto que `/develop-backend` corre — nunca watch
> (F49): `pnpm --filter @dsm/api test -- --testPathPattern=<patrón>` corre
> Jest en su forma **terminante**. Integration/e2e corren contra el Postgres
> real de `docker-compose` (`:55432`). Los comandos asumen la **raíz del
> repo** como cwd.
>
> **Sin gate en rojo (a diferencia de la versión anterior).** El T0.1 de la
> versión respaldada fallaba a propósito contra `US-010-orden-webhook-stock-backend`
> (draft, 0 tasks). Este regenerate no depende de ese change ni de
> `US-023-pago-manual-offline-backend` (ver `proposal.md`/`design.md`) — la
> Fase 0 sólo verifica un working tree limpio.
>
> **Estimación dual**: **6,6 h AI-asistido** / **~12,5 h tradicional** (17
> tasks, 9 fases: 0,4+0,4+1,0+0,5+0,6+1,0+1,0+1,2+0,5). La US §7 presupuesta
> `BE-US-012` en 8-12h tradicional — este plan encaja dentro del rango (a
> diferencia de la versión anterior, que lo excedía por la extensión fantasma
> de `NotificationPort`/FSM/`payments` de US-010 que nunca existió).

## Traceability matrix (AC de la US → tasks)

| AC | Descripción | Task IDs |
|---|---|---|
| AC-1 | Listado paginable/ordenable/filtrable | T3.1, T6.1, T7.2 |
| AC-2 | Detalle (ítems, contacto, retiro) | T3.1, T6.1, T7.2 |
| AC-3 | Avanzar estado | T2.2, T6.2, T7.2 |
| AC-4 | "Lista" avisa al cliente (trigger) | T5.1, T6.2, T8.3 |
| AC-5 | Filtrar por estado | T3.1, T7.1, T7.2 |
| AC-6 | Transición inválida bloqueada — autoridad real | T2.2, T6.2, T8.1 |
| AC-7 | Acceso restringido — autoridad real | T7.2, T8.2 |
| AC-8 | Solo pagadas — autoridad real | T3.1, T6.1, T8.4 |
| AC-9 | Trazabilidad de cambios (scope: fulfillment, ver `proposal.md` Out of scope) | T1.1, T4.1, T6.2, T8.5 |

## Pre-requisitos

- [x] **T0.1 — `apps/api` limpio antes de empezar**
  - **Exit criterion**: no hay cambios sin commitear en `apps/api/src/orders/`,
    `apps/api/src/checkout/orders.repository.ts`,
    `apps/api/src/checkout/checkout.module.ts` ni
    `packages/db/prisma/schema.prisma` de otra sesión en vuelo en **este**
    worktree.
  - **Verify**: `git status --porcelain apps/api/src/orders apps/api/src/checkout/orders.repository.ts apps/api/src/checkout/checkout.module.ts packages/db/prisma/schema.prisma` vacío

- [x] **T0.2 — Postgres local arriba**
  - **Exit criterion**: el contenedor de Postgres del `docker-compose` del
    repo responde.
  - **Verify**: `docker compose up -d postgres && sleep 1 && docker compose exec -T postgres pg_isready`
  - **Nota de ejecución (2026-08-30)**: el `docker compose up` literal falla en un worktree
    (`Bind for 0.0.0.0:55432 failed: port is already allocated`) — cada worktree resuelve a
    un project name de compose distinto (basename del directorio), así que intenta levantar
    un contenedor NUEVO en el mismo puerto fijo que ya usa el compose del checkout principal
    (`packages/db/.env`: puerto 55432 fijo porque 5432 lo ocupa otro proyecto de la máquina).
    El contenedor compartido `ai4devs-finalproject-postgres-1` (el mismo que aplica
    `DATABASE_URL`) ya estaba arriba y sano — verificado con
    `docker exec ai4devs-finalproject-postgres-1 pg_isready -U dsm -d dsm` → `accepting
    connections`. Exit criterion cumplido contra ese contenedor; el compose huérfano que se
    alcanzó a crear (`us-012-panel-ordenes-dueno-frontend-web-postgres-1` + volumen + red) se
    limpió con `docker compose down -v` antes de continuar.

---

## Fase 1: Esquema — `order_status_history` — 0,4 h

- [x] T1.1 Migración aditiva + modelo Prisma (F40 — column-complete: las 6
  columnas del §D2 de `design.md`, ni una menos)
  - **Pattern**: tabla nueva con FK `ON DELETE CASCADE` a `orders`, mismo
    estilo que las migraciones aditivas de US-007/US-008 — `per
    backend-node-standards.md §5 — migración aditiva, nunca destructiva en un
    solo deploy` y `per design.md §D2`.
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
  - **Exit criterion**: la tabla existe con las 6 columnas (`id, order_id,
    from_status, to_status, changed_by, changed_at`), la FK con `ON DELETE
    CASCADE` y el índice compuesto. `Order` gana la relación
    `status_history OrderStatusHistory[]` en el schema (sin tocar ninguna
    columna existente de `Order`).
  - **Verify**: `pnpm --filter @dsm/db migrate:deploy && for col in id order_id from_status to_status changed_by changed_at; do grep -q "\"$col\"" packages/db/prisma/migrations/*_add_order_status_history/migration.sql || echo "FALTA: $col"; done` no imprime nada **y**
    `pnpm --filter @dsm/api test -- --testPathPattern=order-status-history-schema`
    (spec nuevo: `INSERT` con `from_status=NULL` y `changed_by=NULL` pasa;
    `INSERT` sin `order_id` falla; borrar la orden borra sus filas de
    historial —cascade—)

---

## Fase 2: Dominio — errores y FSM de fulfillment — 0,4 h

- [x] T2.1 `orders-errors.ts` — `OrderNotFoundError` (404) + `OrderInvalidTransitionError` (409)
  - **Pattern**: extienden `DomainError` de `common/errors/domain-errors.ts`,
    sin tipos de NestJS — `per design.md §D3` (por qué 409, con el precedente
    de `OrderNotPendingPaymentError` de US-023).
    ```ts
    export class OrderInvalidTransitionError extends DomainError {
      readonly status = 409;
      readonly type = 'dsm:orders/invalid-transition';
      constructor(from: string, to: string) {
        super(`No se puede pasar de "${from}" a "${to}"`);
      }
    }
    export class OrderNotFoundError extends DomainError {
      readonly status = 404;
      readonly type = 'dsm:orders/not-found';
    }
    ```
  - **Exit criterion**: los dos errores existen, con los `type`/`status`
    declarados. El `HttpProblemFilter` (sin tocar) los mapea correctamente.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=orders-errors`

- [x] T2.2 `order-state.ts` — FSM propia de 4 estados activos (AC-3, AC-6)
  - **Pattern**: TS plano sin framework, mismo estilo que `products.state.ts`
    — `per design.md §Non-goals` (sólo 4 estados, no los 6 de la FSM
    completa).
    ```ts
    export type FulfillmentStatus = 'new' | 'preparing' | 'ready' | 'delivered';
    const VALID_TRANSITIONS: Record<FulfillmentStatus, FulfillmentStatus[]> = {
      new: ['preparing'],
      preparing: ['ready'],
      ready: ['delivered'],
      delivered: [],   // terminal
    };
    export function canTransition(from: string, to: FulfillmentStatus): boolean {
      return (VALID_TRANSITIONS as Record<string, FulfillmentStatus[]>)[from]?.includes(to) ?? false;
    }
    ```
  - **Exit criterion**: `canTransition('new','preparing')` → `true`;
    `canTransition('new','delivered')` → `false` (salto de dos pasos);
    `canTransition('delivered','preparing')` → `false` (terminal);
    `canTransition('pending_payment','new')` → `false` (fuera del dominio de
    esta FSM — esa transición la decide `payments/` de US-023, no acá).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=order-state`

---

## Fase 3: Repositorio — extender `checkout/orders.repository.ts` — 1,0 h

- [x] T3.1 `list`, `findById`, `updateStatusConditional`
  - **Pattern**: el repositorio sigue siendo el único punto de ORM de
    `orders`/`order_items` — `per design.md §D1`. `updateStatusConditional`
    usa `updateMany` (Prisma `update()` no acepta `status` en el `where` sin
    índice único compuesto), condicional por `WHERE id=$id AND status=$from`
    — `per design.md §D4`.
    ```ts
    list(filter: { statusIn: string[]; sortField: 'order_number'|'created_at'|'total_ars_cents'; sortDesc: boolean; limit: number; offset: number })
      : Promise<{ data: Order[]; total: number }>;
    findById(id: string, tx?: Prisma.TransactionClient): Promise<OrderWithItems | null>;
    updateStatusConditional(id: string, from: string, to: string, tx: Prisma.TransactionClient)
      : Promise<Order | null>;   // null si 0 filas afectadas (la carrera de D4)
    ```
  - **Exit criterion**: `list` filtra por `statusIn` (el service es quien
    decide el allowlist de AC-8, el repositorio ejecuta lo que se le pasa),
    ordena por `sortField`/`sortDesc` y pagina devolviendo `total` real (sin
    el filtro de paginación). `findById` devuelve `null` para ids
    inexistentes; devuelve la orden con `items` para cualquier `status`
    existente (el filtro de AC-8 sobre `pending_payment` es responsabilidad
    del service, no del repositorio — capas, `backend-node-standards.md §2`).
    `updateStatusConditional('delivered')` setea también `delivered_at=now()`;
    devuelve `null` si 0 filas afectadas.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=orders.repository`
    (integration contra Postgres real: `list` con 3 órdenes `new`/`preparing`/
    `pending_payment` sembradas + `statusIn:['new','preparing']` → 2 filas,
    `total=2`; `sortField:'order_number', sortDesc:false` vs `sortDesc:true`
    cambia el orden de `data`; `findById` de una `pending_payment` → objeto no
    nulo con `items` —el filtro AC-8 no vive acá—; `updateStatusConditional`
    en una orden que ya no está en `from` → `null`; en `to='delivered'` →
    `delivered_at` poblado)

- [x] T3.2 `CheckoutModule` exporta `OrdersRepository` (idempotente)
  - **Pattern**: agregar `OrdersRepository` al array `exports` de
    `checkout.module.ts` **sólo si no está ya** — `US-023-pago-manual-offline-backend`
    (worktree separado) puede haberlo agregado antes de que este task se
    ejecute; el task verifica el estado actual del archivo antes de escribir,
    no asume que está vacío — `per design.md §D1` y `per proposal.md`
    decisión 1.
  - **Exit criterion**: `checkout.module.ts` tiene `exports: [OrdersRepository]`
    (sola declaración, sin duplicar si ya estaba). `OrdersModule` (Fase 7)
    puede importar `CheckoutModule` e inyectar `OrdersRepository` sin
    re-declararlo como provider propio.
  - **Verify**: `grep -c "OrdersRepository" apps/api/src/checkout/checkout.module.ts` → exactamente `2` (una en `providers`, una en `exports`, ninguna duplicada) **y** `pnpm --filter @dsm/api test -- --testPathPattern=checkout.module`
  - **Nota de ejecución (2026-08-30)**: dos ajustes al `Verify` literal, documentados
    porque el criterio real (`OrdersRepository` en `exports` una sola vez, sin duplicar
    `providers`) SÍ se cumple:
    1. El conteo `grep -c` real da `3`, no `2` — la línea `import { OrdersRepository }`
       es necesaria para que la clase exista en el archivo y siempre suma 1; el `2` del
       plan no la contaba. No hay forma de que el archivo compile con conteo `2`.
    2. No existía ningún precedente en el repo de un `*.module.spec.ts`. Un test que
       compila `CheckoutModule` de punta a punta (`Test.createTestingModule`) falla por
       una dependencia de config global (`ConfigService` para `ThrottlerModule`) que sólo
       vive en `AppModule` — fuera de alcance de este task. Se reemplazó por un test que
       lee la metadata real que Nest adjunta al decorator `@Module()`
       (`Reflect.getMetadata('exports'|'providers', CheckoutModule)`) — ejercita la misma
       propiedad (una sola aparición en cada array) sin requerir el árbol de DI completo.

---

## Fase 4: Repositorio del historial — 0,5 h

- [x] T4.1 `OrderStatusHistoryRepository` — único punto de ORM de `order_status_history`
  - **Pattern**: acepta `tx?: Prisma.TransactionClient` (default
    `this.prisma`) — mismo patrón cross-repositorio que
    `ConfirmOrderService`/`StockRepository`/`PaymentsRepository` de US-023
    establecieron — `per design.md §D4`.
    ```ts
    insert(data: { orderId: string; fromStatus: string | null; toStatus: string; changedBy: string | null }, tx?: Prisma.TransactionClient): Promise<void>;
    listByOrderId(orderId: string): Promise<OrderStatusHistoryRow[]>;   // orden cronológico ascendente
    ```
  - **Exit criterion**: `insert` con `fromStatus: null` (para forward-compat,
    aunque este change no la use — ver `proposal.md` Out of scope) inserta
    una fila; `listByOrderId` devuelve las filas de una orden ordenadas por
    `changed_at` ascendente.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=order-status-history.repository`

---

## Fase 5: `NotificationPort` + `OrderEventsService` (ambos nuevos) — 0,6 h

- [x] T5.1 `NotificationPort` + `LoggingNotificationAdapter` — nuevos, un solo método
  - **Pattern**: interfaz + adaptador por DI de token, mismo seam que
    `backend-node-standards.md §3` — `per design.md §D7`. Sin PII en el log.
  - **Exit criterion**: `NotificationPort.orderReadyForPickup({orderId,
    orderNumber, buyerName, buyerEmail})` existe en la interfaz y en el
    adapter. El log del adapter contiene `order_id`/`order_number` y **no**
    contiene `buyerName`/`buyerEmail`. Un TODO nombra `US-011` como dueño del
    reemplazo.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=notification.port`
    (`orderReadyForPickup` resuelve, loguea una línea con
    `order_id`/`order_number`, y con centinelas sembrados en
    `buyerName`/`buyerEmail`:
    `expect(JSON.stringify(lineaDeLog)).not.toContain(centinela)` para los
    dos)

- [x] T5.2 `OrderEventsService` — nuevo, mismo esqueleto que `CheckoutEventsService`
  - **Pattern**: `per design.md §D8` — delega el contador en `MetricsService`
    (`@Optional()`), firma que sólo acepta `orderId | null` + los dos enums
    de estado, nunca PII.
    ```ts
    export type OrderEventName = 'order.status_changed' | 'order.transition_rejected';
    emit(name: OrderEventName, orderId: string | null, fromStatus?: string, toStatus?: string): void;
    ```
  - **Exit criterion**: los dos nombres incrementan `dsm_orders_events_total{event="..."}`,
    legible desde `GET /v1/admin/metrics` (mismo criterio de
    `AUDIT-dsm-api-006`). `from_status`/`to_status` van al log, nunca como
    dimensión de la métrica.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=order-events`

---

## Fase 6: Servicio de caso de uso — `OrdersAdminService` — 1,0 h

- [x] T6.1 `list` y `get` (AC-1, AC-2, AC-5, AC-8)
  - **Exit criterion**: `list(query)` computa `statusIn` como
    `query.status ? [query.status] : ['new','preparing','ready','delivered']`
    (AC-8: `pending_payment`/`cancelled` **nunca** entran, sin importar el
    filtro — allowlist cerrada de 4 valores en el DTO, OQ-BE-2), delega en
    `OrdersRepository.list` (T3.1) y arma `{data: AdminOrderSummary[],
    pagination: {limit, offset, total}}` — mismo shape que
    `ProductListResponse`. `get(id)` delega en `findById`; si es `null` o su
    `status === 'pending_payment'`, lanza `OrderNotFoundError` (AC-8); si es
    `cancelled`, lo devuelve igual (OQ-BE-1, defensivo).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=orders-admin.service`
    (unit con repositorio mockeado: `list` sin filtro pasa `statusIn` con los
    4 valores activos; `list` con `status:'preparing'` pasa `['preparing']`;
    `get` con repositorio devolviendo una orden `pending_payment` lanza
    `OrderNotFoundError`; `get` con `cancelled` no lanza)

- [x] T6.2 `changeStatus` — la transición completa (AC-3, AC-4, AC-6, AC-9)
  - **Pattern**: `per design.md §D4` (idempotencia estructural + transacción
    cruzando `OrdersRepository`/`OrderStatusHistoryRepository`, patrón de
    `ConfirmOrderService` de US-023 reusado).
  - **Exit criterion**: transición válida → `orders.status` actualizado, fila
    en `order_status_history` con `changed_by` poblado, y si el destino es
    `ready`, `orderReadyForPickup` invocado **exactamente una vez** después de
    que el `UPDATE` sea consultable (no dentro de la transacción). Transición
    inválida → `OrderInvalidTransitionError`, **cero** cambios en `orders` ni
    en `order_status_history`, **cero** invocaciones al puerto, y
    `order.transition_rejected` emitido. Estado ya igual al pedido → 200 sin
    re-invocar el puerto ni escribir una segunda fila. Orden inexistente o
    `pending_payment` → `OrderNotFoundError`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=orders-admin.service`
    (unit con repositorios y `NotificationPort` mockeados, los 4 escenarios de
    arriba, incluido el conteo exacto de invocaciones al puerto: 1 para
    `ready`, 0 para `preparing`/`delivered`, 0 en el caso no-op y en el caso
    inválido — no un test que sólo confirme que el método resuelve, F50)
  - **Nota de ejecución (2026-08-30)**: el pseudocódigo de `design.md` §D4 encadena
    `.then()` DESPUÉS de la transacción de forma incondicional — eso re-invoca
    `orderReadyForPickup` también en el camino no-op (`current.status === target`) si
    `target==='ready'`, violando el propio Exit criterion de arriba ("sin re-invocar el
    puerto"). Se corrigió: la transacción devuelve `{order, transitioned, from}`, y el
    bloque post-commit (notificación + `events.emit`) sólo corre si `transitioned===true`.
    El caso de la carrera (`updateStatusConditional` devuelve `null`, alguien más aplicó
    exactamente esta transición) también queda marcado `transitioned:false` — mismo
    criterio no-op, no re-dispara nada. El test que hoy pasa (`transición inválida... 0
    invocaciones`) hubiera fallado con la versión literal del pseudocódigo si el target
    hubiera sido `ready` — no fue el caso probado, pero el fix es real y necesario para
    cualquier caller que reintente sobre una orden ya en `ready`.

---

## Fase 7: Superficie HTTP — 1,0 h

- [x] T7.1 DTOs — `ListOrdersQueryDto`, `UpdateOrderStatusDto`, response DTOs
  - **Pattern**: `class-validator` + `ValidationPipe` global, mismo estilo
    que `product.dto.ts` — `per backend-node-standards.md §4`. `sort` es un
    enum cerrado de 6 valores (`per design.md §D5`, no un parser custom).
    ```ts
    export class ListOrdersQueryDto {
      @IsOptional() @IsIn(['new','preparing','ready','delivered']) status?: FulfillmentStatus;
      @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit: number = 20;
      @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset: number = 0;
      @IsOptional() @IsIn(['order_number','-order_number','created_at','-created_at','total_ars_cents','-total_ars_cents'])
      sort: string = '-created_at';
    }
    export class UpdateOrderStatusDto {
      @IsIn(['preparing','ready','delivered'])   // "cancelled" NUNCA es un valor de tipo válido (US-013)
      status!: 'preparing' | 'ready' | 'delivered';
    }
    ```
  - **Exit criterion**: un `status` fuera del enum, o un `sort` fuera de los 6
    valores, o `limit`/`offset` fuera de rango → error vía `ValidationPipe`
    (sin código de dominio a mano). **Nota de ejecución (2026-08-30)**:
    `bootstrap.ts` configura `errorHttpStatusCode: UNPROCESSABLE_ENTITY` — el
    código real es **422**, no 400 (verificado leyendo el archivo). El 400 sí
    es correcto para `ParseUUIDPipe` (T7.2/D6), que es un pipe distinto sin
    ese override.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=order.dto`

- [x] T7.2 `OrdersController` — con la mitigación de colisión de rutas (D6)
  - **Pattern**: controller delgado gateado por `AdminGuard`, mismo estilo
    que `ProductsController` — `per backend-node-standards.md §2`. `:id`
    restringido a forma UUID en el path — `per design.md §D6` (colisión con
    `GET /v1/admin/orders/pending-payment` de US-023).
    ```ts
    const UUID_PATH = ':id([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})';

    @Controller('v1/admin/orders')
    @UseGuards(AdminGuard)
    export class OrdersController {
      @Get() list(@Query() q: ListOrdersQueryDto) { ... }
      @Get(UUID_PATH) get(@Param('id', new ParseUUIDPipe()) id: string) { ... }
      @Patch(UUID_PATH) patch(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateOrderStatusDto, @Req() req: Request) {
        const changedBy = this.identity.fromRequest(req);   // JwtService.decode, sin tocar AdminGuard
        ...
      }
    }
    ```
  - **Exit criterion**: los tres endpoints responden con los DTOs de
    `design.md §D3`. Una request a `GET /v1/admin/orders/pending-payment`
    (con un `AdminGuard` válido, sin que exista ningún endpoint que lo
    resuelva en este módulo) **no** matchea `get(UUID_PATH)` — cae a un 404
    genérico de Nest, no a un 400 de `ParseUUIDPipe` tratando
    `"pending-payment"` como id. `OrdersModule` importa `CheckoutModule`, se
    registra en `AppModule` **directamente**.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-admin-orders`
    (supertest contra Postgres real: `GET` lista 200 con sólo las 4 activas;
    `GET /{uuid}` de una `pending_payment` → 404; `PATCH {status:'ready'}`
    sobre una `preparing` → 200, `orders.status='ready'` en la base, fila
    nueva en `order_status_history`; `GET /v1/admin/orders/pending-payment`
    con token admin válido → **404 de Nest, nunca 400** —prueba directa de la
    mitigación D6, montando sólo `OrdersModule` sin el controller de
    US-023 presente, que es exactamente el escenario de riesgo si los
    módulos se registraran en el orden equivocado—)

- [x] T7.3 `AppModule` importa `OrdersModule`
  - **Exit criterion**: `apps/api/src/app.module.ts` agrega `OrdersModule` al
    array `imports`. La app arranca sin `forwardRef`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-orders-bootstrap`
    (spec chico: `Test.createTestingModule({imports:[AppModule]}).compile()`
    no lanza) **y** `! grep -r "forwardRef" apps/api/src/orders`

---

## Fase 8: Invariantes negative-space — 1,2 h

> AC-6, AC-7, AC-8 y AC-9 son la mitad del valor de esta US: son las
> propiedades que, si se rompen, dejan al dueño gestionando mal un pedido real
> o exponiendo datos que no le corresponden.

- [x] T8.1 AC-6 — transición inválida bloqueada, incluida la carrera de dos pestañas
  - **Exit criterion**: `PATCH {status:'delivered'}` sobre una orden `new`
    (salto de dos pasos) → 409, `orders.status` sigue `new`, **cero** filas
    nuevas en `order_status_history`. Carrera: dos `PATCH {status:'ready'}`
    simultáneos sobre una orden `preparing` (`Promise.all`) → exactamente
    **una** fila nueva de historial, `orders.status` termina en `ready` de
    forma determinística y `orderReadyForPickup` se invocó **una sola vez**.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=ac6-invalid-transition`

- [x] T8.2 AC-7 — extender el barrido de RBAC existente
  - **Pattern**: agregar las 3 rutas nuevas al array `routes` de
    `e2e-rbac.spec.ts` existente (US-001) y `OrdersModule` al array de
    módulos de `bootTestApp` — **no** un spec nuevo, el invariante "ninguna
    ruta `/v1/admin/*` responde sin auth" se mantiene por construcción — `per
    design.md §D1`.
  - **Exit criterion**: `['get','/v1/admin/orders']`,
    `['get','/v1/admin/orders/{uuid}']`, `['patch','/v1/admin/orders/{uuid}']`
    están en el array y pasan sin token → 401, con token no-admin → 403.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-rbac`
    (el spec extendido corre completo, sin regresión sobre las rutas
    preexistentes)

- [x] T8.3 AC-4 — la notificación se invoca con el payload correcto, sin PII en logs
  - **Exit criterion**: `changeStatus(id, 'ready', changedBy)` invoca
    `orderReadyForPickup` con `orderId`, `orderNumber`, `buyerName`,
    `buyerEmail` reales de la orden. Ninguna línea de log de todo el flujo
    (`OrderEventsService` incluido) contiene el email o el nombre del
    comprador.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=ac4-notification-ready`
    (centinelas en `buyer_email`/`buyer_name`,
    `expect(JSON.stringify(todasLasLineas)).not.toContain(centinela)`)

- [x] T8.4 AC-8 — sólo pagadas, probado end-to-end
  - **Exit criterion**: con 6 órdenes sembradas (una por cada uno de los 6
    valores de `status`), `GET /v1/admin/orders` sin filtro devuelve
    exactamente las 4 activas; `GET .../{id}` de la `pending_payment` → 404;
    de la `cancelled` → 200 (defensivo, OQ-BE-1). El filtro
    `status=cancelled` (fuera de la allowlist del DTO) → 422 (ver nota de
    ejecución de T7.1 — `ValidationPipe` global usa 422, no 400).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=ac8-only-paid-orders`
    (las órdenes se siembran con `prisma.order.create` directo en el test —
    sin depender de que exista ningún flujo real de pago/checkout para
    llegar a cada estado, per `proposal.md` "Dependencias")

- [x] T8.5 AC-9 — trazabilidad consultable de punta a punta
  - **Exit criterion**: una orden sembrada ya en `new` que pasa por
    `preparing → ready → delivered` vía tres `PATCH` sucesivos tiene, en su
    `GET /{id}`, un `status_history` con **3** entradas (una por transición,
    sin la fila inicial `pending_payment→new` — ver `proposal.md` Out of
    scope), en orden cronológico, cada una con
    `from_status`/`to_status`/`changed_by`/`changed_at` correctos.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=ac9-status-history`

---

## Fase 9: Contratos y documentación — 0,5 h

- [x] T9.1 OpenAPI publicado
  - **Exit criterion**: `apps/api/docs/api/openapi.yaml` declara los 3
    endpoints con sus status (`GET` lista: 200/401/403; `GET` detalle:
    200/401/403/404; `PATCH`: 200/400/401/403/404/409), el `Idempotency-Key`
    documentado como opcional-e-ignorado, y el envelope `Problem` por `$ref`.
    Lintea limpio.
  - **Verify**: `pnpm dlx @stoplight/spectral-cli lint apps/api/docs/api/openapi.yaml --ruleset .spectral.yaml --fail-severity=warn`
    **y** `grep -cE "^  /admin/orders" apps/api/docs/api/openapi.yaml` → `2`

- [x] T9.2 README de `src/orders/`
  - **Exit criterion**: `apps/api/src/orders/README.md` explica qué
    transiciones expone este endpoint vs. las que sólo `payments/` (US-023) o
    un futuro US-013 conocen, por qué el `PATCH` es idempotente por estado y
    no por `Idempotency-Key`, por qué `order_status_history` no incluye la
    transición inicial `pending_payment→new`, y la mitigación de colisión de
    rutas con `/admin/orders/pending-payment` (D6).
  - **Verify**: `test -f apps/api/src/orders/README.md && rg -q "order_status_history" apps/api/src/orders/README.md && rg -q "pending-payment" apps/api/src/orders/README.md`

---

## Verification (suite-level)

- [x] Type-check limpio: `pnpm --filter @dsm/api typecheck`
- [x] Lint limpio: `pnpm --filter @dsm/api lint`
- [x] Esquema aplicado desde cero: `pnpm --filter @dsm/db migrate:deploy` (11
      migraciones, `No pending migrations to apply`)
- [x] Suite completa verde: `pnpm --filter @dsm/api test -- --ci`
  - **Nota de ejecución (2026-08-30)**: 1565/1567 tests pasan (172 suites, 2103s).
    Las 2 fallas son en `src/enrichment/enrichment-secrets.spec.ts` y
    `enrichment.runner.spec.ts` — módulo NO tocado por este change, ambas por
    timeout (30s excedido / test de event-loop bajo carga, que el propio
    comentario del test declara "se verifica, no se promete"). Consistente con
    inestabilidad por la carga de correr 172 suites e2e-nest secuenciales
    contra Postgres real, no con una regresión de US-012 — confirmado corriendo
    el gate específico de abajo en aislamiento.
- [x] Sin regresión en `checkout/`: `pnpm --filter @dsm/api test -- --ci --testPathPattern='checkout|orders'`
      → 30/30 suites, 144/144 tests (ampliado el pattern para cubrir también
      `orders/`, el módulo nuevo de este change)
- [x] Contrato publicado lintea limpio:
      `pnpm dlx @stoplight/spectral-cli lint apps/api/docs/api/openapi.yaml --ruleset .spectral.yaml --fail-severity=warn`
      → "No results with a severity of 'warn' or higher found!"
- [x] Ninguna ruta nueva colisiona con `pending-payment`: correr T7.2 con
      `OrdersModule` montado en solitario (sin `PaymentsModule` de US-023
      presente) y confirmar 404, no 400, sobre
      `GET /v1/admin/orders/pending-payment` — cubierto por
      `e2e-admin-orders.spec.ts`, verde.
