# Capacidad: Panel de métricas del dueño (CAP-9)

**Estado**: backend + frontend-web entregados. QA de US-016 está construido
en `main` pero todavía no archivado al momento de este archive (ver "Changes
que formaron esta capacidad").

Estado declarado del sistema para la capacidad CAP-9 del PRD §2.1. Este
directorio es el **acumulado** de los changes archivados: se extiende en
cada `/archive-change`, nunca se reescribe.

## Por qué esta capacidad no existía todavía

El PRD §6 y el E2E (§6.1, componente `MetricsModule`) previeron desde el
inicio que el dueño necesitaría ver cómo va el negocio (ventas, productos
más pedidos, evolución temporal), pero ninguna US anterior la implementaba
— dependía de tener historial real de órdenes confirmadas, que sólo se
volvió alcanzable sin sembrar filas a mano en tests cuando
`US-010-orden-webhook-stock-backend` archivó (confirmación automática de
pago + decremento de stock, 2026-09-05).

## Qué está vivo hoy

Módulo nuevo y angosto `apps/api/src/reports/` (nombre de clase `Reports*`,
deliberadamente distinto del nombre `MetricsModule` del E2E — ver
`decisions.md` D1), sin extender `checkout/`, `orders/` ni `observability/`:

- **Evolución de ventas en el tiempo** (AC-1): `GET /admin/reports/sales`,
  agrupada por día/semana/mes.
- **Productos más pedidos** (AC-2): `GET /admin/reports/top-products`,
  ranking por cantidad vendida sobre el snapshot de `order_items`.
- **Resumen del período** (AC-3): `GET /admin/reports/summary` — cantidad
  de órdenes, monto facturado (ARS) y desglose por los 4 estados activos.
- **Rango temporal elegible** (AC-4): `created_at_from`/`created_at_to` en
  los 3 endpoints (y sus exports); sin rango, default a los últimos 30 días.
- **Período sin datos → 200 con ceros/arrays vacíos** (AC-5), nunca error.
- **Export CSV por dataset** (AC-6): `GET /admin/reports/{dataset}/export`
  — un path por operación, misma agregación que su endpoint JSON hermano.
- **Acceso restringido a admin** (AC-7): `AdminGuard` reusado sin modificar
  en los 6 endpoints.
- **Sólo órdenes confirmadas cuentan como venta** (AC-8):
  `status IN (new, preparing, ready, delivered)` — mismo criterio de CAP-5.
  `pending_payment` y `cancelled` (reembolsado) nunca cuentan.
- **Histórico limitado a 12 meses** (AC-9): un `created_at_from` más viejo
  que `ORDER_RETENTION_MONTHS` se acota silenciosamente al piso, la
  respuesta lleva el rango EFECTIVO en `range`.
- **Órdenes anonimizadas (CAP-13) cuentan igual**: ninguna columna que estos
  endpoints leen es tocada por la anonimización de PII de contacto.
- **Observabilidad sin PII**: `reports.viewed`/`reports.exported` con el
  dataset como única dimensión (`sales`/`top-products`/`summary`).
- **Sin persistencia nueva**: agregaciones (`$queryRaw` parametrizado) sobre
  `orders`/`order_items`, ya migradas desde US-008.

Además, el panel del dueño consume el contrato desde
`apps/web/src/features/metrics/` (feature `metrics`, asimétrica del nombre
backend `reports`/`Reports*` por diseño — ver `decisions.md` D7), montado en
la ruta nueva `/admin/metricas` (route group `(admin)`, hereda `AdminGuard`):

- **`SalesChart`** (AC-1): `ComposedChart` de Recharts (barras + línea) con
  tabla accesible equivalente, selector de granularidad de aplicación
  inmediata.
- **`TopProductsTable`** (AC-2): TanStack Table, ordenable por cantidad.
- **`SummaryCards`** (AC-3): tarjetas KPI — órdenes, monto, desglose por
  estado.
- **`RangeFilterForm`** (AC-4): aplicación explícita del rango vía botón
  "Aplicar" — evita 3 fetches por cada estado intermedio inválido de un
  `<input type="date">`.
- **Aislamiento de fallas por widget** (D9): `AsyncState<T>` independiente
  por widget (frontend-standards §11.9) — un fallo en uno no rompe los
  otros dos.
- **Transparencia del rango acotado** (AC-9): `rangeClampNote.ts`, helper
  puro compartido, calculado por widget con el `{requested, effective}` que
  ESE widget recibió.
- **3 exports CSV** (AC-6), uno por widget, vía Blob — reusa los helpers
  `downloadCsv`/`contentDisposition` extraídos de `imports/` (refactor
  behavior-preserving, sin cambiar el comportamiento de import).
- **Sin filtro propio de "venta"** (AC-8): el FE muestra tal cual lo que el
  backend ya filtró — la autoridad real es 100% backend (`SALE_STATUSES`,
  D2 arriba).
- **Sin nav/sidebar nuevo** (D9 del design.md FE): `/admin/metricas` es
  alcanzable por URL directa, igual que sus hermanas del panel admin.

## Qué NO está vivo todavía

- **Analítica de tráfico/sesiones/conversión web** (Google Analytics o
  similar) — fuera de v1 (US §4).
- **Pronósticos/forecasting** sobre los datasets — fuera de v1 (US §4).
- **Exportación contable/AFIP** — roadmap (PRD §2.2).
- **Rango de fechas persistido en la URL** (deep-linking) — decisión
  consciente, no una omisión (`decisions.md`, requirements.md D-6).
- **Nav/sidebar compartido** entre las 5 pantallas del panel admin —
  cambio transversal fuera de alcance de esta US (requirements.md D-7).

## Contratos

El contrato vivo de la superficie REST está en [`contracts/openapi.yaml`](contracts/openapi.yaml)
+ un archivo por endpoint bajo [`contracts/openapi/paths/`](contracts/openapi/paths/).
Seedeado directo desde el spec **publicado** del servicio
(`apps/api/docs/api/openapi.yaml`) — sin brecha de sincronización (a
diferencia de `retencion-datos-personales`, ver su `decisions.md`).

| Endpoint | Métodos | AC |
|---|---|---|
| `/admin/reports/sales` | GET | AC-1, AC-4, AC-5, AC-9 |
| `/admin/reports/sales/export` | GET | AC-6 |
| `/admin/reports/top-products` | GET | AC-2, AC-4, AC-5, AC-9 |
| `/admin/reports/top-products/export` | GET | AC-6 |
| `/admin/reports/summary` | GET | AC-3, AC-5, AC-9 |
| `/admin/reports/summary/export` | GET | AC-6 |

## Changes que formaron esta capacidad

| Change | Disciplina | Aporte |
|---|---|---|
| [`US-016-panel-metricas-backend`](../../changes/archive/US-016-panel-metricas-backend/) | BE | Módulo `reports/` completo, 6 endpoints, sin migraciones, `ReportsEventsService` |
| [`US-016-panel-metricas-frontend-web`](../../changes/archive/US-016-panel-metricas-frontend-web/) | FE | Feature `metrics/` (3 widgets independientes), ruta `/admin/metricas`, Recharts `^3.9.0`, refactor compartido de descarga CSV con `imports/` |

Sin disciplina QA propia archivada todavía en este directorio.
`US-016-panel-metricas-qa` (PR #60) ya mergeó a `main` y se archiva a
continuación en la misma tanda — ver el índice
(`docs/_index/openspec-changes.yaml`) para su estado más reciente si este
README no se actualizó todavía.

## Estado de la provisión

Corre hoy en **entorno local** (`docker-compose`, Postgres). La provisión de
nube es US-019, igual que el resto del sistema.
