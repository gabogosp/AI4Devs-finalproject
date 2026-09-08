---
tracker-id: null
tracker-source: null
parent-us: US-026
discipline: backend
variant: null
language: es
---

# US-026 Backend — Tasks

- [x] **T1 — `ProductsRepository.findRecentlyPublished()`**
  Agregar el método a `apps/api/src/products/products.repository.ts`:
  `prisma.product.findMany({ where: { status: 'published' }, orderBy:
  [{ created_at: 'desc' }, { id: 'asc' }], take: limit })`.
  Pattern: `findPublishedByCategoryIds` (mismo archivo) — mismo idioma de
  `orderBy` con tie-break por `id`.
  Exit criterion: devuelve hasta `limit` productos publicados, más nuevo
  primero, tie-break determinista por id; devuelve `[]` sin publicados.
  Verify: `pnpm --filter @dsm/api exec jest
  src/products/products.repository.spec.ts -t findRecentlyPublished` —
  casos: más nuevo primero, respeta `limit`, excluye draft/archived, `[]`
  sin publicados, empate de `created_at` resuelto por id.

- [x] **T2 — `OrdersRepository.mostSold()`**
  Agregar el método a `apps/api/src/checkout/orders.repository.ts`: raw
  SQL `JOIN order_items+orders+products`, `WHERE o.status IN
  ('new','preparing','ready','delivered') AND p.status='published'`,
  `GROUP BY p.id, p.slug, p.name, p.price_ars_cents, p.image_url, p.stock`,
  `ORDER BY sum(oi.quantity) DESC, p.id ASC`, `LIMIT $1` — proyecta SOLO
  las 5 columnas que `StorefrontProductListItemDto.from()` necesita, NUNCA
  `revenue_ars_cents`/`sku`.
  Pattern: `ReportsRepository.topProducts` (`apps/api/src/reports/
  reports.repository.ts`) para la forma del `$queryRaw` — NO se reusa el
  método en sí (design.md D2).
  Exit criterion: ranking correcto por cantidad vendida sobre órdenes
  confirmadas; excluye `pending_payment`/`cancelled`; excluye productos
  despublicados aunque tengan ventas históricas; tie-break determinista por
  id; nunca expone `revenue_ars_cents`.
  Verify: `pnpm --filter @dsm/api exec jest
  src/checkout/orders.repository.spec.ts -t mostSold` — casos: ranking por
  cantidad (no por revenue), excluye pending_payment/cancelled, excluye
  producto despublicado con historial de ventas (AC-7), empate resuelto
  por id (AC-6), `[]` sin ventas confirmadas (AC-5), respuesta NUNCA
  incluye `revenue_ars_cents`.

- [x] **T3 — `StorefrontService.getNewArrivals()` / `getBestSellers()`**
  Agregar los dos métodos a `apps/api/src/storefront/storefront.service.ts`:
  delegan en los repos de T1/T2 y devuelven `Product[]` planos (el mapeo a
  DTO lo hace el controller, mismo criterio que `getPublishedProduct`).
  `StorefrontModule` importa `CheckoutModule` (para inyectar
  `OrdersRepository`); `StorefrontService` gana `OrdersRepository` en su
  constructor.
  Exit criterion: `StorefrontService` compila con la nueva dependencia sin
  romper ningún consumidor existente (`getCategoryTree`,
  `getCategoryBySlug`, `listPublishedProducts`, `getPublishedProduct`
  intactos).
  Verify: `pnpm --filter @dsm/api exec jest
  src/storefront/storefront.service.spec.ts` — suite existente sigue
  verde + 2 tests nuevos (`getNewArrivals` delega en
  `findRecentlyPublished` con `limit=8`, `getBestSellers` delega en
  `mostSold` con `limit=8`).

- [x] **T4 — Controllers `GET /products/novedades` y `GET /products/mas-vendidos`**
  Agregar los dos handlers a `StorefrontProductsController`
  (`apps/api/src/storefront/storefront.controller.ts`), **declarados ANTES
  de `getBySlug`** (design.md D3 — colisión de ruta estática vs `:slug`).
  Cada uno con `@StorefrontCache({ maxAge: 60, swr: 30 })` explícito
  (design.md D5). Responden `{ data: StorefrontProductListItemDto[] }`
  (reusa el DTO existente de `storefront-category.dto.ts`, sin crear uno
  nuevo).
  Pattern: `getBySlug` del mismo archivo — mismo throttler/guard de clase,
  sin guard/interceptor propio.
  Exit criterion: `GET /v1/products/novedades` y `GET /v1/products/
  mas-vendidos` responden 200 con el shape correcto; ninguno de los dos
  rompe `GET /v1/products/:slug` para un slug real; una request a
  `/v1/products/novedades` llega al handler nuevo, no a un intento de
  resolver "novedades" como slug (D3, verificado con un producto real
  llamado `novedades-de-la-semana` para descartar falsos positivos de
  substring).
  Verify: `pnpm --filter @dsm/api exec jest
  src/storefront/e2e-storefront-novedades.spec.ts
  src/storefront/e2e-storefront-mas-vendidos.spec.ts
  src/storefront/e2e-storefront-destacados-sin-stock.spec.ts` — 3 archivos
  nuevos (nombrados `e2e-storefront-*` por consistencia con el resto del
  directorio), supertest contra Postgres real, todos en verde. El
  Cache-Control explícito (D5) se verifica como 2 tests nuevos dentro de
  `e2e-storefront-cache.spec.ts` (mismo archivo que ya cubre esa dimensión).

- [x] **T5 — Contrato OpenAPI**
  Agregar a `apps/api/docs/api/openapi.yaml`: `GET /products/novedades` y
  `GET /products/mas-vendidos` (tag `storefront-products`, junto a
  `GET /products/{slug}`). Nuevo schema `HighlightedProductsResponse`
  (`{data: StorefrontProductListItem[]}`) + `StorefrontProductListItem`
  (si no existe ya un schema equivalente — reusar si existe, crear si no).
  Exit criterion: el YAML lintea limpio y describe exactamente lo
  implementado en T4.
  Verify: `pnpm dlx @stoplight/spectral-cli lint apps/api/docs/api/openapi.yaml
  --ruleset .spectral.yaml --fail-severity=warn` sale exit 0.

- [x] **T6 — Suite completa + typecheck + lint**
  Correr la suite completa del backend — mismo criterio que PR
  #99/#122/#128/#139 de esta sesión: un cambio en `StorefrontModule`
  (nuevo import de `CheckoutModule`) puede romper algo que asuma la forma
  anterior del módulo.
  Exit criterion: 0 tests rotos, 0 errores de typecheck, 0 de lint en todo
  `apps/api`.
  Verify: `pnpm --filter @dsm/api test` + `pnpm --filter @dsm/api typecheck`
  + `pnpm --filter @dsm/api lint` — los tres en verde.
