---
parent-us: US-021
discipline: backend
variant: null
language: es
---

# US-021 Backend — Tasks

> Closure-grade: cada task tiene `Exit criterion:` observable y `Verify:` con el
> comando exacto que `/develop-backend` corre (forma terminante, F49). Cwd =
> raíz del repo. Runner: `pnpm --filter @dsm/api test -- --testPathPattern=<patrón>`
> (Jest no-watch por defecto). Integration/e2e corren contra el Postgres real de
> `docker-compose` (`ai4devs-finalproject-postgres-1`, `:55432`).
>
> **Estimación dual**: **~6,8 h AI-asistido** / **~13,5 h tradicional** (16 tasks,
> suma de fases: 0,9 + 1,2 + 0,9 + 1,3 + 1,1 + 2,1 + 0,7). La US §7 presupuesta
> `BE-US-021` en 5-8 h tradicional: el tradicional excede el techo ~5,5 h por
> trabajo que la US da por resuelto al describirlo como «transformación acotada
> sobre un esquema que ya existe» — la US no presupuesta la **superficie admin
> completa que este change tiene que construir desde cero** (no hay módulo de
> órdenes admin todavía: dos endpoints + guards + rate-limit + contrato OpenAPI),
> el **runner de arranque** (mismo patrón que ADR-0012, con su propio ciclo de
> vida y tests), el **servicio de eventos dedicado** (US §9 exige cero PII en el
> payload, lo que en este repo siempre significa un servicio nuevo, no una
> reutilización), y la prueba explícita de **AC-2** (invariante de negocio: las
> métricas no cambian) sobre un agregado real, no una sola aserción. La
> transformación en sí —dos columnas, un `UPDATE` guardado— son ~2 h.

## Traceability matrix

| AC | Descripción | Task IDs |
|---|---|---|
| AC-1 | Anonimización automática al cumplirse el plazo | T1.3, T3.2, T4.2 |
| AC-2 | Métricas/valor comercial preservados | T5.3 |
| AC-3 | Anonimización a pedido | T3.1, T4.1 |
| AC-4 | Auditoría (cuándo, por qué motivo) | T0.1, T3.1, T3.2 |
| AC-5 | Orden anonimizada sigue operable | T1.2 (nota de diseño), Open question a US-012 |
| AC-6 | No se borra ninguna orden ni ítem | T5.4 |
| AC-7 | Consentimiento no se destruye | T5.5 |
| AC-8 | Idempotencia / no reversibilidad | T1.2, T5.1, T5.6 |
| AC-9 | Sólo el dueño anonimiza a pedido | T4.1, T5.2 |

## Pre-requisitos

- [ ] **US-008 backend construido** (crea `orders` con las columnas de PII que
  esta US anonimiza). Ya está: 20/20 tasks cerradas, en review (PR #11).
  **Verify**: `grep -c "buyer_name" packages/db/prisma/schema.prisma` ≥ 1
- [ ] **Postgres local arriba**: `docker compose up -d postgres` (host `:55432`).
- [ ] **Working tree limpio en `packages/db/prisma/schema.prisma` y
  `apps/api/src/checkout/`** — este change migra el esquema y extiende el
  módulo del checkout; con otra tarea en vuelo sobre esos archivos se pisan
  (precedente: la colisión de sesiones de US-007).
  **Verify**: `git status --porcelain packages/db/prisma/schema.prisma apps/api/src/checkout` vacío

---

## Fase 0: Esquema y configuración — 0,9 h

- [x] T0.1 Migración aditiva `orders.anonymized_at` + `orders.anonymization_reason`
  (F40 — column-complete)
  - **Pattern**: dos columnas nuevas en el `model Order` de
    `packages/db/prisma/schema.prisma`, migración generada con
    `pnpm --filter @dsm/db migrate -- --create-only --name add_order_anonymization`
    y los dos `CHECK` agregados a mano al `migration.sql` generado, igual que
    `CHECK (consent_accepted = true)` de US-008 — `per backend-node-standards.md
    §5 — migraciones aditivas, nunca destructivas en un solo deploy`.
    ```prisma
    anonymized_at         DateTime?
    anonymization_reason  String?
    ```
    ```sql
    ALTER TABLE "orders"
      ADD COLUMN "anonymized_at" TIMESTAMP(3),
      ADD COLUMN "anonymization_reason" TEXT;

    ALTER TABLE "orders" ADD CONSTRAINT "orders_anonymization_reason_check"
      CHECK ("anonymization_reason" IS NULL
             OR "anonymization_reason" IN ('retention_policy', 'requested'));

    ALTER TABLE "orders" ADD CONSTRAINT "orders_anonymization_consistency_check"
      CHECK (("anonymized_at" IS NULL) = ("anonymization_reason" IS NULL));
    ```
  - **Exit criterion**: `orders` tiene las dos columnas nuevas, ambas nullable;
    los dos `CHECK` existen en la base; ninguna columna existente cambió de
    tipo; `pnpm --filter @dsm/db migrate` corre limpio contra el Postgres local.
  - **Verify**: `grep -c 'anonymized_at\|anonymization_reason' packages/db/prisma/migrations/*/migration.sql | awk -F: '{s+=$2} END {print s}'` ≥ 4 (dos columnas + dos CHECK, cada uno aparece al menos una vez) **y** `grep -c "CHECK" packages/db/prisma/migrations/*add_order_anonymization*/migration.sql` = 2 **y** `pnpm --filter @dsm/db migrate` termina en 0
  - **Desviación documentada**: el Postgres local compartido (`ai4devs-finalproject-postgres-1`)
    tenía migraciones de US-023 (`add_payments`) y US-012 (`add_order_status_history`) —
    ambas en worktrees paralelos, en vuelo al momento de correr esta task — aplicadas en
    la base pero ausentes de la carpeta de migraciones de esta rama. `prisma migrate dev`
    (el runner detrás de `pnpm --filter @dsm/db migrate`) detecta ese drift como
    divergencia y exige un reset destructivo del schema, algo que borraría el trabajo en
    vuelo de esas otras sesiones. Se escribió `migration.sql` a mano con el contenido
    exacto de este Pattern y se aplicó con `prisma migrate deploy` (no interactivo, no
    resetea, sólo aplica lo pendiente) — decisión confirmada con el usuario. Las dos
    columnas + los dos `CHECK` quedaron verificados directo contra la base
    (`\d orders`), ambos grep del Verify pasan (6 ≥ 4, 2 = 2).

- [x] T0.2 Config nueva validada al arranque (fail-fast, §7)
  - **Pattern**: agregar a `envSchema` en `apps/api/src/config/env.validation.ts`
    — `per backend-node-standards.md §7 — config validada al arranque,
    fail-fast`:
    ```ts
    ORDER_RETENTION_MONTHS: z.coerce.number().int().positive().default(12),
    ORDER_ANONYMIZE_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
    ORDER_ANONYMIZE_RATE_LIMIT_TTL_MS: z.coerce.number().int().positive().default(60_000),
    ORDER_RETENTION_SWEEP_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
    ORDER_RETENTION_SWEEP_RATE_LIMIT_TTL_MS: z.coerce.number().int().positive().default(3_600_000),
    ```
  - **Exit criterion**: los 5 valores tienen default y ninguno rompe el arranque
    en ausencia de la env var; un valor no numérico falla el arranque.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=env.validation` en 0, con un nuevo `describe('Retención y anonimización de órdenes (US-021 T0.2) — defaults y fail-fast')` que cubre los 5 defaults y al menos 1 caso de fail-fast (valor no numérico)

---

## Fase 1: Constantes + `OrdersRepository` — 1,2 h

- [x] T1.1 Constantes de anonimización
  - **Pattern**: `apps/api/src/checkout/order-anonymization.ts` con
    `AnonymizationReason`, `ANONYMIZED_BUYER_NAME`, `ANONYMIZED_BUYER_EMAIL`
    (dominio `.invalid`, RFC 2606), `ANONYMIZED_BUYER_PHONE` — ver `design.md`
    §Approach.
  - **Exit criterion**: los tres valores son constantes exportadas, sin
    parametrización; el email usa el TLD `.invalid`.
  - **Verify**: `grep -c "\.invalid" apps/api/src/checkout/order-anonymization.ts` ≥ 1

- [x] T1.2 `OrdersRepository.findById` + `anonymize` (guardado por `WHERE`)
  - **Pattern**: `per backend-node-standards.md §5 — el repositorio es el
    único punto de ORM`; ver el bloque completo en `design.md` §Approach
    ("OrdersRepository — dos escrituras + una lectura"). El `updateMany` con
    `anonymized_at: null` en el `where` es el mecanismo de idempotencia — sin
    excepción, sin segunda escritura.
  - **Exit criterion**: sobre una orden existente sin anonimizar, `anonymize`
    escribe los tres placeholders + `anonymized_at` + `anonymization_reason` y
    devuelve el resultado; sobre una orden ya anonimizada, no vuelve a escribir
    (mismo `anonymized_at` devuelto) y no lanza; sobre un id inexistente,
    devuelve `null`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=orders.repository` en 0, con 3 casos nuevos (anonimiza / no-op sobre ya anonimizada / null sobre inexistente)

- [x] T1.3 `OrdersRepository.anonymizeRetentionEligible` (barrido de conjunto)
  - **Pattern**: un único `updateMany` con `where: { anonymized_at: null,
    created_at: { lt: cutoff } }` — sin bucle por fila (justificado en
    `design.md` §Trade-offs contra el batching de `ImportRunner`).
  - **Exit criterion**: anonimiza todas las órdenes con `created_at` anterior al
    corte y `anonymized_at IS NULL`, ninguna otra; devuelve el conteo exacto;
    correr dos veces seguidas con el mismo corte devuelve `N` la primera vez y
    `0` la segunda, sin error.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=orders.repository` en 0, con un caso que siembra 3 órdenes (2 vencidas, 1 no) y verifica `count=2` la primera corrida y `count=0` la segunda

---

## Fase 2: Errores + eventos — 0,9 h

- [x] T2.1 `OrderNotFoundError` (404 RFC 7807)
  - **Pattern**: en `apps/api/src/checkout/checkout-errors.ts`, espejando
    `CartEmptyError` — `per backend-node-standards.md §6 — errores de dominio
    en TS plano, mapeados por el filtro global a RFC 7807`.
    ```ts
    export class OrderNotFoundError extends DomainError {
      readonly status = 404;
      readonly type = 'dsm:checkout/order-not-found';
      constructor() { super('La orden no existe'); }
    }
    ```
  - **Exit criterion**: lanzarlo desde un handler produce un 404 con
    `type: 'dsm:checkout/order-not-found'` en el envelope RFC 7807.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=checkout-errors` en 0

- [x] T2.2 `OrdersRetentionEventsService` (cero PII)
  - **Pattern**: `apps/api/src/observability/orders-retention-events.service.ts`,
    mismo esqueleto que `CheckoutEventsService` (delega el contador en
    `MetricsService`, `@Optional()`) — ver `design.md` §Approach
    ("Observabilidad"). La firma **no** acepta ningún parámetro por el que
    pueda entrar un nombre, email o teléfono — `per observability-standards.md
    §9 — redacción de PII en logs/métricas` y US §9 (irreversibilidad,
    "sin incluir un solo dato personal en el evento").
  - **Exit criterion**: `emit('orders_retention.swept', null, undefined, {
    anonymized_count: N })` incrementa `dsm_orders_retention_events_total` y
    loguea `{event, entity_id, trace_id, anonymized_count}` sin ningún campo de
    contacto; `count()`/`value()` reflejan el incremento.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=orders-retention-events` en 0, con un test que inspecciona el objeto logueado y falla si contiene `buyer_name`/`buyer_email`/`buyer_phone` como clave

---

## Fase 3: Servicio + runner de arranque — 1,3 h

- [x] T3.1 `OrdersRetentionService.anonymizeOnRequest` (AC-3, AC-4, AC-9 en
  espíritu — la autorización real la da el guard de Fase 4)
  - **Pattern**: ver `design.md` §Approach ("Servicio, endpoints y runner").
    `reason` fijo en `'requested'`, nunca parametrizable desde afuera del
    servicio.
  - **Exit criterion**: sobre un id existente sin anonimizar, anonimiza y emite
    `orders_retention.anonymized_on_request`; sobre un id ya anonimizado,
    devuelve el mismo resultado sin lanzar y **sin** emitir un segundo evento;
    sobre un id inexistente, lanza `OrderNotFoundError`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=orders-retention.service` en 0, con los 3 casos (incluida la aserción de "no segundo evento" contando `events.count(...)` antes/después de la segunda llamada)

- [x] T3.2 `OrdersRetentionService.runRetentionSweep` (AC-1, AC-4)
  - **Pattern**: `cutoffDate()` con `ORDER_RETENTION_MONTHS` (default 12);
    `reason` fijo en `'retention_policy'`; emite `orders_retention.swept`
    **siempre**, incluso con `count=0` (US §9 — "cada corrida").
  - **Exit criterion**: con el config default, una orden con `created_at` de
    hace 13 meses se anonimiza y una de hace 6 meses no; el evento agregado
    lleva el conteo correcto en `fields.anonymized_count`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=orders-retention.service` en 0

- [x] T3.3 `OrdersRetentionRunner.onApplicationBootstrap` (barrido oportunista,
  ADR-0012)
  - **Pattern**: mismo patrón que `ImportRunner.onApplicationBootstrap` — ver
    `design.md` §Approach. `try/catch` — un fallo del barrido NUNCA impide que
    la API levante.
  - **Exit criterion**: al construir el módulo, `onApplicationBootstrap` corre
    `runRetentionSweep()` una vez; si el servicio lanza, el error se loguea y
    el método resuelve igual (no propaga).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=orders-retention.runner` en 0, con un caso que simula `runRetentionSweep` rechazando y verifica que `onApplicationBootstrap()` no rechaza

---

## Fase 4: Controller + DTOs + wiring del módulo — 1,1 h

- [x] T4.1 `POST /v1/admin/orders/:id/anonymize` (AC-3, AC-9)
  - **Pattern**: ver `design.md` §Approach ("Controller"). `AdminGuard` +
    `AuthThrottlerGuard` (bucket `auth`, sin registrar uno nuevo) +
    `@SkipThrottle({ storefront: true, cart: true })`, mismo patrón que
    `ImportsController` — `per security-standards.md §7.3` y `per
    backend-node-standards.md §2 — controller fino: valida, delega, mapea`.
  - **Exit criterion**: sin `Authorization` → 401; con JWT sin `role=admin` →
    403; con JWT admin sobre un id existente → 200 con
    `{order_id, anonymized_at, anonymization_reason}`; sobre un id inexistente
    → 404 `dsm:checkout/order-not-found`; sobre un id ya anonimizado → 200
    idéntico, sin error.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=orders-retention.controller` en 0

- [x] T4.2 `POST /v1/admin/orders/retention-sweep` (AC-1)
  - **Pattern**: mismos guards que T4.1; `@Throttle` con el presupuesto propio
    (5/hora) — `per security-standards.md §7.3`.
  - **Exit criterion**: con JWT admin, anonimiza todo lo vencido y responde 200
    con `{anonymized_count}`; sin `role=admin` → 403; sexta llamada dentro de la
    misma hora → 429 con `Retry-After`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=orders-retention.controller` en 0

- [x] T4.3 DTOs de respuesta
  - **Pattern**: `apps/api/src/checkout/dto/orders-retention.dto.ts`,
    `static from(...)` sin exponer la entidad ORM — `per
    backend-node-standards.md §4 — DTO de respuesta explícito`.
  - **Exit criterion**: `OrderAnonymizationResultDto` serializa
    `anonymized_at` como ISO 8601; `RetentionSweepResultDto` serializa
    `{anonymized_count, reason: 'retention_policy'}`.
  - **Verify**: cubierto por los tests de T4.1/T4.2 (aserción de forma del body)

- [x] T4.4 Wiring de `checkout.module.ts`
  - **Pattern**: agregar `OrdersRetentionController` a `controllers`;
    `OrdersRetentionService`, `OrdersRetentionRunner`,
    `OrdersRetentionEventsService` a `providers` — `per
    backend-node-standards.md §3 — DI por token`.
  - **Exit criterion**: `apps/api` arranca sin error de resolución de
    dependencias; `AppModule` no necesita ningún cambio (el módulo sigue siendo
    `CheckoutModule`).
  - **Verify**: `pnpm --filter @dsm/api typecheck` en 0

---

## Fase 5: Tests de invariantes cross-AC — 2,1 h

- [x] T5.1 AC-8 — idempotencia end-to-end (negative-space)
  - **Pattern**: `per testing-standards.md §14.9 — negative-space: asertar lo
    que NO tiene que pasar`.
  - **Exit criterion**: llamar `anonymize` (repo) o `POST .../anonymize`
    (e2e) tres veces seguidas sobre la misma orden produce el mismo estado
    final, sin error en ninguna llamada y sin que `anonymized_at` cambie entre
    la 2ª y la 3ª.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=ac8-order-anonymization-idempotent` en 0 (spec nuevo)

- [x] T5.2 AC-9 — autorización (negative-space)
  - **Pattern**: e2e contra `AdminGuard` real, mismo estilo que
    `e2e-admin-auth.spec.ts`.
  - **Exit criterion**: sin token, con token expirado, con token de rol
    distinto de `admin` — las tres intentonas sobre `:id/anonymize` devuelven
    401/403 y la orden **no cambia** (se verifica leyendo `buyer_name` sin
    modificar después del intento).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-orders-retention-auth` en 0 (spec nuevo)

- [ ] T5.3 AC-2 — el valor comercial no cambia (invariante central de la US)
  - **Pattern**: sembrar N órdenes con ítems, importes y fechas conocidas;
    calcular agregados (`sum(total_ars_cents)`, `count(*)`, `sum(items.quantity)`
    por producto) antes de anonimizar; anonimizar todas; recalcular los mismos
    agregados y comparar por igualdad exacta.
  - **Exit criterion**: los tres agregados son bit-a-bit iguales antes y
    después de anonimizar el conjunto completo.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=ac2-order-metrics-preserved` en 0 (spec nuevo)

- [ ] T5.4 AC-6 — ninguna orden ni ítem se borra (negative-space)
  - **Pattern**: contar filas de `orders` y `order_items` antes y después del
    barrido sobre un conjunto con órdenes vencidas y no vencidas.
  - **Exit criterion**: el conteo de filas de ambas tablas es idéntico antes y
    después; ninguna fila desaparece.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=ac6-order-not-deleted` en 0 (spec nuevo)

- [ ] T5.5 AC-7 — el consentimiento sobrevive (negative-space)
  - **Pattern**: sembrar una orden con `consent_accepted_at` y
    `consent_terms_version` conocidos; anonimizar; releer.
  - **Exit criterion**: los tres campos de consentimiento
    (`consent_accepted`, `consent_accepted_at`, `consent_terms_version`) son
    idénticos antes y después de anonimizar.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=ac7-consent-preserved-after-anonymization` en 0 (spec nuevo)

- [x] T5.6 AC-8 — irreversibilidad (negative-space)
  - **Pattern**: tras anonimizar, no debe existir ningún camino de lectura
    (repo, servicio, log) que devuelva el `buyer_name`/`buyer_email`/
    `buyer_phone` original.
  - **Exit criterion**: `findById` sobre una orden anonimizada nunca devuelve
    los valores originales sembrados; el log emitido por `anonymizeOnRequest`
    no contiene esos valores (comparte fixture con T2.2 pero valida el
    flujo completo, no sólo el servicio de eventos aislado).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=ac8-order-anonymization-idempotent` en 0 (mismo spec de T5.1, caso adicional)

---

## Fase 6: Contrato OpenAPI + docs — 0,7 h

- [ ] T6.1 Contrato OpenAPI de los dos endpoints
  - **Pattern**: `per api-contract-completeness` — 1 yaml por endpoint,
    `contracts/openapi/anonymize-order.yaml` y
    `contracts/openapi/retention-sweep.yaml` dentro de este change, con
    `bearerAuth`, `parameters` (`id` para el primero), `requestBody` ausente
    (ninguno de los dos acepta body), `responses` con 200/401/403/404/422/429 y
    `components.responses` RFC 7807 con `type` `dsm:checkout/order-not-found` y
    el genérico de rate-limit ya usado en otros yaml del proyecto.
  - **Exit criterion**: los dos yaml validan como OpenAPI 3.x (sin `$ref` roto)
    y declaran todo status code posible de la tabla de T4.1/T4.2.
  - **Verify**: `npx spectral lint openspec/changes/US-021-retencion-datos-ordenes-backend/contracts/openapi/*.yaml` en 0

- [ ] T6.2 Nota en `checkout/README.md`
  - **Pattern**: agregar una sección breve "Retención y anonimización
    (US-021)" con el mismo estilo que las secciones existentes del README,
    señalando que `OrdersRetentionController`/`Service`/`Runner` viven en este
    módulo por ausencia de un módulo de órdenes admin dedicado (US-012 todavía
    sin backend), y el open question para quien planifique esa US.
  - **Exit criterion**: el README menciona los dos endpoints, el runner de
    arranque y la nota para US-012.
  - **Verify**: `grep -c "US-021" apps/api/src/checkout/README.md` ≥ 1

---

## Verification (suite-level)

- [ ] Unit + integration completos: `pnpm --filter @dsm/api test`
- [ ] Lint limpio: `pnpm --filter @dsm/api lint`
- [ ] Typecheck limpio: `pnpm --filter @dsm/api typecheck`
- [ ] Contrato OpenAPI sin errores: `npx spectral lint openspec/changes/US-021-retencion-datos-ordenes-backend/contracts/openapi/*.yaml`
- [ ] Migración aplicada limpia contra Postgres local: `pnpm --filter @dsm/db migrate`
