---
tracker-id: null
tracker-source: null
parent-us: US-005
discipline: infrastructure
variant: null
language: es
audit-derived: false
---

# Design — US-005 Enriquecimiento IA + embeddings (infrastructure)

## Context

Este change existe porque hay una brecha real entre tres fuentes, cronológicamente ordenadas:

1. **US-005 §7** (escrita 2026-06-15): "INFRA: despliegue del proceso worker (BullMQ) + secrets
   del proveedor IA + tabla de embeddings con índice vectorial (HNSW) en pgvector."
2. **`US-019-provision-plataforma-cloud-infrastructure/design.md`** (activo, última edición
   2026-08-18): reserva un slot `GEMINI_API_KEY` para que "las US que los usan" lo llenen, y en
   su línea 16 defiere explícitamente "`railway.json` de `worker` → US-005 (la app worker es
   sólo un placeholder README)" — es decir, ese plan **todavía asume** que este change va a
   deployar un worker BullMQ real.
3. **ADR-0014** (`docs/architecture/decisions/0014-in-process-enrichment-executor.md`, Accepted
   2026-08-22 — **posterior** a la última edición de (2)): decide que el ejecutor de
   enriquecimiento corre **in-process dentro de `apps/api`**, no en un worker separado, y fija un
   criterio de migración explícito para cuándo SÍ correspondería levantar `apps/worker`.

`Superseded by: —` en el ADR, y ningún ADR posterior lo revierte. Se verificó además contra el
código real en `origin/main`:

```
git grep -iE "REDIS_URL|ioredis|bullmq|@nestjs/bull" -- ':!*.spec.ts' ':!*.md' ':!openspec/*'
```

no devuelve ningún resultado en rutas de runtime — Redis/BullMQ no se usa hoy en ningún proceso
desplegable. Esto confirma que (2) quedó desactualizado frente a (3), no al revés. La
coordinadora del proyecto validó este hallazgo antes de que se escribiera este plan (no es una
decisión unilateral de este change — ver el intercambio que originó este `design.md`).

**Consecuencia para el alcance de esta disciplina**: no hay ningún proceso "worker" que
aprovisionar o deployar. El trabajo real de INFRA para US-005 se reduce a llenar, con el valor
real, un slot de secreto que otro change (`US-019-provision-plataforma-cloud-infrastructure`) ya
reservó — y a confirmar que las variables de comportamiento del runner (que el código ya lee con
defaults seguros) quedan explícitas en el entorno donde corre.

## Goals

- `GEMINI_API_KEY` cargada como Railway service variable real (no el placeholder de
  `.env.example`) en el servicio `api`, entorno `staging`.
- `ENRICHMENT_ENABLED=true` explícito en el mismo servicio/entorno — no depender del default de
  código en silencio, mismo criterio que el resto de las variables de comportamiento del
  proyecto.
- Confirmación operativa (no sólo "la variable está seteada" sino "el runner arrancó habilitado
  con ella") de que el enriquecimiento puede ejercitarse de verdad en `staging`.

## Non-goals

- Deployar `apps/worker` como servicio Railway, o crear su `railway.json` — diferido por el
  criterio de migración de ADR-0014 (`REDIS_URL` exista **y** `apps/worker` esté deployado, o el
  catálogo supere ~10.000 SKUs, o el import deje de ser ocasional). Ninguna condición se cumple
  hoy.
- Provisionar o configurar el add-on Redis de Railway — no lo consume este workload (ADR-0014).
  El add-on que `US-019...` T1.3 provisiona es para necesidades futuras del proyecto, no una
  dependencia de este change.
- Cambiar el entorno `production` — mismo alcance-solo-`staging` que el resto de
  `US-019-provision-plataforma-cloud-infrastructure` en su estado actual (production queda
  gated a `/plan-deployment`).
- Escribir o modificar código de `apps/api` — ya lee las variables correctamente
  (`env.validation.ts`, `apps/api/src/enrichment/ai/ai.providers.ts`).
- Corregir la línea stale de `US-019.../design.md` — pertenece a un change activo ajeno; se
  documenta como Open question, no se edita acá.

## Approach

### D1 — Por qué el alcance es "llenar un slot", no "aprovisionar infraestructura nueva"

`US-019-provision-plataforma-cloud-infrastructure/design.md` §Secretos ya declaró la forma
exacta: *"Railway service variables (cifradas), por entorno. Slots a crear (valores reales los
cargan las US que los usan) ... `GEMINI_API_KEY` — slot (US-005)."* Ese change es dueño de la
mecánica (cómo se crean las variables, en qué servicio, con qué gate de no-secretos-en-repo);
este change es dueño únicamente del **valor** — igual que `RESEND_API_KEY` es un slot para
US-011 y `MP_ACCESS_TOKEN`/`MP_WEBHOOK_SECRET`/`MP_PUBLIC_KEY` lo son para US-009. No se
reinventa el mecanismo de carga de secretos; se ejecuta la misma task-shape que T2.1 de
`US-019...`, acotada a esta única variable.

### D2 — Qué variables además de `GEMINI_API_KEY` hace falta setear, y cuáles no

Lectura completa de `apps/api/src/config/env.validation.ts` (sección "US-005 — enriquecimiento
IA + embeddings"):

| Variable | Default de código | ¿Este change la setea explícita? |
|---|---|---|
| `GEMINI_API_KEY` | ninguno (opcional a nivel de campo, **requerida si `NODE_ENV=production`** vía `superRefine`) | **Sí — es el propósito de este change.** |
| `ENRICHMENT_ENABLED` | `'true'` | **Sí, explícito** — aunque el default ya es `true`, declararlo documenta la intención en vez de depender de un default silencioso (mismo criterio que el resto de flags de comportamiento del proyecto — evita que un cambio futuro del default en código apague el enriquecimiento en `staging` sin que nadie lo note). |
| `GEMINI_ENRICH_MODEL` | `'gemini-1.5-flash'` (ADR-0003) | No — el default ES la decisión de ADR-0003; setearlo explícito no agrega nada y crea un segundo lugar para desincronizar el modelo si ADR-0003 cambia. |
| `GEMINI_EMBED_MODEL` | `'text-embedding-004'` (ADR-0003) | No — mismo motivo. |
| `GEMINI_ENRICH_TIMEOUT_MS` / `GEMINI_EMBED_TIMEOUT_MS` | `20000` / `10000` | No — tuning de resiliencia ya decidido en el BE, no una decisión de infra. |
| `GEMINI_MAX_RPM` | `5` | No — el runbook de la primera corrida (ADR-0014 "Implementation notes") ya documenta subirlo puntualmente a `15` como paso operativo, no como default persistente. Este change no toca esa variable; si/cuando se ejecute la primera corrida grande, es una acción manual puntual del runbook, no una task de este plan. |
| `ENRICHMENT_BATCH_SIZE` / `ENRICHMENT_CONCURRENCY` / `ENRICHMENT_MAX_ATTEMPTS` / `ENRICHMENT_LEASE_MS` / `ENRICHMENT_COOLDOWN_MS` | ver schema | No — tuning de resiliencia del BE, no de infra. |

**Regla aplicada**: sólo se setea explícito lo que (a) el código exige en producción
(`GEMINI_API_KEY`) o (b) es un kill-switch operativo cuyo default silencioso sería peligroso de
asumir sin verificar (`ENRICHMENT_ENABLED`). Todo lo demás son decisiones de tuning que ya tomó
el BE al archivar su change — repetirlas acá como variables de infra sería una segunda fuente de
verdad para el mismo número.

### D3 — `NODE_ENV` y el gate de producción no aplican todavía a `staging`

El `superRefine` de `env.validation.ts` que exige `GEMINI_API_KEY` sólo se activa con
`NODE_ENV=production` (`if (env.NODE_ENV !== 'production') return;`). En `staging`, la ausencia
de la clave NO rompe el arranque — el runner simplemente queda `disabled` (mismo camino de
degradación elegante que en producción, sólo que sin el gate duro). Esto significa que cargar
`GEMINI_API_KEY` en `staging` es un requisito **funcional** de este change (sin ella no hay nada
que verificar) pero no uno que la propia app fuerce en ese entorno — el `Verify:` de la task
tiene que comprobar el estado real del runner (`GET /v1/admin/enrichment/status`), no sólo la
ausencia de un error de arranque.

### D4 — Por qué este change no tiene una "Fase A" ejecutable ahora

A diferencia de los planes en dos fases de frontend-web (US-024/US-025), donde Fase A podía
construir componentes presentacionales sin ningún backend, acá **no existe ningún trabajo
disociado de la infraestructura externa**: cargar una variable en un servicio Railway requiere
que ese servicio exista. Por eso este change es un único bloque, íntegramente
`Blocked-by: US-019-provision-plataforma-cloud-infrastructure` (específicamente sus tasks T1.1
"crear el proyecto Railway", T1.2 "crear los servicios `web`/`api`/`worker`" y T2.1 "cargar los
secretos... slots"). Verificado contra `US-019.../tasks.md`: T1.1, T1.2 y T2.1 siguen `[ ]` sin
cerrar al momento de planificar este change — no hay nada que ejecutar todavía, sólo dejar el
plan listo para el momento en que sí lo haya.

## Test plan

No hay tests de código (cero líneas de TypeScript). La verificación es operativa:

- **T1** (pre-flight, hereda el gate de `US-019...`): Railway CLI autenticada.
- **T2**: `railway variables --service api --environment staging` lista `GEMINI_API_KEY` con un
  valor no vacío y distinto del placeholder `replace-me` de `.env.example`, y `ENRICHMENT_ENABLED`
  con valor `true`.
- **T3**: contra el servicio desplegado, `GET /v1/admin/enrichment/status` no reporta el runner
  `disabled` por falta de clave (requiere sesión admin — mismo mecanismo bootstrap-token que el
  resto del panel).
- **T4** (gate heredado de `US-019...` T2.1): `git grep` de patrones de secretos reales no
  encuentra nada comiteado.

## Riesgos y mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Se ejecuta este change fuera de orden (antes de que exista el servicio `api` en Railway) | baja (el `Blocked-by` es explícito y verificable) | medio (comando falla contra un servicio inexistente, sin daño real) | Cada task valida la precondición (`railway services list` debe mostrar `api` en `staging`) antes de intentar setear la variable. |
| Alguien lee la US-005 original (§7) o la línea stale de `US-019.../design.md` y asume que hay que deployar un worker BullMQ | media (son dos fuentes escritas y visibles) | medio (trabajo duplicado/erróneo si alguien lo intenta) | Este `design.md` §Context documenta la cadena completa de por qué esas dos fuentes quedaron desactualizadas frente a ADR-0014, con la verificación de código que lo confirma — no depende de que el lector confíe en la afirmación sin evidencia. |
| El default de `ENRICHMENT_ENABLED` cambia en el código sin que nadie lo note, apagando el enriquecimiento en `staging` en silencio | baja | bajo (se detecta en la primera verificación manual de cobertura) | Este change lo setea explícito — un cambio futuro del default de código no afecta lo que ya está declarado en Railway. |

## References

- ADR: `docs/architecture/decisions/0014-in-process-enrichment-executor.md` (la decisión que
  fija el alcance de este change).
- ADR: `docs/architecture/decisions/0004-redis-bullmq-async-processing.md` (ya declara
  `Amended by: ADR-0014`, verificado — no stale).
- ADR: `docs/architecture/decisions/0003-google-gemini-ai-provider.md` (proveedor y modelos).
- Change hermano: `openspec/changes/US-019-provision-plataforma-cloud-infrastructure/` (dueño
  del mecanismo de carga de secretos y del servicio Railway que este change depende).
- Código: `apps/api/src/config/env.validation.ts` (schema de las variables), `apps/api/src/
  enrichment/ai/ai.providers.ts` (factory que decide `disabled` vs. proveedor real).
- US: `docs/user-stories/US-005-enriquecimiento-ia-embeddings.md`.
