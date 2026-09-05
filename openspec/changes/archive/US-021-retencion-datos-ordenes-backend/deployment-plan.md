# Deployment Plan — US-021 Backend: Retención y anonimización de PII de órdenes

> **Ticket**: US-021 (Ley 25.326 — retención y anonimización de datos de órdenes)
> **Author**: deployment-planner agent (assisted by @gosp)
> **Date**: 2026-08-31
> **Status**: Proposed
> **Platform(s) affected**: backend (NestJS API — `apps/api`, módulo `checkout/`)
> **Service tier**: 2 (`docs/services/dsm-ecommerce/runbook.md` frontmatter — la única fuente de tier que existe en este repo; no hay `service-catalog.yaml`)
> **Deploy class**: non-trivial (razonamiento explícito en §0)
> **Companion files**: `proposal.md`, `tasks.md`, `design.md` (no existe `qa-plan.md` para este change — ver §6 y Standards gaps)

---

## 0. Grounding: no existe todavía un entorno de producción real

Antes de clasificar y planear, un hecho gobierna todo lo demás: **este proyecto nunca desplegó a un entorno cloud real.**

Verificado directamente (no asumido):

- `docs/RUN-MVP.md` — el documento operativo vigente — lista *"infra cloud (US-019)"* bajo **"Roadmap (planeado, no en esta entrega)"**. Todo lo que hoy "corre" es local (`docker compose` + `pnpm`).
- No existe `service-catalog.yaml` en ningún lado del repo.
- No existe `docs/slo.yaml` ni `services/*/docs/slo.yaml`.
- **Sí existe** `docs/services/dsm-ecommerce/runbook.md` — pero su propio frontmatter dice `status: Skeleton`, y el cuerpo lo confirma explícitamente: *"Estado: esqueleto autorizado en US-019... Los valores marcados `[pendiente: T…]` se completan cuando la task de provisioning correspondiente cierre... **No inventar** un valor para llenar un hueco."* Dashboards de Sentry/Railway: `[pendiente: T4.2]`. Alertas: `[pendiente: T4.3]`. On-call formal: `[pendiente — se define en /plan-deployment]`.
- `.github/workflows/*.yml` (`ci.yml`, `qa.yml`, `consumer-contract-check.yml`, `frontend-codegen-fresh.yml`) corren lint/test/build/migrate contra el Postgres **efímero de CI** (`services: postgres` en el propio job). Ningún workflow hace `deploy` a Railway.
- `docs/architecture/decisions/0001-platform-railway-neon-r2.md` fija la plataforma (Railway + Neon + Cloudflare R2) — es la decisión, no evidencia de que esté provisionada. `docs/architecture/railway-baseline.md` §0.3 confirma que `platform-cloud` (el track que provisiona todo esto) corre **en paralelo**, gateado en cuentas/billing/legal, y **no está completo todavía**.

**Consecuencia para este plan**: las secciones que en un proyecto con producción viva citarían dashboards, thresholds medidos y un ORR formal, acá documentan honestamente **qué falta provisionar** en vez de inventar valores. Esto no es una advertencia aislada: cambia la forma de §2 (estrategia — descrita en dos tiempos), §7 (señales — "qué se va a instrumentar" en vez de números), y §9 (el ítem operativo para `doc-updater` es "crear la primera entrada de este tipo en el runbook esqueleto", no "actualizar la sección X del runbook existente").

**Gate de migración brownfield**: no aplica — `project-config.yml` declara `project.type: technical` sin `mode: migration`; este es un proyecto greenfield.

---

## 1. Executive summary

Este change agrega dos endpoints admin (`POST /v1/admin/orders/:id/anonymize`, `POST /v1/admin/orders/retention-sweep`) y un runner de arranque oportunista que anonimizan de forma **irreversible** los tres campos de contacto del comprador invitado en `orders`, cumpliendo la política de retención de 12 meses de la Ley 25.326. La migración es puramente aditiva (2 columnas nullable + 2 `CHECK`, sin tocar filas existentes) y la superficie reusa el `AdminGuard` ya en producción potencial en `/v1/admin/categories|products|imports` — no hay mecanismo de auth nuevo, ni secreto nuevo, ni feature flag.

**Clasificación**: `non-trivial` (no `high-risk`) — razonamiento en §0.1 abajo. El riesgo mecánico es bajo (guard reusado, migración trivialmente segura, sin dependencia externa nueva), pero es la **primera vez** que el proyecto expone una acción que **destruye PII de forma irreversible por diseño**, y depende de una pieza operativa (el disparador mensual real) que este change **no** provisiona. Como no existe producción viva hoy, "desplegar" en este momento significa: el código llega a `main` y espera a que exista un entorno donde correr — el go/no-go real de este plan es sobre todo para **el día en que exista `staging`/`production` en Railway** (dirigido por US-019), no para hoy.

### 0.1 Por qué `non-trivial` y no `high-risk` (razonamiento explícito, no una moneda al aire)

A favor de `high-risk`: el criterio de la plantilla incluye literalmente *"irreversible data change"*, y este change hace exactamente eso — anonimizar es, por diseño, no reversible (US §9).

En contra de escalarlo a `high-risk`: (1) la irreversibilidad es una **decisión de negocio deliberada y ya probada**, no un accidente de migración — `tasks.md` Fase 5 (T5.1–T5.6) ya cubre negative-space para AC-6 (nada se borra), AC-7 (consentimiento sobreviene), AC-8 (idempotencia estructural vía `WHERE anonymized_at IS NULL`); (2) el mecanismo de autorización no es nuevo — es el mismo `AdminGuard` que ya protege tres superficies admin; (3) no hay canario/blue-green contra el cual escalar el riesgo porque **no hay tráfico de producción todavía** — un tratamiento `high-risk` con lista de sign-off ampliada no tiene nada operativo que sostener hoy. La combinación de "mecanismo bien probado + sin auth nuevo + sin producción viva" mantiene esto en `non-trivial`, con la salvedad explícita (§11) de que el sign-off de Pedro (dueño) se pide igual, no por gate de ingeniería sino porque él es quien pidió esta US como condición de cumplimiento legal.

No encontré ambigüedad genuina entre `standard` y `non-trivial` (la migración de esquema + la superficie admin nueva ya empujan por sí solas fuera de `standard`), así que no hay necesidad de parar a preguntar — la frontera relevante era `non-trivial` vs `high-risk`, resuelta arriba.

---

## 2. Deployment strategy

### 2.1 Hoy (sin entorno vivo)

No hay "deploy" real que ejecutar. El código de este change vive en la rama `feat/US-021-retencion-datos-ordenes-backend`, pasa por el pipeline de CI (`ci.yml`: lint + test + build + migración contra el Postgres efímero de CI) y, al mergear a `main`, **queda esperando** a que exista un entorno Railway (`staging`/`production`) para correr fuera de local. Este plan no puede — ni debe — inventar un cronograma de canary/blue-green contra algo que no existe.

### 2.2 El día que exista `staging`/`production` en Railway (dirigido por US-019 / `platform-cloud`)

- **Estrategia**: Railway es PaaS sin canario nativo tipo Argo Rollouts/CodeDeploy (confirmado en `railway-baseline.md` §6 — "No Argo CD / Flux — Railway owns deploy"; git-push → build → deploy es esencialmente **recreate con health-check gate**, no traffic-shifting progresivo). La estrategia real disponible es: **promoción serial `staging` → `production`** vía el GitHub integration de Railway (`main` → `production`, `staging` → `staging`, per el propio runbook §3.2), con smoke test manual entre ambos. Esto es la variante Tier-2 más cercana al "Rolling with health checks" que pide `deployment-standards.md` §8.1 — Railway no ofrece nada más fino a este baseline.
- **Rationale**: tier 2 (runbook) + plataforma PaaS sin canario nativo → no hay alternativa de mayor granularidad sin adoptar Kubernetes (fuera de alcance, contradice ADR-0001).
- **Puerta de gobierno para ESTE change específicamente**: dado que las dos rutas nuevas mutan/suprimen PII, el primer disparo en `production` — sea el runner de arranque o el endpoint a pedido — debería confirmarse contra `staging` con datos sintéticos primero, no asumir "funciona porque pasó CI". Ver §6.
- **Bake time**: sin dato medido — cuando exista observabilidad real (Sentry/Railway dashboards, hoy `[pendiente]`), 24-48h de bake en `staging` antes de promover a `production`, coherente con el resto de Fase 2 del propio runbook (no hay una ventana especial declarada en ningún documento del proyecto para esta US en particular; se aplica el default general).

---

## 3. Database migration plan

**No aplica el patrón completo expand-and-contract con sus 4 fases** — y eso es correcto, no un atajo. `design.md` §Approach ya lo declara: dos columnas nullable + dos `CHECK` (T0.1), sin mover ni tocar ninguna fila existente (todas quedan en `NULL`/`NULL`, que satisface el `CHECK` de consistencia). Es la variante más simple posible de "expand": **no hay backfill, y no hay fase de contract porque nada viejo se está retirando** (ninguna columna existente cambia de tipo ni se borra).

### Fase única: Expand (no hay Migrate-reads ni Contract)

- **Migración**: `packages/db/prisma/migrations/*_add_order_anonymization/migration.sql` (T0.1)
- **Qué hace**: `ALTER TABLE orders ADD COLUMN anonymized_at TIMESTAMP(3), ADD COLUMN anonymization_reason TEXT` + 2 `CHECK` (rango cerrado del `reason`, consistencia `anonymized_at ⇔ anonymization_reason`).
- **Backwards compatible**: sí — cualquier código anterior a este change (que no conoce estas columnas) sigue funcionando sin cambios; nunca las lee ni las escribe.
- **Reversible**: la migración en sí es trivialmente reversible como DDL (`DROP COLUMN` + `DROP CONSTRAINT`) — pero per `deployment-standards.md` §11.1 (forward-only), el rollback real ante un problema **nunca** es una migración `down` en producción; es un nuevo forward fix. No hace falta ni se plantea un rollback de esquema (ver §8).
- **¿Por qué no hace falta Contract?**: porque este change no reemplaza nada — agrega dos columnas que antes no existían y una operación (anonimizar) que antes no existía. El día que exista un "Deferred: US-012" que lea estas columnas (open question de `design.md`), tampoco habrá contract: seguirá siendo aditivo desde su propia perspectiva.
- **Riesgo de bloqueo en `orders`**: bajo — `ADD COLUMN` nullable sin `DEFAULT` no reescribe la tabla en Postgres moderno (Neon corre Postgres 16, confirmado en `design-e2e.md` §16); los dos `CHECK` sí requieren un table scan de validación, pero sobre el volumen declarado ("algunos cientos de órdenes por mes", `design.md` §Approach) es del orden de milisegundos, no la ventana de `deployment-standards.md` §11.5 que dispararía partir la migración en fases.

---

## 4. Feature flag plan

**No aplica** — `design.md` no propone ningún feature flag para esta US (confirmado leyendo el `design.md` completo: ni en §Approach, ni en §Trade-offs, ni en el `## Open questions`). La superficie se activa por el simple hecho de desplegar el código; no hay ningún camino de rollout gradual de *comportamiento* — el control de "quién puede accionarla" es autorización (`AdminGuard`), no un flag de release.

---

## 5. Secret / env-var provisioning

**No hay secretos nuevos** — confirmado contra `design.md` §Approach ("Config (fail-fast, §7)") y `tasks.md` T0.2: los 5 valores nuevos son configuración numérica sin ningún dato de credencial:

| Nombre | Propósito | Default | Envs | ¿Es secreto? |
|---|---|---|---|---|
| `ORDER_RETENTION_MONTHS` | Ventana de retención antes de anonimizar (PRD §6) | `12` | dev, staging, production | No |
| `ORDER_ANONYMIZE_RATE_LIMIT_MAX` | Presupuesto del endpoint a pedido | `30` | dev, staging, production | No |
| `ORDER_ANONYMIZE_RATE_LIMIT_TTL_MS` | Ventana del rate-limit a pedido | `60000` | dev, staging, production | No |
| `ORDER_RETENTION_SWEEP_RATE_LIMIT_MAX` | Presupuesto del barrido bajo demanda | `5` | dev, staging, production | No |
| `ORDER_RETENTION_SWEEP_RATE_LIMIT_TTL_MS` | Ventana del rate-limit del barrido | `3600000` | dev, staging, production | No |

- Los 5 tienen default seguro (T0.2 verifica esto explícitamente) — **no bloquean el arranque en ningún ambiente si nadie los setea**. Ningún paso de pre-deploy exige provisionarlos.
- Per `deployment-standards.md` §7.4 (config as code): estos valores viven como código/default, no en un secrets manager; si algún ambiente necesita override, es una variable de Railway normal (`railway-baseline.md` §2 — "Secrets: Railway service variables", categoría que también cubre config no-secreta en este baseline PaaS), sin rotación asociada (§7.3 de `deployment-standards.md` sólo aplica a credenciales).
- **Pipeline propagation**: ninguna — no hay paso de CI/CD que necesite conocer estos valores (no hay deploy pipeline todavía, §0).

---

## 6. Pre-deployment validation

- [ ] Suite completa verde: `pnpm --filter @dsm/api test`, `pnpm --filter @dsm/api lint`, `pnpm --filter @dsm/api typecheck` (ya son parte de `tasks.md` § Verification — no se duplica, se confirma como gate de este plan también).
- [ ] Contrato OpenAPI del change valida: `npx spectral lint openspec/changes/US-021-retencion-datos-ordenes-backend/contracts/openapi/*.yaml` (T6.1).
- [ ] Migración corre limpia contra Postgres local (`pnpm --filter @dsm/db migrate`) — ya cubierto por T0.1/Verification.
- [ ] **Gap detectado — no cubierto por `tasks.md`**: `apps/api/docs/api/openapi.yaml` (el contrato **publicado** del servicio, distinto del staging de T6.1 en `openspec/changes/.../contracts/`) no incluye todavía `/admin/orders/*`. Per `documentation-standards.md` §11.1 ("API endpoint added... → `docs/api/openapi.yaml` + `docs/api/CHANGELOG.md`") y la nota del skill `openspec-workflow` ("el change que modifica una API actualiza AMBOS — es una de sus closure tasks"), esto falta como task explícita. **Recomendación**: agregar antes de mergear (o como fast-follow inmediato) una actualización de `apps/api/docs/api/openapi.yaml` + su `CHANGELOG.md` reflejando los dos endpoints nuevos.
- [ ] **No existe `qa-plan.md` para este change** — no hay un plan de pruebas de QA independiente que revisar acá; `tasks.md` Fase 5 (T5.1–T5.6) es, hoy, la única cobertura de invariantes cross-AC (negative-space de AC-2/AC-6/AC-7/AC-8). Si el proyecto adopta QA dedicado para esta US antes de producción, ese plan debería revisar específicamente: (a) que el `AdminGuard` real (no un mock) rechaza JWT no-admin sobre las dos rutas nuevas, (b) un smoke manual con JWT admin real contra un `staging` sembrado con órdenes sintéticas vencidas y no vencidas.
- [ ] **Migration dry-run**: no hay todavía un clon de staging contra el cual correrlo (§0). Cuando exista Neon `staging` (US-019), correr `pnpm --filter @dsm/db exec prisma migrate deploy` ahí antes de tocar `production`, per `railway-baseline.md` §0.2 (el esquema se autoriza local, se *aplica* a cloud — nunca al revés).
- [ ] Smoke test del flujo completo antes de la primera promoción a `production`: con JWT admin real, `POST /v1/admin/orders/:id/anonymize` sobre una orden sintética → confirmar 200 + que `buyer_name/email/phone` quedaron en los placeholders — no existe hoy un smoke test automatizado para esto (no hay pipeline de deploy que lo dispare); queda como paso manual documentado acá hasta que `/plan-deployment` de US-019 defina el pipeline real.

---

## 7. Post-deployment validation

### 7.1 Qué instrumentar (no hay dashboards que citar todavía)

No hay ninguna URL de dashboard real — `docs/services/dsm-ecommerce/runbook.md` marca Sentry/Railway dashboards como `[pendiente: T4.2]`. Per la regla de este agente ("never invent dashboard URLs"), esta sección lista **qué señal debería existir**, no un link inventado:

| Señal | Fuente (cuando exista) | Qué mirar |
|---|---|---|
| Tasa de error en `/v1/admin/orders/*` | Sentry (pendiente T4.2) | Cualquier 5xx no esperado sobre las dos rutas nuevas |
| `dsm_orders_retention_events_total` | Contador de `OrdersRetentionEventsService` (T2.2), expuesto vía el mismo mecanismo que `dsm_search_events_total` (ver runbook §4, fila "Búsqueda degradada", que sí referencia `GET /v1/admin/metrics`) | Que `orders_retention.swept` se emita al menos una vez por arranque de la API (confirma que el runner oportunista corrió) |
| Conteo de `anonymized_count` por corrida | Campo del propio evento `orders_retention.swept` | Debería acercarse a 0 la mayoría de las corridas una vez estabilizado (la ventana de 12 meses no genera un volumen grande por día) — un salto brusco merece revisión manual antes de asumir que es correcto |
| Latencia de `POST retention-sweep` | Ninguna hoy (no hay métricas de duración expuestas explícitamente para este endpoint en `design.md`) | `design.md` §Approach ya declara el disparador: "si el volumen creciera dos órdenes de magnitud, la primera señal es la métrica de duración del propio endpoint" — **esa métrica no está en el alcance de `tasks.md` de este change**, es una observación a futuro, no un gap de este deploy |

### 7.2 Time-to-confidence

Sin dato medido de producción para fijar un número real. Hasta que exista: usar el mismo criterio que el resto del runbook — ninguna alerta de error nueva durante una ventana de bake razonable (24-48h en `staging`) antes de promover a `production`, más una verificación manual del primer barrido oportunista (`onApplicationBootstrap`) tras el primer arranque en cada ambiente.

### 7.3 Auto-rollback triggers

No aplica en el sentido de `deployment-standards.md` §9/§10 (esos mecanismos son CloudWatch/Prometheus sobre ECS/EKS — no existen en este stack). El único "auto-" disponible en Railway es el health-check-gated restart nativo (runbook §3.2/§3.4). El disparador real de un rollback manual es humano: cualquier error 5xx sostenido en `/v1/admin/orders/*` o un `anonymized_count` que no cuadre con lo esperado.

---

## 8. Rollback plan

### Triggers

| Trigger | Fuente | Umbral |
|---|---|---|
| 5xx sostenido en `/v1/admin/orders/*` | Sentry (cuando exista) / logs Railway | Cualquier tasa sostenida fuera de lo esperado — sin baseline medida todavía para fijar un múltiplo |
| El barrido de arranque anonimiza órdenes que no debería (bug de `cutoffDate`/`ORDER_RETENTION_MONTHS`) | Revisión manual de `anonymized_count` del primer evento tras deploy | Cualquier valor inesperado — dado que la operación es irreversible, este trigger es el más crítico de todo el plan |
| El `AdminGuard` no está protegiendo las rutas nuevas (regresión de wiring) | Smoke test manual (§6) | Cualquier 200 sin `Authorization` válido |

### Mecanismo (orden de `operations-standards.md` §4.7, adaptado a lo que existe en Railway)

1. **Feature flag**: NO APLICA — no hay flag (§4). No hay forma de apagar sólo esta funcionalidad sin redeploy.
2. **Rollback de código**: redeploy del último commit verde en Railway (mecanismo único documentado en `docs/services/dsm-ecommerce/runbook.md` §3.3 — *"Rollback = redeploy del último commit verde, no un revert a mano bajo presión"*). Tiempo estimado: minutos (git-push → build → deploy de Railway), sin dato medido todavía.
3. **NO SE REQUIERE rollback de migración** — la migración es puramente aditiva (§3); el código anterior a este change ignora las dos columnas nuevas por completo. Esto es exactamente lo que `deployment-standards.md` §13.6 exige ("rollback de aplicación debe ser schema-compatible con el código anterior") y se cumple sin ningún esfuerzo adicional — el caso más limpio posible de migración segura.
4. **Importante, específico de este change**: un rollback de código **no deshace ninguna anonimización ya ejecutada**. Si el barrido corrió con un bug antes de detectarlo, el rollback detiene el daño futuro pero no repara las órdenes ya anonimizadas — no hay ningún camino de recuperación de los datos originales (es la garantía de irreversibilidad que la propia US pide, US §9). Esto no es un defecto del plan de rollback: es la razón por la que §6 (smoke test manual antes de la primera promoción) importa más en este change que en uno típico.

### Time-to-recovery target

Sin SLO declarado (§0) para fijar un número — el runbook fija RTO ≤ 4h para **restore de datos** (escenario de corrupción/borrado, `docs/services/dsm-ecommerce/runbook.md` §6.2), pero eso no aplica acá (no hay restore posible de PII ya anonimizada, ver punto 4 arriba). Para el rollback de código en sí, aplicar el mismo esfuerzo que cualquier redeploy Tier-2 — best-effort hasta que exista una medición real.

---

## 9. Operational handoff

### 9.1 Runbook — crear, no "actualizar" (routear a `doc-updater`)

El runbook existente (`docs/services/dsm-ecommerce/runbook.md`) es un **esqueleto** con secciones ya definidas por su propia plantilla (§1–§8) pero sin contenido específico de esta superficie todavía. El ítem operativo correcto es **agregar las primeras entradas** de este change a secciones que ya existen, siguiendo el mismo estilo que las entradas ya presentes (ej. la fila de "Sin job de purga de carritos vencidos" en §5, que es el precedente exacto de lo que hace falta acá):

- [ ] §5 "Problemas conocidos": agregar una fila **"Sin disparador mensual real para `retention-sweep`"** — Estado: Activo (diferido, mismo patrón que la fila de purga de carritos). Mitigación: el barrido oportunista al arrancar la API (`OrdersRetentionRunner`) cubre el hueco de cada redeploy, pero **no reemplaza** una cadencia mensual real mientras la API no se reinicie con esa frecuencia. Referencia: el propio `design.md` §Open questions de esta US ya deja esto anotado como decisión pendiente de `/plan-deployment` o US-019 — este runbook debe reflejar la misma nota operativa para quien esté de guardia.
- [ ] §4 "Respuesta a alertas": no hay alerta configurable todavía (Sentry alerting `[pendiente: T4.3]`) — dejar marcado como pendiente en el mismo estilo `[pendiente: T4.3]` que ya usa el runbook, no inventar una fila completa sin mecanismo real detrás.
- [ ] §3.5 "Rotar secretos": no aplica — no hay secreto nuevo (§5).
- [ ] §8 "Última actualización": agregar entrada fechada con este change, mismo formato que las dos entradas existentes.

### 9.2 La decisión operativa pendiente que este change NO resuelve (y que alguien tiene que resolver antes de que la US cumpla su propósito)

`design.md` lo deja explícito como open question, y este plan lo hereda: **el barrido oportunista de arranque no es la cadencia mensual real que AC-1 necesita**. Si la API no se redeploya en ~12 meses, ninguna orden vencida se anonimiza automáticamente. Alguien tiene que decidir — antes del primer despliegue a producción real — si el disparador mensual es:
- un cron job de Railway golpeando `POST /v1/admin/orders/retention-sweep`, o
- un proceso manual del dueño (operacionalmente frágil para un requisito de cumplimiento legal), o
- diferido formalmente a US-019 cuando exista `apps/worker` + BullMQ real.

Este change entrega el código correcto y probado; **no** entrega la pieza que lo hace correr todos los meses en producción. Ver Open questions.

### 9.3 On-call

No hay rotación formal — el propio runbook lo marca `[pendiente — equipo de una persona; rotación formal se define en /plan-deployment]`. Dado que este `/plan-deployment` es exactamente ese comando corriendo sobre este change, y dado que no hay producción viva todavía, este plan **no** define una rotación on-call — sería inventar un proceso sin nadie a quien asignarlo. Queda como el mismo pendiente que ya estaba, sin empeorarlo ni fingir resolverlo.

### 9.4 Comms

Equipo real (per `project-config.yml`): Pedro Suarez (Dueño, contacto único del lado cliente) + el/la desarrollador/a técnico/a. No hay separación PM/PO/ingeniería — Pedro es ambos. Por eso, el único ítem de comms real es:

| Audiencia | Canal | Timing | Nota |
|---|---|---|---|
| Pedro (dueño) | El canal que ya usen (no declarado en el repo) | Antes de la primera promoción a `production` | No es un gate de release técnico — es awareness de que la funcionalidad que él pidió para cumplir la Ley 25.326 ya está lista, y de la limitación de §9.2 (el disparador mensual real todavía no existe) |

### 9.5 Change record

No aplica hoy — no hay ventana de mantenimiento que registrar porque no hay producción (§0). Cuando exista, seguir `operations-standards.md` §10.4 (change record con el cambio planeado, plan de rollback, criterio de éxito).

### 9.6 ORR

**No aplica un ORR independiente para este change ahora mismo** — per `operations-standards.md` §8.4, "New critical feature (auth, payments, regulated workflows)" sí dispara ORR, y una superficie de supresión de PII bajo Ley 25.326 encaja en "regulated workflow". Pero un ORR tiene sentido cuando hay tráfico real contra el cual verificar el checklist (§8.2 completo: resiliencia, capacidad, dashboards reales, etc.) — nada de eso existe todavía para `dsm-ecommerce` en conjunto. **Recomendación**: cuando US-019/`platform-cloud` complete el primer despliegue real y dispare el ORR de la plataforma completa (que de todos modos es obligatorio per `operations-standards.md` §8.1 — "every new service"), ese checklist debe incluir explícitamente dos ítems específicos de esta US: (a) revisión de que sólo `role=admin` puede accionar `/v1/admin/orders/*`, (b) confirmación de que existe un disparador operativo real para `retention-sweep` (§9.2) antes de declarar la US-021 verdaderamente cumplida en producción — hoy el código está listo, pero "cumplida" en el sentido legal de la US requiere la pieza operativa.

---

## 10. Platform-specific considerations

### 10.A Backend-specific

- **API versioning impact**: ninguno. Los dos endpoints son estrictamente nuevos (`POST /v1/admin/orders/:id/anonymize`, `POST /v1/admin/orders/retention-sweep`) — per `api-standards.md` §9.3, "new endpoints" es aditivo y no requiere nueva versión mayor. Siguen viviendo en `v1`.
- **Concurrent versions**: sin cambio — el proyecto sólo tiene `v1`, muy por debajo del máximo de 2 versiones concurrentes de `api-standards.md` §9.4.
- **Resilience defaults**: no aplica — este change no agrega ninguna dependencia saliente nueva (no llama a ningún proveedor externo; toda la lógica es Postgres vía Prisma, ya cubierto por los defaults existentes del proyecto). No hay timeout/retry/breaker nuevo que declarar.

*(§10.B Web-specific y §10.C Android-specific: no aplican — este change es 100% backend, sin superficie web ni móvil.)*

---

## 11. Sign-off requirements

Este proyecto es un equipo pequeño sin roles formales de SRE/EM/QA dedicados (confirmado en `project-config.yml` — el único contacto de cliente es Pedro Suarez, Dueño). La tabla de sign-off se adapta a los roles que realmente existen en vez de inventar aprobadores ficticios:

| Rol | Requerido para | Status |
|---|---|---|
| Implementador/a (quien corre `develop-backend` sobre `tasks.md`) | Que el código cierre exactamente lo que este plan asume (migración aditiva, sin secretos, sin flag) | Pendiente |
| Pedro Suarez (Dueño) | Awareness de cumplimiento legal — no es un gate técnico, pero es quien pidió esta US como condición previa a producción (`proposal.md` §Why) y quien debe saber que el disparador mensual real (§9.2) sigue sin resolver | Pendiente |
| — SRE/Platform: no aplica (rol inexistente en este proyecto hoy) | — | — |
| — QA formal: no aplica (no hay `qa-plan.md` para este change) | — | — |
| — Architect: no aplica — sin breaking API change (§10.A) | — | — |
| — ORR: no aplica todavía (§9.6) — se incorpora al ORR de plataforma cuando exista | — | — |

---

## 12. Anti-patterns explicitly avoided

- `deployment-standards.md` anti-patrón #16 ("Schema breaking changes in a single deploy") — evitado por construcción: la migración es puramente aditiva, no hay nada "breaking" que fasear.
- `deployment-standards.md` anti-patrón #13 ("Migrations executed by application startup") — el `OrdersRetentionRunner.onApplicationBootstrap` corre el **barrido de negocio**, no la migración de esquema; la migración corre por el pipeline de `prisma migrate` (T0.1), nunca al arrancar la API. Distinción explícita porque a primera vista podría confundirse.
- `deployment-standards.md` anti-patrón #19 ("Permanent feature flags without owner") — no aplica porque no hay flag (§4), pero se documenta la ausencia explícitamente en vez de omitirla en silencio.
- `operations-standards.md` anti-patrón #21 ("'We'll add monitoring later' services") — no se declara el gap de observabilidad (§7) y se sigue de largo; se deja como ítem explícito de seguimiento (§9.6, incorporado al ORR de plataforma).
- `operations-standards.md` anti-patrón #26 ("ORR as a tick-box exercise") — evitado no haciendo un ORR de mentira contra un servicio sin tráfico; se difiere honestamente al ORR real de plataforma en vez de fingir uno ahora.

---

## 13. Standards consulted

- `docs/base-standards.md` (principios de reversibilidad, cambio incremental, observable-por-defecto)
- `docs/delivery/deployment-standards.md` §1 (foundations), §8.1 (release strategy por tier), §11.1–11.2 (forward-only, expand-and-contract), §11.5 (long-running migrations), §13.1/13.6 (rollback layers, migration rollback), §18 (anti-patterns)
- `docs/delivery/operations-standards.md` §1.3 (service tiers), §4.7 (mitigation hierarchy), §5 (runbooks), §8.1/8.4 (ORR — cuándo aplica), §14 (anti-patterns)
- `docs/architecture/railway-baseline.md` §0 (bootstrap-local vs platform-cloud, timing), §1–§2 (topología y defaults Railway), §6 (CI/CD baseline — sin canario nativo)
- `docs/architecture/api-standards.md` §9.2/9.3/9.4 (versioning — endpoints nuevos son aditivos)
- `docs/ai/documentation-standards.md` §11.1 (qué doc dispara cada tipo de cambio — usado para detectar el gap de `apps/api/docs/api/openapi.yaml` en §6)
- `docs/architecture/decisions/0001-platform-railway-neon-r2.md` (plataforma fijada; su propia sección de riesgos abiertos — Q-3, residencia de datos bajo Ley 25.326 — es directamente relevante a esta US, ver §14)

---

## 14. Open questions

1. **Disparador mensual real de `retention-sweep`** (heredado de `design.md` §Open questions, no resuelto por este plan): ¿cron de Railway, proceso manual del dueño, o diferido a US-019/BullMQ? Sin esto, AC-1 depende enteramente de que la API se reinicie con la frecuencia adecuada — frágil para un requisito de cumplimiento legal. Bloquea la declaración de "US-021 cumplida en producción", no bloquea el merge de este código.
2. **Residencia de datos y Ley 25.326 (hallazgo cruzado con ADR-0001)**: ADR-0001 deja abierta, sin resolver, la pregunta de si la Ley 25.326 exige residencia argentina para PII (§23 Q-3 del E2E, citada textualmente en el ADR: *"Argentine PII under Ley 25.326 may require local residency; this is an open legal question... carried as an accepted risk, not a resolved constraint"*). Este change **implementa** una obligación de la misma ley (retención/anonimización) mientras esa otra obligación (residencia, con los datos hoy planeados en US-East) sigue sin resolverse. No es un bloqueador de este change puntual, pero un plan de deployment que toca Ley 25.326 debería dejarlo escrito en el mismo lugar donde alguien va a buscar "¿qué falta para producción real" — no quedó anotado en ningún otro sitio operativo.
3. **`apps/api/docs/api/openapi.yaml` desactualizado** (§6): `tasks.md` T6.1 sólo actualiza el contrato staging del change (`openspec/changes/.../contracts/`), no el contrato publicado del servicio. Recomendado como fast-follow antes de considerar el change "documentalmente cerrado" per `documentation-standards.md` §11.1.
4. **¿Quién es el aprobador técnico real cuando no hay SRE/EM?** — la tabla de sign-off (§11) asume que el mismo implementador que corrió `develop-backend` también valida este plan contra lo que construyó. Si el proyecto crece un segundo desarrollador antes de esto llegar a producción, vale revisar si conviene una segunda revisión humana dado que la operación es irreversible (§8, punto 4).

---

## 15. References

- US: `docs/user-stories/US-021-retencion-datos-ordenes.md`
- Change: `openspec/changes/US-021-retencion-datos-ordenes-backend/` (`proposal.md`, `design.md`, `tasks.md`)
- Runbook (esqueleto): `docs/services/dsm-ecommerce/runbook.md`
- `docs/RUN-MVP.md` (estado real de lo que corre hoy)
- `docs/product/design-e2e.md` §13 (Despliegue), §17 (NFRs), §18.5 (Operatividad)
- ADR-0001 (`docs/architecture/decisions/0001-platform-railway-neon-r2.md`), ADR-0012 (`0012-in-process-import-executor.md`, precedente del runner de arranque)
- `project-config.yml` (`stacks.infra: railway`, roles del cliente)
