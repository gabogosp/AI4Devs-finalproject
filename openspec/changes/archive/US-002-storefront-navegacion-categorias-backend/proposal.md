---
tracker-id: null
tracker-source: null
parent-us: US-002
discipline: backend
variant: null
language: es
archived: true
archived_at: 2026-09-05
merged_commit: 9a9fc53
pr-url: https://github.com/gabogosp/AI4Devs-finalproject/pull/3
---

# US-002 Backend — Navegación pública por categorías (árbol + listados paginados)

## Why

El browse por rubro/subrubro es la **red de seguridad del descubrimiento** (cuando la búsqueda IA de US-004 no alcanza) y la vía principal de **SEO** del storefront (PRD §1.2/§1.4: que DSM "se la encuentre en Google"). US-003 abrió la superficie de lectura pública de `apps/api` con la ficha (`GET /v1/products/{slug}`); esta US completa la **navegación**: el árbol de categorías de dos niveles (rubro → subrubro, `categories.parent_id` — E2E §8) y el listado paginado de **productos publicados** por categoría, que las páginas SSR de categoría (FE-US-002) consumen para renderizar HTML indexable.

El sustrato ya existe y **no se re-arquitectura**: `@dsm/db` tiene `categories` (con `slug` único y `parent_id` auto-referente) y `products` con el índice `(category_id, status)` que este listado necesita; US-001 dejó el borde HTTP endurecido (helmet §7.1, CORS §7.2, ValidationPipe 422, filtro RFC 7807 `dsm:catalog/*`) y US-003 dejó el **surface público completo**: `StorefrontModule`, throttler nombrado `storefront` por IP (§7.3), `StorefrontCacheInterceptor` (caché acotada sólo en 2xx) y `CatalogEventsService`. Este change entrega **comportamiento** de lectura: tres endpoints públicos read-only sobre el módulo existente, un query DTO de paginación validado en el borde, y el evento de negocio `category.viewed` (US §9, insumo del panel US-016) siguiendo el precedente `product.viewed`.

La superficie es **read-only** y **no crea ninguna tabla, columna ni índice**: el modelo AS-BUILT (`categories.slug` UK, `parent_id`; `products @@index([category_id, status])`) cubre el patrón de acceso al volumen declarado (≥5.000 SKUs, ~50 concurrentes — E2E §17). La persistencia es **trivial** (ver `design.md` §Persistencia); no se invoca `data-architect` Mode B.

## What changes

- **`GET /v1/categories`** (público, sin auth): árbol completo de dos niveles — rubros (categorías con `parent_id = null`) con sus subrubros embebidos, ordenados por nombre. Insumo del `CategoryNav` (FE) y del sitemap. Cacheable con TTL propio de 300s (decisión **D5**).
- **`GET /v1/categories/{slug}`** (público): detalle de una categoría — `name`, `slug`, `parent` (para el breadcrumb "volver al rubro padre", AC-2) y `children` (subrubros, AC-1). Categoría inexistente → **404** RFC 7807 `dsm:catalog/not-found` (AC-9: nunca un 200 vacío indexable fantasma). Emite el evento `category.viewed` (decisión **D4**).
- **`GET /v1/categories/{slug}/products?limit&offset`** (público): productos **publicados** de la categoría, paginados offset (**D3**: `limit` default 20 / max 100, `offset` ≥ 0, validados por DTO en el borde) con envelope `{ data, pagination: { limit, offset, total } }` — el shape ya vivo del contrato de la capacidad (precedente US-001 `GET /v1/admin/products`). Un **rubro** agrega los productos de sus subrubros (`category_id IN (rubro, hijos directos)` — decisión **D1**); un **subrubro** lista sólo los propios (AC-2). Orden estable `name ASC, id ASC`. `draft`/`archived` jamás aparecen (AC-8); categoría inexistente → 404; categoría sin productos publicados → 200 con `data: []` y `total: 0` (AC-6).
- **`StorefrontProductListItemDto`** (item de grilla, orientado a `ProductCard`): `slug` (identificador público del enlace a la ficha US-003 — OQ-BE-1 resuelta el 2026-08-16, la columna `products.slug` ya existe), `name`, `price_ars_cents` + `currency: 'ARS'` (IVA incluido, AC-3), `image_url` (nullable → placeholder FE), `in_stock` (derivado `stock > 0` — AC-5, sin exponer nivel de inventario). Sin campos de administración.
- **Repositorios extendidos** (único punto de ORM, §5): `CategoriesRepository.findRoots()` (árbol) y `findBySlug(slug)` con `parent`+`children`; `ProductsRepository.findPublishedByCategoryIds(ids, {limit, offset})` que devuelve `{ data, total }` en snapshot consistente.
- **Reutilización del borde público de US-003**: mismo throttler `storefront` (60/min/IP, env ya existentes) y mismo filtro RFC 7807. No hay env nuevas.
- **Caché por endpoint (decisión D5)**: el `StorefrontCacheInterceptor` (US-003) se **extiende** para soportar TTL por endpoint vía decorador — árbol de categorías `Cache-Control: public, max-age=300, stale-while-revalidate=60`; detalle de categoría y listado de productos `max-age=60, stale-while-revalidate=30` (igual que la ficha). Sigue aplicando **sólo en 2xx** (hallazgo M1 de US-003: los 404/429 jamás viajan cacheables); el `no-store` de `/v1/admin` queda intacto.
- **Observabilidad — evento `category.viewed`** (US §9, E2E §18): cada `GET /v1/categories/{slug}` OK emite log pino estructurado + contador `category_viewed_total`; el `entity_id` (id de categoría) va al log, **nunca** como dimensión de métrica (cardinalidad — observability-patterns §3.3). Sin PII (lectura anónima). Un 404 no emite.
- **Contratos OpenAPI** (drafts per `api-contract-completeness`, 1 yaml por endpoint): `storefront-list-categories.yaml`, `storefront-get-category.yaml`, `storefront-list-category-products.yaml` + actualización del spec publicado (`apps/api/docs/api/openapi.yaml`) y README.
- **Tests owned-by-dev**: unit (DTOs, service — 404 uniforme, agregación rubro+subrubros), integration (Postgres real — repositorios con seeds por estado y por nivel), e2e-nest (supertest — árbol, breadcrumb, paginación con `total`, límite max 100, vacío, sin stock visible, draft/archived excluidos del listado y del `total`, 404, caché y rate-limit heredados, evento emitido/no emitido). La batería de aceptación cross-funcional (Playwright + SSR/SEO + a11y) es owned-by-QA (`QA-US-002`).

## ACs de US-002 cubiertos (capa backend)

| AC | Qué cubre este change | Nota |
|---|---|---|
| **AC-1** (entrar a un rubro → subrubros y/o productos) | `GET /v1/categories/{slug}` devuelve `children` (subrubros) y `GET /v1/categories/{slug}/products` los productos publicados del rubro (incluye subrubros — decisión **D1**) | La **URL amigable** del rubro es el `slug` de `categories` (ya existe, UK). La página en sí es FE |
| **AC-2** (rubro → subrubro + volver al padre) | El detalle de un subrubro incluye `parent { name, slug }` (breadcrumb) y su listado sólo trae productos propios | El componente de navegación es FE |
| **AC-3** (listado con nombre, precio ARS, imagen, disponibilidad, paginado, enlace a ficha) | `StorefrontProductListItemDto` expone `name`, `price_ars_cents`+`currency` (IVA incl.), `image_url` (nullable), `in_stock`; el listado está paginado; `slug` es el identificador para enlazar a `GET /v1/products/{slug}` (US-003) | Placeholder de imagen y el link renderizado son FE |
| **AC-4** (página indexable SEO) | **FE-owned** (SSR, metadatos, sitemap). El BE lo habilita: datos completos server-side en una respuesta cacheable | Split declarado abajo |
| **AC-5** (sin stock visible, no comprable) | Producto publicado con `stock=0` aparece en el listado con `in_stock:false` | El badge "Sin stock" y suprimir la acción de carrito son FE |
| **AC-6** (categoría sin productos) | 200 con `data: []`, `total: 0` (nunca 404 para categoría existente vacía) | El estado vacío visual es FE |
| **AC-7** (catálogo grande sin degradación) | Paginación server-side (`limit` max 100) — nunca se transfiere el catálogo completo; índice `(category_id, status)` + orden estable; p95 lectura < 300ms (herencia NFR-1 de la capacidad, re-medición gated en US-019) | Core Web Vitals son FE/QA |
| **AC-8** (borradores/archivados no se exponen) | El repositorio filtra `status='published'` en el `where`; `total` cuenta sólo publicados | Cubierto también por e2e negative-space |
| **AC-9** (categoría inexistente → 404) | `slug` inexistente → **404** RFC 7807 en detalle **y** en listado (no 200 vacío) | El FE traduce a página 404 no indexable |
| **AC-10** (contenido server-rendered) | **FE-owned** (SSR sin depender de JS). El BE lo habilita: los tres endpoints devuelven todo lo necesario en JSON consumible desde el server de Next.js | Split declarado abajo |

**Split BE/FE explícito (AC-4, AC-10)**: el SSR, los metadatos HTML, el sitemap, el JSON-LD y la verificación "HTML inicial sin JS" son del change de **frontend** (`FE-US-002`) y de QA. Este change de backend garantiza los **endpoints de datos que hacen posible ese SSR**: respuestas completas, deterministas, cacheables y con 404 correcto para que no existan páginas fantasma.

## Out of scope

- **SSR, metadatos, sitemap, JSON-LD, CategoryNav, ProductCard, breadcrumb, estados vacío/sin-stock visuales** → `FE-US-002` (AC-4/AC-10 y la mitad visual de AC-1/2/3/5/6).
- **Filtros avanzados** (atributo, marca, rango de precio) y **ordenamientos alternativos** → PRD §2.2 (roadmap). Un solo orden estable por ahora.
- **Búsqueda semántica** → US-004. **Ficha de producto** → US-003 (ya en curso). **Carrito** → US-007.
- **Administración de categorías** (alta/edición/jerarquía) → ya entregada por US-001; no se toca.
- **Columna `products.slug`** (URL amigable de ficha) → ya materializada por la Fase 10 de US-003 backend; este change la **consume**, no la crea.
- **Caché Redis de listados** (E2E §17 la menciona como opción) → no se introduce: la caché HTTP acotada + volumen actual la hacen innecesaria hoy; se re-evalúa con medición (ver design.md §Trade-offs).
- **Nuevas tablas/columnas/índices**: ninguna (read-only sobre el esquema AS-BUILT).
- **Suite de aceptación Playwright + SEO/SSR + a11y** → `QA-US-002`.

## Standards consultados

- `backend-node-standards.md` §2 (layering controller→service→repository; módulo de feature), §4 (query DTO validado en el borde — paginación), §5 (repositorio único punto de ORM; se extienden `CategoriesRepository` y `ProductsRepository`), §6 (404 vía error de dominio → filtro RFC 7807 global), §9 (pino + trace id + evento de negocio), §10 (unit/integration/e2e), §11 (anti-patterns).
- `api-standards.md` §2 (URLs públicas `/v1/categories/*`, recurso anidado para el listado por categoría), §3 (GET idempotente; 404 vs 200 vacío), §5.5 (money en centavos), §6.1/§6.3 (paginación offset: default 20 / max 100 / `total`; elegida sobre cursor — dataset < 100k, navegación por página, orden estable), §8 (RFC 7807 `dsm:catalog/*`), §12 (cabeceras de rate-limit heredadas), §13 (caché heredada).
- `security-standards.md` §7.3 (rate-limit del surface público — heredado del throttler `storefront`), §2 (STRIDE superficie "catálogo público" — E2E §14; ver design.md).
- `backend-standards.md` (layering, errores, validación en el borde).
- `testing-standards.md` §14 + `qa-backend-standards.md` §2.1 (ownership dev vs QA de suites).
- Skills: `openspec-workflow` (3-file + closure-grade + F49/F50/F51), `api-contract-completeness` (1 yaml por endpoint), `observability-patterns` (§3.3 cardinalidad), `threat-modeling-lite` (superficie 5 — GET cacheable público), `nfr-quantification` (p95/paginación con números), `data-architecture-patterns` (consultada inline — persistencia trivial, sin Mode B).
- ADRs heredados (`Accepted`): ADR-0007 (monolito modular NestJS), ADR-0002 (pgvector/Postgres datastore único), ADR-0001 (Railway/Neon/R2/CDN — money en centavos, CDN de catálogo).

## Decisiones ratificadas (D1–D5)

Escaladas per `AGENTS.md` §1.5 y **ratificadas por el usuario el 2026-08-16**; las alternativas descartadas quedan en design.md §Trade-offs.

- **D1 — Agregación de subrubros en el listado de un rubro: SÍ.** Un rubro devuelve `category_id IN (rubro + hijos directos)` (dos niveles → sin recursión); un subrubro, sólo los propios. Motiva: los productos cuelgan de **una** categoría y el alta admin (US-001) permite asignarlos tanto a rubros como a subrubros — sin agregar, un rubro con productos en subrubros quedaría vacío.
- **D2 — Tres endpoints** (árbol / detalle / listado anidado). El path anidado hace natural el 404 de AC-9 y separa las políticas de caché.
- **D3 — Paginación offset** con el envelope vivo del contrato (per `api-standards.md` §6.1/§6.3: dataset < 100k, navegación por página, `total` barato, orden estable).
- **D4 — `category.viewed` se emite en `GET /v1/categories/{slug}`** (1 evento por vista de página de categoría; paginar no infla la métrica de US-016).
- **D5 — Caché por endpoint** (opción b, distinta de la recomendación del planner): árbol `max-age=300, stale-while-revalidate=60`; detalle y listado `max-age=60, stale-while-revalidate=30`. El `StorefrontCacheInterceptor` se ramifica por decorador desde ya.

## Open questions

- **OQ-BE-1 (heredada de US-003) — URL de ficha por `slug` de producto.** `[Resolved: 2026-08-16 — el PO decidió materializar `products.slug` en la Fase 10 de US-003 backend; la columna existe y la ficha pública se sirve en `GET /v1/products/{slug}`.]` Impacto en este change, aplicado el 2026-08-17: el item del listado enlaza por `slug` (no por `sku`), de modo que listado y ficha usan el mismo identificador público.

## References

- User Story: `docs/user-stories/US-002-storefront-navegacion-categorias.md`
- E2E: `docs/product/design-e2e.md` §6.1 (CatalogModule — `GET /products, /categories`), §6.2 (Storefront SSR), §8 (DER — `categories.parent_id` dos niveles, índice `products(category_id, status)`), §14 (STRIDE — catálogo público), §17 (NFRs — p95 lectura < 300ms, ≥5.000 SKUs, paginación), §18 (observabilidad — eventos de negocio)
- Esquema (fuente de verdad, NO se redefine): `packages/db/prisma/schema.prisma` (`@dsm/db`)
- Contrato vivo de la capacidad: `openspec/specs/catalogo/contracts/openapi.yaml` (se extiende al archivar — Spec delta en design.md)
- Changes hermanos: `openspec/changes/US-003-ficha-producto-pdp-backend/` (surface público, throttler, caché, eventos — precedente directo), `openspec/changes/archive/US-001-admin-catalogo-productos-backend/` (borde HTTP, envelope de paginación, RFC 7807)
- Contratos OpenAPI (drafts de este change): `./contracts/openapi/storefront-list-categories.yaml`, `./contracts/openapi/storefront-get-category.yaml`, `./contracts/openapi/storefront-list-category-products.yaml`
