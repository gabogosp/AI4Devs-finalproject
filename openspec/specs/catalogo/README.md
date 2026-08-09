# Capacidad: Catálogo y navegación por categorías (CAP-1)

**Estado**: parcialmente entregada — superficie de **administración** viva; storefront público pendiente.

Estado declarado del sistema para la capacidad CAP-1 del PRD §2.1. Este directorio es el
**acumulado** de los changes archivados: se extiende en cada `/archive-change`, nunca se reescribe.

## Qué está vivo hoy

El **panel del dueño** para gestionar el catálogo (US-001):

- Categorías: crear (slug derivado del nombre, único), listar, editar.
- Productos: alta en `draft`, edición, listado paginado, SKU único.
- Máquina de estado del producto: `draft → published → archived` (archivar no borra).
- Acceso restringido: toda la superficie `/v1/admin/*` exige JWT con claim `role=admin`.
- Errores en envelope RFC 7807 (`application/problem+json`), con `errors[]` por campo en 422.

## Qué NO está vivo todavía

- **Storefront público** (navegación por categorías, ficha de producto) → US-002, US-003.
- **Import masivo de inventario** → US-006.
- **Precio histórico en órdenes** (AC-10 de US-001) — cubierto por diseño, sin superficie
  ejercitable hasta que exista checkout; el escenario de regresión está escrito y `@deferred`.

## Contratos

El contrato vivo de la superficie REST está en [`contracts/openapi.yaml`](contracts/openapi.yaml):
raíz con `info`/`servers`/`security` y los `components/schemas` compartidos una sola vez, más un
archivo por endpoint bajo [`contracts/openapi/paths/`](contracts/openapi/paths/) referenciado por
`$ref`. Cinco endpoints vivos:

| Endpoint | Métodos | AC |
|---|---|---|
| `/admin/auth/login` | POST | AC-8 (emisión del token; única ruta admin sin bearer) |
| `/admin/categories` | POST, GET | AC-1 |
| `/admin/categories/{id}` | PATCH | AC-1 |
| `/admin/products` | POST, GET | AC-2, AC-5, AC-9 |
| `/admin/products/{id}` | GET, PATCH | AC-3, AC-4, AC-6, AC-7 |

## Changes que formaron esta capacidad

| Change | Disciplina | Aporte |
|---|---|---|
| [`US-001-…-bootstrap-local-infrastructure`](../../changes/archive/US-001-admin-catalogo-productos-bootstrap-local-infrastructure/) | INFRA | Monorepo + toolchain, `docker-compose` (Postgres+pgvector, Redis), esquema del catálogo (fuente única de verdad), gate de CI |
| [`US-001-…-backend`](../../changes/archive/US-001-admin-catalogo-productos-backend/) | BE | API de administración, RBAC, máquina de estado, RFC 7807, controles §7 del borde |
| [`US-001-…-frontend-web`](../../changes/archive/US-001-admin-catalogo-productos-frontend-web/) | FE | Panel del dueño (Next.js), codegen del contrato, a11y |
| [`US-001-…-qa`](../../changes/archive/US-001-admin-catalogo-productos-qa/) | QA | Suite cross-stack Layer 3: aceptación BDD, E2E de costura, funcional API, carga k6, a11y |

## Estado de la provisión

La capacidad corre hoy en **entorno local** (`docker-compose`). La provisión de nube
(Railway/Neon/Cloudflare) es **US-019**, gated en dependencias externas — ver
[`requirements.md`](requirements.md) §NFR.
