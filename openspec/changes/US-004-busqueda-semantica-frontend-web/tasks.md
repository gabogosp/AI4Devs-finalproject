# US-004 frontend-web — Tasks

> **Change**: `US-004-busqueda-semantica-frontend-web` · **Ejecuta**: `/develop-frontend-web US-004`
> **Estimado**: **6 h** AI-asistido (la US §7 presupuesta FE-US-004 en 8-12 h; el readme §6
> ticket 2 en 12-18 h tradicional) · **14 tasks** + 4 pre-requisitos
> **Contrato**: `apps/api/docs/api/openapi.yaml` → `searchProducts` / `SearchResponse`
> (el `search.yaml` del change de backend está `1.0.0-draft` y **difiere**: no se planifica
> sobre él — ver `proposal.md`)

## Trazabilidad: AC → task

| AC | Tasks |
|---|---|
| AC-1 resultados relevantes con enlace a la ficha | T0.2, T2.2, T2.3, T3.1 |
| AC-3 nunca un cero desnudo | T2.4, T2.3 |
| AC-4 degradación visible | T2.3 |
| AC-5 consulta corta sin request | T1.1, T2.1, T3.1 |
| AC-7 sin stock marcado y sin compra | T2.2 |
| AC-8 el texto no se ejecuta | T2.3 (test de escape) |
| AC-10 rate-limit explicado | T1.2, T2.3, T4.1 |
| a11y y SSR (transversales) | T5.1, T5.2 |

## Pre-requisitos

- [x] **P1 — El contrato canónico tiene `/search`.** Es lo que consume `orval`.
  - **Verify**: `grep -q "operationId: searchProducts" apps/api/docs/api/openapi.yaml && grep -q "SearchResponse:" apps/api/docs/api/openapi.yaml && echo OK`
- [x] **P2 — Ninguna otra sesión a mitad de un cambio de contrato.** El backend de US-004 está
  **21/36 en vuelo**: correr `codegen` sobre un `openapi.yaml` a medio editar genera un cliente
  que no compila y ensucia el árbol compartido.
  - **Verify**: `git status --porcelain -- apps/api/docs/api/openapi.yaml` vacío
- [x] **P3 — Baseline verde antes de tocar nada.** Para que un rojo posterior sea atribuible.
  - **Verify**: `pnpm --filter @dsm/web test` y `pnpm --filter @dsm/web typecheck`
- [x] **P4 — Las piezas que se reusan existen.** `ProductImage`, `AddToCartButton`,
  `formatArs`, `CATALOG_TAG`, `parseContract`, `track`.
  - **Verify**: `for f in src/features/storefront/ProductImage.tsx src/features/cart/AddToCartButton.tsx src/lib/format/currency.ts src/lib/http/contract.ts src/lib/observability/events.ts; do test -f apps/web/$f || echo "FALTA $f"; done` y `grep -q "CATALOG_TAG" apps/web/src/features/storefront/categoriesStorefrontService.ts`

## Fase 0: Contrato y servicio — 1 h


> **DRIFT RESUELTO (2026-08-23) — T0.1 cerrada.**
>
> El codegen trae `/search` correctamente (la operación, los modelos y el schema Zod: las tres
> primeras condiciones del `Verify` pasan). Lo que falla es la cuarta, `typecheck`, y **no por
> esta US**: el commit `9a62d38` (US-004 backend, contrato publicado) agregó `operationId` a
> operaciones del panel que antes no lo tenían, así que orval dejó de nombrarlas por path.
> `postAdminAuthLogin` pasó a `adminLogin`, `PostAdminAuthLoginResponse` a `AdminLoginResponse`,
> y así. El cliente commiteado en el repo quedó **anterior** a ese cambio, de modo que la
> inconsistencia ya existía: regenerar no la introdujo, la reveló.
>
> Efecto medido: **17 errores de tipos en 3 archivos** —`features/auth/adminSession.ts`,
> `features/categories/categoriesService.ts`, `features/products/productsService.ts`—, todos de
> la disciplina del panel (US-001), ninguno de búsqueda.
>
> **La regeneración se revirtió** para no dejar el árbol compartido roto: `typecheck` volvió a
> verde con el cliente viejo. Pero eso deja el drift vivo, y el gate `frontend-codegen-fresh`
> de CI lo va a marcar en cuanto alguien lo corra.
>
> **El PO decidió que lo absorbiera esta sesión.** Se aplicaron los 32 renombres —4 en
> `adminSession.ts`, 12 en `categoriesService.ts`, 16 en `productsService.ts`— alineando los
> consumidores con los nombres que el contrato ahora impone. Es alineación con la fuente de
> verdad, no un parche: el contrato manda y el código escrito a mano tenía que seguirlo.
>
> Un detalle del reemplazo que vale registrar: hay que renombrar **de más largo a más corto**,
> porque `getAdminProducts` es prefijo de `getAdminProductsId`. Al revés produce
> `listProductsId`, un nombre que no existe y que el typecheck marca — pero si el mapeo hubiera
> sido entre dos nombres ambos válidos, habría compilado apuntando a la operación equivocada.
>
> Resultado: typecheck y lint limpios, **100 archivos / 648 tests en verde**. Ningún test tuvo
> que tocarse, que es la señal de que el cambio fue de nombres y no de comportamiento.

- [x] **T0.1 Regenerar el cliente y verificar que `/search` llegó.** `pnpm --filter @dsm/web codegen`.
  Los artefactos derivados del contrato —DTOs, Zod, handlers MSW— **se generan**; escribirlos a
  mano reintroduce drift silencioso.
  - **Exit criterion**: existen la operación `searchProducts` en `src/api/generated/endpoints.ts`,
    los modelos `SearchResponse` / `SearchResult` en `src/api/generated/model/` y el schema Zod
    de la respuesta en `src/api/generated/zod.ts`. El diff del codegen **no** toca otras
    operaciones (si las toca, es contrato de otra sesión y hay que separarlo).
  - **Verify**: `pnpm --filter @dsm/web codegen && grep -q "searchProducts" apps/web/src/api/generated/endpoints.ts && ls apps/web/src/api/generated/model/ | grep -qE "^searchR(esponse|esult)" && grep -qi "searchProductsResponse" apps/web/src/api/generated/zod.ts && pnpm --filter @dsm/web typecheck`
- [x] **T0.2 `src/features/search/searchService.ts`.** Servicio hand-written sobre la operación
  generada, con validación runtime en el borde y tipos **re-exportados** del modelo generado.
  - **Exit criterion**: `search(q, { limit? })` devuelve `SearchResponse` validado con
    `parseContract`; los tipos se re-exportan del modelo generado (cero `interface SearchResponse`
    escrita a mano); la caché es `{ next: { revalidate: 60, tags: [CATALOG_TAG] } }` con el
    `CATALOG_TAG` **importado** de `categoriesStorefrontService` (no un literal repetido); un
    404/500 se propaga como `AppErrorException`.
  - **Pattern** (`frontend-standards` §3.3):
    ```ts
    import { parseContract } from '@/lib/http/contract';
    import { searchProducts } from '@/api/generated/endpoints';
    import { SearchProductsResponse } from '@/api/generated/zod';
    import type { SearchResponse, SearchResult } from '@/api/generated/model';
    export type { SearchResponse, SearchResult };

    export const searchService = {
      async search(q: string, limit?: number): Promise<SearchResponse> {
        const res = await searchProducts({ q, limit }, searchCache());
        return parseContract(SearchProductsResponse, res.data);
      },
    };
    ```
  - **Verify**: `pnpm --filter @dsm/web test -- searchService` (con MSW: los cuatro ejemplos del
    contrato —`conResultados`, `bajaConfianza`, `sinResultados`, `degradado`— parsean, y un 429
    llega como `AppErrorException` con `kind: 'rateLimited'`)

## Fase 1: Lógica pura — 0,75 h

- [ ] **T1.1 `queryGuard.ts` — la regla de AC-5.** Normaliza (trim + colapso de espacios) y
  decide si la consulta merece un request.
  - **Exit criterion**: `esConsultaUtil(q)` es `false` para `''`, `'  '`, `'a'` y `'  a  '`, y
    `true` desde 2 caracteres útiles; `normalizar(q)` colapsa espacios internos y **no** baja a
    minúsculas el texto que se envía (eso lo hace el servidor para su caché; el eco en pantalla
    tiene que mostrar lo que el cliente escribió).
  - **Verify**: `pnpm --filter @dsm/web test -- queryGuard`
- [ ] **T1.2 `searchErrorCopy.ts` — el copy de los rechazos.** 422 (corta / larga), 429 con
  `Retry-After`, 503 y fallo de red, en el tono de §10.2 (vos, sin jerga).
  - **Exit criterion**: los cinco casos devuelven un mensaje distinto, accionable y **sin** el
    `detail` crudo del servidor; el 429 incluye el tiempo de espera cuando el error lo trae y
    una espera genérica cuando no; ningún mensaje culpa al cliente.
  - **Verify**: `pnpm --filter @dsm/web test -- searchErrorCopy`

## Fase 2: Componentes — 2,25 h

- [ ] **T2.1 `SearchBar.tsx`** — client leaf del header. `<form role="search">` +
  `<input type="search">`, placeholder de §10.2, submit → `router.push('/buscar?q=…')`.
  - **Exit criterion**: con una consulta útil navega a `/buscar?q=` con el texto
    **encodeado**; con una consulta corta **no navega** (`push` no se llama) y muestra la
    invitación a describir la necesidad — que es AC-5 del lado del cliente; el input conserva
    lo escrito tras el rechazo; el nombre accesible existe sin depender del placeholder.
  - **Verify**: `pnpm --filter @dsm/web test -- SearchBar`
- [ ] **T2.2 `SearchResultCard.tsx` + `ProductImage` con `categoryName` opcional.**
  - **Exit criterion**: la tarjeta enlaza a `/productos/{slug}` (AC-1); muestra el precio con
    `formatArs` e «IVA incluido»; con `in_stock: false` muestra el badge **de texto** «Sin
    stock» y **no renderiza** `AddToCartButton` (AC-7: ausente, no deshabilitado); con
    `in_stock: true` lo renderiza con `slug` y `productName`; **no muestra el `score`**;
    `ProductImage` sin `categoryName` produce `alt` = nombre del producto y **con** ella sigue
    produciendo `{name} — {categoría}` (los tests existentes de `ProductImage` siguen verdes
    sin tocarlos).
  - **Verify**: `pnpm --filter @dsm/web test -- "SearchResultCard|ProductImage"` y
    `git diff --exit-code HEAD -- apps/web/src/features/storefront/ProductImage.test.tsx` **antes**
    de agregarle el caso nuevo (el test preexistente no se modifica para acomodar el cambio; el
    caso de `alt` sin categoría se **agrega**)
- [ ] **T2.3 `SearchResults.tsx` — la composición y los cuatro estados.** Eco de la consulta,
  `interpreted_as` visible, grilla ordenada como vino, y la derivación pura de `design.md` §D5.
  - **Exit criterion**: `confidence: high` → interpretación + grilla, **sin** advertencias;
    `confidence: low` con resultados → aviso honesto («no estamos seguros») + grilla + salida a
    rubros, y el test afirma que el aviso está **antes** de la grilla en el DOM (presentarlos
    como certeza es el defecto que §7.12 quiere evitar); `results: []` → estado vacío afirmativo
    + rubros (AC-3), **nunca** el texto «0 resultados» solo; `degraded: true` → banner de
    «buscamos por texto» que **coexiste** con resultados (AC-4: no es un error); el eco de la
    consulta con `<img src=x onerror=alert(1)>` aparece **como texto** y
    `container.querySelector('img')` es `null` (AC-8); la cantidad de resultados se anuncia en
    una región `aria-live="polite"`.
  - **Verify**: `pnpm --filter @dsm/web test -- SearchResults`
- [ ] **T2.4 `SearchFallback.tsx` — la red de seguridad de AC-3.**
  - **Exit criterion**: renderiza cada `suggested_categories[]` como enlace a
    `/categorias/{slug}` con su `name` como texto; con la lista vacía o `fallback: null` no
    renderiza un contenedor vacío (devuelve `null`); es alcanzable por teclado.
  - **Verify**: `pnpm --filter @dsm/web test -- SearchFallback`
- [ ] **T2.5 `SearchSkeleton.tsx` + `app/(storefront)/buscar/loading.tsx`.** Skeleton, no
  spinner (§10.1).
  - **Exit criterion**: el skeleton no anuncia contenido falso a un lector de pantalla
    (`aria-hidden` en las cajas + un `role="status"` con «Buscando…»); el `loading.tsx` vive
    **sólo** en el segmento `buscar/` y el resto de `(storefront)` sigue sin ninguno — un
    `loading.tsx` un nivel arriba compromete el status 200 y rompe el 404 de la ficha (F59).
  - **Verify**: `pnpm --filter @dsm/web test -- SearchSkeleton` y
    `test "$(find 'apps/web/app/(storefront)' -name loading.tsx | wc -l | tr -d ' ')" = "1"`

## Fase 3: Rutas y cableado — 0,75 h

- [ ] **T3.1 `app/(storefront)/buscar/page.tsx`** — Server Component que lee `searchParams.q`,
  aplica el guard, llama al servicio y compone. `metadata` con `robots: noindex, follow`.
  - **Exit criterion**: con `?q=` útil, el **HTML servido** contiene los nombres de los
    resultados (D2: no depende de JS); con `?q=a` (alcanzable a mano) **no llama al servicio** y
    muestra la invitación — AC-5 también fuera del formulario; sin `q` muestra el estado
    inicial con acceso a rubros; un `429` o un `503` del servicio se renderizan con el copy de
    T1.2 y la página **sigue navegable**; `generateMetadata` devuelve `robots.index === false`,
    `robots.follow === true` y un `title` con el eco de la consulta.
  - **Verify**: `pnpm --filter @dsm/web test -- buscar` y `pnpm --filter @dsm/web typecheck`
- [ ] **T3.2 `SearchBar` montado en `app/(storefront)/layout.tsx`.** Reemplaza el comentario
  `Deferred: US-004`. Full-width en mobile (OQ-FE-3: sin overlay).
  - **Exit criterion**: el buscador aparece en **toda** página pública (el layout lo monta una
    vez); el layout **sigue siendo Server Component** —el `'use client'` vive en el `SearchBar`,
    que es hoja— y `CategoryNav` sigue renderizando en servidor, de lo que depende el SEO de
    US-002; el comentario `Deferred: US-004` ya no existe.
  - **Verify**: `! grep -q "Deferred: US-004" "apps/web/app/(storefront)/layout.tsx" && ! grep -q "'use client'" "apps/web/app/(storefront)/layout.tsx" && pnpm --filter @dsm/web test -- "CategoryNav|storefront"`

## Fase 4: Observabilidad — 0,5 h

- [ ] **T4.1 Los cuatro eventos + `SearchTracker.tsx`.** Se agregan a la unión cerrada
  `BusinessEvent` y se emiten desde hojas cliente.
  - **Exit criterion**: `search_performed` (con `confidence`, `degraded`, `results_count`,
    `query_length`) se emite **una** vez por búsqueda y se re-arma al cambiar la consulta (el
    guard de `StrictMode` del patrón `CategoryViewTracker`); `search_result_clicked` lleva
    `position` y sale de **un** listener por delegación sobre la grilla, sin volver cliente cada
    tarjeta; `search_fallback_clicked` lleva `category_slug`; `search_rate_limited` lleva
    `retry_after_seconds`; **el volcado de los cuatro no contiene el texto de la consulta** ni
    ningún fragmento de él (OQ-FE-5, `observability-standards` §9).
  - **Verify**: `pnpm --filter @dsm/web test -- "SearchTracker|search.events"`

## Fase 5: A11y y SSR — 0,75 h

- [ ] **T5.1 A11y de la experiencia de búsqueda** (axe sobre los cuatro estados + teclado).
  - **Exit criterion**: cero violaciones de axe en los cuatro estados de `SearchResults` y en el
    `SearchBar`; el formulario se opera **sólo con teclado** (Tab al input, Enter para buscar);
    el foco va al encabezado de resultados tras la navegación; el aviso de baja confianza y el
    de degradado son **texto** y no sólo color.
  - **Verify**: `pnpm --filter @dsm/web test -- "searchA11y"`
- [ ] **T5.2 El contenido no depende de JS.** Test de la página servida (el patrón de US-002/003
  para SSR).
  - **Exit criterion**: el render de servidor de `/buscar?q=…` incluye los nombres de los
    resultados, el eco de la consulta y los enlaces a `/productos/{slug}`; el `SearchBar` no es
    necesario para que la página funcione (se puede llegar por URL).
  - **Verify**: `pnpm --filter @dsm/web test -- "buscarSsr"`

## Verification (suite-level)

- [ ] Unit + componente del web verdes: `pnpm --filter @dsm/web test`
- [ ] Lint + typecheck limpios: `pnpm --filter @dsm/web lint && pnpm --filter @dsm/web typecheck`
- [ ] Build de producción verde y `/buscar` presente en el manifiesto de rutas:
      `pnpm --filter @dsm/web build`
- [ ] **Codegen fresco** (el gate de CI reejecuta esto y falla si produce diff):
      `pnpm --filter @dsm/web codegen && git diff --exit-code -- apps/web/src/api/generated`
- [ ] **No regresión del storefront ni del panel**:
      `pnpm --filter @dsm/web test -- "storefront ProductCard ProductDetail CategoryNav cart account"`
- [ ] **Sin tipos del contrato escritos a mano** (§3.1):
      `! grep -rnE "interface (SearchResponse|SearchResult)|type (SearchResponse|SearchResult) = \{" apps/web/src --exclude-dir=generated`
- [ ] **Sin `dangerouslySetInnerHTML` en la feature** (§6, AC-8):
      `! grep -rn "dangerouslySetInnerHTML" apps/web/src/features/search/`
- [ ] **El texto de la consulta no viaja en telemetría** (OQ-FE-5): cubierto por T4.1; se
      re-corre acá porque una regresión ahí es PII en los logs:
      `pnpm --filter @dsm/web test -- "search.events"`
- [ ] **Un solo `loading.tsx` en todo `(storefront)`** (F59):
      `test "$(find 'apps/web/app/(storefront)' -name loading.tsx | wc -l | tr -d ' ')" = "1"`
- [ ] **`/buscar` no indexable** (D2): cubierto por T3.1; el grep confirma que la decisión no se
      perdió en un refactor: `grep -q "index: false" "apps/web/app/(storefront)/buscar/page.tsx"`
- [ ] CI del monorepo verde: `pnpm -r lint && pnpm -r typecheck && pnpm -r test`

## Fuera de alcance (declarado, no olvidado)

- **Dropdown de sugerencias en vivo** — OQ-FE-1: el backend no tiene endpoint de autocompletado
  y un dropdown por tecleo contradice el rate-limit que protege la cuota del proveedor.
- **Vista full-screen de búsqueda en mobile** — OQ-FE-3.
- **Chip «match alto»** — marcado opcional en §7.12; sin `score` visible aporta la misma
  información sin la métrica.
- **La batería de relevancia ≥70% (AC-2)** — arnés de backend/QA, no de la UI.
- **AC-6 y AC-9** — invariantes del servidor: el frontend renderiza lo que el contrato le da.
- **Historial de búsquedas del cliente** — no está en la US y guardarlo abre un problema de
  retención de datos que nadie pidió.
