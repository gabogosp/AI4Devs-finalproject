---
parent-us: US-003
discipline: frontend-web
variant: null
language: es
---

# US-003 Frontend Web — Tasks

> Cada task es closure-grade: atómica, con `Exit criterion:` observable y `Verify:` con el comando exacto (terminante, F49) que `/develop-frontend-web` corre, y que **falla si el criterio no se cumple** (F50). Comandos desde la **raíz del repo**. La app `apps/web` ya existe (US-001): estas tasks agregan el storefront sin tocar el panel. **Ninguna task migra esquema ni redefine el contrato OpenAPI** (se consume `storefrontGetProduct` tal como está publicado).
>
> **Estimación dual**: **~7 h AI-asistido** (suma por task: 7.25 h) / **~13 h tradicional** (US §7 presupuestaba FE en 8–12 h tradicional; el ~+1 h sobre el techo viene de la decisión OQ-FE-4 opción C — invalidación on-demand + su verificación end-to-end — ratificada por el usuario el 2026-08-16). Horas por task = AI-asistido.
>
> **Decisiones ratificadas (2026-08-16)**: OQ-FE-1 opción A (ruta `/productos/{sku}`), OQ-FE-2 opción A (CTA deshabilitado con seam), **OQ-FE-4 opción C (caché por tag `product:{sku}` + Server Action de invalidación desde el panel + safety-net `revalidate: 3600`)**, OQ-FE-5 opción A (evento `pdp_shown`). OQ-FE-3 (número real de WhatsApp) sigue pendiente de dato del cliente — no bloquea (placeholder por env).

## Traceability matrix (AC → tasks)

| AC | Título | Task IDs | Estado |
|---|---|---|---|
| AC-1 | Ficha completa + URL propia | T3.1, T4.1 | in this change (URL por `sku` — OQ-FE-1) |
| AC-2 | SSR indexable + metadatos + JSON-LD | T3.1, T3.2, T3.3, T6.2 | in this change |
| AC-3 | CTA agregar al carrito (disparador) | T4.3 | in this change (seam; lógica → US-007) |
| AC-4 | Sin stock: badge + sin CTA + WhatsApp | T4.3 | in this change |
| AC-5 | Descripción enriquecida-o-base | T4.1 | in this change (resolución server-side: BE/US-005) |
| AC-6 | Sin imagen → placeholder | T4.2 | in this change |
| AC-7 | Draft/archivado → 404 real | T3.1, T6.2 | in this change (uniformidad del 404: BE) |
| AC-8 | Inexistente → 404 real (no soft-200) | T3.1, T6.2 | in this change |
| AC-9 | Precio vigente (frescura inmediata, sin caché indefinida) | T2.1, T3.1, T3.4, T6.2 | in this change (OQ-FE-4 opción C: tag + invalidación on-demand + safety-net) |

Cobertura no-AC del design.md (F51): cliente isomorfo → T1.2; codegen → T1.1; Server Action `revalidateProduct` + puente del panel (D2) → T3.4; `remotePatterns` + env de imagen → T4.2; env `NEXT_PUBLIC_SITE_URL`/`NEXT_PUBLIC_WHATSAPP_PHONE` + README → T7.1; observabilidad → T5.1; a11y transversal → T6.1; skeleton/error boundary del segmento → T3.1. Nota D2/F51: la invalidación desde el import masivo queda `Deferred: US-006 — el flujo de import invocará la misma action; hasta entonces cubre el safety-net`.

## Pre-requisitos

- [ ] Change backend `US-003-ficha-producto-pdp-backend` verde (lo está: suite-level verificado) y `apps/api/docs/api/openapi.yaml` publica `GET /v1/products/{sku}` (`operationId: storefrontGetProduct`). Verificado en planning.
- [ ] `docs/product/design-system.md` en estado `Approved` (lo está — gate de `fe-design-without-figma` §5).
- [ ] API local levantable para el smoke E2E (docker-compose de US-001 + seed vía API admin).

## Fase 1: Contrato + cliente isomorfo

- [x] T1.1 Regenerar los artefactos del contrato (DTOs + Zod + MSW) con `storefrontGetProduct` (0.25 h)
  - **Pattern**: `pnpm --filter @dsm/web codegen` sobre `apps/api/docs/api/openapi.yaml` (config existente `orval.config.ts`) — per `frontend-standards.md` §3.1/§3.2 — artefactos del contrato SIEMPRE generados, nunca hand-written; `openapi-client-codegen` (regenerar, no editar).
  - **Exit criterion**: `src/api/generated/endpoints.ts` exporta la operación `storefrontGetProduct` (y `zod.ts` su schema; los handlers MSW generados la incluyen); volver a correr el codegen no produce diff (gate `frontend-codegen-fresh` se mantiene verde).
  - **Verify**: `pnpm --filter @dsm/web codegen && grep -q "storefrontGetProduct" apps/web/src/api/generated/endpoints.ts && grep -qi "storefrontGetProduct\|StorefrontProduct" apps/web/src/api/generated/zod.ts && git diff --quiet -- apps/web/src/api/generated`

- [x] T1.2 Cliente HTTP isomorfo: `customFetch` ejecutable en Server Components sin romper la caché de datos de Next (0.5 h)
  - **Pattern**:
    ```ts
    // src/lib/http/client.ts — sigue siendo el ÚNICO punto de red (F48)
    const isServer = typeof window === 'undefined';
    // server: NO Authorization (surface pública) y NO traceparent aleatorio
    // (un header random por render cambia la clave de la Data Cache de Next
    // y anula `revalidate`); browser: comportamiento actual intacto.
    if (!isServer) { headers.set('traceparent', traceparent()); /* + token */ }
    // reenviar opciones de caching del caller (next-standards §3 — caché explícita):
    res = await fetch(absolute, { ...init, headers, signal });
    // donde init puede traer { next: { revalidate, tags } } o { cache: 'no-store' }
    ```
    — per `frontend-next-standards.md` §3 (caching explícito por fetch) + `frontend-standards.md` §8 (cliente único) + `openapi-client-codegen` F48.
  - **Exit criterion**: `customFetch` corre en entorno server (sin `window`) sin lanzar; en server no inyecta `authorization` ni `traceparent`; reenvía `init.next`/`init.cache` al `fetch` subyacente; en browser el comportamiento previo (token, traceparent, timeout, mapeo RFC 7807) queda intacto — unit tests cubren ambos entornos y los tests existentes del panel siguen verdes.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/lib/http && pnpm --filter @dsm/web typecheck`

## Fase 2: Servicio de storefront

- [x] T2.1 `storefrontService.getProductBySku` sobre el cliente generado + validación Zod + `AppError` (0.5 h)
  - **Pattern**:
    ```ts
    // src/features/storefront/storefrontService.ts — hand-written SOLO la lógica (§3.3)
    import { storefrontGetProduct } from '@/api/generated/endpoints';
    export const productTag = (sku: string) => `product:${sku}`;   // naming D2 — única fuente
    const res = await storefrontGetProduct(sku, {
      next: { revalidate: 3600, tags: [productTag(sku)] },  // safety-net 1h + tag (OQ-FE-4 C)
    });
    return parseContract(storefrontProductSchema, res.data); // Zod GENERADO, en el borde
    ```
    — per `frontend-standards.md` §3.3 (service hand-written sobre cliente generado) + §11.3/§11.5 (AppError tipado, repositorio por feature) + `frontend-next-standards.md` §3 (tag fetches you intend to revalidate); reutiliza `parseContract` de `src/lib/http/contract.ts`.
  - **Exit criterion**: el servicio devuelve el producto tipado y validado en 200; el fetch declara `revalidate: 3600` y el tag `product:{sku}` construido con el helper `productTag` (exportado — T3.4 lo reutiliza; el tag no se duplica como string literal); propaga `AppError` `notFound` en 404 y `server`/`network` en 5xx/red (sin filtrar el body crudo); no declara ninguna interfaz del contrato a mano; unit tests con los handlers MSW generados + overrides por test (404, 500) verdes, incluyendo un assert de que las opciones de caché pasadas al cliente llevan el tag correcto.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/storefront/storefrontService`

## Fase 3: Ruta SSR de la ficha (AC-1, AC-2, AC-7, AC-8, AC-9)

- [ ] T3.1 `app/(storefront)/productos/[sku]/page.tsx` — Server Component con caché explícita + 404 real + boundaries del segmento (0.75 h)
  - **Pattern**:
    ```tsx
    // Server Component async (SIN "use client") — next-standards §2/§3
    export default async function ProductPage({ params }: { params: Promise<{ sku: string }> }) {
      const { sku } = await params;
      const product = await getProductBySku(sku).catch((e) => {
        if (isAppError(e, 'notFound')) notFound();   // → HTTP 404 real (AC-7/AC-8)
        throw e;                                      // → error.tsx (boundary)
      });
      return <ProductDetail product={product} />;
    }
    // caché de datos: tag product:{sku} + revalidate 3600 en el fetch del servicio (AC-9, OQ-FE-4 C — T2.1)
    ```
    — per `frontend-next-standards.md` §1 (`not-found.tsx`/`error.tsx`/`loading.tsx` colocados por segmento), §2 (Server Component por defecto), §3 (caché explícita — nunca implícita); `frontend-resilience-patterns` #10 (boundary reporta a Sentry, no silencia) y #12 (skeleton con la forma de la ficha).
  - **Exit criterion**: la ruta renderiza server-side la ficha para un producto publicado; un 404 del contrato ejecuta `notFound()` y la respuesta HTTP es **status 404** con `not-found.tsx` accionable (mensaje + enlaces útiles, copy §10.2 — no un 200 vacío); existen `loading.tsx` (skeleton con la forma de la ficha) y `error.tsx` (reintento + reporte Sentry) en el segmento `(storefront)`; la caché del fetch está declarada explícitamente vía el servicio (T2.1: `revalidate: 3600` + tag `product:{sku}`); component/integration tests (MSW) cubren éxito y propagación del 404.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/storefront && test -f "apps/web/app/(storefront)/productos/[sku]/page.tsx" && test -f "apps/web/app/(storefront)/productos/[sku]/not-found.tsx" && grep -q "revalidate: 3600" apps/web/src/features/storefront/storefrontService.ts && grep -q "product:" apps/web/src/features/storefront/storefrontService.ts && grep -rq "notFound()" "apps/web/app/(storefront)/productos/[sku]/page.tsx" && pnpm --filter @dsm/web build`

- [ ] T3.2 `generateMetadata` — title/description/canonical/Open Graph por ficha (0.5 h)
  - **Pattern**:
    ```tsx
    export async function generateMetadata({ params }): Promise<Metadata> {
      const product = await getProductBySku(sku).catch(() => null); // memoizado: mismo fetch que la page
      if (!product) return { title: 'Producto no encontrado' };
      return {
        title: `${product.name} — DSM Refrigeración y Ferretería`,
        description: truncate(product.description ?? product.name, 160),
        alternates: { canonical: `${siteUrl}/productos/${product.sku}` },
        openGraph: { title: product.name, images: product.image_url ? [product.image_url] : [ogDefault], ... },
      };
    }
    ```
    — per `frontend-next-standards.md` §6 (Metadata API, sin `<head>` manual) + design-system §8.1 (OG por producto: imagen + nombre + precio). La memoización de `fetch` de Next deduplica la llamada con la de la page (mismo URL+opciones).
  - **Exit criterion**: la ficha exporta `generateMetadata` que produce title con el nombre del producto, description (de la descripción o el nombre, truncada), canonical absoluto construido con `NEXT_PUBLIC_SITE_URL`, y Open Graph con la imagen del producto (o la default si `image_url: null`); no hay `<head>` manual; unit/component test verifica el objeto de metadata para producto con y sin imagen.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/storefront && grep -q "generateMetadata" "apps/web/app/(storefront)/productos/[sku]/page.tsx"`

- [ ] T3.3 JSON-LD `schema.org/Product` serializado seguro (0.5 h)
  - **Pattern**:
    ```tsx
    // El nombre/descripción los escribe el dueño → input NO confiable.
    // Serialización segura: JSON.stringify + escape de '<' (rompe '</script>').
    const jsonLd = {
      '@context': 'https://schema.org', '@type': 'Product',
      name: product.name, description: product.description ?? undefined,
      image: product.image_url ?? undefined, sku: product.sku,
      category: product.category.name,
      offers: { '@type': 'Offer', priceCurrency: 'ARS',
        price: (product.price_ars_cents / 100).toFixed(2),
        availability: product.in_stock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        url: `${siteUrl}/productos/${product.sku}` },
    };
    <script type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
    ```
    — per `security-standards.md` §6 (output encoding: el único `dangerouslySetInnerHTML` permitido es este JSON escapado — nunca HTML del producto) + US AC-2. `price` en unidades decimales (schema.org), derivado del contrato en centavos (api-standards §5.5).
  - **Exit criterion**: el HTML server-side de la ficha contiene exactamente un `<script type="application/ld+json">` con `@type: Product`, `offers.priceCurrency: ARS`, `price` correcto (centavos→decimal) y `availability` acorde a `in_stock`; un producto cuyo nombre contiene `</script>` no rompe el documento (test con input malicioso verifica el escape `<`); no existe ningún otro uso de `dangerouslySetInnerHTML` en el diff.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/storefront && ! grep -rn "dangerouslySetInnerHTML" apps/web/src apps/web/app 2>/dev/null | grep -v "ld+json\|jsonLd" | grep -q .`

- [ ] T3.4 Server Action `revalidateProduct(sku)` + puente desde el flujo de mutación de productos del panel (AC-9, OQ-FE-4 opción C) (0.5 h)
  - **Pattern**:
    ```ts
    // src/features/storefront/revalidate.ts
    'use server';
    import { revalidateTag, revalidatePath } from 'next/cache';
    const skuSchema = z.string().regex(/^[A-Za-z0-9._-]{1,64}$/); // action = endpoint público (§4)
    export async function revalidateProduct(rawSku: string): Promise<void> {
      const sku = skuSchema.parse(rawSku);
      revalidateTag(productTag(sku));            // Data Cache (helper de T2.1 — mismo naming)
      revalidatePath(`/productos/${sku}`);       // Full Route Cache — cubre el 404 cacheado → publicar
    }
    // Puente (panel, client): tras un PATCH/POST de producto EXITOSO —
    // editar datos/precio, publicar, archivar —
    revalidateProduct(sku).catch(reportToSentry); // fire-and-forget: la mutación ya se confirmó;
                                                  // un fallo lo cubre el safety-net de 1h (D2)
    ```
    — per `frontend-next-standards.md` §3 (`revalidatePath`/`revalidateTag` after mutations) + §4 (Server Action valida input con Zod; tratar como endpoint público — efecto idempotente y benigno) + design.md D2 (por qué tag **y** path; por qué Server Action y no Route Handler — F48 sin `fetch` crudo nuevo).
  - **Exit criterion**: existe la Server Action con validación Zod del `sku` (input inválido lanza, no invalida nada); ejecuta `revalidateTag(productTag(sku))` **y** `revalidatePath('/productos/'+sku)`; el flujo de mutación de productos del panel (editar / publicar / archivar en `src/features/products/`) la invoca exactamente una vez tras cada mutación **exitosa** y NO la invoca en mutación fallida; un fallo de la action se reporta a observabilidad sin romper el feedback de la mutación; unit tests (action: sku válido/inválido, con `next/cache` espiado) + component test del panel (mutación OK → action invocada; 422 → no invocada) verdes.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/storefront/revalidate src/features/products && grep -q "'use server'" apps/web/src/features/storefront/revalidate.ts && grep -q "revalidatePath" apps/web/src/features/storefront/revalidate.ts`

## Fase 4: Componentes de la ficha (design-system §7 — sin Figma)

- [ ] T4.1 Composición `ProductDetail` — jerarquía fija + PriceTag + categoría + descripción (0.5 h)
  - **Pattern**: jerarquía de lectura **imagen → nombre (`h1` único) → precio → disponibilidad → CTA** per design-system §7.3; precio con el helper existente `src/lib/format/currency.ts` (`$ 12.500`, mismo helper server/client — §7.4, evita hydration mismatch) en `text-3xl`/bold + subtexto "IVA incluido" (`text-xs` `gray-500`); descripción como **texto plano** (párrafos por saltos de línea, `whitespace-pre-line`) — nunca HTML (AC-5, §12.1); categoría como texto (`Deferred: US-002 — breadcrumb con link`); tokens semánticos del tailwind.config existente, sin hex hardcodeados.
  - **Exit criterion**: `src/features/storefront/ProductDetail.tsx` (Server Component) renderiza nombre como único `h1`, precio formateado ARS con "IVA incluido", nombre de categoría y descripción cuando existe (sección omitida si `description` es null); jerarquía DOM en el orden del §7.3; component tests cubren con-descripción, sin-descripción y el formato del precio.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/storefront/ProductDetail`

- [ ] T4.2 `ProductImage` — `next/image` con `priority`/`sizes` de ficha + fallback placeholder (AC-6, LCP) (0.5 h)
  - **Pattern**:
    ```tsx
    // Hoja client mínima (necesita onError) — next-standards §2 ("use client" en hojas)
    'use client';
    <Image src={src} alt={`${name} — ${categoryName}`} fill priority
      sizes="(max-width:1024px) 100vw, 50vw"           // §8.1 — hero de ficha
      onError={() => setBroken(true)} className="object-contain" />
    // broken || !image_url → placeholder: ícono `package` (Lucide) sobre gray-100, ratio 1:1 (§8.1/§10.1)
    ```
    — per design-system §8.1 (aspect 1:1, `sizes` por contexto, imagen LCP con `priority`, fallback consistente) + `frontend-resilience-patterns` #11 (nunca el broken-image nativo) + `frontend-next-standards.md` §6 (`next/image`). `remotePatterns` en `next.config.mjs` con el host de imágenes tomado de env (`NEXT_PUBLIC_IMAGE_CDN_HOST`) — sin wildcard universal.
  - **Exit criterion**: con `image_url` válida renderiza `next/image` con `priority` y los `sizes` del §8.1 y `alt` descriptivo (nombre + categoría, no "imagen"); con `image_url: null` **o** carga rota renderiza el placeholder (ícono `package` sobre `gray-100`, ratio 1:1) y el resto de la ficha intacta; `next.config.mjs` declara `images.remotePatterns` con el host de env; component tests cubren los tres casos (válida / null / onError).
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/storefront/ProductImage && grep -q "remotePatterns" apps/web/next.config.mjs && pnpm --filter @dsm/web build`

- [ ] T4.3 Estados de compra: CTA `accent` con seam (AC-3) vs "Sin stock" + WhatsApp (AC-4) (0.5 h)
  - **Pattern**: `in_stock: true` → `Button` variante `accent` "Agregar al carrito" (§7.1) **deshabilitado** con seam `onAddToCart` para US-007 (OQ-FE-2 recomendación A; el disabled usa el estado §7.1: fondo `gray-300`, texto `gray-500`, no clickeable). `in_stock: false` → badge "Sin stock" (§7.7: pill, texto + color `gray-500` — color nunca único portador), **sin** CTA de compra, y enlace `https://wa.me/{NEXT_PUBLIC_WHATSAPP_PHONE}` con ícono `message-circle` + texto (§7.10/§7.14 — nunca solo ícono) y copy §10.2: "Sin stock por ahora. Escribinos por WhatsApp y te avisamos cuando vuelva." — per design-system §7.1/§7.7/§7.10/§10.2 + US-002 (regla heredada: sin stock visible pero no comprable).
  - **Exit criterion**: con stock: el botón accent existe (`role="button"`, nombre accesible "Agregar al carrito"), está deshabilitado y expone el seam tipado `onAddToCart` sin lógica; sin stock: el botón de compra **no existe** en el DOM, el badge "Sin stock" es visible con texto, y el enlace WhatsApp apunta a `wa.me` con el número de env y texto accesible; component tests cubren ambos estados y la ausencia del CTA sin stock.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/storefront`

## Fase 5: Observabilidad (US §9, E2E §18)

- [ ] T5.1 Evento cliente `pdp_shown` (sin PII) + tipado del catálogo de eventos (0.25 h)
  - **Pattern**:
    ```ts
    // src/lib/observability/events.ts — extender la unión existente
    export type BusinessEvent = ... | 'pdp_shown';
    // hoja client mínima en la ficha:
    useEffect(() => { track('pdp_shown', { sku, in_stock, screen_name: 'pdp' }); }, [sku]);
    ```
    — per `observability-patterns` §9.5.2 (evento `{screen}_shown` por pantalla) y §3.3 (el `sku` va como propiedad de **analytics/evento**, nunca como dimensión de métrica — cardinalidad); sin PII (lectura anónima). Motivo: con la caché por tag el BE solo ve los re-fetches post-invalidación → subcuenta `product.viewed` (OQ-FE-5, `[Resolved: opción A]`).
  - **Exit criterion**: al montarse la ficha en el browser se emite exactamente un `pdp_shown` con `sku`, `in_stock` y `screen_name` (sin PII); el evento está tipado en la unión `BusinessEvent`; unit test con sink espía verifica emisión única y propiedades.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/lib/observability && grep -q "pdp_shown" apps/web/src/lib/observability/events.ts`

## Fase 6: A11y + smoke E2E (SSR/404 reales)

- [ ] T6.1 Accesibilidad — axe sin violaciones en los tres estados de la ficha (0.5 h)
  - **Pattern**: jest-axe sobre el render de `ProductDetail` en (a) con stock, (b) sin stock, (c) sin imagen → 0 violaciones; asserts adicionales: `h1` único, `alt` descriptivo, badge con texto, enlace WhatsApp con nombre accesible — per design-system §11 (WCAG 2.1 AA) + `qa-frontend-standards.md` §23 (axe a nivel componente); mismo patrón que `src/features/a11y.test.tsx` de US-001.
  - **Exit criterion**: existe `src/features/storefront/a11y.test.tsx` que corre axe sobre los tres estados y falla ante cualquier violación; los asserts de `h1` único y alt descriptivo fallan si se rompen.
  - **Verify**: `pnpm --filter @dsm/web test -- --run src/features/storefront/a11y`

- [ ] T6.2 Smoke E2E Playwright — SSR indexable + 404 real + frescura del precio vía invalidación (red de seguridad del dev; batería completa owned-by-QA) (1.25 h)
  - **Pattern**:
    ```ts
    // Seed por API admin (aislamiento por test — sku único por corrida), luego:
    const res = await page.goto(`/productos/${sku}`);
    expect(res!.status()).toBe(200);
    expect(await res!.text()).toContain(product.name);         // SSR: contenido en el HTML del server
    expect(await res!.text()).toContain('application/ld+json'); // JSON-LD presente (AC-2)
    const notFound = await page.goto('/productos/SKU-INEXISTENTE');
    expect(notFound!.status()).toBe(404);                       // 404 REAL, no soft-200 (AC-7/AC-8)
    // AC-9 end-to-end (invalidación on-demand, T3.4): la edición DEBE ir por el panel
    // (la UI de US-001) — es el camino que dispara revalidateProduct; editar por API
    // directa NO invalida (eso lo cubre solo el safety-net de 1h y no es testeable acá).
    /* login admin → editar precio del producto en el panel → guardar OK */
    const fresh = await page.goto(`/productos/${sku}`);
    expect(await fresh!.text()).toContain(formatoNuevoPrecio);  // precio nuevo INMEDIATO, sin esperar TTL
    ```
    — per `playwright-stability` (locators por rol, sin `waitForTimeout`, seed per-test vía API, login admin reutilizando el flujo del smoke de US-001 — `page.route` NO sirve acá: el fetch SSR es server-side) + `frontend-next-standards.md` §9 (E2E contra `next build && next start` — las Server Actions requieren build real). Nota: producto draft ≡ inexistente desde afuera (404 uniforme del BE), un solo caso negativo basta en el smoke; la matriz completa es de QA-US-003.
  - **Exit criterion**: el spec crea y publica un producto por la API admin (sku único), navega a la ficha y **asserta sobre el body de la respuesta del server** (no el DOM hidratado) que nombre, precio y JSON-LD están en el HTML; asserta status 404 (no 200) para un sku inexistente; y verifica AC-9 end-to-end: tras cargar la ficha (caché poblada), editar el precio **vía la UI del panel** y recargar, el HTML del server muestra el precio nuevo **inmediatamente** (sin `waitForTimeout` ni esperar TTL — si la invalidación no corre, este assert falla contra la caché de 1h); corre verde contra build de producción con la API local.
  - **Verify**: `pnpm --filter @dsm/web test:e2e`

## Documentación

- [ ] T7.1 README de `apps/web` + `.env.example` — nuevas variables públicas y alcance storefront (0.25 h)
  - **Exit criterion**: `apps/web/README.md` documenta el storefront (ruta `/productos/{sku}`, decisión interina OQ-FE-1) y las nuevas env públicas `NEXT_PUBLIC_SITE_URL` (canonical/OG/JSON-LD), `NEXT_PUBLIC_WHATSAPP_PHONE` (placeholder hasta OQ-FE-3) y `NEXT_PUBLIC_IMAGE_CDN_HOST` (remotePatterns); el `.env.example` correspondiente las incluye; ningún secreto lleva prefijo `NEXT_PUBLIC_` (next-standards §8) — per documentation-standards §11.1.
  - **Verify**: `grep -q "NEXT_PUBLIC_SITE_URL" apps/web/README.md && grep -q "NEXT_PUBLIC_WHATSAPP_PHONE" apps/web/README.md && grep -q "NEXT_PUBLIC_IMAGE_CDN_HOST" apps/web/README.md && ! grep -rn "NEXT_PUBLIC_.*SECRET\|NEXT_PUBLIC_.*TOKEN" apps/web/src apps/web/app 2>/dev/null | grep -q .`

## Verification (suite-level)

- [ ] Unit + component + integración verdes: `pnpm --filter @dsm/web test -- --run`
- [ ] Lint limpio: `pnpm --filter @dsm/web lint`
- [ ] Typecheck limpio: `pnpm --filter @dsm/web typecheck`
- [ ] Build de producción OK (la ruta de la ficha compila como Server Component con ISR): `pnpm --filter @dsm/web build`
- [ ] Smoke E2E verde (SSR + 404 real): `pnpm --filter @dsm/web test:e2e`
- [ ] Codegen del contrato en sync (gate `frontend-codegen-fresh`): `pnpm --filter @dsm/web codegen && git diff --quiet -- apps/web/src/api/generated`
- [ ] Sin `fetch` crudo fuera del cliente (F48): el único `fetch` sigue en `src/lib/http/client.ts` (allowlist `.consumer-contract-allow`)
- [ ] Reconciliación contra `design.md` completo (F51): decisiones D1–D9 construidas o con `Deferred:` documentado
