# US-001 Admin catálogo de productos — Infraestructura

> **Idioma**: contenido en español (hereda `language: es` de US-001 / PRD). Los headings estructurales (`## Why`, `## What changes`, …) y las etiquetas máquina (`Exit criterion:` / `Verify:`) quedan en inglés por contrato de tooling (per `openspec-workflow`).
>
> **Baseline**: `railway` (per `project-config.yml` → `stacks.infra`). Ver `spekode/docs/architecture/railway-baseline.md`. **No Terraform** en este baseline. Config vive en `railway.json`/`railway.toml` + plugins.

## Why

US-001 es la **primera US del proyecto** y su tarea INFRA es el **bootstrap de la plataforma completa** del e-commerce DSM: no existe esqueleto de repo, ni loop de desarrollo local, ni recursos en la nube. Sin este bootstrap ninguna otra disciplina (BE/FE) puede scaffoldear su app, y ninguna US posterior (US-002…US-018, todas `blocked_by: [US-001]` directa o transitivamente) puede arrancar.

Además del bootstrap, esta tarea INFRA es dueña del **esquema de persistencia del catálogo** (`products`, `categories`) con sus constraints de negocio: SKU único (AC-9), `stock >= 0` y `price > 0` en centavos (AC-5), estado `draft|published|archived` (AC-2 borrador, AC-4 publicado, AC-7 archivar-no-borrar), y el diseño de **snapshot de precio en el momento de la orden** que garantiza que un cambio de precio no altera ventas históricas (AC-10). El esquema es la base sobre la que BE-US-001 construye el CRUD.

El proyecto **se desvía del baseline por defecto de la organización (AWS Lightsail)** hacia **Railway + Neon (Postgres+pgvector) + Cloudflare R2**. Esa desviación **ya está formalizada y Aceptada en ADR-0001** (con ADR-0002 para pgvector como datastore único, ADR-0004 para Redis+BullMQ). Por lo tanto **no se re-arquitecta**: este plan materializa lo que el E2E §13/§16/§17/§18 ya decidió.

## What changes

**Fase 0 — Bootstrap greenfield local-first (antes de cualquier nube)** — per `railway-baseline.md` §0:

- Estructura de monorepo (`apps/api`, `apps/web`, `apps/worker`, `packages/`) con placeholders. **No** el framework de la app — cada disciplina hace su `nest new` / `create-next-app` en su primer ticket (tarea cross-reference, no de INFRA).
- `docker-compose.yml` con las dependencias locales que espejan los plugins de Railway: **PostgreSQL 16 + extensión `pgvector`** y **Redis 7**. Imágenes pinneadas, healthchecks, volúmenes nombrados.
- `.env.example` con toda la variable de entorno (placeholders, sin secretos); `.env.local` gitignored.
- Targets locales (`Makefile`): `up`, `migrate-local`, `run-local`, `down`, `seed-local`.
- **Toolchain de migraciones (Prisma)** y las **migraciones del catálogo** (`categories`, `products`) validadas **contra el Postgres del docker-compose primero** — cero credenciales de nube para validar el esquema.

**Fase 1 — Esquema de catálogo (persistence)** — per E2E §8:

- Tabla `categories` (id, name, slug UK, parent_id self-FK para rubro/subrubro).
- Tabla `products` (id, sku UK, name, description_raw, description_enriched, `price_ars_cents` int con CHECK > 0, `stock` int con CHECK >= 0, category_id FK, image_url, `status` draft|published|archived, enrichment_done, timestamps).
- Índices: `products(category_id, status)`, `products(sku)` UK, `categories(slug)` UK.
- **Solo estas dos tablas** en esta US. `product_embeddings`, `carts`, `orders`, `payments`, etc. son de US posteriores. Se documenta el **contrato de snapshot de precio** (`order_items.unit_price_ars_cents`) que otras US deben respetar para AC-10, aunque `order_items` no se crea acá.
- Habilitación de la extensión `pgvector` en la DB (aunque la columna vector es de US-005) — para que el datastore esté listo y no requiera migración disruptiva luego.

**Fase 2 — Provisioning en la nube (Railway + Neon + Cloudflare R2)** — per E2E §13:

- Proyecto Railway único con environments `staging` + `production`; servicios `api`, `web`, `worker` + plugin **Redis**.
- `railway.json` en el repo con build/deploy config (sin Terraform).
- **Neon** Postgres (region US-East por default per E2E §13; ver Q abierta de residencia AR) con `pgvector` habilitado + PITR/snapshots diarios (RPO ≤ 24h).
- **Cloudflare R2** bucket para imágenes de producto + DNS (CNAME → dominio Railway) + TLS auto.
- **Secrets** solo en variables de Railway (DB/Redis URLs, JWT secret, y placeholders para MP/Gemini/Resend de US futuras). Nunca en git.
- Confirmación de migraciones en **staging Neon** (paso de confirmación posterior, no la primera validación).

**Fase 3 — CI/CD + observabilidad** — per E2E §16/§18:

- GitHub Actions: build + test + lint + SonarCloud gate **antes** de que Railway autodespliegue (`main` → production, `staging` → staging).
- Observabilidad: **Sentry** (errores FE+BE) + logs estructurados `pino` → Railway; alertas Sentry → email. **Desviación del default OSS Grafana ya registrada en ADR-0001** (§18 E2E).
- Instrumentación de **eventos de negocio** "producto creado / publicado / archivado" (alimenta la métrica de cobertura de catálogo PRD §1.4) — el contrato del evento se define acá; la emisión la hace BE-US-001.
- Runbook draft del servicio nuevo (obligación `operations-standards.md`).

## Out of scope

- **Scaffolding del framework de cada app** (`nest new`, `create-next-app`) — es el primer ticket de BE-US-001 / FE-US-001, no de INFRA. INFRA entrega la estructura donde scaffoldean.
- **Columna `product_embeddings.embedding` + índice HNSW** — de US-005 (solo se habilita la extensión pgvector acá).
- **Tablas `orders`, `order_items`, `payments`, `carts`, `customers`** — de US-007…US-014. Acá solo se documenta el contrato de snapshot de precio para AC-10.
- **Worker BullMQ funcional** (jobs de enriquecimiento/embeddings) — el servicio worker se provisiona como placeholder; su lógica es de US-005/US-006.
- **Endpoints CRUD, guards de auth admin, validaciones a nivel API** — de BE-US-001 (INFRA entrega el esquema + constraints DB que respaldan las AC; la aplicación de las reglas a nivel request es de BE).

## ACs respaldadas por esta tarea INFRA

| AC | Qué respalda INFRA (a nivel esquema/plataforma) |
|---|---|
| **AC-2** (alta en borrador) | Columna `products.status` default `'draft'` + enum check `draft\|published\|archived`. |
| **AC-5** (validación precio>0, stock≥0, requeridos) | `CHECK (price_ars_cents > 0)`, `CHECK (stock >= 0)`, `NOT NULL` en name/sku/price/stock/category_id. |
| **AC-7** (archivar, no borrar) | Archivado = `status='archived'` (no `DELETE`); FK `order_items.product_id` sin `ON DELETE CASCADE` → preserva historial. |
| **AC-9** (SKU único) | `UNIQUE (sku)` en `products` (índice único). |
| **AC-10** (cambio de precio no altera ventas pasadas) | Contrato documentado: `order_items.unit_price_ars_cents` es snapshot al momento de la orden; `products.price_ars_cents` es catálogo vigente. (Constraint documentado; `order_items` es US futura.) |
| **AC-8** (acceso admin-only) | Wiring de secrets (JWT secret en variables Railway) + placeholder de la config de auth. La enforcement server-side es de BE. |

## Standards consultados

- `spekode/docs/architecture/railway-baseline.md` §0 (Phase 0 greenfield), §2 (defaults), §3 (NFR), §5 (observabilidad), §6 (CI/CD), §7 (anti-patterns).
- `docs/architecture/decisions/0001-platform-railway-neon-r2.md` (Accepted) — desviación del baseline + nota observabilidad.
- `docs/architecture/decisions/0002-postgresql-pgvector-single-datastore.md` (pgvector).
- `docs/architecture/decisions/0004-redis-bullmq-async-processing.md` (Redis).
- `docs/product/design-e2e.md` §8 (DER), §13 (despliegue), §16 (stack), §17 (NFRs), §18 (observabilidad).
- `spekode/docs/cross-cutting/observability-standards.md` (eventos de negocio, PII en logs).
- `spekode/docs/cross-cutting/security-standards.md` (secrets, TLS, supply chain — actions pinneadas).
- `spekode/docs/delivery/operations-standards.md` (runbook obligatorio para servicio nuevo).

## Open questions (para ratificación humana)

1. **Residencia de datos AR (E2E Q-3)**: default región Neon/Railway = US-East. Si Ley 25.326 exige PII en Argentina, cambia la región antes de provisionar producción. Bloquea el provisioning de producción, **no** la Fase 0/1 local. → PO / Legal.
2. **Plan concreto Neon/Railway (E2E Q-2)**: confirmar que el plan elegido garantiza `pgvector` + HNSW + PITR. Bloquea provisioning, no el diseño. → Arquitecto.
3. **¿Prisma como toolchain de migraciones para esta tabla?** El E2E §16 fija Prisma para esquema/migraciones. INFRA entrega el esquema Prisma inicial + migración; ¿BE-US-001 hereda ese `schema.prisma` o INFRA solo entrega SQL de migración? → propuesta: INFRA entrega `schema.prisma` con `categories`+`products` y la primera migración; BE extiende. Confirmar con backend-developer.
4. **Umbral de alerta de eventos de negocio**: qué threshold dispara alerta sobre "cobertura de catálogo" es decisión de Ops/PO — se deja como TBD marcado para runtime (per `observability-patterns` §6.2). → Ops / PO.

## References

- US: `docs/user-stories/US-001-admin-catalogo-productos.md`
- E2E: `docs/product/design-e2e.md` (Approved 2026-06-15)
- PRD: `docs/product/prd.md` (Approved)
- ADRs: 0001, 0002, 0004
- Tracker: local only — Linear MCP no conectado (`linear-issue-id: null`).
- Related changes (futuros): `US-001-...-backend`, `US-001-...-frontend` (scaffold sus apps en la estructura que entrega esta tarea).
