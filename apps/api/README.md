# @dsm/api — API de administración del catálogo (US-001)

Backend NestJS del panel del dueño: CRUD de categorías y productos, máquina de
estado (borrador → publicado → archivado), validación por campo (RFC 7807) y
guard RBAC admin (seam ADR-0009). Consume el esquema de `@dsm/db` (Prisma).

## Requisitos

- Node 22, pnpm 9.15.9 (ver raíz del monorepo).
- Postgres + pgvector vía `docker-compose` en la raíz (`make up`).
- Variables (validadas al arranque, fail-fast): `DATABASE_URL`, `JWT_SECRET`,
  `PORT` (opc.), `ADMIN_AUTH_ENABLED`, `ADMIN_BOOTSTRAP_TOKEN`.

## Correr

```bash
# desde la raíz del monorepo
make up                              # Postgres + Redis
pnpm --filter @dsm/db migrate        # aplica el esquema del catálogo
pnpm --filter @dsm/api start:dev     # arranca la API en :3000
```

## Testear

```bash
pnpm --filter @dsm/api test          # unit + integration + e2e-nest (serial, DB compartida)
pnpm --filter @dsm/api test -- <patrón>   # un archivo (p.ej. e2e-products-publish)
pnpm --filter @dsm/api lint
pnpm --filter @dsm/api typecheck
```

Los tests de integración/e2e usan el Postgres de `docker-compose` (misma imagen
pgvector) y hacen `TRUNCATE` entre casos; corren en serie (`maxWorkers: 1`).

## Endpoints (todos bajo `AdminGuard`, requieren JWT `role=admin`)

| Método | Ruta | AC |
|---|---|---|
| POST | `/v1/admin/categories` | AC-1 |
| GET | `/v1/admin/categories` | AC-1 |
| PATCH | `/v1/admin/categories/{id}` | AC-1 |
| POST | `/v1/admin/products` | AC-2, AC-5, AC-9 |
| GET | `/v1/admin/products` | listado paginado (NFR) |
| GET | `/v1/admin/products/{id}` | AC-3 |
| PATCH | `/v1/admin/products/{id}` | AC-3, AC-4, AC-6, AC-7 |
| GET | `/health` · `/ready` | liveness / readiness |

### Superficie pública del storefront (US-003 ficha + US-002 navegación)

Las rutas **sin auth** que el storefront SSR consume:

| Método | Ruta | US / AC |
|---|---|---|
| GET | `/v1/products/{slug}` | US-003 AC-1/AC-2 — ficha pública de un producto `published` |
| GET | `/v1/categories` | US-002 AC-1 — árbol de navegación de dos niveles |
| GET | `/v1/categories/{slug}` | US-002 AC-1/AC-2/AC-9 — detalle con `parent` (breadcrumb) y `children` |
| GET | `/v1/categories/{slug}/products` | US-002 AC-3/AC-6/AC-7/AC-8 — listado paginado de publicados |

- **Sin `AdminGuard`.** Sólo se expone lo `published`: draft/archived/inexistente
  → **404** RFC 7807 uniforme (sin enumeration leak). Una categoría inexistente
  también da 404 en su listado, nunca un 200 vacío — una página fantasma sería
  indexable.
- **Identificador público: el `slug`**, tanto de producto como de categoría. Lo
  deriva el servidor del nombre; no se acepta del cliente ni se recalcula al
  renombrar (una URL ya indexada no se rompe), y ante colisión lleva sufijo.
- **Agregación por rubro (decisión D1)**: el listado de un **rubro** incluye los
  productos de sus subrubros directos; el de un **subrubro**, sólo los propios.
  Sin esto, un rubro cuyos productos cuelgan de los hijos se vería vacío.
- **Paginación offset (decisión D3)**: `?limit=&offset=` con envelope
  `{ data, pagination: { limit, offset, total } }`. `limit` default 20, **tope
  100** — el catálogo completo nunca se transfiere de una (AC-7). Fuera de rango
  → **422**. Orden estable `name ASC, id ASC`, así el offset es determinista.
- **Rate-limit por IP** (§7.3): throttler `storefront`
  (`STOREFRONT_RATE_LIMIT_TTL_MS`/`STOREFRONT_RATE_LIMIT_MAX`, default 60/min);
  al excederlo, **429** con `Retry-After` + `RateLimit-*`.
- **Caché por endpoint (decisión D5)**: el árbol de categorías lleva
  `max-age=300, stale-while-revalidate=60` (cambia poco); la ficha, el detalle y
  el listado se quedan en `max-age=60, stale-while-revalidate=30`, que acota la
  frescura del precio (AC-9). El header se estampa **sólo en 2xx**, así un CDN
  compartido nunca cachea un 404/422/429. El surface admin conserva `no-store`.
- **Evento de negocio**: el detalle de categoría emite `category.viewed`
  (decisión D4) — insumo del panel de métricas de US-016. El árbol y el listado
  no emiten: paginar dentro de una categoría no es una vista nueva.

Contrato completo: [`docs/api/openapi.yaml`](./docs/api/openapi.yaml). Errores en
envelope RFC 7807 con `type` `dsm:catalog/*`.

## Auth (seam ADR-0009)

`AdminGuard` valida un JWT `role=admin` firmado con `JWT_SECRET`. La emisión
interina (`AdminAuthService`, detrás de `ADMIN_AUTH_ENABLED` +
`ADMIN_BOOTSTRAP_TOKEN`) es mínima; **US-014** la endurece (login, cookie
httpOnly, refresh rotado, rate-limit, 2FA) preservando el contrato `role=admin`
sin reescribir el guard.
