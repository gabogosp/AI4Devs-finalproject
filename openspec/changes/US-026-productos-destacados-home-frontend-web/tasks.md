---
parent-us: US-026
discipline: frontend-web
variant: null
language: es
---

# US-026 Frontend-web — Tasks

> Cada task es closure-grade: atómica, con `Exit criterion:` observable y `Verify:` con el
> comando exacto que `/develop-frontend-web` corre — siempre en forma **terminante** (F49):
> `pnpm --filter @dsm/web test -- <patrón>` (el script `test` de `apps/web/package.json` ya es
> `vitest run`, no `vitest` a secas). Los comandos asumen la **raíz del repo** como cwd.
>
> **Estructura en dos fases, explícita por diseño** (`design.md` §Context): la **Fase A** no
> tiene ninguna dependencia externa a este change — ejecutable y cerrable en la misma sesión que
> este plan. La **Fase B** lleva `Blocked-by: US-026-productos-destacados-home-backend` (change
> todavía no planificado) en cada task — `/develop-frontend-web` ejecuta la Fase A completa y
> se **detiene** antes de la Fase B hasta que ese change exista y publique el contrato.
>
> **Estimación dual**: Fase A **~2 h AI-asistido** / **~4 h tradicional** (6 tasks, presentacional
> puro, sin red — un componente + un tracker + un cambio de tipo). Fase B **~1,5 h AI-asistido**
> / **~3 h tradicional** (6 tasks de wiring: sin container de cliente, la composición es un
> `await` más en un Server Component ya existente). Total ≈ 3,5 h AI-asistido, cercano al
> presupuesto de la US (§7, FE-US-026: 4h).

## Traceability matrix (AC de la US → tasks)

| AC | Descripción | Fase A | Fase B |
|---|---|---|---|
| AC-1 | Home muestra "Novedades" (≤8, últimos publicados, linkea a ficha) | T-A3 (renderiza items dados, link heredado de `ProductCard`) | T-B4, T-B5 |
| AC-2 | Home muestra "Más vendidos" (≤8, por cantidad vendida, linkea a ficha) | T-A3 (mismo componente, título distinto) | T-B4, T-B5 |
| AC-3 | Menos de 8 disponibles → sin placeholders | T-A3 (renderiza exactamente el array dado, sin relleno) | T-B5 |
| AC-4 | Catálogo sin productos publicados → ninguna sección se muestra; rubros intactos | T-A3 (`items: []` → `null`, D2) | T-B5 |
| AC-5 | Sin ventas todavía → "Más vendidos" no se muestra; "Novedades" sí si hay productos | T-A3 (mismo mecanismo, independiente por sección) | T-B5 |
| AC-6 | Empate de ventas → orden determinista (tie-break del backend) | — (FE no reordena, ver `design.md` Non-goals) | T-B5 (asserta que el orden renderizado == orden recibido, sin re-sort) |
| AC-7 | Producto despublicado no aparece | — (FE no filtra por status, ver `design.md` Non-goals) | T-B5 (renderiza exactamente lo recibido, mismo mecanismo que detectaría una regresión) |
| AC-8 | Sin stock, igual visible, marcado no oculto | T-A3 (verificado explícitamente — comportamiento heredado de `ProductCard`, no reimplementado) | T-B5 |

---

## Fase A — Presentacional, cerrable ahora (sin dependencias externas)

### Pre-requisitos

- [x] **T-A0 — `apps/web` limpio antes de empezar**
  - **Exit criterion**: no hay cambios sin commitear bajo
    `apps/web/src/features/storefront/HomeFeatured*` (los archivos todavía no existen, así que
    esto se cumple trivialmente salvo que otra sesión ya haya empezado a escribir ahí).
  - **Verify**: `git status --porcelain apps/web/src/features/storefront/HomeFeatured* 2>/dev/null` vacío

### `ProductCard.categoryName` opcional

- [x] **T-A1 — Relajar `ProductCard.categoryName` a opcional**
  - **Pattern**: `per design.md §Approach` — widening compatible hacia atrás: cambiar la firma
    de `categoryName: string` a `categoryName?: string` en `ProductCard.tsx`; `ProductImage.tsx`
    ya acepta `categoryName?: string` (US-004), así que no hace falta tocarlo. Actualizar el
    JSDoc del componente para reflejar que la categoría es opcional cuando el producto no
    pertenece a una sola categoría (destacados del home).
  - **Exit criterion**: `ProductCard` compila y renderiza sin pasar `categoryName`; todos los
    call-sites existentes (`CategoryPage.tsx`, que sí pasa `category.name`) siguen compilando sin
    cambios.
  - **Verify**: `pnpm --filter @dsm/web test -- ProductCard`

- [x] **T-A2 — Extender `ProductCard.test.tsx` con el caso sin `categoryName`**
  - **Exit criterion**: un nuevo test renderiza `<ProductCard item={item()} />` (sin
    `categoryName`) y verifica que la imagen usa el `alt` de sólo-nombre (mismo comportamiento ya
    cubierto por `ProductImage.test.tsx` para `categoryName={undefined}`, pero verificado acá en
    el punto de integración real).
  - **Verify**: `pnpm --filter @dsm/web test -- ProductCard`

### Telemetría (sin HTTP — no toca ningún contrato)

- [x] **T-A3 — `home_featured_shown` en `events.ts` + `PUBLIC_EVENTS`**
  - **Pattern**: `per events.ts` líneas ~10-14 (`category_shown`) — nuevo `BusinessEvent`
    `home_featured_shown`, agregado a `PUBLIC_EVENTS` (superficie de visitante anónimo, no de
    operador, mismo criterio que `pdp_shown`/`category_shown`). Props: `section: 'novedades' |
    'mas_vendidos'`, `item_count: number`, `screen_name: 'home'` — ninguna PII, ningún dato de
    producto individual (sólo agregados).
  - **Exit criterion**: `home_featured_shown` existe en `BusinessEvent` y en `PUBLIC_EVENTS`; un
    test de `events.ts` confirma que está en el set público.
  - **Verify**: `pnpm --filter @dsm/web test -- events`

- [ ] **T-A4 — `HomeFeaturedViewTracker.tsx` + `.test.tsx`**
  - **Pattern**: `per CategoryViewTracker.tsx` — Client Component leaf, `useRef` guard contra el
    doble-montaje de StrictMode, `useEffect` que llama `track('home_featured_shown', { section:
    sectionId, item_count: itemCount, screen_name: 'home' })` una sola vez por `sectionId`.
  - **Exit criterion**: emite el evento exactamente una vez al montar (incluso con
    remount de StrictMode simulado); no emite si se vuelve a renderizar con las mismas props;
    `return null` (sin salida visual).
  - **Verify**: `pnpm --filter @dsm/web test -- HomeFeaturedViewTracker`

### Componente presentacional

- [ ] **T-A5 — `HomeFeaturedSection.tsx` + `.test.tsx`**
  - **Pattern**: `per design.md §D1/§D2/§D3/§D4` — tipa `items: StorefrontProductListItem[]`
    (importado de `@/api/generated/model`, el DTO ya existente — ningún tipo provisional nuevo,
    D1); devuelve `null` cuando `items.length === 0` (D2); reusa la grilla estática de
    `CategoryPage.tsx` (`grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 lg:gap-6`, D3);
    `<h2 id={headingId}>{title}</h2>` + `<section aria-labelledby={headingId}>` (D4); renderiza
    `<ProductCard key={item.slug} item={item} />` por ítem (sin `categoryName`, T-A1) y
    `<HomeFeaturedViewTracker sectionId={id} itemCount={items.length} />` sólo cuando hay items.
  - **Exit criterion**: (a) con `items: []` no renderiza nada (ni `h2` ni `section`) — cubre
    AC-4/AC-5 a nivel de componente; (b) con N items (probado con 3 y con 8) renderiza
    exactamente N `ProductCard`, en el mismo orden del array — cubre AC-3 y la mitad FE de AC-6;
    (c) el `<section>` tiene `aria-labelledby` apuntando al `id` del `<h2>` con el `title` dado;
    (d) un ítem con `in_stock: false` en el array muestra el badge "Sin stock" (comportamiento
    heredado de `ProductCard`, verificado en este punto de integración — AC-8); (e) cada
    `ProductCard` linkea a `/productos/{slug}` (heredado, verificado acá — AC-1/AC-2); (f) con
    items no vacíos, `HomeFeaturedViewTracker` está presente.
  - **Verify**: `pnpm --filter @dsm/web test -- HomeFeaturedSection`

- [ ] **T-A6 — `HomeFeaturedSection.a11y.test.tsx` — axe-core**
  - **Exit criterion**: montado con 8 items (incluido uno sin stock), axe-core reporta 0
    violaciones `serious`/`critical`.
  - **Verify**: `pnpm --filter @dsm/web test -- HomeFeaturedSection.a11y`

### Frontera estructural

- [ ] **T-A7 — Fase A no toca `apps/web/app/`**
  - **Exit criterion**: ningún archivo bajo `apps/web/app/` cambió como parte de la Fase A — la
    composición real en el home es explícitamente Fase B (`design.md` tabla de Riesgos, fila 2).
  - **Verify**: `git diff --stat apps/web/app` vacío

**Fin de Fase A — cerrable en este punto.** Todo lo de arriba pasa sin ningún change adicional
abierto. `develop-frontend-web` puede marcar la Fase A como Done independientemente de cuándo
arranque la Fase B.

---

## Fase B — Bloqueada (`Blocked-by: US-026-productos-destacados-home-backend`, todavía no planificado)

- [ ] **T-B0 — Leer el `design.md` de `US-026-productos-destacados-home-backend` y resolver la
      forma exacta de la respuesta**
  - **Blocked-by**: US-026-productos-destacados-home-backend
  - **Exit criterion**: queda documentado (actualización de este `design.md` §D1) si cada
    endpoint responde un array plano o un envelope `{data, pagination}`, y si efectivamente reusa
    `StorefrontProductListItem` tal cual o una variante — no se empieza T-B2 sin esto resuelto.
  - **Verify**: `design.md` §D1 de este change ya no dice "no está confirmado" (revisión manual
    antes de continuar)

- [ ] **T-B1 — Verificar frescura del codegen**
  - **Blocked-by**: US-026-productos-destacados-home-backend
  - **Pattern**: `per openapi-client-codegen` skill — verificación de frescura, no regeneración
    manual; el orquestador ya corrió el codegen antes de esta task.
  - **Exit criterion**: `pnpm --filter @dsm/web codegen` no produce diff; `apps/web/src/api/generated/`
    exporta los DTOs/Zod/MSW de las dos operaciones nuevas (`novedades`, `mas-vendidos`).
  - **Verify**: `pnpm --filter @dsm/web codegen && git status --porcelain apps/web/src/api/generated/` vacío

- [ ] **T-B2 — `homeFeaturedService.ts` (repository pattern)**
  - **Blocked-by**: US-026-productos-destacados-home-backend, T-B0, T-B1
  - **Pattern**: `per categoriesStorefrontService.ts`/`storefrontService.ts` — llama las
    operaciones **generadas** directamente (sin marca `session`, es público, mismo criterio que
    `storefrontGetProduct`); `parseContract` sobre cada respuesta con el schema Zod generado;
    caché explícita por método (`design.md` §D5): `next: { revalidate: 60, tags:
    ['home:novedades'] }` para `getNovedades()`, `next: { revalidate: 60, tags:
    ['home:mas-vendidos'] }` para `getMasVendidos()` — **nunca** un objeto de caché compartido
    sin declarar por método (el bug de US-025 PR #139 fue exactamente heredar un TTL sin
    declararlo).
  - **Exit criterion**: `homeFeaturedService` expone `getNovedades()` y `getMasVendidos()`, ambos
    devuelven `Promise<StorefrontProductListItem[]>` (o el tipo real resuelto en T-B0 si difiere),
    y cada llamada a la operación generada incluye un objeto `next` con `revalidate` y `tags`
    propios — no un default compartido importado de otro service.
  - **Verify**: `pnpm --filter @dsm/web test -- homeFeaturedService`

- [ ] **T-B3 — Smoke de caché explícita (NFR de la US §9, mitad FE — `design.md` §D5)**
  - **Blocked-by**: T-B2
  - **Pattern**: mockear el módulo de operaciones generadas (`@/api/generated/endpoints`) con
    `vi.mock` y capturar los argumentos de la llamada, mismo mecanismo que cualquier test de
    servicio con MSW pero aserta sobre los **argumentos de la llamada**, no sólo la respuesta.
  - **Exit criterion**: un test dedicado confirma que **cada** llamada de `homeFeaturedService`
    a su operación generada incluye `next.revalidate` (definido, no `undefined`) y `next.tags`
    (array no vacío, específico de la sección) — si algún método omitiera la caché explícita,
    este test lo detecta antes de merge (documentado en `design.md` §D5: esto verifica sólo la
    mitad FE de la garantía; la mitad backend — `@StorefrontCache` por handler — la verifica
    `US-026-productos-destacados-home-backend`).
  - **Verify**: `pnpm --filter @dsm/web test -- homeFeaturedService`

- [ ] **T-B4 — Componer las dos secciones en `app/(storefront)/page.tsx`**
  - **Blocked-by**: T-B2
  - **Pattern**: `per` el `await categoriesStorefrontService.getTree().catch(() => [])` ya
    existente en el mismo archivo — mismo mecanismo de degradación server-side, sin
    `try/catch` explícito ni estado de cliente: `const novedades = await
    homeFeaturedService.getNovedades().catch(() => [])`, ídem `masVendidos`. Renderizado debajo
    de la grilla de rubros, orden Novedades→Más vendidos (US §10):
    `<HomeFeaturedSection id="novedades" title="Novedades" items={novedades} />` seguido de
    `<HomeFeaturedSection id="mas-vendidos" title="Más vendidos" items={masVendidos} />`.
  - **Exit criterion**: `page.tsx` sigue siendo 100% Server Component (ningún `'use client'`
    agregado en ese archivo); las dos secciones aparecen en el orden Novedades→Más vendidos
    cuando ambas tienen datos; un fallo de red en cualquiera de los dos fetches no rompe el
    render del resto de la página (mismo criterio que `rubros`).
  - **Verify**: `pnpm --filter @dsm/web test -- StorefrontHome`

- [ ] **T-B5 — Extender `StorefrontHome.test.tsx` con los 5 escenarios de composición (AC-1 a AC-5)**
  - **Blocked-by**: T-B4
  - **Pattern**: `per` el `vi.mock('@/features/storefront/categoriesStorefrontService', ...)` ya
    existente en el mismo archivo — mismo mecanismo (estado plano controlado por variable, no
    `vi.fn().mockRejectedValue`, por la razón ya documentada en el archivo) para
    `homeFeaturedService`.
  - **Exit criterion**: cubre (a) ambas secciones presentes con datos (AC-1, AC-2); (b) sólo
    "Novedades" cuando `getMasVendidos()` resuelve `[]` (AC-5); (c) ninguna de las dos cuando
    ambas resuelven `[]` y la landing de rubros sigue intacta (AC-4); (d) el orden de los
    `ProductCard` renderizados coincide exactamente con el orden del array mockeado, sin re-sort
    (mitad FE de AC-6); (e) el orden de las secciones en el documento es Novedades antes que Más
    vendidos cuando ambas están presentes.
  - **Verify**: `pnpm --filter @dsm/web test -- StorefrontHome`

## Verification (nivel de suite)

- [ ] Fase A completa: `pnpm --filter @dsm/web test -- HomeFeatured` (todos los `*.test.tsx`
      nuevos en verde, sin red) + `pnpm --filter @dsm/web test -- ProductCard`
- [ ] Fase A: lint/type-check limpios: `pnpm --filter @dsm/web lint && pnpm --filter @dsm/web typecheck`
- [ ] Fase B: `pnpm --filter @dsm/web test -- homeFeaturedService` + `pnpm --filter @dsm/web test -- StorefrontHome`
- [ ] Fase B: `pnpm --filter @dsm/web codegen` sin diff (gate `frontend-codegen-fresh`)
