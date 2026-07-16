---
parent-us: US-001
discipline: infrastructure
variant: bootstrap-local
language: es
---

# US-001 Bootstrap local — Design

## Context

Repositorio greenfield (verificado: sin `package.json`, `docker-compose.yml`, `.env.example` ni módulos de app fuera de `spekode/`). El baseline de infra es **Railway PaaS** (`project-config.yml` → `stacks.infra.platform: railway`), formalizado en ADR-0001. El baseline Railway §0 **manda** partir el bootstrap greenfield en dos changes: `bootstrap-local` (este, desbloqueador, cero credenciales de nube) y `platform-cloud` (paralelo, gated en cuentas/billing/legal). No hay Terraform en este baseline: Railway es PaaS, la config vive en `railway.json`/`railway.toml` + dashboard.

Este change entrega solo la mitad local. El objetivo es que **cualquier disciplina pueda correr la app y validar el esquema del catálogo sin una cuenta paga**.

## Goals

- Un monorepo Node/TS **runnable** (no solo carpetas): workspace glue pinneado, para que BE y FE scaffoldeen sus apps sin improvisar decisiones estructurales que INFRA debe fijar.
- Dependencias locales (Postgres+pgvector, Redis) reproducibles vía `docker-compose up`.
- El esquema del catálogo (`categories`, `products`) como **única fuente de verdad**, validado contra el Postgres local.
- Puerta de CI que valida cada commit desde el día 1, antes de que exista deploy.

## Non-goals

- Provisioning de nube, secretos de nube, DNS/TLS, autodeploy, runbook (→ `platform-cloud`).
- Scaffolding de las apps NestJS/Next.js (→ BE/FE en su primer ticket).
- Endpoints, UI, RBAC, transiciones de estado (→ BE/FE).
- Columnas de `products` de otras US y el índice HNSW de embeddings (→ US-003/US-005).

## Approach

### Estructura del monorepo (AS-BUILT)

```
/  (raíz — greenfield)
├── package.json            # pnpm@9.15.9, engines node >=22 <23, workspaces apps/* packages/*
├── pnpm-workspace.yaml     # globs: apps/*, packages/*
├── pnpm-lock.yaml
├── .nvmrc                  # 22
├── .gitignore              # .env.local, node_modules, dist, ...
├── .env.example            # toda var con placeholder, sin secretos
├── docker-compose.yml      # postgres(pgvector/pgvector:pg16) + redis(redis:7-alpine)
├── Makefile                # up / migrate-local / seed-local / run-local / down
├── .github/workflows/ci.yml
├── apps/
│   ├── web/    (placeholder — FE scaffoldea create-next-app acá)
│   ├── api/    (placeholder — BE scaffoldea nest new acá)
│   └── worker/ (placeholder — BE scaffoldea worker BullMQ acá)
└── packages/
    └── db/                 # dueño del esquema — Prisma 5.22 (@dsm/db)
        ├── package.json    # scripts migrate / migrate:deploy / seed / generate / lint / typecheck
        ├── prisma/
        │   ├── schema.prisma
        │   ├── migrations/
        │   │   ├── 20260715000000_enable_pgvector/migration.sql
        │   │   └── 20260715230024_init_catalog/migration.sql
        │   └── seed.ts
        └── README.md
```

**Decisión clave**: `packages/db` es el **dueño del esquema** para todo el monorepo. BE lo consume como dependencia de workspace (`@dsm/db`). Esto evita que el esquema quede acoplado a la app API y permite que `platform-cloud` corra `prisma migrate deploy` desde el mismo paquete contra la nube.

### `docker-compose.yml` — dependencias locales (AS-BUILT)

Espeja los plugins de Railway (Postgres, Redis) para que el entorno local sea fiel a producción:

- **postgres**: imagen `pgvector/pgvector:pg16` (Postgres 16 con `pgvector` precompilado — evita compilar la extensión a mano). Env `dsm/dsm/dsm`. Healthcheck `pg_isready -U dsm -d dsm`. Volumen nombrado `pgdata`. Puerto de host parametrizado `${POSTGRES_PORT:-5432}` (para no chocar si el dev ya tiene algo en 5432).
- **redis**: imagen `redis:7-alpine`. Healthcheck `redis-cli ping`. Volumen `redisdata`. Puerto `${REDIS_PORT:-6379}`. (Redis no lo usa US-001 directamente, pero se incluye porque el worker/BullMQ y el rate-limit lo necesitan desde US-005/US-009/US-014 y el compose es la única fuente de deps locales — mejor completo desde el bootstrap que parchearlo por US.)

La extensión `pgvector` se habilita **en la migración Prisma** (`CREATE EXTENSION IF NOT EXISTS vector`), no en un init-script del contenedor, para que el mismo mecanismo aplique en la nube vía `migrate:deploy`.

### Persistencia — esquema del catálogo (US-001, AS-BUILT)

> **Fuente**: transcripción del E2E §8 (DER + notas), **acotada al subconjunto de US-001**. No es una decisión arquitectónica nueva: motor (PostgreSQL Neon), extensión (`pgvector`), ORM (Prisma + `$queryRaw` para kNN en US-004+), unidad monetaria (centavos ARS) y constraints ya están ratificados en ADR-0001/0002 y en el E2E `Approved`.

**Alcance de este change**: solo `categories` y `products`, con las columnas que US-001 necesita, más la habilitación de `pgvector`. El E2E §8 declara `products` con 13 columnas; este esquema materializa **11** — las 2 restantes son del pipeline de IA (US-005) y se agregan por migración cuando esa US las introduce:

| Columna del DER §8 diferida (no materializada acá) | US que la agrega | Por qué |
|---|---|---|
| `description_enriched` | US-005 (enriquecimiento IA) | La puebla el pipeline de IA; ninguna lógica de US-001 la toca |
| `enrichment_done` | US-005 | Flag del pipeline de enriquecimiento |

Esto respeta el principio de esquema **autorado por necesidad real**: US-001 materializa las columnas que sus ACs ejercitan — incluidas `description_raw` e `image_url`, que el dueño edita en **AC-3** ("modifica su precio, stock, descripción, categoría o imagen") — y difiere solo las del pipeline de IA (US-005), que ninguna lógica de US-001 toca. `updated_at` se incluye como columna de auditoría estándar de una tabla mutable.

#### Tabla `categories` (5 columnas — AS-BUILT)

| Columna | Tipo | Constraint |
|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` |
| `slug` | `text` | **UNIQUE** (`categories_slug_key`), NOT NULL (AC-1) |
| `name` | `text` | NOT NULL |
| `parent_id` | `uuid` | FK → `categories.id` NULL (`categories_parent_id_fkey`, ON DELETE SET NULL — rubro/subrubro, self-ref) |
| `created_at` | `timestamp(3)` | NOT NULL default `CURRENT_TIMESTAMP` |

#### Tabla `products` (11 columnas)

| Columna | Tipo | Constraint |
|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` |
| `sku` | `text` | **UNIQUE** (`products_sku_key`), NOT NULL (AC-9) |
| `name` | `text` | NOT NULL |
| `description_raw` | `text` | NULL — descripción manual, editable en AC-3; no requerida para publicar (§10) |
| `price_ars_cents` | `int` | NOT NULL, **CHECK `products_price_check` (`price_ars_cents > 0`)** (AC-5; centavos, IVA incluido) |
| `stock` | `int` | NOT NULL, default `0`, **CHECK `products_stock_check` (`stock >= 0`)** (AC-5) |
| `status` | `text` | NOT NULL, default `'draft'`, **CHECK `products_status_check` (`status IN ('draft','published','archived')`)** (AC-2/AC-4/AC-7) |
| `category_id` | `uuid` | FK → `categories.id` (`products_category_id_fkey`, ON DELETE RESTRICT), NOT NULL |
| `image_url` | `text` | NULL — una imagen principal opcional (§4), editable en AC-3; el archivo se sube a R2 en `platform-cloud` |
| `created_at` | `timestamp(3)` | NOT NULL default `CURRENT_TIMESTAMP` |
| `updated_at` | `timestamp(3)` | NOT NULL default `CURRENT_TIMESTAMP`, `@updatedAt` (Prisma lo actualiza en cada write) |

**Índice** (E2E §8): `products_category_id_status_idx` sobre `(category_id, status)`; `products_sku_key` UNIQUE (implícito por el constraint). El índice HNSW sobre embeddings NO se crea acá (tabla `product_embeddings` es de US-005).

> **Nota sobre `category_id` NOT NULL**: el AS-BUILT lo materializó NOT NULL (todo producto nace con categoría). La regla "categoría requerida para *publicar*" (AC-6) la aplica BE en la transición de estado; a nivel DB, el producto ya exige categoría desde el alta, lo cual es coherente con el flujo del panel (se elige categoría en el formulario de alta). Si una US futura necesitara alta sin categoría, se relajaría por migración — decisión de esa US, no de este bootstrap.

**Extensión**: `CREATE EXTENSION IF NOT EXISTS vector;` como primera migración (`20260715000000_enable_pgvector`) — habilita `pgvector` de entrada aunque la tabla de vectores llegue después, para que la primera migración de US-005 solo agregue la tabla.

**Decisiones de constraint atadas a AC**:
- AC-9 (SKU único) → `products_sku_key` UNIQUE.
- AC-5 (validación) → CHECK `price_ars_cents > 0` y `stock >= 0` en la DB (defensa en profundidad; el mensaje por campo lo da BE).
- AC-2/AC-4/AC-7 (estados) → CHECK `status IN ('draft','published','archived')`.
- AC-7 (archivar, no borrar) → `status='archived'`; **no** hay `deleted_at` en products ni delete físico. El precio histórico (AC-10) se preserva porque `order_items.unit_price_ars_cents` (otra US) copia el precio al comprar — `products.price_ars_cents` nunca es la fuente del precio histórico.

#### ¿Se invocó data-architect Mode B?

**No.** El instructivo pide consultar `data-architecture-patterns` inline y, *si lo amerita*, delegar a `data-architect` Mode B. Criterio del skill ("workload-first, baseline-second"): se delega cuando la **clasificación de workload**, la **tractabilidad de migración** o la **elección de motor** son inciertas. Acá ninguna lo es:

- **Motor**: PostgreSQL + `pgvector` — ratificado en ADR-0001/0002, dentro de lo que el E2E `Approved` resolvió.
- **Topología**: single-primary Neon, sin réplicas/sharding (E2E §21, escala ~5.000 SKUs / ~50 concurrentes).
- **Migración**: greenfield — no hay migración de datos existentes, solo `CREATE TABLE`. Tractabilidad trivial.
- **Constraints/índices/tipos**: enumerados en el E2E §8 al detalle.

Delegar a Mode B produciría una transcripción del E2E §8, no una decisión nueva. Se consultó el skill inline (taxonomía relacional, regla baseline, unidad monetaria en enteros) y se transcribió el subconjunto de US-001. Decisiones de implementación menores (p. ej. `citext` para slug case-insensitive, o trigger de `updated_at`) no son triggers de Mode B; se resuelven en la US que las necesite.

### CI-de-PR (AS-BUILT)

Workflow `ci.yml` en cada `pull_request` y push a `main`:
1. Checkout + setup pnpm (`9.15.9`) + Node 22 (cache pnpm).
2. `pnpm install --frozen-lockfile`.
3. `pnpm --filter @dsm/db exec prisma generate`.
4. `pnpm -r lint` + `pnpm -r typecheck` (no fallan si un `app/*` aún es placeholder — se corren sobre workspaces existentes).
5. Levanta un servicio `pgvector/pgvector:pg16` (GitHub Actions `services:`) y corre `pnpm --filter @dsm/db migrate:deploy` para probar que el esquema aplica limpio.
6. `pnpm -r test` (placeholder al inicio; se llena cuando BE/FE scaffoldean).

**Sin secretos de nube**: el Postgres de CI es un servicio efímero del runner; la `DATABASE_URL` de CI apunta a `localhost:5432` del runner.

## Trade-offs

- **pnpm vs npm workspaces**: se eligió pnpm por eficiencia en monorepos (Q-A cerrada). Barato de cambiar en el bootstrap, caro después — por eso se fijó ahora.
- **Redis en el compose desde US-001 aunque US-001 no lo use**: se incluye para no parchear el compose por-US. Costo: una imagen más en local. Beneficio: el compose es fiel a producción desde el día 1.
- **`packages/db` separado vs esquema dentro de `apps/api`**: paquete separado para que `platform-cloud` aplique migraciones sin depender de la app API y para que el esquema sea consumible por worker + api.
- **pgvector vía migración vs init-script del contenedor**: migración, para que el mismo mecanismo (Prisma) aplique local y en la nube.
- **Esquema de US-001 (11 columnas) vs DER completo (13)**: se materializan las columnas que las ACs de US-001 ejercitan (incl. `description_raw`/`image_url` de AC-3) + `updated_at`; se difieren solo `description_enriched`/`enrichment_done` (US-005). Beneficio: sin columnas muertas del pipeline de IA. Costo: una migración adicional en US-005 (barato en greenfield sin datos productivos).

## Observability

Fuera de alcance real para `bootstrap-local` (no hay servicio desplegado que observar). La única señal operable acá es **la CI**: un PR que rompe lint/typecheck/migración falla la puerta. La instrumentación de eventos de negocio ("producto creado/publicado/archivado", E2E §18) es de BE. La observabilidad de nube (Sentry, logs Railway) es de `platform-cloud`.

## Open questions

Todas cerradas el 2026-07-15 — ninguna bloquea la ejecución:

- Q-A: gestor de workspace → **pnpm 9.15.9**.
- Q-B: versión Node → **22 LTS**.
- Q-C: mecanismo de seed → **`tsx prisma/seed.ts`** idempotente.

## References

- E2E: `docs/product/design-e2e.md` §8, §13, §16, §17
- ADRs: `0001-platform-railway-neon-r2.md`, `0002-postgresql-pgvector-single-datastore.md`
- Baseline: `spekode/docs/architecture/railway-baseline.md` §0
- Skill: `data-architecture-patterns` (consultado inline)
