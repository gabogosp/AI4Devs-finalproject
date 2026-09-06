# `src/reports/` — Panel de métricas del dueño (US-016)

`GET /v1/admin/reports/{sales,top-products,summary}` (+ sus 3 `/export` CSV
hermanos) — agregaciones de sólo lectura sobre `orders`/`order_items` que ya
existen desde US-008. Sin ninguna tabla ni columna nueva.

## Por qué `Reports*` y no `Metrics*` (aunque el E2E §6.1 llame así al componente)

`apps/api/src/observability/{metrics.module,metrics.service,metrics.controller}.ts`
**ya existen** y ya ocupan la clase `MetricsModule`/`MetricsService`/
`MetricsController` y la ruta `GET /v1/admin/metrics` — es el scrape
Prometheus de métricas técnicas de la aplicación (`AUDIT-dsm-api-006`), no el
dashboard de negocio de esta US. Colisionar el nombre de clase (y casi el
path — `/v1/admin/metrics/*` vs `/v1/admin/metrics`) sería confuso y frágil:
dos clases `MetricsModule` en el mismo `app.module.ts` obligarían a un alias
de import en cada uno de los dos archivos.

Este módulo usa **`Reports*`** (`ReportsModule`, `ReportsController`,
`ReportsService`, `ReportsRepository`), montado en `v1/admin/reports` — sin
colisión de clase ni de URL con `MetricsController`, que sigue exactamente
igual (`e2e-admin-reports.spec.ts` lo verifica con `ReportsModule` montado en
aislamiento). La intención del componente del E2E ("agregaciones para
gráficos del dueño") queda intacta; sólo cambia el identificador
(`design.md §D1`).

## Qué cuenta como "venta" (AC-8) — y por qué `cancelled` queda afuera

`SALE_STATUSES = ['new', 'preparing', 'ready', 'delivered']` — la misma
allowlist de 4 estados activos que ya usa `OrdersAdminService.list` para el
panel de fulfillment (CAP-5, US-012). No se inventa un segundo criterio de
"orden pagada" en el sistema.

`pending_payment` queda afuera por la letra literal de AC-8. `cancelled`
queda afuera deliberadamente: una orden llega a `cancelled` sólo cuando el
pago automático (MercadoPago o el medio simulado) se aprobó pero el stock ya
no alcanzaba al confirmar — la orden se cancela y el pago queda
`refund_pending` / se reembolsa (`pagos/requirements.md` R-10, US-010).
Contarla en "monto facturado" o en "cantidad de órdenes" infla el panel con
dinero que el negocio ya devolvió.

Es una decisión reversible: si el PO prefiere que "cantidad de órdenes"
incluya las canceladas (para ver cuánto se pierde a reembolsos), es un cambio
de un valor en `sale-statuses.ts` — no una pregunta abierta que bloquee
(`design.md` OQ-BE-1).

**Órdenes anonimizadas (US-021) cuentan igual**: `anonymized_at` sólo pisa
`buyer_name`/`buyer_email`/`buyer_phone` — ninguna columna que estos
endpoints leen (`status`, `total_ars_cents`, `created_at`, `order_items`)
cambia. Ninguno de los tres datasets selecciona una columna de PII del
comprador.

## Por qué cada export CSV reusa la misma query que su endpoint JSON hermano

`getSalesTimeseriesCsv`/`getTopProductsCsv`/`getSummaryCsv` (en
`reports.service.ts`) llaman internamente al mismo método que arma la
respuesta JSON y formatean **ese mismo resultado** a CSV — no hay una segunda
query ni una segunda fuente de verdad para los números exportados. El test
unitario de `reports.service.spec.ts` verifica esto contando invocaciones al
repositorio (exactamente 1 por llamada, nunca una query duplicada para el
CSV).

Las celdas de texto libre (`product_name`/`product_sku`, cargadas por el
dueño vía el panel de catálogo o el import masivo) pasan por `csvCell`
(`common/csv/csv-cell.ts`, extraída de `imports/report-csv.ts` — mismo
utilitario, sin reimplementar la neutralización de fórmulas ni el quoting RFC
4180 una segunda vez).

## Rango temporal: se acota, no se rechaza (AC-4, AC-9)

`date-range.ts:parseReportsRange` — sin `created_at_from`/`created_at_to`,
default a los últimos 30 días. Un `created_at_from` anterior al piso de
retención vigente (`ORDER_RETENTION_MONTHS`, default 12, mismo cálculo que
`checkout/orders-retention.service.ts:cutoffDate()`) se acota
**silenciosamente** al piso — la respuesta lleva el rango efectivo en
`range`. Sólo `created_at_from > created_at_to` es 422
(`dsm:reports/invalid-range`): es una entrada incoherente del propio dueño,
no una ventana que exceda la retención.

## Drift documentado: `ReportsEventsService` — `dataset` va al log, no a la métrica

El plan original describía el contador de uso como
`dsm_reports_events_total{event="...",dataset="..."}` (2 labels de
Prometheus). `MetricsService.counterFor` (en `observability/`, sin tocar —
fuera de alcance de este change) sólo admite la etiqueta `event` — la misma
convención que **todos** los `*-events.service.ts` existentes
(`OrderEventsService`, `SearchEventsService`: "La ÚNICA etiqueta es
`event`"). Se resolvió siguiendo ese precedente: `dataset` viaja al **log**
estructurado, nunca como dimensión de la métrica de Prometheus — ver el
docstring de `../observability/report-events.service.ts`.
