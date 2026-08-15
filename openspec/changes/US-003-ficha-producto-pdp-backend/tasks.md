---
parent-us: US-003
discipline: backend
variant: null
language: es
---

# US-003 Backend — Tasks

> Cada task es closure-grade: atómica, con `Exit criterion:` observable y `Verify:` con el comando exacto que `/develop-backend` corre. Los comandos asumen la **raíz del repo** como cwd y corren contra la app `apps/api` (`@dsm/api`) ya scaffoldeada por US-001. El esquema se **consume** de `@dsm/db`; **ninguna task migra esquema** (la columna `slug` de OQ-BE-1 es infra-owned y está fuera de este change). Los `Verify:` de tests usan el runner de US-001 en su forma terminante (`pnpm --filter @dsm/api test -- <patrón>` corre Jest en modo `--ci`, no watch — F49).
>
> **Estimación dual**: **3 h AI-asistido** / **6 h tradicional** (coherente con `story_points_ai_assisted: 2` de la US acotado a BE y con el estimado §7 de la US "BE-US-003 3-5h"; ~0.45× per Peng 2023). Es un surface de lectura que reutiliza todo el borde HTTP de US-001.

## Pre-requisitos
- [ ] **US-001 backend archivado**: `apps/api` corre con `ProductsRepository`, `HttpProblemFilter` (RFC 7807 `dsm:catalog/*`), `CatalogEventsService`, throttler `@nestjs/throttler`, helmet/CORS (§7.1/§7.2). Verificado: `pnpm --filter @dsm/api typecheck`.
- [ ] **OQ-BE-1 reconocida** (proposal §Open questions) `[Open]`: la URL por `slug` requiere columna nueva **infra-owned**; este change usa `sku` como identificador público interino y **no** agrega esquema. Si durante la ejecución se decidiera agregar `slug`, se **detiene y se escala** (no se materializa acá).
- [ ] **OQ-BE-2 / OQ-BE-3 reconocidas**: caché acotada `max-age=60` propuesta (confirmable); respuesta expone `in_stock`, no `stock` numérico.

## Fase 1: Repositorio — lectura de producto publicado (AC-1/AC-7/AC-8)

- [x] T1.1 `ProductsRepository.findPublishedBySku(sku)` con join de categoría
  - **Pattern**: `this.prisma.product.findFirst({ where: { sku, status: 'published' }, include: { category: true } })` — `per backend-node-standards.md §5 — el repositorio es el único punto de acceso al ORM de products`. Devuelve `null` (no lanza) para cualquier no-match; el 404 lo decide el service.
  - **Exit criterion**: el método existe en `apps/api/src/products/products.repository.ts`, filtra `status='published'` e incluye `category`; para un `sku` de producto `draft`, `archived` o inexistente devuelve `null`; para uno `published` devuelve el producto con su `category`. No se añade acceso al ORM de `products` fuera de este repositorio.
  - **Verify**: `pnpm --filter @dsm/api test -- products.repository` (integration Testcontainers: sembrar un producto por cada estado; `findPublishedBySku` → objeto sólo para el publicado, `null` para draft/archived/inexistente; el objeto trae `category.slug`)

## Fase 2: DTO público + mapper orientado a ficha/SEO (AC-2/AC-3/AC-4/AC-5/AC-6)

- [x] T2.1 `StorefrontProductDto` + `from()` (shape público, sin campos admin)
  - **Pattern**: DTO de respuesta con `static from(p: Product & { category: Category }): StorefrontProductDto` que deriva `in_stock: p.stock > 0` y mapea `description: p.description_raw` — `per backend-node-standards.md §4 — DTO de respuesta explícito, sin exponer la entidad ORM`.
  - **Exit criterion**: `apps/api/src/storefront/dto/storefront-product.dto.ts` expone exactamente `{ sku, name, description, price_ars_cents, currency: 'ARS', image_url, in_stock, category: { name, slug } }`; `in_stock` = `stock > 0` (AC-3/AC-4); `description` = `description_raw` (AC-5 — con comentario de que US-005 antepondrá `description_enriched`); `image_url` se pasa tal cual incluyendo `null` (AC-6); **no** incluye `id`, `stock` numérico, `status`, `created_at`, `updated_at` (OQ-BE-3).
  - **Verify**: `pnpm --filter @dsm/api test -- storefront-product` (unit: `stock=0`→`in_stock:false`, `stock=5`→`in_stock:true`; `image_url=null` passthrough; el objeto no contiene las claves `id`/`stock`/`status`/`created_at`)

## Fase 3: Servicio de storefront — use-case de lectura pública (AC-7/AC-8)

- [x] T3.1 `StorefrontService.getPublishedProduct(sku)` → 404 si no existe/oculto
  - **Pattern**: `const p = await this.repo.findPublishedBySku(sku); if (!p) throw new NotFoundError('Producto no encontrado'); return p;` — `per backend-node-standards.md §6 — error de dominio tipado, el filtro global lo mapea a RFC 7807 404`. El mensaje es genérico (no revela si el producto existe pero está oculto).
  - **Exit criterion**: `apps/api/src/storefront/storefront.service.ts` con `getPublishedProduct(sku)` que devuelve el producto publicado o lanza `NotFoundError` (→ 404 `dsm:catalog/not-found`) de forma idéntica para draft/archived/inexistente; sin ramas que distingan el motivo (no enumeration leak).
  - **Verify**: `pnpm --filter @dsm/api test -- storefront.service` (unit con repo mockeado: repo→`null` lanza `NotFoundError`; repo→producto lo devuelve; el mensaje es idéntico en los tres casos ocultos)

## Fase 4: Controller público + módulo (AC-1)

- [x] T4.1 `StorefrontProductsController` `GET /v1/products/{sku}` + `StorefrontModule`
  - **Pattern**: `@Controller('v1/products')` **sin** `@UseGuards(AdminGuard)`; `@Get(':sku')` → `StorefrontProductDto.from(await this.storefront.getPublishedProduct(sku))`. `StorefrontModule` importa `ProductsModule` (exporta `ProductsRepository`) y registra `StorefrontProductsController` + `StorefrontService`; se importa en `AppModule` — `per backend-node-standards.md §2 — módulo de feature con su controller/service`.
  - **Exit criterion**: existe la ruta pública `GET /v1/products/{sku}` **sin auth**; un producto publicado → `200` con el shape de `StorefrontProductDto`; draft/archived/inexistente → `404` RFC 7807; el módulo queda cableado en `AppModule`. La ruta admin `GET /v1/admin/products/{id}` (US-001) sigue gateada e intacta.
  - **Verify**: `pnpm --filter @dsm/api test -- e2e-storefront-product` (e2e-nest supertest: publicado→200 con `name`/`price_ars_cents`/`in_stock`/`category.slug`; draft→404; archived→404; sku inexistente→404; **sin** header Authorization)

## Fase 5: Rate-limit del surface público (§7.3)

- [x] T5.1 Throttler nombrado `storefront` por IP + 429 con cabeceras
  - **Pattern**: extender el array de `ThrottlerModule.forRootAsync` (hoy en `AuthModule`, throttler `auth`) con un segundo throttler `{ name: 'storefront', ttl: STOREFRONT_RATE_LIMIT_TTL_MS, limit: STOREFRONT_RATE_LIMIT_MAX }` y aplicar al controller un guard que emita `RateLimit-*`/`Retry-After` (mirror de `AuthThrottlerGuard`) — `per security-standards.md §7.3 — rate-limit del surface público` y `api-standards.md §12 — cabeceras de rate-limit`. Nuevas env `STOREFRONT_RATE_LIMIT_TTL_MS` (default `60000`) y `STOREFRONT_RATE_LIMIT_MAX` (default `60`) en `env.validation.ts` (Zod, validadas al arranque §7).
  - **Exit criterion**: `GET /v1/products/{sku}` está limitado por IP (default 60/min, configurable por env validada); superar el límite → `429` con `Retry-After` y `RateLimit-Limit`/`RateLimit-Remaining`/`RateLimit-Reset`; el `429` sale en envelope RFC 7807 (vía el filtro global). El surface admin de US-001 conserva su throttler `auth` sin cambios.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=storefront-security` (e2e: N peticiones dentro del límite→200; la N+1→429 con `Retry-After`; el body del 429 es `application/problem+json`)

## Fase 6: Caché acotada del surface público (AC-9)

- [ ] T6.1 `Cache-Control` público acotado para `/v1/products/*` en el borde
  - **Pattern**: en `configureApp` (bootstrap), junto al `no-store` de `/v1/admin`, setear para paths que empiezan con `/v1/products` `Cache-Control: public, max-age=60, stale-while-revalidate=30` — `per api-standards.md §12 / E2E §17 — CDN de catálogo con frescura acotada`. Se setea **una vez en el borde**, no por handler.
  - **Exit criterion**: la respuesta de `GET /v1/products/{sku}` lleva `Cache-Control: public, max-age=60, stale-while-revalidate=30` (valor de OQ-BE-2, propuesto); **no** lleva `no-store`; una edición de precio (US-001 `PATCH /v1/admin/products/{id}`) se refleja en la siguiente lectura tras expirar la ventana (AC-9: nunca precio desactualizado indefinidamente). El surface admin conserva `no-store`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=storefront-cache` (e2e: la respuesta pública trae `Cache-Control` con `max-age=60` y sin `no-store`; una ruta `/v1/admin/*` sigue con `no-store`)

## Fase 7: Observabilidad — evento `product.viewed` (US §9, E2E §18)

- [ ] T7.1 Emitir `product.viewed` en cada fetch OK de ficha
  - **Pattern**: agregar `'product.viewed'` a `CatalogEventName` y emitir `this.events.emit('product.viewed', product.id)` tras un fetch OK; contador `pdp_viewed_total` — `per observability-patterns §3.3 — el id de producto va al log, NUNCA como dimensión de métrica (cardinalidad)`. Sin PII (lectura anónima); no se pasa `admin_user_id` (o se pasa `null`, no `'admin'`).
  - **Exit criterion**: un `GET /v1/products/{sku}` de un producto publicado emite el evento `product.viewed` (log pino estructurado con `entity_id` + `trace_id`, sin PII) e incrementa el contador; un `404` **no** lo emite. La métrica no lleva `product_id`/`sku` como dimensión.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=storefront-events` (unit/e2e: fetch de publicado → `count('product.viewed')` incrementa y el log trae `entity_id`; un 404 no incrementa el contador)

## Fase 8: Cobertura e2e de ACs de estado/stock/precio (AC-3/AC-4/AC-6/AC-9)

- [ ] T8.1 e2e de disponibilidad, imagen nula y precio vigente
  - **Exit criterion**: la suite e2e cubre — producto con `stock>0` → `in_stock:true` (AC-3); producto publicado con `stock=0` → `200` con `in_stock:false` (AC-4, visible pero no comprable); producto sin imagen → `image_url:null` (AC-6); tras `PATCH` admin del precio, una relectura de la ficha devuelve el `price_ars_cents` nuevo (AC-9).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=storefront-acceptance` (e2e-nest: los cuatro escenarios pasan contra Postgres real de Testcontainers)

## Fase 9: Contrato OpenAPI + documentación del servicio

- [ ] T9.1 Contrato del endpoint público (draft) + lint
  - **Pattern**: `contracts/openapi/storefront-get-product.yaml` autocontenido (OpenAPI 3.0.3) con `paths./v1/products/{sku}.get`, `components.schemas.StorefrontProduct` + `Problem`, respuestas `200/404/429` con `type` `dsm:catalog/*` y `example` — `per api-contract-completeness — 1 yaml por endpoint + catálogo de errores RFC 7807`.
  - **Exit criterion**: el yaml valida (OpenAPI 3.x) y coincide con la implementación (path `GET /v1/products/{sku}`, shape de `StorefrontProduct`, catálogo de errores `404` `dsm:catalog/not-found` y `429`). Queda anotado que al archivar se agrega como path file al contrato vivo `openspec/specs/catalogo/contracts/openapi.yaml`.
  - **Verify**: `npx @stoplight/spectral-cli lint openspec/changes/US-003-ficha-producto-pdp-backend/contracts/openapi/storefront-get-product.yaml`

- [ ] T9.2 Actualizar el spec publicado del servicio + README
  - **Exit criterion**: `apps/api/docs/api/openapi.yaml` incorpora `GET /v1/products/{sku}` (tag `storefront-products`, schema `StorefrontProduct`, respuestas 200/404/429) coherente con el resto del contrato; `apps/api/README.md` documenta el nuevo surface público (endpoint, rate-limit, caché).
  - **Verify**: `grep -q "/v1/products/{sku}" apps/api/docs/api/openapi.yaml && grep -q "storefront" apps/api/README.md`

## Verification (suite-level)

- [ ] Todos los unit tests pasan: `pnpm --filter @dsm/api test`
- [ ] Integration (Testcontainers, Postgres real con esquema `@dsm/db`) pasan: `pnpm --filter @dsm/api test -- --group=integration` (requiere Docker)
- [ ] E2E-nest (supertest) pasan: `pnpm --filter @dsm/api test:e2e`
- [ ] Lint + typecheck limpios: `pnpm --filter @dsm/api lint && pnpm --filter @dsm/api typecheck`
- [ ] Contract lint OpenAPI pasa: `npx @stoplight/spectral-cli lint openspec/changes/US-003-ficha-producto-pdp-backend/contracts/openapi/storefront-get-product.yaml`
- [ ] CI del monorepo verde: `pnpm -r lint && pnpm -r typecheck && pnpm -r test`

## Trazabilidad AC → tasks

| AC | Tasks | Estado |
|---|---|---|
| AC-1 (ver ficha publicada) | T1.1, T2.1, T3.1, T4.1 | en este change — **URL por slug diferida a OQ-BE-1 (infra); interino `sku`** |
| AC-2 (SEO / campos indexables) | T2.1, T4.1 | en este change — BE expone campos; SSR/JSON-LD son FE |
| AC-3 (con stock → comprable) | T2.1, T8.1 | en este change — `in_stock:true`; disparador de carrito es US-007 |
| AC-4 (sin stock → visible, no comprable) | T2.1, T8.1 | en este change — `in_stock:false`; indicador/WhatsApp son FE/US-018 |
| AC-5 (descripción enriquecida si existe) | T2.1 | en este change — `description_raw`; `description_enriched` diferida a **US-005** |
| AC-6 (sin imagen) | T2.1, T8.1 | en este change — `image_url:null`; placeholder es FE |
| AC-7 (draft/archivado → 404) | T1.1, T3.1, T4.1 | en este change |
| AC-8 (inexistente → 404) | T1.1, T3.1, T4.1 | en este change |
| AC-9 (precio vigente) | T6.1, T8.1 | en este change — lectura viva + caché acotada |
| — (rate-limit surface público §7.3) | T5.1 | en este change — declaración de diseño, no AC (F51) |
| — (evento `product.viewed`, US §9) | T7.1 | en este change — insumo panel US-016 |
