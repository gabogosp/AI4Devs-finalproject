---
tracker-id: null
tracker-source: null
parent-us: US-025
discipline: backend
variant: null
language: es
---

# US-025 Backend — Reseñas y calificaciones de productos

## Why

La ficha de producto no tiene ninguna señal social — hallazgo directo del
dueño comparando con Mercado Libre (US §2). Sin estrellas ni reseñas, cada
decisión de compra depende sólo de precio y descripción. Esta US agrega la
pieza que falta: reseñas restringidas a compradores reales (orden
`delivered`, no cualquier logueado) con moderación básica del dueño.

## What changes

- **Nueva tabla `reviews`**: `customer_id`, `product_id`, `rating` (1-5,
  `CHECK` en DB), `comment` (nullable), `hidden_at` (nullable — soft-flag de
  moderación, AC-8: nunca se borra, se oculta con transparencia hacia el
  autor), `@@unique([customer_id, product_id])` (AC-5: una reseña por
  cliente por producto). Caso trivial de persistencia (una tabla nueva, dos
  FK a tablas existentes, un `CHECK`, un `UNIQUE` compuesto, un índice) — no
  amerita invocar `data-architect` Mode B.
- **`OrdersRepository.hasDeliveredOrderWithProduct(customerId, productId)`**
  (nuevo método en `checkout/orders.repository.ts`, único punto de acceso a
  `orders`/`order_items` — §5): `true` si existe un `OrderItem` de ese
  producto dentro de una `Order` de ese cliente en estado `delivered`.
- **`ReviewsModule`** (`apps/api/src/reviews/`), nuevo, con tres superficies:
  - `GET /v1/me/reviews/:productId` (auth) — `{ eligible, review }`: la FE
    usa esto para decidir "mostrar form de alta" / "mostrar form de edición
    pre-llenado" / "no mostrar nada" (AC-6/AC-7).
  - `PUT /v1/me/reviews/:productId` (auth) — upsert idempotente: crea si no
    existe, actualiza la MISMA fila si ya existe (AC-5). 403 si no elegible
    (AC-6), 422 si `rating` fuera de 1-5 (AC-9).
  - `GET /v1/products/:slug/reviews` (público) — agregado (`average`,
    `count`) + lista paginada, EXCLUYE siempre `hidden_at IS NOT NULL`
    (AC-3/AC-4). Se agrega como método nuevo de `StorefrontProductsController`
    (mismo throttler/caché que el resto de la ficha pública — no amerita un
    throttler nombrado propio).
  - `PATCH /v1/admin/reviews/:id` (admin) — `{ hidden: boolean }`, togglea
    `hidden_at` (AC-8).
- **Promedio on-read**: `AVG(rating)`/`COUNT(*)` filtrado por
  `hidden_at IS NULL`, sin caché/incremental — NFR §9 de la US lo declara
  explícitamente aceptable a esta volumetría.

## Scope — ACs cubiertos

| AC | Cubierto por |
|---|---|
| AC-1 (dejar reseña) | `PUT /v1/me/reviews/:productId` con `hasDeliveredOrderWithProduct` en 200 |
| AC-2 (calificar sin comentario) | `comment` opcional en `UpsertReviewDto` |
| AC-3 (ver promedio/conteo) | `GET /v1/products/:slug/reviews` → `{average, count}` |
| AC-4 (sin reseñas) | `average: null, count: 0` — la FE decide el copy "Sin reseñas todavía" (AC es FE-owned en la presentación, backend expone el dato exacto) |
| AC-5 (editar la propia) | `PUT` idempotente sobre `@@unique([customer_id, product_id])` — Prisma `upsert` nativo |
| AC-6 (no comprado → 403) | `hasDeliveredOrderWithProduct` false → `ReviewNotEligibleError` (403), verificado SIEMPRE server-side (NFR §9) |
| AC-7 (invitado → sin control) | `CustomerGuard` en ambos endpoints de `/v1/me/reviews/*` — 401 sin sesión; la UI (FE) es la que oculta el control, el 401 es la garantía real |
| AC-8 (el dueño oculta) | `PATCH /v1/admin/reviews/:id` + `GET /v1/me/reviews/:productId` sigue devolviendo la reseña propia con `hidden: true` aunque esté oculta al público |
| AC-9 (rating fuera de rango) | `@IsInt() @Min(1) @Max(5)` en el DTO (422) + `CHECK` en DB como defensa en profundidad |

## Standards consultados

- `api-standards.md` — RFC 7807, 422 validación, `/v1`.
- `security-standards.md` §7 — AC-6 se verifica SIEMPRE server-side (NFR §9
  de la US lo declara explícito), nunca confiando en que el FE oculte el
  control.
- `data-standards.md` — migración aditiva (tabla nueva, sin tocar existentes).

## Open questions

Ninguna — las 3 decisiones de producto ya cerradas por el dueño en la US
§10 (sólo compradores entregados, estrellas+comentario opcional, moderación
básica ocultar-no-editar).
