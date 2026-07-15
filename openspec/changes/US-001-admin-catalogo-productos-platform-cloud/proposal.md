---
tracker-id: null
tracker-source: null
parent-us: US-001
discipline: INFRA
language: es
---

# US-001 Platform cloud — provisioning Railway + Neon + Cloudflare R2, secretos, autodeploy y runbook

## Why

`bootstrap-local` desbloquea el desarrollo el día 1 sin credenciales de nube. Este change es la **pista paralela**: aprovisiona la plataforma real (Railway para compute + Redis, Neon para PostgreSQL con `pgvector`, Cloudflare para DNS/CDN/R2), configura secretos, autodeploy desde GitHub, DNS/TLS, observabilidad y el **runbook del nuevo servicio**. Aplica a la nube el esquema del catálogo autorizado en `bootstrap-local` (la nube es una confirmación posterior, nunca la primera validación).

Se separa de `bootstrap-local` por mandato del baseline Railway §0: local y nube tienen urgencia, dependencias y dueño distintos. Este change está **gated en dependencias externas** (cuentas Railway/Neon/Cloudflare, billing en ARS, y la pregunta de residencia de datos AR — E2E §23 Q-3) y **no** está en el camino crítico de desbloquear a las disciplinas. El **primer deploy vivo** (prueba de autodeploy, DNS/TLS en vivo, checklist pre-prod) lo planifica `/plan-deployment` cuando exista una app scaffoldeada — no acá.

## What changes

- **Proyecto Railway único** con los servicios `web` (Next.js SSR), `api` (NestJS) y `worker` (BullMQ), más el add-on gestionado **Redis**, en entornos `staging` y `production` (E2E §13). Config vía `railway.json`/`railway.toml` en el repo — **no Terraform** (Railway es PaaS).
- **Neon PostgreSQL** con la extensión `pgvector` habilitada, plan que garantice `pgvector`+HNSW y PITR/snapshots diarios (E2E §23 Q-2), región US-East por defecto (revisable según Q-3).
- **Cloudflare R2** bucket para imágenes de productos + Cloudflare DNS/CDN delante del dominio Railway.
- **Secretos** en Railway service variables (MP keys, Gemini key, Resend key, JWT secret, `DATABASE_URL` de Neon, `REDIS_URL`) — nunca en repo ni imagen (E2E §13).
- **Autodeploy** vía integración GitHub de Railway (`main` → production, `staging` → staging) + gate de GitHub Actions (la CI de `bootstrap-local`) antes del deploy.
- **Aplicación del esquema a la nube**: `prisma migrate deploy` (desde `packages/db`) contra el Neon de `staging` — misma migración autorizada en local.
- **TLS** automático (Railway/Cloudflare) sobre el dominio custom.
- **Observabilidad** (E2E §18, desviación OSS ratificada en ADR-0001): Sentry (errores FE+BE), `pino` JSON → Railway logs, métricas Railway, alertas Sentry → email/Slack. Wiring de proyectos Sentry y variables `SENTRY_DSN`.
- **Runbook del nuevo servicio** en `docs/services/dsm-ecommerce/runbook.md`: esqueleto autorizado ahora (deploy/rollback, restore Neon PITR RTO ≤ 4h, rotación de secretos, cola BullMQ atascada, webhook MP), tomando los runbooks day-2 del E2E §18.5 como fuente.

## ACs de US-001 cubiertos

Ninguno directamente — este change no implementa comportamiento funcional. Habilita el **sustrato de nube** sobre el que corre lo que sí cubre los AC (BE/FE). Su contribución a US-001 es operativa: que el catálogo autorizado localmente pueda vivir en staging con backups, secretos y observabilidad.

## Out of scope

- **Todo lo de `bootstrap-local`** (esqueleto, docker-compose, esquema autorizado local, CI-de-PR) — es su change gemelo y prerequisito de la tarea de aplicar migraciones a la nube.
- **El primer deploy vivo + validación** (autodeploy probado extremo a extremo, DNS/TLS en vivo, checklist pre-prod, smoke test del loop) → `/plan-deployment` cuando haya app deployable.
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

- **Q-2 (E2E §23)**: plan concreto de Neon/Railway que garantice `pgvector`+HNSW y PITR. `[propuesto — confirma Arquitecto]`. Bloquea la ejecución de este change (no su autoría): sin plan confirmado no se aprovisiona.
- **Q-3 (E2E §23)**: ¿Ley 25.326 exige residencia de PII en Argentina? Define la región de Neon/Railway. Default US-East; ajustable. `[propuesto — confirma PO/Legal]`. Es un **gate externo** de este change.
- **Q-D (SLO)**: se propone tier 2 — **99.5% mensual** (heredado del E2E §17, coherente con Railway single-AZ). `[propuesto — confirma Ops/Arquitecto]`.
- **Q-E (sink de logs)**: Railway logs rota; el baseline §5 pide un sink de retención. Se propone diferir el sink de retención (Better Stack/Loki) a una tarea posterior si el budget lo permite, dado que Sentry cubre errores. `[propuesto — confirma Arquitecto]`.

## References

- User Story: `docs/user-stories/US-001-admin-catalogo-productos.md`
- E2E: `docs/product/design-e2e.md` §13 (despliegue), §17 (NFRs), §18 (observabilidad), §18.5 (operatividad/runbook)
- ADRs: `0001-platform-railway-neon-r2.md`, `0002-*` (pgvector)
- Change gemelo (prerequisito): `openspec/changes/US-001-admin-catalogo-productos-bootstrap-local/`
- Siguiente: `/plan-deployment US-001` (primer deploy vivo, tras scaffolding de app)
