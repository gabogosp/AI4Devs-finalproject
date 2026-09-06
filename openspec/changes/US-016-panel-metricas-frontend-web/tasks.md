# Tasks — Panel de métricas del dueño (frontend-web)

> Closure-grade: cada task trae `Exit criterion:` + `Verify:`, y `Pattern:`
> cuando aplica un patrón no obvio (`openspec-workflow` skill, TOK-2).

## Pre-flight

- [x] T0.1 Confirmar rama `feat/US-016-panel-metricas-dueno-frontend-web` (o
      la que corresponda per `git-workflow-standards.md`) y que no hay otro
      change abierto en `openspec/changes/` que toque `src/features/metrics/`.
  - **Exit criterion**: rama activa correcta; `openspec/changes/` sin change
    duplicado para US-016 frontend-web.
  - **Verify**: `git branch --show-current` + `ls openspec/changes/ | grep US-016`.
- [x] T0.2 Confirmar que el contrato `admin-reports` sigue publicado en
      `apps/api/docs/api/openapi.yaml` tal como lo dejó
      `US-016-panel-metricas-backend` (PR #55 podría haber cambiado shapes
      desde la planificación) y que el cliente generado ya lo refleja.
  - **Exit criterion**: los 6 paths `/admin/reports/*` y los schemas
    `AdminReports*` existen en el YAML con las mismas forma descriptas en
    `proposal.md`; `src/api/generated/model/index.ts` ya exporta tipos
    `AdminReports*` (heredado de la rama del backend).
  - **Verify**: `grep -n "admin/reports\|AdminReports" apps/api/docs/api/openapi.yaml` y `grep -c "AdminReports" apps/web/src/api/generated/model/index.ts` > 0.

## Phase 1 — Codegen (contrato → artefactos derivados)

- [x] T1.1 Confirmar que el cliente/Zod/MSW regenerado desde el contrato
      (`orval.config.ts` ya apunta a `../api/docs/api/openapi.yaml`, sin
      cambios de config) sigue en sync — ya se heredó de la rama del backend,
      pero se re-corre para blindar contra drift si el contrato cambió desde
      entonces.
  - **Pattern**: `pnpm --filter @dsm/web codegen` — per `openapi-client-codegen`
    skill + `frontend-standards.md` §3.2 (todo artefacto derivado del contrato
    se genera, nunca a mano).
  - **Exit criterion**: `src/api/generated/endpoints.ts` exporta
    `getAdminReportsSales`, `exportAdminReportsSales`,
    `getAdminReportsTopProducts`, `exportAdminReportsTopProducts`,
    `getAdminReportsSummary`, `exportAdminReportsSummary`; `model/` exporta
    los tipos `AdminReportsSales`, `AdminReportsSalesRow`,
    `AdminReportsTopProducts`, `AdminReportsTopProductsRow`,
    `AdminReportsSummary`, `AdminReportsStatusBreakdownEntry`; `zod.ts` exporta
    los schemas `Response` correspondientes (nombres exactos a confirmar contra
    la salida real de orval — el `typecheck` de T4.1 los ata en firme).
  - **Verify**: `grep -c "AdminReports" apps/web/src/api/generated/model/index.ts`
    devuelve > 0; `pnpm --filter @dsm/web typecheck` limpio.
- [x] T1.2 Confirmar que el gate `frontend-codegen-fresh` queda satisfecho
      (regenerar no produce diff adicional tras T1.1).
  - **Exit criterion**: segunda corrida de codegen no cambia nada.
  - **Verify**: `pnpm --filter @dsm/web codegen && git diff --quiet -- apps/web/src/api/generated && echo OK`.

## Phase 2 — Refactor compartido de export CSV (Extract Method, behavior-preserving)

- [x] T2.1 Extraer `filenameFromContentDisposition(headers, fallback)` a
      `src/lib/http/contentDisposition.ts`; `importsService.ts` pasa a
      llamarlo en vez de su `nombreDelHeader` local.
  - **Pattern**: Extract Method — per `refactoring-discipline` skill (invariante:
    firma pública de `importsService.downloadReport` sin cambios; mismo
    fallback `import-{id}-errores.csv`). Mismo movimiento que hizo el backend
    con `csvCell` (`US-016-panel-metricas-backend` design.md §D3).
  - **Exit criterion**: `importsService.test.ts` pasa sin tocar sus asserts;
    `contentDisposition.ts` tiene su propio test unitario (header presente,
    header ausente → fallback, header con comillas y sin comillas).
  - **Verify**: `pnpm --filter @dsm/web exec vitest run src/features/imports/importsService.test.ts src/lib/http/contentDisposition.test.ts`.
- [x] T2.2 Extraer la descarga vía Blob a `downloadCsv(csv: string, filename:
      string): void` en `src/lib/http/downloadCsv.ts`;
      `imports/reportDownload.ts` pasa a llamarlo.
  - **Pattern**: Extract Method — mismo invariante (comportamiento observable
    de `descargarReporte` sin cambios, incluye el `track('import_report_downloaded', …)`
    que se queda en `imports/reportDownload.ts`, no se mueve al helper
    compartido — el evento es específico de import, no de la descarga en sí).
  - **Exit criterion**: `reportDownload.test.ts` (imports) pasa sin tocar sus
    asserts; `downloadCsv.ts` tiene su propio test (crea Blob, dispara click,
    revoca URL — mock de `URL.createObjectURL`/`revokeObjectURL`).
  - **Verify**: `pnpm --filter @dsm/web exec vitest run src/features/imports/reportDownload.test.ts src/lib/http/downloadCsv.test.ts`.

## Phase 3 — Dependencia de charts

- [x] T3.1 Agregar `recharts` (`^3.9.0` — primera mayor con soporte nativo a
      React 19, sin overrides de peer-deps) a `apps/web/package.json`.
  - **Exit criterion**: `pnpm install` resuelve sin warnings de peer-deps para
    `recharts`; `pnpm --filter @dsm/web typecheck` sigue limpio.
  - **Verify**: `pnpm install --filter @dsm/web && pnpm --filter @dsm/web typecheck`.

## Phase 4 — Servicio de dominio

- [x] T4.1 `src/features/metrics/metricsService.ts` — envuelve las 6
      operaciones generadas + `parseContract`, re-exporta tipos de dominio
      (`SalesTimeseries`, `TopProductsRanking`, `PeriodSummary`, etc., a partir
      de los tipos generados — nunca declarados a mano).
  - **Pattern**: Repository pattern — per `frontend-standards.md` §11.5, mismo
    esqueleto que `ordersService.ts`/`importsService.ts` (F48: toda la red pasa
    por las operaciones generadas, cero `fetch` propio).
  - **Exit criterion**: `metricsService` expone `getSales`, `exportSales`,
    `getTopProducts`, `exportTopProducts`, `getSummary`, `exportSummary`, cada
    uno validando la respuesta JSON con el schema Zod generado (los `export*`
    devuelven `{ csv: string; filename: string }` usando
    `filenameFromContentDisposition`, igual que `importsService.downloadReport`).
  - **Verify**: `pnpm --filter @dsm/web typecheck`.
- [x] T4.2 Tests unitarios de `metricsService` con MSW: éxito de los 6
      endpoints + mapeo de 422 `dsm:reports/invalid-range` a
      `AppError.kind === 'validation'`.
  - **Pattern**: MSW `server.use(...)` por test — per `msw-setup` skill.
  - **Exit criterion**: cobertura de los 6 métodos + el caso 422.
  - **Verify**: `pnpm --filter @dsm/web exec vitest run src/features/metrics/metricsService.test.ts`.

## Phase 5 — Filtro de rango + nota de acotado (AC-4, AC-9)

- [x] T5.1 `src/features/metrics/rangeClampNote.ts` — helper puro
      `describeClamp(requested, effective): string | null`, reusado por los 3
      widgets (evita 3 copias divergentes del mismo texto).
  - **Exit criterion**: `null` cuando `requested` es `undefined` o coincide con
    `effective`; string con la fecha efectiva cuando difiere.
  - **Verify**: `pnpm --filter @dsm/web exec vitest run src/features/metrics/rangeClampNote.test.ts`.
- [x] T5.2 `src/features/metrics/RangeFilterForm.tsx` — dos `<input
      type="date">` (from/to) con estado "borrador" local + botón "Aplicar";
      valida `from <= to` inline (deshabilita "Aplicar" + mensaje) antes de
      llamar `onApply`.
  - **Pattern**: validación client-side de UX, autoridad sigue siendo el
    backend (422) — per `frontend-standards.md` §12.2. Aplicación explícita en
    vez de fetch-por-tecla — per `frontend-resilience-patterns` skill §6
    (debouncing: "anti-patrón: debounce en submit" — acá se evita necesitar
    debounce con una acción explícita).
  - **Exit criterion**: `onApply({from, to})` sólo se invoca con un rango
    válido; sin rango tocado, `onApply` nunca se llama con `from > to`.
  - **Verify**: `pnpm --filter @dsm/web exec vitest run src/features/metrics/RangeFilterForm.test.tsx`.

## Phase 6 — SalesChart (AC-1, AC-4, AC-5, AC-6, AC-9)

- [x] T6.1 `src/features/metrics/formatPeriod.ts` — helper puro que formatea
      `period_date` según `granularity` (`day` → `DD/MM`; `week` → "semana del
      DD/MM"; `month` → `MMM AAAA`, `Intl.DateTimeFormat('es-AR', …)`).
  - **Exit criterion**: un caso por granularidad con fecha fija.
  - **Verify**: `pnpm --filter @dsm/web exec vitest run src/features/metrics/formatPeriod.test.ts`.
- [x] T6.2 `src/features/metrics/charts/SalesComposedChart.tsx` — primitivo
      puro de Recharts (sin fetch, sin estado): `ComposedChart` con `Bar`
      (cantidad de órdenes, eje izquierdo, `#1A56DB`) + `Line` (monto
      facturado ARS, eje derecho, `#EA580C`) — paleta data-viz del
      design-system §9.
  - **Pattern**: `<YAxis yAxisId="left"/>` + `<YAxis yAxisId="right"
    orientation="right"/>`, `<Bar yAxisId="left"/>` + `<Line
    yAxisId="right"/>` — dual-axis `ComposedChart` (Recharts docs oficiales).
  - **Exit criterion**: dado un array de `SalesRow`, renderiza sin error un
    `Bar` y un `Line` con los `yAxisId` cruzados correctamente.
  - **Verify**: `pnpm --filter @dsm/web exec vitest run src/features/metrics/charts/SalesComposedChart.test.tsx`.
- [x] T6.3 `src/features/metrics/SalesChart.tsx` — `'use client'`; propio
      `AsyncState<SalesResponse>`; selector de granularidad (`<select>`,
      aplica de inmediato — a diferencia del rango, es un único valor
      discreto); carga `SalesComposedChart` vía
      `next/dynamic(() => import('./charts/SalesComposedChart'), { ssr: false,
      loading: () => <ChartSkeleton/> })`; `<details><summary>Ver datos en
      tabla</summary>` con la tabla accesible de los mismos valores
      (design-system §9); nota de `rangeClampNote`; botón de export CSV
      (`metricsService.exportSales` + `downloadCsv` + evento
      `metrics_export_downloaded`); estado vacío explícito cuando
      `data.length === 0` (icono + mensaje, nunca el chart vacío ni un error).
  - **Pattern**: `AsyncState<T>` (`frontend-standards.md` §11.9) — mismo
    esqueleto de efecto que `OrdersList.tsx` (`load` en `useCallback`, `useEffect`
    con las dependencias del query); `next/dynamic(ssr:false)` sólo es válido
    en un Client Component, nunca en el Server Component de la página.
  - **Exit criterion**: los 5 estados (`idle`/`loading`/`success con datos`/
    `success vacío`/`error con reintento`) tienen un render distinguible;
    cambiar `granularity` dispara un nuevo fetch sin tocar `range`.
  - **Verify**: `pnpm --filter @dsm/web exec vitest run src/features/metrics/SalesChart.test.tsx`.

## Phase 7 — TopProductsTable (AC-2, AC-4, AC-5, AC-6, AC-9)

- [x] T7.1 `src/features/metrics/TopProductsTable.tsx` — `'use client'`;
      TanStack Table sobre `TopProductsRow` (columnas: producto, SKU, cantidad
      vendida, monto ARS — `formatArs`); propio `AsyncState`; nota de
      `rangeClampNote`; botón export CSV; estado vacío explícito.
  - **Pattern**: TanStack Table — mismo esqueleto que `OrdersList.tsx`
    (`getCoreRowModel`, columnas con `accessorKey`) — per `frontend-standards.md`
    §11.bis.7 (tablas del backoffice).
  - **Exit criterion**: igual matriz de 5 estados que T6.3; filas ordenadas
    por `quantity_sold` desc tal como las devuelve el backend (sin
    re-ordenarlas en cliente — el backend ya ordena, evita una segunda fuente
    de verdad del orden).
  - **Verify**: `pnpm --filter @dsm/web exec vitest run src/features/metrics/TopProductsTable.test.tsx`.

## Phase 8 — SummaryCards (AC-3, AC-4, AC-5, AC-6, AC-8, AC-9)

- [x] T8.1 `src/features/metrics/SummaryCards.tsx` — `'use client'`; 4
      tarjetas (órdenes totales, monto facturado ARS, + desglose por los 4
      estados activos `new/preparing/ready/delivered`); caption informativo
      fijo ("Sólo se cuentan órdenes confirmadas por pago aprobado" — AC-8,
      transparencia operativa, no un filtro adicional); propio `AsyncState`;
      nota de `rangeClampNote`; botón export CSV; estado vacío explícito
      cuando `orders_count === 0`.
  - **Exit criterion**: igual matriz de 5 estados; el caption AC-8 está
    presente en el DOM en los 3 estados con datos (`success` con y sin datos,
    no en `loading`/`error`).
  - **Verify**: `pnpm --filter @dsm/web exec vitest run src/features/metrics/SummaryCards.test.tsx`.

## Phase 9 — Orquestador + ruta

- [x] T9.1 `src/features/metrics/MetricsDashboard.tsx` — `'use client'`;
      único estado compartido `appliedRange: { from?: string; to?: string }`;
      renderiza `RangeFilterForm` + `SalesChart` + `TopProductsTable` +
      `SummaryCards`, pasando `appliedRange` a los 3 widgets; emite
      `metrics_shown` en el primer render y `metrics_range_changed` cuando
      `onApply` cambia el rango.
  - **Pattern**: single source of truth para el rango compartido
    (`frontend-standards.md` §9.4) — cada widget resuelve su propio fetch, así
    que la falla de uno no bloquea a los otros dos (`frontend-resilience-patterns`
    skill, patrón #10 — aislar por componente).
  - **Exit criterion**: cambiar el rango vía `RangeFilterForm` refetchea los 3
    widgets con el mismo `{from, to}`; si `SalesChart` devuelve `error`,
    `TopProductsTable`/`SummaryCards` no se ven afectados.
  - **Verify**: `pnpm --filter @dsm/web exec vitest run src/features/metrics/MetricsDashboard.test.tsx`.
- [x] T9.2 `apps/web/app/(admin)/admin/metricas/page.tsx` — Server Component
      delgado: `<h1>Métricas</h1>` + `<MetricsDashboard />`.
  - **Pattern**: mismo estilo que `admin/ordenes/page.tsx` — el `AdminGuard`
    y el `X-Robots-Tag` los hereda del route group `(admin)`, cero
    configuración nueva.
  - **Exit criterion**: la ruta renderiza `MetricsDashboard` dentro del layout
    `(admin)`.
  - **Verify**: `pnpm --filter @dsm/web exec vitest run "app/(admin)/admin/metricas/page.test.tsx"`.
- [x] T9.3 `apps/web/app/(admin)/admin/metricas/page.test.tsx` — smoke test de
      la ruta con MSW (mirror de `admin/ordenes/page.test.tsx`): con los 3
      endpoints devolviendo 200, la página monta los 3 widgets.
  - **Exit criterion**: los `data-testid` de los 3 widgets están presentes.
  - **Verify**: incluido en el comando de T9.2.

## Phase 10 — Observabilidad (US §9 — "registrar uso del panel")

- [x] T10.1 Agregar `metrics_shown`, `metrics_range_changed`,
      `metrics_export_downloaded` a `BusinessEvent`
      (`src/lib/observability/events.ts`), sin agregarlos a `PUBLIC_EVENTS`
      (son del panel del dueño, `operator_id: 'admin'` por default — mismo
      criterio que `orders_filtered`/`order_status_change_attempted`).
      `metrics_export_downloaded` lleva `{ dataset: 'sales'|'top-products'|
      'summary' }` — enum acotado, nunca un rango de fechas como prop (evita
      cardinalidad libre en breadcrumbs, `observability-patterns` skill §3.3).
  - **Exit criterion**: los 3 eventos compilan tipados; test unitario
    confirma que ninguno lleva PII y que los 3 incluyen `operator_id: 'admin'`
    por default.
  - **Verify**: `pnpm --filter @dsm/web exec vitest run src/lib/observability/events.test.ts`.

## Phase 11 — Accesibilidad (design-system §11, WCAG 2.1 AA)

- [x] T11.1 `src/features/metrics/a11y.test.tsx` — monta `MetricsDashboard`
      con los 3 endpoints devolviendo datos (MSW), corre `axe` (regla
      `region` desactivada, mismo criterio que `orders/a11y.test.tsx`), 0
      violaciones. Repite el chequeo con los 3 endpoints devolviendo arrays
      vacíos (estado AC-5) — el estado vacío también debe ser accesible.
  - **Pattern**: `jest-axe` — mismo esqueleto que `src/features/orders/a11y.test.tsx`.
  - **Exit criterion**: 0 violaciones en ambos escenarios (con datos y vacío).
  - **Verify**: `pnpm --filter @dsm/web exec vitest run src/features/metrics/a11y.test.tsx`.

## Phase 12 — E2E (dev-authored smoke, per `qa-frontend-standards.md` §2.1)

- [ ] T12.1 `apps/web/e2e/metrics-happy-path.spec.ts` — login admin (reusa el
      fixture/patrón de autenticación de los specs existentes, e.g.
      `checkout-happy-path.spec.ts`/`auth-journey.spec.ts`), navega a
      `/admin/metricas`, asserta que el chart, la tabla de top-products y las
      tarjetas de resumen están visibles; cambia el rango y asserta un nuevo
      `waitForResponse` a los 3 endpoints.
  - **Pattern**: selectores por rol/label (`playwright-stability` skill),
    `page.waitForResponse` para el AC de recalcular — nunca `waitForTimeout`.
  - **Exit criterion**: flujo feliz completo pasa contra un backend real o
    stub (`e2e/support/api-stub.mjs`, mismo mecanismo que el resto de la
    suite).
  - **Verify**: `pnpm --filter @dsm/web exec playwright test e2e/metrics-happy-path.spec.ts`.
- [ ] T12.2 `apps/web/e2e/metrics-empty-state.spec.ts` — un rango sin órdenes
      (vía stub) muestra el mensaje de estado vacío en los 3 widgets, sin
      ningún `role="alert"` de error.
  - **Exit criterion**: cero elementos `role="alert"` visibles; el texto de
    estado vacío está presente en los 3 widgets.
  - **Verify**: `pnpm --filter @dsm/web exec playwright test e2e/metrics-empty-state.spec.ts`.
- [ ] T12.3 Verificar (sin test nuevo — ya cubierto por el wildcard existente)
      que `/admin/metricas` responde con `X-Robots-Tag: noindex, nofollow`
      per `next.config.mjs` (`source: '/admin/:path*'`).
  - **Exit criterion**: el header noindex llega a `/admin/metricas` sin
    tocar `next.config.mjs`.
  - **Verify**: `pnpm --filter @dsm/web exec playwright test e2e/admin-noindex.spec.ts` (spec existente, sin modificar) + inspección manual: `curl -sI http://localhost:3000/admin/metricas | grep -i x-robots-tag` contra un server local.

## Phase 13 — Documentación

- [ ] T13.1 `apps/web/README.md` — agregar `/admin/metricas` a la fila "Panel
      del dueño (privado, `noindex`)" del mapa de rutas.
  - **Exit criterion**: la tabla de rutas incluye la nueva ruta.
  - **Verify**: `grep -n "admin/metricas" apps/web/README.md`.

## Verificación (suite-level)

- [ ] Todos los tests unitarios/componente pasan:
      `pnpm --filter @dsm/web test` (`vitest run`, forma terminante).
- [ ] Typecheck limpio: `pnpm --filter @dsm/web typecheck`.
- [ ] Lint limpio: `pnpm --filter @dsm/web lint`.
- [ ] E2E de este change pasa:
      `pnpm --filter @dsm/web exec playwright test e2e/metrics-happy-path.spec.ts e2e/metrics-empty-state.spec.ts`.
- [ ] Codegen en sync (gate `frontend-codegen-fresh`):
      `pnpm --filter @dsm/web codegen && git diff --quiet -- apps/web/src/api/generated`.
- [ ] Suite completa de `imports` sigue verde tras el refactor de Phase 2:
      `pnpm --filter @dsm/web exec vitest run src/features/imports`.
