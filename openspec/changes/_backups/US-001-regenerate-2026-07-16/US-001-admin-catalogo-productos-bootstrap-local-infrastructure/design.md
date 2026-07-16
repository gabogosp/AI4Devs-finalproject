---
parent-us: US-001
discipline: infrastructure
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
- Tablas de otras US y el índice HNSW de embeddings (→ US-005 y otras).

## Approach

### Estructura del monorepo

```
/  (raíz — greenfield)
├── package.json            # workspaces (pnpm), engines, packageManager pinneados
├── pnpm-workspace.yaml     # globs: apps/*, packages/*
├── .nvmrc                  # 22
├── .gitignore              # .env.local, node_modules, dist, .turbo, etc.
├── .env.example            # toda var con placeholder, sin secretos
├── docker-compose.yml      # postgres(pgvector) + redis
├── Makefile                # up / migrate-local / seed-local / run-local / down
├── .github/workflows/ci.yml
├── apps/
│   ├── web/    (.gitkeep + README — FE scaffoldea create-next-app acá)
│   ├── api/    (.gitkeep + README — BE scaffoldea nest new acá)
│   └── worker/ (.gitkeep + README — BE scaffoldea worker BullMQ acá)
└── packages/
    └── db/                 # dueño del esquema — Prisma
        ├── package.json    # scripts migrate / migrate:deploy / seed
        ├── prisma/
        │   ├── schema.prisma
        │   ├── migrations/
        │   └── seed.ts
        └── README.md
```

**Decisión clave**: `packages/db` es el **dueño del esquema** para todo el monorepo. BE lo consume como dependencia de workspace (`@dsm/db`). Esto evita que el esquema quede acoplado a la app API y permite que `platform-cloud` corra `prisma migrate deploy` desde el mismo paquete contra la nube.

### `docker-compose.yml` — dependencias locales

Espeja los plugins de Railway (Postgres, Redis) para que el entorno local sea fiel a producción:

- **postgres**: imagen `pgvector/pgvector:pg16` (Postgres 16 con `pgvector` precompilado — evita compilar la extensión a mano). Healthcheck `pg_isready`. Volumen nombrado `dsm_pgdata`. Puerto `5432`.
- **redis**: imagen `redis:7-alpine`. Healthcheck `redis-cli ping`. Puerto `6379`. (Redis no lo usa US-001 directamente, pero se incluye porque el worker/BullMQ y el rate-limit lo necesitan desde US-005/US-009/US-014 y el compose es la única fuente de deps locales — mejor completo desde el bootstrap que parchearlo por US.)

La extensión `pgvector` se habilita **en la migración Prisma** (`CREATE EXTENSION IF NOT EXISTS vector`), no en un init-script del contenedor, para que el mismo mecanismo aplique en la nube vía `migrate:deploy`.

### Persistencia — esquema del catálogo (US-001)

> **Fuente**: transcripción directa del E2E §8 (DER + notas). No es una decisión arquitectónica nueva: motor (PostgreSQL Neon), extensión (`pgvector`), ORM (Prisma + `$queryRaw` para kNN), unidad monetaria (centavos ARS) y constraints ya están ratificados en ADR-0001/0002 y en el E2E `Approved`. Ver §"¿Se invocó data-architect Mode B?" abajo.

**Alcance de este change**: solo `categories` y `products` (las dos entidades que US-001 introduce), más la habilitación de la extensión `pgvector`. Las demás tablas del DER (`product_embeddings`, `orders`, `order_items`, `payments`, `carts`, `cart_items`, `customers`) son de otras US y NO se crean acá.

#### Tabla `categories`

| Columna | Tipo | Constraint |
|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` |
| `name` | `text` | NOT NULL |
| `slug` | `text` | **UNIQUE**, NOT NULL (AC-1) |
| `parent_id` | `uuid` | FK → `categories.id` NULL (rubro/subrubro, self-ref) |
| `created_at` | `timestamptz` | NOT NULL default `now()` |

#### Tabla `products`

| Columna | Tipo | Constraint |
|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` |
| `sku` | `text` | **UNIQUE**, NOT NULL (AC-9) |
| `name` | `text` | NOT NULL |
| `description_raw` | `text` | NULL |
| `description_enriched` | `text` | NULL (lo puebla US-005) |
| `price_ars_cents` | `int` | NOT NULL, **CHECK (`price_ars_cents > 0`)** (AC-5; centavos, IVA incluido) |
| `stock` | `int` | NOT NULL, **CHECK (`stock >= 0`)** (AC-5) |
| `category_id` | `uuid` | FK → `categories.id`, NULL (requerido para publicar, no para existir — AC-2/AC-6; la regla "requerido para publicar" es de BE) |
| `image_url` | `text` | NULL (imagen opcional; se sube a R2 en `platform-cloud`) |
| `status` | `text` | NOT NULL, default `'draft'`, **CHECK (`status IN ('draft','published','archived')`)** (AC-2/AC-4/AC-7) |
| `enrichment_done` | `bool` | NOT NULL default `false` (lo gestiona US-005) |
| `created_at` | `timestamptz` | NOT NULL default `now()` |
| `updated_at` | `timestamptz` | NOT NULL default `now()` (trigger/`@updatedAt` de Prisma) |

**Índices** (E2E §8): `products(category_id, status)` compuesto, `products(sku)` UNIQUE (implícito por el constraint). El índice HNSW sobre embeddings NO se crea acá (tabla `product_embeddings` es de US-005).

**Extensión**: `CREATE EXTENSION IF NOT EXISTS vector;` como primera migración — habilita `pgvector` de entrada aunque la tabla de vectores llegue después, para que la primera migración de US-005 solo agregue la tabla.

**Decisiones de constraint atadas a AC**:
- AC-9 (SKU único) → `products.sku UNIQUE`.
- AC-5 (validación) → CHECK `price_ars_cents > 0` y `stock >= 0` en la DB (defensa en profundidad; el mensaje por campo lo da BE).
- AC-7 (archivar, no borrar) → `status='archived'`; **no** hay `deleted_at` en products ni delete físico. El precio histórico (AC-10) se preserva porque `order_items.unit_price_ars_cents` (otra US) copia el precio al comprar — `products.price_ars_cents` nunca es la fuente del precio histórico.

#### ¿Se invocó data-architect Mode B?

**No.** El instructivo pide consultar `data-architecture-patterns` inline y, *si lo amerita*, delegar a `data-architect` Mode B. Criterio del skill (operating principle "workload-first, baseline-second"): se delega cuando la **clasificación de workload**, la **tractabilidad de migración** o la **elección de motor** son inciertas. Acá ninguna lo es:

- **Motor**: PostgreSQL + `pgvector` — ratificado en ADR-0001/0002, dentro de lo que el E2E `Approved` resolvió.
- **Topología**: single-primary Neon, sin réplicas/sharding (E2E §21, escala ~5.000 SKUs / ~50 concurrentes).
- **Migración**: greenfield — no hay migración de datos existentes, solo `CREATE TABLE`. Tractabilidad trivial.
- **Constraints/índices/tipos**: enumerados en el E2E §8 al detalle.

Delegar a Mode B produciría una transcripción del E2E §8, no una decisión nueva. Se consultó el skill inline (taxonomía relacional, regla baseline, unidad monetaria en enteros) y se transcribió el esquema. Si durante `/develop-infrastructure` aparece ambigüedad (p. ej. el equipo quiere `citext` para slug case-insensitive, o un trigger de `updated_at` a mano vs `@updatedAt`), esa es una decisión de implementación menor, no un trigger de Mode B.

### CI-de-PR

Workflow `ci.yml` en cada `pull_request` y push a `main`:
1. Checkout + setup pnpm + Node 22 (cache).
2. `pnpm install --frozen-lockfile`.
3. `pnpm -r lint` + `pnpm -r typecheck` (no fallan si un `app/*` aún es placeholder — se corren sobre workspaces existentes).
4. Levanta un servicio `pgvector/pgvector:pg16` (GitHub Actions `services:`) y corre `pnpm --filter @dsm/db migrate` + `pnpm --filter @dsm/db seed` para probar que el esquema aplica limpio.
5. `pnpm -r test` (placeholder al inicio; se llena cuando BE/FE scaffoldean).

**Sin secretos de nube**: el Postgres de CI es un servicio efímero del runner. La `DATABASE_URL` de CI apunta a `localhost` del runner.

## Trade-offs

- **pnpm vs npm workspaces**: se propone pnpm por eficiencia en monorepos (Q-A). Riesgo: si BE/FE ya tienen convención npm, hay que cambiar el glue. Mitigación: es un Open Question a confirmar antes de mergear — barato de cambiar ahora, caro después.
- **Redis en el compose desde US-001 aunque US-001 no lo use**: se incluye para no parchear el compose por-US. Costo: una imagen más en local. Beneficio: el compose es fiel a producción desde el día 1 y US-005/009/014 no lo re-tocan.
- **`packages/db` separado vs esquema dentro de `apps/api`**: se elige paquete separado para que `platform-cloud` aplique migraciones sin depender de la app API y para que el esquema sea consumible por worker + api. Costo: una indirección de workspace más.
- **pgvector vía migración vs init-script del contenedor**: se elige migración para que el mismo mecanismo (Prisma) aplique local y en la nube. Costo: la primera migración lleva un `CREATE EXTENSION` un poco atípico.

## Observability

Fuera de alcance real para `bootstrap-local` (no hay servicio desplegado que observar). La única señal operable acá es **la CI**: un PR que rompe lint/typecheck/migración falla la puerta. La instrumentación de eventos de negocio ("producto creado/publicado/archivado", E2E §18) es de BE. La observabilidad de nube (Sentry, logs Railway) es de `platform-cloud`.

## Open questions

- Q-A: gestor de workspace (pnpm propuesto) — confirma equipo BE/FE.
- Q-B: versión Node (22 LTS propuesta) — confirma equipo.
- Q-C: mecanismo de seed (`tsx prisma/seed.ts` idempotente propuesto) — confirma equipo.

Ninguna bloquea la autoría del plan; las tres son decisiones estructurales baratas de fijar ahora y caras después, por eso se explicitan.

## References

- E2E: `docs/product/design-e2e.md` §8, §13, §16, §17
- ADRs: `0001-platform-railway-neon-r2.md`, `0002-*` (pgvector)
- Baseline: `spekode/docs/architecture/railway-baseline.md` §0
- Skill: `data-architecture-patterns` (consultado inline)
