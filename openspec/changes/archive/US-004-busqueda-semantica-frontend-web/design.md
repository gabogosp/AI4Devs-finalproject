# US-004 frontend-web — Diseño

> Lo que este documento **hereda y no re-decide**: `design-e2e.md` §6 (el componente
> `SearchBar + resultados` del contenedor web), §17 (presupuestos de latencia), §18
> (observabilidad), y `design-system.md` §7.12 (`SearchExperience`), §10.1 (loading/empty) y
> §10.2 (voz y tono). El contrato `GET /v1/search` es del backend hermano y **no se discute
> acá**; se consume.

## D1 — La URL es el estado de la búsqueda

`/buscar?q={consulta}` con la página como Server Component que lee `searchParams`.

**Por qué**: hace la búsqueda compartible, recargable y navegable con el botón atrás sin una
sola línea de estado global. La alternativa —estado en el cliente, resultados por `fetch` en
un `useEffect`— pierde las tres cosas y, además, deja la página vacía en el HTML servido.

**Consecuencia deliberada**: cada búsqueda es una navegación. Con OQ-FE-1 cerrado (sin
dropdown en vivo) eso es exactamente lo que se quiere: una búsqueda = un submit = un request.

## D2 — SSR con `noindex, follow` (OQ-FE-2)

Los resultados salen en el HTML del servidor; el `metadata` de la ruta declara
`robots: { index: false, follow: true }`.

- **Servidor y no cliente**: la premisa del ticket FE es que el contenido no dependa de JS.
  Además `AddToCartButton` y el tracker ya son hojas cliente: el resto no necesita serlo.
- **`noindex`**: una página de resultados por consulta es contenido delgado y duplicado; que
  Google la indexe canibaliza a las fichas y a las categorías, que sí son los activos
  indexables. **`follow`** sí, para que los enlaces a las fichas transmitan.
- **Sin `sitemap`, sin `JsonLd`**: no se le pide a un buscador que entienda una página que se
  le pidió no indexar.

## D3 — El único `loading.tsx` de todo `(storefront)`, y por qué acá sí

El resto del storefront **no tiene** `loading.tsx` por una razón dura (US-003 `design.md` D1.bis,
gap F59): la boundary de Suspense transmite el shell con el status **200 ya comprometido**, y
eso vuelve imposible un `notFound()` real — el soft-200 indexable que US-002 AC-9 prohíbe.

En `/buscar` esa objeción **no aplica y el beneficio sí**:

- la ruta **nunca** llama a `notFound()`: una consulta siempre produce una página (con
  resultados, con reserva, sin señal o degradada);
- el 200 es el status correcto en los cuatro casos;
- y §10.1 pide **skeleton, no spinner** mientras se busca — que es justamente lo que un
  `loading.tsx` da gratis durante la navegación.

Queda acotado al segmento `buscar/`. Ponerlo un nivel arriba rompería el 404 de la ficha, que
ya está en producción.

## D4 — Caché: `revalidate: 60` + el `CATALOG_TAG` que ya existe

```ts
const searchCache = () => ({
  next: { revalidate: 60, tags: [CATALOG_TAG] },
});
```

- **60 s** es el mismo `max-age` que el contrato declara para el endpoint: el frontend no
  inventa una política, la respeta.
- **El tag del catálogo se reusa** (importado de `categoriesStorefrontService`, única fuente
  del literal): así, cuando el panel invalida el catálogo tras un alta o un import masivo, la
  búsqueda también se refresca. Un tag propio obligaría a acordarse de invalidar dos cosas, y
  olvidarse de una deja la búsqueda mintiendo con precios viejos.
- **No `no-store`**: con `no-store` cada tecla del cliente llegaría al origen y a la cuota del
  proveedor de IA. El contrato es explícito al respecto.

## D5 — La respuesta se modela como cuatro estados de presentación, no como cuatro banderas

El contrato trae tres campos ortogonales (`confidence`, `degraded`, `fallback`), pero la
pantalla tiene que decidir **un** relato. La derivación es una función pura, testeable sin
render:

| Estado | Condición | Qué muestra |
|---|---|---|
| `conSenal` | `confidence: high` | Interpretación visible + grilla. Sin advertencias |
| `conReserva` | `confidence: low` y hay `results` | Aviso honesto («no estamos seguros») + grilla + salida a rubros. **Nunca presentados como certeza** — es el estado más común con el catálogo recién enriquecido (§7.12) |
| `sinSenal` | `results` vacío | Estado vacío afirmativo + rubros sugeridos (AC-3). Nunca un «0 resultados» desnudo |
| `degradado` | `degraded: true` | Se superpone a los anteriores: banner de «buscamos por texto» + el resto igual (AC-4) |

`degraded` es **ortogonal** a propósito: una respuesta degradada igual puede traer resultados
útiles, y tratarla como error sería romper la navegación que AC-4 pide preservar.

**`score` no se muestra.** Un 0.42 no significa nada para quien compra un taco Fischer y
expone la mecánica del ranking. El orden ya comunica la relevancia.

## D6 — `SearchResultCard` propio, y no `ProductCard`

`ProductCard` recibe `StorefrontProductListItem`, que **requiere `currency`** — un campo que
`SearchResult` no tiene. Reusarlo obligaría a fabricar ese valor en el cliente, o sea a
inventar datos del contrato, que es exactamente lo que `frontend-standards` §3.1 prohíbe.

Entonces: tarjeta propia que **reusa las piezas** (`ProductImage`, `formatArs`,
`AddToCartButton`) y comparte la jerarquía visual de §7.3 (imagen → nombre → precio →
disponibilidad). Lo único que cambia es de dónde vienen los datos.

**El cambio en `ProductImage`**: hoy exige `categoryName` para el `alt` (`{name} — {categoría}`),
y un resultado de búsqueda no trae categoría (`interpreted_as` es del nivel de la respuesta,
no del ítem). Se vuelve **opcional**: sin ella el `alt` es el nombre del producto. Es aditivo,
no cambia ninguna llamada existente y lleva su propio test. La alternativa —pasar
`interpreted_as` como si fuera la categoría del producto— pondría en el `alt` de una imagen
una frase que describe la búsqueda, no el producto: peor para quien usa lector de pantalla.

## D7 — AC-5 se ataja en el cliente, sin dejar de manejar el 422

`queryGuard.ts` normaliza igual que el servidor (trim + colapso de espacios) y decide si hay
al menos 2 caracteres útiles.

- **En el cliente**: si no los hay, el `SearchBar` **no navega** y muestra la invitación a
  describir la necesidad. Ese es el corazón de AC-5: la búsqueda costosa no se ejecuta.
- **En el servidor igual**: la página se puede alcanzar con `?q=a` escrito a mano, así que
  la misma función decide antes de llamar al servicio. Sin el guard del servidor, AC-5 se
  cumpliría sólo para quien usa el formulario.
- **Y el 422 se maneja igual**: la validación del cliente no vuelve imposible el 422 (el
  servidor tiene su propio `SEARCH_MIN_LENGTH`, que puede diferir), así que
  `searchErrorCopy` lo cubre. Asumir que un guard del cliente hace inalcanzable un error del
  servidor es cómo se construye una pantalla que muestra un error crudo el día que alguien
  cambia una variable de entorno.

## D8 — Nada del texto del cliente se interpola como HTML (AC-8)

El eco de la consulta (`Resultados para: "…"`) se renderiza como texto en JSX; React escapa
por defecto y esta feature no usa ninguna de las vías que se saltean ese escape. Hay un test
que lo fija: una consulta con `<img src=x onerror=…>` aparece **literal** y
`container.querySelector('img')` es `null`.

AC-8 es estructural del lado del servidor —el texto sólo produce un embedding y un `tsquery`
parametrizado, nunca llega a un modelo generativo— y del lado del cliente se sostiene con esa
sola regla: el texto es dato, no markup.

## D9 — Observabilidad: cuatro eventos, cero texto de consulta (OQ-FE-5)

| Evento | Propiedades | Por qué |
|---|---|---|
| `search_performed` | `confidence`, `degraded`, `results_count`, `query_length` | Mide el KPI del producto por su lado observable: cuántas búsquedas salen con señal y cuántas degradadas |
| `search_result_clicked` | `position`, `confidence` | La posición del clic es la señal de relevancia real. Si los clics caen siempre en el puesto 4, el ranking está mal aunque el arnés pase |
| `search_fallback_clicked` | `category_slug` | Mide si la red de seguridad de AC-3 salva la visita o el cliente se va |
| `search_rate_limited` | `retry_after_seconds` | AC-10 desde el lado del cliente: si aparece seguido, el tope está mal calibrado |

**El texto de la consulta no viaja en ninguno.** Es entrada libre: alguien pega su email o su
teléfono en el input y el volcado de telemetría se convierte en un registro de PII
(`observability-standards` §9). Medir *qué* busca la gente es valioso para decidir el
catálogo, pero eso lo hace el backend, que ya tiene el texto y puede agregarlo con su propia
retención.

`search_result_clicked` se resuelve con **un** client leaf que escucha por delegación sobre la
grilla y lee `data-position` del `[data-search-result]` más cercano. Alternativa descartada:
volver cliente cada tarjeta, que rompería el SSR de los resultados por un evento.

## D10 — A11y: lo que axe no puede ver

- `<form role="search">` con el input etiquetado (label visible en la página de resultados,
  `aria-label` en el header) y `type="search"`.
- **La cantidad de resultados se anuncia** en una región `aria-live="polite"`: sin eso, quien
  usa lector de pantalla no sabe si la búsqueda trajo 2 o 40 (§7.12).
- **El foco va al encabezado de resultados** tras la navegación, no se queda en el input del
  header.
- El aviso de degradado y el de baja confianza son **texto**, no color (§7.7 / WCAG 2.1 AA).
- «Sin stock» es texto en la tarjeta, con el control de compra **ausente** y no deshabilitado:
  un botón deshabilitado es un anzuelo que el lector de pantalla igual anuncia.

## Desviaciones declaradas del design-system (ratificadas por el PO)

| §7.12 pide | Este change | Motivo |
|---|---|---|
| Dropdown de sugerencias en vivo | **No** (OQ-FE-1) | El backend no tiene autocompletado; un dropdown por tecleo contradice el rate-limit que protege la cuota del proveedor |
| Vista full-screen en mobile | **No** (OQ-FE-3) | El submit ya navega a una página propia; el overlay agrega máquina de foco y trampa de teclado con beneficio marginal |
| Chip «sugerido / match alto» | **No** (marcado «opcional» en §7.12) | Sin `score` visible, un chip de match alto es la misma información sin la métrica: se prefiere que el orden hable |

## Standards consultados

- `frontend-standards.md` §3.1-§3.3 (tipos derivados del contrato, servicio hand-written),
  §6 (escape de contenido), §8 (mutator único), §10 (testing).
- `frontend-next-standards.md` §2 (`'use client'` en las hojas), SSR y metadata por ruta.
- `design-system.md` §7.3, §7.7, §7.12, §10.1, §10.2.
- `design-e2e.md` §6, §17, §18.
- `observability-standards.md` §9 (PII fuera de la telemetría).
- `testing-standards.md` §14.9 (negative space).
