---
tracker-id: null
tracker-source: null
parent-us: US-025
discipline: backend
variant: null
language: es
---

# US-025 Backend — Design

## Context

Tres módulos existentes se consultan pero ninguno se modifica en su forma
pública: `ProductsModule` (resolver `slug` → producto, verificar
publicado), `CheckoutModule` (dueño de `orders`/`order_items` — único punto
de acceso al ORM de esas tablas, §5), `AuthModule` (`CustomerGuard`,
`CsrfGuard`, `AdminGuard`). `ReviewsModule` es nuevo y los importa los tres
— dirección acíclica: ninguno de los tres importa `ReviewsModule` de vuelta.
`StorefrontModule` gana un cuarto import (`ReviewsModule`) para exponer el
`GET` público de reseñas desde el `StorefrontProductsController` ya
existente — tampoco cierra ciclo (`ReviewsModule` no importa
`StorefrontModule`).

## Decisions

### D1 — `hasDeliveredOrderWithProduct` vive en `OrdersRepository`, no en un repo nuevo

`orders`/`order_items` son propiedad exclusiva de `OrdersRepository`
(`checkout/orders.repository.ts`, §5 — "único punto de acceso al ORM").
Un método nuevo de `ReviewsRepository` que consultara esas tablas
directamente violaría esa invariante y duplicaría el criterio de qué
estados cuentan como "entregado". El método es una consulta de sólo
lectura: `orderItem.findFirst({ where: { product_id, order: { customer_id,
status: 'delivered' } } })` → `!!resultado`.

### D2 — `PUT`, no `POST`/`PATCH`, para el alta+edición de la propia reseña

La US §7 sugiere "POST/PATCH" sin fijarlo. Se elige `PUT
/v1/me/reviews/:productId` porque el AC-5 pide semántica de **upsert
idempotente sobre un recurso identificado por URL** (una reseña por
cliente por producto, `@@unique`) — exactamente lo que `PUT` describe
(reemplaza/crea el recurso en esa URL), y evita la ambigüedad de tener DOS
verbos (`POST` para alta, `PATCH` para edición) que en la práctica hacen
LO MISMO (mismo body, mismo `upsert` de Prisma sobre el `@@unique`
compuesto `customer_id_product_id`).

### D3 — `GET /v1/me/reviews/:productId` separado del `PUT`, para resolver AC-6/AC-7 sin adivinar

La FE necesita saber, ANTES de mostrar el formulario: ¿el cliente es
elegible? ¿ya tiene una reseña (para pre-llenar en vez de crear)? Un único
endpoint `{ eligible: boolean, review: ReviewDto | null }` responde ambas
preguntas con una sola llamada. Alternativa descartada: inferir elegibilidad
de un 403 al intentar el `PUT` — obligaría a la FE a "probar y fallar" para
decidir si mostrar el control, un antipatrón de UX (el AC-6 pide que el
control ni siquiera aparezca).

### D4 — Reseña oculta: `hidden_at` (soft-flag), nunca se borra ni se edita el contenido

AC-8 exige transparencia hacia el autor ("sigue existiendo pero marcada
como oculta", no censura invisible). Mismo idioma que `Customer.deleted_at`/
`Order.anonymized_at` de este proyecto — un timestamp nullable, nunca una
fila borrada. `GET /v1/me/reviews/:productId` SIEMPRE devuelve la reseña
propia con su `hidden: boolean` real, sin importar el estado; `GET
/v1/products/:slug/reviews` (público) SIEMPRE filtra `hidden_at IS NULL` —
dos superficies con dos reglas de visibilidad distintas sobre la MISMA
fila, no una bandera "también visible para mí".

### D5 — `rating` validado en DTO (422) Y en DB (`CHECK`) — defensa en profundidad

`@IsInt() @Min(1) @Max(5)` en `UpsertReviewDto` (AC-9, mensaje claro). El
`CHECK (rating >= 1 AND rating <= 5)` en la migración es una segunda capa
—mismo criterio que el `CHECK` de `orders.anonymization_reason` (US-020/
US-021)— para que ningún camino futuro que escriba `reviews` sin pasar por
este DTO (un script, una migración de datos) pueda insertar un rating
inválido.

### D6 — FK de `reviews` a `customers`/`products`: `onDelete: Restrict` en ambas

Ni `Customer` ni `Product` se borran físicamente en este proyecto
(`Customer` se anonimiza con `deleted_at`, `Product` se archiva con
`status`) — mismo criterio que `OrderItem.product` (`onDelete: Restrict`).
**Gap cross-cutting señalado, no resuelto en esta US** (fuera de alcance —
ningún AC lo pide): cuando un cliente borra su cuenta (US-020), su
`customers.name`/`email` se anonimizan pero sus `reviews.customer_id` NO se
tocan — una reseña pública seguiría mostrando el nombre ANTERIOR si la FE
cachea el nombre en la fila en vez de resolverlo por join en cada lectura
(este backend resuelve `customer_name` por JOIN en `GET
/v1/products/:slug/reviews`, así que en la práctica el nombre SÍ se
actualiza a "Cuenta eliminada" tras el borrado — se documenta acá porque no
es obvio sin leerlo, no porque falte una fix).

## Persistence

```sql
CREATE TABLE "reviews" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "customer_id" uuid NOT NULL REFERENCES "customers"("id"),
  "product_id"  uuid NOT NULL REFERENCES "products"("id"),
  "rating"      integer NOT NULL,
  "comment"     text,
  "hidden_at"   timestamp(3),
  "created_at"  timestamp(3) NOT NULL DEFAULT now(),
  "updated_at"  timestamp(3) NOT NULL,
  CONSTRAINT "reviews_rating_check" CHECK ("rating" >= 1 AND "rating" <= 5),
  CONSTRAINT "reviews_customer_id_product_id_key" UNIQUE ("customer_id", "product_id")
);
CREATE INDEX "reviews_product_id_hidden_at_idx" ON "reviews"("product_id", "hidden_at");
```

Trivial — una tabla nueva, dos FK a tablas ya migradas, un `CHECK`, un
`UNIQUE` compuesto, un índice que cubre el filtro de la lista pública
(`product_id` + `hidden_at IS NULL`). No se invoca `data-architect` Mode B.

## API shape

```
GET /v1/me/reviews/{productId}   (auth)
→ 200 { eligible: true,  review: null }
→ 200 { eligible: true,  review: { id, rating, comment, hidden, created_at, updated_at } }
→ 200 { eligible: false, review: null }
→ 401 (sin sesión)

PUT /v1/me/reviews/{productId}   (auth)
{ rating: 4, comment: "Anduvo bien" }
→ 200 (crea o actualiza la MISMA reseña — AC-5)
→ 403 dsm:reviews/not-eligible (AC-6 — nunca compró el producto entregado)
→ 422 (rating fuera de 1-5, AC-9)

GET /v1/products/{slug}/reviews   (público)
→ 200 { average: 4.0, count: 3, data: [{ id, customer_name, rating, comment, created_at }, ...], pagination }
→ 200 { average: null, count: 0, data: [], pagination }  (AC-4, sin reseñas)
→ 404 (slug inexistente o producto no publicado — mismo criterio que la ficha)

PATCH /v1/admin/reviews/{id}   (admin)
{ hidden: true }
→ 200 (togglea hidden_at, AC-8)
→ 404 (id inexistente)
```

## Resilience / Observability

Sin llamadas salientes. Evento de negocio nuevo: `review.hidden`/
`review.shown` emitido por el admin toggle (mismo patrón que
`CatalogEventsService`/`AccountEventsService` — `entity_id` va al log,
nunca como dimensión de alta cardinalidad de la métrica).

## Deployment considerations

`Requires deployment-planner: no` — tabla nueva sin dato preexistente que
migrar, sin flag de feature, deploy estándar rolling.

## Non-AC declarations (F51 checklist)

- Rate-limit: el `GET` público reusa el throttler `storefront` YA existente
  (mismo controller, `StorefrontProductsController`) — no se agrega un
  throttler nombrado nuevo. `GET`/`PUT` de `/v1/me/reviews/*` NO llevan
  `@Throttle` propio — quedan bajo el techo default (ningún throttler
  nombrado los cubre, mismo criterio de "sin presupuesto especial" que
  cualquier ruta autenticada de bajo riesgo de esta API que no maneja un
  recurso escaso o irreversible).
- CORS/headers: sin cambios — controllers nuevos corren bajo el bootstrap
  global.
- Feature flags: ninguno.
