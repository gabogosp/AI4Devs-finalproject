---
tracker-id: null
tracker-source: null
parent-us: US-025
discipline: backend
variant: null
language: es
---

# US-025 Backend — Tasks

## Fase 1 — Reseñar, listar, agregar

- [x] **T1 — Migración: tabla `reviews`**
  Agregar el modelo `Review` a `packages/db/prisma/schema.prisma`
  (`customer_id`, `product_id`, `rating Int`, `comment String?`,
  `hidden_at DateTime?`, `created_at`/`updated_at`,
  `@@unique([customer_id, product_id])`, `@@index([product_id,
  hidden_at])`, relaciones `onDelete: Restrict` en ambas FK — D6). Agregar
  `reviews Review[]` a `Customer` y a `Product`. Generar con `prisma migrate
  dev --name add_reviews --create-only`, editar el SQL para agregar el
  `CHECK (rating >= 1 AND rating <= 5)` (Prisma no lo genera solo — mismo
  patrón que el `CHECK` de `orders.anonymization_reason`), aplicar.
  Exit criterion: la migración existe, es aditiva (tabla nueva, sin tocar
  columnas existentes), el `CHECK` está en el SQL, aplica limpio.
  Verify: `pnpm --filter @dsm/db exec prisma migrate deploy` contra Postgres
  descartable sale exit 0; un `INSERT` manual con `rating=6` viola el
  `CHECK` (verificado con un `psql` directo antes de escribir el repo).

- [x] **T2 — `OrdersRepository.hasDeliveredOrderWithProduct()`**
  Agregar el método a `apps/api/src/checkout/orders.repository.ts`:
  `orderItem.findFirst({ where: { product_id, order: { customer_id, status:
  'delivered' } }, select: { id: true } })` → `Promise<boolean>`.
  Pattern: cualquier método de sólo lectura ya existente en el mismo
  repositorio (mismo estilo `findFirst`+`select` acotado).
  Exit criterion: `true` sólo si el cliente tiene un `OrderItem` de ese
  producto dentro de una orden `delivered` propia; `false` para
  `pending_payment`/`new`/`preparing`/`ready`/`cancelled` o si el producto
  nunca apareció en ninguna orden del cliente.
  Verify: `pnpm --filter @dsm/api exec jest
  src/checkout/orders.repository.spec.ts -t hasDeliveredOrderWithProduct` —
  casos: delivered→true, cada otro status→false, producto ajeno→false,
  cliente ajeno con el mismo producto delivered→false.

- [x] **T3 — `ReviewsModule` + `ReviewsRepository`**
  Crear `apps/api/src/reviews/reviews.repository.ts`: `upsert(customerId,
  productId, {rating, comment})` (Prisma `upsert` sobre
  `customer_id_product_id`), `findOwn(customerId, productId)`,
  `findVisibleByProduct(productId, pagination)` (filtra `hidden_at: null`,
  devuelve `{data, total}` con `customer.name` vía `include`),
  `aggregateVisible(productId)` (`aggregate({_avg: {rating: true}, _count:
  true}, where: {product_id, hidden_at: null}})`), `setHidden(id, hidden:
  boolean)`. Crear `apps/api/src/reviews/reviews.module.ts` (imports:
  `PrismaModule`, `ProductsModule`, `CheckoutModule`, `AuthModule`).
  Pattern: `apps/api/src/products/products.repository.ts` (único punto de
  acceso al ORM de una tabla, §5).
  Exit criterion: los 5 métodos existen y compilan; `upsert` crea si no
  existe, actualiza la MISMA fila (mismo `id`) si ya existe.
  Verify: `pnpm --filter @dsm/api exec jest
  src/reviews/reviews.repository.spec.ts` (nuevo, contra Postgres real) —
  upsert-crea, upsert-actualiza-mismo-id, findVisibleByProduct excluye
  ocultas, aggregateVisible excluye ocultas y devuelve `null` de avg sin
  filas.

- [x] **T4 — `UpsertReviewDto` + `ReviewNotEligibleError`**
  Crear `apps/api/src/reviews/dto/review.dto.ts`: `UpsertReviewDto`
  (`rating: number` con `@IsInt() @Min(1) @Max(5)`, `comment?: string |
  null` con `@IsOptional() @IsString() @MaxLength(2000)`),
  `ReviewResponseDto` (`id, rating, comment, hidden, created_at,
  updated_at`, `.from()`), `PublicReviewDto` (`id, customer_name, rating,
  comment, created_at`), `ModerateReviewDto` (`hidden: boolean`, único
  campo, `additionalProperties: false`). Crear
  `apps/api/src/reviews/reviews-errors.ts`:
  `ReviewNotEligibleError extends DomainError` (403,
  `dsm:reviews/not-eligible`).
  Pattern: `apps/api/src/account/account-errors.ts` (`DomainError` con
  `status`+`type` propios).
  Exit criterion: rating 0 o 6 → violación; rating 1-5 → sin violación;
  comment ausente → sin violación (AC-2).
  Verify: `pnpm --filter @dsm/api exec jest
  src/reviews/dto/review.dto.spec.ts` (TDD, rojo antes/verde después) — 6
  casos (rating 0/6/1/5 rechazado-aceptado-aceptado-aceptado, comment
  ausente aceptado, comment >2000 chars rechazado).

- [x] **T5 — `ReviewsService`**
  Crear `apps/api/src/reviews/reviews.service.ts`: `getOwn(customerId,
  productId)` → `{eligible, review}` (llama
  `orders.hasDeliveredOrderWithProduct` + `reviews.findOwn`);
  `upsertOwn(customerId, productId, dto)` → lanza `ReviewNotEligibleError`
  si no elegible (AC-6, verificado ANTES de tocar la tabla), si no delega en
  `reviews.upsert`; `listPublic(slug, pagination)` → resuelve `slug` vía
  `ProductsRepository.findPublishedBySlug` (404 si no existe/no publicado,
  mismo criterio que la ficha), devuelve `{average, count, data,
  pagination}` combinando `aggregateVisible` + `findVisibleByProduct`.
  Exit criterion: AC-6 se verifica SIEMPRE antes de cualquier escritura,
  nunca se confía en un flag del cliente (NFR §9).
  Verify: `pnpm --filter @dsm/api exec jest
  src/reviews/reviews.service.spec.ts` (TDD) — elegible→upsert ok, no
  elegible→ReviewNotEligibleError sin tocar la tabla (verificado con un spy/
  count), slug inexistente→404, producto draft→404.

- [x] **T6 — Controllers `v1/me/reviews` + `v1/products/:slug/reviews`**
  Crear `apps/api/src/reviews/customer-reviews.controller.ts`
  (`@Controller('v1/me/reviews')`): `GET :productId` (`CustomerGuard`),
  `PUT :productId` (`CustomerGuard, CsrfGuard`, body `UpsertReviewDto`,
  identidad SOLO de `req.customerId` — mismo criterio AC-7 que
  `AccountController`). Agregar `@Get(':slug/reviews')` a
  `StorefrontProductsController` existente (delega en
  `ReviewsService.listPublic`, mismo throttler/caché de clase que el resto
  del controller — sin cambios de guard/interceptor). `StorefrontModule`
  importa `ReviewsModule`.
  Pattern: `apps/api/src/account/account.controller.ts` (identidad
  estructural desde `req.customerId!`).
  Exit criterion: AC-1/AC-2/AC-5 (crear/editar, con/sin comentario) vía
  `PUT`; AC-6 (403 sin compra entregada); AC-7 (401 sin sesión); AC-3/AC-4
  (agregado correcto/vacío) vía el `GET` público.
  Verify: `pnpm --filter @dsm/api exec jest
  src/reviews/ac1-ac2-ac5-crear-editar-resena.spec.ts
  src/reviews/ac3-ac4-agregado-publico.spec.ts
  src/reviews/ac6-ac7-elegibilidad.spec.ts
  src/reviews/ac9-rating-fuera-de-rango.spec.ts` — 4 archivos nuevos,
  supertest contra Postgres real, seed de una orden `delivered` real vía
  Prisma directo en `beforeEach` (mismo criterio que
  `ac13-only-owner-deletes.spec.ts`), todos en verde.

## Fase 2 — Moderación del dueño

- [x] **T7 — `AdminReviewsController`**
  Crear `apps/api/src/reviews/admin-reviews.controller.ts`
  (`@Controller('v1/admin/reviews')`, `@UseGuards(AdminGuard)`): `PATCH :id`
  con `ModerateReviewDto`, delega en `ReviewsService.moderate(id, hidden)`
  (nuevo método: llama `reviews.setHidden` + emite `review.hidden`/
  `review.shown` vía un `ReviewEventsService` nuevo, mismo patrón que
  `CatalogEventsService`). 404 si el id no existe.
  Pattern: `apps/api/src/products/products.controller.ts` (`@Patch(':id')`
  bajo `AdminGuard`, mismo shape de controller fino).
  Exit criterion: AC-8 completo — ocultar togglea `hidden_at`, la reseña
  desaparece de `GET /v1/products/:slug/reviews` pero `GET
  /v1/me/reviews/:productId` (con la sesión del autor) sigue devolviéndola
  con `hidden: true`.
  Verify: `pnpm --filter @dsm/api exec jest
  src/reviews/ac8-moderacion-admin.spec.ts` (nuevo) — oculta→excluida del
  público, autor sigue viéndola con `hidden:true`, mostrar de nuevo
  (`hidden:false`)→reaparece, id inexistente→404.

## Fase 3 — Contrato + cierre

- [x] **T8 — Contrato OpenAPI**
  Agregar a `apps/api/docs/api/openapi.yaml`: `GET/PUT /me/reviews/{productId}`
  (tag `reviews`), `GET /products/{slug}/reviews` (tag `storefront-products`,
  junto al `GET /products/{slug}` existente), `PATCH /admin/reviews/{id}`
  (tag `admin-reviews`). Nuevos schemas: `OwnReviewEnvelope`,
  `UpsertReviewRequest`, `PublicReviewsResponse`, `PublicReview`,
  `ModerateReviewRequest`, `ReviewNotEligibleProblem`.
  Exit criterion: el YAML lintea limpio y describe exactamente lo
  implementado en T6/T7.
  Verify: `pnpm dlx @stoplight/spectral-cli lint apps/api/docs/api/openapi.yaml
  --ruleset .spectral.yaml --fail-severity=warn` sale exit 0.

- [x] **T9 — Suite completa + typecheck + lint**
  Correr la suite completa del backend (no sólo los archivos nuevos) —
  mismo criterio que PR #99/#122/#128 de esta sesión: verificar que ningún
  DTO/schema compartido rompió un fixture en otro módulo.
  Exit criterion: 0 tests rotos, 0 errores de typecheck, 0 de lint en todo
  `apps/api`.
  Verify: `pnpm --filter @dsm/api test` + `pnpm --filter @dsm/api typecheck`
  + `pnpm --filter @dsm/api lint` — los tres en verde.
