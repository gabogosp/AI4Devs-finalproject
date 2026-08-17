---
parent-us: US-019
discipline: infrastructure
variant: platform-cloud
language: es
---

# US-019 Platform cloud — Tasks

> Cada task es closure-grade: `Exit criterion:` observable + `Verify:` con el comando exacto. Muchas verificaciones usan la Railway CLI (`railway`), la Neon CLI (`neonctl`) y `wrangler` (Cloudflare); donde no hay comando, el `Verify:` nombra el chequeo humano explícito en el dashboard.
>
> **Re-plan 2026-08-17c (`--regenerate`, paridad por catálogo + `psql` del contenedor)**: dos correcciones sobre 08-17b, ambas de falsos-rojos latentes. (1) **T3.2 lee el catálogo, no el texto de las migraciones** — derivar la lista esperada por `grep` de los `migration.sql` asumía que las migraciones sólo agregan; un `DROP CONSTRAINT`/`DROP INDEX`/`RENAME` futuro habría exigido en la nube un objeto eliminado a propósito (hallazgo de la sesión de backend). Ahora compara el catálogo de la base local migrada contra el de Neon, que refleja el estado **neto**. (2) **No hay `psql` en el host** — los `Verify:` que lo usaban (T1.4, T3.2, check de `pgvector`) habrían fallado por binario ausente; van por `docker compose exec -T postgres psql`. La forma del comando de T3.2 se validó en vivo contra la base local (exit 0).
>
> **Re-plan 2026-08-17b (`--regenerate`, paridad de esquema dinámica)**: T3.1/T3.2 y el check suite-level afirmaban **8 columnas** en `products` — el AS-BUILT de US-001. El esquema autorizado en `packages/db` ya tiene **12** (US-003 sumó `description_raw`/`image_url`/`updated_at` en `20260716230030` y `slug` en `20260816120000`) más el índice `products_slug_key`, así que esas aserciones habrían dado rojo por obsolescencia, no por un problema real. Se reemplazó el número fijo por una comparación **dinámica contra `schema.prisma`** (`prisma migrate diff --exit-code`) + una lista de CHECK/índices **derivada de las migraciones** (lo que `migrate diff` no ve). Ground truth confirmado contra la base local por la sesión de backend: 12 columnas, `products_pkey`/`products_sku_key`/`products_slug_key`/`products_category_id_status_idx`, FK `products_category_id_fkey`, 3 CHECK, 0 slugs nulos ni duplicados.
>
> **Re-plan 2026-08-17 (`--regenerate`, corrección de `Verify:` defectuoso)**: dos `Verify:` basados en `git grep` (T2.1 y el check suite-level de secretos) se matcheaban a sí mismos y no podían dar verde nunca; se les añadió `':(exclude)*.md'` al pathspec. Gap de framework registrado como **F57**. Las tasks ya cerradas (T0.1, T0.2) conservan su estado y su AS-BUILT. Backup: `openspec/changes/_backups/2026-08-17-US-019-…/`.
>
> **Re-plan 2026-08-16 (local-first, decisión PO)**: el orden se reestructuró para que lo que vive en el repo (config-as-code + runbook) se ejecute PRIMERO sin credenciales de nube, y todo el provisioning cloud quede gated al final. Mapeo con el plan anterior: T0.1 ← ex-T2.1, T0.2 ← ex-T5.1, T2.1 ← ex-T2.2; el ex-T2.3 (DNS custom) pasa a deferral documentado. Backup del plan previo en `openspec/changes/_backups/2026-08-16-US-019-provision-plataforma-cloud-infrastructure/`.

## Fase 0: Local-first — artefactos en el repo (sin credenciales de nube)

- [x] T0.1 Añadir config-as-code Railway por servicio (`apps/web`, `apps/api`) — sin Terraform
  - **AS-BUILT 2026-08-16**: contexto de build = **raíz del workspace pnpm** (`@dsm/api` depende de `@dsm/db`, así que el build corre `pnpm --filter @dsm/db generate` antes de `nest build`); en Railway se setea root directory = repo root y config path = `apps/{api,web}/railway.json`. `apps/web` queda **sin `healthcheckPath`**: no existe ruta de health en la app Next.js y no se inventa una (aplica el chequeo TCP por defecto de Railway) — si FE agrega `/api/health`, se wirea acá. `startCommand` usa `nest start`/`next start` tal como el plan lo autoriza; el arranque prod-grade (`node dist/main`) es refinamiento de `/plan-deployment`.
  - **Exit criterion**: `apps/api/railway.json` y `apps/web/railway.json` existen con build/start/healthcheck/restart tomados del AS-BUILT (api: `nest build`/`nest start` + healthcheck `/health` ya implementado en `apps/api/src/health/`; web: `next build`/`next start`); no hay ningún `.tf` en el repo (fuera de `spekode/`). `apps/worker` NO lleva config todavía — **Deferred: US-005** (la app worker es solo README; su `railway.json` se autoriza cuando BE la scaffoldee).
  - **Verify**: `python3 -c "import json; json.load(open('apps/api/railway.json')); json.load(open('apps/web/railway.json'))" && grep -q '"healthcheckPath"' apps/api/railway.json && ! find . -name '*.tf' -not -path './spekode/*' -not -path './node_modules/*' | grep -q .`

- [x] T0.2 Redactar el esqueleto del runbook del servicio (obligatorio — operations-standards)
  - **AS-BUILT 2026-08-16**: sigue la estructura obligatoria de `operations-standards` §5.3 (8 secciones: vista rápida, mapa, operaciones comunes, respuesta a alertas, problemas conocidos, recuperación, escalamiento, última actualización). Los datos que aún no existen (URLs de dashboards Railway/Sentry, rotación de on-call) quedan como `[pendiente: T…]` explícitos en vez de inventados.
  - **Exit criterion**: existe `docs/services/dsm-ecommerce/runbook.md` con secciones deploy/rollback, restore Neon PITR (RTO ≤ 4h), rotación de secretos, cola BullMQ atascada, webhook MP, app caída, y SLO 99.5% + salud vigilada (fuente E2E §18.5).
  - **Verify**: `test -f docs/services/dsm-ecommerce/runbook.md && for s in 'Rollback' 'Restore' 'Rotar secretos' 'BullMQ' 'webhook' 'SLO'; do grep -qi "$s" docs/services/dsm-ecommerce/runbook.md || exit 1; done`

## Gates externos (bloquean SOLO las fases cloud 1–4 — se resuelven al final, enfoque local-first)

- [ ] Cuentas creadas con billing en ARS resuelto. *(Estado 2026-08-16: **Cloudflare ✓, Neon ✓** creadas; **Railway y Sentry pendientes** de crear.)*
- [x] **Q-3 resuelta** (2026-07-15): región **US-East** + consentimiento informado en registro/política de privacidad (US-017).
- [x] **Q-2 resuelta** (2026-07-15): **free tiers primero** — staging en Neon Free (`pgvector`+HNSW incluidos; restore mínimo y autosuspend aceptados) + Railway; upgrade a plan pago (PITR real) es gate previo al primer deploy productivo, verificado por `/plan-deployment`.
- [x] Change gemelo `US-001-admin-catalogo-productos-bootstrap-local-infrastructure` mergeado (aporta `packages/db` con las migraciones que la Fase 3 aplica a la nube). *(Verificado 2026-08-16: archivado el 2026-08-09 en `openspec/changes/archive/`; `packages/db` presente en el branch de entrega.)*
- [ ] Railway CLI (`railway`), Neon CLI (`neonctl`) y `wrangler` instaladas y autenticadas. *(2026-08-16: instaladas — railway 5.41.2, neonctl 3.4.0, wrangler 4.123.0 — pero **sin autenticar**: `railway login` / `neonctl auth` / `wrangler login` pendientes del usuario.)*
- [x] Cliente Postgres para las verificaciones de esquema. *(2026-08-17: **no hay `psql` en el host**; se usa el del contenedor `postgres` de docker-compose —`docker compose exec -T postgres psql …`—, que además alcanza Neon por red. Por eso los `Verify:` de T1.4, T3.2 y el check de `pgvector` van por el contenedor y requieren `make up`. Alternativa si se prefiere host: `brew install libpq`.)*

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
  - **Verify**: `neonctl projects list` muestra el proyecto en la región US-East; `docker compose exec -T postgres psql "$NEON_STAGING_URL" -c "CREATE EXTENSION IF NOT EXISTS vector; SELECT extname FROM pg_extension WHERE extname='vector';"` devuelve `vector`. *(Se usa el `psql` del contenedor: no hay cliente Postgres en el host — ver el gate de herramientas.)*

- [ ] T1.5 Crear el bucket Cloudflare R2 para imágenes de productos
  - **Exit criterion**: existe un bucket R2 `dsm-product-images` (staging + production o prefijos por entorno).
  - **Verify**: `wrangler r2 bucket list` incluye `dsm-product-images` (o chequeo humano en el dashboard de Cloudflare R2).

## Fase 2: Secretos y dominio (cloud — gated)

- [ ] T2.1 Cargar los secretos de este change como Railway service variables (por entorno)
  - **Exit criterion**: `DATABASE_URL` (Neon), `REDIS_URL` y `SENTRY_DSN` están seteadas en Railway para `staging`; los slots `JWT_SECRET`, `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `GEMINI_API_KEY`, `RESEND_API_KEY` existen (placeholder, los cargan sus US).
  - **Verify**: `railway variables --environment staging` lista `DATABASE_URL`, `REDIS_URL`, `SENTRY_DSN`; y `git grep -Ei 'postgres://[^ ]*:[^ ]*@|redis://[^ ]*:[^ ]*@|SENTRY_DSN=https' -- . ':(exclude).env.example' ':(exclude)*.md'` NO devuelve secretos reales comiteados. *(Exclusión de `*.md` por F57 — el escáner no se escanea a sí mismo: sin ella el patrón matchea su propia cita en este `tasks.md` y en los backups del plan.)*

- [ ] T2.2 Dominio custom + DNS Cloudflare + TLS — **Deferred: /plan-deployment** (decisión PO 2026-08-16: no hay dominio aún)
  - **Exit criterion**: los servicios exponen sus subdominios Railway (`*.up.railway.app`) con TLS de Railway; el CNAME en Cloudflare hacia el dominio custom queda **diferido** hasta que exista dominio (se registra/delega antes del primer deploy productivo; lo verifica `/plan-deployment`). Deferral documentado — no es un drop silencioso.
  - **Verify**: chequeo humano — dashboard Railway muestra dominio `*.up.railway.app` con TLS activo por servicio; este task se marca `[x]` con esa evidencia y la anotación del deferral.

## Fase 3: Aplicar el esquema a la nube (staging — gated)

- [ ] T3.1 Aplicar las migraciones de `packages/db` contra el Neon de staging
  - **Exit criterion**: el esquema del catálogo (`categories`, `products`, extensión `vector`) existe en Neon staging **sin drift contra el datamodel autorizado** en `packages/db/prisma/schema.prisma`. La aserción es **dinámica**: no fija un número de columnas, compara contra la fuente de verdad tal como esté al momento de correr.
  - **Verify**: `DATABASE_URL="$NEON_STAGING_URL" pnpm --filter @dsm/db migrate:deploy && pnpm --filter @dsm/db exec prisma migrate diff --from-url "$NEON_STAGING_URL" --to-schema-datamodel prisma/schema.prisma --exit-code` — exit **0** = sin drift (verde); exit **2** = la nube difiere del datamodel (rojo); exit 1 = error de conexión.

- [ ] T3.2 Confirmar en la nube los CHECK e índices que Prisma NO modela — **paridad de catálogo local vs nube**
  - **Exit criterion**: el conjunto de CHECK constraints e índices de `products` en Neon staging es **idéntico** al de la base local ya migrada. Cubre justo lo que `migrate diff` (T3.1) **no** puede ver: Prisma 5.x no representa CHECK constraints en el datamodel (no existe `@@check`), así que sin este task los tres CHECK serían invisibles. **Prerequisito**: la base local arriba y migrada (`make up && make migrate-local`) — es la fuente de verdad contra la que se compara.
  - **Verify** (una sola línea; la comilla simple es del SQL y la doble del shell — sin anidar):
    ```bash
    diff <(docker compose exec -T postgres psql -U dsm -d dsm -tAc "SELECT 'check:'||conname FROM pg_constraint WHERE conrelid='products'::regclass AND contype='c' UNION SELECT 'index:'||indexname FROM pg_indexes WHERE tablename='products' ORDER BY 1") <(docker compose exec -T postgres psql "$NEON_STAGING_URL" -tAc "SELECT 'check:'||conname FROM pg_constraint WHERE conrelid='products'::regclass AND contype='c' UNION SELECT 'index:'||indexname FROM pg_indexes WHERE tablename='products' ORDER BY 1")
    ```
    exit **0** = paridad exacta; cualquier diferencia se imprime como diff (`<` local, `>` nube).
  - **Por qué se lee del catálogo y no del texto de las migraciones** *(corregido 2026-08-17b, hallazgo de la sesión de backend)*: derivar la lista esperada por `grep` de los `migration.sql` asume que las migraciones **sólo agregan**. El día que una migración haga `DROP CONSTRAINT`/`DROP INDEX`/`RENAME`, el grep seguiría encontrando el `CREATE` de la migración vieja y exigiría en la nube un objeto que se eliminó a propósito — falso positivo, y del peor tipo: falla cuando el cambio es correcto. Leer el catálogo de una base ya migrada refleja el **estado neto** de la cadena de migraciones. Bonus verificado: el catálogo también captura `products_pkey`, que el grep no veía (viene de la cláusula `CONSTRAINT` del `CREATE TABLE`). Estado hoy (verificado en vivo contra la base local): `check:products_price_check`, `check:products_status_check`, `check:products_stock_check`, `index:products_category_id_status_idx`, `index:products_pkey`, `index:products_sku_key`, `index:products_slug_key`.

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

- [x] Sin Terraform en el repo (anti-pattern del baseline): `! find . -name '*.tf' -not -path './spekode/*' -not -path './node_modules/*' | grep -q .` *(verde 2026-08-16)*
- [x] Sin secretos comiteados: `git grep -Ei 'postgres://[^ ]*:[^ ]*@|APP_USR-|AIza[A-Za-z0-9]{20}|sk_live' -- . ':(exclude).env.example' ':(exclude)*.md'` no devuelve nada. *(verde 2026-08-17)*
  - **Corregido en el re-plan 2026-08-17 (F57)**: la forma anterior omitía `':(exclude)*.md'` y el patrón se matcheaba a sí mismo citado en este `tasks.md` y en los backups del plan → nunca podía dar verde. Con la exclusión: **0 hits, sin secretos reales**; los únicos `.env*` trackeados son `.env.example` y `apps/web/.env.example`, con `.env`/`.env.local` gitigneados. Gap registrado como **F57** en `FRAMEWORK-GAPS.md`.
- [x] Config Railway válida en repo: `python3 -c "import json; json.load(open('apps/api/railway.json')); json.load(open('apps/web/railway.json'))"` *(verde 2026-08-16)*
- [x] Runbook presente: `test -f docs/services/dsm-ecommerce/runbook.md` *(verde 2026-08-16)*
- [ ] `pgvector` disponible en Neon (cloud — gated): `docker compose exec -T postgres psql "$NEON_STAGING_URL" -tAc "SELECT 1 FROM pg_extension WHERE extname='vector'"` devuelve `1`.
- [ ] Esquema en la nube = datamodel autorizado, **sin número hardcodeado** (cloud — gated): `pnpm --filter @dsm/db exec prisma migrate diff --from-url "$NEON_STAGING_URL" --to-schema-datamodel prisma/schema.prisma --exit-code` sale **0**.
