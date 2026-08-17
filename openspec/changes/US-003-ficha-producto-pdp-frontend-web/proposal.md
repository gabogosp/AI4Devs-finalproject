---
tracker-id: null
tracker-source: null
parent-us: US-003
discipline: frontend-web
variant: null
language: es
regenerated-at: 2026-08-17
supersedes-backup: openspec/changes/_backups/2026-08-17-1-US-003-ficha-producto-pdp-frontend-web
---

# US-003 Frontend Web — Ficha de producto (PDP) indexable

> **Plan regenerado el 2026-08-17.** El plan anterior (respaldado en
> `openspec/changes/_backups/2026-08-17-1-US-003-ficha-producto-pdp-frontend-web/`) se detuvo
> durante la ejecución por **dos roturas de premisa**: (1) el backend resolvió OQ-BE-1 y
> materializó `products.slug`, así que el identificador público pasó de `sku` a `slug`
> (repivotado en sitio, ya reflejado en el trabajo commiteado); (2) **colisión de namespace de
> rutas** — el panel de US-001 ocupa `/productos`, `/productos/[id]`, `/categorias` y `/` en la
> misma app Next, y poner la ficha en `/productos/{slug}` **no compila**. La segunda quedó sin
> resolver y es lo que esta regeneración decide (OQ-FE-6). El trabajo ya commiteado (T1.1, T1.2,
> T2.1) se conserva: es namespace-independiente y sigue válido.

## Why

La ficha de producto es el punto de conversión del descubrimiento (browse US-002, búsqueda IA
US-004) hacia la compra (US-007), y una página clave de **SEO** (PRD §1.2: "ser encontrado").
El backend hermano (`US-003-ficha-producto-pdp-backend`) ya expone la superficie pública de
lectura: `GET /v1/products/{slug}` sin auth, con 404 uniforme para draft/archivado/inexistente,
señal `in_stock`, `image_url` nullable y caché acotada
`Cache-Control: public, max-age=60, stale-while-revalidate=30` (AC-9).

Lo que falta —y es lo que entrega este change— es la **superficie pública que consume ese
contrato**: la primera página del storefront en `apps/web` (hoy solo existe el panel del dueño de
US-001). Una página **SSR indexable** en `/productos/{slug}` con metadatos por ficha, JSON-LD
`schema.org/Product`, y los estados de UI que los AC exigen: sin stock (badge + sin CTA + canal
WhatsApp), sin imagen (placeholder), descripción enriquecida-o-base, y **404 real** (status HTTP,
no soft-200) para lo oculto o inexistente.

Para poder hacerlo, este change resuelve primero un problema que **excede a US-003 pero lo
bloquea**: el **namespace de URLs públicas**. El panel de US-001 vive en la misma app Next
(decisión del E2E §1.3-6 / §6.2) y ya ocupa `/productos`, `/productos/[id]`, `/productos/nuevo`,
`/categorias` y `/` — exactamente el espacio que el storefront necesita para ser indexable.
US-002 (catálogo público) y US-004 (búsqueda) chocan con la misma pared. Se decide acá, una vez,
y las US siguientes lo heredan (OQ-FE-6 + ADR-0010).

## What changes

- **Namespace de rutas (nuevo — Fase 0, OQ-FE-6)**: el **storefront se queda con el espacio
  público raíz** (`/`, `/productos/{slug}`, y en US-002 `/categorias/{slug}`) y el **panel del
  dueño se muda a `/admin/*`** (`/admin/acceso`, `/admin/productos`, `/admin/productos/nuevo`,
  `/admin/productos/{id}`, `/admin/categorias`). Es un **refactor Move behavior-preserving** sobre
  superficie entregada de US-001 (radio medido: 4 carpetas de ruta + `router.push` + `router.replace`
  del guard + 2 asserts de test + 5 referencias del smoke E2E); nada está desplegado todavía
  (US-019 en curso), así que **no hay 301 ni URLs indexadas que romper**. Se acompaña con
  `X-Robots-Tag: noindex` para `/admin/*` (E2E §14 — "no exponer panel sin auth") y con
  **ADR-0010** que fija la convención para US-002/US-004/US-007/US-016.
- **Home pública mínima `/`** + `layout` del route group `(storefront)`: hoy `/` renderiza
  "DSM — Panel del dueño"; pasa a ser la raíz pública (wordmark + enlace), suficiente para que el
  404 de la ficha y el JSON-LD tengan un "inicio" real. La home completa del storefront es
  `Deferred: US-002`.
- **Regeneración del codegen del contrato** (`frontend-standards.md` §3.1/§3.2) — **HECHO y
  commiteado (T1.1)**: `storefrontGetProduct(slug, options)` y `StorefrontProduct.slug` están en
  DTOs, Zod y handlers MSW generados. Nada del contrato se escribe a mano.
- **Cliente HTTP isomorfo** (`src/lib/http/client.ts`) — **HECHO y commiteado (T1.2)**: el mutator
  corre en Server Components; en server no inyecta `authorization` ni `traceparent` (un header
  aleatorio por render envenena la clave de la Data Cache de Next y anula `revalidate`), y reenvía
  `init.next`/`init.cache`. Sigue siendo el único punto de red (F48).
- **Servicio de storefront** — **HECHO y commiteado (T2.1)**: `getProductBySlug` sobre el cliente
  generado + validación runtime con el Zod generado + `AppError` tipado, con la política de caché
  declarada en el servicio (`revalidate: 3600` + tag `product:{slug}` vía `productTag`).
- **Ruta SSR** `app/(storefront)/productos/[slug]/page.tsx` (Server Component async): `notFound()`
  ante 404 del contrato → **status HTTP 404 real** con `not-found.tsx` accionable (AC-7/AC-8);
  `error.tsx` con reintento + reporte a Sentry; `loading.tsx` skeleton.
- **Invalidación on-demand desde el panel** (AC-9, OQ-FE-4 opción C): Server Action
  `revalidateProduct(slug)` (`'use server'`, input validado — next-standards §4) que ejecuta
  `revalidateTag('product:{slug}')` + `revalidatePath('/productos/{slug}')`; el flujo de mutación de
  productos del panel la invoca tras cada edición/publicación/archivado exitoso → el precio nuevo se
  ve **inmediatamente**; el `revalidate: 3600` cubre mutaciones que no pasen por el panel.
- **SEO**: `generateMetadata` por ficha (title/description/canonical/Open Graph, design-system §8.1)
  + **JSON-LD `schema.org/Product`** serializado de forma segura (input del dueño = no confiable;
  escape de `<` — security-standards §6).
- **Componentes de la ficha** (design-system como fuente visual — sin Figma): jerarquía fija
  imagen → nombre → precio → disponibilidad → CTA (§7.3); `PriceTag` ARS con "IVA incluido" (§7.4,
  helper existente); badge "Sin stock" (§7.7, texto + color); imagen vía `next/image` con `priority`
  + `sizes` y **fallback placeholder** (ícono `package` sobre `gray-100`, §8.1/§10.1) para
  `image_url: null` y para carga rota; descripción como texto plano (AC-5).
- **CTA "Agregar al carrito"** (AC-3): botón `accent` (§7.1) presente como **disparador con seam**,
  deshabilitado hasta que US-007 inyecte la lógica. **Sin stock** (AC-4): el CTA se **reemplaza**
  por "Avisame por WhatsApp" (`wa.me`) con el copy §10.2 — per design-system §7.3 ("no un botón
  disabled mudo") + §7.14.
- **Observabilidad FE** (E2E §18, observability-patterns §9.5.2): evento cliente `pdp_shown`
  (`slug`/`sku` como propiedades de analytics, sin PII) — con ISR el backend no ve cada vista y
  `product.viewed` subcuenta; Web Vitals ya reportan vía Sentry (US-001).
- **Tests owned-by-dev** (qa-frontend-standards §2.1): unit del servicio (MSW generado), component
  de la ficha en sus tres estados, a11y con jest-axe, y smoke E2E Playwright que verifica **SSR
  real** y **404 real** contra un **stub HTTP del contrato levantado como `webServer`** (el fetch
  del SSR es server-side: `page.route` **no** lo intercepta — por eso el stub, no docker), más el
  **circuito de invalidación AC-9 end-to-end**. La batería de aceptación cross-funcional
  (SEO/a11y completa, Lighthouse/LCP) es owned-by-QA (`QA-US-003`).

## ACs de US-003 cubiertos (superficie FE)

| AC | Qué cubre este change (FE) | Nota |
|---|---|---|
| **AC-1** | Ficha con nombre, descripción, precio ARS IVA incluido, imagen, categoría y disponibilidad; **URL amigable `/productos/{slug}`** | el AC pide explícitamente slug — OQ-FE-1 `[Resolved]` + OQ-FE-6 (namespace) |
| **AC-2** | SSR (Server Component), metadatos por ficha (Metadata API) y JSON-LD `schema.org/Product` | verificado en E2E leyendo el HTML del server |
| **AC-3** | CTA "Agregar al carrito" presente como disparador (botón `accent` §7.1) con seam para US-007 | la lógica de carrito es US-007 — OQ-FE-2 |
| **AC-4** | `in_stock: false` → badge "Sin stock" (§7.7), **sin** CTA de compra, CTA WhatsApp en su lugar (§7.3/§7.14, copy §10.2) | el canal WhatsApp completo es US-018 |
| **AC-5** | Render de `description` del contrato (el BE resuelve enriched ?? raw cuando exista US-005); si es null, la sección se omite | texto plano — nunca `dangerouslySetInnerHTML` |
| **AC-6** | `image_url: null` o imagen rota → placeholder consistente (§8.1); el resto de la ficha se renderiza normal | |
| **AC-7** | 404 del backend (draft/archivado) → `notFound()` → **status 404 real** con página útil; no indexable | el 404 uniforme (sin enumeration leak) lo garantiza el BE |
| **AC-8** | slug inexistente → mismo camino 404 real (no soft-200) | verificado por status en E2E |
| **AC-9** | Caché por tag `product:{slug}` + invalidación on-demand desde el panel al mutar (precio nuevo **inmediato**) + safety-net `revalidate: 3600` | OQ-FE-4 opción C — design.md D2, verificado end-to-end en T6.3 |

## Out of scope

- **Lógica de agregar al carrito** (estado del carrito, mini-cart, stepper de cantidad) → **US-007**;
  acá solo el disparador con seam.
- **Canal WhatsApp completo** (número definitivo, mensajes prellenados, botón flotante global) →
  **US-018**; acá el enlace de la ficha sin stock con número por env.
- **Listado / navegación por categoría, top-nav completo del storefront (SearchBar, carrito,
  CategoryNav §7.10), home real y breadcrumb con link a la categoría** → **US-002**; acá la
  categoría se muestra como texto y la home es un stub. `Deferred: US-002`.
- **Rediseño del panel**: la mudanza a `/admin/*` es un **Move** de rutas — no cambia pantallas,
  componentes, copy ni comportamiento del panel. Cualquier mejora del panel queda fuera.
- **Galería de imágenes / zoom, productos relacionados, reseñas** → fuera de v1 (US §4).
- **Enriquecimiento de la descripción** → **US-005**.
- **Sitemap.xml / robots.txt del storefront** → con US-002 (necesita el listado para enumerar URLs).
  `Deferred: US-002`. El `X-Robots-Tag: noindex` de `/admin/*` **sí** entra acá (es parte de la
  mudanza de namespace).
- **Cambios de contrato o de esquema**: ninguno. Este change **consume**
  `GET /v1/products/{slug}` tal como está publicado.
- **Medición numérica de LCP < 2.5s y batería SEO completa** → owned-by-QA (`QA-US-003`).
- **Invalidación desde el import masivo** → `Deferred: US-006 — el flujo de import invocará la misma
  Server Action por cada slug afectado; hasta entonces cubre el safety-net de 1h`.

## Standards consultados

- `spekode/docs/base-standards.md` — principios core, §2.4 (idioma: markers en inglés, prosa en español).
- `spekode/docs/code/frontend-standards.md` — §2 (package-by-feature), §3.1/§3.2/§3.3 (artefactos del
  contrato generados; hand-written solo el servicio), §5 (taxonomía de error), §8 (cliente HTTP único),
  §11 (11.3 error mapping, 11.5 repositorio por feature, 11.9 estados explícitos), §12 (seguridad:
  sin `dangerouslySetInnerHTML` sin sanitizar, secretos fuera del bundle, headers §12.4).
- `spekode/docs/code/frontend-next-standards.md` (overlay Next, stack `next` per project-config) —
  **§1 (App Router: `app/(group)/segment/page.tsx`, boundaries colocados por segmento — base de la
  decisión de namespace)**, §2 (Server Components por defecto, `"use client"` en hojas),
  **§3 (caching explícito por fetch — base de AC-9)**, §4 (Server Actions validan input),
  §6 (Metadata API, `next/image`, SEO), §7 (client JS mínimo), §8/§8.bis (env públicas, security
  headers), §9 (E2E contra `next build && next start`), §10 (anti-patterns).
- `spekode/docs/architecture/api-standards.md` — §5.5 (money en centavos), §8 (RFC 7807), caché HTTP.
- `spekode/docs/cross-cutting/security-standards.md` — §6 (output encoding / XSS: JSON-LD escapado);
  superficie del panel (E2E §14) → `noindex` + prefijo dedicado.
- `spekode/docs/quality/testing-standards.md` §14 + `qa-frontend-standards.md` §2.1 (ownership dev vs
  QA), §23 (Vitest/MSW/Playwright/axe).
- `spekode/docs/ai/documentation-standards.md` §8.1 (disparador de ADR — la convención de namespace
  califica: un mantenedor futuro preguntará "¿por qué el panel está en /admin?"), §11.1 (README de
  `apps/web`).
- Skills: `openspec-workflow` (tasks closure-grade F49/F50/F51), `refactoring-discipline` (la mudanza
  del panel es un **Move** con invariante de comportamiento y criterio de éxito = suite verde),
  `fe-design-without-figma` (design-system `Approved` como fuente visual), `openapi-client-codegen`
  (F48), `msw-setup`, `frontend-resilience-patterns` (#10 boundary, #11 image fallback, #12 skeleton),
  `playwright-stability` (locators por rol, sin `waitForTimeout`), `observability-patterns` §9.5.
- ADRs heredados: ADR-0001 (Railway/Neon/R2 — host de imágenes), ADR-0007 (monolito modular),
  ADR-0009 (seam de auth admin — precedente de ADR US-scoped). **Nuevo: ADR-0010** (namespace de URLs).

## Open questions

> Ratificaciones vigentes: **2026-08-16** OQ-FE-2 / OQ-FE-4 (opción C) / OQ-FE-5; **2026-08-17**
> OQ-FE-1 (repivote a slug). **Nueva en esta regeneración: OQ-FE-6 (namespace de rutas)**.

- **OQ-FE-1 — Identificador público de la ficha (AC-1).** `[Resolved: 2026-08-17 — slug]`
  La ficha se sirve por **`slug`**: contrato `GET /v1/products/{slug}` y `StorefrontProduct.slug`.
  La resolución previa (ruta interina por `sku` con 301 futuro) quedó **sin premisa**: el backend
  resolvió OQ-BE-1 y materializó `products.slug` en la Fase 10 de su change **antes** de construir
  la PDP, con el argumento de que el SEO es el objetivo de negocio del PRD y cambiar la URL después
  de indexar cuesta 301s + re-crawl — y AC-1 pide explícitamente "URL amigable (slug)". El usuario
  ratificó el pivote. **Descartadas**: (B) bloquear el FE hasta el cierre de la Fase 10; (C) sostener
  el interino por `sku` y migrar con 301 (pagaba exactamente el re-crawl que la Fase 10 evita).
  *Nota de estado*: las tasks de la Fase 10 del change backend siguen abiertas `[ ]` y su edición del
  contrato está sin commitear — la **forma** del contrato está decidida, pero está **en vuelo**; el
  pre-requisito P3 de `tasks.md` lo verifica antes de arrancar la Fase 3.

- **OQ-FE-6 — Namespace de URLs: quién se queda con `/productos` y `/categorias` (bloqueante).**
  `[Resolved: 2026-08-17 — el storefront se queda con el espacio público raíz; el panel se muda a
  /admin/*]`
  **El problema**: el panel de US-001 y el storefront viven en la **misma app Next** (E2E §1.3-6 /
  §6.2) y compiten por las mismas URLs. `app/(admin)/productos/[id]` + `app/(storefront)/productos/[slug]`
  **rompe el build** (`You cannot use different slug names for the same dynamic path ('id' !== 'slug')`);
  y aun con el mismo nombre de parámetro, dos route groups **no pueden resolver la misma ruta** — los
  route groups organizan el árbol, no cambian el path (next-standards §1). No es local a US-003:
  US-002 necesita `/productos` (grilla) y `/categorias/{slug}`, y US-004 la home de búsqueda.
  **Decisión y por qué**: (1) el espacio público raíz **es** el activo de SEO que el PRD §1.2
  monetiza — anidar el storefront bajo un prefijo degrada exactamente lo que la US existe para
  lograr, y aun así seguiría colisionando en `/` (la home pública); (2) **simetría con la API**: el
  E2E ya usa `/admin/*` para la superficie admin (§6.1, §14) — un solo modelo mental "admin =
  prefijo privado"; (3) **postura de seguridad**: el prefijo dedicado hace el gate y el
  `X-Robots-Tag: noindex` una regla única y auditable sobre `/admin/:path*` (E2E §14 "no exponer
  panel sin auth"), y elimina el riesgo de que una ruta pública futura herede el layout del panel;
  (4) **costo real bajo y sin deuda externa**: 4 carpetas + 3 referencias de código + 5 del smoke,
  y **nada está desplegado** (US-019 en curso) → cero URLs indexadas, cero bookmarks, **cero 301**;
  (5) postergarlo empeora: en US-002 el panel está más entrelazado y el storefront tendría un
  namespace equivocado que migrar.
  **Descartadas**: (B) storefront bajo prefijo (`/tienda/*`, `/p/{slug}`) — no toca US-001 pero
  degrada el activo SEO, sigue colisionando en `/`, y traslada el problema a US-002/US-004;
  (C) separar en dos apps Next — contradice la decisión del E2E §1.3-6 ("el panel vive dentro del
  mismo app web"), exigiría ADR de reversión + segundo deploy, y **rompería el mecanismo de
  OQ-FE-4 opción C** (la Server Action `revalidateProduct` pasaría a ser un endpoint HTTP
  cross-app con secreto compartido); (D) renombrar el parámetro del panel a `[slug]` — no resuelve
  nada (dos groups siguen sin poder resolver la misma ruta) y mentiría semánticamente (el parámetro
  del panel es un UUID); (E) `basePath` / multi-zone — complejidad de despliegue sin beneficio a
  esta escala.
  **Gobernanza — ¿CR o refactor absorbido?**: se absorbe **como refactor in-scope** de este change,
  con tasks dedicadas (T0.1–T0.4) y no como Change Request, porque: es **behavior-preserving**
  (`refactoring-discipline`: patrón Move, invariante = comportamiento del panel + guard, criterio de
  éxito = suite y smoke verdes antes y después), **ningún AC de US-001 referencia una URL** (se
  verificó), y no hay superficie desplegada que romper. Lo que sí se formaliza es la **convención**,
  porque la heredan US-002/US-004/US-007/US-016 y revertirla después sí costaría 301s → **ADR-0010**
  (T0.1). Si el usuario prefiere tratarlo como CR de US-001, la única diferencia práctica es dónde
  se contabilizan las ~1.25 h de la Fase 0.

- **OQ-FE-2 — Disparador "Agregar al carrito" antes de US-007 (AC-3).**
  `[Resolved: 2026-08-16 — opción A]` Botón `accent` renderizado pero **deshabilitado** con seam
  `onAddToCart`: la ficha queda visualmente completa y US-007 solo inyecta el handler.
  *Precisión de esta regeneración*: el design-system §7.3 dice "sin stock: el botón se **reemplaza**
  por 'Avisame por WhatsApp' (no un botón disabled mudo)" — esa regla aplica al caso **sin stock**,
  que se implementa así (AC-4). El disabled es exclusivamente el caso **con stock** y es un seam
  temporal que US-007 retira. **Descartadas**: (B) botón activo con feedback interino; (C) ocultarlo.

- **OQ-FE-3 — Número de WhatsApp del local (AC-4).**
  `[Deferred: el dato no bloquea el desarrollo — la ficha se cablea contra la env y el número real
  solo hace falta para que el enlace funcione en producción — owner: PO/cliente, revisit: antes del
  primer deploy (US-019)]` Se cablea vía `NEXT_PUBLIC_WHATSAPP_PHONE` (dato público) con placeholder
  en dev; US-018 lo consolidará como canal.

- **OQ-FE-4 — Estrategia de frescura del precio en el SSR (AC-9).**
  `[Resolved: 2026-08-16 — opción C: revalidateTag on-demand]` Fetch con
  `next: { revalidate: 3600, tags: ['product:{slug}'] }` + Server Action `revalidateProduct(slug)`
  (`revalidateTag` + `revalidatePath`) invocada por el flujo de mutación del panel tras cada
  edición/publicación/archivado exitoso. **Descartadas**: (A) ISR `revalidate: 60` (aceptaba ~60–90 s
  de precio viejo); (B) `no-store` (perdía ISR/SEO/carga). **Nota de coordinación** (design.md D2):
  la inmediatez asume que el fetch SSR va directo al origen de la API (sin CDN intermedio que respete
  el `max-age=60` del BE) — cierto en la topología actual; revisar si US-019 interpone un CDN.

- **OQ-FE-5 — Fuente del conteo de vistas de ficha (US §9 → insumo US-016).**
  `[Resolved: 2026-08-16 — opción A]` Evento cliente `pdp_shown` (sin PII) + se mantiene
  `product.viewed` del BE; US-016 decide la fuente autoritativa. **Descartadas**: (B) solo evento BE
  (subcuenta); (C) retirar el evento BE (tocaba un change cerrado).

## References

- User Story: `docs/user-stories/US-003-ficha-producto-pdp.md` (AC-1…AC-9, §8 diseño, §9 NFRs)
- E2E: `docs/product/design-e2e.md` §1.3-6 y §6.2 (el panel vive dentro del mismo app web —
  premisa de OQ-FE-6), §14 (superficie `/admin/*` y "no exponer panel sin auth"), §17 (SEO/LCP <
  2.5 s, p95 lectura < 300 ms), §18 (observabilidad Sentry + Web Vitals)
- Design system (fuente visual, `Approved` — NO se redefine): `docs/product/design-system.md`
  §7.1 (Button accent), §7.3 (Card/ficha: jerarquía + regla de sin stock), §7.4 (PriceTag ARS),
  §7.7 (Badge), §7.14 (TrustSignals / canal humano), §8.1 (imagen 1:1, sizes, priority, fallback,
  OG), §10.1 (patrones loading/empty/error), §10.2 (copy), §11 (a11y WCAG 2.1 AA)
- Contrato consumido (NO se redefine): `apps/api/docs/api/openapi.yaml` (`storefrontGetProduct`) +
  `openspec/changes/US-003-ficha-producto-pdp-backend/contracts/openapi/storefront-get-product.yaml`
- Change de backend hermano: `openspec/changes/US-003-ficha-producto-pdp-backend/` (Fase 10 — `slug`)
- Estado declarado: `openspec/specs/catalogo/` (requirements.md NFR-4 — codegen obligatorio)
- Change FE precedente (sustrato reutilizado y superficie que se mueve):
  `openspec/changes/archive/US-001-admin-catalogo-productos-frontend-web/`
- Plan anterior (respaldo de esta regeneración):
  `openspec/changes/_backups/2026-08-17-1-US-003-ficha-producto-pdp-frontend-web/`
