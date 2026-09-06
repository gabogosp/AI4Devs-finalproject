# CAP-9 Panel de métricas del dueño — Decisiones

Decisiones que gobiernan el estado vivo de la capacidad. Los ADR son la
fuente de verdad; acá se registra **cuál aplica a esta capacidad y por qué**.

## ADRs que aplican

| ADR | Decisión | Impacto en esta capacidad |
|---|---|---|
| ADR-0009 | Seam de auth admin (`AdminGuard`, `role=admin`). | Los 6 endpoints son admin-only, mismo guard que el resto de `/v1/admin/*` — sin modificar. |

Ninguna decisión de este change abre un ADR nuevo.

## Decisiones de implementación

### D1 — Nombre de clase deliberadamente distinto al C4 del E2E

El E2E (§6.1) nombra el componente `MetricsModule` ("Agregaciones para
gráficos del dueño"). Ese nombre de clase **ya existía** en el repo —
`apps/api/src/observability/{metrics.module,metrics.service,metrics.controller}.ts`
— y es el scrape Prometheus de métricas técnicas (`GET /v1/admin/metrics`),
no el dashboard de negocio del dueño. Colisionar el nombre de clase (y casi
el path — `/v1/admin/metrics/*` vs `/v1/admin/metrics`) habría sido confuso
y frágil.

**Decisión**: el módulo se llama `Reports*` (`ReportsModule`,
`ReportsController`, `ReportsService`, `ReportsRepository`), montado en
`/v1/admin/reports` — sin colisión de clase ni de URL con el scrape
existente, misma intención del componente del E2E, otro nombre. La
**capacidad OpenSpec**, en cambio, se llama `metricas` (este directorio) —
el nombre de negocio (US-016 "panel de métricas") que no colisiona con nada,
distinto del nombre de clase en código. Esta asimetría (capacidad
`metricas`, endpoints/clases `reports`/`Reports*`) es intencional y está
documentada acá para que quien lea el código y el spec por separado no la
lea como un error.

### D2 — Qué cuenta como "venta" (AC-8)

`status IN ('new','preparing','ready','delivered')`. Se descarta incluir
`cancelled`: una orden llega a `cancelled` únicamente cuando el pago
automático (MercadoPago/simulado) se aprobó pero el stock ya no alcanzaba —
la orden se cancela y el pago queda reembolsado (`pagos/requirements.md`
R-10). Contarla como venta inflaría el "monto facturado" con dinero que se
devuelve. Es la misma allowlist de 4 estados que ya usa `GET /v1/admin/orders`
(CAP-5) — sin inventar un segundo criterio de "orden pagada" en el sistema.

### D3 — CSV compartido: extracción a `common/csv/csv-cell.ts`

Refactor behavior-preserving (Extract Function): la neutralización de
celdas CSV vivía sólo en `imports/report-csv.ts`. Se extrajo a un utilitario
compartido `common/csv/csv-cell.ts`, reusado por los 3 exports nuevos de
esta capacidad y por el reporte de import ya existente, sin cambiar su
comportamiento (los tests de import existentes siguen verdes sin tocar sus
asserts).

### D4 — Rango temporal: acotar, no rechazar (AC-9)

Un `created_at_from` más viejo que el piso de retención (`ORDER_RETENTION_MONTHS`,
CAP-13) se **ajusta** server-side al piso (no `422`) — consistente con AC-5
("nunca un error") y con la letra de AC-9 ("el panel no muestra datos más
antiguos", no "rechaza rangos que los pidan"). `from > to` sí es `422`
(`dsm:reports/invalid-range`) — es una entrada incoherente, no una ventana
que exceda la retención.

### D5 — Sin persistencia nueva, `$queryRaw` parametrizado

Los tres datasets son agregaciones (`GROUP BY`/`date_trunc`/`SUM`) sobre
`orders`/`order_items`, ya migradas desde US-008. Se usa `$queryRaw` con
template tag parametrizado (mismo patrón que `search/search.repository.ts`,
el primer precedente de SQL crudo en `apps/api`) porque Prisma no expresa
`GROUP BY date_trunc(...)` sin `$queryRaw`. Evaluado per
`data-architecture-patterns`: caso trivial (cero migración, cero tabla
nueva), no se invocó `data-architect` Mode B.

### D6 — Export CSV: un endpoint por dataset

`GET /admin/reports/{dataset}/export` en vez de un único
`GET /admin/reports/export?dataset=...` — mismo patrón que
`GET /admin/imports/{id}/report` (US-006): un path por operación, sin un
`switch` de formato de fila escondido detrás de un query param. Cada export
reusa la misma query de agregación que su endpoint JSON hermano.

## Riesgo de reconciliación con `ordenes`/`pagos`/`retencion-datos-personales`

Esta capacidad lee `orders`/`order_items` sin modificarlos — es puramente
de agregación. Cualquier cambio futuro al significado de un `status` de
orden (CAP-5, `ordenes/requirements.md` R-1) o a qué campos toca la
anonimización (CAP-13, `retencion-datos-personales/requirements.md` R-3)
debe revisar si `SALE_STATUSES` (D2 arriba) sigue siendo correcto — no hay
un mecanismo automático que lo detecte, es responsabilidad de quien toque
esas capacidades hermanas.

## Desviaciones conscientes registradas (backend)

Ninguna. El `tasks.md` de este change sí tuvo su task de "mergear al spec
publicado" (`apps/api/docs/api/openapi.yaml`) y quedó verde antes del
archive — a diferencia de `retencion-datos-personales` (US-021), no hay
brecha de sincronización que documentar acá.

## Decisiones de implementación (frontend-web)

### D7 — Nombre de la feature: `metrics` (FE) vs `reports`/`Reports*` (BE)

El backend usa `Reports*`/`reports` por la colisión de nombre con
`MetricsService` de observabilidad (D1 arriba). El frontend **no tiene esa
colisión** — no existe ningún `Metrics*` en `apps/web`. Se eligió
`src/features/metrics/`, siguiendo el nombre de la pantalla tal como la
nombra la US y el E2E ("panel de métricas"), en vez de espejar el nombre del
módulo backend. `metricsService.ts` consume operaciones cuyo path HTTP es
`admin/reports/*` — la asimetría de nombres (capacidad `metricas`, feature
FE `metrics`, endpoints/clases BE `reports`/`Reports*`) es intencional y
está documentada en los 3 lugares (D1, D7, y el README de esta capacidad)
para que no se lea como un error de tres personas distintas.

### D8 — Un chart, una tabla, tarjetas — no chart×3

AC-1 (evolución de ventas) es una serie temporal → `SalesChart`
(`ComposedChart` de Recharts). AC-2 (ranking de productos) es mejor servido
por una tabla ordenable (`TopProductsTable`, TanStack Table) que por una
barra — permite ver SKU/cantidad/monto en la misma fila y ordenar por
cualquier columna. AC-3 (totales del período) son KPIs puntuales, no una
serie → `SummaryCards`. Forzar un chart en los 3 widgets habría inflado la
superficie de Recharts sin ganancia de legibilidad y contradicho
`frontend-standards.md` §11.bis.7 (tablas como default en backoffice para
datos tabulares).

### D9 — Aislamiento de fallas por widget

Los 3 endpoints del backend son independientes (sin transacción
compartida) — si `top-products` está momentáneamente lento o falla, no hay
razón de negocio para esconder el chart de ventas que sí respondió. Cada
widget tiene su propio `AsyncState<T>` (frontend-standards §11.9) y su
propio botón "Reintentar" — mismo patrón que `OrdersList`
(`frontend-resilience-patterns` skill, patrón #10: aislar fallas por
componente).

## Desviaciones conscientes registradas (frontend-web)

Ninguna. `RangeFilterForm` (aplicación explícita del rango) y el resto de
los 25 tasks cerraron verdes contra sus `Verify:` sin necesitar excepciones.
