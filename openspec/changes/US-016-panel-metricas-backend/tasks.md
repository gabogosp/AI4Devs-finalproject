---
parent-us: US-016
discipline: backend
variant: null
language: es
---

# US-016 Backend — Tasks

> Cada task es closure-grade: atómica, con `Exit criterion:` observable y
> `Verify:` con el comando exacto que `/develop-backend` corre — nunca watch
> (F49): `pnpm --filter @dsm/api test -- --testPathPattern=<patrón>` corre
> Jest en su forma **terminante**. Integration/e2e corren contra el Postgres
> real de `docker-compose`. Los comandos asumen la **raíz del repo** como cwd.
>
> **Sin gate en rojo.** `orders`/`order_items` existen desde US-008;
> `AdminGuard`/`HttpProblemFilter` desde US-001; `ORDER_RETENTION_MONTHS`
> desde US-021 (archivada). Nada de este plan depende de un change en curso.
>
> **Estimación dual**: **~8,0 h AI-asistido** / **~15,2 h tradicional** (23
> tasks, 9 fases). La US §7 presupuesta `BE-US-016` en 6-10h tradicional —
> este plan excede el techo ~5h por trabajo que la US no desglosa al
> describirla como "endpoints de agregación": 3 endpoints de export CSV
> completos (no una nota al pie de los 3 de lectura), el servicio de eventos
> dedicado (US §9 exige registrar uso del panel) y el refactor de extracción
> de `csvCell` a un utilitario compartido (D3 de `design.md`) son trabajo
> real que la US no menciona explícitamente. La agregación en sí —3 queries
> `$queryRaw` + su orquestación— son ~4h de las ~15,2h.

## Traceability matrix (AC de la US → tasks)

| AC | Descripción | Task IDs |
|---|---|---|
| AC-1 | Evolución de ventas en el tiempo | T3.1, T5.1, T6.2 |
| AC-2 | Productos más pedidos | T3.2, T5.2, T6.2 |
| AC-3 | Resumen del período (órdenes, monto, desglose por estado) | T3.3, T5.3, T6.2 |
| AC-4 | Elegir el rango temporal | T1.3, T6.1 |
| AC-5 | Período sin datos → sin error | T5.3, T7.1 |
| AC-6 | Exportar datos crudos (CSV) | T2.1, T5.1, T5.2, T5.3, T6.2, T7.5 |
| AC-7 | Acceso restringido — autoridad real | T6.2, T7.2 |
| AC-8 | Sólo órdenes pagadas cuentan — autoridad real | T1.1, T3.1, T3.2, T3.3, T7.3 |
| AC-9 | Histórico limitado a 12 meses | T1.3, T7.4 |

## Pre-requisitos

- [ ] **T0.1 — `apps/api` limpio antes de empezar**
  - **Exit criterion**: no hay cambios sin commitear en `apps/api/src/reports/`,
    `apps/api/src/common/csv/`, `apps/api/src/imports/report-csv.ts`,
    `apps/api/src/observability/report-events.service.ts`,
    `apps/api/src/app.module.ts` ni `apps/api/docs/api/openapi.yaml` de otra
    sesión en vuelo en **este** worktree.
  - **Verify**: `git status --porcelain apps/api/src/reports apps/api/src/common/csv apps/api/src/imports/report-csv.ts apps/api/src/observability/report-events.service.ts apps/api/src/app.module.ts apps/api/docs/api/openapi.yaml` vacío

- [ ] **T0.2 — Postgres local arriba**
  - **Exit criterion**: el contenedor de Postgres del `docker-compose` del
    repo responde.
  - **Verify**: `docker compose exec -T postgres pg_isready -U dsm -d dsm || (docker compose up -d postgres && sleep 1 && docker compose exec -T postgres pg_isready -U dsm -d dsm)`

---

## Fase 1: Dominio — allowlist de "venta", errores, rango temporal — 0,8 h

- [x] T1.1 `sale-statuses.ts` — allowlist de estados que cuentan como venta (AC-8)
  - **Pattern**: const `as const` + tipo derivado, mismo estilo que
    `FulfillmentStatus` de `orders/order-state.ts` — `per design.md §D2`
    (misma allowlist de 4 estados que `OrdersAdminService.list`, `cancelled`
    deliberadamente afuera).
    ```ts
    export const SALE_STATUSES = ['new', 'preparing', 'ready', 'delivered'] as const;
    export type SaleStatus = (typeof SALE_STATUSES)[number];
    ```
  - **Exit criterion**: `SALE_STATUSES` tiene exactamente 4 elementos, ninguno
    `pending_payment` ni `cancelled`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=sale-statuses`
    (spec chico: `expect(SALE_STATUSES).toEqual(['new','preparing','ready','delivered'])`
    — no sólo que el módulo importe, F50)

- [x] T1.2 `reports-errors.ts` — `ReportsInvalidRangeError` (422)
  - **Pattern**: extiende `DomainError` de `common/errors/domain-errors.ts`,
    sin tipos de NestJS — `per backend-node-standards.md §6`.
    ```ts
    export class ReportsInvalidRangeError extends DomainError {
      readonly status = 422;
      readonly type = 'dsm:reports/invalid-range';
      constructor(from?: string, to?: string) {
        super(`Rango inválido: "${from ?? '(default)'}" es posterior a "${to ?? '(default)'}"`);
      }
    }
    ```
  - **Exit criterion**: el error existe con `status=422`, `type=dsm:reports/invalid-range`.
    `HttpProblemFilter` (sin tocar) lo mapea correctamente.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=reports-errors`

- [x] T1.3 `date-range.ts` — `parseReportsRange` (AC-4, AC-9, función pura)
  - **Pattern**: TS plano sin DI, `now` inyectado como parámetro (nunca
    `new Date()` interno) para que el test controle el reloj — `per
    design.md §D5`. Mismo cálculo de piso de retención que
    `checkout/orders-retention.service.ts:cutoffDate()`
    (`d.setMonth(d.getMonth() - meses)`), no reinventado.
    ```ts
    export function parseReportsRange(
      raw: { created_at_from?: string; created_at_to?: string },
      now: Date,
      retentionMonths: number,
    ): { from: Date; to: Date } {
      const to = raw.created_at_to ? new Date(raw.created_at_to) : now;
      const requestedFrom = raw.created_at_from
        ? new Date(raw.created_at_from)
        : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
      if (requestedFrom.getTime() > to.getTime()) {
        throw new ReportsInvalidRangeError(raw.created_at_from, raw.created_at_to);
      }
      const floor = new Date(now);
      floor.setMonth(floor.getMonth() - retentionMonths);
      const from = requestedFrom.getTime() < floor.getTime() ? floor : requestedFrom;
      return { from, to };
    }
    ```
  - **Exit criterion**: sin `created_at_from`/`created_at_to` → `to=now`,
    `from=now-30d`. Con ambos dentro de la ventana de 12 meses → se respetan
    literales. Con `created_at_from` anterior al piso de 12 meses → `from`
    queda igual al piso (acotado, AC-9), sin lanzar. Con
    `created_at_from > created_at_to` (ambos dentro de la ventana) → lanza
    `ReportsInvalidRangeError`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=date-range`
    (4 escenarios de arriba, cada uno con un `now` fijo inyectado — no
    `Date.now()` real, para que el test sea determinístico)

---

## Fase 2: CSV compartido — extraer `csvCell` (refactor behavior-preserving) — 0,5 h

- [x] T2.1 `common/csv/csv-cell.ts` — extracción literal de `imports/report-csv.ts`
  - **Pattern**: Fowler Extract Function — `per refactoring-discipline`
    (`design.md §D3`). El comportamiento no cambia: `imports/report-csv.ts`
    reexporta `csvCell` bajo su nombre original (`celdaCsv`), cero cambio de
    firma pública.
    ```ts
    // common/csv/csv-cell.ts — cuerpo idéntico al celdaCsv actual
    export function csvCell(valor: string | null | undefined): string { /* ... */ }
    ```
    ```ts
    // imports/report-csv.ts — después del extract
    import { csvCell } from '../common/csv/csv-cell';
    export const celdaCsv = csvCell;
    ```
  - **Exit criterion**: `common/csv/csv-cell.ts` existe con la lógica de
    neutralización (`= + - @`, tab, CR) y el quoting RFC 4180. `imports/report-csv.ts`
    no repite la lógica — sólo reexporta. Los tests existentes de
    `imports/` (que llaman `celdaCsv`) pasan **sin modificar un solo assert**.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern='report-csv|import-errors'`
    (suite de `imports/` completa, verde, sin tocar sus específicos) **y**
    `pnpm --filter @dsm/api test -- --testPathPattern=csv-cell` (spec nuevo,
    mismos casos que ya cubría `report-csv.spec.ts` para `celdaCsv`, ahora
    contra `csvCell` directo)

---

## Fase 3: Repositorio — `ReportsRepository` (3 queries `$queryRaw`) — 1,3 h

- [x] T3.1 `salesTimeseries` (AC-1, AC-8)
  - **Pattern**: `$queryRaw` con template tag parametrizado — `per
    search/search.repository.ts` (único precedente del repo) y `per
    design.md §D6`. `granularity` elige entre 3 literales SQL fijos
    (`Prisma.sql`'day'``/`'week'`/`'month'``), nunca interpola el string
    crudo del query param — `per security-standards.md §6.2`.
    ```ts
    async salesTimeseries(range: {from: Date; to: Date}, granularity: 'day'|'week'|'month')
      : Promise<{period_date: Date; orders_count: number; total_ars_cents: number}[]> {
      const trunc = {day: Prisma.sql`'day'`, week: Prisma.sql`'week'`, month: Prisma.sql`'month'`}[granularity];
      return this.prisma.$queryRaw`
        SELECT date_trunc(${trunc}, o.created_at)::date AS period_date,
               count(*)::int AS orders_count,
               coalesce(sum(o.total_ars_cents), 0)::int AS total_ars_cents
          FROM orders o
         WHERE o.status IN ('new','preparing','ready','delivered')
           AND o.created_at >= ${range.from}
           AND o.created_at <  ${range.to}
         GROUP BY period_date
         ORDER BY period_date ASC`;
    }
    ```
  - **Exit criterion**: con órdenes sembradas en 3 días distintos dentro del
    rango, todas `status='new'`, devuelve 3 filas ordenadas ascendente por
    `period_date`, cada una con el `orders_count`/`total_ars_cents` correcto.
    Una orden `pending_payment` o `cancelled` sembrada en el mismo rango
    **no** aparece en ninguna fila (AC-8). Rango sin ninguna orden → array
    vacío (AC-5), sin lanzar. `granularity='month'` agrupa 2 órdenes del
    mismo mes en una sola fila.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=reports.repository`
    (integration contra Postgres real)

- [x] T3.2 `topProducts` (AC-2, AC-8)
  - **Pattern**: agrupa por el snapshot de `order_items`
    (`product_name`/`product_sku`), sin `JOIN` a `products` — `per
    design.md §D6` (trade-off documentado: un producto renombrado a mitad de
    período puede aparecer dos veces).
    ```ts
    async topProducts(range: {from: Date; to: Date}, limit: number)
      : Promise<{product_id: string; product_name: string; product_sku: string; quantity_sold: number; revenue_ars_cents: number}[]> {
      return this.prisma.$queryRaw`
        SELECT oi.product_id, oi.product_name, oi.product_sku,
               sum(oi.quantity)::int AS quantity_sold,
               sum(oi.quantity * oi.unit_price_ars_cents)::int AS revenue_ars_cents
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
         WHERE o.status IN ('new','preparing','ready','delivered')
           AND o.created_at >= ${range.from}
           AND o.created_at <  ${range.to}
         GROUP BY oi.product_id, oi.product_name, oi.product_sku
         ORDER BY quantity_sold DESC
         LIMIT ${limit}`;
    }
    ```
  - **Exit criterion**: con 2 productos sembrados (A: 5 unidades en 2
    órdenes `new`, B: 2 unidades en 1 orden `delivered`), `limit=10` →
    devuelve `[A, B]` en ese orden, `quantity_sold`/`revenue_ars_cents`
    correctos. Una línea de una orden `pending_payment` no suma. `limit=1` →
    sólo `[A]`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=reports.repository`

- [x] T3.3 `statusBreakdown` (AC-3, AC-8)
  - **Pattern**: `GROUP BY o.status` — sólo emite filas para estados con al
    menos una orden en el rango (el zero-fill de estados ausentes es
    responsabilidad del service, T5.3 — capas, `backend-node-standards.md §2`).
    ```ts
    async statusBreakdown(range: {from: Date; to: Date})
      : Promise<{status: string; count: number; total_ars_cents: number}[]> {
      return this.prisma.$queryRaw`
        SELECT o.status, count(*)::int AS count,
               coalesce(sum(o.total_ars_cents), 0)::int AS total_ars_cents
          FROM orders o
         WHERE o.status IN ('new','preparing','ready','delivered')
           AND o.created_at >= ${range.from}
           AND o.created_at <  ${range.to}
         GROUP BY o.status`;
    }
    ```
  - **Exit criterion**: con órdenes sembradas en 2 de los 4 estados activos,
    devuelve exactamente 2 filas (no 4 — sin zero-fill acá). Suma de
    `count` sobre todas las filas = cantidad total de órdenes vendibles
    sembradas en el rango.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=reports.repository`

---

## Fase 4: Observabilidad — `ReportsEventsService` — 0,4 h

- [x] T4.1 `ReportsEventsService` — nuevo, mismo esqueleto que `OrderEventsService`
  - **DRIFT DOCUMENTADO**: el exit criterion original pedía
    `dsm_reports_events_total{event="...",dataset="..."}` (2 labels).
    `MetricsService.counterFor` (sin tocar, per Non-goals) sólo admite la
    etiqueta `event` — misma convención que TODOS los `*-events.service.ts`
    existentes (`OrderEventsService`, `SearchEventsService`: "La ÚNICA
    etiqueta es `event`"). Resuelto siguiendo ese precedente: `dataset` va al
    log, no a la métrica. Ver docstring de `report-events.service.ts`.
  - **Pattern**: `per design.md §D10` — delega el contador en `MetricsService`
    (`@Optional()`, el de `observability/`), firma que sólo acepta el
    `dataset` (enum de 3 valores) como dimensión, nunca PII ni un rango de
    fechas (cardinalidad no acotada).
    ```ts
    export type ReportsDataset = 'sales' | 'top-products' | 'summary';
    export type ReportsEventName = 'reports.viewed' | 'reports.exported';
    emit(name: ReportsEventName, dataset: ReportsDataset): void;
    ```
  - **Exit criterion**: los dos nombres incrementan
    `dsm_reports_events_total{event="...",dataset="..."}`, legible desde
    `GET /v1/admin/metrics` (el scrape existente de `observability/` — sin
    tocarlo, sólo un consumidor más de `MetricsService`).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=report-events`

---

## Fase 5: Servicio de caso de uso — `ReportsService` — 1,2 h

- [x] T5.1 `getSalesTimeseries` + `getSalesTimeseriesCsv` (AC-1, AC-4, AC-5, AC-6, AC-9)
  - **Exit criterion**: `getSalesTimeseries(query)` parsea el rango (T1.3),
    delega en `ReportsRepository.salesTimeseries` (T3.1), emite
    `reports.viewed('sales')` y devuelve `{range: {from, to} ISO 8601,
    granularity, data}`. `getSalesTimeseriesCsv(query)` reusa el mismo método
    interno (no una segunda query) y emite `reports.exported('sales')` en
    vez de `.viewed`. Rango sin datos → `data: []`, sin lanzar (AC-5).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=reports.service`
    (unit con repositorio mockeado: rango vacío → `data:[]` + evento
    `.viewed` emitido igual; export emite `.exported`, no `.viewed`; el
    conteo de invocaciones al repositorio es exactamente 1 por llamada — no
    una query duplicada para el CSV, F50)

- [x] T5.2 `getTopProducts` + `getTopProductsCsv` (AC-2, AC-4, AC-5, AC-6, AC-9)
  - **Exit criterion**: mismo contrato que T5.1, delegando en
    `ReportsRepository.topProducts` con el `limit` del query (default 10).
    Rango sin datos → `data: []`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=reports.service`

- [x] T5.3 `getSummary` + `getSummaryCsv` — con zero-fill de estados ausentes (AC-3, AC-5, AC-8)
  - **Pattern**: completa los 4 estados activos con `count:0,
    total_ars_cents:0` cuando `statusBreakdown` (T3.3) no devolvió fila para
    alguno — `per design.md §D6/§D7` (AC-5: período sin datos → ceros, nunca
    error ni objeto incompleto).
    ```ts
    const breakdown = Object.fromEntries(SALE_STATUSES.map((s) => [s, {count: 0, total_ars_cents: 0}]));
    for (const row of rows) breakdown[row.status] = {count: row.count, total_ars_cents: row.total_ars_cents};
    ```
  - **Exit criterion**: con 0 órdenes en el rango, `orders_count=0`,
    `total_ars_cents=0`, `breakdown_by_status` tiene las 4 claves
    (`new/preparing/ready/delivered`) en `{count:0, total_ars_cents:0}` —
    nunca un objeto con menos de 4 claves. `orders_count`/`total_ars_cents`
    totales son la suma de las 4 entradas del breakdown.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=reports.service`
    (caso "rango sin datos" explícito, con `expect(Object.keys(breakdown_by_status)).toHaveLength(4)`
    — no sólo que el método resuelva, F50)

---

## Fase 6: Superficie HTTP — 1,3 h

- [x] T6.1 DTOs — `ReportsRangeQueryDto`, `SalesQueryDto`, `TopProductsQueryDto`
  - **Pattern**: `class-validator` + `ValidationPipe` global, mismo estilo
    que `ListOrdersQueryDto` — `per backend-node-standards.md §4`. Rango
    como campos ISO 8601 (`_from`/`_to`) — `per api-standards.md §5.3, §7.1`.
    ```ts
    export class ReportsRangeQueryDto {
      @IsOptional() @IsISO8601() created_at_from?: string;
      @IsOptional() @IsISO8601() created_at_to?: string;
    }
    export class SalesQueryDto extends ReportsRangeQueryDto {
      @IsOptional() @IsIn(['day','week','month']) granularity: 'day'|'week'|'month' = 'day';
    }
    export class TopProductsQueryDto extends ReportsRangeQueryDto {
      @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit: number = 10;
    }
    ```
  - **Exit criterion**: un `created_at_from`/`created_at_to` que no parsea
    ISO 8601, un `granularity` fuera del enum, o un `limit` fuera de rango →
    422 vía `ValidationPipe` (sin código de dominio a mano). Sin ningún
    query param → los 3 DTOs construyen con sus defaults (`granularity:'day'`,
    `limit:10`) sin error.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=reports-query.dto`

- [x] T6.2 `ReportsController` — 6 endpoints GET, gateados por `AdminGuard`
  - **Pattern**: controller delgado, mismo estilo que `MetricsController`/
    `ProductsController` — `per backend-node-standards.md §2`. Los 3
    `/export` sirven `text/csv` con `@Res()` — `per imports.controller.ts`
    (`:id/report`) y `design.md §D7`.
    ```ts
    @Controller('v1/admin/reports')
    @UseGuards(AdminGuard)
    export class ReportsController {
      @Get('sales') sales(@Query() q: SalesQueryDto) { return this.reports.getSalesTimeseries(q); }
      @Get('sales/export') async salesExport(@Query() q: SalesQueryDto, @Res() res: Response) {
        const csv = await this.reports.getSalesTimeseriesCsv(q);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${csv.filename}"`);
        res.send(csv.body);
      }
      @Get('top-products') topProducts(@Query() q: TopProductsQueryDto) { ... }
      @Get('top-products/export') async topProductsExport(...) { ... }
      @Get('summary') summary(@Query() q: ReportsRangeQueryDto) { ... }
      @Get('summary/export') async summaryExport(...) { ... }
    }
    ```
  - **Exit criterion**: los 6 endpoints responden con los shapes de
    `design.md §D4`. `ReportsModule` se registra en `AppModule` sin
    `forwardRef`. Ningún endpoint colisiona con
    `GET /v1/admin/metrics` (ruta ya ocupada por `observability/MetricsController` —
    prefijo distinto, `v1/admin/reports` vs `v1/admin/metrics`).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-admin-reports`
    (supertest contra Postgres real: los 6 endpoints devuelven 200 con
    token admin válido; los 3 `/export` devuelven `Content-Type: text/csv` y
    un `Content-Disposition: attachment`; `GET /v1/admin/metrics` —el scrape
    Prometheus, sin este change montado en aislamiento— sigue devolviendo
    `text/plain; version=0.0.4`, sin regresión de ruta)

- [x] T6.3 `AppModule` importa `ReportsModule`
  - **Exit criterion**: `apps/api/src/app.module.ts` agrega `ReportsModule`
    al array `imports`. La app arranca sin `forwardRef`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-reports-bootstrap`
    (spec chico: `Test.createTestingModule({imports:[AppModule]}).compile()`
    no lanza) **y** `! grep -r "forwardRef" apps/api/src/reports`

---

## Fase 7: Invariantes negative-space — 1,6 h

> AC-5, AC-7, AC-8 y AC-9 son la mitad del valor de esta US: si se rompen,
> el dueño toma una decisión de negocio sobre un número que no refleja la
> realidad (ventas infladas con canceladas, o un panel que se cae en vez de
> mostrar "sin datos").

- [x] T7.1 AC-5 — período sin datos, en los 3 datasets y sus 3 exports
  - **Exit criterion**: con la base sin ninguna orden en el rango pedido
    (rango futuro, ej. `created_at_from` = mañana), los 6 endpoints
    responden **200** — nunca 404/500. `/sales` → `data: []`.
    `/top-products` → `data: []`. `/summary` → `orders_count:0,
    total_ars_cents:0`, `breakdown_by_status` con las 4 claves en cero. Los
    3 `/export` devuelven un CSV con **sólo el encabezado** (o el resumen en
    ceros), nunca un archivo vacío ni un error.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=ac5-empty-period`

- [x] T7.2 AC-7 — extender el barrido de RBAC existente
  - **Pattern**: agregar las 6 rutas nuevas al array `routes` de
    `e2e-rbac.spec.ts` existente y `ReportsModule` al array de módulos de
    `bootTestApp` — **no** un spec nuevo, el invariante "ninguna ruta
    `/v1/admin/*` responde sin auth" se mantiene por construcción — `per
    design.md §D1`.
  - **Exit criterion**: las 6 rutas
    (`['get','/v1/admin/reports/sales']`,
    `['get','/v1/admin/reports/sales/export']`,
    `['get','/v1/admin/reports/top-products']`,
    `['get','/v1/admin/reports/top-products/export']`,
    `['get','/v1/admin/reports/summary']`,
    `['get','/v1/admin/reports/summary/export']`) están en el array y pasan
    sin token → 401, con token no-admin → 403.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-rbac`
    (el spec extendido corre completo, sin regresión sobre las rutas
    preexistentes)

- [x] T7.3 AC-8 — sólo pagadas, probado end-to-end contra los 6 estados
  - **Exit criterion**: con 6 órdenes sembradas (una por cada uno de los 6
    valores de `status`, mismo `created_at` dentro del rango pedido), los 3
    endpoints de lectura excluyen **siempre** las de `pending_payment` y
    `cancelled`: `/summary.orders_count` = 4 (no 6), la suma de
    `breakdown_by_status` = 4; `/sales` sólo suma `total_ars_cents` de las 4
    activas; `/top-products` sólo cuenta líneas de esas 4 órdenes.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=ac8-only-paid-sales`
    (las 6 órdenes se siembran con `prisma.order.create` directo — sin
    depender de que exista un flujo real de pago para llegar a cada estado,
    mismo criterio que `orders/ac8-only-paid-orders.spec.ts`)

- [x] T7.4 AC-9 — el rango nunca muestra más atrás del piso de retención
  - **Exit criterion**: con `ORDER_RETENTION_MONTHS=12` y una orden sembrada
    con `created_at` de hace 13 meses (fuera de la ventana) y otra de hace 6
    meses (dentro), pedir `created_at_from` de hace 24 meses devuelve datos
    que **sólo** incluyen la orden de 6 meses — la de 13 meses no aparece en
    ningún dataset, sin que el endpoint devuelva 422 (el rango se acotó, no
    se rechazó).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=ac9-retention-clamp`

- [x] T7.5 AC-6 — CSV neutralizado contra inyección de fórmulas
  - **Pattern**: `per design.md §D3/§D9` — un `product_name` sembrado con
    `=cmd|'/c calc'!A1` (mismo vector que `security-standards.md §6.3`)
    nunca llega crudo a la celda del CSV exportado.
  - **Exit criterion**: `GET /v1/admin/reports/top-products/export` con un
    producto cuyo `order_items.product_name` empieza con `=`/`+`/`-`/`@`
    devuelve una celda prefijada con `'` (neutralizada) — nunca la fórmula
    cruda.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=reports-csv`

---

## Fase 8: Contratos y documentación — 0,7 h

- [ ] T8.1 OpenAPI publicado
  - **Exit criterion**: `apps/api/docs/api/openapi.yaml` declara el tag
    `admin-reports` y los 6 paths (`/admin/reports/sales[/export]`,
    `/admin/reports/top-products[/export]`, `/admin/reports/summary[/export]`)
    con sus status (200/401/403/422), los 3 schemas de respuesta JSON, y el
    `type` `dsm:reports/invalid-range` documentado en el catálogo de
    errores. Lintea limpio.
  - **Verify**: `pnpm dlx @stoplight/spectral-cli lint apps/api/docs/api/openapi.yaml --ruleset .spectral.yaml --fail-severity=warn`
    **y** `grep -cE "^  /admin/reports" apps/api/docs/api/openapi.yaml` → `6`

- [ ] T8.2 README de `src/reports/`
  - **Exit criterion**: `apps/api/src/reports/README.md` explica por qué la
    clase se llama `Reports*` y no `Metrics*` (colisión con
    `observability/MetricsModule`, D1), qué allowlist de estados cuenta como
    "venta" y por qué `cancelled` queda afuera (D2), y por qué los 3
    exports CSV reusan la misma query que su endpoint JSON hermano (D7).
  - **Verify**: `test -f apps/api/src/reports/README.md && rg -q "MetricsModule" apps/api/src/reports/README.md && rg -q "cancelled" apps/api/src/reports/README.md`

---

## Verification (suite-level)

- [ ] Type-check limpio: `pnpm --filter @dsm/api typecheck`
- [ ] Lint limpio: `pnpm --filter @dsm/api lint`
- [ ] Sin migración pendiente (cero migración de este change):
      `pnpm --filter @dsm/db migrate:deploy` → `No pending migrations to apply`
- [ ] Suite completa verde: `pnpm --filter @dsm/api test -- --ci`
- [ ] Sin regresión en `imports/` (refactor de T2.1) ni en `observability/`
      (scrape existente, sin tocar): `pnpm --filter @dsm/api test -- --ci --testPathPattern='imports|observability|reports'`
- [ ] Contrato publicado lintea limpio:
      `pnpm dlx @stoplight/spectral-cli lint apps/api/docs/api/openapi.yaml --ruleset .spectral.yaml --fail-severity=warn`
      → "No results with a severity of 'warn' or higher found!"
- [ ] Ninguna ruta nueva colisiona con el scrape existente: `GET /v1/admin/metrics`
      (montado sólo con `ObservabilityModule`, sin `ReportsModule` presente, y
      viceversa) sigue devolviendo `text/plain; version=0.0.4` — cubierto por
      `e2e-admin-reports.spec.ts`.
