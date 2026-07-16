---
tracker-id: null
tracker-source: null
parent-us: US-001
discipline: infrastructure
variant: bootstrap-local
language: es
---

# US-001 Bootstrap local — esqueleto del monorepo, dependencias locales y esquema del catálogo

## Why

DSM Refrigeración y Ferretería arranca sin presencia digital: el repositorio es **greenfield** (no había `package.json`, `docker-compose.yml`, `.env.example` ni esqueleto de app fuera del framework montado en `spekode/`). US-001 es la primera US del ciclo 1 y bloquea a US-002, US-003, US-005 y US-006 (todo el catálogo se apoya en el modelo de datos de productos/categorías).

Antes de tocar la nube hay que entregar el **desbloqueador**: la estructura del monorepo donde backend (NestJS) y web (Next.js) van a scaffoldear sus apps, las dependencias locales (PostgreSQL con `pgvector`, Redis) corriendo en `docker-compose`, el esquema del catálogo autorizado y validado **localmente**, y la puerta de CI-de-PR que valida cada commit. Todo esto sin una sola credencial de nube: un dev que quiere correr la app no debe esperar a un plan de base de datos ni a una decisión de residencia de datos (E2E §23 Q-3).

Este change es el **primer entregable, día 1, camino crítico**. Su gemelo `platform-cloud` (provisioning de Railway/Neon/R2) corre en paralelo, gated en cuentas/billing/legal, y **no** bloquea a este. Se entregan como **dos changes separados** por mandato del baseline Railway §0 (nunca acoplar local + nube en un mismo change).

## What changes

- **Esqueleto del monorepo Node/TS**: layout `apps/` (`apps/web`, `apps/api`, `apps/worker` como placeholders) + `packages/` (`packages/db`) con placeholders (`README.md`/`.gitkeep`). NO se scaffoldea la app: cada disciplina corre su `nest new` / `create-next-app` dentro de esta estructura en su primer ticket (tarea cross-reference para BE/FE, no de INFRA).
- **Toolchain del workspace** (glue que hace del esqueleto un monorepo funcional, no solo carpetas): gestor **pnpm** pinneado (`packageManager: pnpm@9.15.9`), `package.json` raíz con `workspaces` + `pnpm-workspace.yaml`, Node pinneado (`.nvmrc: 22` + `engines: >=22 <23`), **Prisma 5.22** pinneado como ORM, `packages/db/package.json` (`@dsm/db`) con scripts `migrate` / `migrate:deploy` / `seed` / `generate` / `lint` / `typecheck` + decisión explícita del mecanismo de seed (`tsx prisma/seed.ts`).
- **`docker-compose.yml`** con las dependencias locales que espejan los plugins de Railway: PostgreSQL 16 con `pgvector` (imagen `pgvector/pgvector:pg16`), Redis 7 (`redis:7-alpine`). Imágenes pinneadas, healthchecks (`pg_isready`, `redis-cli ping`), volúmenes nombrados (`pgdata`, `redisdata`), puertos de host parametrizables (`${POSTGRES_PORT:-5432}`, `${REDIS_PORT:-6379}`).
- **`.env.example`** con toda variable que la app + compose necesitan (placeholders, sin secretos). `.env.local` gitignored, copiado de él.
- **Targets locales** (`Makefile`): `up`, `migrate-local`, `seed-local`, `run-local`, `down`.
- **Esquema del catálogo** (`categories`, `products`) autorizado y validado contra el PostgreSQL de `docker-compose`: migraciones Prisma, extensión `pgvector` habilitada localmente, constraints (SKU único, `stock >= 0`, `price_ars_cents > 0`, estado válido), índice `products(category_id, status)`. Esto es la **única fuente de verdad** del esquema; `platform-cloud` lo *aplica* a la nube después.
- **Puerta CI-de-PR** (GitHub Actions `ci.yml`): workflow que corre lint + typecheck + `prisma generate` + `prisma migrate deploy` + test contra un Postgres de servicio (`pgvector/pgvector:pg16`) en cada PR y push a `main` — valida cada commit **antes de que exista cualquier target de deploy**. Sin secretos de nube.

## Alcance del esquema (subconjunto de US-001)

> El E2E §8 declara el DER **completo** de `products` (13 columnas). Este change materializa **11** — las columnas que las ACs de US-001 ejercitan (incluidas `description_raw` e `image_url`, editables en **AC-3**) más `updated_at` como auditoría estándar. Difiere solo `description_enriched` y `enrichment_done`, del pipeline de IA de **US-005** (ninguna lógica de US-001 las toca), que esa US agrega por migración. El esquema se **autora por necesidad real**, sin cargar columnas muertas.

`categories` (5 columnas): `id` (uuid PK), `slug` (unique), `name`, `parent_id` (self-FK nullable), `created_at`.
`products` (11 columnas): `id` (uuid PK), `sku` (unique), `name`, `description_raw` (nullable), `price_ars_cents` (int, CHECK > 0), `stock` (int, default 0, CHECK >= 0), `status` (default `draft`, CHECK IN draft/published/archived), `category_id` (FK), `image_url` (nullable), `created_at`, `updated_at`.

## ACs de US-001 cubiertos (parcialmente — capa de datos)

Este change entrega el **sustrato de persistencia** sobre el que BE/FE implementan la lógica. Cubre a nivel esquema/constraint (no a nivel endpoint/UI — eso es BE/FE):

- **AC-1** (categoría con slug único) → constraint `categories_slug_key` (`slug UNIQUE`).
- **AC-2** (alta en borrador) → columna `products.status` default `draft`.
- **AC-5** (validación precio/stock) → constraints `products_price_check` (`price_ars_cents > 0`), `products_stock_check` (`stock >= 0`) (el mensaje por campo es de BE).
- **AC-7** (archivar, no borrar) → estado `archived` en `products_status_check`, sin delete físico de productos.
- **AC-9** (SKU único) → constraint `products_sku_key` (`sku UNIQUE`).
- **AC-10** (precio histórico no cambia) → habilitado por la separación `products.price_ars_cents` vs `order_items.unit_price_ars_cents` (order_items lo crea la US de checkout; acá solo se garantiza que `products` no es la fuente del precio histórico).

Los AC de comportamiento (AC-3, AC-4, AC-6, AC-8 — RBAC admin) son de BE/FE y no se cierran en este change.

## Out of scope

- **Provisioning de nube** (Railway, Neon, R2, Redis gestionado, secretos, DNS/TLS, autodeploy, runbook) → change `US-001-admin-catalogo-productos-platform-cloud-infrastructure`.
- **Scaffolding de las apps** (`nest new`, `create-next-app`) → primer ticket de BE (`BE-US-001`) y FE (`FE-US-001`); acá solo se entrega la estructura de carpetas + el glue del workspace.
- **Endpoints CRUD, transiciones de estado, RBAC admin** → BE (`BE-US-001`).
- **Panel del dueño (listado, formularios, publicar/archivar)** → FE (`FE-US-001`).
- **Columnas de `products` del pipeline de IA** (`description_enriched`, `enrichment_done`) → US-005 las agrega por migración.
- **Tablas de otras US** (`orders`, `order_items`, `payments`, `carts`, `cart_items`, `customers`, `product_embeddings`) → sus respectivas US. `product_embeddings` y su índice HNSW se crean en US-005; acá solo se habilita la extensión `pgvector` para que exista de entrada.
- **El primer deploy vivo** → lo planifica `/plan-deployment` cuando haya una app scaffoldeada.

## Standards consultados

- `spekode/docs/architecture/railway-baseline.md` §0 (bootstrap greenfield en dos changes), §0.1 (deliverables de `bootstrap-local`), §0.2 (esquema local como única fuente de verdad), §7 (anti-patterns).
- Skill `data-architecture-patterns` (consultado inline; ver `design.md` §Persistencia — no se invocó `data-architect` Mode B porque el E2E §8 resuelve motor, topología y constraints).
- Skill `openspec-workflow` (estructura del change + tasks closure-grade, F40 column-complete).
- ADR-0001 (Railway + Neon + R2), ADR-0002 (pgvector como datastore único).
- `docs/cross-cutting/security-standards.md` (secretos fuera del repo — `.env.example` con placeholders, `.env.local` gitignored).

## Open questions

Todas cerradas — ninguna bloquea la ejecución.

- **Q-A (gestor de workspace)**: **pnpm 9** (`packageManager: pnpm@9.15.9`) por eficiencia de disco/velocidad en monorepos; `package.json` raíz + `pnpm-workspace.yaml`. `[cerrada 2026-07-15 — PO confirma pnpm 9]`.
- **Q-B (versión de Node)**: **Node 22 LTS** (`.nvmrc: 22`, `engines: >=22 <23`). `[cerrada 2026-07-15 — PO confirma Node 22 LTS]`.
- **Q-C (mecanismo de seed)**: seed idempotente vía `tsx prisma/seed.ts` con datos mínimos de demo (3 categorías + 4 productos borrador, upsert por clave natural) para que FE tenga con qué renderizar sin depender de la nube. `[cerrada 2026-07-15 — PO confirma tsx prisma/seed.ts]`.

## References

- User Story: `docs/user-stories/US-001-admin-catalogo-productos.md`
- E2E: `docs/product/design-e2e.md` §8 (modelo de datos), §13 (despliegue), §16 (stack), §17 (NFRs)
- ADRs: `docs/architecture/decisions/0001-platform-railway-neon-r2.md`, `0002-postgresql-pgvector-single-datastore.md`
- Change gemelo: `openspec/changes/US-001-admin-catalogo-productos-platform-cloud-infrastructure/`
