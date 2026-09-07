# Capacidad: Reseñas y calificaciones de producto (CAP-14)

**Estado**: backend + frontend-web vivos. QA en curso (E2E Playwright ya
verde, pendiente su propio `/archive-change`) — ver `us-status.yaml`.

Estado declarado del sistema para la capacidad CAP-14 del PRD §2.1 (nace
`prd-capacity: null` — hallazgo de la prueba visual del dueño, no del PRD
original). Este directorio es el **acumulado** de los changes archivados:
se extiende en cada `/archive-change`, nunca se reescribe.

## Por qué esta capacidad no existía todavía

La ficha de producto (US-003) no tenía ninguna señal social — el dueño lo
señaló comparando con Mercado Libre ("descripción rica + reseñas +
estrellas"). La descripción ya existía en código (US-005); reseñas es la
pieza genuinamente nueva. `openspec/specs/resenas-productos/` nace hermana
de `catalogo/` (no anidada): comparte las tablas `customers`/`products`/
`orders` con otras capacidades, pero es una superficie propia (`reviews`,
nueva tabla, sin relación con el ciclo de vida del producto en sí).

## Qué está vivo hoy (backend, US-025)

Un módulo nuevo (`apps/api/src/reviews/`) con tres superficies sobre una
tabla nueva (`reviews`):

- **Dejar/editar la propia reseña** (AC-1/AC-2/AC-5): `PUT
  /v1/me/reviews/{slug}` — upsert idempotente sobre
  `@@unique([customer_id, product_id])`: reeditar actualiza la MISMA fila,
  nunca crea una segunda. `comment` es opcional (sólo calificar es válido).
- **Elegibilidad + reseña propia en una llamada** (AC-6/AC-7/AC-8): `GET
  /v1/me/reviews/{slug}` → `{eligible, review}`. `eligible` sale de
  `OrdersRepository.hasDeliveredOrderWithProduct` (nuevo método, único
  punto de acceso a `orders`/`order_items`) — `true` sólo si el cliente
  tiene una orden PROPIA en estado `delivered` con ese producto. `review`
  es la reseña propia SIN IMPORTAR si está oculta por moderación
  (transparencia hacia el autor, AC-8) — `null` si todavía no reseñó.
  Requiere sesión (`CustomerGuard`); sin ella, 401.
- **Reseñas públicas del producto** (AC-3/AC-4): `GET
  /v1/products/{slug}/reviews` — sin auth, agregado on-read (`AVG`/`COUNT`
  filtrado por `hidden_at IS NULL`, sin caché/incremental — volumetría
  chica). `average: null` + `count: 0` distingue "sin reseñas" de
  "reseñas con promedio bajo" (nunca `0` cuando hay al menos una). Mismo
  criterio de 404 que la ficha (draft/archived/inexistente → 404 uniforme).
  Reusa el throttler/caché de `StorefrontProductsController` — no tiene un
  throttler nombrado propio.
- **Moderación del dueño** (AC-8): `PATCH /v1/admin/reviews/{id}` —
  `hidden_at` es un soft-flag, nunca borra la fila ni edita el contenido.
  Ocultar excluye la reseña del agregado y de la lista pública; el autor
  la sigue viendo marcada como oculta si vuelve a `GET
  /me/reviews/{slug}` (transparencia, no censura invisible).
- **`rating` validado en DTO (422) y en DB (`CHECK`)** — defensa en
  profundidad: `@IsInt() @Min(1) @Max(5)` en `UpsertReviewDto` + `CHECK
  (rating >= 1 AND rating <= 5)` en la migración (AC-9).

## Puntos diferidos

- **Reseñas con foto/video** — sólo texto + estrellas en v1 (fuera de
  alcance explícito de US-025 §4).
- **Respuesta pública del dueño a una reseña** — el dueño sólo puede
  ocultarla, no responder. `Deferred:` CR futuro si se pide.
- **Votar "esto te sirvió" en una reseña ajena** — funcionalidad de
  ranking social, fuera de v1.
- **Notificar al cliente cuando su reseña es ocultada** — se ve reflejado
  si vuelve a la ficha (AC-8), pero no dispara un email.
- **Caché/incremental del promedio** — hoy `AVG`/`COUNT` on-read; nota de
  escala futura si el catálogo/volumen de reseñas crece órdenes de
  magnitud (US-025 §9, no es un NFR de esta US).
- **Reconciliación con el borrado de cuenta (US-020)** — `reviews.
  customer_id` no se anonimiza cuando el cliente borra su cuenta; el
  nombre público SÍ se actualiza porque `PublicReview.customer_name` se
  resuelve por JOIN en cada lectura (nunca se cachea en la fila), así que
  en la práctica ya muestra "Cuenta eliminada" tras el borrado sin cambio
  adicional — documentado como gap consciente, no un bug (design.md D6 del
  change archivado).

## Qué está vivo hoy (frontend-web, US-025)

`apps/web/src/features/reviews/` — sección de reseñas en la ficha de
producto + vista de moderación en el panel admin:

- **En la ficha de producto** (AC-1 a AC-9): `ReviewsDataContainer.tsx`
  (única hoja `'use client'`, compuesta en `ProductDetail.tsx` debajo de
  la descripción) deriva el estado del visitante — `guest` (AC-7),
  `ineligible` (AC-6, ausencia total del control, nunca un mensaje),
  `eligible-new`/`eligible-editing` (AC-5, precarga desde `GET
  /me/reviews/{slug}`) — de `useSession()` + `reviewsService.getOwn()`.
  Control de estrellas accesible (`role="radiogroup"`/`radio`,
  navegación por flechas, `aria-label` "N de 5 estrellas"). El propio
  autor sigue viendo su reseña oculta antepuesta a la lista pública (el
  `GET` público la excluye siempre) para no perder la transparencia de
  AC-8.
- **Moderación admin** (AC-8) — `ProductReviewsModeration.tsx`, sección
  nueva dentro de `/admin/productos/{id}` (**no** un panel cross-producto
  tipo `/admin/resenas`): el contrato de backend sólo publica `PATCH
  /admin/reviews/{id}` (moderar por id ya conocido), sin ningún `GET
  /admin/reviews` que liste reseñas de todos los productos — así que la
  única forma de que el dueño descubra qué reseñas moderar sin inventar
  contrato es reusar, por producto, el mismo listado público que ya
  consume la ficha. Decisión forzada por el contrato existente, no una
  preferencia de diseño (`design.md` §D8 del change archivado).
- **Limitación real conocida, no un bug**: como el listado público
  excluye `hidden_at` no-nulo de forma incondicional (sin variante
  admin), una reseña recién ocultada desaparece de toda superficie que
  el FE puede alcanzar — no hay forma de volver a listarla para
  deshacer el ocultamiento después de recargar la pantalla, aunque
  `PATCH /admin/reviews/{id}` sí soporta `hidden: false` a nivel de API.
  Mitigado con estado optimista en memoria (la fila sigue accionable
  durante la misma sesión de la pantalla de moderación). Si el negocio
  necesita revertir ocultamientos de forma confiable, hace falta un CR
  de backend (endpoint que incluya `hidden_at` no-nulo) — no algo que el
  FE pueda resolver por su cuenta.
- **Codegen**: `apps/web/src/features/reviews/types.ts` deriva
  íntegramente de `apps/web/src/api/generated/` — no quedó ningún tipo
  hand-typed del feature (el `types.provisional.ts` de la Fase A, previo
  a que el contrato existiera, se borró al conectar el wiring real).

## Cómo se probó

**Backend**: suite dev-owned (Jest + supertest contra Postgres real, sin
mocks): `hasDeliveredOrderWithProduct` (9 tests), `ReviewsRepository` (9),
`UpsertReviewDto`/`ModerateReviewDto` (8), `ReviewsService` (8), y 5
archivos de AC contra la API real (`ac1-ac2-ac5-crear-editar-resena`,
`ac3-ac4-agregado-publico`, `ac6-ac7-elegibilidad`,
`ac9-rating-fuera-de-rango`, `ac8-moderacion-admin` — 17 tests) — 51 tests
nuevos en total.

**Frontend-web**: componentes presentacionales (RTL + axe-core, 0
violaciones serious/critical sobre los 4 `viewerState`), `reviewsService`/
`adminReviewsService`/`ProductReviewsModeration` con MSW,
`ReviewsDataContainer` con 10 tests de integración (los 4 `viewerState`,
la reseña propia oculta anteponiéndose a la lista pública, el ciclo
completo de submit con 403/422 reales) — 75 tests en total. Más el E2E
dev-owned `reviews-topology.spec.ts` (5/5, mismo patrón que
`account-deletion-topology.spec.ts` de US-020) verificando que el rewrite
`/v1/me/:path*` cubre el nuevo prefijo `/v1/me/reviews/:slug` contra la
app **construida**, no sólo por lectura del `next.config.mjs`.
