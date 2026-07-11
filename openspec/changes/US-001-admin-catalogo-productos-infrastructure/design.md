# US-001 Admin catálogo de productos — Infraestructura · Design

> **Idioma**: contenido en español (`language: es`); headings estructurales en inglés (contrato tooling).
> **Este diseño NO re-arquitecta el E2E** — lo materializa. Todas las decisiones de topología, motor y esquema vienen del E2E (Approved) y sus ADRs. Se citan las secciones que se heredan.

## Context

US-001 es el bootstrap fundacional. El E2E (§13 despliegue, §16 stack, §17 NFRs, §18 observabilidad) y ADR-0001/0002/0004 (Accepted) ya fijaron: plataforma **Railway + Neon (Postgres+pgvector) + Cloudflare R2**, cache/colas **Redis+BullMQ**, observabilidad **Sentry + logs pino** (desviación OSS registrada en ADR-0001). El repo es **greenfield** (sin esqueleto ni loop local), por lo que el baseline Railway §0 **obliga a Fase 0 antes de la nube**.

El scope de persistencia de esta US son **dos tablas** (`products`, `categories`) cuyo diseño completo (columnas, tipos, constraints, índices) ya está en el E2E §8. La tarea de INFRA es materializar ese diseño como migración validada localmente, no diseñarlo de nuevo.

## Goals

- Entregar la **estructura de repo + loop de desarrollo local** que permite validar el esquema con **cero credenciales de nube** (Fase 0).
- Materializar el **esquema del catálogo** (`categories`, `products`) con las constraints que respaldan AC-2/5/7/9/10.
- Provisionar la **plataforma en la nube** (Railway/Neon/R2) según E2E §13, con secrets fuera de git.
- Cablear **CI/CD** (GitHub Actions + SonarCloud + autodeploy Railway) y **observabilidad** (Sentry + pino + eventos de negocio).

## Non-goals

- Scaffoldear los frameworks de app (BE/FE lo hacen en su primer ticket).
- Crear tablas/columnas de US posteriores (`product_embeddings`, `orders`, `payments`, …).
- Implementar la lógica del worker, los endpoints CRUD, los guards de auth (BE-US-001).
- Re-decidir motor, plataforma, región o topología (fijados en E2E + ADR-0001).

## Baseline compliance

| Concern | Baseline `railway` | Este plan | ¿Desvía? |
|---|---|---|---|
| Plataforma | Railway single-region | Railway proyecto único, US-East | No (E2E §13) |
| DB | Railway Postgres plugin | **Neon** Postgres+pgvector | Sí → **ADR-0001/0002** (Accepted). Neon aporta pgvector+HNSW managed. |
| Cache/colas | Railway Redis plugin | Railway Redis + BullMQ | No (E2E §16, ADR-0004) |
| Object storage | R2 o S3 | Cloudflare R2 | No (baseline §2) |
| IaC | `railway.json`/`railway.toml`, **sin Terraform** | `railway.json` en repo | No |
| Env/secrets | Variables de Railway | Variables de Railway | No |
| Observabilidad | Loki/Prometheus/Sentry (ship logs off Railway) | **Sentry + pino → Railway logs** | Sí (menor) → **ADR-0001** nota §18. Aceptado por budget. |
| CI/CD | GitHub Actions gate + autodeploy Railway | Idéntico + SonarCloud | No |
| a11y / privacy | WCAG 2.2 AA / tokens de pago sin PCI | Heredado (FE/BE) | No |

**Veredicto**: el plan cumple el baseline `railway`. Las dos desviaciones (Neon en vez del plugin Postgres; observabilidad Sentry en vez de Grafana OSS) están **ambas cubiertas por ADR-0001 (Accepted)**. No se requiere ADR nuevo.

## Approach

### Fase 0 — Bootstrap local-first (per railway-baseline §0)

**Estructura de repo** (monorepo, `stacks.active: [BE, WEB, INFRA, QA]`):

```
apps/
  api/        # NestJS (scaffold: BE-US-001) — .gitkeep + README placeholder
  web/        # Next.js (scaffold: FE-US-001) — .gitkeep + README placeholder
  worker/     # NestJS+BullMQ (scaffold futuro US-005/006) — placeholder
packages/
  db/         # schema.prisma + migraciones (dueño: INFRA en esta US)
  config/     # tsconfig/eslint compartidos — placeholder
docker-compose.yml
.env.example
Makefile
railway.json
```

INFRA **es dueño de `packages/db/`** (schema + migraciones) y de los archivos raíz. Los directorios `apps/*` son estructura con placeholder; cada disciplina scaffoldea su framework ahí (tarea cross-reference, ver `tasks.md` T0.1 nota).

**`docker-compose.yml`** — dependencias locales que espejan los plugins Railway:

- `postgres`: imagen `pgvector/pgvector:pg16` (Postgres 16 con extensión pgvector incluida), healthcheck `pg_isready`, volumen nombrado, puerto 5432.
- `redis`: imagen `redis:7-alpine`, healthcheck `redis-cli ping`, volumen nombrado, puerto 6379.

Imágenes **pinneadas** por tag mayor+menor (per baseline §0.1 y anti-patterns). R2 no tiene equivalente local en compose; para dev local se usa filesystem/placeholder (imágenes son de US posteriores para carga; acá solo se provisiona el bucket).

**`.env.example`** — variables (placeholders, sin secretos):
`DATABASE_URL`, `SHADOW_DATABASE_URL` (Prisma), `REDIS_URL`, `JWT_SECRET`, `NODE_ENV`, `PORT`, y placeholders comentados para US futuras (`MP_*`, `GEMINI_API_KEY`, `RESEND_API_KEY`, `R2_*`, `SENTRY_DSN`).

**`Makefile`** targets: `up` (compose up -d deps), `down`, `migrate-local` (prisma migrate dev contra compose PG), `run-local`, `seed-local`, `db-reset`.

### Fase 1 — Esquema del catálogo (Persistence)

**Toolchain**: **Prisma** (per E2E §16 — esquema + migraciones). INFRA entrega `packages/db/prisma/schema.prisma` con `categories`+`products` y la **primera migración** validada contra el Postgres del compose (**migration validation local-first** per baseline §0.2). Confirmación en Neon staging = paso posterior (Fase 2), nunca la primera validación.

**Decisión data-architect Mode B: NO se invoca.** Razón: el diseño de datos ya está **completo y autoritativo en E2E §8** (columnas, tipos `*_ars_cents` int, `CHECK (stock>=0)`, SKU UK, enum `status`, índices `(category_id,status)`, contrato de snapshot de precio, soft-archive por `status`). Invocar Mode B para re-diseñar violaría el mandato "no re-arquitectar el E2E". El trabajo restante es **materializar** (traducir E2E §8 a `schema.prisma` + migración + validación local) — decomposición closure-grade, no diseño net-new. Se resuelve inline con el conocimiento del skill `data-architecture-patterns`. El diseño concreto se transcribe abajo (fiel al E2E §8, sin invención).

#### Esquema `categories`

```prisma
model Category {
  id        String     @id @default(uuid()) @db.Uuid
  name      String
  slug      String     @unique
  parentId  String?    @map("parent_id") @db.Uuid        // rubro/subrubro (self-FK, E2E §8)
  parent    Category?  @relation("CategoryTree", fields: [parentId], references: [id])
  children  Category[] @relation("CategoryTree")
  products  Product[]
  createdAt DateTime   @default(now()) @map("created_at")
  updatedAt DateTime   @updatedAt @map("updated_at")
  @@map("categories")
  @@index([parentId])
}
```

- `slug` UNIQUE → respalda AC-1 (slug único por categoría).
- `parent_id` self-FK nullable → soporta rubro/subrubro del E2E §8 sin tabla extra.

#### Esquema `products`

```prisma
enum ProductStatus {
  draft
  published
  archived
  @@map("product_status")
}

model Product {
  id                 String        @id @default(uuid()) @db.Uuid
  sku                String        @unique                       // AC-9 SKU único
  name               String
  descriptionRaw     String?       @map("description_raw")       // manual en US-001
  descriptionEnriched String?      @map("description_enriched")  // IA US-005
  priceArsCents      Int           @map("price_ars_cents")       // AC-5 > 0 (CHECK abajo)
  stock              Int                                         // AC-5 >= 0 (CHECK abajo)
  categoryId         String        @map("category_id") @db.Uuid
  category           Category      @relation(fields: [categoryId], references: [id])
  imageUrl           String?       @map("image_url")             // opcional (R2)
  status             ProductStatus @default(draft)               // AC-2 nace borrador
  enrichmentDone     Boolean       @default(false) @map("enrichment_done")
  createdAt          DateTime      @default(now()) @map("created_at")
  updatedAt          DateTime      @updatedAt @map("updated_at")
  @@map("products")
  @@index([categoryId, status])                                 // E2E §8 índice de listado
}
```

**Constraints que Prisma no expresa nativamente** — se agregan por **migración SQL manual** dentro de la misma migración (Prisma permite editar el SQL generado):

```sql
ALTER TABLE products ADD CONSTRAINT products_price_positive CHECK (price_ars_cents > 0);   -- AC-5
ALTER TABLE products ADD CONSTRAINT products_stock_nonneg   CHECK (stock >= 0);            -- AC-5
```

**Índices resultantes** (respaldan NFR §9 US-001: listado paginado sin degradación con ≥5.000 SKUs):

- `products_sku_key` UNIQUE (sku) — AC-9 + lookup por SKU.
- `products_category_id_status_idx` (category_id, status) — listado del panel filtrado por rubro+estado.
- `categories_slug_key` UNIQUE (slug) — AC-1.

Con ≥5.000 SKUs el índice compuesto `(category_id, status)` sostiene el listado paginado (cursor/offset per E2E §17) en índice, cumpliendo el NFR de latencia de escritura p95 < 500ms y listado sin degradación.

#### Habilitación de `pgvector` (sin columna vector aún)

La migración incluye `CREATE EXTENSION IF NOT EXISTS vector;` para dejar el datastore listo (la columna `product_embeddings.embedding` + índice HNSW son de US-005). Se habilita ahora para evitar una migración disruptiva posterior y confirmar en Fase 0 que el compose PG (imagen `pgvector/pgvector:pg16`) y Neon soportan la extensión.

#### Contrato de snapshot de precio (AC-10) — documentado, no implementado acá

`order_items` es de una US futura (US-007+). Se **documenta el contrato** que esas US deben respetar: `order_items.unit_price_ars_cents` almacena el precio **al momento de crear la orden** (snapshot), independiente de `products.price_ars_cents` (catálogo vigente). Así un cambio de precio en catálogo no altera órdenes históricas. Además, `order_items.product_id` **no** debe llevar `ON DELETE CASCADE` y el archivado usa `status='archived'` (no `DELETE`) → AC-7 preserva el historial. Se deja como nota en `packages/db/README.md` para que BE-US-001 y las US de órdenes no lo violen.

### Fase 2 — Provisioning nube (Railway + Neon + R2) · per E2E §13

- **Railway**: 1 proyecto, environments `staging` + `production`. Servicios: `api`, `web`, `worker` (placeholder) + plugin **Redis**. Build por Nixpacks/Dockerfile. Config declarativa en `railway.json`.
- **Neon**: Postgres con `pgvector` habilitado; PITR + snapshots diarios (RPO ≤ 24h per E2E §17). Región **US-East** (default E2E §13; sujeto a Q-3 residencia AR).
- **Cloudflare**: R2 bucket `dsm-product-images-{env}` (imágenes); DNS CNAME → dominio Railway; TLS auto.
- **Migración en staging Neon** = confirmación posterior de la migración ya validada en local.

### Fase 3 — CI/CD + observabilidad · per E2E §16/§18

- **GitHub Actions**: workflow `ci.yml` (install → lint → typecheck → test → SonarCloud gate) que corre antes de que Railway autodespliegue (`main`→production, `staging`→staging). **Actions pinneadas por SHA** (per `security-standards.md` §9 supply chain).
- **Observabilidad**: Sentry (proyecto FE + BE) + `pino` JSON → Railway logs. Alertas Sentry → email.
- **Eventos de negocio**: se define el **contrato** de los eventos `product.created`, `product.published`, `product.archived` (dimensiones: `product_id` pseudónimo, `category_id`, `status`, `actor_role`; **sin PII** per `observability-standards.md` §9) — la **emisión** la hace BE-US-001; INFRA entrega el sink/estructura de log.
- **Runbook draft** del servicio en `docs/services/dsm-platform/runbook.md` (obligación `operations-standards.md`; contenido base de restore/deploy/rollback ya bosquejado en E2E §18.5).

## Trade-offs

| Decisión | Alternativa considerada | Por qué la elegida |
|---|---|---|
| Fase 0 local-first antes de nube | Provisionar Neon/Railway staging y validar el esquema ahí | Baseline §0: validar esquema no debe requerir cuenta paga; el skeleton necesita dueño. Fail-loud si se salta. |
| No invocar data-architect Mode B | Invocar Mode B para el esquema | E2E §8 ya es el diseño autoritativo; Mode B re-arquitecturaría. Materializar ≠ diseñar. |
| Habilitar pgvector ahora (sin columna) | Habilitarlo en US-005 | Evita migración disruptiva; confirma soporte local+Neon temprano. Costo casi nulo. |
| Imagen `pgvector/pgvector:pg16` en compose | Postgres oficial + instalar pgvector por script | La imagen trae la extensión lista; menos fricción y espeja Neon. |
| INFRA entrega `schema.prisma` con las 2 tablas | INFRA entrega solo SQL; BE hace Prisma | Prisma es la toolchain fijada (E2E §16); entregar el schema evita doble fuente. (Open question #3 para confirmar con BE.) |

## Cost estimate

**S (< $50/mo)**. Razón: Railway plan económico (web+api+worker+redis en un proyecto), Neon free/launch tier con pgvector, Cloudflare R2 free tier + DNS gratis, Sentry free tier. Concurrencia ~50 y ~5.000 SKUs caben holgados (E2E §21). **No requiere FinOps review** a este scale. Se revisa si el proyecto cruza los umbrales de graduación del baseline §8 (>100K MAU, multi-región, >$1M ARR).

## Operational obligations (per operations-standards.md)

- **SLO target** (hereda E2E §17, baseline §3): disponibilidad **99.5% mensual**; latencia p95 **< 300ms lectura / < 500ms escritura**; **RPO ≤ 24h / RTO ≤ 4h**. Single-region sin multi-AZ (aceptado por ADR-0001). Valores `[propuestos — confirma Ops]` donde dependan de medición real (per `nfr-quantification`).
- **Runbook a draftear**: `docs/services/dsm-platform/runbook.md` — restore Neon (PITR), deploy/rollback (redeploy commit verde), rotación de secrets (variables Railway), reprocesamiento de cola (US futura). Base ya bosquejada en E2E §18.5.
- **Alertas**: Sentry error-rate → email (P2/P3). Alerta de cola atascada = US futura (worker sin lógica aún). Threshold de "cobertura de catálogo" = TBD (open question #4, per `observability-patterns` §6.2).
- **Runbook obligatorio para servicio nuevo**: cubierto por task T3.5.

## Security (threat-modeling-lite — superficies que crea esta tarea)

Esta tarea crea **plataforma + secrets + esquema**, no endpoints (los endpoints son BE). Superficies relevantes:

| Superficie | STRIDE | Control (en este plan) |
|---|---|---|
| Secrets (DB/Redis URL, JWT secret) | **Information disclosure** | Solo en variables de Railway; nunca en git; `.env.example` con placeholders; `.env.local` gitignored. `gitleaks` en CI. |
| GitHub Actions supply chain | **Tampering** | Actions pinneadas por SHA (`security-standards.md` §9); Dependabot. |
| DB en tránsito | **Information disclosure** | TLS a Neon (sslmode=require en `DATABASE_URL`). |
| DB at-rest | **Information disclosure** | Neon-managed encryption at rest. |
| R2 bucket | **Information disclosure / Tampering** | Bucket privado; acceso por credencial en variable Railway; URL pública solo para imágenes publicadas (no PII). |
| Constraint bypass (SKU dup, precio ≤0) | **Tampering** | Constraints a nivel DB (`UNIQUE`, `CHECK`) — defensa en profundidad además de la validación BE. |
| Acceso admin al catálogo (AC-8) | **Elevation of privilege** | INFRA provee JWT secret + config; la enforcement server-side (guard `role=admin`) es de BE-US-001 (E2E §14 STRIDE). |

Sin PII en el scope de esta tarea (catálogo no es PII). No dispara la escalation rule (sin PCI/PHI/crypto propio/trust-boundary nuevo) → threat-modeling lite es suficiente.

## Spec delta (para /archive-change)

Al archivar, esta change aporta al contrato vivo de la capability `catalog`:
- Esquema de datos `categories` + `products` (living data-model). No hay endpoints REST propios de INFRA (los define BE-US-001). El delta de esta change es **el esquema de persistencia**, que se refleja en `openspec/specs/catalog/` (data-model) al archivar.

## References

- E2E `docs/product/design-e2e.md` §8, §13, §16, §17, §18, §18.5, §20, §21.
- ADR-0001 (Accepted), ADR-0002, ADR-0004.
- `spekode/docs/architecture/railway-baseline.md` §0, §2, §3, §5, §6, §7.
- Skills: `data-architecture-patterns` (esquema inline), `observability-patterns` §6/§9, `threat-modeling-lite`, `nfr-quantification`, `security-scan`.
