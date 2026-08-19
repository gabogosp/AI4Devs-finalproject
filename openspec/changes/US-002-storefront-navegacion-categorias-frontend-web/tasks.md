---
parent-us: US-002
discipline: frontend-web
variant: null
language: es
---

# US-002 Frontend Web — Tasks

> Cada task es closure-grade: atómica, con `Pattern:` (el snippet mínimo aplicable + la cita de §),
> `Exit criterion:` observable y `Verify:` con el comando exacto que `/develop-frontend-web` corre.
> El `Verify:` **ejercita** el criterio —falla si el comportamiento no está— en vez de greppear su
> presencia (F50), **termina** sin TTY ni watch (F49 — `vitest run`, nunca `vitest`; **sin `timeout`,
> que en macOS no existe**), y cuando greppea repo, está acotado a `apps/web/` para no matchearse a
> sí mismo (F57). Comandos desde la **raíz del repo**.
>
> **Estimación dual**: **~10.5 h AI-asistido** / **~19 h tradicional** (20 tasks). El presupuesto FE
> de la US §7 es **12–16 h**: el AI-asistido entra holgado; el tradicional **excede el techo en ~3 h**
> y el motivo es explícito — la US §7 no contemplaba (a) el **sitemap/robots del sitio**, que US-003
> difirió formalmente a US-002, ni (b) el **circuito de invalidación del catálogo** (D2), que no
> existía cuando se estimó porque la caché por tag se introdujo en US-003, ni (c) la extensión del
> **stub de contrato** para E2E server-side. Las tres son trabajo real de esta US, no scope creep.
> Horas por task = AI-asistido.
>
> **Decisiones vigentes** (`design.md`): D1 mapa de rutas (ADR-0010 heredado) · **D2 tag grueso
> `catalog` + puente extendido** · D3 paginación por `searchParams`, `limit` fijo 20, fuera de rango
> → 404 · D4 canonical auto-referencial + `rel=prev/next` · D5 sitemap con categorías **y** fichas ·
> D6 `CategoryNav` sin JS con degradación · D7 breadcrumb (cierra el deferral de US-003) · D8 card
> sin CTA · D9 `ProductImage` parametrizado · **D10 ningún `loading.tsx` en `(storefront)`** · D11
> matriz de estados · D12 `category_shown` · D13 stub con `__reset` por alcance.
> **Pendientes de ratificación**: OQ-FE-7/8/9/10 (decididas por el plan) y OQ-FE-11 (coordinación BE).

## Traceability matrix (AC → tasks)

| AC | Título | Task IDs | Estado |
|---|---|---|---|
| **AC-1** | Entrar a un rubro (subrubros y/o productos, URL por slug) | T1.1, T3.1, T3.2, T4.1, T4.2 | in this change |
| **AC-2** | Rubro → subrubro y volver al padre | T1.1, T3.3, T4.1 | in this change |
| **AC-3** | Grilla con nombre/precio/imagen/disponibilidad, paginada, enlaza a la ficha | T4.2, T4.3, T7.3 | in this change |
| **AC-4** | Página indexable: SSR + metadatos + **sitemap** | T5.1, T5.2, T5.3, T7.3 | in this change (medición SEO → `QA-US-002`) |
| **AC-5** | Sin stock visible pero no comprable | T4.2 | in this change (la card no ofrece compra — D8) |
| **AC-6** | Categoría sin productos → estado vacío navegable | T4.4, T7.3 | in this change |
| **AC-7** | Catálogo grande sin degradación | T4.2, T4.3, T7.3 | in this change (CWV con ≥5.000 SKUs → `QA-US-002` TC-205) |
| **AC-8** | Borradores/archivados nunca en listados públicos | **T2.1, T2.2, T7.4** | in this change (el filtro `published` es del BE; acá, que la caché no lo sobreviva) |
| **AC-9** | Categoría inexistente → 404 real (no 200 vacío) | T4.1, T4.3, T7.3 | in this change |
| **AC-10** | Contenido server-rendered | T4.1, T4.2, T7.3 | in this change |

**Cobertura no-AC del `design.md` (F51 — toda declaración del diseño tiene task o `Deferred:`)**:
D1 mapa de rutas → T3.2, T4.1 · **D2 caché e invalidación → T1.1, T2.1, T2.2** · D3 paginación →
T4.3 · D4 SEO de paginación → T5.1 · D5 sitemap/robots → T5.2, T5.3 · D6 `CategoryNav` +
degradación → T3.1 · D7 breadcrumb + JSON-LD `BreadcrumbList` + cierre del deferral de US-003 →
T3.3, T5.1 · D8 `ProductCard` → T4.2 · D9 `ProductImage` variant → T4.2 · **D10 prohibición de
`loading.tsx` en todo `(storefront)` → T4.1 (criterio de salida) + verificación suite-level** ·
D11 matriz de estados → T4.1, T4.2, T4.4 · D12 observabilidad → T6.1 · D13 stub + `__reset` por
alcance + log de requests → T7.2 · Seguridad (JSON-LD escapado, cero env nuevas) → T5.1 + gate
suite-level · Resiliencia (#10/#11/#12/#15) → T3.1, T4.2, T5.2 · A11y → T7.1 · Documentación → T8.1.
**Diferidos declarados**: CTA "Agregar" en la card → `Deferred: US-007 — design-system §7.3` ·
top-nav completo (buscador, carrito, cuenta) → `Deferred: US-004/US-007 — design-system §7.10` ·
grilla global `/productos` → `Deferred: OQ-FE-7 — sin endpoint público que la sirva` · breadcrumb
con rubro padre en la ficha → `Deferred: OQ-FE-11 — requiere category.parent en el contrato` ·
`generateSitemaps` particionado → `Deferred: disparador > 50.000 URLs (design.md D5)` ·
`placeholder="blur"` en imágenes remotas → `Deferred: requiere loader propio (design.md D9)` ·
número real de WhatsApp → `Deferred: OQ-FE-3 (PO/cliente)` · invalidación desde el import masivo →
`Deferred: US-006 — debe invocar el mismo puente`.

## Pre-requisitos

- [x] **P1** — `docs/product/design-system.md` en estado `Approved` (gate de `fe-design-without-figma`
  §5: sin Figma, el design-system es la autoridad visual y ninguna task de UI arranca con él en
  `Draft`).
  - **Verify**: `grep -qE "^\*\*Status\*\*:? *Approved|^status: *Approved|Approved" docs/product/design-system.md`

- [x] **P2** — Suite verde antes de empezar. *(2026-08-18: 29 archivos / 127 tests verdes + build OK.)* Este change **modifica superficie entregada**
  (`revalidateSafely.ts`, `ProductDetail.tsx`, `ProductImage.tsx`, `layout.tsx`, `page.tsx` de la
  home, `api-stub.mjs`): se necesita la red de seguridad previa (`refactoring-discipline`).
  - **Verify**: `pnpm --filter @dsm/web test -- --run && pnpm --filter @dsm/web build`

- [x] **P3** — El contrato publicado expone las **tres** operaciones de categorías y el cliente
  generado las refleja **sin diff** (gate `frontend-codegen-fresh`). Los artefactos derivados del
  contrato —DTOs, Zod y mocks MSW— son **siempre generados**, nunca escritos a mano
  (`frontend-standards.md` §3.1/§3.2 + skill `openapi-client-codegen`). Si este check falla, **parar
  y coordinar con backend** — jamás editar `openapi.yaml` desde el FE.
  - **Verify**: `pnpm --filter @dsm/web codegen && grep -q "storefrontListCategories" apps/web/src/api/generated/endpoints.ts && grep -q "storefrontGetCategory" apps/web/src/api/generated/endpoints.ts && grep -q "storefrontListCategoryProducts" apps/web/src/api/generated/endpoints.ts && git diff --quiet -- apps/web/src/api/generated`

---

## Fase 1: Servicio de categorías del storefront (AC-1, AC-2, AC-3)

- [x] **T1.1** `categoriesStorefrontService`: árbol + detalle + listado paginado, con la política de caché declarada en el servicio (0.75 h)
  - **AS-BUILT 2026-08-18**: 13 tests verdes + typecheck. Única desviación del `Pattern:`, de tipos y sin cambio de comportamiento: `catalogCache` es una **función** en vez de un objeto `as const` — el `as const` produce `tags: readonly ["catalog"]` y el `RequestInit` de Next declara `tags: string[]` mutable, así que no tipa. Construirlo por llamada evita además compartir el array entre fetches.
  - **Pattern**:
    ```ts
    // src/features/storefront/categoriesStorefrontService.ts
    import { parseContract } from '@/lib/http/contract';
    import { storefrontListCategories, storefrontGetCategory,
             storefrontListCategoryProducts } from '@/api/generated/endpoints';
    import { StorefrontListCategoriesResponse, StorefrontGetCategoryResponse,
             StorefrontListCategoryProductsResponse } from '@/api/generated/zod';

    /** Tag ÚNICO de todo el catálogo público (design.md D2). Fuente única del literal. */
    export const CATALOG_TAG = 'catalog';
    /** Safety-net, NO la vía de frescura: la inmediatez la da revalidateCatalog(). */
    export const CATALOG_REVALIDATE_SECONDS = 3600;
    export const PAGE_SIZE = 20;   // = default del contrato; no configurable por query (D3)

    const catalogCache = {
      next: { revalidate: CATALOG_REVALIDATE_SECONDS, tags: [CATALOG_TAG] },
    } as const;

    export const categoriesStorefrontService = {
      async getTree() {
        const res = await storefrontListCategories(catalogCache);
        return parseContract(StorefrontListCategoriesResponse, res.data).data;
      },
      async getBySlug(slug: string) {
        const res = await storefrontGetCategory(slug, catalogCache);
        return parseContract(StorefrontGetCategoryResponse, res.data);
      },
      async listProducts(slug: string, page: number) {
        const res = await storefrontListCategoryProducts(
          slug, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }, catalogCache);
        return parseContract(StorefrontListCategoryProductsResponse, res.data);
      },
    };
    ```
    — per `frontend-standards.md` §3.3 (hand-written **sólo** la lógica del servicio; los tipos y la
    validación son generados) + §11.5 (repositorio por feature) + `frontend-next-standards.md` §3
    (caché **explícita** por fetch; tagear lo que se piensa revalidar). El envelope
    `{ data, pagination }` es el del contrato vivo (`api-standards.md` §6.1/§6.3): el FE deriva
    `hasNext` de `limit/offset/total`, no espera links `next`/`prev`.
  - **Exit criterion**: las tres funciones devuelven datos **tipados y validados contra el Zod
    generado** y propagan `AppError` `notFound`/`server`/`network` vía el cliente existente; las tres
    declaran `revalidate` y el tag `CATALOG_TAG` (constante exportada, fuente única — la Server
    Action de T2.1 la importa en lugar de duplicar el string); `listProducts` traduce `page → offset`
    con `PAGE_SIZE` y **nunca** emite `limit > 20`; una respuesta que no cumple el contrato falla
    como `AppError.server` en vez de propagar un objeto malformado. Tests con MSW cubren: árbol OK,
    detalle con `parent` no-null y con `parent` null, listado página 1 y página 2 (asertando el
    `offset` enviado), 404 del contrato → `notFound`, y respuesta malformada → `server`.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/storefront/categoriesStorefrontService && pnpm --filter @dsm/web typecheck`

---

## Fase 2: Circuito de invalidación del catálogo (AC-8) — `design.md` D2

- [x] **T2.1** Server Action `revalidateCatalog()`: Data Cache + Full Route Cache de categorías + home + sitemap (0.5 h)
  - **AS-BUILT 2026-08-18**: 12 tests verdes (4 nuevos + los 8 de `revalidateProduct` intactos). Hubo que extender el mock de `next/cache` del spec existente, que descartaba el 2º argumento de `revalidatePath` y por lo tanto no podía distinguir `('/categorias/[slug]', 'page')` de purgar una URL suelta. El mock reenvía el `type` **sólo cuando viene**, para no romper las aserciones de un argumento que ya existían.
  - **Pattern**:
    ```ts
    // src/features/storefront/revalidate.ts — el archivo YA existe ('use server') con revalidateProduct
    import { CATALOG_TAG } from './categoriesStorefrontService';   // fuente única del literal

    /**
     * Sin input → nada que validar; efecto idempotente y benigno (next-standards §4:
     * toda Server Action es una superficie pública, pero ésta sólo purga caché).
     */
    export async function revalidateCatalog(): Promise<void> {
      revalidateTag(CATALOG_TAG);                     // árbol + detalle + listados + sitemap
      revalidatePath('/categorias/[slug]', 'page');   // TODA página de categoría, incl. 404 cacheados
      revalidatePath('/');                            // home: grilla de rubros
      revalidatePath('/sitemap.xml');                 // el sitemap es una ruta cacheada más
    }
    ```
    — per `frontend-next-standards.md` §3 (`revalidateTag`/`revalidatePath` tras mutaciones) + §4
    (Server Actions) + `design.md` D2 (por qué tag **y** paths: el tag purga la Data Cache, el path
    purga la Full Route Cache — que es lo que cubre "la página de una categoría recién creada quedó
    cacheada como 404").
  - **Exit criterion**: existe `revalidateCatalog` en el módulo `'use server'` existente; ejecuta las
    cuatro purgas con exactamente esos argumentos (incluida la forma `('/categorias/[slug]', 'page')`,
    que purga todas las instancias del segmento dinámico y no sólo una URL); importa `CATALOG_TAG`
    del servicio en vez de repetir el literal. Test unitario con `next/cache` espiado que **falla si
    falta cualquiera de las cuatro** llamadas o si el tag no coincide con el que usa el servicio.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/storefront/revalidate`

- [x] **T2.2** Puente panel → catálogo: el puente **existente** invalida también el catálogo, y el alta/edición de categorías gana el suyo (0.5 h)
  - **AS-BUILT 2026-08-18**: 34 tests verdes en el alcance del `Verify:` (6 nuevos: 4 unitarios del puente + 2 de `CategoryForm`). Los **tres call-sites de producto no se tocaron**, tal como pedía el criterio: heredan la invalidación del catálogo desde el puente. `CategoryForm.test.tsx` necesitó mockear el módulo del puente —sin el mock la Server Action corría en jsdom— y ahí se asertan los dos casos: alta OK → catálogo invalidado; 409 → ninguna invalidación.
  - **Pattern**:
    ```ts
    // src/features/storefront/revalidateSafely.ts — diff mínimo, a propósito
    export function revalidateProductSafely(slug: string): void {
      // Los 3 call-sites del panel (ProductForm crear/editar, ProductActions publicar/archivar)
      // NO cambian: heredan la invalidación del catálogo por construcción. Una acción nueva
      // que use el puente no puede "olvidarse" de invalidar el listado (design.md D2).
      void Promise.all([revalidateProduct(slug), revalidateCatalog()]).catch(captureError);
    }
    /** Para mutaciones que afectan la estructura, no un producto (CategoryForm de US-001). */
    export function revalidateCatalogSafely(): void {
      void revalidateCatalog().catch(captureError);
    }
    ```
    ```tsx
    // src/features/categories/CategoryForm.tsx — tras un guardado EXITOSO
    const saved = initial ? await categoriesService.update(...) : await categoriesService.create(...);
    revalidateCatalogSafely();   // sin esto, la categoría nueva tarda hasta 1 h en la nav y el sitemap
    onSaved?.(saved);
    ```
    — per `design.md` D2 (fire-and-forget: la mutación **ya** fue confirmada por el backend; hacer
    esperar al dueño o mostrarle un error por una purga de caché sería mentirle sobre lo que pasó) +
    `frontend-resilience-patterns` #10 (el fallo se **reporta**, nunca se silencia).
  - **Exit criterion**: tras una mutación de producto **exitosa** (crear/editar, publicar, archivar)
    se invalidan **ambos**: la ficha y el catálogo; tras una mutación **fallida** no se invalida
    nada; tras un alta o edición de categoría exitosa se invalida el catálogo; un fallo de
    invalidación se reporta a observabilidad y **no** rompe el feedback de la mutación al dueño; los
    tres call-sites de producto siguen llamando al mismo puente (no se agregó una llamada suelta que
    un dev futuro pueda olvidar). Tests de componente: producto publicado → catálogo invalidado;
    producto con error 422 → **ninguna** invalidación; categoría creada → catálogo invalidado.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/products src/features/categories src/features/storefront/revalidateSafely`

---

## Fase 3: Navegación del sitio (AC-1, AC-2) — `design.md` D6, D7

- [x] **T3.1** `CategoryNav` en el layout `(storefront)`: rubros indexables, cero JS de cliente, con degradación (0.75 h)
  - **AS-BUILT 2026-08-18**: 3 tests verdes + build OK. Server Component sin `"use client"` (verificado por grep), montado en `app/(storefront)/layout.tsx` bajo el wordmark, así que toda página del route group —incluida la ficha de US-003— lo incluye. Tres casos cubiertos: árbol OK (un link por rubro con su href), árbol que rechaza (devuelve `null` + `captureError`, **no** propaga) y árbol vacío (no renderiza una barra hueca).
  - **Pattern**:
    ```tsx
    // src/features/storefront/CategoryNav.tsx — Server Component (SIN "use client")
    export async function CategoryNav() {
      // Degradación explícita: si el árbol cae, se pierde la NAV, no el SITIO.
      // Sin este catch, un 5xx del endpoint del árbol tumbaría TODA página del
      // storefront —incluida la ficha, que no lo necesita— (resilience #10).
      const rubros = await categoriesStorefrontService.getTree().catch((e) => {
        captureError(e);
        return [];
      });
      if (rubros.length === 0) return null;
      return (
        <nav aria-label="Rubros" className="overflow-x-auto border-b border-border">
          <ul className="mx-auto flex max-w-5xl gap-4 px-4">
            {rubros.map((r) => (
              <li key={r.slug}>
                <Link href={`/categorias/${r.slug}`}
                  className="flex min-h-[44px] items-center whitespace-nowrap text-sm
                             focus:outline-none focus-visible:shadow-focus">{r.name}</Link>
              </li>
            ))}
          </ul>
        </nav>
      );
    }
    // app/(storefront)/layout.tsx: <CategoryNav /> debajo del wordmark existente.
    ```
    — per design-system §7.10 (`CategoryNav` "load-bearing para SEO — links indexables"), §4.1
    (mobile: scroll horizontal, targets ≥ 44 px; los links están **siempre** en el DOM) y §11
    (focus ring visible) + `frontend-next-standards.md` §2 (Server Component por default: la nav no
    necesita estado ni handlers, así que no agrega **un byte** de JS de cliente). El dropdown de
    subrubros del §7.10 completo es `Deferred: US-004/US-007`.
  - **Exit criterion**: toda página del route group `(storefront)` —incluida la ficha de US-003—
    incluye una `<nav aria-label="Rubros">` con un `<a href="/categorias/{slug}">` por rubro,
    presente **en el HTML servido**; `CategoryNav` no lleva `"use client"`; cuando el fetch del árbol
    falla, el componente **no lanza**: reporta a observabilidad y la página se renderiza sin la
    barra. Tests: render con árbol OK (links por rubro con href correcto), y árbol que rechaza →
    render sin lanzar + `captureError` invocado (el test **falla** si el error se propaga).
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/storefront/CategoryNav && pnpm --filter @dsm/web build`

- [x] **T3.2** Home pública real en `/`: claim + grilla de rubros con sus subrubros (0.5 h)
  - **AS-BUILT 2026-08-18**: 3 tests verdes + build OK; `/` pasa de 140 B a 176 B (sigue estática). El stub "Comprá online y retirá" deja de ser el contenido completo: hay `h2` por rubro y un link por cada subrubro.
  - **Falso rojo del harness, diagnosticado y evitado (aplica a todo test futuro de resiliencia acá)**: mockear el fallo del árbol con `vi.fn().mockRejectedValue(...)` —o `mockImplementation(() => Promise.reject(...))`, o incluso `async () => { throw }`— hace que el spy **retenga la promesa rechazada en `mock.results`**, y vitest la reporta como unhandled apenas `render()` flushea microtasks, **aunque el componente sí la maneje**. Verificado aislando el caso: `StorefrontHome()` NO propaga, el catch funciona; el rojo lo producía el harness. La solución es un doble con **estado plano** (`let treeResult`) en vez de un spy. Se aplicó también a `CategoryNav.test.tsx`, que tenía el mismo defecto latente (hoy pasa sólo porque ese caso no llama a `render`).
  - **Pattern**:
    ```tsx
    // app/(storefront)/page.tsx — reemplaza el stub que US-003 dejó marcado "Deferred: US-002"
    export default async function StorefrontHome() {
      const rubros = await categoriesStorefrontService.getTree().catch(() => []);
      // h1 = claim de la tienda; h2 por rubro; los subrubros son links (SEO + AC-1)
    }
    ```
    — per `frontend-next-standards.md` §1/§2 + design-system §4 (grilla 2/3/4 columnas), §10.2 (voz:
    "práctico y confiable", tratamiento informal argentino) y §11 (jerarquía de headings). El
    buscador de la home es `Deferred: US-004`.
  - **Exit criterion**: `/` responde 200 y su HTML servido contiene un `h1` con el claim y **un link
    por cada rubro y por cada subrubro** del árbol, apuntando a `/categorias/{slug}`; el stub con el
    texto "Comprá online y retirá" deja de ser el contenido completo de la página; si el árbol falla,
    la home se sirve igual con el claim (no 500). Test que **falla** si un subrubro del fixture no
    aparece como link.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/storefront/StorefrontHome && pnpm --filter @dsm/web build`

- [x] **T3.3** `Breadcrumb` reusable + cierre del `Deferred: US-002` que US-003 dejó en la ficha (0.5 h)
  - **AS-BUILT 2026-08-18**: 9 tests verdes (3 nuevos + los 6 de `ProductDetail` intactos, o sea que el nombre de la categoría sigue presente, ahora como link). La ficha muestra `Inicio › {categoría con link} › {producto}` y la categoría deja de ser texto plano. La cadena con el **rubro padre** sigue diferida (`OQ-FE-11`): exigiría un segundo fetch en cadena sobre la página de conversión.
  - **Pattern**:
    ```tsx
    // src/features/storefront/Breadcrumb.tsx — Server Component
    // items: [{ name: 'Inicio', href: '/' }, ...ancestros, { name: actual }]  // el último SIN href
    <nav aria-label="Ruta de navegación">
      <ol className="flex flex-wrap items-center gap-1 text-sm text-muted">
        {items.map((it, i) => it.href
          ? <li key={it.href}><Link href={it.href} className="focus-visible:shadow-focus">{it.name}</Link></li>
          : <li key={i} aria-current="page" className="text-foreground">{it.name}</li>)}
      </ol>
    </nav>
    ```
    ```tsx
    // src/features/storefront/ProductDetail.tsx — la categoría deja de ser texto plano:
    <Breadcrumb items={[{ name: 'Inicio', href: '/' },
                        { name: product.category.name, href: `/categorias/${product.category.slug}` },
                        { name: product.name }]} />
    ```
    — per design-system §11 (`aria-current="page"`, jerarquía semántica) + AC-2 ("puede volver al
    rubro padre desde la navegación"). El `slug` de la categoría **ya viene** en `StorefrontProduct`:
    cero fetch extra. La cadena completa con el **rubro padre** en la ficha exigiría un segundo fetch
    en cadena sobre la página de conversión → `Deferred: OQ-FE-11 — requiere category.parent en el contrato`.
  - **Exit criterion**: existe `Breadcrumb` con `<nav aria-label="Ruta de navegación">`, `<ol>`, el
    último ítem **sin link** y con `aria-current="page"`; la ficha de producto renderiza
    `Inicio › {categoría con link a /categorias/{slug}} › {producto}` y ya **no** muestra la
    categoría como texto plano; los tests existentes de `ProductDetail` siguen verdes (el nombre de
    la categoría sigue presente, ahora como link). Tests: breadcrumb de 2 y de 3 niveles, y que el
    ítem actual no sea un link.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/storefront/Breadcrumb src/features/storefront/ProductDetail`

---

## Fase 4: Página de categoría (AC-1, AC-3, AC-5, AC-6, AC-7, AC-9, AC-10)

- [x] **T4.1** Ruta `app/(storefront)/categorias/[slug]/page.tsx`: Server Component + 404 real + boundaries, **sin `loading.tsx`** (0.75 h)
  - **AS-BUILT 2026-08-18**: 3 tests verdes + build OK + chequeo de `loading.tsx` en verde. La ruta aparece en el build como `ƒ /categorias/[slug]` (dynamic, server-rendered). Existen `not-found.tsx` (accionable, sale a los rubros) y `error.tsx` (reintento + `captureError`). Los tres casos cubiertos: éxito (h1 único con el nombre), `AppError.notFound` → `notFound()`, y error no-404 → **propaga** (traducir un 5xx a 404 escondería una caída del backend detrás de una página indexable). La grilla, la paginación y el estado vacío entran en T4.2–T4.4.
  - **Pattern**:
    ```tsx
    // Server Component async (SIN "use client") — next-standards §2/§3
    export default async function CategoryPage({ params, searchParams }: {
      params: Promise<{ slug: string }>;
      searchParams: Promise<{ page?: string }>;
    }) {
      const { slug } = await params;
      const category = await categoriesStorefrontService.getBySlug(slug).catch((e) => {
        if (isAppError(e, 'notFound')) notFound();   // → HTTP 404 REAL (AC-9)
        throw e;                                      // → error.tsx del segmento
      });
      // ...listado + paginación en T4.3
    }
    ```
    ```text
    app/(storefront)/categorias/[slug]/
      page.tsx        ✅
      not-found.tsx   ✅  copy §10.2, accionable (link a la home y a los rubros)
      error.tsx       ✅  reintento + captureError (resilience #10)
      loading.tsx     ❌  PROHIBIDO — y tampoco en app/(storefront)/ (design.md D10)
    ```
    — per `frontend-next-standards.md` §1 (archivos colocados por segmento) + **`design.md` D10 /
    gap F59**: un `loading.tsx` envuelve el segmento en Suspense, Next transmite el shell con
    **status 200 ya comprometido**, y el `notFound()` posterior llega como fallback de streaming
    dentro de un 200 — el soft-200 que AC-9 prohíbe. Medido en US-003 aislando archivo por archivo.
    Un `loading.tsx` en el **route group** rompería además el 404 de la ficha.
  - **Exit criterion**: la ruta renderiza server-side el nombre de la categoría como `h1` único; un
    `AppError.notFound` del servicio ejecuta `notFound()` (el status 404 real lo prueba T7.3);
    existen `not-found.tsx` (accionable, con salida a la home/rubros) y `error.tsx` (reintento +
    reporte a Sentry) en el segmento; **no existe ningún `loading.tsx` en todo el árbol
    `app/(storefront)`**; un error no-404 se propaga al boundary en vez de tragarse. Tests: éxito
    (renderiza el nombre), 404 (invoca `notFound`, con `next/navigation` espiado) y error no-404
    (propaga).
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/storefront/CategoryPage && pnpm --filter @dsm/web build && ! find "apps/web/app/(storefront)" -name 'loading.tsx' | grep -q .`

- [x] **T4.2** `ProductCard` + grilla responsive + `ProductImage` parametrizado por contexto (AC-3, AC-5, AC-7) (0.75 h)
  - **AS-BUILT 2026-08-18**: 100 tests verdes en `src/features/storefront` + typecheck limpio. `ProductImage` se parametrizó con `IMAGE_VARIANTS` y `variant` **default `hero`**, así que ningún call-site de US-003 cambió y sus 4 tests siguen pasando; la variante `card` emite los `sizes` de grilla y `priority: false`. La card es un único `<Link>` a la ficha y **no contiene ningún control de compra** — AC-5 se cumple por construcción, y hay dos tests que fallan si aparece un `button` o un "Agregar".
  - **Pattern**:
    ```tsx
    // src/features/storefront/ProductCard.tsx — Server Component; TODA la card es un <a>
    <Link href={`/productos/${item.slug}`}
          className="group flex flex-col gap-2 rounded-md p-4 shadow-sm focus:outline-none focus-visible:shadow-focus">
      <ProductImage src={item.image_url} name={item.name} categoryName={categoryName} variant="card" />
      <h3 className="line-clamp-2 text-lg font-semibold">{item.name}</h3>
      <p className="text-lg font-bold tabular-nums">{formatArs(item.price_ars_cents)}</p>
      <p className="text-xs text-gray-500">IVA incluido</p>
      {!item.in_stock && <span className="…rounded-full…">Sin stock</span>}
    </Link>
    // grilla: grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 lg:gap-6
    ```
    ```tsx
    // src/features/storefront/ProductImage.tsx — se PARAMETRIZA, no se duplica (design.md D9)
    type ImageVariant = 'hero' | 'card';
    const IMAGE_VARIANTS = {
      hero: { sizes: '(max-width: 1024px) 100vw, 50vw', priority: true },   // default: no cambia call-sites
      card: { sizes: '(max-width: 768px) 50vw, 25vw',  priority: false },   // §8.1 grid
    } as const;
    ```
    — per design-system §7.3 (jerarquía imagen → nombre → precio → disponibilidad; la CTA "Agregar"
    es `Deferred: US-007` — ver `design.md` D8), §7.4 (`formatArs`, mismo helper server/client, sin
    hydration mismatch), §7.7 (badge con **texto**: el color nunca es el único portador de
    significado), §4 (grilla 2/3/4), §8.1 (`sizes` por contexto). **Ninguna** card lleva `priority`:
    veinte imágenes prioritarias compiten entre sí y **empeoran** el LCP.
  - **Exit criterion**: la card renderiza nombre, precio formateado en ARS (`$ 12.500`, nunca
    centavos) con "IVA incluido", imagen (o el placeholder `package` cuando `image_url` es null) y,
    **sólo si `in_stock` es false**, el badge "Sin stock" con texto visible; **ninguna** card
    contiene un control de compra (AC-5 por construcción); toda la card es un único link a
    `/productos/{slug}` con nombre accesible = nombre del producto; `ProductImage` con
    `variant="card"` emite los `sizes` de grilla y **no** `priority`, y con el default (`hero`) se
    comporta exactamente como antes (los tests de US-003 siguen verdes); la grilla usa 2/3/4
    columnas. Tests: con stock, sin stock (falla si aparece "Agregar"), sin imagen, y formato de
    precio (falla si se muestran centavos o sin separador de miles).
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/storefront/ProductCard src/features/storefront/ProductImage`

- [x] **T4.3** Paginación server-side por `searchParams` (AC-3, AC-7, AC-9) (0.75 h)
  - ⚠️ **Autoría partida (no reescribir historia)**: `Pagination.tsx`, `Pagination.test.tsx` y el `page.tsx` de esta task entraron en el commit **`6ab9bf9` ("docs(openspec): US-014 — tres decisiones del PO")**, de la sesión de US-014, que barrió el working tree mientras yo escribía. El resto de T4.3 quedó en `5a1645a`. El contenido es correcto y los tests pasan; lo que está mal es el mensaje que los describe. **Este caso no lo previene ninguna disciplina de staging**: no es "mi commit se llevó lo ajeno" sino "un commit ajeno se llevó lo mío antes de que yo lo stagee" — cuando corrí `git add`, ya no había nada que stagear.
  - **AS-BUILT 2026-08-18**: 19 tests verdes. `normalizePage` es una función pura exportada y testeada aparte (7 casos: `abc`/`0`/`-1`/`2.5`/ausente → 1). La página 1 se enlaza **sin** `?page=1`, así que hay una sola URL canónica. Fuera de rango → `notFound()`; vacío en página 1 → 200 (la categoría existe, AC-6). AC-7 se cumple por construcción: `PAGE_SIZE` es fijo y no se toma de la query, así que ninguna URL manipulada puede pedir el catálogo entero.
  - **Pattern**:
    ```tsx
    // Normalización: page malformada (abc, 0, -1, 2.5) → 1; el canonical apunta a la URL limpia.
    const page = Number.parseInt(sp.page ?? '1', 10);
    const current = Number.isInteger(page) && page >= 1 ? page : 1;
    const { data, pagination } = await categoriesStorefrontService.listProducts(slug, current);
    // Página fuera de rango → 404 REAL (OQ-FE-9): una página 4 que no existe es exactamente
    // la "página fantasma indexable" que AC-9 prohíbe. Vacío en page 1 → 200 + estado vacío (AC-6).
    if (current > 1 && data.length === 0) notFound();
    ```
    ```tsx
    // src/features/storefront/Pagination.tsx — <a href> reales: navegables sin JS e indexables
    <nav aria-label="Paginación">
      <Link href={href(current - 1)} rel="prev">Anterior</Link>
      {pages.map(n => <Link key={n} href={href(n)} aria-current={n === current ? 'page' : undefined}>{n}</Link>)}
      <Link href={href(current + 1)} rel="next">Siguiente</Link>
    </nav>
    // href(1) === `/categorias/${slug}` (sin ?page=1: una sola URL canónica para la página 1)
    ```
    — per `api-standards.md` §6.3 (paginación offset con `total`) + `design.md` D3. **AC-7 se cumple
    por construcción**: `limit` es fijo 20 y no configurable por query — el catálogo completo nunca
    viaja, y cambiar de página es otra URL que trae otros 20. Targets ≥ 44×44 px (§11).
  - **Exit criterion**: `/categorias/{slug}?page=2` renderiza server-side los productos con
    `offset=20` y **ningún** request pide `limit > 20`; la página 1 es accesible **sin** `?page=1` y
    ese es el único enlace hacia ella; una `page` malformada se normaliza a 1 y responde 200; una
    `page` fuera de rango ejecuta `notFound()`; los controles de paginación son `<a href>` con
    `aria-current="page"` en la activa y `rel="prev"/"next"` en los extremos, y no se renderiza
    "Anterior" en la primera ni "Siguiente" en la última. Tests: cálculo de offset por página, límite
    fijo, normalización de `page` inválida, `notFound` en fuera de rango, y los `rel`/`aria-current`.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/storefront/Pagination src/features/storefront/CategoryPage`

- [x] **T4.4** Estado vacío accionable (AC-6) (0.25 h)
  - **AS-BUILT 2026-08-18**: 10 tests verdes en `CategoryPage` + lint limpio. `CategoryEmptyState` con ícono + mensaje + salida: los subrubros cuando existen, y siempre el link a todos los rubros. La grilla y la paginación no se renderizan. La prop se llama `subcategories` y no `children`: eslint (`react/no-children-prop`) rechaza pasar `children` como prop, y además el nombre confundía la jerarquía de React con la del catálogo.
  - **Pattern**:
    ```tsx
    // design-system §10.1: "ícono + mensaje + CTA" — nunca un vacío mudo.
    // Copy §10.2 (voz práctica, vos): "Todavía no hay productos publicados en esta categoría."
    // Navegación de salida: los subrubros de esta categoría si los hay, + "Ver todos los rubros" (→ /).
    ```
    — per design-system §10.1/§10.2 + AC-6 ("ve un estado vacío con un mensaje claro **y puede
    navegar a otros rubros**"). Un rubro **con** subrubros pero sin productos propios muestra igual
    sus subrubros (AC-1: "subrubros **y/o** productos"): el vacío aplica a la zona de la grilla.
  - **Exit criterion**: una categoría existente con `data: []` y `total: 0` en la página 1 responde
    **200** (no 404) y muestra ícono + mensaje + al menos un camino de navegación real (subrubros si
    los hay, y siempre el link a los rubros); la grilla y la paginación **no** se renderizan. Test que
    **falla** si el estado vacío no ofrece ningún link de salida.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/storefront/CategoryPage`

---

## Fase 5: SEO de sitio (AC-4) — `design.md` D4, D5

- [x] **T5.1** Metadatos de categoría + canonical por página + `rel=prev/next` + JSON-LD `BreadcrumbList` (0.5 h)
  - **AS-BUILT 2026-08-18**: 9 tests propios (7 de `categoryMetadata` + 2 de `CategoryJsonLd`); 126 verdes en todo `storefront`, typecheck y build OK. El canonical es **auto-referencial** por página (test que falla si apunta a la 1) y ninguna página lleva `noindex`. `CategoryJsonLd` **reusa `serializeJsonLd` de US-003** en vez de duplicar el escape: una sola implementación evita que una copia se olvide de escapar `<`. Test con `</script>` en el nombre en ambos módulos. La página también renderiza el `Breadcrumb` visible con el rubro padre cuando existe.
  - **Pattern**:
    ```tsx
    // src/features/storefront/categoryMetadata.ts — función pura, testeable (molde de metadata.ts de US-003)
    export function categoryMetadata(cat: StorefrontCategory | null, page: number): Metadata {
      if (!cat) return { title: `Categoría no encontrada — ${SITE_NAME}` };
      const base = `${publicEnv.NEXT_PUBLIC_SITE_URL}/categorias/${cat.slug}`;
      return {
        title: page === 1 ? `${cat.name} — ${SITE_NAME}` : `${cat.name} — Página ${page} — ${SITE_NAME}`,
        description: `Comprá ${cat.name.toLowerCase()} en DSM…`,
        // AUTO-referencial: canonicalizar todo hacia la página 1 des-indexa los productos
        // de la página 2 en adelante — la mayoría del catálogo (design.md D4).
        alternates: { canonical: page === 1 ? base : `${base}?page=${page}` },
        openGraph: { type: 'website', siteName: SITE_NAME, title: cat.name, url: … },
      };
    }
    ```
    ```tsx
    // rel prev/next: React 19 hoistea <link> al <head> — no es un "manual head hack" (next-standards §10),
    // es la API disponible para los rel que el objeto Metadata no modela.
    {hasPrev && <link rel="prev" href={href(page - 1)} />}
    {hasNext && <link rel="next" href={href(page + 1)} />}
    ```
    ```tsx
    // JSON-LD BreadcrumbList — MISMA serialización segura que ProductJsonLd (US-003 T3.3):
    // los nombres de categoría los escribe el dueño → input NO confiable.
    <script type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd).replace(/</g, '\\u003c') }} />
    ```
    — per `frontend-next-standards.md` §6 (Metadata API, sin `<head>` manual) + `security-standards.md`
    §6 (output encoding: el JSON-LD es el **único** `dangerouslySetInnerHTML` admitido) + `design.md` D4.
  - **Exit criterion**: el HTML de una página de categoría trae `title` con el nombre de la categoría
    (y "Página N" cuando N > 1), `description` propia, canonical **absoluto y auto-referencial** de
    esa página, y OG; ninguna página lleva `noindex`; las páginas intermedias emiten `rel="prev"` y
    `rel="next"` y las extremas sólo el que corresponde; existe exactamente **un**
    `<script type="application/ld+json">` con `@type: BreadcrumbList` y los ancestros correctos; una
    categoría cuyo nombre contiene `</script>` **no** rompe el documento (test con input malicioso
    que falla si falta el escape). Tests: metadata de página 1 y de página N, categoría inexistente
    (no explota), y el JSON-LD con input malicioso.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/storefront/categoryMetadata src/features/storefront/CategoryJsonLd`

- [x] **T5.2** `app/sitemap.ts`: home + rubros + subrubros + fichas de producto, fresco por el mismo tag (0.75 h)
  - **AS-BUILT 2026-08-18**: 6 tests del sitemap + 2 de la paginación en el servicio (15 en total ahí). Se recorre **sólo las hojas** —un rubro agrega los productos de sus subrubros (D1 del backend), así que recorrer ambos niveles duplicaría cada ficha— y hay un test que falla si se le piden productos a un rubro con hijos. Doble red contra duplicados: hojas + `Set`. La paginación vive en `listAllSlugs` del servicio con `SITEMAP_PAGE_SIZE = 100` (constante propia, para no tocar el `PAGE_SIZE` fijo que garantiza AC-7 en la grilla pública) y **corta ante una página vacía**, porque un `total` inconsistente con `data` colgaría la generación del sitemap en un bucle infinito.
  - **Pattern**:
    ```ts
    // src/features/storefront/sitemap.ts — la lógica vive en src (testeable); app/sitemap.ts la re-exporta
    export async function buildSitemap(): Promise<MetadataRoute.Sitemap> {
      const rubros = await categoriesStorefrontService.getTree().catch(() => []);
      // HOJAS a propósito: un rubro AGREGA los productos de sus hijos (D1 del backend),
      // así que recorrer rubros y subrubros duplicaría cada ficha en el sitemap.
      const hojas = rubros.flatMap(r => r.children.length ? r.children : [r]);
      const paginas = await Promise.all(hojas.map(c => allProductsOf(c.slug)));  // limit=100 por página
      return [home, ...rubros.map(url), ...subrubros.map(url), ...paginas.flat().map(url)];
    }
    // Resiliencia: si el árbol falla, devolver al menos la home. Un sitemap que responde 500
    // le enseña al crawler a no volver; uno incompleto se corrige en la próxima regeneración.
    ```
    — per `frontend-next-standards.md` §6 (convenciones de archivo de metadata) + `design.md` D5.
    **Frescura**: los fetches llevan el tag `CATALOG_TAG`, así que la misma `revalidateCatalog()` de
    T2.1 refresca el sitemap; `revalidatePath('/sitemap.xml')` purga además su entrada de ruta.
    `Deferred: generateSitemaps particionado — disparador > 50.000 URLs`.
  - **Exit criterion**: el sitemap incluye la home, **todos** los rubros, **todos** los subrubros y
    **todas** las fichas de producto publicadas, cada URL **absoluta** (con `NEXT_PUBLIC_SITE_URL`) y
    **sin duplicados** (un producto de un subrubro aparece **una** sola vez, no también bajo su
    rubro); ninguna URL de `/admin/*` aparece; los listados se piden con `limit=100` y paginan hasta
    agotar `total`; si el árbol falla, devuelve al menos la home en vez de lanzar. Tests con MSW: un
    árbol con rubro + 2 subrubros y productos en ambos → conteo exacto de URLs y **cero duplicados**
    (falla si se recorren rubros y subrubros por igual), catálogo de más de 100 productos en una
    categoría → se piden las páginas siguientes, y árbol caído → sólo la home.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/storefront/sitemap`

- [x] **T5.3** `app/robots.ts`: allow público, `Disallow: /admin/`, puntero al sitemap (0.25 h)
  - **AS-BUILT 2026-08-18**: 3 tests verdes. El sitemap se declara con URL **absoluta** construida desde `NEXT_PUBLIC_SITE_URL` (un sitemap relativo en `robots.txt` es inválido y los crawlers lo ignoran), y hay un test que falla si alguna ruta pública cae en `disallow`.
  - **Pattern**:
    ```ts
    // app/robots.ts
    export default function robots(): MetadataRoute.Robots {
      return {
        rules: { userAgent: '*', allow: '/', disallow: '/admin/' },
        sitemap: `${publicEnv.NEXT_PUBLIC_SITE_URL}/sitemap.xml`,
      };
    }
    ```
    — per `frontend-next-standards.md` §6 + ADR-0010. El `Disallow` es **defensa en profundidad de
    indexación, no control de acceso**: la autoridad sigue siendo el `AdminGuard` en el cliente y el
    backend en el servidor (mismo encuadre que el `X-Robots-Tag` que US-003 T0.3 ya puso).
  - **Exit criterion**: `/robots.txt` declara `Disallow: /admin/`, permite el resto y apunta al
    sitemap con URL **absoluta** construida desde `NEXT_PUBLIC_SITE_URL`; el objeto no contiene
    ninguna ruta pública en `disallow`. Test que **falla** si `disallow` no incluye `/admin/` o si el
    sitemap queda como URL relativa.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/storefront/robots`

---

## Fase 6: Observabilidad (US §9, E2E §18) — `design.md` D12

- [x] **T6.1** Evento público `category_shown` (sin PII) + tipado del catálogo de eventos (0.25 h)
  - **AS-BUILT 2026-08-18**: 6 tests verdes + typecheck. El evento entró en la unión `BusinessEvent` **y** en `PUBLIC_EVENTS`; hay un test que falla si el payload trae `operator_id` —sin ese registro, cada visita anónima se contaría como acción del dueño y ensuciaría las métricas de US-016—. El guard de doble emisión usa una clave `slug:page` en vez de un booleano: StrictMode no duplica, pero **cambiar de página sí emite una vista nueva**, que es lo correcto.
  - **Pattern**:
    ```ts
    // src/lib/observability/events.ts — extender la unión Y el set PUBLIC_EVENTS
    export type BusinessEvent = … | 'pdp_shown' | 'category_shown';
    const PUBLIC_EVENTS = new Set<BusinessEvent>(['pdp_shown', 'category_shown']);
    // ↑ sin esto el evento heredaría operator_id: 'admin' y etiquetaría cada visita
    //   anónima como acción del dueño, ensuciando las métricas de US-016.
    ```
    ```tsx
    // hoja client mínima (molde de ProductViewTracker):
    useEffect(() => { track('category_shown', { slug, is_rubro, page, product_count,
                                                screen_name: 'category' }); }, [slug, page]);
    ```
    — per `observability-patterns` §9.5.2 (evento `{screen}_shown` por pantalla) y §3.3 (`slug` como
    propiedad de **evento**, jamás dimensión de métrica — cardinalidad); sin PII (lectura anónima).
    Motivo: con la caché por tag el backend sólo ve los re-fetches post-invalidación, así que su
    `category.viewed` **subcuenta** estructuralmente (mismo razonamiento que `pdp_shown`).
  - **Exit criterion**: al montarse una página de categoría en el browser se emite **exactamente un**
    `category_shown` con `slug`, `is_rubro`, `page`, `product_count` y `screen_name`, y **ninguna**
    propiedad con PII; el evento está en la unión `BusinessEvent` (uno fuera del catálogo no compila)
    **y** en `PUBLIC_EVENTS` (el test **falla** si el payload trae `operator_id`); cambiar de página
    emite un evento nuevo, pero un re-render con las mismas props no. Test con sink espía.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/lib/observability src/features/storefront/CategoryViewTracker && pnpm --filter @dsm/web typecheck`

---

## Fase 7: A11y + E2E (SSR / 404 / paginación / invalidación reales)

- [x] **T7.1** Accesibilidad — axe sin violaciones en los estados de la página de categoría (0.5 h)
  - **AS-BUILT 2026-08-18**: 8 tests verdes (3 estados por axe + 5 asserts estructurales).
  - **Encontró un defecto real, no un falso positivo**: axe reportó `heading-order` porque la card usa `h3` (así lo pedía el `Pattern:` de T4.2) directamente bajo el `h1` de la categoría, saltando el `h2`. El `Pattern:` de T4.2 y el criterio de T7.1 ("orden `h1 → h2 → h3`") se contradecían. Se resolvió **conciliando ambos**: se agregó un `<h2 className="sr-only">Productos</h2>` antes de la grilla, así la card conserva su `h3` del Pattern y el orden queda correcto. Un lector de pantalla ahora anuncia la sección de productos, que antes no existía como nivel.
  - **Pattern**: jest-axe sobre (a) categoría con productos, (b) categoría vacía, (c) grilla con un
    item sin stock → **0 violaciones**; asserts adicionales: `h1` único, orden `h1 → h2 → h3`,
    breadcrumb con `aria-current="page"`, paginación con `aria-current="page"` y `nav` etiquetada,
    `alt` descriptivo (nunca "imagen"), badge "Sin stock" con texto — per design-system §11 (WCAG 2.1
    AA) + `qa-frontend-standards.md` §23 (axe a nivel componente); mismo molde que
    `src/features/storefront/a11y.test.tsx` de US-003. El recorrido **por teclado end-to-end** es
    `QA-US-002` §5.3, no se duplica acá.
  - **Exit criterion**: existe un spec de a11y que corre axe sobre los tres estados y **falla ante
    cualquier violación**; los asserts de `h1` único, de jerarquía de headings y de `aria-current`
    fallan si se rompen (verificado invirtiendo temporalmente el assert durante el desarrollo).
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/storefront/categoryA11y`

- [ ] **T7.2** Stub de contrato: endpoints de categorías + `__reset` **por alcance** + log de requests (0.75 h)
  - **Pattern**:
    ```js
    // apps/web/e2e/support/api-stub.mjs — se EXTIENDE el stub de US-003 (design.md D13)
    // GET /v1/categories                      → árbol de dos niveles (rubros con children)
    // GET /v1/categories/{slug}               → detalle con parent/children; 404 uniforme si no existe
    // GET /v1/categories/{slug}/products      → { data, pagination:{limit,offset,total} }
    //    · un RUBRO agrega los productos de sus subrubros; un SUBRUBRO sólo los propios (D1 del BE)
    //    · honra limit/offset; 422 si limit>100 o offset<0
    // POST /__reset?scope=pdp|catalog         → resetea SÓLO ese fixture (sin scope: todo, como hoy)
    // GET  /__requests                        → log de requests recibidos (para probar AC-7 de verdad)
    //
    // Fixture propio del browse: rubro 'climatizacion' + subrubro 'compresores-e2e' con 25
    // productos (dos páginas). NO toca heladera-exhibidora / taladro-percutor / ventilador-de-techo,
    // sobre los que asertan los specs de US-003 (workers paralelos).
    ```
    — per `playwright-stability` (aislamiento entre specs paralelos; fixtures disjuntos) +
    `design.md` D13. **Por qué el `__reset` por alcance**: hoy es global y `pdp-invalidation.spec.ts`
    lo invoca; con `fullyParallel: true`, un reset ajeno le devuelve al spec de catálogo el producto
    que acaba de archivar → flake intermitente que se diagnostica mal. El stub es código de test
    fuera de `src/`/`app/`: no entra en el gate F48 (es el servidor del otro lado, no un cliente
    HTTP de la app).
  - **Exit criterion**: el stub sirve los tres endpoints con las semánticas del contrato (agregación
    rubro→subrubros, paginación con `total` correcto, 404 para slug inexistente, 422 para
    `limit`/`offset` fuera de rango); `POST /__reset?scope=catalog` restaura **sólo** el fixture del
    browse y deja intacto el de la PDP (y viceversa); `GET /__requests` devuelve los requests
    recibidos con su query string; `e2e/pdp-invalidation.spec.ts` usa su `scope` y sigue verde. Un
    **self-test ejecutable** levanta el stub en un puerto efímero, ejercita cada semántica y sale con
    código distinto de 0 si alguna falla.
  - **Verify**: `node apps/web/e2e/support/api-stub.selftest.mjs`
  - ⚠️ **Riesgo señalado por la sesión de QA (2026-08-18), verificar antes de commitear**: `pdp-invalidation.spec.ts` (US-003, el **único** spec que cubre AC-9 end-to-end) depende de que el reset devuelva el catálogo entero a su estado inicial, y usa un precio único por corrida para no dar falso verde contra un valor cacheado. Un `__reset` parcial puede romperlo **en silencio** —seguiría verde por la razón equivocada—, así que hay que confirmar que `ventilador-de-techo` vuelve a `1250000` tras un reset por alcance. Coordinar con la sesión de QA al llegar acá.

- [ ] **T7.3** E2E — SSR indexable, 404 real y paginación, **sobre `response.status()` y el body del servidor** (0.75 h)
  - **Pattern**:
    ```ts
    // apps/web/e2e/category-ssr.spec.ts
    const res = await page.goto('/categorias/climatizacion');
    expect(res!.status()).toBe(200);
    const html = await res!.text();                       // ← body del SERVIDOR, no DOM hidratado
    expect(html).toContain('Compresores');                // subrubro (AC-1)
    expect(html).toContain(nombreDelPrimerProducto);      // productos en el HTML (AC-10)
    expect(html).toContain('BreadcrumbList');             // JSON-LD (AC-4)

    const noExiste = await page.goto('/categorias/no-existe-jamas');
    expect(noExiste!.status()).toBe(404);                 // 404 REAL, no soft-200 (AC-9)

    const fueraDeRango = await page.goto('/categorias/compresores-e2e?page=99');
    expect(fueraDeRango!.status()).toBe(404);             // OQ-FE-9

    // AC-7 contra el LOG DEL STUB, no contra el DOM: contar tarjetas pasaría igual
    // aunque el servidor se hubiera traído las 5.000.
    await page.goto('/categorias/compresores-e2e?page=2');
    const reqs = await (await page.request.get(`${STUB}/__requests`)).json();
    expect(reqs.some(r => r.url.includes('limit=20&offset=20'))).toBe(true);
    expect(reqs.every(r => !/limit=(2[1-9]|[3-9]\d|\d{3,})/.test(r.url))).toBe(true);
    ```
    — per `playwright-stability` (sin `waitForTimeout`; aserciones sobre la respuesta) +
    `frontend-next-standards.md` §9 (E2E contra `next build && next start`). **Una aserción de DOM no
    puede distinguir un 404 real de un soft-200**: la página renderizada se ve igual. `page.route`
    tampoco sirve: el fetch es server-side.
  - **Exit criterion**: el spec asserta, sobre el **body y el status de la respuesta del servidor**:
    200 + subrubros + productos + JSON-LD en una categoría con contenido; 200 + estado vacío en una
    categoría sin productos; **404** en slug inexistente; **404** en página fuera de rango; y que la
    página 2 pidió `limit=20&offset=20` y **ningún** request pidió más de 20 ítems. El smoke de
    US-001 y los specs de US-003 siguen verdes.
  - **Verify**: `pnpm --filter @dsm/web test:e2e`

- [ ] **T7.4** E2E del circuito de invalidación del catálogo (AC-8): archivar en el panel → desaparece del listado **ya** (0.5 h)
  - **Pattern**:
    ```ts
    // apps/web/e2e/category-invalidation.spec.ts
    // 1) POST /__reset?scope=catalog  → fixture propio, aislado del spec de la PDP.
    // 2) Cargar /categorias/compresores-e2e → la Data Cache queda poblada CON el producto.
    // 3) ARCHIVARLO DESDE EL PANEL (/admin/productos/{id}) — es el camino que dispara el puente.
    //    El stub deja de listarlo desde ese momento.
    // 4) Recargar la categoría y assertar que el nombre YA NO está en el HTML del servidor,
    //    SIN esperar ningún TTL: si la invalidación no corrió, el assert falla de inmediato
    //    contra la caché de 1 h — ésa es justamente la prueba.
    const tras = await page.goto('/categorias/compresores-e2e');
    expect(await tras!.text()).not.toContain(nombreArchivado);
    ```
    — per `frontend-next-standards.md` §3/§4 (invalidación tras mutación) + `design.md` D2 +
    `playwright-stability` (sin `waitForTimeout`: la ausencia de espera **es** la aserción). Requiere
    el build de producción (las Server Actions no se comportan igual en `next dev`) — ya cubierto por
    el `webServer` de `playwright.config.ts`.
  - **Exit criterion**: el spec demuestra el circuito completo —listado cacheado con el producto →
    archivado exitoso **por la UI del panel** → recarga sin el producto en el HTML del servidor, sin
    espera temporal—; el test **falla** si se quita `revalidateCatalog()` del puente (verificado
    quitándolo temporalmente durante el desarrollo); el spec resetea sólo su propio alcance y no pisa
    los fixtures de US-003.
  - **Verify**: `pnpm --filter @dsm/web test:e2e`

---

## Fase 8: Documentación

- [ ] **T8.1** README de `apps/web`: mapa de rutas públicas, sitemap/robots y el circuito de invalidación (0.25 h)
  - **Pattern**: per `documentation-standards.md` §11.1 (README cuando cambian rutas/config). Sumar:
    (a) las rutas públicas nuevas (`/`, `/categorias/{slug}`, `/sitemap.xml`, `/robots.txt`) al mapa
    que US-003 dejó; (b) **el circuito de invalidación**: tag `catalog`, qué lo purga y por qué toda
    mutación de producto o categoría del panel debe pasar por el puente; (c) la nota de **F59**
    ampliada: ningún `loading.tsx` en `(storefront)` —no sólo en la ficha— porque degrada el 404 a
    soft-200. **Cero env nuevas**: se reusan las públicas existentes.
  - **Exit criterion**: `apps/web/README.md` documenta las cuatro rutas nuevas, el tag `catalog` con
    quién lo invalida, y la prohibición de `loading.tsx` a nivel route group; no se agrega ninguna
    variable de entorno nueva y ningún secreto lleva prefijo `NEXT_PUBLIC_`.
  - **Verify**: `grep -q "/categorias" apps/web/README.md && grep -q "sitemap" apps/web/README.md && grep -q "catalog" apps/web/README.md && grep -q "loading.tsx" apps/web/README.md && ! grep -rnE "NEXT_PUBLIC_[A-Z_]*(SECRET|TOKEN|PASSWORD|KEY)" apps/web/src apps/web/app apps/web/.env.example | grep -q .`

---

## Verification (suite-level)

- [ ] Unit + component + integración verdes: `pnpm --filter @dsm/web test -- --run`
- [ ] Lint limpio: `pnpm --filter @dsm/web lint`
- [ ] Typecheck limpio: `pnpm --filter @dsm/web typecheck`
- [ ] Build de producción OK: `pnpm --filter @dsm/web build`
- [ ] E2E verde (US-001 + US-003 + los specs nuevos de categoría): `pnpm --filter @dsm/web test:e2e`
- [ ] Codegen del contrato en sync (gate `frontend-codegen-fresh`):
  `pnpm --filter @dsm/web codegen && git diff --quiet -- apps/web/src/api/generated`
- [ ] **Sin `loading.tsx` en todo el storefront** (D10 / F59 — un skeleton en el route group rompería
  el 404 de la categoría **y** el de la ficha):
  `! find "apps/web/app/(storefront)" -name 'loading.tsx' | grep -q .`
- [ ] `dangerouslySetInnerHTML` sólo para JSON-LD (security-standards §6):
  `! grep -rn "dangerouslySetInnerHTML" apps/web/src apps/web/app | grep -vi "ld+json\|jsonLd\|Ld\b" | grep -q .`
- [ ] Sin `fetch` crudo fuera del cliente (F48): el único `fetch` de la app sigue en
  `src/lib/http/client.ts`; el stub de E2E es servidor de test, no cliente de la app.
- [ ] Reconciliación contra el `design.md` completo (F51): D1–D13 construidas o con `Deferred:`
  documentado (US-004 / US-006 / US-007 / OQ-FE-7 / OQ-FE-11).
- [ ] Índice actualizado: `docs/_index/openspec-changes.yaml` refleja `status` y `estimate-hours` de
  este change.
