# Capacidad: Panel de métricas del dueño (CAP-9)

**Estado**: backend entregado. Sin panel de lectura todavía (frontend-web y
QA de US-016 están construidos en `main` pero no archivados — ver "Changes
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

## Qué NO está vivo todavía

- **Dashboard/gráficos en el panel del dueño** — construido en
  `apps/web/src/features/metrics/` (PR #59, mergeado a `main`) pero el
  change `US-016-panel-metricas-frontend-web` todavía no está archivado al
  momento de escribir esto (arquitectura de archive incremental, una
  disciplina a la vez).
- **Analítica de tráfico/sesiones/conversión web** (Google Analytics o
  similar) — fuera de v1 (US §4).
- **Pronósticos/forecasting** sobre los datasets — fuera de v1 (US §4).
- **Exportación contable/AFIP** — roadmap (PRD §2.2).

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

Sin disciplinas FE/QA propias archivadas todavía en este directorio.
`US-016-panel-metricas-frontend-web` (PR #59) y `US-016-panel-metricas-qa`
(PR #60) ya mergearon a `main` y se archivan a continuación en la misma
tanda — ver el índice (`docs/_index/openspec-changes.yaml`) para su estado
más reciente si este README no se actualizó todavía.

## Estado de la provisión

Corre hoy en **entorno local** (`docker-compose`, Postgres). La provisión de
nube es US-019, igual que el resto del sistema.
