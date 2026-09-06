# Deployment Plan — US-011 Backend: Notificaciones por email (Resend)

> **Ticket**: US-011 — Notificaciones por email (Resend)
> **Author**: deployment-planner agent (assisted by @gosp)
> **Date**: 2026-09-06
> **Status**: Proposed
> **Platform(s) affected**: backend (NestJS API — `apps/api`, módulos `orders/`, `observability/`)
> **Service tier**: 2 (`docs/services/dsm-ecommerce/runbook.md` frontmatter — única fuente de tier en este repo, sin `service-catalog.yaml`; mismo tier que ya resolvieron `deployment-plan.md`/`qa-plan.md` de US-021 con el mismo razonamiento — no se re-deriva)
> **Deploy class**: non-trivial (razonamiento explícito en §0.1)
> **Companion files**: `proposal.md`, `tasks.md`, `design.md`, `qa-plan.md`

---

## 0. Grounding: sigue sin existir un entorno de producción real

Mismo hecho gobernante que ya estableció `openspec/changes/archive/US-021-retencion-datos-ordenes-backend/deployment-plan.md` §0 seis días atrás (2026-08-31) — verificado de nuevo, no asumido, porque nada cambió desde entonces:

- `docs/RUN-MVP.md` sigue listando `infra cloud (US-019)` bajo "Roadmap (planeado, no en esta entrega)".
- `openspec/changes/US-019-provision-plataforma-cloud-infrastructure/` sigue activo (memoria de sesión: "Fase 0 cerrada (2/14); retomar en T1.1; faltan cuentas Railway+Sentry"). No hay `staging`/`production` Railway provisionados todavía.
- `docs/services/dsm-ecommerce/runbook.md` sigue en `status: Skeleton`, con dashboards `[pendiente: T4.2]` y alertas `[pendiente: T4.3]`.
- No existe `service-catalog.yaml` ni `docs/slo.yaml`.

**Consecuencia para este plan**: igual que en US-021, las secciones que en un proyecto con producción viva citarían dashboards y umbrales medidos documentan honestamente **qué falta provisionar**, sin inventar valores.

**Gate de migración brownfield**: no aplica — proyecto greenfield.

### 0.1 Por qué `non-trivial` y no `standard` ni `high-risk`

**Por qué no `standard`**: la plantilla de este agente clasifica explícitamente *"new env var/secret"* como criterio de `non-trivial`, no de `standard`. Este change agrega **2 variables nuevas requeridas en producción** (`ORDER_NOTIFICATIONS_FROM`, `OWNER_NOTIFICATION_EMAIL`) al mismo `superRefine` fail-fast que hoy ya exige `RESEND_API_KEY`/`PASSWORD_RESET_FROM`/`PASSWORD_RESET_URL_BASE` (`apps/api/src/config/env.validation.ts` líneas 397-412, verificado leyendo el código real, no `tasks.md`). No es un cambio "agregar endpoint retrocompatible sin migración" — hay una condición de arranque nueva que puede tumbar el boot completo de la API en producción (ver §0.2). Eso solo ya saca el change de `standard`.

**Por qué no `high-risk`**: ningún criterio de la plantilla aplica —
- No hay migración de esquema ni cambio irreversible de datos (`proposal.md` "Out of scope": "Nueva persistencia — ninguna").
- No hay cambio breaking de API — cero endpoints nuevos o modificados (`design.md` "Spec delta": "Sin cambios en `contracts/openapi.yaml`").
- No hay major version bump ni release mobile force-update — este change no toca `apps/web` ni ninguna app móvil.
- Resend **no es una dependencia externa nueva** del servicio — ya está en la lista de "Dependencias externas" del runbook (`docs/services/dsm-ecommerce/runbook.md` línea 43: "MercadoPago... Google Gemini... **Resend (emails)**... Cloudflare R2") desde que US-014 la introdujo para password-reset. Este change extiende su uso a un segundo puerto (`NotificationPort`), no la introduce — por lo que `operations-standards.md` §8.4 ("New external dependency... ✅ Yes [ORR]") **no** se dispara.
- Sin comportamiento nuevo visible para el usuario final más allá de "ahora llega un email en vez de nada" (mismo comportamiento observable ya diseñado y probado por US-010/US-012 al invocar el puerto) — el `LoggingNotificationAdapter` que corre hoy en todo entorno sin `RESEND_API_KEY` (incluida la ausencia total de un entorno productivo real, §0) sigue siendo exactamente el mismo fallback.

No hubo ambigüedad genuina que ameritara parar a preguntar: el criterio de la propia plantilla ("new env var/secret" ⇒ `non-trivial`) es inequívoco para este change, y ningún criterio de `high-risk` aplica — la frontera relevante (`standard` vs `non-trivial`) la resuelve el texto de la plantilla, no una decisión de este agente.

### 0.2 El hecho central que gobierna la sección de secretos (§5) y el rollback (§8)

Leyendo `env.validation.ts` (líneas 376-426) directamente, no `tasks.md`:

```ts
if (env.NODE_ENV !== 'production') return;   // fuera de producción, todo el bloque abajo no corre

for (const campo of ['RESEND_API_KEY', 'PASSWORD_RESET_FROM', 'PASSWORD_RESET_URL_BASE'] as const) {
  if (!env[campo]) ctx.addIssue({ ... });    // ya existe — US-014
}
for (const campo of ['MP_ACCESS_TOKEN', 'MP_WEBHOOK_SECRET'] as const) {
  if (!env[campo]) ctx.addIssue({ ... });    // ya existe — US-009/US-010
}
// T2.1 de este change agrega un tercer loop con ORDER_NOTIFICATIONS_FROM / OWNER_NOTIFICATION_EMAIL
```

**Confirmado, no asumido**: con `NODE_ENV=production`, la API **rehúsa arrancar** (`validateEnv` lanza, Nest nunca levanta) sin las variables del loop. Esto **ya es cierto hoy**, antes de este change, para `RESEND_API_KEY`/`MP_ACCESS_TOKEN`/`MP_WEBHOOK_SECRET` — ninguno de los tres está provisionado en ningún entorno real (§0; `docs/services/dsm-ecommerce/runbook.md` línea 53: "Mientras US-009 esté `Blocked` (sin credenciales)"). Este change **no introduce** el patrón de fail-fast-que-tumba-el-boot; **extiende una lista que ya es, hoy, insatisfacible** con 2 nombres más.

Fuera de `NODE_ENV=production` (dev, test, y — sin confirmación en ningún documento del repo, ver Open questions §14.3 — probablemente `staging` si ese entorno no fija `NODE_ENV=production`), las 2 variables nuevas son **opcionales**: sin ellas, `notification.provider.ts` (T7.1) cae a `LoggingNotificationAdapter` con un `logger.warn`, exactamente el comportamiento de hoy. **No hay degradación silenciosa en producción real** — en producción es fail-fast puro, no fallback silencioso. La distinción entre "no arranca" y "arranca pero manda a un log" depende enteramente de qué valor de `NODE_ENV` tenga ese entorno, no de si `RESEND_API_KEY` está seteada.

---

## 1. Executive summary

Este change construye `ResendNotificationAdapter` y lo conecta al `NotificationPort` (US-010) que hoy cae en `LoggingNotificationAdapter` — sin endpoint HTTP nuevo, sin migración, sin feature flag de release. El único mecanismo de activación es la presencia de `RESEND_API_KEY` (ya usada por password-reset desde US-014) más 2 variables nuevas (`ORDER_NOTIFICATIONS_FROM`, `OWNER_NOTIFICATION_EMAIL`) que se suman al fail-fast de producción existente. El riesgo mecánico del código es bajo (patrón ya probado por `ResendPasswordResetMailer`, reintento acotado, nunca propaga); el riesgo real de este change es **enteramente operativo**: (a) sin una cuenta Resend real con dominio verificado, la funcionalidad nunca se activa fuera de un entorno con la key seteada (§5), y (b) sumar 2 variables al fail-fast de producción es, hoy, letra muerta porque ese fail-fast ya está bloqueado por variables anteriores no provisionadas (§0.2) — mergear este código no cambia si la API puede arrancar en producción hoy, porque **ya no puede**, por motivos previos y ajenos a este change.

**Clasificación**: `non-trivial` (§0.1). **Go/no-go de este plan**: sobre todo para el día en que exista `staging`/`production` en Railway (US-019) — "desplegar" hoy significa que el código llega a `main` y espera un entorno donde correr.

---

## 2. Deployment strategy

### 2.1 Hoy (sin entorno vivo)

No hay deploy real que ejecutar. El código vive en `feat/US-011-notificaciones-email-backend`, pasa por `ci.yml` (lint + test + build contra Postgres efímero de CI — sin Resend real, §0 de `qa-plan.md`) y, al mergear a `main`, queda esperando a que exista `staging`/`production`.

### 2.2 El día que exista `staging`/`production` en Railway

- **Estrategia**: Railway (PaaS sin canario nativo, `railway-baseline.md` §6) — promoción serial `staging → production` vía la integración GitHub de Railway, recreate con health-check gate (`/health`). Es la variante Tier-2 más cercana a "Rolling with health checks" disponible en este baseline — no hay alternativa de mayor granularidad sin adoptar Kubernetes (fuera de ADR-0001).
- **Rationale**: tier 2 + PaaS sin canario nativo → sin alternativa de mayor granularidad.
- **Puerta de gobierno específica de este change**: dado que es una superficie **outbound-only** (nunca cruza un trust boundary de entrada — `design.md` "Threat model"), el riesgo de un despliegue malo no es que un atacante explote algo nuevo, sino que **arranque mal** o **mande emails con contenido incorrecto/sin escapar**. El smoke relevante (§6) es "el email real que llega a una casilla de prueba tiene el contenido correcto y escapado", no un chequeo de autorización.
- **Bake time**: sin dato medido (§0) — cuando exista observabilidad real, aplicar el mismo criterio general del runbook (24-48h en `staging` antes de promover).

---

## 3. Database migration plan

**No aplica** — confirmado en `proposal.md` ("Out of scope: Nueva persistencia — ninguna") y `design.md` Decisión 2 (AC-7 se resuelve con guardas estructurales ya existentes + `Idempotency-Key` de Resend, explícitamente **sin** tabla `sent_notifications` para evitar sobre-ingeniería). No hay `Phase: Expand/Migrate/Contract` que planear porque no hay ningún cambio de esquema.

---

## 4. Feature flag plan

**No aplica en el sentido de esta plantilla** (staged rollout con LaunchDarkly/config service y cohortes por porcentaje). `design.md` no propone ningún flag de release — la selección de adapter (`notification.provider.ts`, T7.1) es un **seam de configuración por presencia de secreto**, mismo patrón exacto que `passwordResetMailerProvider` (US-014), no un mecanismo de rollout gradual:

- No hay cohortes ni bake stages — es un booleano global (`RESEND_API_KEY` presente o no) que se resuelve una vez al arrancar el proceso, no por request ni por usuario.
- No hay plan de cleanup porque no es un flag temporal a remover — es la arquitectura permanente del puerto (mismo criterio que ya aplica `LoggingNotificationAdapter` como adapter de dev/test/fallback, T8.1 sólo actualiza su docstring, no lo elimina).
- **Dueño de este seam**: nadie necesita "limpiarlo" — a diferencia de un flag de feature, este patrón se mantiene indefinidamente (es la misma arquitectura que ya sostiene password-reset desde US-014).

Si en el futuro se quisiera un rollout gradual real (p.ej. activar Resend sólo para un % de órdenes antes de confiar en el proveedor en escala), eso sí requeriría un flag nuevo — no está pedido por ningún AC de esta US y no se inventa acá.

---

## 5. Secret / env-var provisioning

### 5.1 Variables nuevas y su estado real (verificado, no asumido)

| Nombre | Propósito | Tipo | Envs que la exigen (fail-fast) | ¿Provisionada hoy? | Owner de provisión |
|---|---|---|---|---|---|
| `RESEND_API_KEY` | Cliente Resend — **ya exigida en producción desde US-014** (password-reset); este change la vuelve load-bearing para un **segundo** puerto (`NotificationPort`) | Secreto | producción (todas las US que la usan) | **No** — sin cuenta Resend real (§5.2) | PO/Cliente (Pedro) |
| `ORDER_NOTIFICATIONS_FROM` | Remitente de los 4 emails de órdenes | Config (email, no-secreta pero sensible a reputación de dominio) | producción (nuevo, T2.1) | No — depende de dominio verificado (§5.2) | PO/Cliente (Pedro) |
| `OWNER_NOTIFICATION_EMAIL` | Destinatario del aviso de nueva orden al dueño | Config (email) | producción (nuevo, T2.1) | No — es la casilla real del dueño, dato de negocio, no técnico | PO/Cliente (Pedro) |
| `NOTIFICATION_RETRY_MAX_ATTEMPTS` | Reintentos del adapter | Config numérica, `default: 2` | Ninguno — nunca bloquea el arranque | N/A (default seguro) | — |
| `NOTIFICATION_RETRY_BASE_MS` | Backoff base | Config numérica, `default: 300` | Ninguno | N/A | — |
| `NOTIFICATION_RETRY_CAP_MS` | Backoff techo | Config numérica, `default: 2_000` | Ninguno | N/A | — |

Las 3 últimas **no** bloquean nada en ningún ambiente si nadie las setea — T2.1 las verifica explícitamente con default. No hay paso de pre-deploy que las exija.

### 5.2 La dependencia bloqueante real — nombrada, no resuelta acá

**No existe todavía una cuenta Resend real con dominio verificado en ningún entorno del proyecto.** Esto es un hecho de negocio/DNS (verificar el dominio del comprador ante Resend, decidir qué dirección usa `ORDER_NOTIFICATIONS_FROM`, dar de alta la casilla real de `OWNER_NOTIFICATION_EMAIL`), no una tarea de código — este plan **no lo provisiona**, per las reglas de este agente ("never invent a real credential value or DNS state"). `proposal.md` OQ-3 lo marca explícitamente como `[Deferred: fuera de esta US — owner: PO/Cliente]`.

Este es el **mismo patrón de gap de credenciales** que ya existe, documentado, para:
- `MP_ACCESS_TOKEN`/`MP_WEBHOOK_SECRET` (US-009, estado `Blocked` en el runbook §3.1 — "sin credenciales").
- `GEMINI_API_KEY` (US-005).

Otra sesión está escalando los tres gaps de credenciales al usuario/PO en paralelo a este plan — **este plan no vuelve a escalar** el mismo hallazgo; lo documenta acá porque es exactamente la sección donde alguien planeando el primer deploy real necesita encontrarlo, y porque `RESEND_API_KEY`/`ORDER_NOTIFICATIONS_FROM`/`OWNER_NOTIFICATION_EMAIL` son las tres piezas nuevas que le suman a esa lista ya conocida.

**Pre-condición explícita para la primera promoción con esta funcionalidad activa** (recomendación heredada de `qa-plan.md` OQ-QA-011-1, que pide que sea `/plan-deployment` quien la declare): antes de setear `RESEND_API_KEY` real en `production` por primera vez, correr los charters exploratorios #1/#2 de `qa-plan.md` §9 (contenido real del email, latencia real bajo reintento) contra `staging` con la cuenta real — no asumir que "pasa CI" es evidencia de que el email que llega a una casilla real está bien formado y escapado.

### 5.3 Provisioning per `deployment-standards.md` §7.4 (config as code) y railway-baseline.md

- Los 3 secretos/config sensibles (`RESEND_API_KEY`, `ORDER_NOTIFICATIONS_FROM`, `OWNER_NOTIFICATION_EMAIL`) viven como **Railway service variables**, per el baseline de este proyecto (`railway-baseline.md` §2 — "Secrets: Railway service variables"), nunca en `.env` committeado ni en la imagen. `openspec/changes/US-019-provision-plataforma-cloud-infrastructure/design.md` línea 74 ya reserva el **slot** `RESEND_API_KEY — slot (US-011)` en el provisioning de plataforma — este change es quien lo vuelve realmente load-bearing para órdenes, no quien lo crea.
- Las 3 variables numéricas de retry son config no-secreta con default seguro — no necesitan Secrets Manager ni gestión especial; overrides van como variable de Railway normal si algún ambiente lo necesita.
- **Rotación**: `RESEND_API_KEY` ya está sujeta a la política general de `deployment-standards.md` §7.3 (API keys de terceros, cada 180 días o por recomendación del proveedor) desde que US-014 la introdujo — este change no cambia esa política, sólo la vuelve más crítica (rotarla ahora afecta 2 features, no 1). `docs/services/dsm-ecommerce/runbook.md` §3.5 ya incluye `RESEND_API_KEY` en su lista de secretos rotables — sin cambio necesario ahí.
- **Pipeline propagation**: ninguna — no hay pipeline de deploy real todavía (§0); cuando exista, ningún job de CI necesita conocer estas variables (sólo el runtime de `api` en Railway).

---

## 6. Pre-deployment validation

- [ ] Suite completa verde: `pnpm --filter api exec jest --ci`, `pnpm --filter api exec tsc --noEmit -p tsconfig.json`, `pnpm --filter api exec eslint src --max-warnings 0` (ya cubierto por `tasks.md` "Verification (suite-level)" — se confirma como gate de este plan también, no se duplica).
- [ ] Sin contrato OpenAPI que lintear — sin endpoint nuevo (`proposal.md` "Out of scope").
- [ ] QA de aceptación (`qa-plan.md`) verde contra `LoggingNotificationAdapter` — techo real de lo verificable sin cuenta Resend (AC-1/2/3/7/8; AC-4/AC-5 `blocked` a nivel aceptación, cubiertas a nivel unit por T6.1).
- [ ] **Gap detectado — no cubierto por `tasks.md`**: `apps/api/README.md` tiene una sección "Variables de entorno" por cada superficie que introdujo secretos (US-014 líneas 184-202, US-006, US-005) — este change agrega 5 variables nuevas a `orders/` sin ninguna task que documente esa sección en el README. Per `documentation-standards.md` §11.1 ("Configuration variable added or renamed → README.md (Configuration section)"), esto debería cerrarse antes de mergear o como fast-follow inmediato. **Nota de contexto, no bloqueo de este change**: el mismo gap ya existe hoy para `MP_ACCESS_TOKEN`/`MP_WEBHOOK_SECRET` (US-009/US-010, tampoco documentadas en el README) — no es una regresión introducida por este change, pero tampoco se cierra acá; se recomienda una limpieza conjunta.
- [ ] **Migration dry-run**: no aplica — sin migración (§3).
- [ ] **Pre-condición de la primera activación real** (no de este merge): cuenta Resend + dominio verificado provisionados, y charters exploratorios de `qa-plan.md` §9 corridos contra `staging` con la key real, antes de setear `RESEND_API_KEY`/`ORDER_NOTIFICATIONS_FROM`/`OWNER_NOTIFICATION_EMAIL` en `production` (§5.2).

---

## 7. Post-deployment validation

### 7.1 Qué instrumentar (sin dashboards reales todavía, §0)

| Señal | Fuente (cuando exista) | Qué mirar |
|---|---|---|
| `dsm_notifications_events_total{event="notification.sent.*"}` | `NotificationEventsService` (T5.1), mismo mecanismo que `dsm_orders_events_total` vía `GET /v1/admin/metrics` | Que se emita al menos un `notification.sent.order_confirmed` tras la primera orden confirmada con la key real seteada — confirma que el adapter corrió de verdad, no el de log |
| `dsm_notifications_events_total{event="notification.failed.*"}` | Idem | Tasa sostenida de fallo — ver NFR propuesto abajo |
| Tasa de error 5xx en el webhook de MP / `PATCH /admin/orders/:id` | Sentry (pendiente T4.2 de plataforma) | Un salto correlacionado con el deploy de este change indicaría que el reintento in-process (Decisión 1 de `design.md`, hasta ≈16s en el peor caso) está afectando la latencia percibida — no debería, porque ambos callers ya toleran esa demora (`design.md` "Costo aceptado"), pero es la primera vez que se ejercita con tráfico real |

**NFR propuesto, heredado de `design.md`** `[propuesto — confirma Ops tras medir en staging]`: tasa sostenida de `notification.failed.*` > 10% en 15 min → señal de alerta (revisar cuenta Resend/dominio) — sin alerta automatizada todavía (mismo estado que el resto de contadores `dsm_*_events_total`, `design-e2e.md` §18); queda como lectura manual de `GET /v1/admin/metrics` hasta que exista un scraper.

### 7.2 Time-to-confidence

Sin dato medido (§0). Cuando exista `staging`: primera orden confirmada con `RESEND_API_KEY` real → confirmar visualmente que el email llegó a una casilla de prueba con el contenido correcto (ítems, total, sin HTML sin escapar) antes de promover a `production` — este es el smoke test real de este change, más importante que cualquier ventana de tiempo fija dado que es la primera vez que el contenido del email se observa fuera de un test unitario con cliente mockeado.

### 7.3 Auto-rollback triggers

No aplica en el sentido de CloudWatch/Prometheus sobre ECS/EKS (no existen en este stack). El único "auto-" disponible es el health-check-gated restart nativo de Railway. El disparador real es humano: `notification.failed.*` sostenido, o un reporte de que el "detalle de la orden" en el email llega mal formado/sin escapar.

---

## 8. Rollback plan

### Triggers

| Trigger | Fuente | Umbral |
|---|---|---|
| La API no arranca en producción tras el deploy | Logs de Railway / `validateEnv` lanzando | Inmediato — pero ver nota abajo: puede no ser causado por este change |
| `notification.failed.*` sostenido | `GET /v1/admin/metrics` (cuando exista tráfico real) | Sin baseline medida todavía para fijar un múltiplo — cualquier tasa sostenida amerita revisión |
| Contenido del email mal formado (HTML sin escapar, total/ítems incorrectos) | Reporte manual / smoke test (§7.2) | Cualquier ocurrencia — regresión de seguridad (HTML injection, `design.md` "Threat model") o de negocio |
| Latencia del webhook de MP / `PATCH` admin degradada tras el deploy | Sentry (pendiente) / logs | Correlación temporal con este deploy específicamente (el reintento in-process es el único cambio de latencia posible, `design.md` "Costo aceptado") |

### Mecanismo (orden de `operations-standards.md` §4.7, adaptado a Railway)

1. **Feature flag**: NO APLICA — no hay flag de release (§4); la única palanca de "apagado" equivalente es **quitar `RESEND_API_KEY` de Railway y redeploy** (fuerza la caída a `LoggingNotificationAdapter`), lo cual no es un rollback de código sino un cambio de config — más rápido que un redeploy si el problema es específicamente el contenido/comportamiento del adapter real y no el código en sí.
2. **Rollback de código**: redeploy del último commit verde en Railway (`docs/services/dsm-ecommerce/runbook.md` §3.3). Tiempo estimado: minutos, sin dato medido todavía.
3. **NO SE REQUIERE rollback de migración** — no hay migración (§3).
4. **Importante, específico de este change**: un rollback de código también **revierte el fail-fast nuevo** — el `env.validation.ts` anterior a este change no exige `ORDER_NOTIFICATIONS_FROM`/`OWNER_NOTIFICATION_EMAIL`, así que revertir el código también quita esas 2 variables de la lista de bloqueo de arranque. Esto es una propiedad útil, no un efecto secundario a temer: si el problema fuera específicamente "faltan estas 2 variables y no hay tiempo de provisionarlas", el rollback de código es también la forma más rápida de destrabar el arranque — vuelve a depender sólo de las variables que ya eran requeridas antes (`RESEND_API_KEY`, `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, que de todos modos siguen sin provisionar hoy, §0.2).
5. **Sin dato a reconciliar**: esta superficie es fire-and-forget puro sobre `NotificationPort`, sin ninguna fila nueva escrita en ningún lado (§3) — un rollback no deja estado inconsistente que reparar, a diferencia de US-021 (que sí anonimiza datos de forma irreversible). Es el caso más simple posible de rollback: no hay nada que reconciliar más allá de "el próximo deploy vuelve a construir/enviar los emails que se hayan perdido en la ventana del incidente", y ninguno de esos emails es crítico para el estado transaccional de la orden (AC-6: la confirmación/decremento de stock ya ocurrió antes de que el puerto se invoque).

### Time-to-recovery target

Sin SLO declarado (§0) para fijar un número — aplicar el mismo esfuerzo que cualquier redeploy Tier-2, best-effort hasta que exista medición real.

---

## 9. Operational handoff

### 9.1 Runbook — actualizar, no crear desde cero (routear a `doc-updater`)

`docs/services/dsm-ecommerce/runbook.md` ya tiene una fila genérica para Resend en §4 ("Resend caído... No bloquea la compra") y ya incluye `RESEND_API_KEY` en la lista de secretos rotables de §3.5 — no hay que crear esas entradas. Sí faltan dos actualizaciones puntuales de este change:

- [ ] §5 "Problemas conocidos": agregar una fila **"Sin cuenta Resend real / dominio verificado provisionado"** (mismo estilo que la fila de US-009 en §3.1, pero como entrada de tabla en vez de nota narrativa) — Estado: Activo. Efecto: en producción (`NODE_ENV=production`), la API no arranca sin `RESEND_API_KEY`/`ORDER_NOTIFICATIONS_FROM`/`OWNER_NOTIFICATION_EMAIL` (§0.2); fuera de producción, cae silenciosamente a `LoggingNotificationAdapter`. Mitigación: ninguna todavía — bloqueado en la cuenta real (§5.2), mismo gap que `MP_ACCESS_TOKEN`.
- [ ] §4 "Respuesta a alertas": extender la fila existente "Resend caído" — hoy sólo cubre password-reset implícitamente ("no salen emails transaccionales"); agregar que desde este change también cubre los 4 avisos de órdenes, y que el reintento in-process (hasta ≈16s en el peor caso) puede sentirse como latencia en el webhook de MP o en el `PATCH` admin sin ser una caída real del checkout (AC-6 sigue garantizado).
- [ ] §8 "Última actualización": agregar entrada fechada con este change.

### 9.2 On-call

Sin rotación formal — el runbook lo marca `[pendiente — equipo de una persona]`. Este `/plan-deployment` no inventa una rotación que no tiene a quién asignarse; mismo criterio que US-021 §9.3.

### 9.3 Comms

Mismo equipo real que US-021 §9.4 (Pedro Suarez, Dueño, único contacto de cliente; sin separación PM/PO/ingeniería):

| Audiencia | Canal | Timing | Nota |
|---|---|---|---|
| Pedro (dueño) | El canal que ya usen | Antes de decidir provisionar la cuenta Resend real (§5.2) | No es un gate técnico — es la decisión de negocio que él tiene que tomar (qué dominio verificar, qué casilla usar como `OWNER_NOTIFICATION_EMAIL`) antes de que esta funcionalidad pueda activarse en producción real |

### 9.4 Change record

No aplica hoy — sin ventana de mantenimiento que registrar porque no hay producción (§0). Cuando exista, seguir `operations-standards.md` §10 (change record).

### 9.5 ORR

**No aplica un ORR independiente para este change** — per `operations-standards.md` §8.4, Resend no es una dependencia externa nueva (§0.1), por lo que el criterio "New external dependency ⇒ ORR" no se dispara. Cuando exista el ORR de plataforma completo (obligatorio per §8.1, "every new service", disparado por US-019), ese checklist debería incluir un ítem específico: confirmar que `RESEND_API_KEY`/`ORDER_NOTIFICATIONS_FROM`/`OWNER_NOTIFICATION_EMAIL` están provisionadas con una cuenta real y dominio verificado antes de declarar "notificaciones de órdenes" cumplida en producción.

---

## 10. Platform-specific considerations

### 10.A Backend-specific

- **API versioning impact**: ninguno — sin endpoints nuevos ni modificados (`proposal.md` "Out of scope").
- **Concurrent versions**: sin cambio — el proyecto sólo tiene `v1`.
- **Resilience defaults**: Resend no es una dependencia saliente nueva (ya cubierta desde US-014 con `conTimeout`/`RESEND_TIMEOUT_MS`); este change agrega **reintento con backoff acotado** sobre esa misma dependencia (`design.md` Decisión 1, patrón copiado de `payments/mercadopago/backoff.ts`) — timeout + retry + clasificación transitorio/permanente ya están declarados explícitamente en `design.md`, coherente con lo que `backend-standards.md` §15 exige para toda dependencia saliente. Sin circuit breaker propio (no pedido — el volumen y blast radius de este puerto no lo justifica, y el patrón in-process ya tiene techo de reintentos).

*(§10.B Web-specific y §10.C Android-specific: no aplican — change 100% backend, sin superficie web ni móvil.)*

---

## 11. Sign-off requirements

Mismo criterio de equipo real que US-021 §11 (sin roles formales de SRE/EM/QA dedicados):

| Rol | Requerido para | Status |
|---|---|---|
| Implementador/a (quien corre `develop-backend` sobre `tasks.md`) | Que el código cierre exactamente lo que este plan asume (sin migración, sin flag, fail-fast extendido tal como se describe en §0.2) | Pendiente |
| Pedro Suarez (Dueño) | Decisión de negocio sobre la cuenta Resend real (dominio a verificar, remitente, casilla de `OWNER_NOTIFICATION_EMAIL`) — §5.2/§9.3; no es un gate de ingeniería pero sin su decisión la funcionalidad no se activa nunca en producción | Pendiente |
| — SRE/Platform: no aplica (rol inexistente hoy) | — | — |
| — QA formal: `qa-plan.md` ya existe para este change (a diferencia de US-021) — su sign-off es sobre AC-1/2/3/7/8 verdes contra `LoggingNotificationAdapter`; AC-4/AC-5 quedan `blocked` a nivel aceptación por diseño (§0 de `qa-plan.md`), no por omisión | Pendiente |
| — Architect: no aplica — sin breaking API change (§10.A) | — | — |
| — ORR: no aplica todavía (§9.5) | — | — |

---

## 12. Anti-patterns explicitly avoided

- `deployment-standards.md` anti-patrón #9/#10 ("Secrets in environment variables of the task definition" / "in `.env` files committed to repos") — evitado: los 3 secretos/config sensibles van como Railway service variables (§5.3), nunca committeados; `RESEND_API_KEY` ya tenía este tratamiento desde US-014.
- `deployment-standards.md` anti-patrón #19 ("Permanent feature flags without owner") — no aplica (§4 explica por qué esto no es un flag de release), pero se documenta la ausencia explícitamente en vez de omitirla en silencio, y se deja claro que el seam de configuración no necesita un dueño de cleanup porque es arquitectura permanente, no un flag temporal.
- `operations-standards.md` anti-patrón #21 ("'We'll add monitoring later' services") — no se declara el gap de alerta automatizada (§7.1) y se sigue de largo; se deja como lectura manual explícita hasta que exista scraper, mismo criterio que el resto de contadores `dsm_*_events_total` del proyecto.
- `operations-standards.md` anti-patrón #26 ("ORR as a tick-box exercise") — evitado no fingiendo un ORR de mentira contra un servicio sin tráfico real; se difiere honestamente al ORR de plataforma (§9.5).
- Anti-patrón implícito de este dominio (no numerado en los standards, pero relevante): **tratar "el código está listo" como equivalente a "la funcionalidad está lista para producción"** cuando la brecha real es una cuenta de proveedor sin provisionar — evitado nombrando la brecha explícitamente en §5.2 en vez de dejar que el merge del código dé una falsa sensación de cierre.

---

## 13. Standards consulted

- `docs/base-standards.md` (YAGNI, vocabulario, principios de reversibilidad)
- `docs/delivery/deployment-standards.md` §1 (foundations), §7.3/§7.4 (secret rotation, config as code), §8.1 (release strategy por tier), §12 (feature flags — usado para confirmar que este change NO califica), §13.1 (layers de rollback), §18 (anti-patterns #9/#10/#19)
- `docs/delivery/operations-standards.md` §4.7 (mitigation hierarchy), §5 (runbooks), §8.1/§8.4 (ORR — cuándo aplica, usado para confirmar que NO aplica), §14 (anti-patterns #21/#26)
- `docs/architecture/railway-baseline.md` §1-§2 (topología y defaults Railway), §6 (CI/CD baseline — sin canario nativo)
- `docs/architecture/api-standards.md` — no aplica (sin endpoints nuevos, confirmado)
- `docs/ai/documentation-standards.md` §11.1 (qué doc dispara cada tipo de cambio — usado para detectar el gap de `apps/api/README.md` §6)
- `docs/code/backend-node-standards.md` §7/§8 (ya citados por `design.md`/`proposal.md` — no se re-derivan, se confirma el `superRefine` real contra el código en §0.2)

---

## 14. Open questions

1. **¿Quién y cuándo decide provisionar la cuenta Resend real?** (§5.2, heredado de `proposal.md` OQ-3) — bloquea la activación real de esta US en producción, no el merge del código. Corresponde a Pedro (dueño) — mismo patrón que `MP_ACCESS_TOKEN`/`GEMINI_API_KEY`, ya en escalamiento por otra sesión.
2. **¿El entorno `staging` de Railway fijará `NODE_ENV=production` o algún otro valor?** No hay ningún documento del repo que lo decida (verificado: ni `railway.json`, ni `railway-baseline.md`, ni ningún change archivado lo especifica). Esto determina si el fail-fast de §0.2 corre también en `staging` o sólo en `production` — relevante para saber en qué momento exacto del pipeline de promoción las 2 variables nuevas empiezan a bloquear el arranque. No lo decide este plan; se recomienda resolverlo quien defina el pipeline real de Railway (US-019).
3. **Gap de documentación heredado, no de este change**: `apps/api/README.md` no documenta `MP_ACCESS_TOKEN`/`MP_WEBHOOK_SECRET` (US-009/US-010) en su patrón de "Variables de entorno" — este change agrega el mismo tipo de gap para sus 5 variables nuevas (§6). Se recomienda una limpieza conjunta de README como fast-follow, no bloquear este change por una deuda preexistente.
4. **Pre-condición de activación (§5.2)**: ¿el charter exploratorio de `qa-plan.md` §9 contra `staging` con la key real lo corre el mismo QA de este change o es un gate explícito y separado de la primera promoción? `qa-plan.md` OQ-QA-011-1 deja esto para que este plan lo declare — este plan recomienda que sea un paso explícito de la checklist de pre-deploy (§6) de quien ejecute la primera promoción con `RESEND_API_KEY` real, sin asignar todavía un responsable nominal (no hay rol QA dedicado en este proyecto, §11).

---

## 15. References

- US: `docs/user-stories/US-011-notificaciones-email.md`
- Change: `openspec/changes/US-011-notificaciones-email-backend/` (`proposal.md`, `design.md`, `tasks.md`, `qa-plan.md`)
- Precedente de deployment-plan (mismo repo, mismo grounding §0): `openspec/changes/archive/US-021-retencion-datos-ordenes-backend/deployment-plan.md`
- Runbook: `docs/services/dsm-ecommerce/runbook.md`
- `docs/RUN-MVP.md` (estado real de lo que corre hoy)
- Código verificado directamente: `apps/api/src/config/env.validation.ts` (líneas 376-426, `superRefine` de producción)
- `openspec/changes/US-019-provision-plataforma-cloud-infrastructure/design.md` (línea 74 — slot `RESEND_API_KEY` reservado para esta US)
- `docs/architecture/decisions/0001-platform-railway-neon-r2.md`, `docs/architecture/railway-baseline.md`
- `docs/architecture/decisions/0004-redis-bullmq-async-processing.md` (citada por `design.md` Decisión 1 — no se re-deriva acá)
