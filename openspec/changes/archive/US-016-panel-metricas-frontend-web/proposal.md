---
tracker-id: null
tracker-source: null
parent-us: US-016
discipline: frontend-web
variant: null
language: es
audit-derived: false
archived: true
archived_at: 2026-09-06
merged_commit: ad21184b1a1d571682afcab85f9a92687cd21932
pr-url: https://github.com/gabogosp/AI4Devs-finalproject/pull/59
---

# Proposal — Panel de métricas del dueño (frontend-web)

> **Ticket**: US-016 — Panel de métricas / gráficos del dueño
> **Author**: frontend-web-developer agent (assisted by @gabogosp)
> **Date**: 2026-09-05
> **Status**: Proposed
> **Affected layers**: componentes (feature nueva `metrics`), repositorio (servicio
> HTTP sobre el cliente generado), estado (unión discriminada por widget),
> routing (ruta nueva bajo `(admin)`), observabilidad (eventos de negocio),
> refactor compartido (extracción de descarga de CSV).
> **Affected platform**: `apps/web` (Next.js App Router, dentro del panel del
> dueño ya existente)

## Por qué

US-016 es la capacidad 9 del PRD: el dueño necesita ver cómo va el negocio
(ventas, productos más pedidos, evolución temporal, PRD §1/§2.1) sin salir del
panel que ya usa para catálogo (US-001), import (US-006) y órdenes (US-012).
El backend hermano (`US-016-panel-metricas-backend`, in review, PR #55) ya
publica los 6 endpoints de sólo lectura que este change consume —
`GET /v1/admin/reports/{sales,top-products,summary}` + sus 3 `/export` CSV
hermanos, todos detrás de `AdminGuard`. Este change es la mitad visible: el
dashboard que el dueño realmente mira.

El panel admin de este proyecto no es una app aparte (PRD §9) — vive dentro de
`apps/web`, bajo `/admin/*`, con el mismo `AdminGuard` y el mismo estilo que
`/admin/ordenes`, `/admin/importar` y `/admin/productos`. Este change agrega
una pantalla más al mismo panel, sin introducir un segundo patrón de
autenticación, de estado o de tabla.

## Qué

**Ruta nueva `/admin/metricas`** (`apps/web/app/(admin)/admin/metricas/page.tsx`),
dentro del route group `(admin)` ya existente — hereda el `AdminGuard` de
`layout.tsx` y el header `X-Robots-Tag: noindex` que `next.config.mjs` ya
aplica a todo `/admin/:path*` (AC-7; cero configuración nueva).

**Feature nueva `src/features/metrics/`** con tres widgets independientes, cada
uno con su propia unión discriminada `idle|loading|success|error`
(`frontend-standards.md` §11.4/§11.9 — sin flags booleanos, sin
`if (data) {…}` catch-all):

- **`SalesChart`** (AC-1): evolución de ventas — `ComposedChart` de Recharts
  (barras = cantidad de órdenes, línea = monto facturado ARS, paleta data-viz
  del design-system) + selector de granularidad (día/semana/mes) + **tabla de
  datos accesible** con los mismos valores (design-system §9 — "acompañar cada
  chart con una tabla de datos accesible") + botón de export CSV.
- **`TopProductsTable`** (AC-2): ranking de productos más pedidos — TanStack
  Table (mismo patrón que `OrdersList`, `frontend-standards.md` §11.bis.7) +
  botón de export CSV. Sin chart: es una tabla de ranking, no una serie
  temporal — el AC no pide un gráfico y una tabla ordenable comunica el ranking
  con más precisión que una barra.
- **`SummaryCards`** (AC-3): totales del período — 4 tarjetas (órdenes,
  monto facturado, desglose por estado activo) + botón de export CSV.

**`MetricsDashboard`** (orquestador, `'use client'`) posee el único estado
compartido — el rango temporal aplicado (`{ from, to }`) — y se lo pasa a los
tres widgets; cada widget resuelve su propio fetch, su propio loading/error, y
su propia granularidad/límite cuando aplica (AC-4). Un filtro de rango con
**aplicación explícita** (`RangeFilterForm`, botón "Aplicar") en vez de
recalcular en cada tecleo — evita disparar tres fetches por cada dígito que el
dueño escribe en una fecha a medio completar.

**Período sin datos → estado vacío explícito, nunca un gráfico roto ni un
error** (AC-5): cada widget distingue `success` con `data.length === 0` /
`orders_count === 0` de `error` — son ramas de render distintas, nunca la
misma.

**Rango acotado por retención → transparente, no silencioso** (AC-9): el
backend acota `created_at_from` al piso de `ORDER_RETENTION_MONTHS` sin
rechazar la petición, y devuelve el rango efectivo en `range`. Cuando el rango
efectivo no coincide con el pedido, cada widget lo señala con una nota inline
("Mostrando desde {fecha} — no hay datos más antiguos por la política de
retención") en vez de recalcular en silencio y dejar al dueño sin explicación.

**Export CSV = descarga real, no un link nativo** (AC-6): mismo patrón que
`imports/reportDownload.ts` (US-006) — el panel se autentica con un Bearer en
memoria, así que la descarga pasa por el servicio (mutator único, F48) y se
materializa desde un `Blob`. Se **extrae** (refactor behavior-preserving,
Extract Method) la lógica de "leer el filename del `Content-Disposition`" y
"disparar la descarga desde un Blob" a dos helpers compartidos en
`src/lib/http/`, reusados por `imports` (sin cambiar su comportamiento — sus
tests siguen verdes sin tocar sus asserts) y por los 3 exports nuevos de
`metrics`. Mismo movimiento que hizo el backend con `csvCell`
(`US-016-panel-metricas-backend` design.md §D3).

**Contrato consumido vía codegen, nunca a mano** (`frontend-standards.md`
§3.1/§3.2): los 6 endpoints de `admin-reports` ya están regenerados en
`src/api/generated/` (traído desde la rama del backend, que corrió
`pnpm --filter @dsm/web codegen` como parte de su cierre) — se verifica en
T0.2/T1.2 que sigue en sync antes de construir sobre eso.

**Librería de charts: Recharts** (`design-system.md` §9, ya `Approved` —
decisión de librería no re-abierta). No está instalada todavía (verificado —
cero referencias en `package.json`); este change la agrega (`^3.9.0`, primera
versión mayor con soporte nativo a React 19, sin necesitar overrides de
peer-deps). Cargada **client-only** (`next/dynamic({ ssr: false })` + skeleton)
para no bloquear el LCP del resto del panel — aunque el panel admin no
persigue SEO, es la misma disciplina de performance del resto del bundle.

## AC de la US cubiertos por este change

| AC | Cubierto | Nota |
|---|---|---|
| AC-1 evolución de ventas en el tiempo | ✅ | `SalesChart` — `ComposedChart` (barras + línea) + tabla accesible |
| AC-2 productos más pedidos | ✅ | `TopProductsTable` — TanStack Table, orden por cantidad |
| AC-3 resumen del período | ✅ | `SummaryCards` — órdenes, monto, desglose por estado |
| AC-4 elegir el rango temporal | ✅ | `RangeFilterForm` (aplicación explícita) + selector de granularidad en `SalesChart` |
| AC-5 período sin datos | ✅ | Estado `success` vacío explícito por widget, nunca `error` |
| AC-6 exportar los datos crudos | ✅ | 3 botones de export CSV, uno por widget, vía Blob (mismo patrón que import) |
| AC-7 acceso restringido — **autoridad real en el backend** | ✅ | Ruta bajo `(admin)` → hereda `AdminGuard` + `AdminGuard` server-side (US-016-backend) |
| AC-8 solo órdenes pagadas cuentan | ✅ (heredado del backend) | El FE no filtra nada — muestra tal cual lo que el backend ya filtró; caption informativo para el dueño |
| AC-9 histórico limitado a 12 meses | ✅ | Nota de rango-acotado transparente por widget cuando el backend recorta el `from` pedido |

## Out of scope

- **Backend de agregación** — ya construido en `US-016-panel-metricas-backend`
  (in review, PR #55), no se re-planifica acá.
- **Analítica de tráfico/sesiones/conversión web** (Google Analytics o
  similar) — US §4, fuera de v1.
- **Pronósticos/forecasting** — US §4, fuera de v1.
- **Exportación contable/AFIP** — roadmap (PRD §2.2).
- **Nav/sidebar del panel admin** — el panel no tiene hoy una navegación
  cruzada entre `/admin/productos`, `/admin/ordenes`, `/admin/importar`
  (verificado: ninguna de esas pantallas se enlaza entre sí); `/admin/metricas`
  queda alcanzable por URL directa, al mismo nivel de descubribilidad que sus
  hermanas existentes. Construir un shell de navegación es un cambio
  transversal al panel completo, no específico de esta US — candidato a un
  change propio si el PO lo prioriza.
- **Selector de `limit` para el top-products** — v1 usa el default del
  backend (10, tope 50) sin control en UI; el AC no pide configurarlo.
- **Deep-linking del rango vía query string** — el rango vive en estado de
  cliente (mismo patrón que el filtro de estado de `OrdersList`, que tampoco
  sincroniza a la URL), no en `searchParams`. Ver `design.md` "Decisión 3" para
  el trade-off y cómo revertirlo si se necesita compartir un link con rango
  fijo.
- **SSO / MFA para el panel admin** (`frontend-standards.md` §11.bis.9) — el
  panel completo ya usa un login propio con Bearer en memoria desde US-001
  (ADR-0009, seam documentado); no es una desviación que introduzca este
  change, y no se corrige acá.

## Componentes / pantallas afectados

- `apps/web/app/(admin)/admin/metricas/page.tsx` — ruta nueva (Server
  Component delgado, mismo estilo que `admin/ordenes/page.tsx`).
- `apps/web/src/features/metrics/` — feature nueva completa (servicio,
  dashboard, 3 widgets, formulario de rango, helpers de export/formato).
- `apps/web/src/lib/http/downloadCsv.ts` — helper compartido nuevo (Extract
  Method desde `imports/reportDownload.ts`).
- `apps/web/src/lib/http/contentDisposition.ts` — helper compartido nuevo
  (Extract Method desde `imports/importsService.ts`).
- `apps/web/src/features/imports/reportDownload.ts` y `importsService.ts` —
  modificados para consumir los helpers extraídos (comportamiento sin cambios,
  tests existentes sin tocar sus asserts).
- `apps/web/src/lib/observability/events.ts` — 3 `BusinessEvent` nuevos
  (`metrics_shown`, `metrics_range_changed`, `metrics_export_downloaded`).
- `apps/web/src/api/generated/**` — regenerado (codegen, no escrito a mano),
  ya heredado de la rama del backend al momento de este plan.
- `apps/web/package.json` — agrega `recharts`.
- `apps/web/README.md` — agrega `/admin/metricas` al mapa de rutas.

## API consumption

Contrato: `apps/api/docs/api/openapi.yaml`, tag `admin-reports` (publicado por
`US-016-panel-metricas-backend`, PR #55):

| Endpoint | AC | Uso en este change |
|---|---|---|
| `GET /v1/admin/reports/sales` | AC-1, AC-4, AC-5, AC-9 | `SalesChart` |
| `GET /v1/admin/reports/sales/export` | AC-6 | Botón export de `SalesChart` |
| `GET /v1/admin/reports/top-products` | AC-2, AC-4, AC-5, AC-9 | `TopProductsTable` |
| `GET /v1/admin/reports/top-products/export` | AC-6 | Botón export de `TopProductsTable` |
| `GET /v1/admin/reports/summary` | AC-3, AC-4, AC-5, AC-9 | `SummaryCards` |
| `GET /v1/admin/reports/summary/export` | AC-6 | Botón export de `SummaryCards` |

Todos gateados por `AdminGuard` server-side (401/403 → `Problem`); 422
`dsm:reports/invalid-range` cuando `created_at_from > created_at_to` (mapeado
por `mapProblemToAppError` existente, kind `validation`, sin cambios en
`errors.ts`).

## Acceptance criteria

- [ ] AC-1: `/admin/metricas` muestra un gráfico de evolución de ventas
      (cantidad de órdenes + monto ARS) del rango vigente.
- [ ] AC-2: el panel muestra el ranking de productos más pedidos del período
      por cantidad vendida.
- [ ] AC-3: el panel muestra órdenes, monto facturado ARS y desglose por
      estado del período.
- [ ] AC-4: cambiar el rango (dentro de los últimos 12 meses) recalcula los 3
      widgets.
- [ ] AC-5: un rango sin órdenes muestra un estado vacío legible en los 3
      widgets, nunca un error ni un gráfico roto.
- [ ] AC-6: cada widget permite descargar su CSV del período mostrado.
- [ ] AC-7: sin sesión admin, `/admin/metricas` no se renderiza (autoridad real
      en el backend; el `AdminGuard` de cliente es defensa en profundidad).
- [ ] AC-8: el panel no contabiliza `pending_payment` como venta (heredado del
      backend, sin filtrado adicional en FE).
- [ ] AC-9: un rango que excede la retención muestra el rango efectivamente
      aplicado con una nota, nunca datos más viejos que la retención vigente.

## Standards consultados

- `spekode/docs/base-standards.md`
- `spekode/docs/code/frontend-standards.md` §2 (project structure), §3 (API
  consumption / codegen), §5 (error handling), §7 (observability), §8 (HTTP
  client), §9 (state), §11 (implementation patterns), §11.bis (backoffice
  extensions), §12 (security)
- `spekode/docs/architecture/api-standards.md` (RFC 7807, rangos `_from`/`_to`)
- `spekode/docs/quality/testing-standards.md` §14
- `spekode/docs/quality/qa-frontend-standards.md` §2.1 (ownership matrix), §19
  (accesibilidad), §23 (Vitest + Playwright), §24 (BDD — no aplica, ver nota)
- `spekode/docs/product/design-system.md` §9 (Recharts, paleta data-viz), §10.1
  (empty/error states), §11 (a11y checklist)
- Skills: `openapi-client-codegen`, `msw-setup`, `playwright-stability`,
  `frontend-resilience-patterns`, `refactoring-discipline`,
  `observability-patterns` (§9.5, eventos client-side), `openspec-workflow`

## Linear

MCP de Linear no conectado — proyecto local-only. `linear-issue-id: null`
heredado de la US.

## References

- User story: `docs/user-stories/US-016-panel-metricas.md`
- PRD: `docs/product/prd.md` §2.1 capacidad 9, §6
- E2E: `docs/product/design-e2e.md` §6.2 (componente `admin`, "Catálogo,
  import, órdenes, métricas — TanStack Table + Recharts"), §17, §18
- Design system: `docs/product/design-system.md` §9 (Recharts + paleta
  data-viz), §10.1 (patrones), §11 (a11y)
- Backend hermano (dependencia de contrato, no de código):
  `openspec/changes/US-016-panel-metricas-backend/` — `proposal.md`/`design.md`
  (naming `Reports*`, allowlist de "venta", rango acotado no rechazado), PR #55
- Precedentes de patrón en `apps/web`: `src/features/orders/OrdersList.tsx`
  (TanStack Table + `AsyncState`), `src/features/imports/reportDownload.ts` +
  `importsService.ts` (descarga de CSV vía Blob, filename del servidor),
  `apps/web/app/(admin)/admin/ordenes/page.tsx` (ruta dentro de `(admin)`),
  `src/lib/http/client.ts` (mutator único, F48), `src/lib/http/contract.ts`
  (`parseContract`), `src/lib/async.ts` (`AsyncState<T>`)
