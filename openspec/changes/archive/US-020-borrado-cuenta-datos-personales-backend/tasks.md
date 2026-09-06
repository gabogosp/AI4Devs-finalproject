---
parent-us: US-020
discipline: backend
variant: null
language: es
---

# US-020 Backend — Tasks

> Closure-grade: cada task tiene `Exit criterion:` observable y `Verify:` con el
> comando exacto que `/develop-backend` corre (forma terminante, F49). Cwd = raíz
> del repo. Runner: `pnpm --filter @dsm/api test -- --testPathPattern=<patrón>`
> (Jest no-watch por defecto). Integration/e2e corren contra el Postgres real de
> `docker-compose` (`ai4devs-finalproject-postgres-1`, `:55432`).
>
> **Estimación dual**: **~13,5 h AI-asistido** / **~27 h tradicional** (27 tasks,
> 7 fases: 1,0 + 2,6 + 1,0 + 2,0 + 2,0 + 3,4 + 1,5). La US §7 presupuesta
> `BE-US-020` en 12-16 h tradicional: el tradicional de este plan excede el
> techo ~11-15 h por el mismo motivo que ya excedió US-021 — la US describe el
> trabajo como "orquestación sobre un esquema que ya existe" (cierto para el
> MECANISMO de anonimización, que se reusa 1:1 de US-021), pero no presupuesta
> la **superficie nueva construida desde cero**: un módulo (`AccountModule`) con
> su propio guard de throttling, 5 métodos nuevos repartidos en 4 repositorios
> de 3 módulos distintos (`auth`/`checkout`/`cart`), el servicio de eventos
> dedicado (cero PII, mismo candado que el resto del repo), y 10 specs de
> invariantes cross-AC en Fase 5 — cada uno cubriendo un invariante propio (las
> 3 puertas de AC-10, el caso borde de colisión de AC-6, las 2 direcciones de
> la carrera de AC-9, la doble confirmación de AC-15), no una variación del
> mismo test. La transformación central (anonimizar una fila + reusar
> `OrdersRepository.anonymize*`) son ~2 h, igual que en US-021 — el resto es la
> plomería multi-módulo que ninguna US anterior tuvo que construir desde cero.

## Traceability matrix

| AC | Descripción | Task IDs |
|---|---|---|
| AC-1 | Borrado inmediato, sesión cerrada, cookies limpias | T4.2, T5.1 |
| AC-2 | PII fuera de toda superficie, sin copia recuperable | T1.1, T5.2 |
| AC-3 | Historial comercial sobrevive anonimizado (reusa US-021) | T1.3, T3.1, T5.3 |
| AC-4 | Orden en curso bloquea el borrado, con detalle | T1.3, T2.1, T3.1, T5.4 |
| AC-5 | Email liberado, re-registro limpio | T1.1, T5.5 |
| AC-6 | Placeholder único por fila, sin colisión concurrente | T1.1, T1.2, T5.6 |
| AC-7 | Cancelar antes de confirmar no modifica nada | N/A backend — no hay llamada al servidor hasta que el cliente confirma; el flujo de dos pasos es enteramente frontend (US §4, fuera de alcance de este change) |
| AC-8 | Cuenta sin órdenes / con órdenes ya anonimizadas, sin error | T3.1, T5.3 |
| AC-9 | Verificación de órdenes en curso al ejecutar, no al mostrar | T1.3, T3.1, T5.4 |
| AC-10 | Ninguna de las 3 puertas de acceso sigue abierta | T1.4, T4.2, T5.7 |
| AC-11 | Sin vuelta atrás, sin estado "borrado pendiente" | T1.2 (nota de diseño), T5.2 |
| AC-12 | Panel de métricas de US-016 no se mueve | T5.3 |
| AC-13 | Sólo el titular con sesión propia borra su cuenta | T4.2, T5.8 |
| AC-14 | Observabilidad sin PII | T2.2, T5.9 |
| AC-15 | Doble confirmación produce un solo efecto | T3.1, T5.10 |

## Pre-requisitos

- [x] **US-014/US-015/US-021 backend en `main`** (§6 de la US: los tres tienen su
  backend mergeado — US-021 archivada/`Done`, US-014/US-015 mid-lifecycle en
  otras disciplinas pero su código ya está en `main`). Sin esto no existen
  `customers.deleted_at`, `orders.customer_id`, ni el mecanismo de anonimización
  de `orders` que este change reusa.
  **Verify**: `grep -c "deleted_at" packages/db/prisma/schema.prisma` ≥ 1 **y**
  `grep -c "anonymized_at" packages/db/prisma/schema.prisma` ≥ 1 **y**
  `grep -c "customer_id" packages/db/prisma/schema.prisma` ≥ 3
- [x] **Postgres local arriba**: `docker compose up -d postgres` (host `:55432`).
- [x] **Working tree limpio en `packages/db/prisma/`, `apps/api/src/auth/`,
  `apps/api/src/checkout/`, `apps/api/src/cart/`, `apps/api/src/config/`** — este
  change toca los 5 simultáneamente; otra tarea en vuelo sobre esos archivos se
  pisa (precedente: colisión de sesiones de US-007/US-021).
  **Verify**: `git status --porcelain packages/db/prisma apps/api/src/auth apps/api/src/checkout apps/api/src/cart apps/api/src/config` vacío

---

## Fase 0: Esquema y configuración — 1,0 h

- [x] T0.1 Migración aditiva: ensanchar `orders_anonymization_reason_check`
  - **Pattern**: `prisma migrate --create-only` + edición manual del
    `migration.sql` generado, mismo flujo que US-021 (`orders_anonymization_reason_check`)
    y US-008 (`CHECK (consent_accepted = true)`) — `per backend-node-standards.md
    §5 — migraciones aditivas, nunca destructivas en un solo deploy`.
    ```sql
    ALTER TABLE "orders" DROP CONSTRAINT "orders_anonymization_reason_check";
    ALTER TABLE "orders" ADD CONSTRAINT "orders_anonymization_reason_check"
      CHECK ("anonymization_reason" IS NULL
             OR "anonymization_reason" IN ('retention_policy', 'requested', 'account_deletion'));
    ```
    Ninguna columna nueva (`design.md` §Persistencia — caso trivial, no amerita
    `data-architect` Mode B).
  - **Exit criterion**: el `CHECK` acepta los 3 valores; una fila con
    `anonymization_reason = 'account_deletion'` y `anonymized_at` no nulo se
    inserta/actualiza sin violar ningún constraint; el `CHECK` de consistencia
    cruzada de US-021 (`anonymized_at IS NULL = anonymization_reason IS NULL`)
    sigue vigente sin cambios.
  - **Verify**: `pnpm --filter @dsm/db migrate` termina en 0 **y**
    `grep -c "account_deletion" packages/db/prisma/migrations/*/migration.sql` ≥ 1

- [x] T0.2 Config nueva validada al arranque (fail-fast, §7)
  - **Pattern**: agregar a `envSchema` en `apps/api/src/config/env.validation.ts`,
    mismo bloque que `ORDERS_HISTORY_RATE_LIMIT_*` (T0.2 de US-021 / T4.2 de
    US-015) — `per backend-node-standards.md §7`:
    ```ts
    ACCOUNT_DELETION_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
    ACCOUNT_DELETION_RATE_LIMIT_TTL_MS: z.coerce.number().int().positive().default(3_600_000), // 1 h
    ```
  - **Exit criterion**: los 2 valores tienen default y ninguno rompe el arranque
    en ausencia de la env var; un valor no numérico falla el arranque.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=env.validation` en 0, con un caso que cubre los 2 defaults y 1 caso de fail-fast

---

## Fase 1: Constantes + repositorios de los 3 módulos — 2,6 h

- [x] T1.1 Constantes de anonimización de `customers`
  - **Pattern**: `apps/api/src/auth/customer-anonymization.ts`, espejo de
    `checkout/order-anonymization.ts` (US-021) — ver `design.md` §Approach. El
    email usa TLD `.invalid` (RFC 2606) y es **función**, no constante, porque
    tiene que ser único por `customerId` (AC-6, a diferencia del valor fijo de
    US-021 para `orders.buyer_email`, que no tiene `UNIQUE`).
  - **Exit criterion**: `ANONYMIZED_CUSTOMER_NAME`/`ANONYMIZED_CUSTOMER_PHONE`
    son constantes; `anonymizedCustomerEmail(id)` devuelve un string distinto
    para 2 `id` distintos y contiene `.invalid`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=customer-anonymization` en 0, con un caso que llama la función con 2 UUID distintos y asegura `!==` entre los resultados

- [x] T1.2 `AnonymizationReason` ensanchado + `AdminOrderDetailDto` sincronizado
  - **Pattern**: `checkout/order-anonymization.ts` — `export type
    AnonymizationReason = 'retention_policy' | 'requested' | 'account_deletion'`.
    `orders/dto/order.dto.ts:124` (`AdminOrderDetailDto.anonymization_reason`)
    tiene su PROPIA unión hardcodeada (`'retention_policy' | 'requested' | null`,
    agregada por el fix `US-021-publish-order-anonymization-contract`) — se
    ensancha en el mismo commit, si no el panel admin (US-012) tipa mal
    cualquier orden anonimizada por esta US.
  - **Exit criterion**: el compilador TS acepta `reason: 'account_deletion'` en
    cualquier sitio tipado como `AnonymizationReason`; `AdminOrderDetailDto`
    acepta el mismo valor sin cast forzado adicional al ya existente
    (`o.anonymization_reason as AdminOrderDetailDto['anonymization_reason']`).
  - **Verify**: `pnpm --filter @dsm/api typecheck` en 0

- [x] T1.3 `OrdersRepository.listBlockingForCustomer` + `anonymizeAllForCustomer`
  - **Pattern**: ver `design.md` §Approach ("OrdersRepository — dos métodos
    nuevos") — `per backend-node-standards.md §5 — el repositorio es el único
    punto de ORM`. `BLOCKING_ORDER_STATUSES = ['pending_payment', 'new',
    'preparing', 'ready']` (US §10 decisión 5). Ambos aceptan
    `tx: Prisma.TransactionClient | PrismaService = this.prisma`, mismo idioma
    que `StockRepository`/`PaymentsRepository`.
  - **Exit criterion**: `listBlockingForCustomer` devuelve sólo las órdenes del
    cliente en alguno de los 4 estados bloqueantes, ninguna `delivered`/
    `cancelled`; `anonymizeAllForCustomer` anonimiza todas las no anonimizadas
    del cliente en un único `UPDATE`, deja intactas las de otro cliente, y una
    segunda corrida devuelve `0` sin error.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=orders.repository` en 0, con 2 casos nuevos (filtro de estados bloqueantes / anonimización de conjunto + segunda corrida en 0)

- [x] T1.4 `RefreshTokensRepository`/`PasswordResetTokensRepository` ganan `tx` opcional
  - **Pattern**: agregar `tx: Prisma.TransactionClient | PrismaService =
    this.prisma` a `revokeAllForCustomer` y `deleteAllForCustomer` (ya
    existían desde US-014) — mismo idioma que T1.3, ver `design.md` §Approach.
    Aditivo: ningún llamador existente (`SessionService`/`PasswordResetService`)
    pasa `tx`, así que su comportamiento no cambia.
  - **Exit criterion**: ambos métodos siguen funcionando sin `tx` (regresión
    cero sobre reset de contraseña); llamados con un `tx` de un
    `$transaction` en curso, escriben dentro de esa misma transacción (un
    rollback del `tx` revierte también su escritura).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern="refresh-tokens.repository|password-reset-tokens.repository"` en 0, con 1 caso nuevo por archivo que pasa un `tx` y fuerza un rollback, verificando que la escritura no persiste

- [x] T1.5 `CartsRepository.unlinkAllForCustomer`
  - **Pattern**: ver `design.md` §Approach ("CartsRepository") — mismo idioma
    `tx` opcional.
  - **Exit criterion**: pone `customer_id = null` en todos los carritos del
    cliente, no borra ninguna fila de `carts` ni de `cart_items`, no toca
    carritos de otro cliente.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=carts.repository` en 0, con 1 caso nuevo (2 carritos del cliente + 1 ajeno, verifica desvinculación selectiva y conteo de filas antes/después idéntico)

---

## Fase 2: Errores + eventos — 1,0 h

- [x] T2.1 `AccountHasActiveOrdersError` (409 RFC 7807, con `blocking_orders`)
  - **Pattern**: `apps/api/src/account/account-errors.ts` — `per
    backend-node-standards.md §6`. Usa `extensions` de `DomainError` (mismo
    mecanismo que el 409 de stock del carrito) para llevar `blocking_orders:
    OrderHistorySummaryDto[]` — ver `design.md` §Approach.
  - **Exit criterion**: lanzarlo produce un 409 con `type: 'dsm:account/active-orders'`
    y `blocking_orders` en el cuerpo, con el mismo shape que
    `OrderHistorySummaryDto` (US-015) — sin campos adicionales.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=account-errors` en 0

- [x] T2.2 `AccountEventsService` (cero PII)
  - **Pattern**: `apps/api/src/observability/account-events.service.ts`, mismo
    esqueleto que `OrdersRetentionEventsService`/`AuthEventsService` — ver
    `design.md` §Approach ("Observabilidad"). La firma no acepta ningún
    parámetro por el que pueda entrar `name`/`email`/`phone` — `per
    observability-standards.md §9`.
  - **Exit criterion**: `emit('account.deleted', customerId, undefined, {
    anonymized_orders: N })` incrementa el contador y loguea `{event,
    entity_id, trace_id, anonymized_orders}` sin ningún campo de contacto.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=account-events` en 0, con un test que inspecciona el objeto logueado y falla si contiene `name`/`email`/`phone` como clave

---

## Fase 3: Servicio de orquestación — 2,0 h

- [x] T3.1 `AccountDeletionService.deleteAccount` (transacción completa)
  - **Pattern**: ver `design.md` §Approach ("AccountDeletionService") — un
    único `prisma.$transaction`, 6 pasos en el orden documentado. Guardado de
    bloqueo (AC-4/AC-9) como PRIMERA operación dentro de la transacción, nunca
    antes. Guardado de idempotencia (AC-15) vía el `null` de
    `customers.anonymize` — `per` el mismo idioma que `cancel-order.service.ts`
    (`payments/cancel-order.service.ts`), transacción multi-repositorio con
    `tx` explícito.
  - **Exit criterion**: sobre un cliente sin órdenes bloqueantes, anonimiza la
    cuenta, revoca sesiones y resets, desvincula carritos, anonimiza órdenes no
    anonimizadas con `reason='account_deletion'`, y emite `account.deleted`
    exactamente una vez; sobre un cliente con al menos una orden bloqueante,
    lanza `AccountHasActiveOrdersError` y **no escribe nada** (verificable
    releyendo la fila `customers` sin cambios); sobre un cliente ya borrado,
    no lanza, no reanonimiza órdenes, no emite un segundo evento.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=account-deletion.service` en 0, con los 3 casos (éxito completo / bloqueo sin escritura / no-op idempotente contando `events.count(...)` antes y después de la segunda llamada)

---

## Fase 4: Controller + módulo + wiring — 2,0 h

- [x] T4.1 `AccountThrottlerGuard`
  - **Pattern**: copia deliberada de `AuthThrottlerGuard`/
    `OrdersHistoryThrottlerGuard` (mismo boilerplate de cabeceras `RateLimit-*`/
    `Retry-After`) — ver `design.md` §Approach ("Controller") para la
    justificación de por qué NO se exporta una guard compartida. `per
    security-standards.md §7.3`.
  - **Exit criterion**: sobre exceder el límite `account_deletion`, responde
    429 con `Retry-After`/`RateLimit-*` seteados.
  - **Verify**: cubierto por el test de controller de T4.2 (aserción de cabeceras en el caso 429)

- [x] T4.2 `DELETE /v1/me` (AC-1, AC-10, AC-13)
  - **Pattern**: ver `design.md` §Approach ("Controller"). `@UseGuards(CustomerGuard,
    CsrfGuard)` mismo orden y mismo par que `logout` de
    `customer-auth.controller.ts` — `per security-standards.md §7.5` y `per
    backend-node-standards.md §2 — controller fino`. `clearSessionCookies`
    reusado tal cual de `auth/cookies.ts` (AC-1). Sin `@Body()` — la
    autorización sale estructuralmente de `req.customerId` (JWT), nunca de un
    campo del cliente (AC-13).
  - **Exit criterion**: sin sesión → 401; sin CSRF → 403; con sesión válida y
    sin órdenes bloqueantes → 204, cookies de sesión limpias en la respuesta;
    con órdenes bloqueantes → 409 con `blocking_orders`; segunda llamada sobre
    la misma cuenta ya borrada (dentro del TTL del access) → 204 idéntico, sin
    error.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=account.controller` en 0

- [x] T4.3 `AccountModule` + exports aditivos de `AuthModule` + throttler nombrado
  - **Pattern**: `apps/api/src/account/account.module.ts` — `imports:
    [PrismaModule, AuthModule, CheckoutModule, CartModule]`, mismo patrón
    acíclico que `orders/orders.module.ts` (ver `design.md` §Context). Agregar
    a `AuthModule.exports`: `CsrfGuard`, `CustomersRepository`,
    `RefreshTokensRepository`, `PasswordResetTokensRepository` (ninguno estaba
    exportado). Agregar la novena entrada al array único de
    `ThrottlerModule.forRootAsync` de `AuthModule`:
    ```ts
    {
      name: 'account_deletion',
      ttl: config.get<number>('ACCOUNT_DELETION_RATE_LIMIT_TTL_MS', 3_600_000),
      limit: config.get<number>('ACCOUNT_DELETION_RATE_LIMIT_MAX', 5),
    },
    ```
  - **Exit criterion**: `apps/api` resuelve todas las dependencias de
    `AccountModule` sin error; ningún export/provider existente de `AuthModule`
    cambia de comportamiento (regresión cero sobre `auth.module.spec.ts` si
    existe, o sobre la suite completa de `auth/`).
  - **Verify**: `pnpm --filter @dsm/api typecheck` en 0 **y**
    `pnpm --filter @dsm/api test -- --testPathPattern="^apps/api/src/auth"` en 0

- [x] T4.4 Registrar `AccountModule` en `AppModule`
  - **Pattern**: agregar `AccountModule` al array `imports` de
    `apps/api/src/app.module.ts`, junto a `OrdersModule`/`PaymentsModule` — `per
    backend-node-standards.md §3`.
  - **Exit criterion**: la API arranca sin error de resolución de dependencias
    con `AccountModule` cargado.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=app.module` en 0 (o, si no existe spec de arranque, `pnpm --filter @dsm/api build` en 0)

---

## Fase 5: Tests de invariantes cross-AC — 3,4 h

- [x] T5.1 AC-1 — happy path e2e (borrado, sesión cerrada, cookies limpias)
  - **Pattern**: `per testing-standards.md §14 — e2e contra servidor real`,
    mismo estilo que `e2e-auth-session.spec.ts`.
  - **Exit criterion**: tras `DELETE /v1/me` con sesión válida y sin órdenes
    bloqueantes: respuesta 204; las 3 cookies de sesión (`dsm_access`,
    `dsm_refresh`, `dsm_csrf`) vienen limpias en `Set-Cookie`; una llamada
    posterior a `GET /v1/auth/me` con el access viejo responde 401 dentro de la
    misma request (aunque el JWT no haya expirado todavía, ver `design.md`
    §Trade-offs sobre el residual — `me` sí re-verifica `findActiveById`).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-account-deletion` en 0 (spec nuevo)

- [x] T5.2 AC-2/AC-11 — irreversibilidad (negative-space)
  - **Pattern**: `per testing-standards.md §14.9 — negative-space`. Sembrar un
    cliente con `name`/`email`/`phone` reales conocidos; borrar; releer por
    todos los caminos existentes (`CustomersRepository.findActiveById` — debe
    dar `null` por el filtro `deleted_at`; consulta directa `prisma.customer.
    findUnique` sin el filtro — debe dar los placeholders, nunca los valores
    originales).
  - **Exit criterion**: ningún camino de lectura devuelve los 3 valores
    originales sembrados, ni siquiera transformados (mayúsculas, espacios,
    substring); no existe ningún endpoint ni estado que permita deshacer el
    borrado.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=ac2-account-pii-irreversible` en 0 (spec nuevo)

- [x] T5.3 AC-3/AC-8/AC-12 — órdenes anonimizadas, métricas intactas
  - **Pattern**: mismo patrón que `ac2-order-metrics-preserved.spec.ts` de
    US-021 — sembrar cliente con N órdenes (algunas `delivered`, ninguna
    bloqueante) y M órdenes ya anonimizadas por US-021 previamente; calcular
    agregados (`sum(total_ars_cents)`, `count(*)`, estados, fechas) antes de
    borrar la cuenta; borrar; recalcular y comparar por igualdad exacta.
  - **Exit criterion**: las N órdenes quedan con `reason='account_deletion'`;
    las M ya anonimizadas NO cambian su `anonymized_at`/`anonymization_reason`
    (AC-8 — no se reanonimiza lo ya anonimizado); los 3 agregados son
    bit-a-bit iguales antes y después.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=ac3-ac8-ac12-account-orders-preserved` en 0 (spec nuevo)

- [x] T5.4 AC-4/AC-9 — bloqueo por órdenes en curso + carrera (negative-space)
  - **Pattern**: `per threat-modeling-lite` superficie 3 — probar las dos
    direcciones de la carrera de AC-9 explícitamente (no sólo el bloqueo
    simple).
  - **Exit criterion**: con una orden `pending_payment`/`new`/`preparing`/
    `ready` → 409 con esa orden listada, `customers.deleted_at` sigue `null`;
    con una orden `delivered`/`cancelled` → no bloquea; una orden creada
    JUSTO ANTES de la transacción de borrado (no antes de mostrar la
    pantalla) bloquea igual; una orden bloqueante que pasa a `delivered`
    ANTES de que el `DELETE` llegue al servidor no bloquea (sin necesitar que
    el cliente recargue la pantalla).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=ac4-ac9-blocking-orders-race` en 0 (spec nuevo)

- [x] T5.5 AC-5 — email liberado, re-registro limpio
  - **Pattern**: e2e — borrar una cuenta, `POST /v1/auth/register` con el
    mismo email inmediatamente después.
  - **Exit criterion**: el registro se completa 201 como alta nueva; el nuevo
    `customer.id` es distinto del anterior; `GET /v1/me/orders` de la cuenta
    nueva no devuelve ninguna orden de la cuenta anterior (aunque compartieron
    email en algún momento — el vínculo es por `customer_id`, no por email).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=ac5-email-liberado-reregistro` en 0 (spec nuevo)

- [x] T5.6 AC-6 — placeholder único, colisión concurrente (caso borde)
  - **Pattern**: `per testing-standards.md §14.9` — 2 clientes distintos
    borrando su cuenta uno después del otro y también en paralelo
    (`Promise.all`).
  - **Exit criterion**: los 2 borrados se completan sin error de `UNIQUE`
    violado; los 2 placeholders de `email` resultantes son distintos entre sí.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=ac6-anonymization-placeholder-unique` en 0 (spec nuevo)

- [x] T5.7 AC-10 — las 3 puertas cerradas (negative-space)
  - **Pattern**: ver `design.md` §Approach ("AC-10 — por qué las 3 puertas
    cierran"). Cubre las 3 explícitamente, no una sola.
  - **Exit criterion**: (1) `POST /v1/auth/login` con las credenciales viejas →
    `dsm:auth/invalid-credentials`, idéntico al de un email inexistente
    (comparar el cuerpo byte a byte contra el caso "nunca existió"); (2) un
    refresh token emitido ANTES del borrado, usado después → `POST
    /v1/auth/refresh` responde `dsm:auth/invalid-refresh`; (3) un
    `password_reset_token` emitido antes del borrado y no usado → `POST
    /v1/auth/password-reset/confirm` con ese token → `dsm:auth/invalid-reset-token`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=ac10-three-doors-closed` en 0 (spec nuevo)

- [x] T5.8 AC-13 — autorización (negative-space)
  - **Pattern**: e2e, mismo estilo que `e2e-rbac.spec.ts`.
  - **Exit criterion**: sin sesión de cliente → 401, ninguna cuenta cambia;
    con sesión de OTRO cliente autenticado → borra la propia (nunca la de un
    tercero — no existe forma de pasar un `customer_id` ajeno, verificado
    porque la ruta no acepta ningún parámetro de identidad); con un JWT admin
    (`role=admin`) → 401/403 (la ruta exige `role=customer`, mismo chequeo que
    `resolveCustomerSession`), y no existe ninguna ruta bajo `/v1/admin/*` que
    llegue a `AccountDeletionService`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=ac13-only-owner-deletes` en 0 (spec nuevo)
  - Resultado real: 4/4 passed (2.968s). El caso admin resuelve a **401**
    (no 403) — `resolveCustomerSession()` colapsa `role !== ROL_CLIENTE` a
    `null` antes de que exista distinción de permisos; documentado en el
    test mismo. Barrido negativo extra: `DELETE /v1/admin/me` y
    `/v1/admin/customers/me` → 404 (no existe tal ruta).

- [x] T5.9 AC-14 — observabilidad sin PII (negative-space)
  - **Pattern**: mismo estilo que `e2e-auth-observability.spec.ts`/T2.2 de
    US-021 — inspecciona TODOS los logs/eventos producidos por un borrado
    completo, no sólo el de `AccountEventsService` aislado.
  - **Exit criterion**: ningún log ni evento emitido durante un `DELETE /v1/me`
    completo (incluyendo el 409 de bloqueo) contiene el `name`/`email`/`phone`
    sembrado, ni siquiera hasheado o parcialmente truncado; el log permite
    reconstruir que hubo un borrado, cuándo, y cuántas órdenes anonimizó, sin
    identificar a la persona.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=ac14-account-deletion-no-pii-in-observability` en 0 (spec nuevo)
  - Resultado real: 2/2 passed (2.457s). Cubre borrado exitoso (barrido de
    `name`/`email`/`phone` sembrados sobre TODO lo capturado por el logger +
    cookies de la respuesta) y el 409 de bloqueo (mismo barrido + body JSON de
    la respuesta). `AccountEventsService.count()` requirió agregar
    `MetricsModule` al grafo del test (`@Global` no alcanza sin un import
    explícito en el árbol — mismo comentario que `e2e-search-observability`);
    sin contador real el `@Optional() metrics?` queda `undefined` y `count()`
    siempre da 0, un falso-verde silencioso que el propio test detectó antes
    de este fix.

- [x] T5.10 AC-15 — doble confirmación (negative-space)
  - **Pattern**: llamar `DELETE /v1/me` dos veces seguidas con la misma cookie
    de sesión (simula doble clic / dos pestañas), y también con
    `Promise.all` (simula la carrera real de dos pestañas en paralelo).
  - **Exit criterion**: ambas responden 204; `customers.deleted_at` no cambia
    entre la 1ª y la 2ª; el conteo de órdenes anonimizadas no se duplica;
    `AccountEventsService.count('account.deleted')` incrementa exactamente 1,
    no 2.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=ac15-double-confirm-idempotent` en 0 (spec nuevo)
  - Resultado real: 2/2 passed (2.768s). Secuencial: `deleted_at` es el MISMO
    instante entre la 1ª y la 2ª llamada (no sólo "no nulo") y exactamente 1
    orden queda anonimizada. Concurrente (`Promise.all`, misma cookie): ambas
    responden 204, un solo efecto — ejercita la carrera real, no sólo el orden
    secuencial. Contador `account.deleted` +1 en ambos casos (delta contra el
    valor previo, no `toBe(1)` — el contador de `MetricsService` es un
    Prometheus real, nunca se resetea entre tests).

---

## Fase 6: Contrato OpenAPI + docs — 1,5 h

- [x] T6.1 Contrato OpenAPI draft del endpoint
  - **Pattern**: `per api-contract-completeness` — ya escrito en
    `contracts/openapi/delete-account.yaml` de este change (1 yaml, `bearerAuth`
    vía cookie, `responses` 204/401/403/409/429, `AccountHasActiveOrdersProblem`
    con `blocking_orders`).
  - **Exit criterion**: el yaml valida como OpenAPI 3.x, sin `$ref` roto.
  - **Verify**: `npx --yes @stoplight/spectral-cli lint openspec/changes/US-020-borrado-cuenta-datos-personales-backend/contracts/openapi/*.yaml` termina sin resultados de severidad `error` (mismo `--yes` no-interactivo que T6.1 de US-021)
  - Resultado real: exit 0, 0 errores (3 warnings menores: falta `info.contact`,
    `operation-description`, `operation-tag-defined` — ninguno de severidad
    `error`, mismo criterio que aceptó US-021).

- [x] T6.2 Publicar en `apps/api/docs/api/openapi.yaml` (spec del servicio)
  - **Pattern**: `per documentation-standards.md §11.1` — el spec publicado del
    servicio se actualiza DENTRO de este change (a diferencia de la capacidad
    viva de `openspec/specs/`, que la actualiza `/archive-change`). Agrega
    `DELETE /v1/me` (tag `account`) y ensancha el enum
    `[retention_policy, requested]` → `[retention_policy, requested,
    account_deletion]` en los 3 lugares donde ya aparece (`AdminOrderDetail`,
    `OrderAnonymizationResult` de US-021, y el schema de detalle de orden que
    lo declara una tercera vez — ver `design.md` §Spec delta).
  - **Exit criterion**: los 3 lugares que hoy dicen `enum: [retention_policy,
    requested]` en `apps/api/docs/api/openapi.yaml` dicen `enum:
    [retention_policy, requested, account_deletion]`; el endpoint nuevo está
    documentado con sus 4 status codes.
  - **Verify**: `grep -c "account_deletion" apps/api/docs/api/openapi.yaml` ≥ 4 (3 enums + 1 mención en la descripción del endpoint nuevo) **y** `npx --yes @stoplight/spectral-cli lint apps/api/docs/api/openapi.yaml` sin resultados de severidad `error`
  - Resultado real: `grep -c account_deletion` → 5 (≥4, ok). Agregado tag
    `account` + `DELETE /me` (204/401/403/409/429, reusando `sessionCookie`,
    `CsrfToken`, `SessionCookies`, `Problem`, `RateLimited` — mismo idioma que
    `/auth/logout`) + `AccountHasActiveOrdersProblem` (allOf Problem +
    `blocking_orders: OrderHistorySummary[]`, reusa el schema existente de
    US-015 en vez de duplicarlo). **Nota sobre el lint**: `npx --yes
    @stoplight/spectral-cli` resuelve hoy a 6.16.3, que CRASHEA (`Cannot read
    properties of null (reading 'enum')`, error interno de `nimma` bajo Node
    23) al lintear este archivo — reproducido también contra el HEAD sin
    tocar (`git show HEAD:...`), o sea preexistente, no introducido por este
    change. Pineado a `@stoplight/spectral-cli@6.11.1` (versión que sí
    corría limpio contra este mismo archivo antes) da `No results with a
    severity of 'error' found!` tanto antes como después de mi edición —
    lint genuinamente limpio, el comando tal cual escrito en el `Verify:`
    quedó roto por deriva de versión del tooling, no por este contenido.

- [x] T6.3 Notas en README de los módulos tocados
  - **Pattern**: `apps/api/src/account/README.md` nuevo (mismo estilo que
    `checkout/README.md`) documentando el módulo, por qué es nuevo (ciclo
    `auth`↔`checkout`, ver `design.md` §Context) y qué reusa de US-021; nota
    breve en `checkout/README.md` señalando que `OrdersRepository` ganó 2
    métodos consumidos desde `account/`.
  - **Exit criterion**: `account/README.md` explica el propósito del módulo,
    la lista de las 4 relaciones que maneja explícitamente (tabla de US §10) y
    el reuso del mecanismo de US-021; `checkout/README.md` menciona US-020.
  - **Verify**: `grep -c "US-020" apps/api/src/account/README.md apps/api/src/checkout/README.md` ≥ 2 (al menos 1 mención en cada archivo)
  - Resultado real: 1 mención en cada archivo (total 2, ≥2 ok). `account/README.md`
    nuevo cubre el ciclo de módulos, la tabla de las 4 relaciones (US §10), el
    reuso del mecanismo de US-021 (con la diferencia del placeholder único vs
    fijo), el orden de los 6 pasos de la transacción, autorización sin
    parámetro de identidad y observabilidad sin PII. `checkout/README.md`
    gana una sección nueva sobre los 2 métodos de `OrdersRepository`
    consumidos desde `account/` y la dirección del import (nunca al revés).

---

## Verification (suite-level)

- [x] Unit + integration completos: `pnpm --filter @dsm/api test` → 254/254 suites, 2022/2022 tests passed (133.6s).
- [x] Lint limpio: `pnpm --filter @dsm/api lint` → limpio, 0 salida.
- [x] Typecheck limpio: `pnpm --filter @dsm/api typecheck` → limpio, 0 salida.
- [x] Contrato OpenAPI draft + spec publicado sin errores: `npx --yes @stoplight/spectral-cli lint openspec/changes/US-020-borrado-cuenta-datos-personales-backend/contracts/openapi/*.yaml apps/api/docs/api/openapi.yaml` → el draft lintea limpio con `npx --yes` (latest); el publicado NO — `latest` resuelve a spectral-cli 6.16.3, que crashea por un bug interno de `nimma` bajo Node 23, reproducido también contra el HEAD sin tocar (preexistente, no introducido por este change — ver nota de T6.2). Pineado a `@stoplight/spectral-cli@6.11.1` ambos (draft + publicado) dan `No results with a severity of 'error' found!`.
- [x] Migración aplicada limpia contra Postgres local: `pnpm --filter @dsm/db migrate:deploy` → "No pending migrations to apply."
- [x] Regresión cero sobre `auth/`, `checkout/`, `cart/`, `orders/` (los 4 módulos que este change modifica sin abrir un change dedicado): `pnpm --filter @dsm/api test -- --testPathPattern="auth|checkout|cart|orders|account"` → 114/114 suites, 899/899 tests passed (77.0s).
