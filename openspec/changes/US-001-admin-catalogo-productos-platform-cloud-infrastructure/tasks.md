---
parent-us: US-001
discipline: infrastructure
language: es
---

# US-001 Platform cloud — Tasks

> Cada task es closure-grade: `Exit criterion:` observable + `Verify:` con el comando exacto. Muchas verificaciones usan la Railway CLI (`railway`) y la Neon CLI (`neonctl`); donde no hay comando, el `Verify:` nombra el chequeo humano explícito en el dashboard.

## Pre-requisitos (gates externos — este change no arranca sin ellos)
- [ ] Cuentas creadas: Railway, Neon, Cloudflare (con billing en ARS resuelto).
- [ ] **Q-3 resuelta**: región definida (default US-East salvo que Ley 25.326 exija AR).
- [ ] **Q-2 resuelta**: planes Neon/Railway confirmados con `pgvector`+HNSW y PITR.
- [ ] Change gemelo `US-001-admin-catalogo-productos-bootstrap-local-infrastructure` mergeado (aporta `packages/db` con las migraciones que la Fase 3 aplica a la nube).
- [ ] Railway CLI (`railway`) y Neon CLI (`neonctl`) instaladas y autenticadas.

## Fase 1: Provisioning de la plataforma

- [ ] T1.1 Crear el proyecto Railway con entornos `staging` y `production`
  - **Exit criterion**: existe un proyecto Railway con ambos entornos.
  - **Verify**: `railway environment` lista `staging` y `production` para el proyecto vinculado (`railway status` muestra el proyecto).

- [ ] T1.2 Crear los servicios `web`, `api`, `worker` en el proyecto Railway
  - **Exit criterion**: los tres servicios existen en el proyecto (aún sin build — las apps las scaffoldea BE/FE).
  - **Verify**: `railway service list` (o dashboard) muestra `web`, `api`, `worker`. Chequeo humano si la CLI no lista: dashboard → proyecto → 3 servicios visibles.

- [ ] T1.3 Añadir el add-on gestionado Redis
  - **Exit criterion**: el plugin Redis está aprovisionado y expone `REDIS_URL`.
  - **Verify**: `railway variables --service redis` (o dashboard) muestra la connection string del Redis gestionado.

- [ ] T1.4 Aprovisionar Neon PostgreSQL con `pgvector` en la región definida
  - **Exit criterion**: existe una base Neon con la extensión `vector` disponible y PITR habilitado, en la región de Q-3.
  - **Verify**: `neonctl projects list` muestra el proyecto en la región correcta; `psql "$NEON_DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS vector; SELECT extname FROM pg_extension WHERE extname='vector';"` devuelve `vector`.

- [ ] T1.5 Crear el bucket Cloudflare R2 para imágenes de productos
  - **Exit criterion**: existe un bucket R2 `dsm-product-images` (staging + production o prefijos por entorno).
  - **Verify**: `wrangler r2 bucket list` incluye `dsm-product-images` (o chequeo humano en el dashboard de Cloudflare R2).

## Fase 2: Config como código, secretos y DNS/TLS

- [ ] T2.1 Añadir `railway.json`/`railway.toml` por servicio en el repo (sin Terraform)
  - **Exit criterion**: cada servicio tiene su config de build/start/healthcheck/restart en el repo; no hay ningún `.tf` en el repo.
  - **Verify**: `test -f railway.json -o -f railway.toml` y `! find . -name '*.tf' -not -path './spekode/*' | grep -q .`

- [ ] T2.2 Cargar los secretos de este change como Railway service variables (por entorno)
  - **Exit criterion**: `DATABASE_URL` (Neon), `REDIS_URL` y `SENTRY_DSN` están seteadas en Railway para `staging`; los slots `JWT_SECRET`, `MP_ACCESS_TOKEN`, `GEMINI_API_KEY`, `RESEND_API_KEY` existen (placeholder, los cargan sus US).
  - **Verify**: `railway variables --environment staging` lista `DATABASE_URL`, `REDIS_URL`, `SENTRY_DSN`; y `git grep -Ei 'postgres://|redis://|SENTRY_DSN=https' -- . ':(exclude).env.example'` NO devuelve secretos reales comiteados.

- [ ] T2.3 Configurar DNS en Cloudflare hacia el dominio Railway con TLS automático
  - **Exit criterion**: el CNAME del dominio custom apunta al dominio Railway; TLS activo (cert gestionado).
  - **Verify**: `dig +short CNAME <dominio> | grep -q railway` y `curl -sI https://<dominio> | grep -q '200\|301\|302'` (una vez haya app; si aún placeholder, chequeo humano: Cloudflare DNS muestra el CNAME y Railway muestra el dominio custom con TLS "issued").

## Fase 3: Aplicar el esquema a la nube (staging)

- [ ] T3.1 Aplicar las migraciones de `packages/db` contra el Neon de staging
  - **Exit criterion**: el esquema del catálogo (`categories`, `products`, extensión `vector`) existe en Neon staging, idéntico al validado en local.
  - **Verify**: `DATABASE_URL="$NEON_STAGING_URL" pnpm --filter @dsm/db migrate:deploy && psql "$NEON_STAGING_URL" -c "\dt" | grep -Eq 'products|categories'`

- [ ] T3.2 Confirmar constraints e índices en la nube (paridad con local)
  - **Exit criterion**: en Neon staging, `products.sku` es UNIQUE, existen los CHECK de `price_ars_cents`/`stock`/`status` y el índice `(category_id, status)`.
  - **Verify**: `psql "$NEON_STAGING_URL" -c "\d products" | grep -q 'products_sku_key' && psql "$NEON_STAGING_URL" -c "SELECT conname FROM pg_constraint WHERE conrelid='products'::regclass AND contype='c';" | grep -Eiq 'price|stock|status'`

## Fase 4: Autodeploy y observabilidad

- [ ] T4.1 Conectar la integración GitHub de Railway con el mapeo rama → entorno
  - **Exit criterion**: `main` está mapeado a production y `staging` a staging; el gate de CI (workflow de `bootstrap-local`) es requisito antes del deploy.
  - **Verify**: chequeo humano — Railway → Settings → GitHub: `main`→production, `staging`→staging; GitHub → branch protection de `main` requiere el check `ci`. (La prueba extremo-a-extremo del autodeploy es de `/plan-deployment`.)

- [ ] T4.2 Crear los proyectos Sentry (web/api/worker) y wire de `SENTRY_DSN`
  - **Exit criterion**: existen 3 proyectos Sentry; sus DSN están en Railway variables por servicio.
  - **Verify**: `railway variables --environment staging | grep -q SENTRY_DSN` (uno por servicio); chequeo humano: 3 proyectos visibles en Sentry.

- [ ] T4.3 Configurar la alerta base de spike de errores (Sentry → email/Slack) con runbook
  - **Exit criterion**: existe una regla de alerta de Sentry que notifica ante un pico de errores, apuntando al runbook.
  - **Verify**: chequeo humano — Sentry → Alerts: regla activa; su descripción/link referencia `docs/services/dsm-ecommerce/runbook.md`.

## Fase 5: Runbook del servicio nuevo (obligatorio — operations-standards)

- [ ] T5.1 Redactar el esqueleto del runbook del servicio
  - **Exit criterion**: existe `docs/services/dsm-ecommerce/runbook.md` con secciones deploy/rollback, restore Neon PITR (RTO ≤ 4h), rotación de secretos, cola BullMQ atascada, webhook MP, app caída, y SLO 99.5% + salud vigilada (fuente E2E §18.5).
  - **Verify**: `test -f docs/services/dsm-ecommerce/runbook.md && for s in 'Rollback' 'Restore' 'Rotar secretos' 'BullMQ' 'webhook' 'SLO'; do grep -qi "$s" docs/services/dsm-ecommerce/runbook.md || exit 1; done`

## Verificación (suite-level)

- [ ] Sin Terraform en el repo (anti-pattern del baseline): `! find . -name '*.tf' -not -path './spekode/*' | grep -q .`
- [ ] Sin secretos comiteados: `git grep -Ei 'postgres://[^ ]*:[^ ]*@|APP_USR-|AIza[A-Za-z0-9]{20}|sk_live' -- . ':(exclude).env.example'` no devuelve nada.
- [ ] `pgvector` disponible en Neon: `psql "$NEON_STAGING_URL" -tAc "SELECT 1 FROM pg_extension WHERE extname='vector'"` devuelve `1`.
- [ ] Esquema en la nube = esquema local: `psql "$NEON_STAGING_URL" -c "\dt" | grep -Eq 'products|categories'`.
- [ ] Runbook presente: `test -f docs/services/dsm-ecommerce/runbook.md`.
