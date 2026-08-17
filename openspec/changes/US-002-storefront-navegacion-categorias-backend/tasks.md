---
parent-us: US-002
discipline: backend
variant: null
language: es
---

# US-002 Backend — Tasks

> Cada task es closure-grade: atómica, con `Exit criterion:` observable y `Verify:` con el comando exacto (terminante, F49) que `/develop-backend` corre y que **falla si el criterio no se cumple** (F50). Los comandos asumen la raíz del repo como cwd y corren contra `apps/api` (`@dsm/api`); el runner de US-001 ejecuta Jest en modo `--ci` (no watch). El esquema se **consume** de `@dsm/db`; **ninguna task migra esquema**. Decisiones D1–D5 ratificadas (proposal §Decisiones ratificadas) — si la ejecución encontrara que alguna no es implementable tal cual, se **detiene y se escala** (no se sustituye en silencio).
>
> **Estimación dual**: **4.7 h AI-asistido / 9 h tradicional** (dentro del rango "BE-US-002 6-10h" de la US §7; ~0.5× per Peng 2023). Horas por fase = AI-asistido.

## Pre-requisitos
- [x] **Base de US-001 + US-003 presente**: `StorefrontModule` con `StorefrontThrottlerGuard`, `StorefrontCacheInterceptor`, `CatalogEventsService`, `HttpProblemFilter` (RFC 7807 `dsm:catalog/*`) y repositorios exportables. Verificado: `pnpm --filter @dsm/api typecheck` (exit 0) y existencia de `apps/api/src/storefront/storefront.module.ts`.
- [x] **OQ-BE-1 resuelta (2026-08-16)**: `products.slug` ya existe (US-003 Fase 10, migración `20260816120000_add_product_slug`). El enlace a ficha usa `slug`; ninguna task de este change agrega esquema.

## Fase 1: Repositorio de categorías — lecturas públicas (AC-1/AC-2/AC-9) — 0.5 h

- [x] T1.1 `CategoriesRepository.findRoots()` y `findBySlugWithFamily(slug)`
  - **Pattern**: `this.prisma.category.findMany({ where: { parent_id: null }, include: { children: { orderBy: { name: 'asc' } } }, orderBy: { name: 'asc' } })` y `this.prisma.category.findUnique({ where: { slug }, include: { parent: true, children: { orderBy: { name: 'asc' } } } })` — `per backend-node-standards.md §5 — el repositorio es el único punto de acceso al ORM de categories`. `findBySlugWithFamily` devuelve `null` (no lanza) si el slug no existe; el 404 lo decide el service.
  - **Exit criterion**: ambos métodos existen en `apps/api/src/categories/categories.repository.ts`; `findRoots()` devuelve sólo categorías con `parent_id = null`, cada una con sus `children` y ambos niveles ordenados por `name ASC`; `findBySlugWithFamily` devuelve la categoría con `parent` (o `null` si es rubro) y `children`, y `null` para slug inexistente. No se añade acceso al ORM de `categories` fuera del repositorio.
  - **Verify**: `pnpm --filter @dsm/api test -- categories.repository` (integration, Postgres real: sembrar 2 rubros con 2 subrubros c/u en orden no alfabético; `findRoots()` → 2 raíces ordenadas con children ordenados y sin subrubros como raíz; `findBySlugWithFamily` de un subrubro → trae `parent.slug`; de un rubro → `parent: null` + children; de un slug inexistente → `null`)

## Fase 2: Repositorio de productos — listado publicado por categorías (AC-3/AC-7/AC-8) — 0.5 h

- [x] T2.1 `ProductsRepository.findPublishedByCategoryIds(ids, { limit, offset })`
  - **Pattern**: `const where = { category_id: { in: ids }, status: 'published' }; const [data, total] = await this.prisma.$transaction([this.prisma.product.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip: offset, take: limit }), this.prisma.product.count({ where })]); return { data, total };` — `per backend-node-standards.md §5 — repositorio único punto de ORM` y `api-standards.md §6.1 — total = conteo del filtro, no de la página`. El tie-break `id ASC` hace el orden total y estable (offset determinista).
  - **Exit criterion**: el método existe en `apps/api/src/products/products.repository.ts`; filtra `status='published'` y `category_id IN (ids)`; `total` cuenta **sólo** publicados del filtro; el orden es `name ASC, id ASC`; dos páginas consecutivas son disjuntas y cubren el conjunto; `draft`/`archived` no aparecen ni en `data` ni en `total`.
  - **Verify**: `pnpm --filter @dsm/api test -- products.repository` (integration: sembrar en 2 categorías 5 publicados + 2 draft + 1 archived; `total = 5` con ids de ambas; `limit=2` → páginas `[0,2,4]` disjuntas y ordenadas; con un solo id → sólo los de esa categoría)

## Fase 3: DTOs públicos + query DTO de paginación (AC-3/AC-5/AC-6) — 0.5 h

- [x] T3.1 `StorefrontCategoryDto`, `StorefrontProductListItemDto`, `ListStorefrontProductsQueryDto`
  - **Pattern**: DTOs de respuesta con `static from(...)` (sin exponer la entidad ORM) y query DTO class-validator `@Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;` / `@Min(0) offset = 0;` validado por el `ValidationPipe` global (whitelist, 422) — `per backend-node-standards.md §4 — todo input de controller es un DTO validado en el borde` y `api-standards.md §6.1 — limit default 20, max 100`.
  - **Exit criterion**: `StorefrontCategoryDto` expone exactamente `{ slug, name, parent: {slug,name}|null, children: [{slug,name}] }` (el árbol omite `parent`); `StorefrontProductListItemDto` expone exactamente `{ slug, name, price_ars_cents, currency: 'ARS', image_url, in_stock }` con `in_stock = stock > 0` e `image_url` passthrough incluyendo `null`; ninguno incluye `id`, `stock` numérico, `status` ni timestamps; el query DTO aplica defaults 20/0 y rechaza `limit` fuera de 1..100 y `offset < 0`.
  - **Verify**: `pnpm --filter @dsm/api test -- storefront-category-dto storefront-product-list` (unit: shapes exactos por `Object.keys`; `stock=0`→`in_stock:false`, `stock=3`→`true`; `image_url=null` passthrough; transformación/validación del query DTO: `limit='150'` inválido, `limit='50'` → number 50, sin params → 20/0)

## Fase 4: Servicio — árbol, detalle y listado con agregación D1 (AC-1/AC-2/AC-9) — 0.5 h

- [x] T4.1 `StorefrontService.getCategoryTree()` / `getCategoryBySlug(slug)` / `listPublishedProducts(slug, page)`
  - **Pattern**: `const cat = await this.categories.findBySlugWithFamily(slug); if (!cat) throw new NotFoundError('Categoría no encontrada'); const ids = cat.parent_id === null ? [cat.id, ...cat.children.map((c) => c.id)] : [cat.id]; return this.products.findPublishedByCategoryIds(ids, page);` — `per backend-node-standards.md §6 — error de dominio tipado mapeado por el filtro global a RFC 7807 404` y decisión **D1** (rubro agrega hijos directos; subrubro sólo propios). El 404 se resuelve **antes** de consultar productos (AC-9) y con mensaje genérico idéntico para el detalle y el listado.
  - **Exit criterion**: los tres métodos existen en `apps/api/src/storefront/storefront.service.ts`; slug inexistente lanza `NotFoundError` tanto en `getCategoryBySlug` como en `listPublishedProducts` (mismo mensaje); para un rubro los `ids` incluyen el propio + hijos directos; para un subrubro sólo el propio; `getCategoryTree()` delega en `findRoots()`.
  - **Verify**: `pnpm --filter @dsm/api test -- storefront.service` (unit con repos mockeados: slug inexistente → `NotFoundError` en ambos métodos; rubro con 2 hijos → `findPublishedByCategoryIds` recibe 3 ids; subrubro → 1 id; el mock de productos nunca se invoca cuando la categoría no existe)

## Fase 5: Controller público de categorías + módulo (AC-1/AC-2/AC-3/AC-6/AC-9) — 0.5 h

- [x] T5.1 `StorefrontCategoriesController` (3 rutas) registrado en `StorefrontModule`
  - **Pattern**: `@Controller('v1/categories')` **sin** `AdminGuard`, con `@UseGuards(StorefrontThrottlerGuard)` + `@SkipThrottle({ auth: true })` + `@UseInterceptors(StorefrontCacheInterceptor)` (espejo exacto de `StorefrontProductsController` de US-003); rutas `@Get()`, `@Get(':slug')`, `@Get(':slug/products')` (la más específica no colisiona: Nest resuelve `:slug/products` antes que `:slug` por segmentos); respuesta del listado `{ data: rows.map(StorefrontProductListItemDto.from), pagination: { limit, offset, total } }` — `per backend-node-standards.md §2 — controller delgado: valida, delega, mapea` y **D3** (envelope vivo del contrato).
  - **Exit criterion**: existen las tres rutas públicas sin auth; árbol → 200 con rubros+children; detalle de subrubro → 200 con `parent`; listado → 200 con envelope `{ data, pagination: { limit, offset, total } }`; slug inexistente → 404 RFC 7807 `dsm:catalog/not-found` en detalle **y** listado; query inválido → 422; el controller queda registrado en `StorefrontModule` y el surface admin (`/v1/admin/*`) sigue gateado e intacto; el 429 del throttler heredado aplica a las rutas nuevas.
  - **Verify**: `pnpm --filter @dsm/api test -- e2e-storefront-categories` (e2e-nest supertest, sin header Authorization: árbol 200; detalle con `parent.slug`; listado 200 con `pagination.total`; `GET /v1/categories/no-existe` → 404 problem+json; `GET /v1/categories/no-existe/products` → 404; `?limit=150` → 422; superar el límite del throttler → 429 con `Retry-After`)

## Fase 6: Caché por endpoint — D5 ratificada (AC-7 frescura/CDN) — 0.4 h

- [x] T6.1 Extender `StorefrontCacheInterceptor` con TTL por endpoint vía decorador
  - **Pattern**: decorador `export const StorefrontCache = (opts: { maxAge: number; swr: number }) => SetMetadata(STOREFRONT_CACHE_KEY, opts);` + `Reflector` en el interceptor con default `{ maxAge: 60, swr: 30 }`; `@StorefrontCache({ maxAge: 300, swr: 60 })` sólo en la ruta del árbol — `per api-standards.md §13 — caché declarada por recurso` y decisión **D5**. El interceptor sigue estampando el header **sólo en 2xx** (hallazgo M1 de US-003: no corre ante excepción).
  - **Exit criterion**: `GET /v1/categories` responde `Cache-Control: public, max-age=300, stale-while-revalidate=60`; `GET /v1/categories/{slug}`, `GET /v1/categories/{slug}/products` y la ficha de US-003 responden `max-age=60, stale-while-revalidate=30` (la ficha NO cambia); los 404/422/429 del surface público **no** llevan `Cache-Control` cacheable; `/v1/admin/*` conserva `no-store`.
  - **Verify**: `pnpm --filter @dsm/api test -- storefront-cache` (e2e: asserts de header exacto en árbol=300, detalle/listado/ficha=60; 404 de categoría sin header cacheable; una ruta admin con `no-store`)

## Fase 7: Observabilidad — evento `category.viewed` (US §9, D4, E2E §18) — 0.3 h

- [x] T7.1 Emitir `category.viewed` en cada detalle de categoría OK
  - **Pattern**: agregar `'category.viewed'` a `CatalogEventName`; en el handler del detalle, `this.events.emit('category.viewed', category.id, null, traceparent)` tras resolver OK (espejo de `product.viewed` US-003) — `per observability-patterns §3.3 — entity_id al log, NUNCA como dimensión de métrica (cardinalidad)`. Sin PII (lectura anónima). Sólo el **detalle** emite (D4): árbol y listado no.
  - **Exit criterion**: un `GET /v1/categories/{slug}` 200 emite `category.viewed` (log pino con `entity_id` + `trace_id`, sin PII) e incrementa el contador `category_viewed_total`; un 404 no emite; `GET /v1/categories` y `GET /v1/categories/{slug}/products` no emiten; la métrica no lleva `slug`/`id` como dimensión.
  - **Verify**: `pnpm --filter @dsm/api test -- storefront-events` (detalle 200 → contador +1 y log con `entity_id`; 404 → sin incremento; árbol y listado → sin incremento)

## Fase 8: Cobertura e2e de ACs de estado/stock/vacío/volumen (AC-5/AC-6/AC-7/AC-8) — 0.9 h

- [x] T8.1 e2e negative-space + disponibilidad + vacío
  - **Exit criterion**: la suite e2e cubre — producto publicado con `stock=0` aparece en el listado con `in_stock:false` (AC-5); categoría publicada sin productos publicados (pero con drafts) → 200 `data: []`, `total: 0` (AC-6, y los drafts no inflan el total); productos `draft` y `archived` de la categoría NO aparecen en ninguna página del listado (AC-8); producto sin imagen → `image_url: null` en el item (AC-3).
  - **Verify**: `pnpm --filter @dsm/api test -- storefront-categories-acceptance` (e2e-nest contra Postgres real: los cuatro escenarios pasan; el de AC-8 recorre todas las páginas y asserta que ningún `slug` de draft/archived aparece)
- [x] T8.2 e2e de paginación a volumen (AC-7 — sin transferir el catálogo completo)
  - **Exit criterion**: con un seed de ≥120 productos publicados (más drafts intercalados) en un rubro con subrubros, el listado del rubro agrega los hijos (D1: `total` = publicados del rubro + subrubros), recorre páginas de `limit=50` sin duplicados ni faltantes (unión = total, intersección = ∅), respeta `limit` max 100 (pedir 150 → 422, pedir 100 → a lo sumo 100 filas) y una página nunca devuelve más de `limit` filas. Nota de NFR: el umbral p95 < 300ms es herencia de NFR-1 de la capacidad y su re-medición prod-shaped queda gated en US-019 (no se asserta latencia en CI local).
  - **Verify**: `pnpm --filter @dsm/api test -- storefront-pagination-volume` (e2e: seed 120+; asserts de unión/disjunción de páginas, `total` agregado del rubro correcto vs el del subrubro, límites 100/422)

## Fase 9: Contratos OpenAPI + documentación del servicio — 0.6 h

- [x] T9.1 Contratos draft de los 3 endpoints + lint
  - **Pattern**: 1 yaml autocontenido por endpoint (OpenAPI 3.0.3) en `contracts/openapi/` del change — `storefront-list-categories.yaml`, `storefront-get-category.yaml`, `storefront-list-category-products.yaml` — con `info`, `servers`, `summary/tags`, `security: []` explícito (superficie pública), parámetros (`slug`, `limit` 1..100 default 20, `offset` ≥0, `traceparent`), schemas en `components.schemas` (no inline) con validaciones, ejemplos, y catálogo de errores RFC 7807 (`404` `dsm:catalog/not-found`, `422` `dsm:catalog/validation`, `429`) — `per api-contract-completeness — 1 yaml por endpoint + error catalog cerrado con type URI`.
  - **Exit criterion**: los tres yaml validan (OpenAPI 3.x) y coinciden con la implementación (paths, envelope `{ data, pagination }`, shapes de T3.1, códigos por endpoint per la tabla API del design). Queda anotado el Spec delta (design.md §Spec delta) para el archive.
  - **Verify**: `npx @stoplight/spectral-cli lint openspec/changes/US-002-storefront-navegacion-categorias-backend/contracts/openapi/*.yaml` (0 errores en los 3 archivos)
- [x] T9.2 Actualizar el spec publicado del servicio + README
  - **Exit criterion**: `apps/api/docs/api/openapi.yaml` incorpora los tres endpoints (tag `storefront-categories`, schemas `StorefrontCategory*`/`StorefrontProductListItem`, respuestas 200/404/422/429) coherentes con el resto del contrato **y valida como OpenAPI 3.x**; `apps/api/README.md` documenta la navegación pública (endpoints, agregación D1, paginación, caché 300/60, rate-limit heredado).
  - **Verify**: `npx @stoplight/spectral-cli lint apps/api/docs/api/openapi.yaml && grep -q "/categories/{slug}/products" apps/api/docs/api/openapi.yaml && grep -q "/categories/{slug}:" apps/api/docs/api/openapi.yaml && grep -q "/v1/categories/{slug}/products" apps/api/README.md && grep -q "decisión D1" apps/api/README.md`
  - **Nota de ejecución (2026-08-17)**: la línea original grepeaba `/v1/categories/{slug}/products`, que **nunca** podía matchear — el spec publicado declara `/v1` en `servers` y los paths sin ese prefijo (convención heredada de US-001). Se corrigió el prefijo y se reforzó el check: verifica los dos paths nuevos y el tag en el README, no una sola subcadena. El Exit criterion no cambió.

## Verification (suite-level)
- [x] Unit + integration pasan: `pnpm --filter @dsm/api test` (35 suites / 185 tests verdes) (Jest `--ci`; integration reutiliza el Postgres de docker-compose :55432 con esquema `@dsm/db` — desviación consciente documentada en `test/jest.setup.js`)
- [x] E2E-nest pasan: `pnpm --filter @dsm/api test:e2e` (21 suites / 97 tests verdes)
- [x] Lint + typecheck limpios: `pnpm --filter @dsm/api lint && pnpm --filter @dsm/api typecheck`
- [x] Contract lint pasa: `npx @stoplight/spectral-cli lint openspec/changes/US-002-storefront-navegacion-categorias-backend/contracts/openapi/*.yaml apps/api/docs/api/openapi.yaml`
- [x] CI del monorepo verde: `pnpm -r lint && pnpm -r typecheck && pnpm -r test` (exit 0)

## Trazabilidad AC → tasks (+ declaraciones no-AC del design, F51)

| AC / declaración | Tasks | Estado |
|---|---|---|
| AC-1 (rubro → subrubros y/o productos) | T1.1, T4.1, T5.1 | en este change — agregación per D1 |
| AC-2 (subrubro + volver al padre) | T1.1, T4.1, T5.1 | en este change — `parent` en detalle; el breadcrumb visual es FE |
| AC-3 (item: nombre, precio ARS, imagen, disponibilidad, paginado, enlace) | T2.1, T3.1, T5.1, T8.1 | en este change — enlace por `slug` (OQ-BE-1 resuelta en US-003 Fase 10) |
| AC-4 (página indexable SEO) | — | **Deferred: FE-US-002** — SSR/metadatos/sitemap; el BE habilita datos (T5.1, T6.1) |
| AC-5 (sin stock visible, no comprable) | T3.1, T8.1 | en este change — `in_stock:false`; badge/acción son FE |
| AC-6 (categoría vacía) | T5.1, T8.1 | en este change — 200 `data: []` / `total: 0`; estado visual es FE |
| AC-7 (catálogo grande sin degradación) | T2.1, T6.1, T8.2 | en este change — paginación + caché; CWV es FE/QA; p95 re-medición gated US-019 |
| AC-8 (draft/archivado no se exponen) | T2.1, T8.1 | en este change — filtro en repositorio + negative-space e2e |
| AC-9 (categoría inexistente → 404) | T4.1, T5.1 | en este change — 404 RFC 7807 en detalle y listado |
| AC-10 (server-rendered) | — | **Deferred: FE-US-002** — verificación SSR; el BE habilita datos (T5.1) |
| — Caché por endpoint D5 (design §Caché) | T6.1 | en este change — declaración de diseño, no AC |
| — Rate-limit heredado aplicado al surface nuevo (design §API) | T5.1 | en este change — 429 verificado en e2e |
| — Evento `category.viewed` D4 (US §9, design §Observabilidad) | T7.1 | en este change — insumo panel US-016 |
| — Spec delta + spec publicado (design §Spec delta) | T9.1, T9.2 | en este change |
