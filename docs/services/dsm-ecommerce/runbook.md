---
service: dsm-ecommerce
tier: 2
status: Skeleton
owner: dev de guardia (equipo DSM)
source: US-019 platform-cloud (T0.2) — E2E §18, §18.5
language: es
last-updated: 2026-08-16
---

# Runbook — dsm-ecommerce

> **Para quién es**: el operador técnico de guardia a las 3 AM. Cada entrada responde una sola pregunta: *"me sonó el pager, ¿qué hago?"*. No es documentación de arquitectura (eso es `docs/product/design-e2e.md`) ni referencia de API (eso es el OpenAPI en `openspec/specs/`).
>
> **Estado: esqueleto autorizado en US-019** (`operations-standards` §5.1 — todo servicio nuevo tiene runbook desde que se aprovisiona). Los valores marcados `[pendiente: T…]` se completan cuando la task de provisioning correspondiente cierre; el tuning de on-call e incidentes lo refina `/plan-deployment`. **No inventar** un valor para llenar un hueco: si está `[pendiente]`, es que todavía no existe.

## 1. Vista rápida

| Campo | Valor |
|---|---|
| **Servicio** | `dsm-ecommerce` — e-commerce con búsqueda por IA (catálogo, carrito, checkout MercadoPago, enriquecimiento por IA) |
| **Tier** | 2 — **SLO 99.5% mensual** (E2E §17; coherente con Railway single-AZ) |
| **Componentes** | `web` (Next.js SSR) · `api` (NestJS) · `worker` (BullMQ) — proyecto Railway único, entornos `staging` + `production` |
| **Datos** | Neon PostgreSQL 16 + `pgvector` (US-East) · Redis (add-on Railway) · Cloudflare R2 (imágenes) |
| **Operador de negocio** | Dueño/Pedro — opera **solo desde el panel web**, no toca infraestructura (ver §3.1) |
| **Operador técnico** | Dev de guardia — deploys, secretos, incidentes, restores |
| **Dashboards** | Railway (logs + métricas) · Sentry (errores) — URLs `[pendiente: T4.2]` |
| **Alertas** | Sentry → email/Slack, spike de errores `[pendiente: T4.3]` |
| **Repo** | este monorepo (`apps/web`, `apps/api`, `apps/worker`, `packages/db`) |
| **Config de deploy** | `apps/api/railway.json`, `apps/web/railway.json` (config-as-code; **sin Terraform** — Railway es PaaS) |

## 2. Mapa del servicio

```
Cloudflare (DNS + CDN + R2)
   └─ TLS ─▶ Railway (staging | production)
               ├─ web    (Next.js SSR) ──▶ api
               ├─ api    (NestJS) ───────▶ Neon Postgres + pgvector (TLS)
               │                       └─▶ Redis (add-on)
               └─ worker (BullMQ) ──────▶ Redis · Neon · Gemini · R2
```

**Dependencias externas** (una caída acá degrada, no tumba): MercadoPago (pagos) · Google Gemini (enriquecimiento + búsqueda semántica) · Resend (emails) · Cloudflare R2 (imágenes).

**Consumidores aguas abajo**: ninguno — `dsm-ecommerce` es el sistema de punta a punta.

## 3. Operaciones comunes

### 3.1 Qué hace el operador de negocio (sin soporte técnico)

Todo desde el panel: cargar/actualizar catálogo (CSV/Excel + progreso de enriquecimiento), procesar venta (`new` → preparar → `ready` → `delivered`), cancelar/reembolsar (reintegra stock + refund MP), ver métricas, y producto sin stock (editar stock o `status=archived`). **Si el pedido del operador es uno de estos, no es un incidente técnico.**

### 3.2 Deploy

Push a la rama → la CI (`.github/workflows/ci.yml`) debe pasar → Railway despliega por su integración GitHub: `main` → production, `staging` → staging `[pendiente: T4.1]`.

### 3.3 Rollback

**Rollback = redeploy del último commit verde**, no un revert a mano bajo presión.

1. Railway → servicio afectado → *Deployments* → localizar el último deployment verde previo.
2. *Redeploy* sobre ese deployment.
3. Verificar salud: `curl -sf https://<host-api>/health` (liveness) y `curl -sf https://<host-api>/ready` (readiness — incluye DB).
4. Si el deploy malo aplicó una migración de datos, el rollback de código **no** la revierte → ir a §6.2.

### 3.4 Reiniciar / escalar

Reinicio: Railway reinicia solo por health check fallado; forzar con *Restart* en el servicio. Escalado: ajustar recursos/réplicas del servicio en Railway (single-AZ, sin autoscaling configurado a esta escala — E2E §21).

### 3.5 Rotar secretos

Aplica a `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `GEMINI_API_KEY`, `RESEND_API_KEY`, `JWT_SECRET`, `DATABASE_URL`, `REDIS_URL`.

1. Rotar el valor en el proveedor (MP / Google / Resend / Neon / Cloudflare).
2. Railway → entorno (`staging` o `production`) → servicio → *Variables* → actualizar el valor.
3. Redeploy del servicio (las variables se aplican al arranque).
4. Verificar `/ready` y, para MP, un webhook de prueba.

> ⚠️ **Rotar `JWT_SECRET` invalida todas las sesiones activas** — los usuarios quedan deslogueados. Hacerlo en ventana de bajo tráfico salvo que sea respuesta a una filtración (ahí es inmediato).
>
> Los secretos **nunca** van al repo ni a la imagen (`security-standards` §5; `.env.production` en git está prohibido). Si un secreto se filtró en un commit: rotar primero, limpiar historia después.

### 3.6 Primera corrida del enriquecimiento IA (US-005)

Es la operación que **habilita la búsqueda semántica**: hasta que corra, el catálogo no tiene
vectores y `/search` no tendría qué consultar.

**Ventana: ≈ 5,5 h** para 5.000 SKUs con el free tier de Gemini (15 RPM). Es techo del
**proveedor**, no del código: el adapter espacia las salidas a `60000 / GEMINI_MAX_RPM` ms para
no cobrar 429, así que la única palanca real es subir la cuota.

> **Decisión del PO (2026-08-23): la primera corrida se lleva el free tier ENTERO.** El motivo
> es que la búsqueda semántica no sirve de nada hasta que existan los vectores, así que darle
> los 15 RPM al enriquecimiento al principio no le quita nada a nadie. Con los 5 RPM del estado
> estable, esta misma corrida tardaría **≈ 33 h** —una ventana de fin de semana— en vez de
> ≈ 5,5 h.
>
> **Los defaults del código son el estado ESTABLE** (`GEMINI_MAX_RPM=5`,
> `GEMINI_SEARCH_MAX_RPM=10`), no el de la primera corrida: un default que codifica una
> migración de una sola vez queda mintiendo para siempre. Así que la primera corrida es un
> **override explícito y temporal**, y son **dos** variables, no una:
>
> ```
> GEMINI_MAX_RPM=15
> GEMINI_SEARCH_MAX_RPM=0     # la búsqueda queda degradada a full-text mientras dura
> ```
>
> El arranque **valida la suma** contra los 15 RPM del tier, así que poner sólo la primera
> **no arranca** — y eso es deliberado: es la única forma de que nadie suba un presupuesto sin
> bajar el otro y descubra el problema como 429 del proveedor atribuidos a «Gemini anda mal».
>
> ⚠ **Paso obligatorio al terminar la primera corrida** (ver el punto 5 de abajo): bajar
> `GEMINI_MAX_RPM` a **5** antes de que `/v1/search` entre en servicio. Si no, las dos
> superficies compiten por la misma cuota y la búsqueda —que es interactiva y tiene un
> presupuesto de p95 < 1,5 s— empieza a cobrar 429 y a degradar a full-text por culpa de un
> barrido de fondo. Y hay que corregir el número de esta sección en el mismo movimiento, o
> queda mintiendo sobre el tiempo que hay que reservar. Conviene dispararla **fuera del
horario de más tráfico** del storefront, aunque el ejecutor ceda el event loop entre lotes y la
API siga respondiendo.

0. **Tener un JWT admin.** Las dos rutas son admin-only. Si la cuenta admin todavía no está
   sembrada en ese entorno, el procedimiento está en `apps/api/README.md` §«Procedimiento de
   corte del bootstrap token» (`ADMIN_SEED_EMAIL` + `ADMIN_SEED_PASSWORD` + `seed`, idempotente).
   Sin admin no hay forma de disparar la corrida, y conviene descubrirlo antes de reservar la
   ventana de 5,5 h.
1. Confirmar que la clave está cargada: `GET /v1/admin/enrichment/status` debe devolver
   `runner_state` distinto de `disabled`. Si dice `disabled`, falta `GEMINI_API_KEY` o
   `ENRICHMENT_ENABLED` está en `false` — **no es una caída**.
2. Disparar: `POST /v1/admin/enrichment/runs` con cuerpo `{}` (responde **202**, no espera a
   terminar).
3. Seguir el avance con el `GET /status`: `coverage.embedded` sube y `coverage.pending` baja. El
   objetivo de AC-3 es `coverage_ratio >= 0.9`.
4. Al terminar, revisar `coverage.abandoned`. Si es > 0, esos productos **siguen publicados y
   visibles** (perdieron calidad de búsqueda, no presencia) y **no vuelven solos**: se recuperan
   con `POST /runs` y `{"force": true}` una vez resuelto el problema del proveedor.
5. **Ceder la cuota a la búsqueda**: **borrar los dos overrides** en Railway (o dejarlos en
   `GEMINI_MAX_RPM=5` y `GEMINI_SEARCH_MAX_RPM=10`, que es lo mismo que el default) + restart.
   Es la segunda mitad de la decisión del PO de arriba y **no es opcional** si `/v1/search` va
   a estar en servicio: sin ceder la cuota, un re-enriquecimiento de fondo le come los RPM a
   las consultas de los clientes, que tienen presupuesto de p95 < 1,5 s. Desde acá el
   enriquecimiento incremental (altas y ediciones del catálogo) corre a 5 RPM, que para un
   puñado de productos por día es de sobra.

> El ejecutor corre **in-process** (ADR-0014): no hay worker ni Redis. Si el proceso se reinicia a
> mitad de la corrida no se pierde trabajo — la cola es `products.enrichment_done = false` y los
> productos arrendados vuelven a estar disponibles al vencer su lease
> (`ENRICHMENT_LEASE_MS`). Basta con volver a disparar.

## 4. Respuesta a alertas

| Síntoma / alerta | Severidad | Qué significa | Acción inmediata |
|---|---|---|---|
| **Spike de errores en Sentry** `[pendiente: T4.3]` | Alta | Tasa de excepciones por encima de lo normal en `web`/`api`/`worker` | Abrir el issue en Sentry → identificar release → si el spike arranca con un deploy, **rollback** (§3.3). Si no, seguir por el componente afectado abajo. |
| **App caída / health check falla** | Alta | Railway no obtiene 200 en `/health` | Railway reinicia solo. Si persiste tras 2 reintentos: revisar logs del servicio en Railway, y redeploy del último build verde (§3.3). |
| **`/ready` devuelve 503** | Alta | El proceso vive pero **la DB no responde** | Verificar Neon (estado del proyecto, autosuspend en free tier despierta en el primer query). Si Neon está caído, es incidente de proveedor → §7. |
| **Webhook MP no llega / órdenes atascadas en `pending_payment`** | Alta | El pago se cobró pero la orden no avanzó | Reconciliar consultando el estado a la API de MP (operación **idempotente**) y reintentar el decremento de stock. Nunca marcar la orden a mano sin confirmar el pago en MP. |
| **Un endpoint responde 429/404 a todos los clientes, pero el origen está sano** | Alta | Probable **respuesta no-2xx cacheada en el edge**. El síntoma no delata la causa: el origen se ve bien y las métricas de Railway no muestran carga. | 1. Pegarle al host de Railway **directo, salteando Cloudflare**: si responde 200, el problema es la caché de edge, no la app. 2. Purgar esa URL en Cloudflare. 3. Revisar si alguien creó una **page rule de caché**: no debe haber ninguna — la política es honrar el `Cache-Control` del origen (ver `design.md` §Topología). Una regla con TTL fijo cachea los no-2xx y convierte el rate-limit en un DoS. |
| **Cola BullMQ atascada** | Media | Jobs encolados sin drenar (emails). **El enriquecimiento IA no pasa por acá**: corre in-process (ADR-0014) y su cola es `products.enrichment_done = false`; se diagnostica con `GET /v1/admin/enrichment/status`. | Revisar jobs fallidos / dead-letter en el dashboard de la cola; verificar que Redis esté up y que el `worker` esté corriendo; reprocesar los fallidos. |
| **Gemini caído / rate-limited** | Baja | Enriquecimiento degradado (y, cuando exista US-004, búsqueda semántica degradada). **El catálogo sigue navegable y vendible**: los productos sin vector no desaparecen de la tienda (AC-5). | 1. **Diagnóstico**: `GET /v1/admin/enrichment/status` con el JWT admin. `runner_state: "cooldown"` + `last_error_code: "dsm:enrichment/ai-transient"` ⇒ el breaker se abrió tras `ENRICHMENT_FAILURE_THRESHOLD` fallos consecutivos; reabre solo a los `ENRICHMENT_COOLDOWN_MS` (5 min por defecto). `runner_state: "disabled"` ⇒ **no es una caída del proveedor**: falta `GEMINI_API_KEY` o `ENRICHMENT_ENABLED=false`. 2. **Sin acción en el caso normal**: los transitorios se reintentan dentro de la llamada respetando el `Retry-After`, y lo que igual falla queda con backoff durable en la base (1 m · 5 m · 25 m · 2 h · 10 h) — sobrevive a un reinicio. 3. **Corte manual** si hay que dejar de gastar cuota ya (pico de costo, incidente del proveedor): `ENRICHMENT_ENABLED=false` en Railway + restart del servicio. Es variable de entorno, **no requiere deploy de código**. El catálogo sigue navegable; se pierde la mejora de búsqueda, no la tienda. 4. **Recuperación**: volver a `true` y `POST /v1/admin/enrichment/runs`. Si `coverage.abandoned > 0`, los abandonados **no vuelven solos** (el tope de intentos existe justamente para eso): `POST /v1/admin/enrichment/runs` con `{"force": true}`. 5. Si persiste, subir cuota en Google AI Studio o bajar `GEMINI_MAX_RPM` para dejar de pedir 429. |
| **Búsqueda degradada** (`search.degraded` alto) | Baja | **No es una caída: es el plan B funcionando.** La búsqueda respondió por full-text porque el proveedor de IA falló, se colgó (>900 ms) o no tiene cuota. El cliente sigue encontrando productos por texto y sigue comprando; lo que se pierde es la comprensión de lenguaje natural. **Con el free tier esto es un estado COMÚN, no excepcional**: los 15 RPM se reparten 10 búsqueda / 5 enriquecimiento, así que una ráfaga de consultas lo dispara. | 1. **La alerta va sobre la TASA SOSTENIDA, no sobre cada ocurrencia**: ocurrencias aisladas son el techo del tier haciendo su trabajo. Señales: `dsm_search_events_total{event="search.degraded"}` contra `{event="search.performed"}` en `GET /v1/admin/metrics`. 2. **Mirar `search.cache_hit` antes que la cuota**: si la degradación es alta y los cache-hits bajos, el problema es que las consultas no se repiten y el caché no alcanza — el siguiente paso natural es mover el caché de vectores a una tabla en Postgres (hoy vive en proceso y muere en cada deploy), porque el vector es determinista y se puede guardar para siempre. Recién después conviene pagar tier. 3. **Si es 100 % degradado**: revisar `GEMINI_API_KEY` y `GEMINI_SEARCH_MAX_RPM` — en **0** la búsqueda no llama al proveedor a propósito (es la configuración de la primera corrida del catálogo, §3.6). 4. **Corte deliberado**: `GEMINI_SEARCH_MAX_RPM=0` deja la búsqueda en full-text sin desplegar código, útil si hay que darle toda la cuota al enriquecimiento. La tienda sigue vendiendo. |
| **Resend caído** | Baja | No salen emails transaccionales | Los jobs reintentan; verificar estado del proveedor. No bloquea la compra. |
| **«Se me borró el carrito»** (reclamo de cliente, US-007) | Baja | **No es un bug.** La identidad del carrito del invitado **es la cookie** `dsm_cart`, y el carrito vive **7 días desde la última escritura** (`CART_TTL_DAYS`), no desde la última visita. Borrar cookies, cambiar de navegador o de dispositivo, o volver pasada la ventana ⇒ carrito vacío. **No hay forma de recuperarlo**: la fila se borró y el token en claro no se guarda en ninguna parte (sólo su hash), así que tampoco se puede buscar por token desde una consola. | 1. Confirmar el patrón con el cliente (¿limpió el navegador? ¿cuánto tiempo pasó? ¿otro dispositivo?). 2. Explicar que el carrito no se pierde por un error del sistema y que los productos siguen en el catálogo. 3. **Si los reclamos se repiten**, subir `CART_TTL_DAYS` en Railway — es una variable de entorno, **no requiere deploy de código** (sí un restart del servicio). Gatillo cuantitativo: reclamos recurrentes o `cart.viewed` sobre carritos vacíos **con** cookie presente subiendo de forma sostenida. 4. No inventar un carrito a mano en la base: sin el token del cliente, esa fila es inalcanzable. |
| **Tabla `carts` creciendo** (carritos vencidos) | Baja | La purga es **oportunista**: una fila vencida se borra recién cuando alguien intenta usarla, y sus líneas se van por `ON DELETE CASCADE`. Un carrito abandonado por un cliente que nunca vuelve queda como fila muerta. El job programado de barrido está **diferido** (OQ-BE-6 / US-019: Redis y BullMQ todavía no están aprovisionados). | Con el volumen esperado (miles de filas) es irrelevante durante meses; con `CART_TTL_DAYS = 7` la purga oportunista se dispara seguido. Si hiciera falta limpiar a mano: `DELETE FROM carts WHERE expires_at <= now();` — es seguro (la cascada se lleva `cart_items`) y **nunca** toca `products`: el carrito no reserva ni descuenta stock (ADR-0008). |

## 5. Problemas conocidos

| Problema | Estado | Mitigación |
|---|---|---|
| **Neon free tier en staging**: autosuspend + ventana de restore mínima | Activo (Q-2) | Aceptado para staging. El primer query tras suspensión tarda más. El upgrade a plan pago con PITR real es **gate previo al primer deploy productivo** (`/plan-deployment`). |
| **Sin sink de retención de logs** | Activo (Q-E, diferido) | Sentry cubre errores; los logs de Railway rotan. Sin auditoría de logs a largo plazo — deuda consciente. |
| **Sin dominio custom** | Activo (2026-08-16) | Se usan los subdominios `*.up.railway.app` con TLS de Railway. DNS/TLS custom en Cloudflare → `/plan-deployment`. |
| **`worker` sin config de deploy** | Activo | `apps/worker` sigue siendo placeholder. US-005 **no** lo necesitó: el enriquecimiento corre in-process (ADR-0014), con contrato asíncrono y estado durable, listo para cambiar el ejecutor por BullMQ cuando exista el add-on de Redis (US-019). |
| **Sin job de purga de carritos vencidos** (US-007) | Activo (diferido, OQ-BE-6) | La purga oportunista al resolver alcanza con la ventana de **7 días**; el barrido programado necesita BullMQ (US-019). Deuda anotada con dueño, sin urgencia mientras la tabla siga en miles de filas. |

## 6. Procedimientos de recuperación

### 6.1 Caída total

1. Confirmar alcance: ¿`web`, `api` o ambos? ¿Neon/Redis arriba? (`/health` vs `/ready` distinguen proceso vs dependencia.)
2. Si arranca con un deploy → **rollback** (§3.3).
3. Si es el proveedor (Railway/Neon/Cloudflare) → §7 y comunicar al dueño; no hay failover multi-región (decisión ADR-0001).

### 6.2 Restore de datos — **RTO ≤ 4h, RPO ≤ 24h** (E2E §17)

Para corrupción o borrado de datos.

1. **Frenar la escritura**: pausar el `worker` y, si hace falta, poner `api` fuera de servicio para no escribir sobre datos corruptos.
2. **Elegir el punto**: Neon → *Restore* → PITR al timestamp previo al incidente (o el snapshot más cercano).
   > En **staging free tier** la ventana de restore es mínima (§5). El PITR completo existe con el plan pago.
3. **Restaurar** y actualizar `DATABASE_URL` en Railway si el restore produce un endpoint nuevo.
4. **Redeploy** de `api` y `worker`.
5. **Smoke test del loop**: buscar un producto → compra simulada → preparar la orden. Sin ese paso el restore no está confirmado.
6. Registrar en el post-mortem qué se perdió entre el punto de restore y el incidente.

### 6.3 Costos desbocados

Revisar consumo en Railway / Neon / Cloudflare / Gemini. Sospechosos habituales: loop de reintentos en el `worker` (jobs que fallan y reencolan) y llamadas a Gemini sin backoff. Frenar el `worker`, corregir, reanudar.

## 7. Escalamiento

| Cuándo | A quién |
|---|---|
| Incidente > 1h sin ruta clara, o pérdida de datos confirmada | Dueño del producto (Pedro) — impacto de negocio y decisión de comunicar a clientes |
| Caída de proveedor (Railway / Neon / Cloudflare / MP) | Soporte del proveedor + status page; comunicar al dueño |
| Filtración de secreto | Rotar **primero** (§3.5), avisar al dueño después |

**On-call**: `[pendiente — equipo de una persona; rotación formal se define en /plan-deployment]`.

## 8. Última actualización

**2026-08-22** — US-007 (carrito del invitado): filas de day-2 «se me borró el
carrito» y «tabla `carts` creciendo» en §4, y la deuda del job de purga en §5. La
retención es de **7 días desde la última escritura** y se cambia por variable de
entorno (`CART_TTL_DAYS`), sin deploy de código.

**2026-08-16** — esqueleto creado en US-019 T0.2 (fuente: E2E §18.5). Próxima revisión obligatoria: al cerrar las fases cloud de US-019 (T4.1–T4.3, para completar dashboards/alertas) y en `/plan-deployment` (on-call, checklist pre-prod, dominio/TLS).
