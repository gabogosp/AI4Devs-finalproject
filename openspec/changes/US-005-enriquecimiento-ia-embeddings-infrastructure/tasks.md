---
parent-us: US-005
discipline: infrastructure
variant: null
language: es
---

# US-005 Infrastructure — Tasks

> Cada task es closure-grade: atómica, con `Exit criterion:` observable y `Verify:` con el
> comando exacto. Ninguna task es ejecutable hoy — el change entero es
> `Blocked-by: US-019-provision-plataforma-cloud-infrastructure` (design.md §D4): no existe
> ningún trabajo disociado de que ese change cree primero el proyecto Railway y el servicio
> `api`. `/develop-infrastructure-ticket` debe reportar el bloqueo si se le pide avanzar sin que
> esa condición esté cumplida — no debe intentar los comandos igual "para ver qué pasa".

## Pre-requisitos (heredados de `US-019-provision-plataforma-cloud-infrastructure`)

- [ ] **T0 — Confirmar que el servicio `api` existe en Railway, entorno `staging`**
  - **Blocked-by**: US-019-provision-plataforma-cloud-infrastructure (T1.1 "crear el proyecto
    Railway", T1.2 "crear los servicios `web`/`api`/`worker`")
  - **Pattern**: `per US-019.../tasks.md` T1.1/T1.2 — mismo CLI, mismo criterio de
    autenticación previa (`railway login`, gate ya declarado en ese change).
  - **Exit criterion**: `railway services list --environment staging` incluye un servicio
    `api`. Sin esto, ninguna task siguiente puede ejecutarse.
  - **Verify**: `railway services list --environment staging | grep -qx api` (o `grep -q
    '\bapi\b'` si el CLI no imprime una línea por servicio — ajustar al formato real de
    salida del CLI en el momento de ejecutar, documentado en el `Pattern` de T2.1 de
    `US-019...`)

## Cargar el secreto (llena el slot que `US-019...` T2.1 ya reservó)

- [ ] **T1 — Setear `GEMINI_API_KEY` real en el servicio `api`, entorno `staging`**
  - **Blocked-by**: T0, US-019-provision-plataforma-cloud-infrastructure (T2.1 "cargar los
    secretos... slots")
  - **Pattern**: `per US-019.../tasks.md` T2.1 — `railway variables set` (o el dashboard),
    mismo mecanismo ya usado para `DATABASE_URL`/`REDIS_URL`/`SENTRY_DSN`. El valor real de
    la clave lo carga la coordinadora/PO directamente (ya validado contra el proveedor,
    fuera de este repo) — esta task NO incluye generar ni rotar la clave, sólo cargarla.
  - **Exit criterion**: `GEMINI_API_KEY` existe en las variables del servicio `api`,
    entorno `staging`, con un valor no vacío y distinto del placeholder `replace-me` de
    `.env.example`.
  - **Verify**: `railway variables --service api --environment staging | grep GEMINI_API_KEY`
    devuelve una línea con un valor que NO es `replace-me` ni está vacío (el propio CLI de
    Railway enmascara el valor real en su salida — el chequeo es sobre la presencia de la
    variable con longitud > 0, no sobre su contenido literal, que nunca debe imprimirse en un
    log ni quedar en este repo).

- [ ] **T2 — Setear `ENRICHMENT_ENABLED=true` explícito en el mismo servicio/entorno**
  - **Blocked-by**: T0
  - **Pattern**: `per design.md §D2` — explícito aunque coincide con el default de código
    (`env.validation.ts`), mismo criterio que declarar `@StorefrontCache` explícito por
    handler en US-025/US-026 en vez de heredar un default en silencio.
  - **Exit criterion**: `ENRICHMENT_ENABLED` existe en las variables del servicio `api`,
    entorno `staging`, con valor exactamente `true`.
  - **Verify**: `railway variables --service api --environment staging | grep
    'ENRICHMENT_ENABLED=true'`

## Verificación operativa (el runner arrancó habilitado, no sólo "la variable existe")

- [ ] **T3 — Confirmar que el runner no reporta `disabled` por falta de clave**
  - **Blocked-by**: T1, T2, y que el servicio `api` haya hecho al menos un deploy/restart
    después de T1/T2 (Railway no re-lee variables de un proceso ya corriendo — hace falta un
    redeploy, mismo criterio que "rotación = cambio de var + redeploy" de
    `US-019.../design.md` §Secretos).
  - **Pattern**: `per apps/api/src/enrichment/enrichment.controller.ts` — `GET
    /v1/admin/enrichment/status` devuelve `runner_state` (`'idle' | 'running' | 'cooldown' |
    'disabled'`); gateado por `AdminGuard`, mismo login por bootstrap-token que el resto del
    panel admin (`POST /v1/admin/auth/login` con el bootstrap token de ese entorno).
  - **Exit criterion**: `runner_state` en la respuesta es distinto de `'disabled'`
    (esperablemente `'idle'`, recién desplegado y sin corrida en curso).
  - **Verify**:
    ```bash
    TOKEN=$(curl -s -X POST https://<host-api-staging>/v1/admin/auth/login \
      -H "Content-Type: application/json" \
      -d "{\"bootstrapToken\":\"$STAGING_ADMIN_BOOTSTRAP_TOKEN\"}" | python3 -c \
      "import sys,json; print(json.load(sys.stdin)['token'])")
    curl -s https://<host-api-staging>/v1/admin/enrichment/status \
      -H "Authorization: Bearer $TOKEN" | python3 -c \
      "import sys,json; d=json.load(sys.stdin); exit(0 if d['runner_state'] != 'disabled' else 1)"
    ```
    (host real y bootstrap token de `staging` se resuelven al ejecutar — no existen todavía
    porque el servicio no está desplegado; ver T0).

- [ ] **T4 — Confirmar que ningún secreto real quedó comiteado (gate heredado)**
  - **Pattern**: `per US-019.../tasks.md` T2.1 — mismo patrón de escaneo, extendido al
    prefijo de clave de Gemini (`AIza...`).
  - **Exit criterion**: ningún valor real de `GEMINI_API_KEY` aparece en el repositorio.
  - **Verify**: `git grep -Ei 'AIza[A-Za-z0-9_-]{20,}' -- . ':(exclude)*.md'` no devuelve nada
    (exclusión de `.md` por el mismo motivo F57 que `US-019.../tasks.md` documenta: el propio
    patrón de este `tasks.md` no debe auto-matchear).

## Verification (nivel de suite)

- [ ] Las 4 tasks anteriores cerradas `[x]`.
- [ ] `GET /v1/admin/enrichment/status` (T3) confirma `runner_state != 'disabled'` en
      `staging` — evidencia de que la precondición de infraestructura para los AC-1 a AC-10
      de US-005 (ya implementados por BE) está satisfecha en ese entorno.
