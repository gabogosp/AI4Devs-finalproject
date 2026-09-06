---
tracker-id: null
tracker-source: null
parent-us: US-016
discipline: backend
variant: null
language: es
audit-derived: false
archived: true
archived_at: 2026-09-06
merged_commit: 72afc73113f2fb4f7898d609c3ce228ac2f4bbc9
pr-url: https://github.com/gabogosp/AI4Devs-finalproject/pull/55
---

# Proposal — Panel de métricas del dueño (backend)

> **Ticket**: US-016 — Panel de métricas / gráficos del dueño
> **Author**: backend-node-developer agent (assisted by @gabogosp)
> **Date**: 2026-09-05
> **Status**: Proposed
> **Affected layers**: controller, service, repositorio (módulo nuevo, sin extender
> ninguno existente), DTO, dominio (parseo/clamp de rango, sin FSM), observabilidad,
> contrato OpenAPI. **Sin persistencia nueva** (cero migraciones).
> **Affected platform**: `apps/api` (NestJS)

## Por qué

US-016 es la capacidad 9 del PRD: el dueño necesita ver cómo va el negocio
(ventas, productos más pedidos, evolución temporal) sobre el historial de
órdenes de hasta 12 meses (PRD §6, US-021 ya materializa la retención). Es
**agregación de sólo lectura** sobre datos que ya existen — `orders`/`order_items`
(CAP-10 checkout, CAP-5 fulfillment) — sin ninguna escritura nueva ni tabla
nueva.

**Dependencia declarada por la US (§6) ya resuelta**: US-016 estaba
`blocked_by: [US-010]` en `docs/_index/us-status.yaml`.
`US-010-orden-webhook-stock-backend` archivó el 2026-09-05 (confirmación
automática de pago + decremento de stock); las órdenes en `new`/`preparing`/
`ready`/`delivered` que este change agrega ya existen como dato real
producible por el sistema (antes sólo alcanzables sembrando filas a mano en
tests). Este plan no depende de código que US-010 iba a construir — sólo lee
`orders`/`order_items`, ya migradas desde US-008.

## Qué

**Crea un módulo nuevo y angosto: `apps/api/src/reports/`.** Tres datasets de
agregación + su export CSV cada uno, seis endpoints GET en total, todos
detrás de `AdminGuard` (reusado, sin modificar):

- `GET /v1/admin/reports/sales` — evolución de ventas en el tiempo, agrupada
  por día/semana/mes (AC-1).
- `GET /v1/admin/reports/sales/export` — CSV de la serie anterior (AC-6).
- `GET /v1/admin/reports/top-products` — ranking de productos más pedidos por
  cantidad (AC-2).
- `GET /v1/admin/reports/top-products/export` — CSV del ranking (AC-6).
- `GET /v1/admin/reports/summary` — totales del período: cantidad de
  órdenes, monto facturado (ARS) y desglose por estado de fulfillment (AC-3).
- `GET /v1/admin/reports/summary/export` — CSV del resumen (AC-6).

Los tres datasets comparten:

- **Rango temporal** (`created_at_from`/`created_at_to`, AC-4): si se omiten,
  default a los últimos 30 días; si el rango pedido excede la retención
  vigente (`ORDER_RETENTION_MONTHS`, default 12, la misma env var que
  US-021), el `from` se **acota silenciosamente** al piso de retención — el
  panel "no muestra datos más antiguos" (AC-9) sin convertir eso en un error.
  `from > to` sí es 422 (`dsm:reports/invalid-range`).
- **Sólo órdenes confirmadas cuentan como venta** (AC-8): el filtro es
  `status IN ('new','preparing','ready','delivered')` — el mismo conjunto de
  4 estados activos que ya usa el panel de fulfillment (CAP-5, US-012).
  `pending_payment` nunca entra (AC-8 literal); `cancelled` tampoco entra,
  porque una orden cancelada automáticamente (US-010, stock insuficiente)
  fue **reembolsada** — no es una venta real. Ver `design.md` §D2 para la
  justificación completa de esta interpretación.
- **Período sin datos → 200 con ceros/arrays vacíos, nunca error** (AC-5).
- **Órdenes anonimizadas (US-021) cuentan igual** en los tres agregados: el
  `anonymized_at` sólo pisa `buyer_name`/`buyer_email`/`buyer_phone`
  (`retencion-datos-personales/requirements.md` R-3) — ninguna columna que
  estos endpoints leen (`status`, `total_ars_cents`, `created_at`, `items`)
  cambia. Ninguno de los tres endpoints selecciona una columna de PII del
  comprador, así que no hay nada que filtrar ni que anonimizar dos veces.

**Sin persistencia nueva.** Ni tabla ni columna: los tres datasets son
agregaciones (`GROUP BY`/`date_trunc`/`SUM`) sobre `orders`/`order_items`, ya
migradas. Se usa `$queryRaw` con template tag parametrizado (mismo patrón que
`search/search.repository.ts`, el primer y único precedente de SQL crudo en
`apps/api` hasta hoy) porque Prisma no expresa `GROUP BY date_trunc(...)`
sobre un `$queryRaw`-free ORM. Evaluado per `data-architecture-patterns`: caso
trivial (cero migración, cero tabla nueva), no se invoca `data-architect`
Mode B.

**Deviación deliberada de nombres respecto al C4 del E2E (§6.1)**: el E2E
nombra el componente `MetricsModule` ("Agregaciones para gráficos del
dueño"). Ese nombre de clase **ya existe** en el repo —
`apps/api/src/observability/{metrics.module,metrics.service,metrics.controller}.ts`—
y es el scrape Prometheus de métricas técnicas (`GET /v1/admin/metrics`,
`AUDIT-dsm-api-006`), no el dashboard de negocio del dueño. Colisionar el
nombre de clase (y casi el path — `/v1/admin/metrics/*` vs `/v1/admin/metrics`)
sería confuso y frágil. Este plan usa **`Reports*`** (`ReportsModule`,
`ReportsController`, `ReportsService`, `ReportsRepository`) montado en
`v1/admin/reports` — sin colisión de clase ni de URL con el scrape existente,
misma intención del componente del E2E, otro nombre. Documentado en
`design.md` §D1.

**Observabilidad**: `ReportsEventsService` (mismo esqueleto que
`OrderEventsService`/`CheckoutEventsService`) emite `reports.viewed`/
`reports.exported` con el dataset (`sales`/`top-products`/`summary`) como
única dimensión — nunca PII, nunca un rango de fechas como dimensión de
métrica (cardinalidad). Registra uso del panel (US §9).

**No toca**: `AdminGuard`, `HttpProblemFilter`, `MetricsModule`/`MetricsService`/
`MetricsController` de `observability/` (el scrape Prometheus sigue
exactamente igual), `checkout/orders.repository.ts`, `orders/` (CAP-5). Sí
**extrae** (refactor behavior-preserving, Extract Function) la neutralización
de celdas CSV de `imports/report-csv.ts` a un utilitario compartido
`common/csv/csv-cell.ts` — reusado por los 3 exports nuevos y por el reporte
de import ya existente, sin cambiar su comportamiento (tests de import
siguen verdes sin tocar sus asserts).

## AC de la US cubiertos por este change

| AC | Cubierto | Nota |
|---|---|---|
| AC-1 evolución de ventas en el tiempo | ✅ | `GET /v1/admin/reports/sales` — granularidad día/semana/mes |
| AC-2 productos más pedidos | ✅ | `GET /v1/admin/reports/top-products` — por cantidad vendida |
| AC-3 resumen del período | ✅ | `GET /v1/admin/reports/summary` — órdenes, monto, desglose por estado |
| AC-4 elegir el rango temporal | ✅ | `created_at_from`/`created_at_to` en los 3 endpoints (y sus exports) |
| AC-5 período sin datos | ✅ | 200 con ceros/arrays vacíos — nunca error |
| AC-6 exportar datos crudos | ✅ | 3 endpoints `/export` (CSV, `Content-Disposition: attachment`) |
| AC-7 acceso restringido — **autoridad real** | ✅ | `AdminGuard` en los 6 endpoints; barrido en `e2e-rbac.spec.ts` |
| AC-8 sólo órdenes pagadas cuentan — **autoridad real** | ✅ | `status IN (new,preparing,ready,delivered)`, nunca `pending_payment`/`cancelled` |
| AC-9 histórico limitado a 12 meses | ✅ | `from` acotado server-side al piso de `ORDER_RETENTION_MONTHS` |

## Decisiones de este plan

### 1 — Dónde vive la superficie y cómo se llama

Módulo nuevo `apps/api/src/reports/`, sin extender `checkout/`, `orders/` ni
`observability/`. Las lecturas van directo contra `orders`/`order_items` vía
un repositorio propio (`ReportsRepository`, sólo `$queryRaw` — no hay
escritura que justifique reusar `OrdersRepository` de `checkout/`). Nombre de
clase `Reports*` en vez de `Metrics*` — ver "Qué" arriba y `design.md` §D1.

### 2 — Qué cuenta como "venta" (AC-8, interpretación)

`status IN ('new','preparing','ready','delivered')`. Se descarta incluir
`cancelled`: una orden llega a `cancelled` únicamente cuando el pago
automático (MercadoPago/simulado) se aprobó pero el stock ya no alcanzaba —
la orden se cancela y el pago queda `refund_pending`/reembolsado
(`pagos/requirements.md` R-10). Contarla como venta inflaría el "monto
facturado" con dinero que se devuelve. Es la misma allowlist de 4 estados que
ya usa `GET /v1/admin/orders` (CAP-5) — sin inventar un segundo criterio de
"orden pagada" en el sistema.

### 3 — Export CSV: un endpoint por dataset, no un multiplexor

`GET /v1/admin/reports/{dataset}/export` en vez de un único
`GET /v1/admin/reports/export?dataset=...`. Mismo patrón que
`GET /v1/admin/imports/{id}/report` (US-006, único precedente de descarga CSV
en el repo): un path por operación, sin un `switch` de formato de fila
escondido detrás de un query param. Cada export reusa la misma query de
agregación que su endpoint JSON hermano — no hay una segunda fuente de
verdad para los números.

### 4 — Rango temporal: acotar, no rechazar (AC-9)

Un `created_at_from` más viejo que el piso de retención se **ajusta**
server-side al piso (no 422) — consistente con AC-5 ("nunca un error") y con
la letra de AC-9 ("el panel no muestra datos más antiguos", no "rechaza
rangos que los pidan"). `from > to` sí es 422 — es una entrada
incoherente, no una ventana que exceda la retención.

## Out of scope

- **Analítica de tráfico/sesiones/conversión web** (Google Analytics o
  similar) — US §4, fuera de v1.
- **Pronósticos/forecasting** — US §4, fuera de v1.
- **Exportación contable/AFIP** — roadmap (PRD §2.2).
- **Índice nuevo** sobre `orders`/`order_items` — el compuesto existente
  `orders(status, created_at)` (US-008) y `order_items(order_id)` (US-008)
  cubren las tres queries a la volumetría esperada (~100 órdenes/mes). Ver
  `design.md` §D8.
- **Dashboard/gráficos del frontend** — sibling
  `US-016-panel-metricas-frontend-web` (no planificado en esta sesión).
- **Alertas u observabilidad ampliada** (dashboards nuevos, SLOs propios) —
  superficie backoffice de bajo tráfico, mismo criterio que el resto del
  panel admin (catálogo/órdenes/imports): sin gate de CI ni alerta dedicada.

## Dependencias

**Ninguna dependencia bloqueante de código.** `orders`/`order_items` existen
desde US-008; `AdminGuard`/`HttpProblemFilter` existen desde US-001;
`ORDER_RETENTION_MONTHS` existe desde US-021 (ya archivada). El
`blocked_by: [US-010]` declarado en `docs/_index/us-status.yaml` está
**resuelto** (US-010 archivada 2026-09-05) — ver nota en el índice al cierre
de este plan.

**Dependencia no bloqueante, informativa**: `US-016-panel-metricas-frontend-web`
(sin planificar todavía) consumirá este contrato.

## Linear

MCP de Linear no conectado — proyecto local-only. No se crean sub-tasks en Linear.

## References

- User story: [`docs/user-stories/US-016-panel-metricas.md`](../../../docs/user-stories/US-016-panel-metricas.md)
- PRD: [`docs/product/prd.md`](../../../docs/product/prd.md) §2.1 capacidad 9, §6
- E2E: [`docs/product/design-e2e.md`](../../../docs/product/design-e2e.md) §6.1
  (`MetricsModule`, renombrado — ver decisión 1), §17, §18, §18.5
- Capacidades hermanas leídas (sin modificar): `openspec/specs/ordenes/`
  (CAP-5, allowlist de 4 estados activos — mismo criterio de "venta" acá),
  `openspec/specs/checkout/` (CAP-10, `orders`/`order_items`),
  `openspec/specs/pagos/` (CAP-4, por qué `cancelled` no es venta),
  `openspec/specs/retencion-datos-personales/` (CAP-13, por qué una orden
  anonimizada sigue contando)
- Precedente de patrón: `apps/api/src/search/search.repository.ts` ($queryRaw
  parametrizado), `apps/api/src/imports/{imports.controller,report-csv}.ts`
  (endpoint `:id/report`, neutralización CSV), `apps/api/src/checkout/orders-retention.service.ts`
  (`cutoffDate()`, mismo cálculo de mes reusado acá)
- Standards consultados (detalle completo en `design.md` §References):
  `base-standards.md` §1 · `backend-node-standards.md` §2-§9 ·
  `api-standards.md` §5.3, §7.1, §10.5 · `security-standards.md` §4, §6.2,
  §6.3 · `observability-standards.md` §9 · `data-architecture-patterns`
  (skill, evaluación trivial) · `threat-modeling-lite` (skill, §D9 de
  `design.md`) · `nfr-quantification` (skill, §D8)
