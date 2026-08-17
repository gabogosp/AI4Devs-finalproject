---
tracker-id: null
tracker-source: null
parent-us: US-003
discipline: frontend-web
variant: null
language: es
---

# US-003 Frontend Web — Ficha de producto (PDP) indexable

## Why

La ficha de producto es el punto de conversión del descubrimiento (browse US-002, búsqueda IA US-004) hacia la compra (US-007), y una página clave de **SEO** (PRD §1.2: "ser encontrado"). El backend hermano (`US-003-ficha-producto-pdp-backend`, verde y verificado) ya expone la superficie pública de lectura: `GET /v1/products/{sku}` sin auth, con 404 uniforme para draft/archivado/inexistente, señal `in_stock`, `image_url` nullable y caché acotada `Cache-Control: public, max-age=60, stale-while-revalidate=30` (AC-9).

Lo que falta —y es lo que entrega este change— es la **superficie pública que consume ese contrato**: la primera página del storefront en `apps/web` (hoy solo existe el panel del dueño de US-001). Una página **SSR indexable** (`app/(storefront)/productos/[sku]`) con metadatos por ficha, JSON-LD `schema.org/Product`, y los estados de UI que los AC exigen: sin stock (badge + sin CTA + canal WhatsApp), sin imagen (placeholder), descripción enriquecida-o-base, y **404 real** (status HTTP, no soft-200) para lo oculto o inexistente.

La app `apps/web` ya trae de US-001 el sustrato que este change reutiliza sin re-arquitecturar: codegen del contrato (orval → DTOs + Zod + MSW, gate `frontend-codegen-fresh`), cliente HTTP único como mutator (F48), mapeo RFC 7807 → `AppError`, tokens del design-system en Tailwind, helper ARS compartido server/client, y toolchain de test (Vitest + RTL + MSW + Playwright + jest-axe).

## What changes

- **Regeneración del codegen del contrato** (`frontend-standards.md` §3.1/§3.2): `pnpm --filter @dsm/web codegen` incorpora `storefrontGetProduct` (ya publicado en `apps/api/docs/api/openapi.yaml`) a los DTOs, schemas Zod y handlers MSW generados. Nada del contrato se escribe a mano.
- **Cliente HTTP isomorfo** (`src/lib/http/client.ts`): el mutator pasa a ser ejecutable en Server Components — en server no inyecta token admin ni `traceparent` aleatorio (estabilidad de la clave de caché de datos de Next) y reenvía las opciones `next: { revalidate, tags }` (next-standards §3). Sigue siendo el único punto de red (F48).
- **Servicio de storefront** (`src/features/storefront/storefrontService.ts`, §3.3): `getProductBySku` sobre el cliente generado + validación runtime con el Zod generado (`parseContract`) + `AppError` tipado.
- **Ruta SSR** `app/(storefront)/productos/[sku]/page.tsx` (Server Component async): fetch con caché explícita **por tag** (`next: { revalidate: 3600, tags: ['product:{sku}'] }` — safety-net de 1h + invalidación on-demand, AC-9 per OQ-FE-4 opción C), `notFound()` ante 404 del contrato → **status HTTP 404 real** con `not-found.tsx` accionable (AC-7/AC-8); `error.tsx` con reintento + reporte a Sentry; `loading.tsx` skeleton.
- **Invalidación on-demand desde el panel** (AC-9, decisión del usuario 2026-08-16): Server Action `revalidateProduct(sku)` (`'use server'`, input validado — next-standards §4) que ejecuta `revalidateTag('product:{sku}')` + `revalidatePath('/productos/{sku}')`; el flujo de mutación de productos del panel (misma app Next per E2E §6.2) la invoca tras cada edición/publicación/archivado exitoso → el precio nuevo se ve **inmediatamente** en la ficha; el `revalidate: 3600` cubre mutaciones que no pasen por el panel (safety-net, nunca precio viejo indefinido).
- **SEO**: `generateMetadata` por ficha (title/description/canonical/Open Graph con imagen del producto, design-system §8.1) + **JSON-LD `schema.org/Product`** serializado de forma segura (input del dueño = no confiable; escape de `<` — security-standards §6).
- **Componentes de la ficha** (design-system como fuente visual — sin Figma): composición con jerarquía fija imagen → nombre → precio → disponibilidad → CTA (§7.3); `PriceTag` ARS con "IVA incluido" (§7.4, helper existente); badge "Sin stock" (§7.7, texto + color); imagen vía `next/image` con `priority` + `sizes` de ficha y **fallback placeholder** (ícono `package` sobre `gray-100`, §8.1/§10.1) tanto para `image_url: null` como para carga rota; descripción base-o-enriquecida como texto plano (AC-5 — la resolución la hace el backend/US-005).
- **CTA "Agregar al carrito"** (AC-3): botón `accent` (§7.1) presente como **disparador con seam** — deshabilitado hasta que US-007 inyecte la lógica de carrito, sin rediseñar la ficha. **Sin stock** (AC-4): el CTA no se ofrece; en su lugar, enlace WhatsApp (`wa.me`) con el copy del design-system §10.2 ("Sin stock por ahora. Escribinos por WhatsApp…"), per §7.10/§7.14.
- **Observabilidad FE** (E2E §18, observability-patterns §9.5.2): evento cliente `pdp_shown` (con `sku` como propiedad de analytics, sin PII) — necesario porque con ISR el backend no ve cada vista y `product.viewed` (emitido por el BE en cada hit al origen) subcuenta; Web Vitals ya reportan vía Sentry (US-001).
- **Tests owned-by-dev** (qa-frontend-standards §2.1): unit del servicio (MSW generado: 200/404/5xx), component de la ficha en sus tres estados (con stock / sin stock / sin imagen), a11y con jest-axe (0 violaciones), y smoke E2E Playwright que verifica **SSR real** (el HTML del server contiene nombre, precio y JSON-LD) y **404 real** (status de la respuesta). La batería de aceptación cross-funcional (SEO/SSR/a11y completa, Lighthouse/LCP) es owned-by-QA (`QA-US-003`).

## ACs de US-003 cubiertos (superficie FE)

| AC | Qué cubre este change (FE) | Nota |
|---|---|---|
| **AC-1** | Ficha con nombre, descripción, precio ARS IVA incluido, imagen, categoría y disponibilidad; URL propia por producto | URL interina por `sku` (el `slug` de producto es OQ-BE-1, infra-owned) — ver OQ-FE-1 |
| **AC-2** | SSR (Server Component), metadatos por ficha (Metadata API) y JSON-LD `schema.org/Product` | verificado en E2E leyendo el HTML del server |
| **AC-3** | CTA "Agregar al carrito" presente como disparador (botón `accent` §7.1) con seam para US-007 | la lógica de carrito es US-007 — ver OQ-FE-2 |
| **AC-4** | `in_stock: false` → badge "Sin stock" (§7.7), sin CTA de compra, enlace WhatsApp (§7.10, copy §10.2) | el canal WhatsApp completo es US-018 |
| **AC-5** | Render de `description` del contrato (el BE resuelve enriched ?? raw cuando exista US-005); si es null, la sección se omite | texto plano — nunca `dangerouslySetInnerHTML` |
| **AC-6** | `image_url: null` o imagen rota → placeholder consistente (§8.1); el resto de la ficha se renderiza normal | |
| **AC-7** | 404 del backend (draft/archivado) → `notFound()` → **status 404 real** con página útil; no indexable | el 404 uniforme (sin enumeration leak) lo garantiza el BE |
| **AC-8** | sku inexistente → mismo camino 404 real (no soft-200) | verificado por status en E2E |
| **AC-9** | Caché por tag `product:{sku}` + invalidación on-demand desde el panel al mutar (precio nuevo **inmediato**) + safety-net `revalidate: 3600` (nunca precio viejo indefinido) | OQ-FE-4 opción C — ver design.md D2 |

## Out of scope

- **Lógica de agregar al carrito** (estado del carrito, mini-cart, stepper de cantidad) → **US-007**; acá solo el disparador con seam.
- **Canal WhatsApp completo** (número definitivo, mensajes prellenados por contexto, botón flotante global) → **US-018**; acá el enlace de la ficha sin stock con número por env.
- **Listado / navegación por categoría, top-nav completo del storefront (SearchBar, carrito, CategoryNav §7.10) y breadcrumb con link a la categoría** → **US-002**; acá la categoría se muestra como texto. `Deferred: US-002 — la navegación del storefront es su alcance`.
- **Galería de imágenes / zoom, productos relacionados, reseñas** → fuera de v1 (US §4).
- **Enriquecimiento de la descripción** → **US-005** (el contrato ya antepone `enriched` cuando exista; el FE no distingue).
- **URL por `slug` de producto** → **OQ-BE-1** (columna infra-owned en `@dsm/db`); interino `sku` con migración documentada (design.md D1).
- **Sitemap.xml / robots.txt del storefront** → con US-002 (necesita el listado para enumerar URLs). `Deferred: US-002`.
- **Cambios de contrato o de esquema**: ninguno. Este change **consume** `GET /v1/products/{sku}` tal como está publicado; si necesitara un cambio, se detiene y se escala al backend.
- **Medición numérica de LCP < 2.5s y batería SEO completa** → owned-by-QA (`QA-US-003`); acá se construye para el budget (priority, sizes, SSR) y se deja el smoke.

## Standards consultados

- `spekode/docs/base-standards.md` — principios core, §2.4 (idioma: markers en inglés, prosa en español).
- `spekode/docs/code/frontend-standards.md` — §2 (package-by-feature), §3.1/§3.2/§3.3 (artefactos del contrato generados; hand-written solo el servicio), §5 (taxonomía de error), §8 (cliente HTTP único), §11 (implementation patterns: 11.3 error mapping, 11.5 repositorio por feature, 11.9 estados explícitos), §12 (seguridad: sin `dangerouslySetInnerHTML` sin sanitizar, secretos fuera del bundle, headers §12.4).
- `spekode/docs/code/frontend-next-standards.md` (overlay Next, stack `next` per project-config) — §1 (App Router, `not-found.tsx`/`error.tsx`/`loading.tsx` por segmento), §2 (Server Components por defecto, `"use client"` en hojas), **§3 (caching explícito por fetch — base de AC-9)**, §6 (Metadata API, `next/image`, SEO), §7 (client JS mínimo, RSC), §8.bis (security headers — ya cableados en US-001), §9 (testing overlay: E2E contra `next build && next start`), §10 (anti-patterns).
- `spekode/docs/architecture/api-standards.md` — §5.5 (money en centavos), §8 (RFC 7807), caché HTTP.
- `spekode/docs/cross-cutting/security-standards.md` — §6 (output encoding / XSS: JSON-LD con datos del dueño escapado).
- `spekode/docs/quality/testing-standards.md` §14 + `qa-frontend-standards.md` §2.1 (ownership dev vs QA), §23 (Vitest/MSW/Playwright/axe).
- `spekode/docs/ai/documentation-standards.md` §11.1 — README de `apps/web` (nuevas env vars).
- Skills: `openspec-workflow` (tasks closure-grade F49/F50/F51), `fe-design-without-figma` (design-system `Approved` como fuente visual), `openapi-client-codegen` (regeneración, F48), `msw-setup` (handlers generados + overrides por test), `frontend-resilience-patterns` (#10 error boundary, #11 image fallback, #12 skeleton), `playwright-stability` (locators por rol, asserts de status/HTML), `observability-patterns` §9.5 (evento por pantalla, cardinalidad).
- ADRs heredados: ADR-0001 (Railway/Neon/R2 — host de imágenes), ADR-0007 (monolito modular — el FE consume su API). Ningún ADR nuevo se dispara (ver design.md).

## Open questions

> Ratificación del usuario **2026-08-16**: OQ-FE-1/2/5 resueltas con la opción recomendada (A); OQ-FE-4 resuelta con la **opción C** (invalidación on-demand, no la recomendada). Solo queda pendiente OQ-FE-3 (dato del cliente, no bloquea el desarrollo).

- **OQ-FE-1 — URL de la ficha (AC-1).** `[Resolved: 2026-08-17 — repivotada a slug]` Ruta **`/productos/{slug}`**. La resolución previa (`[Resolved: 2026-08-16 — opción A]`, ruta interina `/productos/{sku}` con 301 futuro) quedó sin premisa: el backend resolvió OQ-BE-1 y materializó `products.slug` en la Fase 10 de su change **antes** de construir la PDP, con el argumento de que el SEO es el objetivo de negocio del PRD y cambiar la URL después de indexar cuesta 301s + re-crawl. Detectado durante la ejecución de T3.1 (el contrato pasó a `GET /v1/products/{slug}` y `StorefrontProduct` ganó el campo `slug`); el usuario ratificó el pivote inmediato sin regenerar el plan, así que las tasks afectadas (T1.1, T2.1, T3.1–T3.4, T6.2, T7.1) se reescribieron en sitio contra `slug`. Descartadas: (B) bloquear el FE hasta que el backend cerrara la Fase 10; (C) sostener el interino por `sku` y migrar con 301 (pagaba exactamente el re-crawl que la Fase 10 evita).
- **OQ-FE-2 — Disparador "Agregar al carrito" antes de US-007 (AC-3).** `[Resolved: 2026-08-16 — opción A]` Botón `accent` renderizado pero **deshabilitado** (estado disabled §7.1) con seam `onAddToCart`: la ficha queda visualmente completa y US-007 solo inyecta el handler; un botón activo que no hace nada erosiona confianza (§7.14). Descartadas: (B) botón activo con feedback interino (inventa copy que US-007 pisa); (C) ocultarlo (AC-3 débil + re-layout).
- **OQ-FE-3 — Número de WhatsApp del local (AC-4).** `[Deferred: el dato no bloquea el desarrollo — la ficha se cablea contra la env y el número real solo hace falta para que el enlace funcione en producción — owner: PO/cliente, revisit: antes del primer deploy (US-019)]` El enlace `wa.me` necesita el número real de DSM. Se cablea vía `NEXT_PUBLIC_WHATSAPP_PHONE` (dato público, no secreto) con placeholder en dev; US-018 lo consolidará como canal. No bloquea el desarrollo.
- **OQ-FE-4 — Estrategia de frescura del precio en el SSR (AC-9).** `[Resolved: 2026-08-16 — opción C: revalidateTag on-demand]` El usuario exige frescura **inmediata** al editar precio. Mecanismo (design.md D2): fetch de la ficha con `next: { revalidate: 3600, tags: ['product:{sku}'] }` (safety-net de 1h) + Server Action `revalidateProduct(sku)` que ejecuta `revalidateTag` + `revalidatePath` y es invocada por el flujo de mutación de productos del panel (misma app Next) tras cada edición/publicación/archivado exitoso. Descartadas: (A — la recomendada del planner) ISR `revalidate: 60` (aceptaba ~60–90s de precio viejo); (B) `no-store` (perdía ISR/SEO/carga). Nota de coordinación registrada en design.md D2: la inmediatez asume que el fetch SSR va directo al origen de la API (sin CDN intermedio que respete el `max-age=60` del BE) — cierto en la topología actual; revisar si US-019 interpone un CDN.
- **OQ-FE-5 — Fuente del conteo de vistas de ficha (US §9 → insumo US-016).** `[Resolved: 2026-08-16 — opción A]` Este change agrega el evento cliente `pdp_shown` (sin PII, `sku` como propiedad de analytics) y se mantiene `product.viewed` del BE; US-016 decide la fuente autoritativa al planificarse (con caché por tag el origen sigue sin ver cada vista). Descartadas: (B) solo evento BE (subcuenta); (C) retirar el evento BE (tocaba un change cerrado).

## References

- User Story: `docs/user-stories/US-003-ficha-producto-pdp.md` (AC-1…AC-9, §8 diseño, §9 NFRs)
- E2E: `docs/product/design-e2e.md` §6.2 (Storefront SSR indexable), §17 (SEO/LCP < 2.5s, p95 lectura < 300ms), §18 (observabilidad Sentry + Web Vitals)
- Design system (fuente visual, `Approved` — NO se redefine): `docs/product/design-system.md` §7.1 (Button accent), §7.3 (ProductCard/ficha, jerarquía), §7.4 (PriceTag ARS), §7.7 (badge stock), §7.10 (WhatsApp), §8.1 (imagen 1:1, sizes, priority, fallback, OG), §10.1 (patrones loading/empty/error), §10.2 (copy), §11 (a11y WCAG 2.1 AA)
- Contrato consumido (NO se redefine): `apps/api/docs/api/openapi.yaml` (`storefrontGetProduct`) + `openspec/changes/US-003-ficha-producto-pdp-backend/contracts/openapi/storefront-get-product.yaml` + su `design.md`
- Change de backend hermano (la API, verde): `openspec/changes/US-003-ficha-producto-pdp-backend/`
- Estado declarado: `openspec/specs/catalogo/` (requirements.md NFR-4 — codegen obligatorio; decisions.md)
- Change FE precedente (sustrato reutilizado): `openspec/changes/archive/US-001-admin-catalogo-productos-frontend-web/`
