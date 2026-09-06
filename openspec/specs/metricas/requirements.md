# CAP-9 Panel de métricas del dueño — Requisitos acumulados

Acumulado de los changes archivados de esta capacidad. Cada requisito es el
**estado declarado del sistema vivo**, no la intención de un change.

## Desde US-016 backend — Panel de métricas del dueño (archivada 2026-09-06)

Superficie cubierta: `GET /admin/reports/{sales,top-products,summary}` + sus
3 `/export` (CSV).

### Funcionales

| # | Requisito | Origen |
|---|---|---|
| R-1 | `GET /admin/reports/sales` agrega la evolución de ventas por día/semana/mes sobre `orders`/`order_items`. | AC-1 |
| R-2 | `GET /admin/reports/top-products` rankea productos por cantidad vendida, agrupando por el snapshot de `order_items` (sin JOIN a `products`). | AC-2 |
| R-3 | `GET /admin/reports/summary` devuelve cantidad de órdenes, monto facturado (ARS) y desglose por los 4 estados activos del período. | AC-3 |
| R-4 | Los 3 datasets aceptan `created_at_from`/`created_at_to`; sin rango, default a los últimos 30 días. | AC-4 |
| R-5 | Cada dataset tiene su export CSV hermano (`GET /admin/reports/{dataset}/export`), misma agregación, mismos query params — sin una segunda fuente de verdad para los números. | AC-6 |
| R-6 | Sólo cuentan como "venta" las órdenes en `status IN (new, preparing, ready, delivered)` — la misma allowlist de 4 estados activos que ya usa el panel de fulfillment (CAP-5). `pending_payment` y `cancelled` nunca cuentan. | AC-8 |
| R-7 | Un `created_at_from` anterior al piso de retención vigente (`ORDER_RETENTION_MONTHS`, default 12) se acota silenciosamente al piso — la respuesta lleva el rango EFECTIVO aplicado en `range`, nunca un error. | AC-9 |
| R-8 | Órdenes anonimizadas (CAP-13) cuentan igual en los 3 agregados — ninguna columna que estos endpoints leen (`status`, `total_ars_cents`, `created_at`, ítems) se ve afectada por la anonimización de PII de contacto. | Decisión explícita (`design.md` §Qué) |
| R-9 | `ReportsEventsService` emite `reports.viewed`/`reports.exported` con el dataset (`sales`\|`top-products`\|`summary`) como única dimensión — registra el uso del panel. | US §9 (observabilidad) |

### Negative-space (lo que NO debe pasar)

| # | Requisito |
|---|---|
| N-1 | Ningún endpoint selecciona una columna de PII del comprador (`buyer_name`/`buyer_email`/`buyer_phone`) — los 3 datasets sólo leen `status`, `total_ars_cents`, `created_at` y los ítems. |
| N-2 | Un período sin órdenes nunca responde error — siempre `200` con ceros/arrays vacíos (AC-5). `breakdown_by_status` de `summary` siempre trae las 4 claves activas, zero-fill incluido, nunca un objeto incompleto. |
| N-3 | `from > to` es el único caso que produce `422` (`dsm:reports/invalid-range`) — un rango que excede la retención se acota, no se rechaza. |
| N-4 | Ningún evento de observabilidad (`reports.viewed`/`.exported`) lleva un rango de fechas como dimensión de métrica (cardinalidad) ni PII — sólo el nombre del dataset. |

### No funcionales

| # | Requisito | Verificación |
|---|---|---|
| NFR-1 | Latencia p95 de lectura < 300ms en los 3 datasets (US §9, heredado del mismo NFR que `list_orders`, CAP-5). | `QA-016-PERF-1` (k6) — p95 medido 601/586/650µs, muy por debajo del presupuesto. |
| NFR-2 | Sin índice nuevo sobre `orders`/`order_items` — el compuesto existente `orders(status, created_at)` (US-008) y `order_items(order_id)` (US-008) cubren las tres queries a la volumetría esperada (~100 órdenes/mes). | Suite dev-owned; gatillo de revisión documentado si el volumen crece dos órdenes de magnitud (`design.md` §D8). |
| NFR-3 | Los 6 endpoints están detrás de `AdminGuard` (reusado, sin modificar) — acceso restringido a `role=admin`. | `e2e-rbac.spec.ts` (dev-owned) + `QA-016-E2E-*` (cross-stack). |

### Diferidos con dueño

| # | Requisito | Dueño / disparador |
|---|---|---|
| D-1 | Analítica de tráfico/sesiones/conversión web (Google Analytics o similar). | Owner: PO — US §4, fuera de v1. |
| D-2 | Pronósticos/forecasting sobre los datasets. | Owner: PO — US §4, fuera de v1. |
| D-3 | Exportación contable/AFIP. | Owner: PO — roadmap (PRD §2.2). |
| D-4 | Índice nuevo sobre `orders`/`order_items` para las queries de agregación. | Owner: quien detecte degradación — sin medición real que lo justifique hoy (YAGNI, `design.md` §D8); primera palanca a tirar si el volumen crece un orden de magnitud. |
| D-5 | Alertas u observabilidad ampliada (dashboards nuevos, SLOs propios) sobre el uso del panel. | Owner: operaciones — superficie backoffice de bajo tráfico, mismo criterio que el resto del panel admin (catálogo/órdenes/imports): sin gate de CI ni alerta dedicada. |

## Desde US-016 frontend-web — Panel de métricas del dueño (archivada 2026-09-06)

Consume el contrato de arriba desde `apps/web/src/features/metrics/` (feature
llamada `metrics`, asimétrica respecto al backend que usa `reports`/`Reports*`
— ver `decisions.md` D7). Ruta nueva `/admin/metricas`, dentro del route
group `(admin)` ya existente (hereda `AdminGuard`). Sin superficie HTTP
propia — este bloque documenta el comportamiento de UI que gobierna cómo se
consume el contrato, no un requisito de API nuevo.

### Funcionales

| # | Requisito | Origen |
|---|---|---|
| R-10 | `SalesChart` (`ComposedChart` de Recharts, barras + línea, con tabla accesible equivalente) visualiza AC-1. | AC-1 |
| R-11 | `TopProductsTable` (TanStack Table, ordenable por cantidad) visualiza AC-2. | AC-2 |
| R-12 | `SummaryCards` (tarjetas KPI: órdenes, monto, desglose por estado) visualiza AC-3. | AC-3 |
| R-13 | `RangeFilterForm` con aplicación explícita del rango (botón "Aplicar") + selector de granularidad con aplicación inmediata en `SalesChart`. | AC-4 |
| R-14 | Tres widgets independientes, cada uno con su propio `AsyncState<T>` (frontend-standards §11.9) — el fallo de un dataset no rompe los otros dos; cada widget tiene su propio "Reintentar". | Aislamiento de fallas (design.md Decisión 8) |
| R-15 | Un período sin datos se representa como estado `success` vacío explícito por widget, nunca como `error`. | AC-5 |
| R-16 | Tres botones de export CSV (uno por widget) vía Blob — mismo patrón que `imports`, reusando los helpers extraídos `downloadCsv`/`contentDisposition` (`src/lib/http/`). | AC-6 |
| R-17 | Cuando el backend recorta el `from` pedido (AC-9), cada widget muestra una nota de "rango acotado" transparente, calculada por un helper puro compartido (`rangeClampNote.ts`) con el `{requested, effective}` que ESE widget recibió. | AC-9 |
| R-18 | El rango de fechas vive en estado de cliente (`useState`, no `searchParams`) — mismo precedente que el filtro de `status` de `OrdersList` (CAP-5). | design.md Decisión 3 |
| R-19 | Gráficos vía Recharts `^3.9.0`, cargados client-only (`next/dynamic(ssr:false)`) — primera versión con soporte nativo a React 19 sin overrides de `react-is`. | design-system §9 (pre-aprobado), design.md Decisión 7 |

### Negative-space (lo que NO debe pasar)

| # | Requisito |
|---|---|
| N-5 | El FE no re-filtra ni re-interpreta qué cuenta como "venta" (AC-8) — muestra tal cual lo que el backend ya filtró; sólo agrega un caption informativo. La autoridad real del filtro es 100% backend. |
| N-6 | Ningún widget dispara un fetch por cada `onChange` intermedio de los inputs de fecha del rango — sólo al confirmar "Aplicar" (evita ruido de 3 fetches por estado intermedio inválido de un `<input type="date">`). |
| N-7 | El panel no agrega un nav/sidebar nuevo entre las pantallas admin — `/admin/metricas` es alcanzable por URL directa, igual que sus hermanas (`admin/ordenes`, `admin/importar`, `admin/productos`), ninguna de las cuales se enlaza entre sí hoy. |

### Diferidos con dueño

| # | Requisito | Dueño / disparador |
|---|---|---|
| D-6 | Rango de fechas persistido en la URL (deep-linking a un período específico, no se puede compartir un link con un rango ya aplicado). | Owner: PO — no pedido por ningún AC de US-016; mismo criterio que `OrdersList`, que tampoco lo persiste. Reversible: cambio acotado a `MetricsDashboard` sin tocar los 3 widgets (design.md Decisión 3). |
| D-7 | Nav/sidebar compartido entre las 5 pantallas del panel admin. | Owner: PO — cambio transversal al panel completo, no específico de esta US; fuera de alcance sin pedido explícito. |
