---
parent-us: US-001
discipline: infrastructure
language: es
---

# US-001 Bootstrap local — Tasks

> Cada task es closure-grade: atómica, con `Exit criterion:` observable y `Verify:` con el comando exacto que `/develop-infrastructure` corre. Los comandos asumen la raíz del repo como cwd.

## Pre-requisitos
- [ ] Docker + docker-compose instalados en la máquina de desarrollo.
- [ ] Confirmadas Q-A (gestor: pnpm), Q-B (Node 22), Q-C (seed) del `proposal.md`, o aceptados los defaults propuestos.

## Fase 1: Esqueleto del monorepo + toolchain del workspace

- [x] T1.1 Crear el `package.json` raíz con workspaces, gestor y Node pinneados
  - **Exit criterion**: existe `/package.json` con `"private": true`, `"packageManager": "pnpm@9.x"`, `"engines": { "node": ">=22 <23" }` y `"workspaces"`/`pnpm-workspace.yaml` declarando `apps/*` y `packages/*`.
  - **Verify**: `node -e "const p=require('./package.json'); if(!p.private||!p.packageManager||!p.engines?.node) process.exit(1)" && test -f pnpm-workspace.yaml && grep -q 'apps/\*' pnpm-workspace.yaml`

- [x] T1.2 Crear `.nvmrc`, `.gitignore` y la estructura de carpetas placeholder
  - **Exit criterion**: `.nvmrc` contiene `22`; `.gitignore` ignora `.env.local`, `node_modules`, `dist`; existen `apps/web`, `apps/api`, `apps/worker`, `packages/db` cada uno con un `.gitkeep` o `README.md`.
  - **Verify**: `grep -qx 22 .nvmrc && grep -q '.env.local' .gitignore && for d in apps/web apps/api apps/worker packages/db; do test -d "$d" || exit 1; done`

- [x] T1.3 Instalar el workspace y probar que resuelve
  - **Exit criterion**: `pnpm install` completa sin error y genera `pnpm-lock.yaml`.
  - **Verify**: `pnpm install --frozen-lockfile 2>/dev/null || pnpm install; test -f pnpm-lock.yaml`

## Fase 2: Dependencias locales (docker-compose)

- [x] T2.1 Crear `docker-compose.yml` con Postgres (pgvector) y Redis pinneados
  - **Exit criterion**: `docker-compose.yml` define el servicio `postgres` con imagen `pgvector/pgvector:pg16`, healthcheck `pg_isready`, volumen nombrado; y el servicio `redis` con imagen `redis:7-alpine`, healthcheck `redis-cli ping`.
  - **Verify**: `docker compose config >/dev/null && docker compose config | grep -q 'pgvector/pgvector:pg16' && docker compose config | grep -q 'redis:7'`

- [x] T2.2 Levantar las dependencias y confirmar que Postgres acepta `pgvector`
  - **Exit criterion**: `docker compose up -d` deja `postgres` y `redis` healthy; la extensión `vector` es instalable en la instancia local.
  - **Verify**: `docker compose up -d && sleep 5 && docker compose exec -T postgres psql -U dsm -d dsm -c "CREATE EXTENSION IF NOT EXISTS vector; SELECT extname FROM pg_extension WHERE extname='vector';" | grep -q vector`

## Fase 3: Variables de entorno y targets locales

- [x] T3.1 Crear `.env.example` con toda variable (placeholders, sin secretos)
  - **Exit criterion**: `.env.example` contiene al menos `DATABASE_URL`, `REDIS_URL` con valores placeholder locales; no contiene ningún secreto real (sin API keys de MP/Gemini/Resend con valor).
  - **Verify**: `grep -q '^DATABASE_URL=' .env.example && grep -q '^REDIS_URL=' .env.example && ! grep -Eiq '(sk_live|APP_USR-|AIza)[A-Za-z0-9]' .env.example`

- [x] T3.2 Crear el `Makefile` con los targets `up`, `migrate-local`, `seed-local`, `run-local`, `down`
  - **Exit criterion**: `make -n up`, `make -n migrate-local`, `make -n seed-local`, `make -n down` imprimen el comando esperado sin ejecutarlo.
  - **Verify**: `for t in up migrate-local seed-local down; do make -n "$t" >/dev/null 2>&1 || exit 1; done`

## Fase 4: Esquema del catálogo (Prisma) — única fuente de verdad

- [x] T4.1 Crear `packages/db` con Prisma y los scripts `migrate`/`migrate:deploy`/`seed`
  - **Exit criterion**: `packages/db/package.json` (nombre `@dsm/db`) declara scripts `migrate` (`prisma migrate dev`), `migrate:deploy` (`prisma migrate deploy`), `seed`; Prisma está pinneado como devDependency.
  - **Verify**: `node -e "const p=require('./packages/db/package.json'); if(p.name!=='@dsm/db'||!p.scripts.migrate||!p.scripts['migrate:deploy']||!p.scripts.seed) process.exit(1)"`

- [x] T4.2 Habilitar la extensión `pgvector` como primera migración
  - **Exit criterion**: existe una migración cuyo SQL incluye `CREATE EXTENSION IF NOT EXISTS vector`.
  - **Verify**: `grep -rq 'CREATE EXTENSION IF NOT EXISTS vector' packages/db/prisma/migrations/`

- [x] T4.3 Modelar `categories` en `schema.prisma` con slug único y self-ref
  - **Exit criterion**: el modelo `Category` tiene `id uuid` PK, `slug` `@unique`, `parent_id` self-relation nullable, `name`, `created_at`.
  - **Verify**: `grep -A12 'model Category' packages/db/prisma/schema.prisma | grep -q '@unique'`

- [x] T4.4 Modelar `products` con constraints de SKU, precio, stock, estado e índices
  - **Exit criterion**: el modelo `Product` tiene `sku` `@unique`, `price_ars_cents` y `stock` `int`, `status` con default `draft`, índice `@@index([category_id, status])`; y la migración generada incluye los CHECK `price_ars_cents > 0`, `stock >= 0` y `status IN ('draft','published','archived')`.
  - **Verify**: `grep -A20 'model Product' packages/db/prisma/schema.prisma | grep -q '@@index(\[category_id, status\])' && grep -rEq 'price_ars_cents.*> 0' packages/db/prisma/migrations/ && grep -rEq 'stock.*>= 0' packages/db/prisma/migrations/ && grep -rq "status IN ('draft', 'published', 'archived')" packages/db/prisma/migrations/`

- [x] T4.5 Aplicar las migraciones contra el Postgres local y confirmar el esquema
  - **Exit criterion**: `migrate` corre limpio contra el Postgres de docker-compose; las tablas `categories` y `products` existen con sus constraints.
  - **Verify**: `pnpm --filter @dsm/db migrate && docker compose exec -T postgres psql -U dsm -d dsm -c "\d products" | grep -q 'products_sku_key' && docker compose exec -T postgres psql -U dsm -d dsm -c "\d products" | grep -Eq 'stock_check|products_stock'`

- [x] T4.6 Crear el seed idempotente con datos mínimos de demo
  - **Exit criterion**: `prisma/seed.ts` inserta 2-3 categorías y 3-5 productos en estado `draft` de forma idempotente (re-correrlo no duplica ni falla).
  - **Verify**: `pnpm --filter @dsm/db seed && pnpm --filter @dsm/db seed && docker compose exec -T postgres psql -U dsm -d dsm -tAc "SELECT count(*) FROM products" | grep -Eq '^[3-5]$'`

- [x] T4.7 Probar que los constraints rechazan datos inválidos (defensa en profundidad de AC-5/AC-9)
  - **Exit criterion**: insertar un producto con `price_ars_cents <= 0`, `stock < 0`, o un SKU duplicado es rechazado por la DB.
  - **Verify**: `docker compose exec -T postgres psql -U dsm -d dsm -c "INSERT INTO products (id,sku,name,price_ars_cents,stock,status,category_id) SELECT gen_random_uuid(),'X-NEG','x',-1,0,'draft',id FROM categories LIMIT 1;" 2>&1 | grep -qi 'violates check constraint'`
  - **Nota (ejecución 2026-07-15)**: la fila de prueba original omitía `category_id` (NOT NULL), por lo que Postgres reportaba el not-null antes de llegar al CHECK de precio. Corregido para proveer un `category_id` válido vía subquery; probado además que `products_stock_check`, `products_status_check` y el unique de SKU también rechazan.

## Fase 5: Puerta de CI de PR

- [x] T5.1 Crear `.github/workflows/ci.yml` con lint/typecheck/test + migración contra Postgres de servicio
  - **Exit criterion**: el workflow corre en `pull_request` y push a `main`; usa Node 22 + pnpm; levanta un servicio `pgvector/pgvector:pg16`; corre `pnpm -r lint`, `pnpm -r typecheck`, `pnpm --filter @dsm/db migrate:deploy` (o `migrate`) y `pnpm -r test`; no referencia ningún secreto de nube.
  - **Verify**: `grep -q 'pull_request' .github/workflows/ci.yml && grep -q 'pgvector/pgvector' .github/workflows/ci.yml && grep -q '@dsm/db' .github/workflows/ci.yml && ! grep -Eiq 'RAILWAY_TOKEN|NEON_|R2_|secrets\.(MP|GEMINI|RESEND)' .github/workflows/ci.yml`

- [x] T5.2 Validar el workflow con `act` o lint de YAML de Actions
  - **Exit criterion**: el YAML del workflow es sintácticamente válido y sus jobs resuelven.
  - **Verify**: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml'))"` (y, si `act` está disponible, `act pull_request -n` corre en dry-run sin error de parseo).

## Verificación (suite-level)

- [ ] Monorepo instala limpio: `pnpm install --frozen-lockfile`
- [ ] Dependencias locales arriba y healthy: `make up && docker compose ps | grep -c healthy` ≥ 2
- [ ] Esquema aplica y siembra limpio desde cero: `make down && make up && make migrate-local && make seed-local`
- [ ] CI de PR válida sintácticamente: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"`
- [ ] No hay secretos comiteados: `git grep -Ei '(sk_live|APP_USR-|AIza[A-Za-z0-9]{20})' -- . ':(exclude).env.example'` no devuelve nada (o solo placeholders documentados).
