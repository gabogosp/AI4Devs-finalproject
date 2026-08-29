# US-004 frontend-web — Búsqueda semántica: `SearchExperience`

> **Change**: `US-004-busqueda-semantica-frontend-web` · **US**: `docs/user-stories/US-004-busqueda-semantica.md`
> **Disciplina**: frontend-web (Next.js App Router) · **Autor**: frontend-web-developer (asistido por @gosp)
> **Fecha**: 2026-08-23 · **Estado**: Draft · **Estimado**: **6 h** AI-asistido / 12-18 h tradicional

## Por qué

La búsqueda semántica es **el diferenciador** del producto (PRD §1.1, capacidad #2 Must) y
la única capacidad con un KPI numérico propio (relevancia ≥ 70% en el top-5, PRD §1.4). El
backend está construido —`GET /v1/search` con degradación a full-text, contrato publicado en
`apps/api/docs/api/openapi.yaml`— y **no tiene una sola pantalla que lo use**: hoy el
`layout.tsx` del storefront lleva el comentario «El buscador del top-nav sigue siendo
`Deferred: US-004`».

Sin este change el diferenciador no existe para el cliente. Y no es «poner un input»: el
design-system lo llama **componente estrella** (§7.12) porque lo que hay que construir es un
flujo con cinco estados observables —resultados con señal, resultados con reserva, sin señal
con salida a categorías, degradado y consulta demasiado corta— donde cada uno tiene que
transmitir honestidad sobre lo que la IA entendió. Si esto se siente genérico, se desperdicia
la razón de ser del producto.

## Qué cubre

| AC | Qué exige del frontend |
|---|---|
| **AC-1** | La consulta en lenguaje natural devuelve candidatos ordenados por relevancia y cada uno enlaza a su ficha (`/productos/{slug}`) |
| **AC-3** | Nunca un «0 resultados» desnudo: cuando `confidence` es `none`, la pantalla ofrece los rubros de `fallback.suggested_categories` como salida |
| **AC-4** | `degraded: true` se hace **visible**: la búsqueda funciona, pero no es la semántica. Un 200 degradado no se trata como falla |
| **AC-5** | Una consulta vacía o muy corta **no gasta un request**: se ataja en el cliente y se invita a describir la necesidad |
| **AC-7** | Un resultado sin stock aparece marcado con texto y **sin** el control de agregar al carrito |
| **AC-8** | A nivel UX: el texto del cliente sólo viaja como parámetro de búsqueda; la pantalla nunca lo interpola como HTML ni lo ejecuta |
| **AC-10** | Un `429` se explica con el tiempo de espera, sin perder lo que el cliente escribió |

**No cubre** (y no es omisión): **AC-2** (la batería de relevancia ≥70% es un arnés de
backend/QA), **AC-6** y **AC-9** (que sólo aparezcan publicados y que un producto sin
embedding no rompa nada son invariantes del servidor; el frontend renderiza lo que el
contrato le da y no puede afirmarlas por su cuenta).

## Decisiones del PO tomadas antes de escribir el plan (2026-08-23)

| # | Pregunta | Decisión |
|---|---|---|
| **OQ-FE-1** | El dropdown de sugerencias en vivo del design-system §7.12 | **No se construye.** El backend no tiene endpoint de autocompletado: sólo `GET /search`, cuyo rate-limit es más estricto *precisamente* porque cada búsqueda no cacheada cuesta una llamada al proveedor. Un dropdown por tecleo contradice el diseño de costo del backend. **Desviación declarada** del design-system, candidata a una US futura con endpoint propio y barato |
| **OQ-FE-2** | SSR e indexación de `/buscar` | Resultados **renderizados en servidor** (la página funciona sin JS y es compartible por URL) + `robots: noindex, follow`. Indexarla generaría páginas delgadas y duplicadas que compiten con las fichas y las categorías, que son los activos indexables |
| **OQ-FE-3** | La vista full-screen de mobile (§7.12) | **No en esta entrega**: input que ocupa el ancho en mobile + página de resultados propia. El overlay agrega una máquina de foco y una trampa de teclado que hay que testear, con beneficio marginal cuando el submit ya navega a una página. **Desviación declarada** |
| **OQ-FE-4** | «Agregar al carrito» en los resultados | **Sí**, reusando `AddToCartButton` como la grilla de categoría. AC-7 ya prohíbe el control sin stock, igual que hoy |
| **OQ-FE-5** | Eventos | `search_performed`, `search_result_clicked`, `search_fallback_clicked`, `search_rate_limited`. **Sin el texto de la consulta nunca**: es entrada libre y un volcado de queries termina siendo un log con nombres y teléfonos que alguien pegó en el input. Medir *qué* se busca es valioso para decidir el catálogo, pero va por el backend, que ya tiene el texto y puede agregarlo con su propia retención |

## Qué se construye

`apps/web/src/features/search/`:

| Artefacto | Qué es |
|---|---|
| `searchService.ts` | Servicio hand-written sobre la operación generada `searchProducts` + `parseContract`; tipos **re-exportados** del modelo generado |
| `queryGuard.ts` | La regla de AC-5: normaliza y decide si la consulta merece un request |
| `searchErrorCopy.ts` | Copy de 422 / 429 / 503 / red, en el tono de §10.2 |
| `SearchBar.tsx` | Client leaf del header: `role="search"`, submit → `/buscar?q=…` |
| `SearchResults.tsx` | La composición: eco de la consulta, interpretación visible, grilla, y los cuatro estados de respuesta |
| `SearchResultCard.tsx` | Tarjeta de resultado (reusa `ProductImage`, `formatArs`, `AddToCartButton`) |
| `SearchFallback.tsx` | La red de seguridad de AC-3: los rubros sugeridos como enlaces |
| `SearchSkeleton.tsx` | El «buscando…» de §10.1 — skeleton, no spinner |
| `SearchTracker.tsx` | Client leaf de observabilidad (los cuatro eventos) |

Rutas: `app/(storefront)/buscar/page.tsx` + `loading.tsx`, y el `SearchBar` montado en
`app/(storefront)/layout.tsx` (reemplaza el `Deferred: US-004`).

Se toca **un** componente compartido: `ProductImage` gana `categoryName` **opcional**, porque
un resultado de búsqueda no trae categoría y hoy el `alt` la exige. Es aditivo y con test
propio.

## Estado del contrato, y una discrepancia que importa

El contrato canónico (`apps/api/docs/api/openapi.yaml`, el que consume `orval`) ya tiene
`searchProducts` y `SearchResponse` completos. El backend está **21/36 en vuelo por otra
sesión**, pero eso no bloquea: este plan se construye contra el contrato publicado y el
cliente se genera de ahí.

**El `search.yaml` del change de backend está marcado `1.0.0-draft` y difiere del canónico en
dos puntos**: en el canónico un `limit` fuera de rango **se acota en silencio** (el draft
decía 422) y `image_url` es requerido-nullable en `SearchResult`. Este plan usa el **canónico**,
que es lo que el server implementa y lo que el codegen lee. Queda anotado para que nadie
planifique sobre el draft.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| **La caché de Next sirviendo resultados viejos** | El servicio usa `revalidate: 60` (el mismo `max-age` que declara el contrato) **y** el `CATALOG_TAG` que ya existe: una invalidación del catálogo también refresca la búsqueda, sin inventar un tag nuevo |
| **El codegen pisando trabajo de otra sesión** | Pre-requisito P2: no se corre `codegen` si la otra sesión está a mitad de un cambio de contrato; el gate `frontend-codegen-fresh` de CI lo detecta igual |
| **`confidence: low` presentado como certeza** | Es el estado **más común** con el catálogo recién enriquecido (§7.12) y tiene su propio test: se muestran los candidatos con aviso honesto, nunca como resultado seguro |
| **Que el catálogo no tenga vectores todavía** | US-005 está construido pero **sin `GEMINI_API_KEY`**: hasta que se cargue, toda respuesta real vendrá `degraded` o sin señal. El plan lo asume: los cinco estados se prueban con MSW contra el contrato, no contra un catálogo embebido |
