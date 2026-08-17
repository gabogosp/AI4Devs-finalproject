---
parent-us: US-003
discipline: backend
variant: null
language: es
---

# US-003 Backend — Design

> Diseño de la **superficie de lectura pública** del storefront: el primer endpoint
> **sin autenticación** de `apps/api`. Reutiliza íntegro el borde HTTP endurecido por
> US-001 (filtro RFC 7807 `dsm:catalog/*`, ValidationPipe 422, helmet §7.1, CORS §7.2,
> throttler `@nestjs/throttler`, `CatalogEventsService`). **No re-arquitectura** nada y
> **no migra esquema**.

## Context

US-001 dejó `apps/api` (`@dsm/api`) con la tabla `products` completa en `@dsm/db`
(`name`, `description_raw`, `price_ars_cents`, `stock`, `status`, `image_url`,
`category_id`) y `categories` con `slug`, más el surface admin `/v1/admin/*` gateado por
`AdminGuard` (RBAC, ADR-0009). US-003 abre la **lectura pública** que el storefront SSR
(FE-US-003) consume para renderizar la ficha (PDP) indexable: metadatos + JSON-LD
`schema.org/Product`. El sustrato de datos ya existe; este change entrega **comportamiento**
de lectura, no esquema.

La única decisión que tocaría esquema —una **URL amigable por `slug` de producto** (AC-1)—
se escala como **OQ-BE-1** por ser una columna nueva **infra-owned** (`@dsm/db`), espejo del
precedente `categories.slug`, y **no** se materializa acá (regla: no agregar esquema
silenciosamente). Identificador público interino: `sku` (único, estable).

## Goals

- Endpoint público `GET /v1/products/{sku}` que devuelve un producto **sólo si
  `status='published'`** (AC-1), con los campos SEO-relevantes que el FE compone en
  metadatos + JSON-LD (AC-2).
- `draft` / `archived` / inexistente → **404** RFC 7807 uniforme, sin filtrar la existencia
  del producto oculto (AC-7/AC-8; sin enumeration leak).
- Señal de disponibilidad `in_stock` derivada de `stock > 0` (AC-3/AC-4) sin exponer el nivel
  de inventario (OQ-BE-3).
- `image_url` nullable passthrough (AC-6); `description = description_raw` (AC-5, con
  `description_enriched` de US-005 diferida).
- Precio vigente por lectura viva + caché **acotada** que nunca sirve un precio
  desactualizado indefinidamente (AC-9).
- Rate-limit por IP del surface público (§7.3) y contrato OpenAPI del endpoint.

## Non-goals

- **Columna `products.slug`** y su backfill/derivación → OQ-BE-1, infra-owned. Interino: `sku`.
- **`description_enriched`** → US-005 (el mapper se escribe para preferir `enriched ?? raw`
  cuando exista; hoy sólo `raw`).
- **Listado / navegación por categoría públicos** (`GET /v1/products`, `GET /v1/categories`) → US-002.
- **Carrito / iniciar compra** (el disparador de AC-3) → US-007. **Canal WhatsApp** (AC-4) → US-018.
- **SSR, metadatos y JSON-LD** en sí → FE-US-003 (el BE sólo garantiza los datos).
- Batería de aceptación cross-funcional (Playwright + SEO/SSR + a11y) → `QA-US-003`.

## Approach

### Estructura — nuevo módulo de feature `storefront`

Módulo aislado del admin, cableado en `AppModule`:

```
apps/api/src/storefront/
  storefront.module.ts              # importa ProductsModule (exporta ProductsRepository)
  storefront.controller.ts          # @Controller('v1/products') SIN AdminGuard
  storefront.service.ts             # getPublishedProduct(sku) → 404 de dominio si null
  dto/storefront-product.dto.ts     # StorefrontProductDto.from() — shape público
```

`ProductsRepository` (US-001) se **extiende** con `findPublishedBySku` — sigue siendo el
único punto de acceso al ORM de `products` (`backend-node-standards §5`). El service de
storefront es un use-case de lectura propio (§2 layering), no reusa el admin service.

### API — endpoint público

| Método | Ruta | Auth | 200 | Errores |
|---|---|---|---|---|
| `GET` | `/v1/products/{sku}` | **ninguna** | `StorefrontProductDto` | `404 dsm:catalog/not-found`, `429` |

Contrasta con el admin `GET /v1/admin/products/{id}` (US-001), que sigue gateado por
`AdminGuard` e intacto. El path param es `sku` (interino por OQ-BE-1).

### DTO / mapper orientado a ficha + SEO

`StorefrontProductDto` expone **exactamente**:

```ts
{
  sku: string;
  name: string;
  description: string;        // = description_raw (US-005 antepondrá enriched)
  price_ars_cents: number;    // money en centavos (api-standards §5.5); IVA incl. (AC-9)
  currency: 'ARS';
  image_url: string | null;   // passthrough (AC-6)
  in_stock: boolean;          // stock > 0 (AC-3/AC-4) — NO expone el nivel
  category: { name: string; slug: string };
}
```

`static from(p: Product & { category: Category })`. **No** incluye `id`, `stock` numérico,
`status`, `created_at`, `updated_at` (OQ-BE-3 — no filtrar info comercial ni de gestión).

### Servicio — 404 uniforme (no enumeration leak)

`getPublishedProduct(sku)`: `const p = await repo.findPublishedBySku(sku); if (!p) throw new
NotFoundError(...)`. El repositorio filtra `status='published'`, así que `draft`, `archived`
e inexistente colapsan al **mismo** `null` → **mismo** 404 con **mismo** mensaje genérico. No
hay rama que distinga el motivo: el público no puede inferir si un producto oculto existe
(AC-7 ≡ AC-8 desde afuera). El `NotFoundError` de dominio lo mapea el `HttpProblemFilter`
global a `404 dsm:catalog/not-found` (§6).

### Caché acotada (AC-9)

La ficha pública lleva `Cache-Control: public, max-age=60, stale-while-revalidate=30`
(**OQ-BE-2**, propuesto). Habilita CDN de catálogo (E2E §17) **acotando la frescura**: un
cambio de precio vía `PATCH /v1/admin/products/{id}` se propaga en ≤60s — nunca un precio
viejo indefinido.

Se aplica vía `StorefrontCacheInterceptor` **sólo en respuestas 2xx del controller** — NO en
el middleware de borde. (Hallazgo **M1** del audit: el borde corre antes del routing y no ve el
status, así que estampaba el header también en 404/429, permitiendo a un CDN compartido cachear
un error y volver la mitigación de DoS un vector. El interceptor no corre ante excepción, así
que 404/429 viajan sin header cacheable.) El `no-store` de `/v1/admin` sí queda en el borde.

### Rate-limit del surface público (§7.3)

Segundo throttler nombrado `storefront` en el array de `ThrottlerModule` (hoy sólo `auth`):
`{ name: 'storefront', ttl: STOREFRONT_RATE_LIMIT_TTL_MS, limit: STOREFRONT_RATE_LIMIT_MAX }`,
defaults `60000` / `60` (60 req/min/IP), validados por Zod en `env.validation.ts` al arranque.
Un guard espejo de `AuthThrottlerGuard` emite `RateLimit-*` + `Retry-After` (api-standards §12);
el `429` sale en envelope RFC 7807 vía el filtro global. El throttler `auth` de US-001 no cambia.

### Persistencia

Consulta de lectura única: `findFirst({ where: { slug, status: 'published' },
include: { category: true } })`. `slug` es único → a lo sumo una fila. El join de categoría es
1:1 por `category_id` (no-nullable en el esquema AS-BUILT). Sin transacción (lectura simple).

**Migración (Fase 10, OQ-BE-1 resuelta 2026-08-16)** — actualiza la afirmación original de este
change ("sin migración"), que valía mientras el identificador público era el `sku`:

- `products.slug TEXT NOT NULL UNIQUE`, espejo del precedente `categories.slug`.
- Aditiva en tres pasos porque la tabla ya tiene filas: `ADD COLUMN` nullable → backfill
  derivado del `name` → `SET NOT NULL` + índice único. Migración
  `20260816120000_add_product_slug`.
- Backfill determinista: normaliza el `name` con el mismo criterio que `slugify()` de la app
  (sin acentos vía `translate`, minúsculas, no-alfanumérico → `-`), desambigua la colisión con
  sufijo ordinal por orden estable `(created_at, id)` y cae al `sku` si el nombre no tiene
  ningún carácter alfanumérico. Sin extensiones nuevas (no depende de `unaccent`).
- Sin índices adicionales: el único de `slug` es el que sirve al lookup público, y el
  `(category_id, status)` existente sigue cubriendo el listado de US-002.
- El `slug` **nunca** se acepta del cliente (se deriva en el service) ni se recalcula al editar
  el `name` — regenerarlo rompería una URL ya indexada.

### Observabilidad — evento `product.viewed`

Se agrega `'product.viewed'` a `CatalogEventName`; se emite `events.emit('product.viewed',
product.id)` tras un fetch OK (un `404` **no** emite). Log pino estructurado con `entity_id` +
`trace_id`, **sin PII** (lectura anónima). Contador `pdp_viewed_total` **sin** `product_id`/`sku`
como dimensión (cardinalidad — observability-patterns §3.3). Insumo del panel US-016.

## Seguridad — threat model lite (STRIDE del GET público)

Es el **primer endpoint sin auth**; el análisis se centra en el surface anónimo:

- **Information disclosure** — el mayor riesgo. Mitigado en dos capas: (a) el mapper expone
  sólo campos de ficha (no `id`/`stock`/`status`/timestamps, OQ-BE-3); (b) el 404 uniforme no
  revela la existencia de productos ocultos (AC-7≡AC-8). Un scraper que enumere `sku` sólo ve
  productos ya publicados (información pública por diseño).
- **Denial of service** — lectura anónima sin costo de auth. Mitigado con el throttler
  `storefront` por IP (§7.3) + caché CDN (absorbe picos de lectura del mismo `sku`).
- **Tampering / Spoofing / Elevation** — N/A: método `GET` idempotente, sin estado, sin
  credenciales; no hay superficie de escritura ni de escalado. `AdminGuard` sigue protegiendo
  todo `/v1/admin/*` (sin cambios).
- **Repudiation** — lectura anónima; el evento `product.viewed` se registra sin PII (no aplica
  no-repudio de usuario).

## Resiliencia y observabilidad

- Reusa el `HttpProblemFilter` global → todo error sale como `application/problem+json`.
- Sin dependencias externas nuevas: sólo Postgres (ya con pool de US-001). Si la DB no responde,
  el error se propaga como 5xx del filtro (sin fallback que sirva datos falsos).
- Métrica `pdp_viewed_total` + logs correlacionados por `trace_id` (traceparent del cliente).

## Testing (owned-by-dev; qa-backend-standards §2.1)

- **Unit**: mapper (`in_stock` true/false, `image_url:null` passthrough, ausencia de claves
  admin); service (repo→`null` lanza `NotFoundError`, mensaje idéntico en los 3 casos ocultos).
- **Integration (Testcontainers, Postgres real con esquema `@dsm/db`)**: `findPublishedBySku`
  para producto publicado/draft/archivado/inexistente.
- **e2e-nest (supertest)**: 200 shape + `category.slug`; 404 draft/archivado/inexistente; sin
  header Authorization; 429 al superar el límite (body `problem+json`); `Cache-Control`
  acotado presente y sin `no-store`; `in_stock` true/false; `image_url:null`; precio vigente
  tras `PATCH` admin; evento emitido en 200 y **no** en 404.
- La batería de aceptación cross-funcional (Playwright + SEO/SSR + a11y) es **owned-by-QA**
  (`QA-US-003`), fuera de este change.

## Trade-offs

- **`sku` como identificador público interino vs esperar `slug`.** Elegido `sku` para no
  bloquear US-003 BE en una decisión de esquema infra-owned. Costo: cuando OQ-BE-1 resuelva,
  el endpoint gana lookup por `slug` con **churn mínimo** — sólo cambia el `where` del
  repositorio y el nombre del path param; service/controller/mapper no cambian.
- **Caché `max-age=60` vs `no-cache`+ETag.** Elegido `max-age` acotado por el ahorro de origen
  con frescura suficiente (precio ≤60s viejo, aceptable para catálogo). Alternativa
  conservadora documentada en OQ-BE-2 si el negocio exige precio al segundo.
- **`in_stock` booleano vs `stock` numérico.** Booleano: la ficha sólo necesita
  comprable/no-comprable (AC-3/AC-4) y no se filtra inventario. El límite de cantidad por
  compra lo resuelve US-007 server-side.

## Deployment considerations

- **Requiere migración** (Fase 10, ver §Persistencia) — actualiza la afirmación original de
  "cambio aditivo sin migración", que valía antes de resolverse OQ-BE-1. El orden es
  `prisma migrate deploy` **antes** de que arranque la versión nueva del API: el código nuevo
  lee `products.slug` y fallaría contra un esquema sin la columna. La migración en sí es
  segura hacia atrás (la versión vieja ignora una columna que no conoce), así que un rolling
  deploy sirve igual.
- **Aviso de despliegue (levantado por la sesión de US-019, 2026-08-17)**: `prisma migrate
  deploy` aplica **todas** las migraciones pendientes de `packages/db` de una vez, no las de
  una US. El primer deploy a un entorno nuevo materializa el esquema completo (12 columnas en
  `products`), no un subconjunto por US. Cualquier plan que asuma deferral de columnas
  por-US a nivel de migración está equivocado en este stack.
- **Cambio incompatible en la ruta pública**: `GET /v1/products/{sku}` deja de existir en favor
  de `{slug}`. No hay consumidores externos (pre-lanzamiento) y el único cliente es
  `FE-US-003`, que ya migró; por eso no se dejó ruta de compatibilidad. Si el endpoint llegara
  a estar publicado antes del cutover, haría falta servir ambas y deprecar la vieja.
- Dos env nuevas con default seguro (`STOREFRONT_RATE_LIMIT_TTL_MS=60000`,
  `STOREFRONT_RATE_LIMIT_MAX=60`); si faltan, el default aplica (validado por Zod al arranque,
  no rompe boot).
- La política de `Cache-Control` asume un CDN/reverse-proxy que respete `stale-while-revalidate`
  (E2E §17); sin CDN el header es inocuo (el browser lo respeta igual).
- Coordinación con FE-US-003: además del contrato (path + shape), el cutover de identificador
  debe ir junto — API y FE en el mismo release.

## ADR triggers heredados del E2E

- Ninguno nuevo. El seam de RBAC admin (ADR-0009, US-001) no se toca. La columna
  `products.slug` (OQ-BE-1, materializada en la Fase 10) es una migración aditiva trivial que
  **no** requiere ADR (mirror de `categories.slug`); `data-architect` Mode B **no** se invocó.

## Open questions

- **OQ-BE-1 — URL amigable por `slug` de producto (AC-1) → columna nueva de esquema.** `[Deferred: columna nueva infra-owned de @dsm/db; este change usa sku interino y no migra esquema; owner: Arquitecto/infra, revisit: al planear US-002 o FE-US-003]` `products` AS-BUILT no tiene `slug` (sí `sku` único e `id`). Un slug de producto es columna nueva **infra-owned** (`@dsm/db`), no de este change. Recomendación: migración de `@dsm/db` (`products.slug` derivado del `name`, único, poblado al crear/publicar), coordinada con FE-US-003. **Decisión interina**: identificador público = `sku`.
- **OQ-BE-2 — TTL de la caché pública de la ficha.** `[Deferred: se propone max-age=60 stale-while-revalidate=30; owner: Arquitecto, revisit: tras primer despliegue con CDN post-medición]` Acota AC-9 permitiendo CDN. Alternativa conservadora `no-cache`+ETag si el negocio exige precio al segundo.
- **OQ-BE-3 — ¿exponer `stock` numérico o sólo `in_stock`?** `[Resolved: sólo `in_stock`]` El
  booleano derivado basta para AC-3/AC-4 y no filtra inventario; el límite de cantidad es US-007.

## References

- US: `docs/user-stories/US-003-ficha-producto-pdp.md` (AC-1…AC-9).
- Standards: `backend-node-standards §2/§4/§5/§6/§9/§10/§11`, `api-standards §2/§3/§5.5/§8/§12`,
  `security-standards §7.3`, `observability-patterns §3.3`.
- Skills: `openspec-workflow`, `api-contract-completeness`, `threat-modeling-lite`,
  `nfr-quantification`, `data-architecture-patterns`.
- ADR: `docs/architecture/decisions/ADR-0009-*` (seam RBAC admin, US-001 — no se modifica).
- Contrato (draft de este change): `./contracts/openapi/storefront-get-product.yaml`.
- Precedente de borde/errores/throttler: change archivado `US-001-admin-catalogo-productos-backend`.
