# Capacidad: Catálogo y navegación por categorías (CAP-1)

**Estado**: entregada — administración, ficha de producto pública (US-003) y
navegación por categorías (US-002) vivas.

Estado declarado del sistema para la capacidad CAP-1 del PRD §2.1. Este directorio es el
**acumulado** de los changes archivados: se extiende en cada `/archive-change`, nunca se reescribe.

## Qué está vivo hoy

El **panel del dueño** para gestionar el catálogo (US-001):

- Categorías: crear (slug derivado del nombre, único), listar, editar.
- Productos: alta en `draft`, edición, listado paginado, SKU único.
- Máquina de estado del producto: `draft → published → archived` (archivar no borra).
- Acceso restringido: toda la superficie `/v1/admin/*` exige JWT con claim `role=admin`.
- Errores en envelope RFC 7807 (`application/problem+json`), con `errors[]` por campo en 422.
- **Importación masiva de inventario** (CSV/Excel, US-006, PRD Capacidad 7): el dueño sube un
  archivo y el catálogo se actualiza por SKU (alta + actualización de precios/stock), sin
  reescribir el resto del catálogo. Asíncrono (`202` + polling), un trabajo concurrente por
  vez, límites de 5.000 filas / 4 MiB / 3 imports por hora por IP. El import **es** catálogo,
  no una capacidad nueva — reusa el borde HTTP, el `AdminGuard` y la derivación de slug ya
  vivos.

El **storefront público** (US-002 + US-003), sin autenticación, cacheado sólo en 2xx:

- **Ficha de producto** (`GET /v1/products/{slug}`, US-003): página SSR indexable con
  precio (IVA incluido), disponibilidad (`in_stock` booleano, sin nivel de stock),
  imagen o placeholder, y breadcrumb a su categoría.
- **Navegación por categorías** (US-002): árbol de dos niveles (`GET /v1/categories`),
  detalle con padre/hijos (`GET /v1/categories/{slug}`) y listado paginado de productos
  publicados por categoría (`GET /v1/categories/{slug}/products`) — un rubro agrega los
  de sus subrubros. `CategoryNav` en el layout, home con grilla de rubros/subrubros,
  paginación linkeable con `canonical`/`rel=prev/next`, sitemap. Todo server-rendered:
  ninguna página con sesión o personalización se cachea (ver `cuentas/` para esa regla).
- Caché por endpoint (60-300s según volatilidad), invalidada por tag grueso `catalog`
  desde cualquier mutación admin (alta/edición de producto o categoría, import masivo).

## Qué NO está vivo todavía

- **Precio histórico en órdenes** (AC-10 de US-001) — cubierto por diseño, sin superficie
  ejercitable hasta que exista checkout; el escenario de regresión está escrito y `@deferred`.
- **Grilla global `/productos`** (todas las categorías juntas) — sin endpoint público
  que la sirva (`OQ-FE-7` de US-002).
- **Breadcrumb con el rubro padre** en la ficha de producto (hoy sólo la categoría
  directa) — `OQ-FE-11` de US-002.

## Contratos

El contrato vivo de la superficie REST está en [`contracts/openapi.yaml`](contracts/openapi.yaml):
raíz con `info`/`servers`/`security` y los `components/schemas` compartidos una sola vez, más un
archivo por endpoint bajo [`contracts/openapi/paths/`](contracts/openapi/paths/) referenciado por
`$ref`. Once endpoints vivos:

> `/admin/auth/login` (emisión del token admin, AC-8) se mudó a la capacidad
> [`cuentas`](../cuentas/) al archivar `US-014-registro-login-backend`
> (decisión del PO, 2026-08-19): es un endpoint de autenticación, no de
> catálogo. Su hogar vivo es `openspec/specs/cuentas/contracts/openapi.yaml`.

| Endpoint | Métodos | AC |
|---|---|---|
| `/admin/categories` | POST, GET | AC-1 |
| `/admin/categories/{id}` | PATCH | AC-1 |
| `/admin/products` | POST, GET | AC-2, AC-5, AC-9 |
| `/admin/products/{id}` | GET, PATCH | AC-3, AC-4, AC-6, AC-7 |
| `/admin/imports` | POST | AC-1, AC-6, AC-7, AC-11 (US-006) |
| `/admin/imports/{id}` | GET | AC-5, AC-7 (US-006) |
| `/admin/imports/{id}/report` | GET | AC-5 (US-006) |
| `/products/{slug}` | GET | AC-1..AC-9 (US-003, público) |
| `/categories` | GET | AC-1 (US-002, público) |
| `/categories/{slug}` | GET | AC-2, AC-9 (US-002, público) |
| `/categories/{slug}/products` | GET | AC-3, AC-6 (US-002, público) |

## Changes que formaron esta capacidad

| Change | Disciplina | Aporte |
|---|---|---|
| [`US-001-…-bootstrap-local-infrastructure`](../../changes/archive/US-001-admin-catalogo-productos-bootstrap-local-infrastructure/) | INFRA | Monorepo + toolchain, `docker-compose` (Postgres+pgvector, Redis), esquema del catálogo (fuente única de verdad), gate de CI |
| [`US-001-…-backend`](../../changes/archive/US-001-admin-catalogo-productos-backend/) | BE | API de administración, RBAC, máquina de estado, RFC 7807, controles §7 del borde |
| [`US-001-…-frontend-web`](../../changes/archive/US-001-admin-catalogo-productos-frontend-web/) | FE | Panel del dueño (Next.js), codegen del contrato, a11y |
| [`US-001-…-qa`](../../changes/archive/US-001-admin-catalogo-productos-qa/) | QA | Suite cross-stack Layer 3: aceptación BDD, E2E de costura, funcional API, carga k6, a11y |
| [`US-006-…-backend`](../../changes/archive/US-006-import-masivo-inventario-backend/) | BE | Import CSV/XLSX asíncrono (ADR-0012, ejecutor in-process), reconciliación por SKU, threat model del upload admin |
| [`US-006-…-frontend-web`](../../changes/archive/US-006-import-masivo-inventario-frontend-web/) | FE | Pantalla de import con progreso, tabla + descarga de rechazos, `revalidateCatalogSafely()` tras completar |
| [`US-006-…-qa`](../../changes/archive/US-006-import-masivo-inventario-qa/) | QA | 24/24 casos (22 automatizados + 2 charters); 3 defectos reales encontrados y corregidos (jobs `pending` huérfanos, CORS de `idempotency-key`, invalidación de ficha pública) |
| [`US-003-ficha-producto-pdp-backend`](../../changes/archive/US-003-ficha-producto-pdp-backend/) | BE | `StorefrontModule`, `GET /v1/products/{slug}`, throttler `storefront`, `StorefrontCacheInterceptor` (base para US-002) |
| [`US-003-ficha-producto-pdp-frontend-web`](../../changes/archive/US-003-ficha-producto-pdp-frontend-web/) | FE | Ficha de producto SSR indexable, `ProductPurchase`, integración con `contacto/` (WhatsApp sin stock) |
| [`US-003-ficha-producto-pdp-qa`](../../changes/archive/US-003-ficha-producto-pdp-qa/) | QA | Suite cross-stack de la ficha pública |
| [`US-002-…-backend`](../../changes/archive/US-002-storefront-navegacion-categorias-backend/) | BE | 3 endpoints públicos de navegación (árbol/detalle/listado por categoría), caché por endpoint (D5), evento `category.viewed` |
| [`US-002-…-frontend-web`](../../changes/archive/US-002-storefront-navegacion-categorias-frontend-web/) | FE | `CategoryNav`, home con grilla de rubros, páginas de categoría SSR paginadas y linkeables, sitemap, tag de cache `catalog` |
| [`US-002-…-qa`](../../changes/archive/US-002-storefront-navegacion-categorias-qa/) | QA | Regresión completa del browse por categorías |

## Estado de la provisión

La capacidad corre hoy en **entorno local** (`docker-compose`). La provisión de nube
(Railway/Neon/Cloudflare) es **US-019**, gated en dependencias externas — ver
[`requirements.md`](requirements.md) §NFR.
