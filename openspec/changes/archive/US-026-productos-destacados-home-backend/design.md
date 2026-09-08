---
tracker-id: null
tracker-source: null
parent-us: US-026
discipline: backend
variant: null
language: es
---

# US-026 Backend — Design

## Context

`StorefrontModule` (US-002/US-003, extendido por US-025) gana un cuarto
import: `CheckoutModule` (para `OrdersRepository.mostSold` — nuevo método,
único punto de acceso a `orders`/`order_items`, §5). Dirección acíclica:
`CheckoutModule` no importa `StorefrontModule` de vuelta; `ReviewsModule`
YA importa `CheckoutModule` (diamante, no ciclo). `ProductsRepository` gana
un método nuevo de sólo lectura (`findRecentlyPublished`), sin tocar nada
existente.

## Decisions

### D1 — `mostSold` vive en `OrdersRepository`, no en `ProductsRepository`

Mismo criterio que `hasDeliveredOrderWithProduct` (US-025 D1): el query
lee `orders`/`order_items`, tablas de propiedad exclusiva de
`OrdersRepository` (§5). Que el resultado final sean "productos" no cambia
qué repositorio posee las tablas de origen — un método en
`ProductsRepository` que consultara `order_items` directamente duplicaría
el criterio de qué estados cuentan como "venta confirmada"
(`new|preparing|ready|delivered`, el mismo set que `ReportsRepository.
topProducts` ya usa).

### D2 — Query nuevo, NO se reusa `ReportsRepository.topProducts`

`topProducts` (US-016, admin-only) hace `SUM(quantity * unit_price_ars_cents)
AS revenue_ars_cents` y NO filtra por `products.status` — expone el ranking
completo incluyendo productos despublicados con revenue en ARS. Reusarlo
tal cual para una superficie pública violaría AC-7 (despublicados no deben
aparecer) y filtraría revenue del negocio a cualquier visitante anónimo.
`mostSold` es un método NUEVO: mismo `JOIN order_items+orders`, agrega
`SUM(quantity)` (sin revenue), agrega un tercer `JOIN products` para
filtrar `status='published'` y proyectar SOLO las columnas que
`StorefrontProductListItemDto.from()` necesita (`slug, name,
price_ars_cents, image_url, stock`) — nunca `sku`/`revenue`/`id` interno
más allá del tie-break.

### D3 — Orden de registro de rutas: estáticas antes que `:slug`

`GET /v1/products/novedades` y `GET /v1/products/mas-vendidos` son rutas
de UN segmento, igual que `GET /v1/products/:slug`. Express (adapter HTTP
de Nest) resuelve rutas de igual especificidad en el ORDEN en que se
registraron — no prioriza automáticamente lo estático sobre lo dinámico.
Se registran `novedades`/`mas-vendidos` ANTES que `getBySlug` en
`StorefrontProductsController` para que un visitante que pida
`/v1/products/novedades` llegue al handler nuevo, no a un intento fallido
de `getPublishedProduct('novedades')`. Verificado con un test de
integración explícito (T-verify de la ruta real, no sólo lectura de
código).

### D4 — Respuesta `{data: [...]}` sin `pagination`

Las dos rutas son un top-N fijo (siempre `LIMIT 8`, sin offset/página
siguiente) — un objeto `pagination` sería un campo muerto que ningún
consumidor usaría. Se devuelve `{data: StorefrontProductListItemDto[]}`,
mismo nombre de campo (`data`) que el resto de las respuestas de lista de
esta API para mantener la forma reconocible, sin el resto del envelope de
paginación.

### D5 — `@StorefrontCache` explícito con el MISMO TTL del default

El NFR §9 de la US pide caché — mismo `maxAge:60/swr:30` que el resto de
`/v1/products/*` (a diferencia de reseñas, US-025, que deliberadamente NO
cachea). La lección de PR #139 no es "bajar el TTL a cero por default": es
"declarar el TTL explícito en cada ruta nueva, para que la decisión sea
visible y no un accidente de herencia". Acá el valor explícito coincide
con el default — eso es correcto, no redundante: si mañana el default de
la clase cambia por otra razón, esta ruta no se entera sin que alguien lo
decida a propósito.

## Persistence

Sin migración — ambos queries leen tablas existentes
(`products`/`orders`/`order_items`). Sin índice nuevo: a la volumetría
declarada por la US (catálogo ~100-1000 productos, `LIMIT 8`), un
`ORDER BY created_at DESC`/`GROUP BY product_id` sin índice dedicado es
sub-milisegundo — no amerita invocar `data-architect` Mode B.

## API shape

```
GET /v1/products/novedades
→ 200 { data: [{ slug, name, price_ars_cents, currency, image_url, in_stock }, ...] }
  (hasta 8, created_at desc, tie-break id asc; [] si no hay publicados)

GET /v1/products/mas-vendidos
→ 200 { data: [...] }
  (hasta 8, cantidad vendida desc sobre órdenes confirmadas, tie-break id asc;
   [] si no hay ventas confirmadas o no hay publicados)
```

Ambas SIEMPRE 200 (nunca 404) — son agregados, no un recurso por id; el
FE decide ocultar la sección cuando `data` está vacío (AC-4/AC-5).

## Resilience / Observability

Sin llamadas salientes. Sin evento de negocio nuevo — son lecturas
públicas agregadas, mismo criterio que `GET /products/:slug/reviews`
(US-025): no emiten evento propio, el log HTTP estándar alcanza.

## Deployment considerations

`Requires deployment-planner: no` — sin migración, sin flag de feature,
deploy estándar rolling.

## Non-AC declarations (F51 checklist)

- CORS/headers: sin cambios.
- Rate-limit: mismo throttler de clase (`storefront`) que el resto del
  controller — sin presupuesto nombrado propio (son lecturas públicas de
  bajo costo, `LIMIT 8`).
- Feature flags: ninguno.
