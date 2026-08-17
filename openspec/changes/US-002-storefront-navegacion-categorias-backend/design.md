---
parent-us: US-002
discipline: backend
variant: null
language: es
---

# US-002 Backend — Design

> Diseño de la **navegación pública por categorías** del storefront: tres endpoints
> read-only sobre el `StorefrontModule` que dejó US-003. Reutiliza íntegro el borde
> HTTP endurecido (filtro RFC 7807 `dsm:catalog/*`, ValidationPipe 422, helmet §7.1,
> CORS §7.2, throttler `storefront` §7.3) y **no migra esquema**. Decisiones D1–D5
> ratificadas por el usuario el 2026-08-16 (ver proposal.md §Decisiones ratificadas).

## Context

US-001 dejó el catálogo administrable (`categories` con `slug` UK y `parent_id`
auto-referente de dos niveles — E2E §8; `products` con `@@index([category_id, status])`)
y el borde HTTP común. US-003 abrió la superficie pública (`StorefrontModule`,
`StorefrontThrottlerGuard`, `StorefrontCacheInterceptor` sólo-2xx, evento
`product.viewed` vía `CatalogEventsService`). US-002 completa el **descubrimiento por
browse** (E2E §6.1 — `Rel(web, catalog, "GET /products, /categories")`; §6.2 —
Storefront SSR "Home, categoría, ficha"): el FE SSR renderiza páginas de categoría
indexables (AC-4/AC-10, FE-owned) consumiendo estos endpoints de datos.

Este change entrega **comportamiento de lectura**, no esquema: el DER AS-BUILT cubre
el patrón de acceso al volumen declarado (≥5.000 SKUs, ~50 concurrentes — E2E §17).

## Goals

- Árbol de categorías de dos niveles (rubros + subrubros) consumible por `CategoryNav`
  y sitemap (AC-1).
- Detalle de categoría con `parent` (breadcrumb AC-2) y `children` (AC-1); 404 RFC 7807
  para slug inexistente (AC-9).
- Listado paginado offset de productos **publicados** por categoría (AC-3/AC-7/AC-8),
  con agregación de subrubros para rubros (D1) y envelope del contrato vivo (D3).
- `in_stock` derivado sin exponer inventario (AC-5); `data: []` + `total: 0` para
  categoría vacía (AC-6).
- Caché por endpoint (D5): árbol 300s, detalle/listado 60s; sólo en 2xx.
- Evento de negocio `category.viewed` (D4) para el panel US-016.

## Non-goals

- **SSR/metadatos/sitemap/JSON-LD/estados visuales** → FE-US-002 (AC-4/AC-10 son FE;
  el BE habilita los datos). `Deferred: FE-US-002 — split declarado en proposal §ACs`.
- **Filtros/ordenamientos alternativos** → PRD §2.2 roadmap. Un solo orden estable.
- **Columna `products.slug`** → OQ-BE-1 (US-003), infra-owned; el enlace usa `sku`.
- **Caché Redis de listados** (mencionada como opción en E2E §17) → rechazada por ahora
  (ver Trade-offs). **Admin de categorías** → US-001, intacto. **Carrito** → US-007.
- Batería de aceptación Playwright + SEO/SSR + a11y → `QA-US-002`.

## Approach

### Estructura — se extiende el módulo `storefront` (sin módulo nuevo)

```
apps/api/src/storefront/
  storefront.module.ts                    # + StorefrontCategoriesController (importa CategoriesModule)
  storefront-categories.controller.ts     # NUEVO — @Controller('v1/categories') SIN AdminGuard
  storefront.service.ts                   # + getCategoryTree / getCategoryBySlug / listPublishedProducts
  storefront-cache.interceptor.ts         # EXTENDIDO — TTL por endpoint vía decorador (D5)
  dto/storefront-category.dto.ts          # NUEVO — nodo de árbol + detalle (parent/children)
  dto/storefront-product-list.dto.ts      # NUEVO — item de grilla + query DTO de paginación
```

Los repositorios se extienden en su módulo de origen (`backend-node-standards.md` §5 —
único punto de ORM): `CategoriesRepository` (+2 métodos de lectura) y
`ProductsRepository` (+1). `CategoriesModule` y `ProductsModule` ya exportan sus
repositorios (precedente US-003).

### API — tres endpoints públicos (D2)

| Método | Ruta | Auth | 200 | Errores | Caché (D5) |
|---|---|---|---|---|---|
| `GET` | `/v1/categories` | ninguna | `StorefrontCategoryDto[]` (rubros con `children`) | `429` | `max-age=300, swr=60` |
| `GET` | `/v1/categories/{slug}` | ninguna | `StorefrontCategoryDto` con `parent` + `children` | `404`, `429` | `max-age=60, swr=30` |
| `GET` | `/v1/categories/{slug}/products` | ninguna | `{ data: StorefrontProductListItemDto[], pagination }` | `404`, `422`, `429` | `max-age=60, swr=30` |

Rate-limit heredado: throttler `storefront` 60/min/IP (`security-standards.md` §7.3) con
`RateLimit-*`/`Retry-After` en 429 (`api-standards.md` §12). El surface admin no cambia.

### DTOs (shapes exactos)

```ts
// dto/storefront-category.dto.ts
{
  slug: string;
  name: string;
  parent: { slug: string; name: string } | null;   // sólo en detalle; null para rubros
  children: { slug: string; name: string }[];       // subrubros ordenados por name
}

// dto/storefront-product-list.dto.ts — item de grilla (ProductCard)
{
  sku: string;                 // enlace a la ficha US-003 (interino OQ-BE-1)
  name: string;
  price_ars_cents: number;     // money en centavos (api-standards §5.5); IVA incl.
  currency: 'ARS';
  image_url: string | null;    // placeholder lo pone el FE
  in_stock: boolean;           // stock > 0 (AC-5) — NO expone nivel (OQ-BE-3 US-003)
}

// Query DTO (ValidationPipe global 422, whitelist — backend-node-standards §4)
{ limit?: number = 20 (1..100); offset?: number = 0 (>= 0) }
```

El item de grilla **no** incluye `id`, `stock` numérico, `status`, `description` ni
timestamps: la grilla no los necesita y no se filtra información de gestión.
Envelope de la colección (D3, per `api-standards.md` §6.1 + precedente vivo US-001):
`{ data, pagination: { limit, offset, total } }` — `total` cuenta **sólo publicados**.

### Servicio — semántica de lectura

- `getCategoryTree()`: rubros (`parent_id = null`) con `children`, ambos `name ASC`.
- `getCategoryBySlug(slug)`: categoría + `parent` + `children`; `null` → `NotFoundError`
  (→ 404 `dsm:catalog/not-found` vía `HttpProblemFilter` global, §6). Mensaje genérico.
- `listPublishedProducts(slug, { limit, offset })`: resuelve la categoría (404 si no
  existe — **antes** de tocar productos, AC-9); arma `ids = [cat.id, ...children.map(c => c.id)]`
  cuando `parent_id = null` (rubro, D1) o `ids = [cat.id]` (subrubro); delega en
  `ProductsRepository.findPublishedByCategoryIds(ids, { limit, offset })`.

### Persistencia (trivial — sin Mode B)

Workload per `data-architecture-patterns` §3: relacional / lookup-por-slug +
listado-filtrado-paginado / small (≤ ~5.000 filas de productos, decenas de categorías,
< 50 rps) / lectura consistente simple → **Postgres (Neon), motor ya vigente y
workload-ideal** (baseline `railway-baseline` per ADR-0001/ADR-0002). Sin mismatch, sin
tabla/columna/índice nuevos, sin migración:

- Árbol: `category.findMany({ where: { parent_id: null }, include: { children: ... }, orderBy: { name: 'asc' } })`
  — dos niveles fijos, sin CTE recursiva.
- Detalle: `category.findUnique({ where: { slug }, include: { parent: true, children: ... } })` — `slug` es UK.
- Listado: `$transaction([findMany({ where: { category_id: { in: ids }, status: 'published' }, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip, take }), count({ where: ... })])`
  — snapshot consistente de página + `total`. El índice **existente** `products(category_id, status)`
  (E2E §8 "Índices") resuelve el `where`; el sort sobre el subconjunto filtrado
  (cientos de filas por categoría a 5.000 SKUs totales) es trivial para el planner.
  El tie-break `id ASC` hace el orden **total y estable** (offset determinista, §6.2/§6.3).
- NFR (per `nfr-quantification`): p95 < 300ms / p99 < 800ms para los tres endpoints
  `[heredado de NFR-1 de la capacidad — re-medición prod-shaped gated en US-019]`;
  sin índice adicional salvo que la medición lo contradiga (disparador documentado).

### Caché por endpoint (D5 — ratificada opción b)

El `StorefrontCacheInterceptor` (US-003) se extiende con un decorador de metadata leído
vía `Reflector`:

```ts
@StorefrontCache({ maxAge: 300, swr: 60 })   // árbol
// sin decorador → default actual: { maxAge: 60, swr: 30 }
```

Interpretación de D5: el **árbol** lleva 300s (estructura estable); **detalle** y
**listado** llevan 60s — el detalle alimenta la misma página que el listado y comparte
su presupuesto de frescura. Invariantes que NO cambian: header sólo en 2xx (hallazgo M1
de US-003 — un 404/429 cacheado en CDN compartido sería un vector), `no-store` del
surface admin intacto, sin env nuevas (constantes + decorador).

### Observabilidad — evento `category.viewed` (D4)

`'category.viewed'` se suma a `CatalogEventName`; `GET /v1/categories/{slug}` con 200
emite `events.emit('category.viewed', category.id, null, traceparent)` (espejo de
`product.viewed`). Log pino estructurado con `entity_id` + `trace_id`, **sin PII**
(lectura anónima). Contador `category_viewed_total` **sin** `slug`/`id` como dimensión
(cardinalidad — observability-patterns §3.3; la agregación por categoría del panel
US-016 sale de los logs/eventos, no de dimensiones de métrica). 404 no emite; el árbol
y el listado **no** emiten (D4 — un evento por vista de página).

## Seguridad — threat model lite (STRIDE, superficie 5 — GET cacheable público)

- **Information disclosure**: catálogo público **por diseño** (decisión de producto:
  SEO exige acceso sin auth). Mitigación en capas: (a) el `where status='published'`
  vive en el repositorio — `draft`/`archived` no aparecen ni en `data` ni en `total`
  (AC-8); (b) 404 uniforme para slug inexistente sin filtrar nada más; (c) los DTOs no
  exponen ids internos de producto, inventario ni timestamps.
- **DoS**: paginación obligatoria con `limit` max 100 (nunca el catálogo completo,
  AC-7) + query DTO validado (422 para `limit=9999` o `offset=-1`) + throttler
  `storefront` 60/min/IP + caché CDN (absorbe scraping y thundering herd; `swr`
  amortigua la expiración). Consulta acotada por índice — no hay query "cara" invocable.
- **Tampering / Spoofing / Elevation / Repudiation**: N/A — `GET` idempotente, sin
  estado ni credenciales; `AdminGuard` sigue protegiendo todo `/v1/admin/*`. Registrado
  explícitamente (no es una tabla vacía por omisión: el walkthrough se aplicó).

## Resiliencia

- Única dependencia: Postgres (pool ya configurado por US-001). Sin llamadas salientes
  nuevas → sin timeouts/retries/circuit-breaker adicionales que declarar; un fallo de DB
  se propaga como 5xx RFC 7807 vía el filtro global (sin fallback que sirva datos falsos).
- Las tres lecturas son independientes: la caída de una no afecta a las otras; el FE SSR
  decide su degradación (FE-owned).

## Testing (owned-by-dev; qa-backend-standards §2.1)

- **Unit**: DTOs (shape del nodo/detalle; `in_stock` true/false; ausencia de claves de
  gestión); service (404 en slug inexistente para detalle y listado; `ids` agregados
  para rubro vs subrubro con repos mockeados).
- **Integration (Postgres real, esquema `@dsm/db`)**: repositorios — árbol ordenado;
  detalle con parent/children; listado que excluye `draft`/`archived` de `data` y
  `total`; paginación estable con tie-break.
- **e2e-nest (supertest)**: árbol 200 con `Cache-Control` de 300s; breadcrumb del
  subrubro; listado paginado (`total`, páginas disjuntas, `limit` max, 422 de query
  inválido); rubro agrega subrubros; vacío 200 `data: []`; 404 RFC 7807 en ambos
  endpoints con slug inexistente y sin header cacheable; 429 heredado; evento emitido
  en detalle 200 y no en 404/árbol.
- Aceptación cross-funcional (Playwright + SSR/SEO + a11y) → `QA-US-002`, fuera de acá.

## Trade-offs

- **D1 (agregación) vs sólo-directos vs navegación pura**: elegida la agregación —
  evita rubros vacíos y refleja la expectativa del comprador; costo: un `IN` con ≤
  (1 + #hijos) ids, trivial a dos niveles. Cambiarla es un `where`.
- **D2 (tres endpoints) vs detalle con página embebida**: separación — el 404 de AC-9
  queda natural, la caché se puede ramificar (D5) y el árbol se comparte entre páginas.
  Costo: el SSR de la página de categoría hace 2 fetches (detalle + página 1), ambos
  cacheables.
- **D3 (offset) vs cursor**: offset per §6.3 (dataset < 100k, navegación por página,
  `total` barato para la UI de paginado SEO, orden estable) + simetría con el envelope
  vivo. Cursor queda documentado como evolución si el catálogo creciera 20×.
- **D5 (TTL por endpoint, ratificada) vs política uniforme (recomendación original)**:
  el usuario priorizó frescura correcta por tipo de recurso desde ya; costo: el
  interceptor gana un decorador + Reflector (complejidad acotada y testeada).
- **Caché Redis de listados (E2E §17) — rechazada por ahora**: a 5.000 SKUs y ~50
  concurrentes, el índice + caché HTTP/CDN cumplen el p95 sin operar una capa más de
  invalidación. Se re-evalúa con medición real (disparador: p95 > 300ms sostenido en
  prod-shaped tras US-019). Sin deuda: el motor actual es el workload-ideal.
- **Envelope sin `success` ni links `next`/`prev`** (§6.1 los sugiere): se mantiene el
  shape vivo del contrato (US-001) — coherencia del contrato gana sobre literalidad del
  standard; el FE deriva `next` de `limit/offset/total`. Desviación ya declarada en el
  contrato de la capacidad.

## Spec delta (aplicado por `/archive-change` al contrato vivo)

- **Nuevos endpoints** en `openspec/specs/catalogo/contracts/openapi.yaml`:
  `GET /v1/categories`, `GET /v1/categories/{slug}`, `GET /v1/categories/{slug}/products`
  (drafts en `./contracts/openapi/` de este change → archivos path `$ref`'d al archivar).
- **Nuevos schemas compartidos**: `StorefrontCategory`, `StorefrontCategoryDetail`,
  `StorefrontProductListItem`, `StorefrontProductListPage` (reusa `Problem` existente).
- **Nuevo evento de negocio** declarado: `category.viewed` (log/contador interno; sin
  esquema async externo — no hay broker de eventos de dominio en la baseline).

## Deployment considerations

- Cambio **aditivo sin migración ni env nuevas** → rolling deploy trivial en Railway;
  sin coordinación con FE más allá del contrato (path + shapes). Rollback = redeploy
  de la imagen anterior; sin ventana de pérdida de datos (read-only).
- El TTL de 300s del árbol implica que una categoría nueva/renombrada tarda ≤5min en
  reflejarse en el nav del storefront — aceptado en D5 (el admin ve su cambio al
  instante en `/v1/admin/*`, que es `no-store`).
- No se invoca `deployment-planner`: la superficie pública ya existía (US-003); esto
  añade endpoints read-only sobre la misma infraestructura, sin dependencia, secreto,
  flag ni hot-path nuevos.

## Open questions

- **OQ-BE-1 (heredada de US-003)** `[Deferred — owner: Arquitecto/infra]`: URL de ficha
  por `slug` de producto; el enlace del listado usa `sku` interino. Sin impacto nuevo.

## References

- US: `docs/user-stories/US-002-storefront-navegacion-categorias.md` (AC-1…AC-10, §9 NFRs).
- E2E: `design-e2e.md` §6.1/§6.2 (componentes), §8 (DER + índices), §14 (STRIDE catálogo
  público), §17 (NFRs), §18 (observabilidad).
- Standards: `backend-node-standards.md` §2/§4/§5/§6/§9/§10/§11; `api-standards.md`
  §2/§3/§5.5/§6.1/§6.3/§8/§12/§13; `security-standards.md` §7.3; observability-patterns §3.3.
- Skills: `openspec-workflow`, `api-contract-completeness`, `threat-modeling-lite`,
  `nfr-quantification`, `data-architecture-patterns`, `observability-patterns`.
- ADRs: ADR-0001 (Railway/Neon/CDN, money en centavos), ADR-0002 (Postgres+pgvector
  único), ADR-0007 (monolito modular NestJS). Ninguno nuevo se dispara.
- Precedentes: `openspec/changes/US-003-ficha-producto-pdp-backend/` (surface público),
  `openspec/changes/archive/US-001-admin-catalogo-productos-backend/` (envelope, borde).
- Contratos (drafts): `./contracts/openapi/storefront-list-categories.yaml`,
  `./contracts/openapi/storefront-get-category.yaml`,
  `./contracts/openapi/storefront-list-category-products.yaml`.
