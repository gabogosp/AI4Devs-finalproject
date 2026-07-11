# US-001 Admin catálogo de productos — Infraestructura · Tasks

> **Idioma**: contenido en español (`language: es`); etiquetas `Exit criterion:` / `Verify:` en inglés (contrato tooling — `/develop-infrastructure` las parsea).
> **Baseline**: `railway` — **sin Terraform**. Config en `railway.json` + plugins.
> **Greenfield**: Fase 0 va primero (baseline §0). Validación de migraciones **local-first** contra el Postgres del docker-compose; Neon staging es confirmación posterior.
> **Ejecuta**: `/develop-infrastructure US-001`. Cada task corre su `Verify:` antes de marcarse done.

## Pre-requisites
- [ ] E2E `Approved` (✅ 2026-06-15) y ADR-0001/0002/0004 `Accepted` (✅).
- [ ] Rama `feat/US-001-admin-catalogo-productos-infra` creada (per `git-workflow-standards.md`).
- [ ] Docker + Docker Compose disponibles localmente (para Fase 0/1, cero credenciales de nube).

---

## Phase 0: Bootstrap local-first (antes de cualquier nube — baseline §0)

- [ ] **T0.1** Crear la estructura de monorepo con placeholders
  - Estructura: `apps/api/`, `apps/web/`, `apps/worker/`, `packages/db/`, `packages/config/`, cada uno con `.gitkeep` + `README.md` placeholder que indica qué disciplina scaffoldea ahí (`nest new` para api/worker → BE; `create-next-app` para web → FE). **INFRA NO scaffoldea los frameworks.**
  - **Exit criterion**: los 5 directorios existen con placeholder; el `README.md` de `apps/api`, `apps/web`, `apps/worker` dice explícitamente "scaffold por {disciplina} en su primer ticket".
  - **Verify**: `test -f apps/api/README.md && test -f apps/web/README.md && test -f apps/worker/README.md && test -f packages/db/.gitkeep && echo OK`

- [ ] **T0.2** Crear `docker-compose.yml` con Postgres+pgvector y Redis (imágenes pinneadas, healthchecks, volúmenes)
  - `postgres`: imagen `pgvector/pgvector:pg16`, healthcheck `pg_isready`, volumen nombrado, `5432`. `redis`: imagen `redis:7-alpine`, healthcheck `redis-cli ping`, volumen nombrado, `6379`.
  - **Exit criterion**: `docker compose up -d` levanta ambos servicios healthy desde un checkout limpio.
  - **Verify**: `docker compose up -d && sleep 8 && docker compose ps --format '{{.Name}} {{.Health}}' | grep -c healthy | grep -q 2 && echo OK`

- [ ] **T0.3** Crear `.env.example` (placeholders, sin secretos) y `.gitignore` para `.env.local`
  - Vars: `DATABASE_URL`, `SHADOW_DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `NODE_ENV`, `PORT`; comentadas para US futuras: `MP_*`, `GEMINI_API_KEY`, `RESEND_API_KEY`, `R2_*`, `SENTRY_DSN`. `.env.local` en `.gitignore`.
  - **Exit criterion**: `.env.example` tiene todas las vars con placeholders; `.env.local` está gitignored; ningún secreto real en git.
  - **Verify**: `grep -q '^DATABASE_URL=' .env.example && grep -q '.env.local' .gitignore && gitleaks detect --source . --no-git --redact` — 0 leaks.

- [ ] **T0.4** Crear `Makefile` con targets `up`, `down`, `migrate-local`, `run-local`, `seed-local`, `db-reset`
  - **Exit criterion**: `make up` levanta las deps; `make down` las baja; los targets existen y no fallan por sintaxis.
  - **Verify**: `make -n up && make -n down && make -n migrate-local && make -n seed-local && echo OK`

- [ ] **T0.5** Inicializar el toolchain Prisma en `packages/db/` apuntando al Postgres del compose
  - `packages/db/prisma/schema.prisma` con `datasource db` (`DATABASE_URL`), `generator client`, `provider = "postgresql"`. `DATABASE_URL` local apunta al compose PG.
  - **Exit criterion**: `prisma validate` pasa contra el `schema.prisma` inicial (vacío de modelos aún).
  - **Verify**: `cd packages/db && npx prisma validate` — "The schema at prisma/schema.prisma is valid".

---

## Phase 1: Esquema del catálogo (persistence — E2E §8, local-first)

- [ ] **T1.1** Definir el modelo `Category` en `schema.prisma` (id, name, slug UK, parent_id self-FK, timestamps)
  - Fiel a E2E §8: `slug @unique`, `parentId` self-relation nullable ("CategoryTree"), `@@index([parentId])`, `@@map("categories")`.
  - **Exit criterion**: `prisma validate` pasa con el modelo `Category`; la self-relation compila.
  - **Verify**: `cd packages/db && npx prisma validate` — schema válido con model Category.

- [ ] **T1.2** Definir el enum `ProductStatus` + modelo `Product` (sku UK, price_ars_cents, stock, category FK, status default draft, índice compuesto)
  - Fiel a E2E §8: `sku @unique` (AC-9), `priceArsCents Int`, `stock Int`, `status @default(draft)` (AC-2), `@@index([categoryId, status])`, `@@map("products")`, enum `draft|published|archived`.
  - **Exit criterion**: `prisma validate` pasa con `Product` + enum + relación a `Category`.
  - **Verify**: `cd packages/db && npx prisma validate` — schema válido con model Product y enum ProductStatus.

- [ ] **T1.3** Generar la primera migración y añadir los CHECK de negocio + `CREATE EXTENSION vector` en el SQL
  - `prisma migrate dev --name init_catalog` genera la migración; editar el SQL para añadir `CHECK (price_ars_cents > 0)` (AC-5), `CHECK (stock >= 0)` (AC-5) y `CREATE EXTENSION IF NOT EXISTS vector;` (para US-005, sin columna vector aún).
  - **Exit criterion**: la migración aplica limpia contra el compose PG; las tablas `categories` y `products`, la extensión `vector` y los 2 CHECK existen.
  - **Verify**: `make up && cd packages/db && npx prisma migrate reset --force --skip-seed && psql "$DATABASE_URL" -c "\dt" | grep -qE 'categories|products' && psql "$DATABASE_URL" -c "SELECT conname FROM pg_constraint WHERE conname IN ('products_price_positive','products_stock_nonneg');" | grep -qc 2 && psql "$DATABASE_URL" -c "SELECT extname FROM pg_extension WHERE extname='vector';" | grep -q vector && echo OK`

- [ ] **T1.4** Verificar los constraints de negocio con inserts negativos (AC-5, AC-9)
  - Probar que `price_ars_cents <= 0`, `stock < 0` y SKU duplicado son rechazados por la DB.
  - **Exit criterion**: los 3 inserts inválidos fallan; un insert válido pasa.
  - **Verify**: `psql "$DATABASE_URL" -c "INSERT INTO categories (id,name,slug) VALUES (gen_random_uuid(),'X','x');" && ! psql "$DATABASE_URL" -c "INSERT INTO products (id,sku,name,price_ars_cents,stock,category_id,status) SELECT gen_random_uuid(),'S1','p',0,1,id,'draft' FROM categories LIMIT 1;" && ! psql "$DATABASE_URL" -c "INSERT INTO products (id,sku,name,price_ars_cents,stock,category_id,status) SELECT gen_random_uuid(),'S2','p',100,-1,id,'draft' FROM categories LIMIT 1;" && echo OK-constraints-reject-invalid`

- [ ] **T1.5** Crear `seed-local` con datos de ejemplo (categoría + producto en cada estado) y `packages/db/README.md` con el contrato de snapshot de precio (AC-10) y no-cascade (AC-7)
  - Seed: 1 categoría "Refrigeración" + 3 productos (draft/published/archived). README documenta: `order_items.unit_price_ars_cents` es snapshot al momento de la orden (AC-10); `order_items.product_id` **sin** `ON DELETE CASCADE`; archivar = `status='archived'` no `DELETE` (AC-7). (`order_items` es US futura — solo se documenta el contrato.)
  - **Exit criterion**: `make seed-local` inserta los datos; el README contiene las 3 reglas de contrato.
  - **Verify**: `make seed-local && psql "$DATABASE_URL" -c "SELECT count(*) FROM products;" | grep -q 3 && grep -qi 'unit_price_ars_cents' packages/db/README.md && grep -qi 'ON DELETE CASCADE' packages/db/README.md && echo OK`

- [ ] **T1.6** Verificar el índice de listado `(category_id, status)` (NFR §9: listado sin degradación ≥5.000 SKUs)
  - **Exit criterion**: el índice `products_category_id_status_idx` existe y una query de listado por categoría+estado lo usa (index scan, no seq scan) con datos.
  - **Verify**: `psql "$DATABASE_URL" -c "SELECT indexname FROM pg_indexes WHERE tablename='products';" | grep -q 'category_id_status' && echo OK`

---

## Phase 2: Provisioning en la nube (Railway + Neon + R2 — E2E §13)

> **Bloqueado por open questions #1 (residencia AR) y #2 (plan Neon/pgvector)** para *producción*. Staging puede proceder con default US-East.

- [ ] **T2.1** Crear `railway.json` en el repo con la config de build/deploy (sin Terraform)
  - Definir servicios `api`, `web`, `worker` (build Nixpacks/Dockerfile, start command, healthcheck path), branch-per-environment (`main`→production, `staging`→staging).
  - **Exit criterion**: `railway.json` es JSON válido y declara los 3 servicios + el mapeo de environments.
  - **Verify**: `node -e "const c=require('./railway.json'); if(!c) process.exit(1)" && python3 -c "import json;json.load(open('railway.json'))" && echo OK`

- [ ] **T2.2** Provisionar el proyecto Railway con environments `staging` + `production` y el plugin Redis
  - **Exit criterion**: proyecto Railway existe con ambos environments; plugin Redis provisto en staging; `REDIS_URL` disponible como variable.
  - **Verify**: `railway status` muestra el proyecto y los environments; `railway variables --environment staging | grep -q REDIS_URL` → OK. (Requiere `railway login`.)

- [ ] **T2.3** Provisionar Neon Postgres (US-East default) con `pgvector` habilitado + PITR/snapshots diarios
  - **Exit criterion**: DB Neon `available`; extensión `vector` habilitada; backups diarios/PITR configurados (RPO ≤ 24h per E2E §17).
  - **Verify**: `psql "$NEON_DATABASE_URL" -c "SELECT extname FROM pg_extension WHERE extname='vector';" | grep -q vector` — y consola/CLI Neon confirma PITR habilitado.

- [ ] **T2.4** Aplicar las migraciones del catálogo en Neon staging (confirmación posterior a la validación local)
  - **Exit criterion**: `categories`, `products`, los CHECK y la extensión existen en Neon staging idénticos al local.
  - **Verify**: `DATABASE_URL="$NEON_STAGING_URL" npx prisma migrate deploy && psql "$NEON_STAGING_URL" -c "\dt" | grep -qE 'categories|products' && echo OK`

- [ ] **T2.5** Provisionar el bucket Cloudflare R2 para imágenes + DNS (CNAME → dominio Railway) + TLS
  - Bucket `dsm-product-images-staging` (privado); CNAME del dominio → Railway; TLS auto.
  - **Exit criterion**: bucket R2 existe (privado); el dominio resuelve por HTTPS al servicio web de Railway.
  - **Verify**: `aws s3api head-bucket --bucket dsm-product-images-staging --endpoint-url "$R2_ENDPOINT"` → 0; `curl -sI https://<dominio-staging> | grep -q '200\|301\|302'` → OK.

- [ ] **T2.6** Cargar los secrets como variables de Railway (nunca en git) para staging
  - `DATABASE_URL` (Neon, sslmode=require), `REDIS_URL`, `JWT_SECRET`, `R2_*`, placeholders para `MP_*`/`GEMINI_API_KEY`/`RESEND_API_KEY`/`SENTRY_DSN` (US futuras).
  - **Exit criterion**: las variables existen en el environment `staging` de Railway; ningún secreto en el repo.
  - **Verify**: `railway variables --environment staging | grep -qE 'DATABASE_URL|JWT_SECRET' && gitleaks detect --source . --no-git --redact` — 0 leaks.

---

## Phase 3: CI/CD + observabilidad (E2E §16/§18) + runbook

- [ ] **T3.1** Crear el workflow GitHub Actions `ci.yml` (install → lint → typecheck → test → SonarCloud gate) con actions pinneadas por SHA
  - Corre en PR y push; gate **antes** del autodeploy de Railway. Actions pinneadas por SHA (`security-standards.md` §9).
  - **Exit criterion**: `.github/workflows/ci.yml` es YAML válido; todas las `uses:` referencian un SHA (no un tag flotante).
  - **Verify**: `python3 -c "import yaml;yaml.safe_load(open('.github/workflows/ci.yml'))" && ! grep -E 'uses:.*@(v[0-9]|main|master)$' .github/workflows/ci.yml && echo OK`

- [ ] **T3.2** Configurar el autodeploy de Railway por environment (main→production, staging→staging)
  - **Exit criterion**: un push a `staging` dispara un deploy en el environment staging de Railway.
  - **Verify**: push de prueba a `staging` → `railway deployments --environment staging` muestra un deployment nuevo con estado `SUCCESS`.

- [ ] **T3.3** Wirear Sentry (proyecto FE + BE) + logging estructurado `pino` → Railway logs
  - `SENTRY_DSN` como variable Railway; config base de pino JSON. (La instrumentación en el código de app es de BE/FE; INFRA entrega el sink + config.)
  - **Exit criterion**: proyecto Sentry existe; `SENTRY_DSN` disponible como variable; la config base de pino está en `packages/config`.
  - **Verify**: `railway variables --environment staging | grep -q SENTRY_DSN && test -f packages/config/logger.* && echo OK`

- [ ] **T3.4** Definir el contrato de eventos de negocio `product.created|published|archived` (dimensiones, sin PII)
  - Documento del contrato (dimensiones `product_id` pseudónimo, `category_id`, `status`, `actor_role`; **sin PII** per `observability-standards.md` §9). La **emisión** la hace BE-US-001 — acá se define el contrato + estructura del log.
  - **Exit criterion**: existe `docs/services/dsm-platform/business-events.md` con los 3 eventos, sus dimensiones y la nota de PII.
  - **Verify**: `grep -c 'product\.' docs/services/dsm-platform/business-events.md | grep -q 3 && grep -qi 'sin PII\|no PII' docs/services/dsm-platform/business-events.md && echo OK`

- [ ] **T3.5** Draftear el runbook del servicio nuevo (obligación `operations-standards.md`)
  - `docs/services/dsm-platform/runbook.md`: restore Neon (PITR, RTO ≤ 4h), deploy/rollback (redeploy commit verde), rotación de secrets (variables Railway), SLO 99.5% / p95 300ms lectura / 500ms escritura. Base en E2E §18.5.
  - **Exit criterion**: el runbook existe con secciones de restore, deploy/rollback, rotación de secrets y SLO.
  - **Verify**: `test -f docs/services/dsm-platform/runbook.md && grep -qiE 'restore|rollback|secret|SLO' docs/services/dsm-platform/runbook.md && echo OK`

---

## Verification (suite-level)

- [ ] Fase 0 corre desde checkout limpio: `make up && make migrate-local && make seed-local` — sin errores.
- [ ] Migraciones validadas local-first (compose PG) **antes** de tocar Neon: T1.3–T1.6 verdes.
- [ ] Constraints de negocio (AC-5, AC-9) rechazan inputs inválidos a nivel DB: T1.4 verde.
- [ ] Sin secretos en git: `gitleaks detect --source . --no-git --redact` — 0 leaks.
- [ ] `railway.json` válido y actions CI pinneadas por SHA: T2.1 + T3.1 verdes.
- [ ] Runbook + contrato de eventos de negocio presentes: T3.4 + T3.5 verdes.

---

## Cross-references (no ejecuta INFRA — para el equipo)

- **BE-US-001**: `nest new` en `apps/api` (y `apps/worker`); hereda `packages/db/schema.prisma`; implementa CRUD + guards admin (AC-8) + emisión de eventos de negocio (contrato T3.4).
- **FE-US-001**: `create-next-app` en `apps/web`; panel del dueño.
- **US futuras (órdenes)**: respetar el contrato de snapshot de precio (T1.5 / `packages/db/README.md`) para AC-10 y el no-cascade para AC-7.
