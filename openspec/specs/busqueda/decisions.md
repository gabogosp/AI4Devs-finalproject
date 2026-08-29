# Decisions — Búsqueda semántica con IA (CAP-2)

Decisiones de diseño tomadas por los changes archivados de esta capacidad. Detalle completo
en `openspec/changes/archive/US-004-busqueda-semantica-frontend-web/design.md`.

## La URL es el estado de la búsqueda

`/buscar?q={consulta}` como Server Component que lee `searchParams`, sin estado global. Cada
búsqueda es una navegación: compartible, recargable, navegable con el botón atrás. Con el
autocompletado descartado (OQ-FE-1), eso es exactamente lo que se quiere — una búsqueda = un
submit = un request. Alternativa descartada: estado en cliente + `fetch` en `useEffect`
(pierde las tres propiedades y deja la página vacía en el HTML servido).

## SSR con `noindex, follow`

Los resultados salen en el HTML del servidor (la feature no depende de JS más que en las hojas
cliente puntuales — `AddToCartButton`, el tracker de clics). `noindex` porque una página de
resultados por consulta es contenido delgado y duplicado que canibalizaría fichas y
categorías; `follow` para que los enlaces a las fichas sí transmitan.

## El único `loading.tsx` del `(storefront)`

El resto del storefront no tiene `loading.tsx` (US-003 `design.md` D1.bis, gap F59): la
boundary de Suspense compromete el status 200 y vuelve imposible un `notFound()` real. En
`/buscar` esa objeción no aplica — la ruta nunca llama a `notFound()`, una consulta siempre
produce una página — y el beneficio (skeleton durante la navegación, §10.1) es gratis.

## La respuesta se modela como cuatro estados de presentación, no como banderas sueltas

El contrato trae tres campos ortogonales (`confidence`, `degraded`, `fallback`); la pantalla
deriva **un** relato con una función pura y testeable sin render: `conSenal` / `conReserva` /
`sinSenal` / `degradado` (superpuesto a los anteriores). `degraded` es ortogonal a propósito:
una respuesta degradada igual puede traer resultados útiles, y tratarla como error rompería la
navegación que AC-4 pide preservar. `score` no se muestra — un número de similaridad no
significa nada para quien compra y expone la mecánica del ranking; el orden ya comunica la
relevancia.

## `SearchResultCard` propio, no `ProductCard`

`ProductCard` exige `StorefrontProductListItem` (requiere `currency`, campo que `SearchResult`
no trae) — reusarlo obligaría a fabricar ese dato en el cliente, contra `frontend-standards`
§3.1. La tarjeta propia reusa las piezas (`ProductImage`, `formatArs`, `AddToCartButton`) y la
jerarquía visual de §7.3. `ProductImage` gana un `categoryName` **opcional** (aditivo, no
rompe llamadas existentes): sin categoría, el `alt` cae al nombre del producto en vez de
inventar una frase que describe la búsqueda, no el producto.

## AC-5 se ataja en el cliente sin dejar de manejar el 422

`queryGuard.ts` normaliza igual que el servidor (trim + colapso de espacios) y corre en dos
puntos: en el `SearchBar` (no navega si no hay ≥2 caracteres útiles) y en la página (alcanzable
con `?q=a` escrito a mano). El guard del cliente no vuelve inalcanzable el 422 del servidor —
`SEARCH_MIN_LENGTH` puede diferir — así que `searchErrorCopy` lo sigue cubriendo.

## Observabilidad: cuatro eventos, cero texto de consulta

`search_performed`, `search_result_clicked` (posición del clic — señal real de si el ranking
funciona), `search_fallback_clicked`, `search_rate_limited`. El texto de la consulta no viaja
en ninguno — es entrada libre y el volcado de telemetría se volvería un registro de PII
(`observability-standards` §9); *qué* busca la gente lo mide el backend, que ya tiene el texto
y su propia retención. `search_result_clicked` se resuelve con un único client leaf que
escucha por delegación sobre la grilla, en vez de volver cliente cada tarjeta.

## Desviaciones conscientes registradas (ratificadas por el PO, 2026-08-23)

| Desviación de `design-system.md` §7.12 | Motivo |
|---|---|
| Sin dropdown de sugerencias en vivo (OQ-FE-1) | El backend no tiene autocompletado; un dropdown por tecleo contradice el rate-limit que protege la cuota del proveedor de embeddings. |
| Sin vista full-screen en mobile (OQ-FE-3) | El submit ya navega a una página propia; el overlay agrega máquina de foco y trampa de teclado con beneficio marginal. |
| Sin chip «sugerido / match alto» | Sin `score` visible es la misma información sin la métrica; se prefiere que el orden hable. |

## Referencias

- ADR-0002 (pgvector + HNSW) y ADR-0003 (Gemini `text-embedding-004`) gobiernan el lado
  backend de esta capacidad — se registran formalmente cuando se archive
  `US-004-busqueda-semantica-backend`.
- Design completo: `openspec/changes/archive/US-004-busqueda-semantica-frontend-web/design.md`
