---
tracker-id: null
tracker-source: null
parent-us: US-005
discipline: infrastructure
variant: null
language: es
audit-derived: false
---

# Proposal — US-005 Enriquecimiento IA + embeddings (infrastructure)

> **Ticket**: US-005 — Enriquecimiento IA de descripciones + generación de embeddings
> **Author**: infrastructure-developer agent (assisted by @gabogosp)
> **Date**: 2026-09-08
> **Status**: Proposed — **planificación únicamente, `Blocked-by:
> US-019-provision-plataforma-cloud-infrastructure`** (ver "Qué cambia" abajo)
> **Affected layers**: Railway service variables (secrets), ninguna capa de código
> **Affected platform**: infra/cloud (Railway, servicio `api`)

## Why

US-005 §7 presupuestaba esta disciplina como "despliegue del proceso worker (BullMQ) + secrets
del proveedor IA + tabla de embeddings con índice vectorial (HNSW) en pgvector" — la lectura
literal de la US, escrita antes de que existiera una decisión de arquitectura sobre CÓMO se
ejecuta el enriquecimiento. Esa lectura ya no es la correcta: **ADR-0014** (`docs/architecture/
decisions/0014-in-process-enrichment-executor.md`, Accepted 2026-08-22, `Superseded by: —`,
ningún ADR posterior lo revierte) decidió que el ejecutor de enriquecimiento + embeddings corre
**in-process dentro de `apps/api`**, no en un worker BullMQ separado. La verificación del
código en `origin/main` lo confirma: `git grep -i "REDIS_URL\|ioredis\|bullmq\|@nestjs/bull"`
sobre rutas de runtime (excluyendo tests/docs) no devuelve nada — Redis/BullMQ no se usa hoy.
`apps/worker` sigue siendo, a propósito, un README de una línea (ver "Non-goals").

Con eso resuelto (confirmado con la coordinadora, quien validó el hallazgo contra el código),
el alcance real de esta disciplina para US-005 es mucho más chico que el original de la US: **no
hay ningún proceso que deployar** — el código que ejecuta el enriquecimiento ya vive dentro del
servicio `api` que `US-019-provision-plataforma-cloud-infrastructure` está aprovisionando. Lo
único que falta del lado de infraestructura es **llenar el slot de secreto** que ese mismo change
ya reservó (`design.md` "Secretos": *"`GEMINI_API_KEY` — slot (US-005)"*) con el valor real, y
confirmar que las variables de comportamiento que el código ya lee con defaults seguros
(`ENRICHMENT_ENABLED`, `GEMINI_ENRICH_MODEL`, `GEMINI_EMBED_MODEL`, `GEMINI_MAX_RPM`, etc.)
quedan explícitas y correctas en el entorno de `staging`.

## What changes

**Un solo change, totalmente bloqueado hasta que `US-019-provision-plataforma-cloud-
infrastructure` cree el proyecto Railway + el servicio `api` en `staging` (sus tasks T1.1/T1.2)
y el slot de `GEMINI_API_KEY` (su task T2.1).** No hay ninguna parte ejecutable hoy — a
diferencia de los planes en dos fases de FE (US-024/US-025), acá no existe una "Fase A" sin
dependencia externa: todo el trabajo es cargar una variable en un servicio Railway que todavía
no existe.

Cuando el servicio exista:
- Cargar el valor real de `GEMINI_API_KEY` (ya validado por la coordinadora) como Railway
  service variable del servicio `api`, en el entorno `staging`.
- Confirmar/setear `ENRICHMENT_ENABLED=true` explícito en `staging` (el código default a
  `'true'` si la variable falta, pero un valor explícito documenta la intención en vez de
  depender de un default silencioso — mismo criterio que el resto de las variables de
  comportamiento de este proyecto, `env.validation.ts`).
- Verificar que el arranque del servicio `api` en `staging` NO reporta el runner en estado
  `disabled` por falta de clave (`GET /v1/admin/enrichment/status`).
- Documentar (sin corregir) la referencia stale que `US-019-provision-plataforma-cloud-
  infrastructure/design.md` línea 16 hace a un worker BullMQ real — ver "Open questions" #1.
  (Verificado: ADR-0004 en sí NO está stale — ya declara `Amended by: ADR-0014` explícito; el
  hueco es sólo esa línea del design.md de US-019.)

## Out of scope

- **Deploy de `apps/worker` como servicio Railway** — explícitamente diferido por el propio
  ADR-0014 hasta que se cumpla su criterio de migración (`REDIS_URL` exista **Y** `apps/worker`
  esté deployado, o el catálogo supere ~10.000 SKUs, o el import deje de ser ocasional).
  Ninguna de esas condiciones está dada hoy.
- **Redis / add-on de Railway** — no lo usa el runner de enriquecimiento (ADR-0014); el add-on
  que `US-019-provision-plataforma-cloud-infrastructure` T1.3 provisiona es para otros usos
  futuros del proyecto, no una dependencia de este change.
- **`railway.json` de `apps/worker`** — no se crea. `apps/worker` sigue siendo el placeholder
  README hasta el criterio de migración del ADR.
- **El entorno `production`** — este change carga el secreto sólo en `staging`, mismo alcance
  que el resto de `US-019-provision-plataforma-cloud-infrastructure` (production queda gated,
  `/plan-deployment` lo cubre cuando corresponda — mismo criterio que el dominio custom, T2.2).
- **Cambios de código** — `apps/api` ya lee `GEMINI_API_KEY`/`ENRICHMENT_ENABLED` correctamente
  (`env.validation.ts`, `apps/api/src/enrichment/`); este change es puramente de configuración
  de infraestructura, cero líneas de TypeScript.
- **Corregir la referencia stale en `US-019.../design.md` línea 16 o en ADR-0004** — se deja
  anotada como deuda de documentación (Open questions #1), no se toca en este change (fuera de
  su alcance disciplinar: un change de INFRA no reescribe el design.md de otro change activo ni
  edita un ADR ajeno).

## Affected components / screens

- Ninguno del lado de código. El único artefacto que este change modifica es el estado de
  Railway (service variables del servicio `api`, entorno `staging`) — fuera del repositorio.
- `openspec/specs/plataforma-cloud/` (o la capacidad que corresponda cuando
  `US-019-provision-plataforma-cloud-infrastructure` archive) recibe, al archivar este change,
  la nota de que el slot `GEMINI_API_KEY` quedó lleno.

## Acceptance criteria

Este change no re-declara los AC funcionales de US-005 (son responsabilidad de BE, ya
archivado) — cubre únicamente la precondición de infraestructura que esos AC necesitan para
poder ejercitarse en `staging`:

- [x] `GEMINI_API_KEY` está seteada en Railway, servicio `api`, entorno `staging`, con el valor
      real (no el placeholder `replace-me` de `.env.example`).
- [x] `ENRICHMENT_ENABLED=true` está explícito en el mismo servicio/entorno.
- [x] El servicio `api` arranca en `staging` sin el mensaje de degradación
      "GEMINI_API_KEY ausente" en sus logs, y `GET /v1/admin/enrichment/status` no reporta
      `disabled` por falta de clave.
- [x] Ningún secreto real queda comiteado en el repo (mismo gate que T2.1 de
      `US-019-provision-plataforma-cloud-infrastructure`).

## Standards consulted

- `docs/architecture/decisions/0014-in-process-enrichment-executor.md` (la decisión que fija el
  alcance real de este change).
- `docs/architecture/decisions/0004-redis-bullmq-async-processing.md` (ya declara `Amended by:
  ADR-0014` explícito — verificado, no stale).
- `docs/architecture/aws-lightsail-baseline.md` — N/A, este proyecto usa el baseline Railway
  (ADR-0001), no AWS Lightsail; los principios de "secrets nunca en repo, rotación = cambio de
  var + redeploy" son los mismos que aplica `US-019-provision-plataforma-cloud-infrastructure`.
- `openspec/changes/US-019-provision-plataforma-cloud-infrastructure/design.md` §Secretos —
  el slot que este change llena, y el precedente de formato de task (`T2.1`).
- `docs/code/backend-node-standards.md` — N/A para este change (cero código).

## Open questions

1. **[Deferred: documentado, no corregido en este change]** `US-019-provision-plataforma-cloud-
   infrastructure/design.md` línea 16 sigue describiendo un worker BullMQ real para US-005
   ("`railway.json` de `worker` → US-005"), una referencia que quedó stale frente a ADR-0014
   (aceptado después de esa línea). No es un bloqueante para este change (que sólo carga un
   secreto), pero es deuda de documentación real: alguien debería actualizar esa línea del
   design.md de US-019 para reflejar que el worker queda diferido por el criterio de migración
   del ADR, no entregado por este change. Corregirlo es trabajo de quien posea ese documento (el
   change de US-019 sigue activo), no de este change de alcance disciplinar distinto. (ADR-0004,
   por contraste, ya está al día — declara `Amended by: ADR-0014` explícito, verificado.)
