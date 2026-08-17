---
parent-us: US-019
discipline: infrastructure
variant: platform-cloud
language: es
---

# US-019 Platform cloud — Tasks

> Cada task es closure-grade: `Exit criterion:` observable + `Verify:` con el comando exacto. Muchas verificaciones usan la Railway CLI (`railway`), la Neon CLI (`neonctl`) y `wrangler` (Cloudflare); donde no hay comando, el `Verify:` nombra el chequeo humano explícito en el dashboard.
>
> **Re-plan 2026-08-16 (local-first, decisión PO)**: el orden se reestructuró para que lo que vive en el repo (config-as-code + runbook) se ejecute PRIMERO sin credenciales de nube, y todo el provisioning cloud quede gated al final. Mapeo con el plan anterior: T0.1 ← ex-T2.1, T0.2 ← ex-T5.1, T2.1 ← ex-T2.2; el ex-T2.3 (DNS custom) pasa a deferral documentado. Backup del plan previo en `openspec/changes/_backups/2026-08-16-US-019-provision-plataforma-cloud-infrastructure/`.

## Fase 0: Local-first — artefactos en el repo (sin credenciales de nube)

- [x] T0.1 Añadir config-as-code Railway por servicio (`apps/web`, `apps/api`) — sin Terraform
  - **AS-BUILT 2026-08-16**: contexto de build = **raíz del workspace pnpm** (`@dsm/api` depende de `@dsm/db`, así que el build corre `pnpm --filter @dsm/db generate` antes de `nest build`); en Railway se setea root directory = repo root y config path = `apps/{api,web}/railway.json`. `apps/web` queda **sin `healthcheckPath`**: no existe ruta de health en la app Next.js y no se inventa una (aplica el chequeo TCP por defecto de Railway) — si FE agrega `/api/health`, se wirea acá. `startCommand` usa `nest start`/`next start` tal como el plan lo autoriza; el arranque prod-grade (`node dist/main`) es refinamiento de `/plan-deployment`.
  - **Exit criterion**: `apps/api/railway.json` y `apps/web/railway.json` existen con build/start/healthcheck/restart tomados del AS-BUILT (api: `nest build`/`nest start` + healthcheck `/health` ya implementado en `apps/api/src/health/`; web: `next build`/`next start`); no hay ningún `.tf` en el repo (fuera de `spekode/`). `apps/worker` NO lleva config todavía — **Deferred: US-005** (la app worker es solo README; su `railway.json` se autoriza cuando BE la scaffoldee).
  - **Verify**: `python3 -c "import json; json.load(open('apps/api/railway.json')); json.load(open('apps/web/railway.json'))" && grep -q '"healthcheckPath"' apps/api/railway.json && ! find . -name '*.tf' -not -path './spekode/*' -not -path './node_modules/*' | grep -q .`

- [ ] T0.2 Redactar el esqueleto del runbook del servicio (obligatorio — operations-standards)
  - **Exit criterion**: existe `docs/services/dsm-ecommerce/runbook.md` con secciones deploy/rollback, restore Neon PITR (RTO ≤ 4h), rotación de secretos, cola BullMQ atascada, webhook MP, app caída, y SLO 99.5% + salud vigilada (fuente E2E §18.5).
  - **Verify**: `test -f docs/services/dsm-ecommerce/runbook.md && for s in 'Rollback' 'Restore' 'Rotar secretos' 'BullMQ' 'webhook' 'SLO'; do grep -qi "$s" docs/services/dsm-ecommerce/runbook.md || exit 1; done`

## Gates externos (bloquean SOLO las fases cloud 1–4 — se resuelven al final, enfoque local-first)

- [ ] Cuentas creadas con billing en ARS resuelto. *(Estado 2026-08-16: **Cloudflare ✓, Neon ✓** creadas; **Railway y Sentry pendientes** de crear.)*
- [x] **Q-3 resuelta** (2026-07-15): región **US-East** + consentimiento informado en registro/política de privacidad (US-017).
- [x] **Q-2 resuelta** (2026-07-15): **free tiers primero** — staging en Neon Free (`pgvector`+HNSW incluidos; restore mínimo y autosuspend aceptados) + Railway; upgrade a plan pago (PITR real) es gate previo al primer deploy productivo, verificado por `/plan-deployment`.
- [x] Change gemelo `US-001-admin-catalogo-productos-bootstrap-local-infrastructure` mergeado (aporta `packages/db` con las migraciones que la Fase 3 aplica a la nube). *(Verificado 2026-08-16: archivado el 2026-08-09 en `openspec/changes/archive/`; `packages/db` presente en el branch de entrega.)*
- [ ] Railway CLI (`railway`), Neon CLI (`neonctl`) y `wrangler` instaladas y autenticadas. *(2026-08-16: instaladas — railway 5.41.2, neonctl 3.4.0, wrangler 4.123.0 — pero **sin autenticar**: `railway login` / `neonctl auth` / `wrangler login` pendientes del usuario.)*

## Fase 1: Provisioning de la plataforma (cloud — gated)

- [ ] T1.1 Crear el proyecto Railway con entornos `staging` y `production`
  - **Exit criterion**: existe un proyecto Railway con ambos entornos.
  - **Verify**: `railway environment` lista `staging` y `production` para el proyecto vinculado (`railway status` muestra el proyecto).

- [ ] T1.2 Crear los servicios `web`, `api`, `worker` en el proyecto Railway
  - **Exit criterion**: los tres servicios existen en el proyecto (aún sin build — las apps las scaffoldea BE/FE; `web`/`api` toman el `railway.json` de T0.1, `worker` queda vacío hasta US-005).
  - **Verify**: `railway service list` (o dashboard) muestra `web`, `api`, `worker`. Chequeo humano si la CLI no lista: dashboard → proyecto → 3 servicios visibles.

- [ ] T1.3 Añadir el add-on gestionado Redis
  - **Exit criterion**: el plugin Redis está aprovisionado y expone `REDIS_URL`.
  - **Verify**: `railway variables --service redis` (o dashboard) muestra la connection string del Redis gestionado.

- [ ] T1.4 Aprovisionar Neon PostgreSQL con `pgvector` en US-East (free tier para staging)
  - **Exit criterion**: existe una base Neon con la extensión `vector` disponible, en US-East (Q-3). Free tier aceptado para staging (Q-2); PITR llega con el upgrade pre-prod.
  - **Verify**: `neonctl projects list` muestra el proyecto en la región US-East; `psql "$NEON_STAGING_URL" -c "CREATE EXTENSION IF NOT EXISTS vector; SELECT extname FROM pg_extension WHERE extname='vector';"` devuelve `vector`.

- [ ] T1.5 Crear el bucket Cloudflare R2 para imágenes de productos
  - **Exit criterion**: existe un bucket R2 `dsm-product-images` (staging + production o prefijos por entorno).
  - **Verify**: `wrangler r2 bucket list` incluye `dsm-product-images` (o chequeo humano en el dashboard de Cloudflare R2).

## Fase 2: Secretos y dominio (cloud — gated)

- [ ] T2.1 Cargar los secretos de este change como Railway service variables (por entorno)
  - **Exit criterion**: `DATABASE_URL` (Neon), `REDIS_URL` y `SENTRY_DSN` están seteadas en Railway para `staging`; los slots `JWT_SECRET`, `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `GEMINI_API_KEY`, `RESEND_API_KEY` existen (placeholder, los cargan sus US).
  - **Verify**: `railway variables --environment staging` lista `DATABASE_URL`, `REDIS_URL`, `SENTRY_DSN`; y `git grep -Ei 'postgres://[^ ]*:[^ ]*@|redis://[^ ]*:[^ ]*@|SENTRY_DSN=https' -- . ':(exclude).env.example'` NO devuelve secretos reales comiteados.

- [ ] T2.2 Dominio custom + DNS Cloudflare + TLS — **Deferred: /plan-deployment** (decisión PO 2026-08-16: no hay dominio aún)
  - **Exit criterion**: los servicios exponen sus subdominios Railway (`*.up.railway.app`) con TLS de Railway; el CNAME en Cloudflare hacia el dominio custom queda **diferido** hasta que exista dominio (se registra/delega antes del primer deploy productivo; lo verifica `/plan-deployment`). Deferral documentado — no es un drop silencioso.
  - **Verify**: chequeo humano — dashboard Railway muestra dominio `*.up.railway.app` con TLS activo por servicio; este task se marca `[x]` con esa evidencia y la anotación del deferral.

## Fase 3: Aplicar el esquema a la nube (staging — gated)

- [ ] T3.1 Aplicar las migraciones de `packages/db` contra el Neon de staging
  - **Exit criterion**: el esquema del catálogo (`categories`, `products`, extensión `vector`) existe en Neon staging, idéntico al validado en local (paridad AS-BUILT: `products` con 8 columnas).
  - **Verify**: `DATABASE_URL="$NEON_STAGING_URL" pnpm --filter @dsm/db migrate:deploy && psql "$NEON_STAGING_URL" -c "\dt" | grep -Eq 'products|categories' && psql "$NEON_STAGING_URL" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='products'" | grep -qx 8`

- [ ] T3.2 Confirmar constraints e índices en la nube (paridad con local)
  - **Exit criterion**: en Neon staging, `products.sku` es UNIQUE (`products_sku_key`), existen los CHECK `products_price_check`/`products_stock_check`/`products_status_check` y el índice `products_category_id_status_idx`.
  - **Verify**: `psql "$NEON_STAGING_URL" -c "\d products" | grep -q 'products_sku_key' && psql "$NEON_STAGING_URL" -tAc "SELECT conname FROM pg_constraint WHERE conrelid='products'::regclass AND contype='c';" | grep -Eq 'products_(price|stock|status)_check' && psql "$NEON_STAGING_URL" -c "\d products" | grep -q 'products_category_id_status_idx'`

## Fase 4: Autodeploy y observabilidad (cloud — gated)

- [ ] T4.1 Conectar la integración GitHub de Railway con el mapeo rama → entorno
  - **Exit criterion**: `main` está mapeado a production y `staging` a staging; el gate de CI (workflow `ci.yml` de `bootstrap-local`) es requisito antes del deploy.
  - **Verify**: chequeo humano — Railway → Settings → GitHub: `main`→production, `staging`→staging; GitHub → branch protection de `main` requiere el check `CI`. (La prueba extremo-a-extremo del autodeploy es de `/plan-deployment`.)

- [ ] T4.2 Crear los proyectos Sentry (web/api/worker) y wire de `SENTRY_DSN`
  - **Exit criterion**: existen 3 proyectos Sentry; sus DSN están en Railway variables por servicio.
  - **Verify**: `railway variables --environment staging | grep -q SENTRY_DSN` (uno por servicio); chequeo humano: 3 proyectos visibles en Sentry.

- [ ] T4.3 Configurar la alerta base de spike de errores (Sentry → email/Slack) con runbook
  - **Exit criterion**: existe una regla de alerta de Sentry que notifica ante un pico de errores, apuntando al runbook.
  - **Verify**: chequeo humano — Sentry → Alerts: regla activa; su descripción/link referencia `docs/services/dsm-ecommerce/runbook.md`.

## Verificación (suite-level)

- [ ] Sin Terraform en el repo (anti-pattern del baseline): `! find . -name '*.tf' -not -path './spekode/*' -not -path './node_modules/*' | grep -q .`
- [ ] Sin secretos comiteados: `git grep -Ei 'postgres://[^ ]*:[^ ]*@|APP_USR-|AIza[A-Za-z0-9]{20}|sk_live' -- . ':(exclude).env.example'` no devuelve nada.
- [ ] Config Railway válida en repo: `python3 -c "import json; json.load(open('apps/api/railway.json')); json.load(open('apps/web/railway.json'))"`.
- [ ] Runbook presente: `test -f docs/services/dsm-ecommerce/runbook.md`.
- [ ] `pgvector` disponible en Neon (cloud — gated): `psql "$NEON_STAGING_URL" -tAc "SELECT 1 FROM pg_extension WHERE extname='vector'"` devuelve `1`.
- [ ] Esquema en la nube = esquema local (cloud — gated; 8 columnas en products): `psql "$NEON_STAGING_URL" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='products'"` = `8`.
