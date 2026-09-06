---
parent-us: US-016
discipline: backend
variant: null
language: es
---

# US-016 Backend — Design

## Context

Verificado 2026-09-05 contra el código real (no contra lo que el `design.md`
de otra US supuso):

- `orders` (migración de US-008, ampliada por US-021): columnas `id,
  order_number, access_token_hash, customer_id, buyer_name, buyer_email,
  buyer_phone, fulfillment, status, total_ars_cents, consent_*, created_at,
  updated_at, delivered_at, confirmed_at, cancelled_at, anonymized_at,
  anonymization_reason`. `status` acepta los 6 valores de la FSM completa.
  Índice `@@index([status, created_at])`.
- `order_items`: `order_id, product_id, quantity, unit_price_ars_cents,
  product_name, product_sku, created_at`. Índice `@@index([order_id])`.
  `product_name`/`product_sku` son el **snapshot** al momento de la venta
  (`checkout` los graba en la misma transacción que crea la orden).
- `apps/api/src/observability/{metrics.module,metrics.service,metrics.controller}.ts`:
  **ya existen**, y **ya ocupan** la clase `MetricsModule`/`MetricsService`/
  `MetricsController` y la ruta `GET /v1/admin/metrics` — es el scrape
  Prometheus de métricas técnicas de aplicación (`AUDIT-dsm-api-006`), no el
  dashboard de negocio de esta US. Ninguna de las tres clases se toca.
- `apps/api/src/checkout/orders-retention.service.ts`: `cutoffDate()` calcula
  el piso de retención con `new Date(); d.setMonth(d.getMonth() - meses)`,
  leyendo `ORDER_RETENTION_MONTHS` (`config/env.validation.ts`, default 12)
  vía `ConfigService`. Este change reusa el mismo cálculo, no lo reinventa.
- `apps/api/src/search/search.repository.ts`: único precedente de `$queryRaw`
  con template tag parametrizado en el repo — la consulta de usuario viaja
  como parámetro, nunca interpolada en el texto SQL.
- `apps/api/src/imports/report-csv.ts`: `celdaCsv()` neutraliza inyección de
  fórmulas (`= + - @`, tab, CR) para celdas que un dueño puede abrir en Excel
  — único precedente de export CSV en el repo, sirve por `imports.controller.ts`
  bajo `:id/report` con `Content-Type: text/csv` + `Content-Disposition:
  attachment`.
- `apps/api/src/bootstrap.ts`: middleware global que estampa
  `Cache-Control: no-store` sobre todo `/v1/admin/*` — los 6 endpoints de
  este change lo heredan sin código propio.
- `apps/api/docs/api/openapi.yaml`: archivo único (no root+paths) — 2107
  líneas, un `tag` por superficie, un bloque `paths./{recurso}` por endpoint.

## Goals

- Que el dueño vea evolución de ventas, top de productos y un resumen del
  período, sobre datos reales de `orders`/`order_items`, sin ninguna
  escritura nueva.
- Que "venta" tenga **una sola definición** en todo el sistema — la misma
  allowlist de 4 estados activos que ya usa el panel de fulfillment (CAP-5).
- Que un período sin datos, o un rango que exceda la retención vigente, nunca
  sea un error — 200 con ceros/vacío, o un `from` acotado.
- Que el nombre de clase/módulo de este change **no colisione** con
  `MetricsModule`/`MetricsService`/`MetricsController` de `observability/`
  (ya existentes, ruta `/v1/admin/metrics`).
- Cero migración: agregaciones puras sobre tablas ya migradas.

## Non-goals

- Analítica de tráfico/sesiones/conversión web — US §4.
- Pronósticos/forecasting — US §4.
- Exportación contable/AFIP — roadmap PRD §2.2.
- Un índice nuevo sobre `orders`/`order_items` — ver §D8, sin justificación a
  esta volumetría.
- Tocar `MetricsModule`/`MetricsService`/`MetricsController` de
  `observability/`, `checkout/orders.repository.ts`, `orders/` (CAP-5) o
  `AdminGuard`.
- Dashboard/gráficos del frontend — sibling FE, no planificado en esta
  sesión.

## Approach

### D1 — Superficie: módulo nuevo `reports/`, nombre de clase deliberadamente distinto al C4 del E2E

```
apps/api/src/reports/                      ← NUEVO
├─ reports.module.ts
├─ reports.controller.ts                  ← 6 endpoints GET
├─ reports.service.ts                     ← orquesta rango + repositorio + shape de respuesta
├─ reports.repository.ts                  ← único punto de $queryRaw de este change
├─ reports-errors.ts                      ← ReportsInvalidRangeError (422)
├─ date-range.ts                          ← parseReportsRange (pura, sin DI)
├─ sale-statuses.ts                       ← SALE_STATUSES (const, D2)
├─ csv/reports-csv.ts                     ← 3 builders CSV (uno por dataset)
├─ dto/reports-query.dto.ts               ← ReportsRangeQueryDto, SalesQueryDto, TopProductsQueryDto
├─ dto/reports-response.dto.ts            ← DTOs de respuesta, mismo estilo que order.dto.ts
└─ README.md

apps/api/src/common/csv/csv-cell.ts        ← NUEVO — extraído de imports/report-csv.ts (D3)
apps/api/src/imports/report-csv.ts         ← EXTENDIDO: reexporta desde common/csv (sin cambiar comportamiento)
apps/api/src/observability/report-events.service.ts ← NUEVO (mismo esqueleto que order-events.service.ts)
apps/api/src/auth/e2e-rbac.spec.ts         ← EXTENDIDO: +6 rutas (AC-7)
apps/api/src/app.module.ts                 ← +ReportsModule
apps/api/docs/api/openapi.yaml             ← +tag admin-reports, +6 paths, +3 schemas de respuesta
```

`ReportsModule` importa `AuthModule` (para `AdminGuard`, mismo patrón que
`MetricsModule`/`ProductsModule`) y `PrismaModule` (para `$queryRaw`). **No**
importa `CheckoutModule` ni `OrdersModule`: no hay escritura ni lectura por
Prisma Client tipado de `orders`/`order_items` — todo pasa por `$queryRaw` en
`ReportsRepository`, que inyecta `PrismaService` directo.

**Por qué un módulo nuevo y no una extensión de `orders/` (CAP-5)**: el
`OrdersRepository`/`OrdersAdminService` de `orders/` resuelven una FSM de
fulfillment con escritura transaccional — un dominio completamente distinto
de una agregación de sólo lectura sin estado. Mezclarlos acopla un caso de
uso de escritura con uno de lectura agregada que ni siquiera necesita el
Prisma Client tipado (usa `$queryRaw`). La única superposición real
—"ambos leen `orders`"— no justifica compartir código: `OrdersRepository.list`
devuelve filas paginadas para un listado, no agregados.

**Por qué el nombre `Reports*` y no `Metrics*`** (aunque el E2E §6.1 llame al
componente `MetricsModule`): `apps/api/src/observability/metrics.module.ts`
**ya declara la clase `MetricsModule`** (exporta `MetricsService`, expone
`MetricsController` en `GET /v1/admin/metrics`, el scrape Prometheus de
`AUDIT-dsm-api-006`). Dos clases con el mismo nombre en el mismo
`app.module.ts` obligarían a un alias de import en cada uno de los dos
archivos — frágil, y cualquier importación futura sin alias rompe en
tiempo de compilación de forma confusa (¿cuál `MetricsModule`?). Además, si
este change usara literalmente `/v1/admin/metrics/*` como prefijo, un
`GET /v1/admin/metrics` (bare, el scrape existente) y un futuro
`GET /v1/admin/metrics/summary` no colisionan a nivel de ruta (son paths
distintos), pero sí generan una superficie confusa: el mismo prefijo sirve
`text/plain` Prometheus en la raíz y JSON de negocio en los sub-paths. Se
evita ambas fuentes de confusión con un nombre y un prefijo (`Reports*`,
`/v1/admin/reports`) que no se superponen ni en clase ni en URL con lo que ya
existe. La intención del componente del E2E ("agregaciones para gráficos del
dueño") queda intacta — sólo cambia el identificador.

### D2 — Qué cuenta como "venta" (AC-8)

```ts
// sale-statuses.ts
export const SALE_STATUSES = ['new', 'preparing', 'ready', 'delivered'] as const;
export type SaleStatus = (typeof SALE_STATUSES)[number];
```

Es la **misma allowlist** que `OrdersAdminService.list` (CAP-5, US-012) usa
por default para el panel de fulfillment — no se inventa un segundo criterio
de "orden pagada" en el sistema. `cancelled` queda deliberadamente afuera:
una orden llega a `cancelled` sólo cuando el pago automático (MercadoPago o
el medio simulado) se aprobó pero el stock ya no alcanzaba al confirmar — la
orden se cancela y el pago queda `refund_pending` / se reembolsa
(`pagos/requirements.md` R-10, US-010). Contarla en "monto facturado" o en
"cantidad de órdenes" infla el panel con dinero que el negocio ya devolvió.
`pending_payment` queda afuera por la letra literal de AC-8.

**Órdenes anonimizadas (US-021) cuentan igual**: `anonymized_at` sólo pisa
`buyer_name`/`buyer_email`/`buyer_phone`
(`retencion-datos-personales/requirements.md` R-3) — `status`,
`total_ars_cents`, `created_at` y `order_items` no cambian. Ninguna query de
este change selecciona una columna de PII del comprador (ver §D9 —
Information disclosure), así que no hace falta ningún filtro ni tratamiento
especial para que sigan contando.

### D3 — CSV compartido: extraer `celdaCsv` a `common/csv/csv-cell.ts` (refactor, behavior-preserving)

`imports/report-csv.ts` ya resuelve la neutralización de fórmulas
(`= + - @`, tab, CR) y el quoting RFC 4180. Este change necesita exactamente
la misma función para `product_name`/`product_sku` (campos de texto libre
que el dueño carga vía el panel de catálogo o el import masivo — pueden
empezar con cualquiera de esos caracteres). En vez de reimplementarla o
importarla cruzando de `reports/` a `imports/` (acoplaría dos features de
dominio distinto por una utilidad sin relación de negocio), se **extrae**
(Fowler, Extract Function) a `apps/api/src/common/csv/csv-cell.ts`:

```ts
// common/csv/csv-cell.ts (extraído literal de imports/report-csv.ts)
export function csvCell(valor: string | null | undefined): string { /* misma lógica */ }
```

`imports/report-csv.ts` pasa a reexportar `csvCell` como `celdaCsv` (alias,
cero cambio de comportamiento, cero cambio en su firma pública) —
behavior-preserving per `refactoring-discipline`: los tests existentes de
`imports/report-csv.spec.ts`/`import-errors.spec.ts` corren sin tocar un solo
assert, prueban el mismo comportamiento a través del reexport.

### D4 — Contrato HTTP

```yaml
GET /v1/admin/reports/sales
  query:
    created_at_from?: date-time ISO 8601   # default: created_at_to - 30 días
    created_at_to?: date-time ISO 8601     # default: now()
    granularity?: enum [day, week, month]  # default "day"
  200: { range: {from, to}, granularity, data: [{period_date, orders_count, total_ars_cents}] }
  401/403: Problem

GET /v1/admin/reports/sales/export
  query: igual que /sales (sin granularity si no se pide — ver Nota)
  200: text/csv, Content-Disposition: attachment; filename="reports-sales-{from}-{to}.csv"
  401/403: Problem

GET /v1/admin/reports/top-products
  query:
    created_at_from?, created_at_to?        # igual que /sales
    limit?: integer, default 10, min 1, max 50
  200: { range: {from, to}, data: [{product_id, product_name, product_sku, quantity_sold, revenue_ars_cents}] }
  401/403: Problem

GET /v1/admin/reports/top-products/export
  200: text/csv, filename="reports-top-products-{from}-{to}.csv"
  401/403: Problem

GET /v1/admin/reports/summary
  query: created_at_from?, created_at_to?   # igual que /sales
  200: { range: {from, to}, orders_count, total_ars_cents,
         breakdown_by_status: {new, preparing, ready, delivered} }
  401/403: Problem

GET /v1/admin/reports/summary/export
  200: text/csv, filename="reports-summary-{from}-{to}.csv"
  401/403: Problem

# Los 6 endpoints comparten:
422: Problem (dsm:reports/invalid-range — created_at_from > created_at_to,
              o un valor que no parsea como ISO 8601 — ValidationPipe global,
              UNPROCESSABLE_ENTITY per bootstrap.ts)
```

`granularity` en `/sales/export` se acepta igual que en `/sales` (mismo DTO
de query) — el CSV exportado respeta la granularidad pedida para el gráfico
que el dueño está mirando.

### D5 — Parseo y acotado del rango (AC-4, AC-9)

```ts
// date-range.ts — función pura, sin DI, unit-testeable en aislamiento
export interface ParsedRange { from: Date; to: Date }

export function parseReportsRange(
  raw: { created_at_from?: string; created_at_to?: string },
  now: Date,
  retentionMonths: number,
): ParsedRange {
  const to = raw.created_at_to ? new Date(raw.created_at_to) : now;
  const requestedFrom = raw.created_at_from
    ? new Date(raw.created_at_from)
    : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);   // default: 30 días

  if (requestedFrom.getTime() > to.getTime()) {
    throw new ReportsInvalidRangeError(raw.created_at_from, raw.created_at_to);
  }

  const floor = new Date(now);
  floor.setMonth(floor.getMonth() - retentionMonths);   // mismo cálculo que
                                                          // orders-retention.service.ts:cutoffDate()
  const from = requestedFrom.getTime() < floor.getTime() ? floor : requestedFrom;
  return { from, to };
}
```

El acotado (`from < floor → from = floor`) es **silencioso** (AC-9: "no
muestra datos más antiguos", no "rechaza") — la respuesta lleva el rango
**efectivo** (`range.from`/`range.to`) para que el FE, si quiere, le informe
al dueño que el rango pedido se recortó. `requestedFrom > to` sigue siendo
422: es una entrada incoherente del propio dueño, no una ventana que exceda
la retención.

`ReportsService` inyecta `ConfigService` para `ORDER_RETENTION_MONTHS`
(default 12) y `Date` real (`now = new Date()`) — `parseReportsRange` recibe
`now` como parámetro, nunca lo calcula internamente, para que el test unitario
controle el reloj sin mockear `Date` global.

### D6 — Repositorio: `$queryRaw` parametrizado, granularidad por switch (no interpolada)

```ts
// reports.repository.ts
async salesTimeseries(range: ParsedRange, granularity: 'day' | 'week' | 'month')
  : Promise<{ period_date: Date; orders_count: number; total_ars_cents: number }[]> {
  const trunc = { day: Prisma.sql`'day'`, week: Prisma.sql`'week'`, month: Prisma.sql`'month'` }[granularity];
  // ^ granularity ya viene validada por el DTO (@IsIn) antes de llegar acá —
  //   el switch elige entre 3 literales SQL fijos (con comillas: date_trunc
  //   exige el segundo argumento como string literal), nunca interpola el
  //   string crudo del query param (security-standards §6.2 — parameterized
  //   queries ONLY).
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

async topProducts(range: ParsedRange, limit: number)
  : Promise<{ product_id: string; product_name: string; product_sku: string; quantity_sold: number; revenue_ars_cents: number }[]> {
  return this.prisma.$queryRaw`
    SELECT oi.product_id,
           oi.product_name,
           oi.product_sku,
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

async statusBreakdown(range: ParsedRange)
  : Promise<{ status: string; count: number; total_ars_cents: number }[]> {
  return this.prisma.$queryRaw`
    SELECT o.status,
           count(*)::int AS count,
           coalesce(sum(o.total_ars_cents), 0)::int AS total_ars_cents
      FROM orders o
     WHERE o.status IN ('new','preparing','ready','delivered')
       AND o.created_at >= ${range.from}
       AND o.created_at <  ${range.to}
     GROUP BY o.status`;
}
```

**`topProducts` agrupa por `oi.product_name`/`oi.product_sku` (el snapshot de
`order_items`), no por `products.name` actual** — sin JOIN a `products`. Es
"qué compró la gente", con el nombre que vieron al comprar (mismo criterio
que ya fija `order_items` para el panel de fulfillment, CAP-5). **Trade-off
aceptado**: si un producto fue renombrado a mitad del período, puede aparecer
como dos filas (mismo `product_id`, dos snapshots de nombre distintos) — caso
de borde, sin AC que pida consolidarlo de otra forma (YAGNI, `base-standards`
§1). `statusBreakdown` devuelve sólo las filas con al menos una orden en el
rango (`GROUP BY` no emite ceros) — `ReportsService` completa los estados
activos ausentes con `count: 0, total_ars_cents: 0` antes de responder (AC-5).

### D7 — Servicio: orquestación + shape de respuesta + CSV

```ts
async getSalesTimeseries(query: SalesQueryDto) {
  const range = parseReportsRange(query, new Date(), this.retentionMonths);
  const rows = await this.repo.salesTimeseries(range, query.granularity);
  this.events.emit('reports.viewed', 'sales');
  return { range: toIsoRange(range), granularity: query.granularity, data: rows.map(toSalesRow) };
}
```

`getSalesTimeseriesCsv` (usado por el endpoint `/export`) llama al **mismo**
`getSalesTimeseries` internamente y arma el CSV desde el mismo `data` que
vería el gráfico — no hay una segunda query ni una segunda fuente de verdad
para los números exportados. Mismo patrón para `top-products` y `summary`.
El export emite `reports.exported` (no `reports.viewed`) — son señales de
uso distintas (US §9: "registrar uso del panel").

### D8 — NFRs y evaluación de persistencia (`data-architecture-patterns`)

**Evaluación**: workload puramente relacional, sólo lectura, sin tabla ni
columna nueva — el caso más trivial posible del skill (más trivial incluso
que `order_status_history` de US-012, que sí agregaba una tabla). **No se
invoca `data-architect` Mode B.**

- **Índices existentes suficientes**: `orders(status, created_at)` (US-008)
  cubre el `WHERE status IN (...) AND created_at BETWEEN ...` de las 3
  queries; `order_items(order_id)` (US-008) cubre el `JOIN` de `topProducts`.
  Sin índice nuevo — ver "Non-goals".
- **Volumetría**: ~100 órdenes/mes × 12 meses de retención ⇒ ≤ ~1.200 filas
  de `orders` en el rango máximo permitido, ≤ ~3.600 de `order_items` (2-3
  líneas por orden). Un `GROUP BY` sobre ese volumen es submilisegundo.
- **Latencia**: p95 < 300ms (PRD §4/E2E §17, mismo target que el resto de
  lecturas admin — heredado, no propuesto de nuevo).
- **CSV export**: mismo target — el payload es el mismo `data` ya agregado,
  formatearlo a texto es O(filas), trivial a esta escala.

### D9 — Threat model (STRIDE lite — `threat-modeling-lite`, superficie "GET admin, agregación + export")

| Amenaza | Vector específico | Control |
|---|---|---|
| **Elevation of privilege** | acceder sin rol admin | `AdminGuard` en los 6 endpoints; barrido en `e2e-rbac.spec.ts` |
| **Information disclosure** | el resumen/serie revela PII del comprador | Ninguna query selecciona `buyer_name`/`buyer_email`/`buyer_phone` — los 3 datasets sólo agregan `status`/`total_ars_cents`/`created_at`/`product_*` |
| **Information disclosure** | CSV exportado con `product_name` conteniendo una fórmula (`=cmd|...`) | `csvCell` (D3) neutraliza antes de escribir la celda |
| **Tampering** | `created_at_from`/`created_at_to`/`granularity`/`limit` manipulados para forzar un rango absurdo | DTO whitelist (`@IsISO8601`, `@IsIn`, `@Min`/`@Max`) + acotado server-side al piso de retención (D5) — el cliente nunca decide el piso real |
| **DoS** | rango de fechas sin límite superior (ej. 50 años) para forzar un `GROUP BY` gigante | Acotado a 12 meses server-side (D5) sin importar lo que pida el query param; volumen máximo ~1.200 órdenes (D8) |
| **Repudiation** | n/a — superficie de sólo lectura, sin mutación que repudiar | — |

### D10 — Observabilidad

`ReportsEventsService` (nuevo, `src/observability/report-events.service.ts`,
mismo esqueleto que `OrderEventsService`) — delega el contador en
`MetricsService` (`@Optional()`, **el de `observability/`**, sin colisión de
nombre porque `ReportsEventsService` no se llama `MetricsService`):

- `reports.viewed` — cada `GET` exitoso a `/sales`, `/top-products` o
  `/summary`, con `dataset` (enum de 3 valores) como única dimensión.
- `reports.exported` — cada `GET .../export` exitoso, mismo `dataset`.

Sin PII, sin rango de fechas como dimensión (cardinalidad no acotada —
`observability-standards.md` §9). Registrado como provider dentro de
`ReportsModule` (no global), mismo patrón que `OrderEventsService` dentro de
`OrdersModule`.

## Trade-offs

**`topProducts` agrupa por el snapshot de `order_items`, no por el nombre
actual del producto** — ver D6. Aceptado: sin AC que pida consolidar
renombres a mitad de período.

**Sin índice nuevo** (D8) — a la volumetría declarada, los índices
compuestos existentes de US-008 ya cubren las 3 queries.

**`cancelled` excluido de "venta"** (D2) — interpretación del literal de
AC-8, no una letra explícita de la US. Si el PO prefiere que "cantidad de
órdenes" incluya las canceladas (para ver cuánto se pierde a reembolsos), es
un cambio de un valor en `SALE_STATUSES` — documentado como decisión
reversible, no una pregunta abierta que bloquee.

## Resiliencia

Sin llamadas externas — sólo lecturas a Postgres vía el mismo `PrismaService`
que ya usa toda la app. Nada que reintentar ni circuit-breakear
(`backend-node-standards.md` §8 no aplica a esta superficie).

## Deployment considerations

- **Cero migración.** Ninguna tabla ni columna nueva — sólo código de
  aplicación (controller/service/repository/DTO) y una extensión aditiva del
  `openapi.yaml` publicado.
- **Sin secretos nuevos, sin feature flag, sin dependencia externa nueva.**
  No amerita `/plan-deployment` propio.
- **Orden de merge**: sin dependencia de ningún otro change en curso. `orders`/
  `order_items`/`ORDER_RETENTION_MONTHS` ya existen en `main`.
- **Rollback**: revertir el código deja `reports/` inerte (nadie más lo
  importa) — sin pérdida de datos, sin migración que revertir.

## Spec delta (para `/archive-change`)

Este change inaugura `openspec/specs/metricas/` (capacidad nueva — CAP-9 del
PRD, distinta de `ordenes` CAP-5 y `checkout` CAP-10, aunque lee las mismas
tablas) con los 6 endpoints (`/admin/reports/{sales,top-products,summary}` +
sus 3 `/export`) documentados en `decisions.md` junto con la decisión de
nombrar la clase `Reports*` en vez de `Metrics*` (D1) y la definición de
"venta" (D2).

## Open questions

- **OQ-BE-1**: ¿`cancelled` debería contar en "cantidad de órdenes" del
  resumen (aunque no en "monto facturado"), para que el dueño vea cuánto se
  pierde a cancelaciones? Este plan dice que no — ver D2/Trade-offs. Cambio
  de un valor en `SALE_STATUSES` si el PO prefiere lo contrario; no bloquea.
- **OQ-BE-2**: ¿el export CSV de `/sales` debería incluir la granularidad
  pedida como columna, o alcanza con que el nombre del archivo la mencione?
  Este plan no la incluye como columna (redundante: todas las filas del
  mismo archivo comparten la misma granularidad) — cambio menor si el PO
  prefiere explicitarla por fila.

## References

- E2E §6.1 (`MetricsModule`, renombrado — D1), §17, §18, §18.5
- US-016 §9 (NFRs: autorización admin, agregaciones eficientes, sólo
  confirmadas, WCAG en gráficos —FE—, observabilidad de uso)
- Capacidades hermanas: `openspec/specs/ordenes/requirements.md` R-1 (misma
  allowlist de 4 estados), `openspec/specs/pagos/requirements.md` R-10
  (por qué `cancelled` = reembolso), `openspec/specs/retencion-datos-personales/requirements.md`
  R-3 (qué pisa la anonimización)
- Código existente citado: `apps/api/src/observability/{metrics.module,
  metrics.service,metrics.controller}.ts` (colisión de nombre evitada — D1),
  `apps/api/src/search/search.repository.ts` (precedente `$queryRaw`),
  `apps/api/src/imports/{imports.controller,report-csv}.ts` (precedente
  export CSV — D3), `apps/api/src/checkout/orders-retention.service.ts`
  (`cutoffDate()`, reusado en D5), `apps/api/src/bootstrap.ts`
  (`Cache-Control: no-store` heredado), `packages/db/prisma/schema.prisma`
  (`model Order`, `model OrderItem`)
- Standards: `base-standards.md` §1 (KISS/YAGNI — sin índice nuevo, sin
  consolidar renombres sin AC) · `backend-node-standards.md` §2-§9 (capas,
  DI, DTO+ValidationPipe, errores RFC 7807) · `api-standards.md` §5.3
  (fechas ISO 8601 UTC), §7.1 (`_from`/`_to` para rangos), §10.5 (GET
  naturalmente idempotente, sin `Idempotency-Key`) · `security-standards.md`
  §4 (autorización server-side), §6.2 (parameterized queries — D6), §6.3
  (CSV injection — D3) · `observability-standards.md` §9 (sin PII, sin
  dimensión de cardinalidad no acotada) · `data-architecture-patterns`
  (skill, evaluación trivial §D8) · `threat-modeling-lite` (skill, §D9) ·
  `nfr-quantification` (skill, §D8 — latencia heredada del E2E, no
  inventada) · `refactoring-discipline` (skill, §D3 — Extract Function
  behavior-preserving)
