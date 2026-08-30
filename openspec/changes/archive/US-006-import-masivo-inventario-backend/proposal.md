---
parent-us: US-006
discipline: backend
variant: null
language: es
status: draft
archived: true
archived_at: 2026-08-30
merged_commit: 9a9fc53ef86bcba180979eccbaba3381facfb6a7
pr-url: https://github.com/gabogosp/AI4Devs-finalproject/pull/3
---

# US-006 Backend — Importación masiva de inventario (CSV/Excel)

## Why

Una ferretería real tiene miles de SKUs. Hoy el único camino para poblar el catálogo
es el alta de a uno por el panel (`POST /v1/admin/products`, US-001): a 30 segundos por
producto, cargar 5.000 SKUs son ~40 horas de tipeo. Sin una carga masiva el catálogo
nunca llega al **≥90% de cobertura** que el PRD §1.4 fija como objetivo, y sin catálogo
no hay búsqueda semántica (US-004), ni enriquecimiento (US-005), ni loop de compra.

El mismo mecanismo resuelve el day-2 del dueño, que es tan importante como la carga
inicial: **actualizar precios por inflación** sobre el catálogo ya cargado (AC-4) sin
duplicar productos ni tocarlos a mano. En un contexto de ajustes mensuales, esto pasa
de ser una comodidad a ser la condición para que los precios publicados sean ciertos.

Este change entrega la **superficie backend** del import: recibir el archivo, validarlo,
reconciliar por SKU contra el catálogo existente, crear las categorías que falten, dejar
constancia por fila de lo que se rechazó y por qué, y exponer el estado del trabajo para
que el panel muestre progreso y ofrezca el reporte. La pantalla es FE-US-006; la batería
de aceptación cross-stack es QA-US-006.

## What changes

**Superficie HTTP nueva** (admin, gateada por `AdminGuard` — AC-8):

- `POST /v1/admin/imports` — recibe el archivo (`multipart/form-data`), lo valida, crea el
  trabajo y responde **202 Accepted** con su identificador. No procesa dentro del request.
- `GET /v1/admin/imports/{id}` — estado, progreso y contadores del trabajo, más las filas
  rechazadas paginadas (AC-5, AC-7).
- `GET /v1/admin/imports/{id}/report` — el reporte de filas rechazadas en CSV descargable
  (AC-5, AC-7).

**Comportamiento**:

- **Reconciliación por SKU** (AC-1, AC-4, AC-10): un SKU nuevo crea el producto; un SKU
  existente lo actualiza. Re-importar el mismo archivo no duplica nada.
- **El import nunca publica** (AC-9): los productos nuevos nacen `draft`; los existentes
  conservan su estado. El archivo no puede cambiar el estado de publicación.
- **Categorías auto-creadas** (AC-2): una categoría referenciada que no existe se crea con
  nombre normalizado, sin duplicar por acentos ni mayúsculas.
- **Cada fila es atómica** (AC-5): las válidas se importan, las inválidas se reportan con
  su número de fila y motivo; ninguna queda a medio escribir.
- **El archivo entero se rechaza** cuando el formato o las columnas no sirven (AC-6), sin
  tocar el catálogo.
- **Procesamiento en segundo plano con progreso** (AC-7): el request no espera el trabajo.
- **Límites duros de tamaño, filas y expansión** antes de procesar (AC-11).
- **Marca de enriquecimiento pendiente** (AC-3): los productos creados o cuya descripción
  base cambió quedan marcados para que US-005 los tome. El encolado real en BullMQ es de
  US-005 (ver *Fuera de alcance*).

**Persistencia** (migración aditiva): tablas `import_jobs` e `import_job_rows`, más la
columna `products.enrichment_done` que el modelo de datos aprobado ya declaraba.

**Decisión arquitectónica**: se levanta **ADR-0012** — el trabajo corre **en el proceso del
API** mientras Redis/BullMQ no esté aprovisionado, detrás del **mismo contrato asíncrono**
que tendrá con la cola. Enmienda a ADR-0004 con criterio de migración explícito. Ver
`design.md` §Enfoque y **OQ-BE-1**.

## Out of scope

- **Enriquecimiento IA y generación de embeddings** — US-005. Acá sólo queda la marca
  durable de "pendiente de enriquecer" y el punto de inyección de la cola.
- **Encolado real en BullMQ y worker dedicado** — bloqueado por infraestructura: el add-on
  Redis no está aprovisionado (US-019, task pendiente) y `apps/worker` es un README vacío.
  `Deferred: US-005 / US-019 — owner: Arquitecto`.
- **Mapeo de columnas configurable / plantillas personalizadas** — v1 usa el esquema fijo
  documentado (US §4).
- **Carga de imágenes desde el archivo** — se referencia la URL; la gestión de imágenes en
  R2 queda fuera de v1 (US §4).
- **Imports recurrentes / sincronización automática** — fuera de v1 (US §4).
- **Listado / historial de imports** (`GET /v1/admin/imports`) — el panel de US-006 opera
  sobre el trabajo recién creado. `Deferred: US-016 (panel de métricas) — owner: PO`.
- **Pantalla de importación** (upload, barra de progreso, descarga del reporte) — FE-US-006.
- **Batería de aceptación cross-stack, carga y archivos de prueba representativos** —
  QA-US-006. Este change sólo trae los tests owned-by-dev (unit / integration / e2e-nest).

## References

- US: `docs/user-stories/US-006-import-masivo-inventario.md` (AC-1…AC-11).
- PRD: `docs/product/prd.md` §1.4 (cobertura de catálogo), capacidad 7.
- E2E: `docs/product/design-e2e.md` §6.1 (`ImportModule`), §8 (modelo de datos), §9.3
  (secuencia de import + enriquecimiento), §14 (STRIDE — import de archivos), §17 (NFRs),
  §18 (observabilidad), §18.5 (runbook del dueño).
- ADR: `docs/architecture/decisions/0004-redis-bullmq-async-processing.md` (enmendado por
  ADR-0012, T0.1); `0009-admin-auth-seam-us001.md` (RBAC admin, no se modifica);
  `0002-postgresql-pgvector-single-datastore.md`.
- Precedentes de convención: `openspec/changes/archive/US-001-admin-catalogo-productos-backend/`,
  `openspec/changes/US-003-ficha-producto-pdp-backend/`,
  `openspec/changes/US-014-registro-login-backend/`.
- Capacidad viva: `openspec/specs/catalogo/`.
