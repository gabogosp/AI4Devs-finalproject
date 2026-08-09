---
tracker-id: null
tracker-source: null
parent-us: US-001
discipline: backend
variant: null
language: es
---

# US-001 Backend — API de administración del catálogo (productos y categorías)

## Why

El dueño (Pedro) necesita cargar y mantener el catálogo desde el panel: es la base sobre la que se apoyan el browse (US-002), la ficha (US-003), la búsqueda IA (US-004/005) y la compra. Sin catálogo no hay tienda. US-001 es la primera US del ciclo 1 y bloquea a US-002/US-003/US-005/US-006.

El change de infraestructura `bootstrap-local` ya entregó el **sustrato de persistencia** (monorepo runnable, `docker-compose`, esquema del catálogo `categories`+`products` como única fuente de verdad en `@dsm/db`). Lo que falta —y es lo que este change entrega— es el **comportamiento**: la **API REST de administración** que el panel del dueño (FE, `FE-US-001`) consume para el CRUD de productos y categorías, la **máquina de transición de estado** (borrador → publicado → archivado) con sus reglas de negocio, la **validación por campo** con errores RFC 7807, y el **guard RBAC admin** que restringe todas las operaciones al rol dueño.

Este es el primer código de la app `apps/api`, que hoy es un placeholder vacío. La primera cadena de tasks scaffoldea la app NestJS dentro de esa estructura (cross-reference del `bootstrap-local`, marcado ahí como owned-by-BE) y la ancla al paquete de esquema `@dsm/db`. El worker BullMQ y el pipeline de IA no son de esta US.

## What changes

- **Scaffolding de `apps/api`** (`@dsm/api`): app NestJS (TypeScript `strict`) dentro del monorepo pnpm existente, consumiendo `@dsm/db` como dependencia de workspace para el `PrismaClient` y los tipos del esquema. Config validada al arranque (`@nestjs/config` + esquema Zod/Joi), `ValidationPipe` global (`whitelist: true, forbidNonWhitelisted: true, transform: true`), filtro de excepciones global RFC 7807, logging estructurado pino, endpoints de health/readiness.
- **`CategoriesModule`** (controller → service → repository Prisma): crear categoría con slug único derivado del nombre (AC-1), listar categorías, editar categoría. `POST/GET/PATCH /v1/admin/categories`.
- **`ProductsModule`** (controller → service → repository Prisma): alta de producto en estado `draft` (AC-2), listado paginado/ordenable del catálogo del panel (NFR ≥5.000 SKUs), obtener producto, editar producto (precio/stock/descripción/categoría/imagen — AC-3), publicar (AC-4), archivar (AC-7). `POST/GET/PATCH /v1/admin/products` + acciones de estado.
- **Máquina de transición de estado** (en el service, no en el controller): `draft → published` exige nombre + precio + stock + categoría (AC-6 — categoría requerida para *publicar*; la DB permite categoría desde el alta pero la regla de completitud la aplica BE); `published → archived` y `draft → archived` (AC-7, sin delete físico); transiciones inválidas rechazadas con RFC 7807.
- **Validación por campo** (DTOs `class-validator`): precio > 0, stock ≥ 0, campos requeridos no vacíos, SKU con formato, categoría existente. Mensaje claro **por campo** (AC-5) mapeado al envelope RFC 7807 `422`; sin escritura parcial. SKU duplicado → `409` (AC-9).
- **Guard RBAC admin** (AC-8): todas las rutas `/v1/admin/*` exigen sesión con `role=admin`; sin sesión o rol insuficiente → `401`/`403` sin exponer ninguna operación. Ver **Open question OQ-1** sobre la propiedad del mecanismo de auth (US-001 vs US-014).
- **Observabilidad de eventos de negocio** (E2E §18): emitir evento estructurado `producto creado/publicado/archivado` (alimenta la cobertura de catálogo, KPI PRD §1.4) vía log pino + contador de métrica.
- **Contratos OpenAPI** por endpoint en `contracts/openapi/*.yaml` (draft, per skill `api-contract-completeness`).
- **Tests owned-by-dev**: unit (Jest, repos mockeados) de la máquina de estado + validaciones; integration (Testcontainers, Postgres real con el esquema `@dsm/db`) de los repositorios y flujos críticos; e2e-nest (supertest) de los endpoints + guard RBAC. La suite de aceptación cross-funcional (Playwright, batería de AC) es owned-by-QA (`QA-US-001`), fuera de este change.

## ACs de US-001 cubiertos (comportamiento — capa API)

Este change cierra el **comportamiento** de los ACs backend-relevantes. La capa de constraints DB ya la entregó `bootstrap-local`; acá se entrega el endpoint, la validación por campo, el mensaje de error y la regla de negocio.

| AC | Qué cubre este change | Nota |
|---|---|---|
| **AC-1** | `POST /v1/admin/categories` crea categoría con slug único derivado del nombre; colisión de slug → `409` | slug único ya tiene constraint DB; BE deriva + mapea el error |
| **AC-2** | `POST /v1/admin/products` crea el producto en estado `draft`; no visible en storefront/búsqueda hasta publicar | el storefront (US-002) filtra por `status='published'` |
| **AC-3** | `PATCH /v1/admin/products/{id}` edita precio, stock, descripción, categoría, imagen; precio interpretado en centavos ARS con IVA incluido | `image_url` recibe la URL ya subida a R2 (el upload es FE/infra) |
| **AC-4** | acción publicar (`PATCH .../products/{id}` con transición a `published`) si cumple requisitos | |
| **AC-5** | validación por campo (precio ≤ 0, stock negativo, requerido vacío) → `422` con `errors[]` por campo; sin escritura parcial | defensa en profundidad: DB CHECK + validación BE |
| **AC-6** | intento de publicar producto incompleto (sin categoría/precio/stock) → rechazo indicando qué falta; permanece `draft` | regla de transición en el service |
| **AC-7** | acción archivar → `status='archived'`; deja de aparecer en storefront/búsqueda; **sin** delete físico | |
| **AC-8** | guard RBAC: visitante sin sesión admin → `401`/`403`; no expone ninguna operación de administración | ver OQ-1 |
| **AC-9** | SKU duplicado en alta → `409` SKU duplicado; no crea el segundo producto | constraint DB + mapeo BE |

**AC-10** (el cambio de precio no altera ventas pasadas) **no** se ejercita en este change: `order_items.unit_price_ars_cents` (tabla de la US de checkout) es la fuente del precio histórico, no `products.price_ars_cents`. Este change solo garantiza que editar `products.price_ars_cents` no toca ninguna orden (no hay tabla de órdenes todavía). Se anota como cubierto-por-diseño, verificable end-to-end recién cuando exista checkout.

## Out of scope

- **Scaffolding de `apps/web` y el panel del dueño** (listado TanStack Table, formularios, botones publicar/archivar) → FE (`FE-US-001`).
- **Upload de imágenes a Cloudflare R2** (presigned URL, bucket) → infra/FE; este change solo persiste la `image_url` ya resuelta.
- **AuthModule completo** (registro, login, refresh rotado, bcrypt, 2FA, cookie `httpOnly`, rate-limit de login) → **US-014** (ADR-0005). Ver OQ-1 sobre el seam mínimo de admin que US-001 necesita.
- **Import masivo CSV/Excel** → US-006. **Enriquecimiento IA + embeddings** (`description_enriched`, `enrichment_done`, `product_embeddings`, worker BullMQ) → US-005.
- **Storefront público, búsqueda, ficha** → US-002/US-003/US-004.
- **Nuevas tablas/columnas de esquema**: ninguna. Este change **consume** `@dsm/db` tal como está; no redefine ni migra el esquema (ver `design.md` §Persistencia). Si se detectara la necesidad de una columna nueva, sería de infra/US-005, no de acá (ver OQ-2).
- **El primer deploy vivo** → `/plan-deployment` cuando la app esté scaffoldeada.

## Standards consultados

- `spekode/docs/code/backend-node-standards.md` §2 (layering controller→service→repository), §4 (DTO + ValidationPipe whitelist), §5 (repository envuelve Prisma; sin ORM en services), §6 (excepciones tipadas → filtro global RFC 7807), §7 (config validada al arranque), §9 (pino + trace IDs + health), §10 (unit/integration/e2e), §11 (anti-patterns).
- `spekode/docs/architecture/api-standards.md` §2 (URLs `/v1/admin/...`), §3 (métodos + status; 400 vs 422), §5.6/§5.5 (enums lower_snake_case; dinero en centavos), §6.1 (paginación offset), §8 (envelope RFC 7807 + `errors[]` por campo + catálogo de códigos).
- `spekode/docs/code/backend-standards.md` (layering genérico, manejo de errores, validación en el borde).
- `spekode/docs/quality/testing-standards.md` §14 + `qa-backend-standards.md` §2.1 (ownership dev vs QA de las suites).
- Skills: `openspec-workflow` (change 3-file + tasks closure-grade), `api-contract-completeness` (1 yaml por endpoint + RFC 7807), `observability-patterns` (evento de negocio + logs estructurados), `threat-modeling-lite` (STRIDE de endpoints mutantes admin), `nfr-quantification` (targets p95), `data-architecture-patterns` (consultado inline — sin Mode B, ver design.md).
- ADRs heredados: ADR-0005 (auth propia JWT — **refinada por ADR-0009** para el seam mínimo de US-001), ADR-0009 (seam de auth admin US-001 — resolución de OQ-1), ADR-0007 (monolito modular NestJS), ADR-0002 (pgvector datastore único), ADR-0001 (Railway/Neon/R2 — money en centavos, secretos de plataforma).

## Open questions

- **OQ-1 — Propiedad del mecanismo de auth admin (US-001 vs US-014).** `[Resolved: 2026-07-18 — Arquitecto opta por el seam mínimo owned-by-US-001]` AC-8 exige RBAC admin en US-001, pero el `AuthModule` completo (login, JWT en cookie `httpOnly`, refresh rotado, bcrypt, rate-limit, 2FA) es de **US-014** (ADR-0005), que está `blocked_by: [US-001]`. Había un desfase de orden: US-001 necesita *gatear* el panel antes de que exista el login completo. **Decisión**: US-001 entrega un **seam mínimo de autenticación admin** — un `AdminGuard` que valida un JWT con claim `role=admin` firmado con el `JWT_SECRET` de plataforma, más un mecanismo de emisión acotado para el admin (login admin básico o token seed de bootstrap detrás de config), **sin** registro de clientes, refresh rotado ni 2FA. US-014 luego *reemplaza/endurece* ese seam con el AuthModule completo (cookie `httpOnly`, rotación, rate-limit, 2FA) sin reescribir el guard (el contrato `role=admin` se preserva). El DAG **no** se invierte (US-001 sigue sin `blocked_by`); la Fase 3 (guard) se ejecuta. Consecuencia asumida: una porción de auth (el seam) se implementa ahora y se endurece en US-014. Formalizado en ADR-0009 (`docs/architecture/decisions/0009-admin-auth-seam-us001.md`).
- **OQ-2 — ¿Alguna columna nueva de esquema?** `[cerrada — no]` Se revisaron los ACs backend contra el esquema AS-BUILT de `@dsm/db`: todas las columnas que la lógica de US-001 toca (`sku`, `name`, `description_raw`, `price_ars_cents`, `stock`, `status`, `category_id`, `image_url`) ya existen. **No se requiere ninguna tabla/columna nueva.** Por tanto no se invoca `data-architect` Mode B ni se abre migración en este change (persistencia trivial desde la vista del backend).
- **OQ-3 — Idempotencia en los POST de alta.** `[propuesto — confirma Arquitecto]` `api-standards.md` sugiere `Idempotency-Key` en POST/PATCH/DELETE mutantes. Dado que el panel del dueño es de baja concurrencia (un solo admin) y el SKU único ya deduplica altas de producto, **se propone NO exigir `Idempotency-Key` en v1** (la unicidad de SKU/slug cubre el reintento) y revisitarlo si aparece un cliente automatizado (import US-006). Se documenta como decisión consciente en `design.md`.

## References

- User Story: `docs/user-stories/US-001-admin-catalogo-productos.md`
- E2E: `docs/product/design-e2e.md` §6.1 (CatalogModule), §8 (DER), §12 (FSM — el producto no tiene FSM formal pero el status sí), §14 (STRIDE admin), §17 (NFRs), §18 (observabilidad), §20 (ADRs)
- Esquema (única fuente de verdad, NO se redefine): `packages/db/prisma/schema.prisma` (`@dsm/db`)
- Change de infra hermano (sustrato ya entregado): `openspec/changes/US-001-admin-catalogo-productos-bootstrap-local-infrastructure/`
- ADRs: `docs/architecture/decisions/0005-own-jwt-authentication.md`, `0007-modular-monolith-nestjs.md`, `0002-postgresql-pgvector-single-datastore.md`
- Contratos OpenAPI (draft): `./contracts/openapi/`
