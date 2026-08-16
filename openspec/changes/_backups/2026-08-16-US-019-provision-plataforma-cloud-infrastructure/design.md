---
parent-us: US-019
discipline: infrastructure
variant: platform-cloud
language: es
---

# US-019 Platform cloud — Design

## Context

Baseline de infra: **Railway PaaS** (ADR-0001). **No hay Terraform** en este baseline — la config vive en `railway.json`/`railway.toml` + el dashboard de Railway + plugins. Este change es la pista `platform-cloud` del bootstrap greenfield (baseline Railway §0.3): corre en paralelo con `bootstrap-local`, arranca cuando resuelven sus dependencias externas (cuentas, billing) y NO está en el camino crítico de desbloquear el desarrollo.

El esquema del catálogo es autorizado y validado en `bootstrap-local` contra el Postgres de docker-compose (única fuente de verdad). Acá solo se **aplica** a la nube (`prisma migrate deploy`) — confirmación posterior, nunca la primera validación.

## Goals

- Proyecto Railway con `web`/`api`/`worker` + Redis, en `staging` y `production`.
- Neon PostgreSQL con `pgvector` (free tier en staging; PITR con upgrade pre-prod).
- Cloudflare R2 (imágenes) + DNS/CDN/TLS.
- Secretos en Railway vars; autodeploy GitHub → Railway con la CI como gate.
- Observabilidad (Sentry + Railway logs/metrics) y **runbook del servicio nuevo**.

## Non-goals

- El primer deploy vivo + checklist pre-prod + upgrade a Neon plan pago con PITR (→ `/plan-deployment`).
- Cualquier cosa de `bootstrap-local`.
- Config específica de MercadoPago/Gemini (→ US-009/US-005; acá solo se reservan slots de variables).
- Índice HNSW / tabla de embeddings (→ US-005).

## Approach

### Topología (E2E §13)

```
Cloudflare (DNS + CDN + R2)
   └─ TLS auto ─▶ Railway (proyecto único, envs staging + production)
                    ├─ web    (Next.js SSR)   ─▶ api
                    ├─ api    (NestJS)         ─▶ Neon Postgres+pgvector (TLS)
                    │                          └▶ Redis (add-on Railway)
                    └─ worker (BullMQ)         ─▶ Redis, Neon, Gemini, R2
Neon: PostgreSQL 16 + pgvector, US-East, free tier en staging → PITR con upgrade pre-prod
```

- **Region**: **US-East** (E2E §13; menor costo/latencia aceptable a MercadoPago AR). Q-3 resuelta 2026-07-15: la Ley 25.326 no exige residencia local; la transferencia internacional se cubre con consentimiento informado en registro/política de privacidad (US-017).
- **Multi-AZ**: no (plan económico; aceptable para 99.5% — ADR-0001).
- **Entornos**: `staging` + `production` como Railway environments; se promueve staging → production. PR ephemeral envs opcionales (diferidos).

### Config como código (no Terraform)

- `railway.json`/`railway.toml` por servicio en el repo: comando de build (Nixpacks auto o Dockerfile por servicio), start command, health check path, restart policy. Los plugins (Redis) y la conexión a Neon se configuran en el dashboard + service variables.
- **Anti-pattern explícitamente evitado** (baseline §7): NO se escribe Terraform para Railway; NO se auto-hostea Postgres/Redis en un servicio Railway (se usan Neon + el add-on gestionado, que tienen backups); NO se usan volúmenes Railway como object store (se usa R2).

### Persistencia en la nube

- Neon como single-primary (E2E §21; sin réplicas/sharding para ~5.000 SKUs / ~50 concurrentes).
- **Aplicar el esquema**: `pnpm --filter @dsm/db migrate:deploy` contra el `DATABASE_URL` de Neon staging — las MISMAS migraciones autorizadas en `bootstrap-local` (`20260715000000_enable_pgvector` + `20260715230024_init_catalog`). La extensión `pgvector` se habilita por la migración (no por dashboard), igual que en local.
- **Paridad AS-BUILT**: en staging, `products` debe tener las mismas 8 columnas del alcance US-001 y los mismos nombres de constraint (`products_sku_key`, `products_price_check`, `products_stock_check`, `products_status_check`, índice `products_category_id_status_idx`). Las columnas de US-003/US-005 (`description_*`, `image_url`, `enrichment_done`, `updated_at`) llegan a la nube cuando esas US corran su migración.
- **Backups**: Neon PITR + snapshots diarios (RPO ≤ 24h, E2E §17) — reales con el upgrade a plan pago; en staging free tier el restore es mínimo (Q-2). No hay pipeline de backup propio (anti-pattern del baseline).
- **Spec delta**: ninguno. Este change no introduce endpoints ni contratos de API — no toca `openspec/specs/`. La primera capability con contrato vivo la producirá BE al archivar `BE-US-001`.

### Secretos (E2E §13, security-standards §5)

Railway service variables (cifradas), por entorno. Slots a crear (valores reales los cargan las US que los usan):
- `DATABASE_URL` (Neon), `REDIS_URL` (add-on Railway), `SENTRY_DSN` (web/api/worker) — se cargan en este change.
- `JWT_SECRET` — slot (US-014/auth lo usa).
- `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `MP_PUBLIC_KEY` — slots (US-009).
- `GEMINI_API_KEY` — slot (US-005).
- `RESEND_API_KEY` — slot (US-011).
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` — se configuran con el bucket (T1.5).

Nunca en repo ni imagen. Rotación = cambio de var + redeploy (E2E §18.5). `.env.production` en git está prohibido (baseline §7). Los mismos nombres de variable existen ya como placeholders en `.env.example` (AS-BUILT de `bootstrap-local`), de modo que el mapeo local↔nube es 1:1.

### Autodeploy (baseline §6)

- Integración GitHub de Railway: push a `main` → deploy a production; push a `staging` → deploy a staging.
- **Gate**: la CI de `bootstrap-local` (`.github/workflows/ci.yml`) debe pasar antes de que la rama de deploy avance (lint/typecheck/test/migración).
- Rollback = redeploy del commit verde anterior (E2E §18.5).
- La **prueba extremo a extremo** del autodeploy (que un push realmente despliega una app viva) es de `/plan-deployment`, cuando exista app scaffoldeada. Acá se deja el wiring listo.

### Observabilidad (E2E §18, ADR-0001 nota, skill observability-patterns)

Desviación OSS ratificada: en vez de operar Grafana (Loki/Tempo/Prometheus) propio, se usa la observabilidad nativa de Railway + Sentry.

| Concern | Herramienta | Este change |
|---|---|---|
| Errores FE+BE | Sentry (free tier) | Crear proyectos Sentry web/api/worker; wire `SENTRY_DSN` |
| Logs | `pino` JSON → Railway logs | Confirmar que los servicios logean JSON a stdout (lo implementa BE; acá se documenta el destino) |
| Métricas | Railway metrics | Nativo; sin acción de provisioning |
| Alertas | Sentry → email/Slack | Configurar regla de alerta básica (spike de errores) con runbook |
| Retención de logs | **Q-E** | Railway rota; sink de retención (Better Stack/Loki) diferido si el budget lo permite |

SLO: **99.5% mensual** (tier 2, coherente con Railway single-AZ y E2E §17) `[confirmado 2026-07-15 — Q-D cerrada]`. El SLO solo es real si hay métrica que lo mide (Railway uptime/health) y alerta que lo guarda (Sentry/health check) — se documenta la cadena en el runbook.

### Runbook del servicio nuevo (operations-standards — obligatorio)

`docs/services/dsm-ecommerce/runbook.md`, esqueleto autorizado ahora (tuning de on-call/incidentes se refina en deploy). Fuente: E2E §18.5. Secciones:
- **Deploy / rollback**: GitHub Actions → Railway; rollback = redeploy del commit verde anterior.
- **Restore de datos** (RTO ≤ 4h): Neon PITR/snapshot → restore → redeploy Railway → smoke test del loop.
- **Rotar secretos**: Railway vars → redeploy; rotar `JWT_SECRET` invalida sesiones.
- **Cola BullMQ atascada**: revisar jobs fallidos/dead-letter; reprocesar; verificar Redis up.
- **Webhook MP no llega / órdenes en `pending_payment`**: reconciliar consultando estado a MP (idempotente).
- **App caída**: Railway reinicia por health check; si persiste, redeploy del último build verde.
- **SLO + salud vigilada**: 99.5% mensual; cola sin atascarse, tasa de rechazo de pagos, errores Sentry, búsquedas sin resultado.

## Threat model (lite — skill threat-modeling-lite)

Superficies que este change crea/toca (provisioning, no endpoints):

| Threat | Vector | Control |
|---|---|---|
| **S** Spoofing | Credencial de Railway/Neon/Cloudflare filtrada | Cuentas con 2FA; tokens de deploy en GitHub secrets (no en repo); acceso mínimo. |
| **T** Tampering | Cambio no autorizado de infra/vars | Cambios de infra vía repo (`railway.json`) revisados en PR; vars sensibles solo en dashboard con acceso restringido. |
| **R** Repudiation | Cambio de secreto sin huella | Railway registra cambios de deploy; rotación documentada en runbook. |
| **I** Info disclosure | R2 con objetos públicos indebidos / `DATABASE_URL` en logs | R2: solo imágenes de producto públicas por diseño (URLs públicas, E2E §13); nada de PII en R2. Secretos nunca logeados (pino redacta). |
| **D** DoS | Flood al edge | Cloudflare WAF/rate-limit (free tier) delante del dominio Railway. |
| **E** Elevation | Token de deploy con más scope del necesario | Token de deploy scopeado al proyecto; no credenciales de admin de cuenta en CI. |

No dispara la escalation rule (no PCI —MP hosted, sin PAN/CVV—, no PHI, no crypto propia, no cambio de trust boundary de plataforma). Lite es suficiente.

## Trade-offs

- **Sentry + Railway vs Grafana OSS**: menos profundidad de métricas/retención propia, a cambio de cero ops de un stack de observabilidad. Ratificado en ADR-0001.
- **Sink de retención de logs diferido (Q-E, cerrada 2026-07-15)**: Sentry cubre errores; los logs de Railway rotan. Riesgo: sin sink, no hay auditoría de logs a largo plazo. Diferido por budget — deuda consciente, no omisión silenciosa (el baseline §5 lo pide).
- **US-East vs residencia AR (Q-3, cerrada 2026-07-15)**: US-East + consentimiento informado (US-017). Región revisable si Legal objeta a futuro.
- **Free tiers para staging (Q-2, cerrada 2026-07-15)**: menor costo inicial a cambio de restore mínimo/autosuspend en staging; el upgrade a plan pago con PITR es gate previo al primer deploy productivo.
- **staging + production desde el bootstrap**: dos entornos desde el día 1 duplican algún costo, pero habilitan promover en vez de deployar directo a prod (baseline §2).

## Costo estimado

**S (< $50/mo)** al arranque: Railway (planes económicos web+api+worker+Redis), Neon (free tier en staging; el plan pago con PITR entra con el upgrade pre-prod), Cloudflare (free tier DNS/CDN, R2 con free tier de almacenamiento/egress para ~5.000 imágenes), Sentry (free tier). Coherente con "budget de ferretería en ARS" (ADR-0001). **No requiere FinOps review** a esta escala; revisar si se cruza >50 concurrentes o crece el catálogo mucho (E2E §21).

## Obligaciones operacionales

- **Runbook**: `docs/services/dsm-ecommerce/runbook.md` (esqueleto en este change — obligatorio por operations-standards).
- **SLO**: 99.5% mensual `[confirmado 2026-07-15 — Q-D cerrada]`.
- **Alertas**: spike de errores (Sentry → email/Slack) con entrada de runbook; cola BullMQ atascada (se afina cuando el worker exista, US-005+).

## Open questions

Todas cerradas el 2026-07-15 (ver detalle en `proposal.md` §Open questions):

- Q-2: free tiers para staging; upgrade con PITR como gate pre-prod.
- Q-3: US-East + consentimiento informado (US-017).
- Q-D: SLO 99.5% mensual confirmado.
- Q-E: sink de retención diferido; Sentry cubre errores.

## References

- E2E: §13, §17, §18, §18.5
- ADRs: `0001-platform-railway-neon-r2.md`, `0002-postgresql-pgvector-single-datastore.md`
- Baseline: `spekode/docs/architecture/railway-baseline.md` §0.3, §1, §2, §5, §6, §7
- Skills: `observability-patterns`, `threat-modeling-lite`, `security-scan`, `data-architecture-patterns`
- Change gemelo (prerequisito): `openspec/changes/US-001-admin-catalogo-productos-bootstrap-local-infrastructure/`
