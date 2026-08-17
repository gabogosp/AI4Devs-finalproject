---
parent-us: US-003
discipline: frontend-web
variant: null
language: es
regenerated-at: 2026-08-17
---

# US-003 Frontend Web — Tasks

> **Plan regenerado el 2026-08-17** (respaldo:
> `openspec/changes/_backups/2026-08-17-1-US-003-ficha-producto-pdp-frontend-web/`). Cambia por
> **OQ-FE-6** (namespace de rutas → **Fase 0 nueva**: el panel se muda a `/admin/*`) y consolida el
> repivote a `slug` (OQ-FE-1). Las tasks ya ejecutadas y **commiteadas** (T1.1, T1.2, T2.1) quedan
> marcadas `[x]` con nota de estado — **no se re-planifican**.
>
> Cada task es closure-grade: atómica, con `Exit criterion:` observable y `Verify:` con el comando
> exacto (**terminante**, F49 — `vitest run`, nunca watch; sin `timeout` que en macOS no existe) que
> `/develop-frontend-web` corre, y que **falla si el criterio no se cumple** (F50 — se ejercita el
> comportamiento, no se greppea su presencia). Comandos desde la **raíz del repo**.
>
> **Estimación dual**: **~9 h AI-asistido** (de las cuales **1.25 h ya están hechas** → restan
> **~7.75 h**) / **~16 h tradicional**. El plan anterior estimaba 7 h / 13 h; el delta viene de la
> Fase 0 (namespace + ADR, 1.25 h) y del desdoble del E2E en smoke SSR/404 (T6.2) + circuito de
> invalidación AC-9 (T6.3) con stub de contrato (D10), que el plan anterior subestimaba. Horas por
> task = AI-asistido.
>
> **Decisiones vigentes**: OQ-FE-1 `slug`; **OQ-FE-6 namespace — storefront en la raíz pública,
> panel en `/admin/*`**; OQ-FE-2 (CTA deshabilitado con seam, solo caso con stock); OQ-FE-4 opción C
> (tag `product:{slug}` + Server Action de invalidación + safety-net `revalidate: 3600`); OQ-FE-5
> (`pdp_shown`). OQ-FE-3 (número real de WhatsApp) sigue diferida — no bloquea (placeholder por env).

## Traceability matrix (AC → tasks)

| AC | Título | Task IDs | Estado |
|---|---|---|---|
| AC-1 | Ficha completa + URL amigable `/productos/{slug}` | **T0.2**, T2.1 ✅, T3.1, T4.1 | in this change |
| AC-2 | SSR indexable + metadatos + JSON-LD | T3.1, T3.2, T3.3, T6.2 | in this change |
| AC-3 | CTA agregar al carrito (disparador) | T4.3 | in this change (seam; lógica → US-007) |
| AC-4 | Sin stock: badge + sin CTA + WhatsApp | T4.3 | in this change |
| AC-5 | Descripción enriquecida-o-base | T4.1 | in this change (resolución server-side: BE/US-005) |
| AC-6 | Sin imagen → placeholder | T4.2 | in this change |
| AC-7 | Draft/archivado → 404 real | T3.1, T6.2 | in this change (uniformidad del 404: BE) |
| AC-8 | Inexistente → 404 real (no soft-200) | T3.1, T6.2 | in this change |
| AC-9 | Precio vigente (frescura inmediata, sin caché indefinida) | T2.1 ✅, T3.1, T3.4, **T6.3** | in this change (OQ-FE-4 opción C) |

**Cobertura no-AC del `design.md` (F51 — toda declaración del diseño tiene task o `Deferred:`)**:
D0 namespace + ADR → **T0.1, T0.2**; `noindex` de `/admin/*` → **T0.3**; layout `(storefront)` +
home pública mínima → **T0.4**; D3 cliente isomorfo → T1.2 ✅; codegen del contrato → T1.1 ✅;
D2 Server Action + puente del panel → T3.4; D4 boundaries del segmento (`not-found`/`error`/
`loading`) → T3.1; D5 metadatos/JSON-LD → T3.2, T3.3; D6 componentes → T4.1–T4.3; D9
`remotePatterns` + env de imagen → T4.2; D8 observabilidad → T5.1; a11y (§11) → T6.1;
D10 stub de contrato en E2E → T6.2; env `NEXT_PUBLIC_*` + README → T7.1.
**Diferidos declarados**: home real y top-nav/breadcrumb → `Deferred: US-002`; invalidación desde el
import masivo → `Deferred: US-006`; número real de WhatsApp → `Deferred: OQ-FE-3 (PO/cliente)`;
sitemap/robots del storefront → `Deferred: US-002`.

## Pre-requisitos

- [x] **P1** — `docs/product/design-system.md` en estado `Approved` (gate de `fe-design-without-figma`
  §5). Verificado en planning.
- [x] **P2** — Suite verde antes de empezar (la Fase 0 es un refactor: se necesita la red de
  seguridad previa, per `refactoring-discipline`).
  - **Verify**: `pnpm --filter @dsm/web test -- --run && pnpm --filter @dsm/web build`
- [x] **P3** — El contrato publicado expone la ficha **por slug**: `apps/api/docs/api/openapi.yaml`
  declara `operationId: storefrontGetProduct` con path param `slug`, y el cliente generado ya lo
  refleja. (Riesgo de secuencia D1: la Fase 10 del change backend sigue abierta y su edición del
  contrato podría no estar commiteada — si este check falla, **parar** y coordinar con backend, no
  editar el contrato desde el FE.)
  - **Verify**: `grep -q "products/{slug}" apps/api/docs/api/openapi.yaml && grep -q "storefrontGetProduct" apps/web/src/api/generated/endpoints.ts`

---

## Fase 0: Namespace de rutas (OQ-FE-6 / design.md D0) — **NUEVA**

> Refactor **Move** behavior-preserving sobre superficie entregada de US-001
> (`refactoring-discipline`): invariante = comportamiento del panel y del guard; criterio de éxito =
> la suite y el smoke quedan verdes cambiando **solo URLs**, ningún assert de comportamiento.

- [x] **T0.1** ADR-0010 — convención de namespace: raíz pública para el storefront, `/admin/*` para el panel (0.25 h)
  - **Pattern**: ADR en `docs/architecture/decisions/0010-url-namespace-storefront-vs-admin.md` con
    el formato canónico (`# ADR 0010: …`, `> **Status**: Accepted`, `> **Date**`, `Contexto /
    Decisión / Alternativas / Consecuencias`) — per `documentation-standards.md` §8.2/§8.3, mismo
    molde que `0009-admin-auth-seam-us001.md`. Contenido: el conflicto de rutas (dos route groups no
    resuelven la misma ruta; `'id' !== 'slug'` rompe el build), la decisión, las alternativas B–E de
    design.md D0 y las consecuencias para US-002/US-004/US-007/US-016.
  - **Exit criterion**: existe el ADR numerado 0010 con `Status: Accepted`, que nombra la decisión
    (público en la raíz, panel en `/admin/*`), al menos las alternativas "storefront bajo prefijo" y
    "dos apps Next" con su razón de descarte, y la consecuencia de que las US siguientes heredan la
    convención; `design.md` D0 lo referencia.
  - **Verify**: `test -f docs/architecture/decisions/0010-url-namespace-storefront-vs-admin.md && grep -q "Status.*Accepted" docs/architecture/decisions/0010-url-namespace-storefront-vs-admin.md && grep -q "/admin" docs/architecture/decisions/0010-url-namespace-storefront-vs-admin.md`

- [x] **T0.2** Mudar el panel a `/admin/*` (rutas + guard + redirecciones + tests + smoke) (0.5 h)
  - **Pattern**:
    ```text
    # Move de rutas — el route group NO cambia el path; el path lo cambia el segmento (next-standards §1)
    app/(admin)/productos/**          →  app/(admin)/admin/productos/**
    app/(admin)/categorias/**         →  app/(admin)/admin/categorias/**
    app/(auth)/acceso/page.tsx        →  app/(auth)/admin/acceso/page.tsx
    # (el layout de (admin) con AdminGuard se conserva tal cual — sigue gateando el subárbol)
    ```
    ```ts
    // Referencias a actualizar — son TODAS las del radio medido (design.md D0):
    src/features/auth/AdminAccessForm.tsx   router.push('/productos')  → '/admin/productos'
    src/features/auth/guard.tsx             router.replace('/acceso')  → '/admin/acceso'
    src/features/auth/AdminAccessForm.test.tsx  assert de push          → '/admin/productos'
    e2e/smoke.spec.ts                       5 URLs ('/acceso', '/categorias', '/productos*')
    ```
    — per `frontend-next-standards.md` §1 (segmentos de ruta) + `refactoring-discipline` (Move: no se
    cambia comportamiento, solo ubicación; los asserts de comportamiento del smoke quedan idénticos).
    **No** se tocan componentes, copy ni lógica del panel.
  - **Exit criterion**: el build de producción compila con el árbol movido; el panel responde en
    `/admin/acceso`, `/admin/productos`, `/admin/productos/nuevo`, `/admin/productos/{id}` y
    `/admin/categorias`; el login redirige a `/admin/productos` y el guard sin sesión redirige a
    `/admin/acceso`; **no queda ninguna referencia** a las URLs viejas en `src/`, `app/` ni `e2e/`;
    la suite de US-001 y el smoke E2E pasan **sin cambios de assert de comportamiento** (solo URLs).
  - **Verify**: `pnpm --filter @dsm/web build && pnpm --filter @dsm/web test -- --run && pnpm --filter @dsm/web test:e2e && ! grep -rnE "router\.(push|replace)\('/(acceso|productos|categorias)" apps/web/src | grep -q .`
    *(el grep final está acotado a las redirecciones del panel — no puede dar falso positivo con las
    URLs públicas legítimas del storefront que T3.1/T6.2 agregan.)*

- [x] **T0.3** `X-Robots-Tag: noindex, nofollow` para `/admin/:path*` (0.25 h)
  - **Pattern**:
    ```js
    // next.config.mjs — junto a los security headers de US-001 (T8.4)
    { source: '/admin/:path*',
      headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] },
    ```
    — per `frontend-next-standards.md` §8.bis (headers en `next.config`) + E2E §14 ("no exponer panel
    sin auth" — el prefijo dedicado hace la regla única y auditable). **No** sustituye al `AdminGuard`
    ni a la autoridad del backend: es defensa en profundidad contra indexación, no control de acceso.
    El spec que lo ejercita es `apps/web/e2e/admin-noindex.spec.ts` (asserta el header sobre la
    respuesta real del server de producción, no sobre el config).
  - **Exit criterion**: una respuesta de cualquier ruta bajo `/admin/` incluye el header
    `x-robots-tag: noindex, nofollow`, y una ruta pública (`/`, `/productos/{slug}`) **no** lo
    incluye; verificado sobre el servidor de producción, no por inspección del config.
  - **Verify**: `pnpm --filter @dsm/web test:e2e`
    *(el spec `e2e/admin-noindex.spec.ts` asserta el header presente en `/admin/acceso` y ausente
    en `/`.)*

- [x] **T0.4** Route group `(storefront)`: layout mínimo + home pública en `/` (0.25 h)
  - **Pattern**:
    ```tsx
    // app/(storefront)/layout.tsx — mínimo: wordmark "DSM" → '/' (top-nav completo: Deferred US-002)
    // app/(storefront)/page.tsx   — home pública stub: wordmark + claim + copy §10.2
    // app/page.tsx (panel) se ELIMINA: '/' pasa a ser público (design.md D0)
    ```
    — per `frontend-next-standards.md` §1 (layout por route group) + design-system §7.10/§10.2
    (el top-nav real, con SearchBar/carrito/CategoryNav, es `Deferred: US-002`).
  - **Exit criterion**: `/` responde 200 y renderiza el layout público (wordmark, sin ninguna
    referencia al panel del dueño); el layout `(storefront)` existe y envuelve a la ficha; el
    `app/page.tsx` con el título "Panel del dueño" ya no existe.
  - **Verify**: `pnpm --filter @dsm/web build && pnpm --filter @dsm/web test:e2e && ! test -f apps/web/app/page.tsx`
    *(el spec `e2e/storefront-home.spec.ts` asserta status 200 en `/` y que el HTML del server no
    contiene "Panel del dueño" — el `test -f` sólo cierra que la home vieja no quedó duplicada.)*

---

## Fase 1: Contrato + cliente isomorfo — **HECHA (commiteada)**

- [x] **T1.1** Regenerar los artefactos del contrato (DTOs + Zod + MSW) con `storefrontGetProduct` (0.25 h)
  - **Estado**: **hecho y commiteado**. `apps/web/src/api/generated/*` regenerado contra el contrato
    por slug: `storefrontGetProduct(slug, options)` y `StorefrontProduct.slug` existen. Válido tras
    la regeneración del plan (namespace-independiente).
  - **Pattern**: `pnpm --filter @dsm/web codegen` sobre `apps/api/docs/api/openapi.yaml` (config
    existente) — per `frontend-standards.md` §3.1/§3.2 (artefactos del contrato SIEMPRE generados) +
    skill `openapi-client-codegen`.
  - **Exit criterion**: el cliente generado expone `storefrontGetProduct` y su schema Zod; re-correr
    el codegen no produce diff (gate `frontend-codegen-fresh` verde).
  - **Verify**: `pnpm --filter @dsm/web codegen && grep -q "storefrontGetProduct" apps/web/src/api/generated/endpoints.ts && git diff --quiet -- apps/web/src/api/generated`
    *(el `git diff --quiet` es válido porque los artefactos ya están commiteados; si se re-ejecuta
    antes de commitear, primero `git add` y luego re-generar.)*

- [x] **T1.2** Cliente HTTP isomorfo: `customFetch` ejecutable en Server Components sin romper la Data Cache (0.5 h)
  - **Estado**: **hecho y commiteado**. `src/lib/http/client.ts` exporta `FetchInit`
    (RequestInit + `next: {revalidate, tags}`), en server no inyecta `authorization` ni
    `traceparent`, y reenvía `init.next`/`init.cache`. Tests `client.test.ts` (jsdom) +
    `client.server.test.ts` (`// @vitest-environment node`). Se agregó `isAppError(error, kind)` en
    `src/lib/http/errors.ts`. Namespace-independiente.
  - **Pattern**: per `frontend-next-standards.md` §3 (caching explícito por fetch) +
    `frontend-standards.md` §8 (cliente único) + F48.
  - **Exit criterion**: en server no hay `authorization` ni `traceparent`; se reenvían `next`/`cache`;
    el comportamiento browser (token, traceparent, timeout, RFC 7807 → `AppError`) queda intacto.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/lib/http && pnpm --filter @dsm/web typecheck`

## Fase 2: Servicio de storefront — **HECHA (commiteada)**

- [x] **T2.1** `storefrontService.getProductBySlug` sobre el cliente generado + Zod + `AppError` (0.5 h)
  - **Estado**: **hecho y commiteado**. `src/features/storefront/storefrontService.ts` exporta
    `productTag(slug) => 'product:'+slug` y `getProductBySlug`, con
    `next: { revalidate: 3600, tags: [productTag(slug)] }` y validación por el Zod generado.
    Namespace-independiente.
  - **Pattern**: per `frontend-standards.md` §3.3 (hand-written solo la lógica del servicio) +
    §11.3/§11.5 + `frontend-next-standards.md` §3 (tag lo que pensás revalidar).
  - **Exit criterion**: devuelve el producto tipado y validado en 200; declara `revalidate` y el tag
    vía el helper `productTag` (única fuente); propaga `AppError` `notFound`/`server`/`network`.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/storefront/storefrontService`

---

## Fase 3: Ruta SSR de la ficha (AC-1, AC-2, AC-7, AC-8, AC-9)

> El árbol `app/(storefront)/productos/[slug]/` y `ProductDetail.tsx` se habían construido y se
> **borraron** para dejar el build verde mientras se resolvía D0; se reconstruyen acá bajo el
> namespace ya decidido.

- [x] **T3.1** `app/(storefront)/productos/[slug]/page.tsx` — Server Component + 404 real + boundaries del segmento (0.75 h)
  - **Pattern**:
    ```tsx
    // Server Component async (SIN "use client") — next-standards §2/§3
    export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
      const { slug } = await params;
      const product = await getProductBySlug(slug).catch((e) => {
        if (isAppError(e, 'notFound')) notFound();   // → HTTP 404 real (AC-7/AC-8)
        throw e;                                      // → error.tsx (boundary)
      });
      return <ProductDetail product={product} />;
    }
    // La política de caché (tag product:{slug} + revalidate) vive en el servicio (T2.1), no acá.
    ```
    — per `frontend-next-standards.md` §1 (`not-found.tsx`/`error.tsx`/`loading.tsx` colocados por
    segmento), §2 (Server Component por defecto), §3 (caché explícita);
    `frontend-resilience-patterns` #10 (el boundary **reporta** a Sentry, no silencia) y #12
    (skeleton con la forma de la ficha, no spinner). Copy de 404/error: design-system §10.2.
  - **Exit criterion**: la ruta renderiza server-side la ficha de un producto publicado; un
    `AppError.notFound` del servicio ejecuta `notFound()` (el status 404 real se prueba en T6.2);
    existe `error.tsx` (reintento + reporte a Sentry) en el segmento y **no** existe `loading.tsx`
    (design.md D1.bis: un skeleton transmite el shell con 200 y vuelve imposible el 404 real —
    medido en ejecución); tests de la page cubren **éxito** (renderiza el nombre) y **404**
    (invoca `notFound`, con `next/navigation` espiado) y **error no-404** (propaga, no lo traga).
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/storefront && pnpm --filter @dsm/web build`

- [x] **T3.2** `generateMetadata` — title/description/canonical/Open Graph por ficha (0.5 h)
  - **Pattern**:
    ```tsx
    export async function generateMetadata({ params }): Promise<Metadata> {
      const product = await getProductBySlug(slug).catch(() => null); // memoizado: mismo fetch que la page
      if (!product) return { title: 'Producto no encontrado' };
      return {
        title: `${product.name} — DSM Refrigeración y Ferretería`,
        description: truncate(product.description ?? product.name, 160),
        alternates: { canonical: `${siteUrl}/productos/${product.slug}` },
        openGraph: { title: product.name, images: [product.image_url ?? ogDefault] },
      };
    }
    ```
    — per `frontend-next-standards.md` §6 (Metadata API, sin `<head>` manual) + design-system §8.1
    (OG por producto; default 1200×630 cuando no hay imagen). La memoización de `fetch` de Next
    deduplica la llamada con la de la page (mismo URL + mismas opciones).
  - **Exit criterion**: `generateMetadata` produce title con el nombre del producto, description
    truncada (≤ 160), canonical **absoluto** construido con `NEXT_PUBLIC_SITE_URL` y apuntando a
    `/productos/{slug}`, y OG con la imagen del producto o la default cuando `image_url` es null; sin
    `<head>` manual en el árbol; tests verifican el objeto devuelto para producto **con** imagen,
    **sin** imagen y **inexistente** (404 → no explota).
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/storefront`

- [x] **T3.3** JSON-LD `schema.org/Product` con serialización segura (0.5 h)
  - **Pattern**:
    ```tsx
    // Nombre/descripción los escribe el dueño → input NO confiable.
    // Serialización segura: JSON.stringify + escape de '<' (rompe '</script>').
    const jsonLd = {
      '@context': 'https://schema.org', '@type': 'Product',
      name: product.name, description: product.description ?? undefined,
      image: product.image_url ?? undefined, sku: product.sku,
      category: product.category.name,
      offers: { '@type': 'Offer', priceCurrency: 'ARS',
        price: (product.price_ars_cents / 100).toFixed(2),
        availability: product.in_stock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        url: `${siteUrl}/productos/${product.slug}` },
    };
    <script type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
    ```
    — per `security-standards.md` §6 (output encoding: éste es el **único**
    `dangerouslySetInnerHTML` permitido — nunca HTML del producto) + AC-2. `price` en unidades
    decimales (schema.org) derivado de centavos (api-standards §5.5).
  - **Exit criterion**: el render de la ficha incluye exactamente **un** `<script
    type="application/ld+json">` con `@type: Product`, `offers.priceCurrency: ARS`, `price` correcto
    (centavos → decimal) y `availability` acorde a `in_stock`; un producto cuyo nombre contiene
    `</script>` **no** rompe el documento (test con input malicioso que falla si falta el escape); no
    existe ningún otro uso de `dangerouslySetInnerHTML` en el código de la app.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/storefront && ! grep -rn "dangerouslySetInnerHTML" apps/web/src apps/web/app | grep -vi "ld+json\|jsonLd" | grep -q .`

- [x] **T3.4** Server Action `revalidateProduct(slug)` + puente desde el flujo de mutación del panel (AC-9) (0.5 h)
  - **Pattern**:
    ```ts
    // src/features/storefront/revalidate.ts
    'use server';
    import { revalidateTag, revalidatePath } from 'next/cache';
    import { productTag } from './storefrontService';                 // helper único (T2.1)
    const slugSchema = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);  // action = endpoint público (§4)
    export async function revalidateProduct(rawSlug: string): Promise<void> {
      const slug = slugSchema.parse(rawSlug);
      revalidateTag(productTag(slug));            // Data Cache
      revalidatePath(`/productos/${slug}`);       // Full Route Cache — cubre "404 cacheado → publicar"
    }
    // Puente (panel, client): tras un PATCH/POST de producto EXITOSO —
    // editar datos/precio, publicar, archivar —
    revalidateProduct(slug).catch(reportToSentry); // fire-and-forget: la mutación ya se confirmó;
                                                   // un fallo lo cubre el safety-net de 1 h (D2)
    ```
    — per `frontend-next-standards.md` §3 (`revalidatePath`/`revalidateTag` tras mutaciones) + §4
    (Server Action valida input; tratar como endpoint público) + design.md D2 (por qué tag **y**
    path; por qué Server Action y no Route Handler — F48 sin `fetch` crudo nuevo). El `slug` sale del
    DTO del producto que el panel ya tiene; **nunca** se deriva del `name` en el cliente.
  - **Exit criterion**: existe la Server Action con validación Zod del `slug` (input inválido lanza y
    **no** invalida nada); ejecuta `revalidateTag(productTag(slug))` **y**
    `revalidatePath('/productos/'+slug)`; el flujo de mutación de productos del panel la invoca
    **exactamente una vez** tras cada mutación **exitosa** (editar / publicar / archivar) y **no** la
    invoca cuando la mutación falla; un fallo de la action se reporta a observabilidad sin romper el
    feedback de la mutación; tests: unit de la action (slug válido/inválido, `next/cache` espiado) +
    component del panel (mutación OK → invocada; error 422 → no invocada).
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/storefront/revalidate src/features/products`

---

## Fase 4: Componentes de la ficha (design-system §7 — sin Figma)

- [x] **T4.1** `ProductDetail` — jerarquía fija + PriceTag + categoría + descripción (0.5 h)
  - **Pattern**: jerarquía de lectura **imagen → nombre (`h1` único) → precio → disponibilidad →
    CTA** per design-system §7.3; precio con el helper existente `src/lib/format/currency.ts`
    (`$ 12.500`, mismo helper server/client — §7.4, evita hydration mismatch) en `text-3xl`/bold +
    subtexto "IVA incluido" (`text-xs` `gray-500`); descripción como **texto plano** (párrafos por
    saltos de línea, `whitespace-pre-line`) — nunca HTML (AC-5, frontend-standards §12.1); categoría
    como texto (`Deferred: US-002 — breadcrumb con link`); tokens semánticos del `tailwind.config`
    existente, sin hex hardcodeados.
  - **Exit criterion**: `src/features/storefront/ProductDetail.tsx` (Server Component) renderiza el
    nombre como **único** `h1`, el precio formateado en ARS con "IVA incluido", el nombre de
    categoría, y la descripción cuando existe (**sección omitida** si `description` es null); el
    orden en el DOM es el del §7.3; tests cubren con-descripción, sin-descripción y el formato del
    precio (falla si el precio se muestra en centavos o sin separador de miles).
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/storefront/ProductDetail`

- [x] **T4.2** `ProductImage` — `next/image` con `priority`/`sizes` + fallback placeholder (AC-6, LCP) (0.5 h)
  - **Pattern**:
    ```tsx
    // Hoja client mínima (necesita onError) — next-standards §2 ("use client" en hojas)
    'use client';
    <Image src={src} alt={`${name} — ${categoryName}`} fill priority
      sizes="(max-width:1024px) 100vw, 50vw"           // §8.1 — hero de ficha
      onError={() => setBroken(true)} className="object-contain" />
    // broken || !image_url → placeholder: ícono `package` (Lucide) sobre gray-100, ratio 1:1 (§8.1/§10.1)
    ```
    — per design-system §8.1 (aspect 1:1, `sizes` por contexto, imagen LCP con `priority`, fallback
    consistente) + `frontend-resilience-patterns` #11 (nunca el broken-image nativo) +
    `frontend-next-standards.md` §6 (`next/image`). `remotePatterns` en `next.config.mjs` con el host
    de imágenes tomado de env (`NEXT_PUBLIC_IMAGE_CDN_HOST`) — **sin wildcard universal**.
  - **Exit criterion**: con `image_url` válida renderiza `next/image` con `priority`, los `sizes` del
    §8.1 y `alt` descriptivo (nombre + categoría, nunca "imagen"); con `image_url: null` **o** carga
    rota (`onError`) renderiza el placeholder (ícono `package` sobre `gray-100`, ratio 1:1) y el
    resto de la ficha queda intacto; `next.config.mjs` declara `images.remotePatterns` con el host de
    env y sin `hostname: '**'`; tests cubren los tres casos (válida / null / onError).
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/storefront/ProductImage && pnpm --filter @dsm/web build && ! grep -n "hostname: *'\*\*'" apps/web/next.config.mjs`

- [x] **T4.3** Estados de compra: CTA `accent` con seam (AC-3) vs "Sin stock" + WhatsApp (AC-4) (0.5 h)
  - **Pattern**: `in_stock: true` → `Button` variante `accent` "Agregar al carrito" (§7.1)
    **deshabilitado** con seam `onAddToCart` para US-007 (OQ-FE-2; estado disabled del §7.1).
    `in_stock: false` → badge "Sin stock" (§7.7: pill con **texto** + color, el color nunca es único
    portador de significado), **sin** botón de compra, y en su lugar el CTA
    `https://wa.me/{NEXT_PUBLIC_WHATSAPP_PHONE}` con ícono `message-circle` **+ texto** ("Avisame por
    WhatsApp") y copy §10.2: "Sin stock por ahora. Escribinos por WhatsApp y te avisamos cuando
    vuelva." — per design-system §7.3 (*sin stock: el botón se **reemplaza**, no un disabled mudo*),
    §7.14 (canal humano) y §10.2.
  - **Exit criterion**: **con stock**: existe el botón accent con nombre accesible "Agregar al
    carrito", está `disabled`, y expone el seam tipado `onAddToCart` sin lógica; **sin stock**: el
    botón de compra **no existe en el DOM**, el badge "Sin stock" es visible con texto, y el enlace
    WhatsApp apunta a `wa.me` con el número de env y tiene nombre accesible (no solo ícono); tests
    cubren ambos estados y **fallan** si aparece el CTA de compra sin stock.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/storefront`

---

## Fase 5: Observabilidad (US §9, E2E §18)

- [x] **T5.1** Evento cliente `pdp_shown` (sin PII) + tipado del catálogo de eventos (0.25 h)
  - **Pattern**:
    ```ts
    // src/lib/observability/events.ts — extender la unión existente
    export type BusinessEvent = ... | 'pdp_shown';
    // hoja client mínima en la ficha:
    useEffect(() => { track('pdp_shown', { slug, sku, in_stock, screen_name: 'pdp' }); }, [slug]);
    ```
    — per `observability-patterns` §9.5.2 (evento `{screen}_shown` por pantalla) y §3.3 (`slug`/`sku`
    como propiedad de **evento/analytics**, nunca dimensión de métrica — cardinalidad); sin PII
    (lectura anónima). Motivo: con la caché por tag el BE solo ve los re-fetches post-invalidación →
    `product.viewed` subcuenta (OQ-FE-5).
  - **Exit criterion**: al montarse la ficha en el browser se emite **exactamente un** `pdp_shown`
    con `slug`, `sku`, `in_stock` y `screen_name` (y ninguna propiedad con PII); el evento está
    tipado en la unión `BusinessEvent` (un evento fuera del catálogo no compila); test con sink espía
    verifica emisión única (falla si se emite dos veces en un re-render) y las propiedades.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/lib/observability src/features/storefront && pnpm --filter @dsm/web typecheck`

---

## Fase 6: A11y + E2E (SSR / 404 / invalidación reales)

- [x] **T6.1** Accesibilidad — axe sin violaciones en los tres estados de la ficha (0.5 h)
  - **Pattern**: jest-axe sobre el render de `ProductDetail` en (a) con stock, (b) sin stock, (c) sin
    imagen → 0 violaciones; asserts adicionales: `h1` único, `alt` descriptivo, badge con texto,
    enlace WhatsApp con nombre accesible — per design-system §11 (WCAG 2.1 AA) +
    `qa-frontend-standards.md` §23 (axe a nivel componente); mismo patrón que
    `src/features/a11y.test.tsx` de US-001.
  - **Exit criterion**: existe `src/features/storefront/a11y.test.tsx` que corre axe sobre los tres
    estados y **falla ante cualquier violación**; los asserts de `h1` único y `alt` descriptivo
    fallan si se rompen (verificado invirtiendo temporalmente el assert durante el desarrollo).
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/storefront/a11y`

- [x] **T6.2** Smoke E2E — SSR indexable + 404 real, contra stub del contrato como `webServer` (1 h)
  - **Pattern**:
    ```js
    // apps/web/e2e/support/api-stub.mjs — node:http sin dependencias (design.md D10).
    // Sirve GET /v1/products/{slug} desde un mapa en memoria (404 uniforme para lo no listado),
    // los endpoints admin del flujo del panel, y CORS (el panel llama desde el browser).
    // playwright.config.ts:
    webServer: [
      { command: 'node e2e/support/api-stub.mjs', url: 'http://localhost:4010/health', reuseExistingServer: !process.env.CI },
      { command: 'pnpm build && pnpm start -p 3100', url: 'http://localhost:3100',
        env: { NEXT_PUBLIC_API_BASE_URL: 'http://localhost:4010' },   // ⚠ NEXT_PUBLIC_* se INLINEA
        reuseExistingServer: !process.env.CI, timeout: 180000 },      //   en build: va en este env
    ]
    ```
    ```ts
    const res = await page.goto(`/productos/${slug}`);
    expect(res!.status()).toBe(200);
    const html = await res!.text();
    expect(html).toContain(product.name);            // SSR: contenido en el HTML del server
    expect(html).toContain('application/ld+json');   // JSON-LD presente (AC-2)
    const notFound = await page.goto('/productos/no-existe-jamas');
    expect(notFound!.status()).toBe(404);            // 404 REAL, no soft-200 (AC-7/AC-8)
    ```
    — per `playwright-stability` (sin `waitForTimeout`, aserciones sobre la respuesta, no sobre el
    DOM hidratado) + `frontend-next-standards.md` §9 (E2E contra `next build && next start`).
    `page.route` **no sirve** acá: el fetch de la ficha es server-side. Nota: draft ≡ inexistente
    desde afuera (404 uniforme del BE) — un caso negativo basta en el smoke; la matriz completa es de
    `QA-US-003`.
  - **Exit criterion**: el spec navega a la ficha de un producto del stub y **asserta sobre el body
    de la respuesta del server** (no sobre el DOM hidratado) que están el nombre, el precio
    formateado y el bloque JSON-LD; asserta **status 404** (no 200) para un slug inexistente; el
    stub y el server de Next arrancan vía `webServer` sin docker; el smoke de US-001 sigue verde.
  - **Verify**: `pnpm --filter @dsm/web test:e2e`

- [ ] **T6.3** E2E del circuito de invalidación AC-9 (precio nuevo **inmediato** tras editar en el panel) (0.75 h)
  - **Pattern**:
    ```ts
    // 1) Cargar la ficha → la Data Cache queda poblada con el precio viejo.
    // 2) Editar el precio DESDE EL PANEL (/admin/productos/{id}) — es el camino que dispara
    //    revalidateProduct (editar por API directa NO invalida: eso solo lo cubre el safety-net).
    //    El stub responde 200 al PATCH y desde ese momento sirve el precio nuevo en GET.
    // 3) Recargar la ficha y assertar el precio NUEVO en el HTML del server, sin esperar TTL.
    const fresh = await page.goto(`/productos/${slug}`);
    expect(await fresh!.text()).toContain(precioNuevoFormateado);
    ```
    — per `frontend-next-standards.md` §3/§4 (invalidación tras mutación) + `playwright-stability`
    (sin `waitForTimeout`: si la invalidación no corre, el assert falla **inmediatamente** contra la
    caché de 1 h — ésa es justamente la prueba). Requiere el build de producción (las Server Actions
    no existen en `next dev` del mismo modo) — ya cubierto por el `webServer` de T6.2.
  - **Exit criterion**: el spec demuestra el circuito completo: ficha cacheada con precio A → edición
    exitosa por la **UI del panel** → recarga muestra precio B en el HTML del server **sin** espera
    temporal; el test **falla** si se quita la invocación a `revalidateProduct` del flujo del panel
    (verificado durante el desarrollo quitándola temporalmente).
  - **Verify**: `pnpm --filter @dsm/web test:e2e`

---

## Fase 7: Documentación

- [ ] **T7.1** README de `apps/web` + `.env.example` — namespace, storefront y nuevas env públicas (0.25 h)
  - **Pattern**: per `documentation-standards.md` §11.1 (README cuando cambian config/env/rutas).
    Documentar: el **mapa de rutas** post-D0 (público raíz vs `/admin/*`, con puntero a ADR-0010) y
    las env públicas `NEXT_PUBLIC_SITE_URL` (canonical/OG/JSON-LD), `NEXT_PUBLIC_WHATSAPP_PHONE`
    (placeholder hasta OQ-FE-3) y `NEXT_PUBLIC_IMAGE_CDN_HOST` (`remotePatterns`).
  - **Exit criterion**: `apps/web/README.md` documenta el mapa de rutas (storefront `/productos/{slug}`
    y panel `/admin/*`, citando ADR-0010) y las tres env nuevas; `apps/web/.env.example` las incluye;
    **ningún secreto lleva prefijo `NEXT_PUBLIC_`** (next-standards §8).
  - **Verify**: `grep -q "/admin" apps/web/README.md && grep -q "0010" apps/web/README.md && grep -q "NEXT_PUBLIC_SITE_URL" apps/web/README.md && grep -q "NEXT_PUBLIC_WHATSAPP_PHONE" apps/web/README.md && grep -q "NEXT_PUBLIC_IMAGE_CDN_HOST" apps/web/.env.example && ! grep -rnE "NEXT_PUBLIC_[A-Z_]*(SECRET|TOKEN|PASSWORD|KEY)" apps/web/src apps/web/app apps/web/.env.example | grep -q .`

---

## Verification (suite-level)

- [ ] Unit + component + integración verdes: `pnpm --filter @dsm/web test -- --run`
- [ ] Lint limpio: `pnpm --filter @dsm/web lint`
- [ ] Typecheck limpio: `pnpm --filter @dsm/web typecheck`
- [ ] Build de producción OK (sin colisión de rutas; la ficha compila como Server Component con ISR):
  `pnpm --filter @dsm/web build`
- [ ] E2E verde (smoke de US-001 con las URLs nuevas + SSR + 404 real + invalidación AC-9):
  `pnpm --filter @dsm/web test:e2e`
- [ ] Codegen del contrato en sync (gate `frontend-codegen-fresh`):
  `pnpm --filter @dsm/web codegen && git diff --quiet -- apps/web/src/api/generated`
- [ ] Sin `fetch` crudo fuera del cliente (F48): el único `fetch` de la app sigue en
  `src/lib/http/client.ts` (allowlist `.consumer-contract-allow`); el stub de E2E es servidor de
  test, no cliente de la app.
- [ ] Reconciliación contra el `design.md` completo (F51): D0–D10 construidas o con `Deferred:`
  documentado (US-002 / US-006 / OQ-FE-3).
- [ ] Índice actualizado: `docs/_index/openspec-changes.yaml` refleja `status` y `estimate-hours` de
  este change.
