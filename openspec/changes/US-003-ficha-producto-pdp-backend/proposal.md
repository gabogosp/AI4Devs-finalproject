---
tracker-id: null
tracker-source: null
parent-us: US-003
discipline: backend
variant: null
language: es
---

# US-003 Backend — Endpoint público de ficha de producto (PDP indexable)

## Why

La ficha de producto (PDP) es el punto de conversión del descubrimiento (browse US-002 / búsqueda IA US-004) hacia la compra, y una página clave de **SEO** (objetivo de negocio PRD §1.2). US-003 abre la **superficie de lectura pública del storefront**: hasta ahora la app `apps/api` (entregada por US-001) sólo expone `/v1/admin/*` gateado por RBAC. Esta US añade el primer endpoint **sin autenticación** — la lectura de un producto **publicado** por su identificador, que el storefront SSR (FE-US-003) consume para renderizar la ficha indexable (metadatos + JSON-LD).

El sustrato ya existe y **no se re-arquitectura**: `@dsm/db` tiene la tabla `products` con todas las columnas que la ficha necesita (`name`, `description_raw`, `price_ars_cents`, `stock`, `status`, `image_url`, `category_id`) y `categories` con `slug`. US-001 dejó el borde HTTP endurecido (helmet §7.1, CORS allowlist §7.2, ValidationPipe 422, filtro RFC 7807 `dsm:catalog/*`, throttler `@nestjs/throttler`, `CatalogEventsService`). Este change entrega el **comportamiento** de lectura pública: un repositorio de lectura filtrado por `status='published'`, un mapper de respuesta orientado a la ficha/SEO (sin campos de administración), un controller público con rate-limit por IP (§7.3) y una política de caché acotada que respeta el precio vigente (AC-9).

La superficie pública es **read-only** y **no crea ninguna tabla ni columna** desde la vista del backend. Hay **una** decisión de datos que sí implica esquema — la URL amigable por *slug* de producto (AC-1) — que se **escala como open question** (OQ-BE-1) por ser una columna nueva propiedad de infra/`@dsm/db`, no de este change (ver §Open questions). El endpoint de este change es entregable **hoy** contra el esquema AS-BUILT usando el `sku` (único, estable) como identificador público interino.

## What changes

- **`StorefrontModule`** (nuevo módulo de lectura pública): controller → service → repositorio de lectura, separado del surface admin de US-001. Reutiliza `ProductsRepository` (única capa que toca el ORM de `products`, §5) y el `CatalogEventsService`.
- **Endpoint público `GET /v1/products/{sku}`** (sin `AdminGuard`): devuelve un producto **sólo si `status='published'`**. `draft` / `archived` / inexistente → **404** uniforme (RFC 7807 `dsm:catalog/not-found`), sin filtrar si el producto existe pero está oculto (no enumeration leak — AC-7/AC-8 se ven idénticos para el público).
- **Método de lectura publicado en el repositorio**: `ProductsRepository.findPublishedBySku(sku)` con `include: { category: true }` — filtra `status='published'`, devuelve `null` para cualquier otro caso.
- **`StorefrontProductDto`** (mapper de respuesta orientado a ficha + SEO): `sku`, `name`, `description` (= `description_raw`; el `description_enriched` de US-005 se difiere), `price_ars_cents` + `currency: "ARS"` (IVA incluido, AC-9), `image_url` (nullable → placeholder FE AC-6), `in_stock` (derivado de `stock > 0` — AC-3/AC-4), `category { name, slug }`. Son los **campos SEO-relevantes** que el FE compone en metadatos + JSON-LD `schema.org/Product` (AC-2). Sin campos de administración (no expone `stock` numérico ni `id` interno ni timestamps de gestión).
- **Rate-limit del surface público (§7.3)**: throttler nombrado `storefront` por IP (ventana y límite por env, default propuesto 60/min/IP), 429 con `Retry-After` + cabeceras `RateLimit-*` (api-standards §12). Defensa en profundidad frente al edge Cloudflare (E2E §14 superficie "catálogo público").
- **Caché acotada (AC-9)**: `Cache-Control: public, max-age=60, stale-while-revalidate=30` `[propuesto — confirma Arquitecto]` para `/v1/products/*` — permite CDN (E2E §17) pero **acota la frescura** para que un cambio de precio se propague en ≤60s (nunca sirve un precio desactualizado indefinidamente). Distinto del `no-store` del surface admin.
- **Observabilidad — evento de negocio `product.viewed`** (US §9, E2E §18): cada fetch OK de ficha emite log estructurado pino + contador (`pdp_viewed_total`), insumo del panel de métricas US-016. Sin PII (lectura anónima); `product_id`/`sku` sólo en el log, nunca como dimensión de métrica (cardinalidad — observability §3.3).
- **Contrato OpenAPI** del endpoint (`contracts/openapi/storefront-get-product.yaml`, draft per `api-contract-completeness`) + actualización del spec publicado del servicio (`apps/api/docs/api/openapi.yaml`) y el README.
- **Tests owned-by-dev**: unit (mapper `in_stock`/shape, service 404), integration (Testcontainers — `findPublishedBySku` publicado/draft/archivado/inexistente), e2e-nest (supertest — 200 shape, 404 draft/archivado/inexistente, `in_stock` true/false, imagen null, precio vigente tras update, 429 rate-limit, cabeceras de caché). La batería de aceptación cross-funcional (Playwright + SEO/SSR + a11y) es owned-by-QA (`QA-US-003`), fuera de este change.

## ACs de US-003 cubiertos (capa backend)

| AC | Qué cubre este change | Nota |
|---|---|---|
| **AC-1** (ver ficha de publicado + URL amigable) | `GET /v1/products/{sku}` devuelve nombre, descripción, precio ARS (IVA incl.), imagen, categoría y disponibilidad de un producto **publicado** | **OQ-BE-1 resuelta (2026-08-16)**: se agrega `products.slug` en la **Fase 10** de este change (migración aditiva, espejo de `categories.slug`). La ruta pública pasa a `GET /v1/products/{slug}`. AC-1 queda completo. |
| **AC-2** (indexable / SEO) | La respuesta expone los **campos SEO-relevantes** (name, description, price, currency, image, sku, `in_stock`, category) con los que el FE compone metadatos + JSON-LD `schema.org/Product` | El SSR y el JSON-LD en sí son FE; el BE garantiza los datos |
| **AC-3** (con stock → iniciar compra) | `in_stock: true` cuando `stock > 0` | El disparador de "agregar al carrito" y su lógica son FE/US-007; el BE expone la señal |
| **AC-4** (sin stock → visible, no comprable) | `in_stock: false` cuando `stock = 0`; la ficha se sirve igual (200) | El indicador "Sin stock" y el canal WhatsApp (US-018) son FE |
| **AC-5** (descripción enriquecida si existe) | `description` = `description_raw` (descripción base) | `description_enriched` es columna de **US-005** (no existe aún); el mapper se escribe para preferir `enriched ?? raw` cuando US-005 la agregue — hoy sólo raw |
| **AC-6** (sin imagen) | `image_url: null` passthrough | El placeholder lo pone el FE |
| **AC-7** (borrador/archivado no accesible) | `status ∈ {draft, archived}` → **404**, idéntico a inexistente | Sin filtrar la existencia del producto oculto |
| **AC-8** (inexistente → 404) | `sku` inexistente → **404** RFC 7807 (no 200 vacío) | |
| **AC-9** (precio vigente) | Lectura viva de la DB + `Cache-Control` acotado (max-age 60s) → nunca sirve un precio desactualizado indefinidamente | El precio histórico de ventas es `order_items` (US-007+), fuera de scope |

## Out of scope

- **Columna `products.slug`** y su backfill/derivación — cambio de esquema **infra-owned** (`@dsm/db`), escalado en OQ-BE-1; este change **no** agrega esquema silenciosamente. Interino: `sku` como identificador público.
- **La acción de agregar al carrito y su lógica** → US-007. Este change sólo expone `in_stock`.
- **SSR, metadatos HTML, JSON-LD, sitemap, placeholder de imagen, indicador "Sin stock", enlace WhatsApp** → FE (`FE-US-003`) / US-018.
- **`description_enriched` / enriquecimiento IA / embeddings** → US-005. El mapper usa `description_raw`.
- **Listado / navegación por categoría públicos** (`GET /v1/products`, `GET /v1/categories`) → US-002.
- **Nuevas tablas/columnas de esquema**: ninguna desde la vista del backend (read-only). Ver `design.md` §Persistencia.
- **Suite de aceptación Playwright + SEO/SSR + a11y** → `QA-US-003`.

## Standards consultados

- `backend-node-standards.md` §2 (layering controller→service→repository — el read use-case público en su propio service), §4 (DTO de respuesta + ValidationPipe ya global), §5 (repositorio único punto de ORM; se extiende `ProductsRepository`), §6 (404 vía error de dominio → filtro RFC 7807), §9 (pino + trace id + evento de negocio), §10 (unit/integration/e2e), §11 (anti-patterns).
- `api-standards.md` §2 (URL pública `/v1/products/{sku}` sin `/admin`), §3 (GET idempotente; 404 vs 200 vacío), §5.5/§5.6 (money en centavos; enums lower_snake_case), §8 (envelope RFC 7807 `dsm:catalog/*`), §12 (cabeceras `RateLimit-*`/`Retry-After`).
- `security-standards.md` §7.3 (rate-limit del nuevo surface público), §2 (STRIDE superficie "catálogo público" — E2E §14), §7.1 (headers ya globales de US-001, heredados).
- `backend-standards.md` (layering, manejo de errores, validación en el borde).
- `testing-standards.md` §14 + `qa-backend-standards.md` §2.1 (ownership dev vs QA de suites).
- Skills: `openspec-workflow` (3-file + tasks closure-grade), `api-contract-completeness` (1 yaml por endpoint + RFC 7807), `observability-patterns` (evento de negocio + no-cardinalidad), `threat-modeling-lite` (STRIDE del GET público), `nfr-quantification` (rate-limit y latencia p95 de lectura pública), `data-architecture-patterns` (consultado inline — sin Mode B; ver design.md).
- ADRs heredados (ya `Accepted`): ADR-0007 (monolito modular NestJS), ADR-0002 (pgvector datastore único), ADR-0001 (Railway/Neon/R2/CDN — money en centavos, CDN de catálogo), ADR-0009 (seam admin — no aplica a este surface público pero contextualiza el borde).

## Open questions

- **OQ-BE-1 — URL amigable por `slug` de producto (AC-1) → columna nueva de esquema.** `[Resolved: 2026-08-16 — el PO decide agregar `products.slug` AHORA, antes de construir la PDP. Motivo: el SEO es el objetivo de negocio del PRD y cambiar la URL después de indexar cuesta 301s + re-crawl. Se materializa en la Fase 10 de este change (migración aditiva en @dsm/db espejando el precedente `categories.slug` + lookup por slug + contrato). AC-1 pasa a ser declarable completo.]` AC-1 pide una **URL amigable (slug)** para la ficha. La tabla `products` AS-BUILT **no tiene columna `slug`** (tiene `sku` único e `id` UUID); sólo `categories` tiene `slug`. Un slug de producto (único, estable, reverse-lookupable) es una **columna nueva**, propiedad de **infra/`@dsm/db`** (mirror del precedente `categories.slug`), **NO** de este change de backend — la regla es *no agregar esquema silenciosamente*. **Recomendación**: resolver agregando `products.slug` en una migración de `@dsm/db` (derivado del `name`, único, poblado al crear/publicar), coordinada con FE-US-003 (que necesita la ruta `/producto/{slug}`). **Decisión interina de este change** (para no bloquear US-003 BE): el identificador público del endpoint es `sku` (`GET /v1/products/{sku}`) — único y estable. Cuando OQ-BE-1 se resuelva, el endpoint gana lookup por `slug` (reemplazando o sumando `GET /v1/products/{slug}`) con churn mínimo: sólo cambia el `where` del repositorio y el nombre del path param; el service/controller/mapper no cambian. `data-architect` Mode B **no** se invoca (columna aditiva trivial; ver design.md).
- **OQ-BE-2 — TTL de la caché pública de la ficha.** `[Deferred: se propone max-age=60 stale-while-revalidate=30; owner: Arquitecto, revisit: tras primer despliegue con CDN post-medición]` Se propone `Cache-Control: public, max-age=60, stale-while-revalidate=30` — acota la frescura del precio (AC-9: nunca indefinido) permitiendo CDN (E2E §17). El valor exacto depende de la tolerancia de negocio a un precio hasta 60s viejo vs el ahorro de origen; se confirma post-medición. Alternativa conservadora: `no-cache` (revalida siempre con ETag) si el negocio exige precio al segundo.
- **OQ-BE-3 — ¿Exponer `stock` numérico o sólo `in_stock`?** `[Resolved: sólo `in_stock`]` Se expone únicamente el booleano `in_stock` (derivado) y **no** el nivel de inventario, para no filtrar información comercial (info-disclosure menor) y porque la ficha (AC-3/AC-4) sólo necesita comprable/no-comprable. El límite de cantidad por compra es de US-007 (carrito), que lo resolverá server-side al agregar.

## References

- User Story: `docs/user-stories/US-003-ficha-producto-pdp.md`
- E2E: `docs/product/design-e2e.md` §6.1 (CatalogModule — "listado público"), §6.2 (Storefront SSR), §8 (DER), §14 (STRIDE — catálogo público), §17 (NFRs — p95 lectura < 300ms, SEO/LCP, CDN), §18 (observabilidad — eventos de negocio), §20 (ADRs)
- Esquema (fuente de verdad, NO se redefine): `packages/db/prisma/schema.prisma` (`@dsm/db`)
- Contrato vivo de la capacidad: `openspec/specs/catalogo/contracts/openapi.yaml` (se extiende al archivar)
- Change hermano de US-001 (surface admin + borde HTTP ya entregado): `openspec/changes/archive/US-001-admin-catalogo-productos-backend/`
- Contrato OpenAPI (draft de este change): `./contracts/openapi/storefront-get-product.yaml`
