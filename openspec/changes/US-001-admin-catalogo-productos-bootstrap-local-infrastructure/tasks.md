---
parent-us: US-001
discipline: infrastructure
variant: bootstrap-local
language: es
---

# US-001 Bootstrap local — Tasks

> Cada task es closure-grade: atómica, con `Exit criterion:` observable y `Verify:` con el comando exacto que `/develop-infrastructure` corre. Los comandos asumen la raíz del repo como cwd. Las casillas salen en `[ ]` (regeneración); el código ya existe en la rama y estos `Verify:` deben pasar verdes contra el AS-BUILT.

## Pre-requisitos
- [x] Docker + docker-compose instalados en la máquina de desarrollo.
- [x] Confirmadas Q-A (gestor: pnpm 9), Q-B (Node 22), Q-C (seed idempotente) del `proposal.md`.

## Fase 1: Esqueleto del monorepo + toolchain del workspace

- [x] T1.1 Crear el `package.json` raíz con workspaces, gestor pnpm y Node pinneados
  - **Exit criterion**: existe `/package.json` con `"private": true`, `"packageManager": "pnpm@9.15.9"`, `"engines": { "node": ">=22 <23" }`, `"workspaces": ["apps/*","packages/*"]`; existe `pnpm-workspace.yaml` con los globs `apps/*` y `packages/*`.
  - **Verify**: `node -e "const p=require('./package.json'); if(p.private!==true||p.packageManager!=='pnpm@9.15.9'||!/>=22/.test(p.engines.node)) process.exit(1)" && grep -q 'apps/\*' pnpm-workspace.yaml && grep -q 'packages/\*' pnpm-workspace.yaml`

- [x] T1.2 Crear `.nvmrc`, `.gitignore` y la estructura de carpetas placeholder
  - **Exit criterion**: `.nvmrc` contiene `22`; `.gitignore` ignora `.env.local`, `node_modules`, `dist`; existen `apps/web`, `apps/api`, `apps/worker`, `packages/db` cada uno con un `.gitkeep` o `README.md`.
  - **Verify**: `grep -qx 22 .nvmrc && grep -q '.env.local' .gitignore && for d in apps/web apps/api apps/worker packages/db; do test -d "$d" || exit 1; done`

- [x] T1.3 Instalar el workspace y probar que resuelve
  - **Exit criterion**: `pnpm install` completa sin error y genera `pnpm-lock.yaml`.
  - **Verify**: `pnpm install --frozen-lockfile 2>/dev/null || pnpm install; test -f pnpm-lock.yaml`

## Fase 2: Dependencias locales (docker-compose)

- [ ] T2.1 Crear `docker-compose.yml` con Postgres (pgvector) y Redis pinneados
  - **Exit criterion**: `docker-compose.yml` define el servicio `postgres` con imagen `pgvector/pgvector:pg16`, healthcheck `pg_isready -U dsm -d dsm`, volumen nombrado `pgdata`, puerto de host `${POSTGRES_PORT:-5432}`; y el servicio `redis` con imagen `redis:7-alpine`, healthcheck `redis-cli ping`, volumen `redisdata`, puerto `${REDIS_PORT:-6379}`.
  - **Verify**: `docker compose config >/dev/null && docker compose config | grep -q 'pgvector/pgvector:pg16' && docker compose config | grep -q 'redis:7-alpine'`

- [ ] T2.2 Levantar las dependencias y confirmar que Postgres acepta `pgvector`
  - **Exit criterion**: `docker compose up -d` deja `postgres` y `redis` healthy; la extensión `vector` es instalable en la instancia local.
  - **Verify**: `docker compose up -d && sleep 6 && docker compose exec -T postgres psql -U dsm -d dsm -c "CREATE EXTENSION IF NOT EXISTS vector; SELECT extname FROM pg_extension WHERE extname='vector';" | grep -q vector`

## Fase 3: Variables de entorno y targets locales

- [ ] T3.1 Crear `.env.example` con toda variable (placeholders, sin secretos)
  - **Exit criterion**: `.env.example` contiene `POSTGRES_PORT`, `REDIS_PORT`, `DATABASE_URL`, `REDIS_URL` con valores locales, y slots placeholder (`replace-me`) para MP/Gemini/Resend/R2/JWT; no contiene ningún secreto real.
  - **Verify**: `grep -q '^DATABASE_URL=' .env.example && grep -q '^REDIS_URL=' .env.example && grep -q '^POSTGRES_PORT=' .env.example && ! grep -Eiq '(sk_live|APP_USR-|AIza)[A-Za-z0-9]{10}' .env.example`

- [ ] T3.2 Crear el `Makefile` con los targets `up`, `migrate-local`, `seed-local`, `run-local`, `down`
  - **Exit criterion**: `make -n up`, `make -n migrate-local`, `make -n seed-local`, `make -n run-local`, `make -n down` imprimen el comando esperado sin ejecutarlo.
  - **Verify**: `for t in up migrate-local seed-local run-local down; do make -n "$t" >/dev/null 2>&1 || exit 1; done`

## Fase 4: Esquema del catálogo (Prisma) — única fuente de verdad

- [ ] T4.1 Crear `packages/db` (`@dsm/db`) con Prisma 5.22 y los scripts `migrate`/`migrate:deploy`/`seed`
  - **Exit criterion**: `packages/db/package.json` (nombre `@dsm/db`) declara scripts `migrate` (`prisma migrate dev`), `migrate:deploy` (`prisma migrate deploy`), `seed` (`tsx prisma/seed.ts`); Prisma `5.22.0` pinneado (dep `@prisma/client` + devDep `prisma`) y `tsx` como devDependency.
  - **Verify**: `node -e "const p=require('./packages/db/package.json'); if(p.name!=='@dsm/db'||p.scripts.migrate!=='prisma migrate dev'||p.scripts['migrate:deploy']!=='prisma migrate deploy'||!p.scripts.seed.includes('tsx')||p.dependencies['@prisma/client']!=='5.22.0') process.exit(1)"`

- [ ] T4.2 Habilitar la extensión `pgvector` como primera migración
  - **Exit criterion**: existe la migración `20260715000000_enable_pgvector` cuyo SQL incluye `CREATE EXTENSION IF NOT EXISTS vector`.
  - **Verify**: `grep -rq 'CREATE EXTENSION IF NOT EXISTS vector' packages/db/prisma/migrations/`

- [ ] T4.3 Modelar `categories` en `schema.prisma` con las 5 columnas del subconjunto US-001
  - **Exit criterion**: el modelo `Category` (mapeado a `categories`) tiene exactamente las columnas `id` (uuid PK, default `gen_random_uuid()`), `slug` (`@unique`), `name`, `parent_id` (self-relation `CategoryTree` nullable), `created_at` (default `now()`).
  - **Verify**: `for c in 'id' 'slug' 'name' 'parent_id' 'created_at'; do grep -A14 'model Category' packages/db/prisma/schema.prisma | grep -q "$c" || exit 1; done && grep -A14 'model Category' packages/db/prisma/schema.prisma | grep -q '@unique'`

- [ ] T4.4 Modelar `products` con las 11 columnas del subconjunto US-001, constraints e índice (F40 — column-complete)
  - **Exit criterion**: el modelo `Product` (mapeado a `products`) tiene **exactamente** las 11 columnas del alcance US-001 — `id` (uuid PK), `sku` (`@unique`), `name`, `description_raw` (text, nullable — AC-3), `price_ars_cents` (int), `stock` (int, default 0), `status` (string default `draft`), `category_id` (uuid FK), `image_url` (text, nullable — AC-3/§4), `created_at` (default `now()`), `updated_at` (`@updatedAt`) — más el índice `@@index([category_id, status])`; y la migración `init_catalog` incluye los CHECK `products_price_check` (`price_ars_cents > 0`), `products_stock_check` (`stock >= 0`) y `products_status_check` (`status IN ('draft','published','archived')`). Diferidas a US-005: `description_enriched`, `enrichment_done` (ver `design.md` §Persistencia).
  - **Verify**: `for c in 'sku' 'name' 'description_raw' 'price_ars_cents' 'stock' 'status' 'category_id' 'image_url' 'created_at' 'updated_at'; do grep -A22 'model Product' packages/db/prisma/schema.prisma | grep -q "$c" || exit 1; done && grep -A22 'model Product' packages/db/prisma/schema.prisma | grep -q '@@index(\[category_id, status\])' && grep -rq 'products_price_check.*price_ars_cents > 0' packages/db/prisma/migrations/ && grep -rq 'products_stock_check.*stock >= 0' packages/db/prisma/migrations/ && grep -rq "products_status_check.*status IN ('draft', 'published', 'archived')" packages/db/prisma/migrations/`

- [ ] T4.5 Aplicar las migraciones contra el Postgres local y confirmar el esquema materializado
  - **Exit criterion**: `migrate` corre limpio contra el Postgres de docker-compose; las tablas `categories` y `products` existen con sus 5 y 11 columnas respectivamente y sus constraints.
  - **Verify**: `pnpm --filter @dsm/db migrate && docker compose exec -T postgres psql -U dsm -d dsm -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='products'" | grep -qx 11 && docker compose exec -T postgres psql -U dsm -d dsm -c "\d products" | grep -q 'products_sku_key' && docker compose exec -T postgres psql -U dsm -d dsm -c "\d products" | grep -q 'products_stock_check'`

- [ ] T4.6 Crear el seed idempotente con datos mínimos de demo
  - **Exit criterion**: `prisma/seed.ts` inserta 3 categorías (refrigeracion/ferreteria/electricidad) y 4 productos en estado `draft` vía upsert por clave natural (slug/sku); re-correrlo no duplica ni falla.
  - **Verify**: `pnpm --filter @dsm/db seed && pnpm --filter @dsm/db seed && docker compose exec -T postgres psql -U dsm -d dsm -tAc "SELECT count(*) FROM products" | grep -qx 4 && docker compose exec -T postgres psql -U dsm -d dsm -tAc "SELECT count(*) FROM categories" | grep -qx 3`

- [ ] T4.7 Probar que los constraints rechazan datos inválidos (defensa en profundidad de AC-5/AC-9)
  - **Exit criterion**: insertar un producto con `price_ars_cents <= 0`, `stock < 0`, estado inválido, o un SKU duplicado es rechazado por la DB (violación de CHECK o de UNIQUE).
  - **Verify**: `docker compose exec -T postgres psql -U dsm -d dsm -c "INSERT INTO products (id,sku,name,price_ars_cents,stock,status,category_id) SELECT gen_random_uuid(),'X-NEG','x',-1,0,'draft',id FROM categories LIMIT 1;" 2>&1 | grep -qi 'violates check constraint' && docker compose exec -T postgres psql -U dsm -d dsm -c "INSERT INTO products (id,sku,name,price_ars_cents,stock,status,category_id) SELECT gen_random_uuid(),'REF-001','dup',1,0,'draft',id FROM categories LIMIT 1;" 2>&1 | grep -qi 'duplicate key\|unique'`

## Fase 5: Puerta de CI de PR

- [ ] T5.1 Crear `.github/workflows/ci.yml` con lint/typecheck/test + migración contra Postgres de servicio
  - **Exit criterion**: el workflow corre en `pull_request` y push a `main`; usa Node 22 + pnpm 9.15.9; levanta un servicio `pgvector/pgvector:pg16`; corre `prisma generate`, `pnpm -r lint`, `pnpm -r typecheck`, `pnpm --filter @dsm/db migrate:deploy` y `pnpm -r test`; no referencia ningún secreto de nube.
  - **Verify**: `grep -q 'pull_request' .github/workflows/ci.yml && grep -q 'pgvector/pgvector:pg16' .github/workflows/ci.yml && grep -q 'migrate:deploy' .github/workflows/ci.yml && ! grep -Eiq 'RAILWAY_TOKEN|NEON_|R2_|secrets\.(MP|GEMINI|RESEND)' .github/workflows/ci.yml`

- [ ] T5.2 Validar el workflow con lint de YAML de Actions
  - **Exit criterion**: el YAML del workflow es sintácticamente válido y sus jobs resuelven.
  - **Verify**: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"` (y, si `act` está disponible, `act pull_request -n` corre en dry-run sin error de parseo).

## Verificación (suite-level)

- [ ] Monorepo instala limpio: `pnpm install --frozen-lockfile`
- [ ] Dependencias locales arriba y healthy: `make up && sleep 6 && docker compose ps | grep -c healthy` ≥ 2
- [ ] Esquema aplica y siembra limpio desde cero: `make down && make up && sleep 6 && make migrate-local && make seed-local`
- [ ] `products` tiene exactamente 11 columnas (paridad con el alcance US-001): `docker compose exec -T postgres psql -U dsm -d dsm -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='products'"` = `11`
- [ ] CI de PR válida sintácticamente: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"`
- [ ] No hay secretos comiteados: `git grep -Ei '(sk_live|APP_USR-|AIza[A-Za-z0-9]{20})' -- . ':(exclude).env.example'` no devuelve nada.
