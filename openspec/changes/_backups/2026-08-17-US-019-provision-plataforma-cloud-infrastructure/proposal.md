---
tracker-id: null
tracker-source: null
parent-us: US-019
discipline: infrastructure
variant: null
language: es
---

# US-019 Platform cloud — provisioning Railway + Neon + Cloudflare R2, secretos, autodeploy y runbook

## Why

`bootstrap-local` desbloquea el desarrollo el día 1 sin credenciales de nube. Este change es la **pista paralela**: aprovisiona la plataforma real (Railway para compute + Redis, Neon para PostgreSQL con `pgvector`, Cloudflare para DNS/CDN/R2), configura secretos, autodeploy desde GitHub, DNS/TLS, observabilidad y el **runbook del nuevo servicio**. Aplica a la nube el esquema del catálogo autorizado en `bootstrap-local` (la nube es una confirmación posterior, nunca la primera validación).

Se separa de `bootstrap-local` por mandato del baseline Railway §0: local y nube tienen urgencia, dependencias y dueño distintos. Este change está **gated en dependencias externas** (cuentas Railway/Neon/Cloudflare, billing en ARS) y **no** está en el camino crítico de desbloquear a las disciplinas. El **primer deploy vivo** (prueba de autodeploy, DNS/TLS en vivo, checklist pre-prod) lo planifica `/plan-deployment` cuando exista una app scaffoldeada — no acá.

> **Re-plan 2026-08-16 (`--regenerate`, decisión PO: local-first)**: el orden de `tasks.md` se reestructuró — **Fase 0** (config-as-code Railway en repo + runbook, cero credenciales de nube) se ejecuta primero; todo el provisioning cloud (Fases 1–4) queda gated al final, cuando el usuario cree las cuentas faltantes y autentique las CLIs. Estado de gates al re-plan: Cloudflare y Neon creadas; Railway y Sentry pendientes; CLIs instaladas sin autenticar; change gemelo `bootstrap-local` mergeado. El **dominio custom** no existe aún → DNS/TLS custom pasa a **deferral documentado** (T2.2 → `/plan-deployment`); mientras tanto se usan los subdominios `*.up.railway.app` con TLS de Railway. El `railway.json` de `worker` se difiere a **US-005** (la app worker aún no está scaffoldeada). Las decisiones de arquitectura del design NO cambian. Backup del plan previo: `openspec/changes/_backups/2026-08-16-US-019-provision-plataforma-cloud-infrastructure/`.

## What changes

- **Proyecto Railway único** con los servicios `web` (Next.js SSR), `api` (NestJS) y `worker` (BullMQ), más el add-on gestionado **Redis**, en entornos `staging` y `production` (E2E §13). Config vía `railway.json`/`railway.toml` en el repo — **no Terraform** (Railway es PaaS).
- **Neon PostgreSQL** con la extensión `pgvector` habilitada, región US-East (Q-3), plan **free tier para staging** (incluye `pgvector`+HNSW; Q-2) — el upgrade a plan pago con PITR es gate previo al primer deploy productivo (lo verifica `/plan-deployment`).
- **Cloudflare R2** bucket `dsm-product-images` para imágenes de productos + Cloudflare DNS/CDN delante del dominio Railway.
- **Secretos** en Railway service variables (MP keys, Gemini key, Resend key, JWT secret, `DATABASE_URL` de Neon, `REDIS_URL`, `SENTRY_DSN`) — nunca en repo ni imagen (E2E §13). Este change carga `DATABASE_URL`, `REDIS_URL`, `SENTRY_DSN`; el resto quedan como slots que cargan sus US.
- **Autodeploy** vía integración GitHub de Railway (`main` → production, `staging` → staging) + gate de GitHub Actions (la CI `ci.yml` de `bootstrap-local`) antes del deploy.
- **Aplicación del esquema a la nube**: `pnpm --filter @dsm/db migrate:deploy` contra el Neon de `staging` — la misma migración (`enable_pgvector` + `init_catalog`) autorizada en local.
- **TLS** automático (Railway/Cloudflare) sobre el dominio custom.
- **Observabilidad** (E2E §18, desviación OSS ratificada en ADR-0001): Sentry (errores FE+BE), `pino` JSON → Railway logs, métricas Railway, alertas Sentry → email/Slack. Wiring de proyectos Sentry y variables `SENTRY_DSN`.
- **Runbook del nuevo servicio** en `docs/services/dsm-ecommerce/runbook.md`: esqueleto autorizado ahora (deploy/rollback, restore Neon PITR RTO ≤ 4h, rotación de secretos, cola BullMQ atascada, webhook MP), tomando los runbooks day-2 del E2E §18.5 como fuente.

## ACs de US-001 cubiertos

Ninguno directamente — este change no implementa comportamiento funcional. Habilita el **sustrato de nube** sobre el que corre lo que sí cubre los AC (BE/FE). Su contribución a US-001 es operativa: que el catálogo autorizado localmente pueda vivir en staging con backups, secretos y observabilidad.

## Out of scope

- **Todo lo de `bootstrap-local`** (esqueleto, docker-compose, esquema autorizado local, CI-de-PR) — es su change gemelo y prerequisito de la tarea de aplicar migraciones a la nube.
- **El primer deploy vivo + validación** (autodeploy probado extremo a extremo, DNS/TLS en vivo, checklist pre-prod, smoke test del loop) → `/plan-deployment` cuando haya app deployable.
- **El upgrade a Neon plan pago con PITR** → gate previo al primer deploy productivo, verificado por `/plan-deployment` (acá staging corre en free tier).
- **Scaffolding de apps** → BE/FE.
- **Provisioning de servicios de otras US** (p. ej. cuotas de Gemini para US-005, config de MercadoPago para US-009) — se tocan en sus US; acá solo se reservan los slots de variables.
- **Índice HNSW de embeddings** → US-005 (la tabla `product_embeddings` no existe todavía).

## Standards consultados

- `spekode/docs/architecture/railway-baseline.md` §0.3 (deliverables de `platform-cloud`), §1 (topología), §2 (defaults que no se re-deciden), §5 (observabilidad), §6 (CI/CD), §7 (anti-patterns: no Terraform, no self-host Postgres, no volúmenes como object store, no secretos comiteados).
- `docs/delivery/operations-standards.md` (runbook obligatorio para servicio nuevo, SLO, on-call).
- `docs/cross-cutting/observability-standards.md` + skill `observability-patterns` (Sentry como superficie primaria de error, logs con retención fuera de Railway, alertas con runbook).
- `docs/cross-cutting/security-standards.md` + skills `security-scan`, `threat-modeling-lite` (secretos en Railway vars, TLS 1.2+, R2 sin objetos públicos indebidos).
- ADR-0001 (Railway + Neon + R2; nota de observabilidad Sentry+Railway vs Grafana OSS), ADR-0002 (pgvector).

## Open questions

Todas cerradas el 2026-07-15 — el gate de aprovisionamiento queda levantado (resta solo el gate operativo de cuentas/billing).

- **Q-2 (E2E §23)**: plan de Neon/Railway. **Decisión: free tiers primero, upgrade pre-prod** — staging se aprovisiona en tiers gratuitos (Neon Free incluye `pgvector`+HNSW; ventana de restore mínima y autosuspend aceptados para staging); upgrade a plan pago (PITR/backup real) es **gate previo al primer deploy productivo**, verificado por `/plan-deployment`. `[cerrada 2026-07-15 — PO]`.
- **Q-3 (E2E §23)**: residencia de PII (Ley 25.326). **Decisión: US-East + consentimiento informado** — la transferencia internacional se cubre vía consentimiento en el registro + política de privacidad (US-017 contempla el consentimiento); la Ley 25.326 no exige residencia local. Región revisable si Legal objeta a futuro. `[cerrada 2026-07-15 — PO/Legal]`.
- **Q-D (SLO)**: **99.5% mensual** (tier 2, heredado del E2E §17, coherente con Railway single-AZ). `[cerrada 2026-07-15 — PO confirma]`.
- **Q-E (sink de logs)**: **diferir el sink de retención** (Better Stack/Loki) a una tarea posterior si el budget lo permite; Sentry cubre errores. Se acepta perder logs históricos no-error mientras tanto. `[cerrada 2026-07-15 — PO confirma]`.

## References

- User Story: `docs/user-stories/US-001-admin-catalogo-productos.md`
- E2E: `docs/product/design-e2e.md` §13 (despliegue), §17 (NFRs), §18 (observabilidad), §18.5 (operatividad/runbook)
- ADRs: `docs/architecture/decisions/0001-platform-railway-neon-r2.md`, `0002-postgresql-pgvector-single-datastore.md`
- Change gemelo (prerequisito): `openspec/changes/US-001-admin-catalogo-productos-bootstrap-local-infrastructure/`
- Siguiente: `/plan-deployment US-001` (primer deploy vivo, tras scaffolding de app)
