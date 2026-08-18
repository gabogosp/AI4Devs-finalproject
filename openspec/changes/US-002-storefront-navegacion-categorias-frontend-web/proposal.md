---
tracker-id: null
tracker-source: null
parent-us: US-002
discipline: frontend-web
variant: null
language: es
---

# US-002 Frontend Web — Navegación pública por categorías (SSR/SEO)

> **Superficie**: el storefront gana su **navegación**. US-003 entregó la hoja (la ficha de
> producto); este change entrega el **árbol** que lleva hasta ella —home con rubros, páginas de
> rubro y subrubro, grilla paginada— y los artefactos de sitio que hacen que un buscador lo
> recorra entero (sitemap, robots, breadcrumbs).
>
> **No re-arquitectura nada.** El contrato del backend hermano ya está publicado y su cliente
> tipado **ya está generado y commiteado**; el namespace de URLs lo fijó **ADR-0010** (`Accepted`);
> el sustrato HTTP, de caché, de formato, de observabilidad y de E2E lo dejó US-003. Este change
> **consume** todo eso y agrega lo que falta.

## Why

El browse por categoría es, según el PRD §1.2/§1.4, la vía por la que "a DSM se la encuentra en
Google" — y la red de seguridad del descubrimiento cuando la búsqueda IA (US-004) no alcanza.
Hoy el storefront tiene **una sola página pública** (`/productos/{slug}`, US-003) y una home que es
un stub declarado `Deferred: US-002`. Un visitante que llega a una ficha no tiene por dónde seguir,
y un buscador que llega a la raíz no encuentra ningún camino al catálogo: no hay links de
categoría, no hay sitemap y no hay robots.txt. El activo de SEO que la US-003 construyó está, en la
práctica, **desconectado**.

El backend de US-002 ya cerró su parte (18/18) y publicó tres operaciones públicas sin auth:
`storefrontListCategories` (árbol de dos niveles, TTL 300 s), `storefrontGetCategory` (detalle con
`parent` para el breadcrumb y `children`, 404 real para slug inexistente) y
`storefrontListCategoryProducts` (paginado offset, envelope `{ data, pagination }`, sólo
publicados, con un rubro **agregando** los productos de sus subrubros). El cliente tipado, los
schemas Zod y los mocks MSW ya están generados desde ese contrato y commiteados en
`apps/web/src/api/generated/`.

Lo que falta —y es lo que entrega este change— es la **superficie pública que lo consume**: páginas
server-rendered e indexables, con paginación linkeable, breadcrumb, estado vacío accionable, y un
circuito de invalidación de caché que garantice que un producto archivado desaparece del listado
**ya**, no cuando venza un TTL. Ese último punto es la decisión de diseño de mayor valor del change
y se explica en `design.md` D2: US-003 dejó la invalidación resuelta **para la ficha**
(`product:{slug}`), pero un listado de categoría cachea los mismos datos por otra ruta — sin
extender el circuito, AC-8 ("borradores y archivados no se exponen") queda cumplido en el backend y
**roto en la caché del frontend**.

## What changes

- **Servicio de categorías del storefront** (`categoriesStorefrontService`) sobre el cliente
  generado: árbol, detalle y listado paginado, validados en el borde con los Zod generados y con la
  política de caché declarada en el servicio (tag **`catalog`** + safety-net).
- **Circuito de invalidación del catálogo** (`revalidateCatalog`): Server Action que purga la Data
  Cache tageada, la Full Route Cache de **todas** las páginas de categoría y el sitemap. Se engancha
  en el puente que el panel **ya invoca** en cada mutación de producto (`revalidateProductSafely`) y
  se agrega al alta/edición de categorías, de modo que ninguna mutación futura pueda olvidarlo.
- **Home pública real** en `/`: claim + grilla de rubros con sus subrubros (links indexables), que
  reemplaza el stub de US-003.
- **`CategoryNav` en el layout `(storefront)`**: barra de rubros presente en toda superficie
  pública (incluida la ficha), Server Component sin JavaScript de cliente, con **degradación**
  explícita si el árbol no responde (la nav se degrada; la página **no** cae).
- **Página de categoría** `/categorias/{slug}`: breadcrumb con `parent`, subrubros, grilla paginada
  de productos (`ProductCard`), estado vacío accionable, **404 real** para slug inexistente.
- **Paginación server-side** por `searchParams` (`?page=N`): linkeable, indexable y sin recargar el
  catálogo completo (nunca se piden más de 20 ítems por request).
- **SEO de sitio**: `app/sitemap.ts` (home + rubros + subrubros + fichas de producto) y
  `app/robots.ts` (`Disallow: /admin/`, puntero al sitemap) — el `Deferred: US-002` explícito que
  dejó US-003. Metadatos por categoría, canonical auto-referencial por página, `rel=prev/next`, y
  JSON-LD `BreadcrumbList`.
- **Breadcrumb en la ficha**: se cierra el `Deferred: US-002 — breadcrumb con link` que US-003 dejó
  en `ProductDetail` (con el alcance que el contrato permite hoy — ver OQ-FE-11).
- **Observabilidad**: evento público `category_shown` (sin PII), en la misma línea que `pdp_shown`.
- **E2E**: extensión del stub de contrato con los tres endpoints de categorías + `__reset` con
  alcance (para que los specs que mutan dejen de pisarse entre workers paralelos), specs de SSR,
  404 real, paginación e invalidación del catálogo — **todos asertando sobre `response.status()` y
  sobre el body del servidor**, nunca sobre el DOM hidratado.

## ACs de US-002 cubiertos (superficie FE)

| AC | Qué entrega este change | Nota |
|---|---|---|
| **AC-1** entrar a un rubro (subrubros y/o productos, URL por slug) | Home con rubros, `/categorias/{slug}`, `CategoryNav` | el árbol lo sirve el BE |
| **AC-2** rubro → subrubro + volver al padre | Breadcrumb desde `parent` + links de subrubro | `parent` viene del contrato |
| **AC-3** grilla con nombre/precio/imagen/disponibilidad, paginada, enlaza a la ficha | `ProductCard` + `Pagination` + link a `/productos/{slug}` | el item ya trae `slug` |
| **AC-4** indexable: SSR + metadatos + **sitemap** | `generateMetadata`, `sitemap.ts`, `robots.ts`, JSON-LD | medición SEO end-to-end → `QA-US-002` |
| **AC-5** sin stock visible, no comprable | Badge "Sin stock" en la card; **ninguna** card ofrece comprar (el carrito es US-007) | ver D8 |
| **AC-6** categoría vacía → estado vacío navegable | Estado vacío §10.1/§10.2 con links a otros rubros | |
| **AC-7** catálogo grande sin degradación | Paginación server-side (máx 20 ítems/request), imágenes `lazy` con `sizes` de grilla | la **medición** de CWV con ≥5.000 SKUs es `QA-US-002` |
| **AC-8** draft/archivado nunca en listados públicos | **Circuito de invalidación del catálogo** (D2) | el filtro `published` es del BE; acá se garantiza que la caché no lo sobreviva |
| **AC-9** categoría inexistente → 404 real | `notFound()` + prohibición de `loading.tsx` en `(storefront)` (D10) | |
| **AC-10** contenido server-rendered | Server Components en toda la ruta; cero fetch de datos en cliente | verificado sobre el body de la respuesta |

## Out of scope

- **Búsqueda / SearchBar / top-nav completo con carrito** → US-004 / US-007. El `CategoryNav` de
  este change es la barra de rubros, no el top-nav del design-system §7.10 completo.
- **`/productos` como grilla global del catálogo** → **no hay endpoint público que la sirva** y
  ningún AC de US-002 la pide (ver OQ-FE-7). El espacio `/productos/{slug}` sigue siendo la ficha.
- **Filtros y ordenamientos** (marca, precio, atributo) → PRD §2.2 roadmap.
- **CTA "Agregar" desde la card** → `Deferred: US-007` (el carrito no existe; ver D8).
- **Medición numérica de Core Web Vitals / Lighthouse / carga con ≥5.000 SKUs, BDD de aceptación,
  recorrido por teclado end-to-end, indexación real en Search Console** → `QA-US-002` (ya
  planificado, 5.1–5.5).
- **Cambios de contrato, de esquema o del comportamiento del backend.** Si falta un dato, se
  registra como open question y se coordina — nunca se edita `openapi.yaml` desde el FE.
- **Re-litigar el namespace de URLs**: ADR-0010 está `Accepted` y se hereda.
- **Persistencia**: ninguna. Este change no introduce tablas, columnas, storage local ni estado
  persistido en el cliente.

## Standards consultados

- `docs/base-standards.md` — KISS/YAGNI, vocabulario prescriptivo, §2.4 idioma.
- `docs/code/frontend-standards.md` — §2.1 package-by-feature, §3.1/§3.2/§3.3 (artefactos del
  contrato **siempre generados**; sólo la lógica de servicio es hand-written), §5 taxonomía de
  errores, §7 observabilidad, §8 cliente único, §11.3/§11.5/§11.9, §12.1/§12.3/§12.4.
- `docs/code/frontend-next-standards.md` (overlay `stacks.web.framework: nextjs`) — §1 segmentos y
  archivos colocados, §2 Server Components por default, §3 caché explícita + `revalidateTag`/
  `revalidatePath`, §4 Server Actions, §6 Metadata API + `next/image`, §7 presupuestos, §8 env,
  §8.bis headers, §9 E2E contra build, §10 anti-patterns.
- `docs/architecture/api-standards.md` — §5.5 dinero en centavos, §6.1/§6.3 envelope y paginación
  offset, §8 RFC 7807.
- `docs/cross-cutting/security-standards.md` — §6 output encoding (JSON-LD es el único
  `dangerouslySetInnerHTML` admitido).
- `docs/quality/testing-standards.md` §14 · `docs/quality/qa-frontend-standards.md` §19, §23.
- `docs/ai/documentation-standards.md` §8.1 (disparadores de ADR), §11.1 (README).
- `docs/product/design-system.md` `Approved` — §4 (grilla 2/3/4 columnas), §4.1 (mobile-first),
  §4.2 (containers), §7.3 (ProductCard, jerarquía de lectura), §7.4 (PriceTag), §7.7 (badge de
  stock con **texto**), §7.10 (CategoryNav "load-bearing para SEO"), §8.1 (`sizes` por contexto,
  fallback `package`), §10.1/§10.2 (estados y copy), §11 (WCAG 2.1 AA).

## Open questions

> Convención: `[Decidido por el plan — ratificar]` significa que `design.md` **ya eligió** una
> opción para que el plan sea ejecutable, y que el usuario puede revertirla antes de
> `/develop-frontend-web` sin costo. `[Open]` significa que necesita respuesta antes de ejecutar la
> task que la toca.

- **OQ-FE-7 — ¿`/productos` (grilla global del catálogo) entra en US-002?**
  `[Resolved: 2026-08-17 — NO entra]` Ratificado por el usuario: no existe endpoint público que liste todos los productos y ningún AC la pide; agregarla abriría un change de backend por una página que nadie pidió.
  El brief de ADR-0010 proyectaba que US-002 tomaría `/productos` como grilla. Al leer el contrato
  publicado, **no existe endpoint público que liste todos los productos**: sólo
  `GET /v1/categories/{slug}/products`. Y ningún AC de US-002 pide una grilla global — AC-1/AC-2/
  AC-3 son todos **por categoría**.
  - **(A) No entra** *(recomendada)*: el punto de entrada es `/` (rubros) → `/categorias/{slug}`.
    Cero coordinación con backend, cero alcance nuevo, y `/productos/{slug}` (la ficha) queda
    intacto. `/productos` sin slug simplemente no es una ruta.
  - **(B) Entra, con endpoint nuevo**: pedirle al backend `GET /v1/products` paginado. Abre un
    change de backend, un ciclo de contrato y una página que ningún AC exige.
  - **(C) Entra como alias**: `/productos` redirige 308 a `/`. Barato, pero inventa una URL
    canónica duplicada que después hay que sostener.
  **Recomendación**: (A). Si el dueño quiere "ver todo el catálogo", la home ya lista todos los
  rubros y cada uno agrega sus subrubros — la cobertura de navegación es completa sin la página.

- **OQ-FE-8 — Alcance del sitemap (AC-4): ¿sólo categorías, o también fichas de producto?**
  `[Resolved: 2026-08-17 — categorías + fichas]` Ratificado por el usuario.
  AC-4 sólo exige que **la página de categoría** quede en el sitemap. Incluir las fichas es más
  fuerte para el objetivo de negocio, pero cuesta: no hay endpoint "todos los productos", así que
  hay que recorrer las categorías hoja y paginarlas (≈50 requests a 5.000 SKUs, en paralelo, dentro
  de la regeneración del sitemap).
  - **(A) Sólo categorías + home**: 1 request. Las fichas se descubren por los links de la grilla
    (que existen y son indexables). Cumple AC-4 literal.
  - **(B) Categorías + fichas** *(recomendada)*: recorrido de categorías hoja con `Promise.all` y
    `limit=100`. Las páginas de conversión entran explícitamente al índice; el costo se paga una vez
    por invalidación (el sitemap está tageado `catalog`), no por visita.
  - **(C) `generateSitemaps` (sitemap index particionado)**: la respuesta correcta a 50.000+ URLs;
    a 5.000 SKUs es complejidad sin beneficio.
  **Recomendación**: (B), con el disparador documentado para migrar a (C) si el catálogo crece un
  orden de magnitud. Si el usuario prefiere minimizar riesgo de latencia en la primera generación,
  (A) es una degradación legítima y la task cambia en una función.

- **OQ-FE-9 — Página fuera de rango (`?page=99` en una categoría con 3 páginas).**
  `[Resolved: 2026-08-17 — 404 real]` Ratificado por el usuario.
  - **(A) 404 real** *(recomendada)*: coherente con el criterio que el backend ya adoptó para AC-9
    ("nunca un 200 vacío que genere una página fantasma indexable"). Una página 4 que no existe es
    exactamente eso.
  - **(B) 200 con estado vacío**: más suave para un humano que tipeó mal, pero crea páginas
    indexables sin contenido — el problema que AC-9 existe para evitar.
  - **(C) Redirect 308 a la última página válida**: amable, pero requiere conocer `total` antes de
    decidir y multiplica URLs equivalentes.
  **Recomendación**: (A). Un `?page=abc` malformado **no** es lo mismo: se normaliza a la página 1
  (200) y el canonical apunta a la URL limpia.

- **OQ-FE-10 — Granularidad del tag de invalidación del catálogo (la decisión de mayor valor).**
  `[Resolved: 2026-08-17 — tag grueso `catalog`]` Ratificado por el usuario. Detalle completo en `design.md` D2.
  - **(A) Tag grueso `catalog`** *(recomendada)*: todo fetch de listado/árbol/detalle lo lleva;
    cualquier mutación de producto o categoría lo purga. Correcto por construcción, sin mapeos
    derivados que puedan desincronizarse.
  - **(B) Tag por categoría `category:{slug}`**: purga quirúrgica, pero el panel tendría que
    derivar, para cada producto mutado, **su categoría, el rubro padre que la agrega y —si el
    producto cambió de categoría— también la anterior**. Tres derivaciones en el cliente, cada una
    un lugar donde AC-8 se rompe en silencio.
  - **(C) Sin invalidación de listados, sólo safety-net TTL**: lo más barato hoy y el bug de mañana
    — un producto archivado sigue visible en su categoría hasta que venza el TTL.
  **Recomendación**: (A). A esta escala (un solo dueño mutando, decenas de categorías, tráfico
  bajo) el costo de sobre-invalidar es un re-fetch de <300 ms; el costo de sub-invalidar es un AC
  negativo roto en producción. El disparador para migrar a (B) queda documentado.

- **OQ-FE-11 — El breadcrumb de la ficha no puede mostrar el rubro padre con el contrato actual.**
  `[Resolved: 2026-08-17 — opción A: cerrar el deferral de US-003 con `Inicio › categoría`]` Ratificado por el usuario: el breadcrumb de la ficha llega hasta su categoría, sin fetch extra en la página de conversión. El breadcrumb completo con rubro padre queda pendiente de que el contrato exponga `category.parent` — `Deferred: cuando backend lo publique (aditivo, no bloquea US-002); owner: FE + backend, revisit: al planificar la US que lo necesite`.
  `StorefrontProduct.category` expone `{ name, slug }` pero **no** su `parent`. Para pintar
  `Inicio › Refrigeración › Compresores › {producto}` en la PDP haría falta un segundo fetch
  (`storefrontGetCategory`) **en cadena** con el primero — un waterfall en la página que carga el
  presupuesto de LCP. Este change cierra el deferral de US-003 con el alcance que el contrato
  permite: `Inicio › {categoría}` con link, cero fetch extra.
  - **(A) Dejarlo así** *(recomendada para US-002)*: la ficha gana su link a la categoría; la
    cadena completa vive en la página de categoría, que sí la tiene.
  - **(B) Pedir al backend `category.parent` dentro de `StorefrontProduct`**: cambio aditivo y
    barato en el BE, cierra el breadcrumb completo sin waterfall. **Requiere un change de backend**
    — el FE no edita el contrato.
  - **(C) Segundo fetch en cadena en la PDP**: resuelve hoy, paga waterfall en la página de
    conversión. Rechazada.
  **Recomendación**: (A) ahora + abrir (B) como ítem de coordinación para el próximo change de
  backend que toque el storefront.

- **OQ-FE-3 (heredada de US-003)** `[Deferred: dato del cliente, no bloquea desarrollo — owner: PO/cliente, revisit: antes del primer deploy (US-019)]` Número real de WhatsApp. No
  bloquea: el estado vacío y la ficha usan el env con placeholder.

## References

- US: `docs/user-stories/US-002-storefront-navegacion-categorias.md` (AC-1…AC-10, §7 presupuesto
  FE 12–16 h, §8 diseño, §9 NFRs, §10 reglas de negocio).
- E2E: `docs/product/design-e2e.md` §6.1/§6.2 (componentes y storefront SSR), §8 (jerarquía de dos
  niveles), §17 (SEO/LCP < 2.5 s, p95 < 300 ms, sitemap), §18 (observabilidad).
- Contrato consumido (**no se modifica**): `apps/api/docs/api/openapi.yaml` —
  `storefrontListCategories`, `storefrontGetCategory`, `storefrontListCategoryProducts`; drafts en
  `openspec/changes/US-002-storefront-navegacion-categorias-backend/contracts/openapi/`.
- Change de backend hermano (cerrado 18/18): `openspec/changes/US-002-storefront-navegacion-categorias-backend/`
  (D1 agregación rubro→subrubros, D3 envelope offset, D5 TTL por endpoint, D4 `category.viewed`).
- Change de QA hermano: `openspec/changes/US-002-storefront-navegacion-categorias-qa/` — su B-1
  declara que la ejecución de la capa L3 espera exactamente a este change. Su **OQ-QA-2 queda
  resuelta**: el contrato publicado expone `slug` en el item de grilla, así que el enlace
  grilla→ficha es `/productos/{slug}` y X-1 (TC-215) no falla por diseño.
- Change FE precedente (sustrato reutilizado): `openspec/changes/US-003-ficha-producto-pdp-frontend-web/`
  (D1.bis `loading.tsx` → soft-200, D2 invalidación por tag, D3 cliente isomorfo, D10 stub de E2E).
- ADRs: **ADR-0010** (namespace de URLs — heredado, no se re-litiga), ADR-0001, ADR-0007.
  Ninguno nuevo se dispara (ver `design.md` §Decisiones — evaluación explícita).
- Skills: `openspec-workflow`, `fe-design-without-figma`, `openapi-client-codegen`,
  `frontend-resilience-patterns`, `msw-setup`, `playwright-stability`, `observability-patterns`.
