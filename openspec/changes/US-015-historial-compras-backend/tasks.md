---
parent-us: US-015
discipline: backend
variant: null
language: es
---

# US-015 Backend — Tasks

> Closure-grade: cada task tiene `Exit criterion:` observable y `Verify:` con el
> comando exacto que `/develop-backend` corre (forma terminante, F49). Cwd =
> raíz del repo. Runner: `pnpm --filter @dsm/api test -- --testPathPattern=<patrón>`
> (Jest no-watch por defecto). Integration/e2e corren contra el Postgres real de
> `docker-compose` (`ai4devs-finalproject-postgres-1`, `:55432`).
>
> **Estimación dual**: **~6,3 h AI-asistido** / **~14 h tradicional** (26 tasks,
> suma de fases: 0,8 + 1,0 + 0,7 + 0,8 + 0,8 + 1,6 + 0,6). La US §7 presupuesta
> `BE-US-015` en 3-5 h tradicional para el lado **sólo lectura**: el tradicional
> de este plan excede ese techo porque el alcance se amplió (decisión del PO,
> 2026-09-06) para incluir el escritor de `orders.customer_id` que
> `US-008-checkout-guest-backend` dejó explícitamente diferido a esta misma US
> (ver `proposal.md` §Why). El trabajo puramente de lectura —dos endpoints sobre
> un repositorio que ya existe— sigue entrando cómodo en el rango original; lo
> que no estaba presupuestado es: (a) extraer y probar el helper de sesión
> compartido entre `CustomerGuard` y la variante opcional (~1,3 h), (b) el
> escritor del checkout + la prueba explícita de que el invitado no cambia
> (~1,0 h), y (c) el throttler nombrado nuevo con su patrón de techo
> inalcanzable (~0,4 h) — trabajo que la redacción original de la US no podía
> anticipar porque no sabía que el escritor faltaba.

## Traceability matrix

| AC | Descripción | Task IDs |
|---|---|---|
| AC-1 | Listado propio, ordenado `-created_at`, con fecha/estado/total | T2.1, T3.1, T4.1, T5.6 |
| AC-2 | Detalle con ítems/cantidades/precios/estado/retiro | T2.2, T3.1, T4.2, T5.7 |
| AC-3 | Estado vacío (sin caso especial en backend) | T5.6 (lista vacía verificada) |
| AC-4 | Sólo ve sus propias órdenes | T2.1, T2.2, T5.7, T5.8 |
| AC-5 | Requiere sesión | T4.1, T4.2, T5.8 |
| AC-6 | Compras guest no se vinculan automáticamente (negative space) | T1.2, T1.3, T5.2, T5.4, T5.5 (regresión completa de US-008) |
| AC-7 | Retención del historial (12 meses) | T2.3, T2.1, T2.2, T5.9 |

## Pre-requisitos

- [x] **US-008 backend construido** (crea `orders`/`order_items`, único punto
  de ORM en `OrdersRepository`). Archivado.
  **Verify**: `test -d openspec/changes/archive/US-008-checkout-guest-backend`
- [x] **US-014 backend construido** (`CustomerGuard`, `SessionService`,
  cookies de cliente). Archivado.
  **Verify**: `test -f apps/api/src/auth/customer.guard.ts`
- [x] **US-021 backend construido** (`OrdersRetentionService.cutoffDate()`,
  fuente del cálculo que este change extrae). Archivado.
  **Verify**: `test -f apps/api/src/checkout/orders-retention.service.ts`
- [x] **US-012 backend construido** (`orders/orders.module.ts` ya existe,
  destino de los endpoints nuevos). Archivado.
  **Verify**: `test -f apps/api/src/orders/orders.module.ts`
- [x] **Postgres local arriba**: `docker compose up -d postgres` (host `:55432`)
  — en este worktree, Postgres aislado propio en `:55415`
  (`us-015-historial-compras-backend-postgres-1`), no el compartido.
- [x] **Working tree limpio en `packages/db/prisma/schema.prisma`,
  `apps/api/src/auth/`, `apps/api/src/checkout/` y `apps/api/src/orders/`** —
  este change toca las cuatro superficies; con otra tarea en vuelo ahí se pisan
  (precedente: la colisión de sesiones de US-007).
  **Verify**: `git status --porcelain packages/db/prisma/schema.prisma apps/api/src/auth apps/api/src/checkout apps/api/src/orders` vacío

---

## Fase 0: Esquema — 0,8 h

- [x] T0.1 Índice compuesto `orders(customer_id, created_at)` (migración
  aditiva, reemplaza el índice de una sola columna)
  - **Pattern**: cambiar `@@index([customer_id])` por
    `@@index([customer_id, created_at])` en el `model Order` de
    `packages/db/prisma/schema.prisma`, migración generada con
    `pnpm --filter @dsm/db migrate -- --name order_customer_history_index`
    (script `migrate` = `prisma migrate dev`, crea Y aplica contra el
    Postgres local en un paso) — precedente exacto: `model PasswordResetToken`
    ya usa `@@index([customer_id, created_at])` para el mismo patrón de
    consulta ("listar lo mío ordenado por fecha") — `per
    backend-node-standards.md §5 — migraciones aditivas, revisadas`. Se
    verificó que ningún otro método de `OrdersRepository` filtra por
    `customer_id` solo (design.md §Trade-offs), así que reemplazar (no sumar)
    el índice no le quita capacidad a nadie.
  - **Exit criterion**: la migración generada sólo contiene un `DROP INDEX` +
    `CREATE INDEX` sobre `orders`, sin `ALTER TABLE` de columnas ni pérdida de
    datos; queda aplicada en el Postgres local (`prisma migrate dev` no falla).
  - **Verify**: `ls packages/db/prisma/migrations/*_order_customer_history_index/migration.sql && grep -ci "customer_id.*created_at" packages/db/prisma/migrations/*_order_customer_history_index/migration.sql`
    ≥ 1

## Fase 1: Helper de sesión compartido + guard opcional — 1,0 h

- [x] T1.1 Extraer `resolveCustomerSession()` de `CustomerGuard` (Extract
  Method, behavior-preserving)
  - **Pattern**: nuevo archivo `apps/api/src/auth/resolve-customer-session.ts`
    con la función pura (ver `design.md` §D1). `CustomerGuard.canActivate` pasa
    a llamarla y lanzar `UnauthenticatedError()` si devuelve `null` —
    `per refactoring-discipline — Extract Method, invariante: comportamiento
    idéntico, verificado por el test de caracterización existente`.
  - **Exit criterion**: `customer-guard.spec.ts` (existente, **sin modificar
    ninguna aserción**) sigue verde; el diff de `customer.guard.ts` reduce el
    archivo a orquestación (sin lógica de verificación de JWT inline).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=customer-guard\\.spec` y `git diff --stat apps/api/src/auth/customer-guard.spec.ts` vacío
- [x] T1.2 `OptionalCustomerGuard` — variante que nunca bloquea
  - **Pattern**: nueva clase en `resolve-customer-session.ts` (o archivo
    hermano `optional-customer.guard.ts`), ver snippet completo en
    `design.md` §D1. `return true` en TODOS los caminos, incluido cuando
    `resolveCustomerSession` devuelve `null` — `per security-standards.md
    §3.8 (fail-closed es la norma en CustomerGuard; esta clase es la
    excepción deliberada y documentada, no una regresión del principio)`.
  - **Exit criterion**: sin cookie, con cookie inválida/vencida, y con cookie
    de rol `admin` (no `customer`), las tres devuelven `true` sin setear
    `req.customerId`; con cookie de cliente válida, `true` y `req.customerId`
    seteado.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=optional-customer-guard\\.spec` (4 casos: ausente, inválida, rol equivocado, válida)
- [x] T1.3 Registrar `OptionalCustomerGuard` en `AuthModule`
  - **Pattern**: agregar a `providers` y `exports` de `auth.module.ts`, al
    lado de `CustomerGuard` — `per backend-node-standards.md §3 — DI vía
    constructor, sin service locator`.
  - **Exit criterion**: `CheckoutModule` (que ya importa `AuthModule`) puede
    inyectar/referenciar `OptionalCustomerGuard` sin agregar un import nuevo.
  - **Verify**: `pnpm --filter @dsm/api typecheck`

## Fase 2: `OrdersRepository` — lecturas propias + helper de retención — 0,7 h

- [x] T2.1 `listByCustomer()` en `OrdersRepository`
  - **Pattern**: ver snippet completo en `design.md` §D3 (`$transaction` con
    `findMany` + `count`, mismo patrón que el `list()` admin existente) —
    `per backend-node-standards.md §5 — repositorio único de ORM, sin ORM en
    el service`.
  - **Exit criterion**: dado un `customerId` con 3 órdenes propias (2 dentro
    de retención, 1 fuera) y 1 orden ajena, `listByCustomer` devuelve
    exactamente las 2 propias dentro de ventana, ordenadas `-created_at`,
    excluyendo `pending_payment`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=orders\\.repository\\.spec`
- [x] T2.2 `findByOrderNumberForCustomer()` en `OrdersRepository`
  - **Pattern**: `findFirst` con `customer_id` + `status.not` +
    `created_at.gte` en el mismo `where` — ver `design.md` §D3. Sin
    separación entre "no existe" y "no es tuya" (`per threat-modeling-lite —
    superficie 4, IDOR: autorización en la query, no después de leerla`).
  - **Exit criterion**: pedir el `order_number` de una orden ajena, o de una
    orden propia `pending_payment`, o de una orden propia fuera de retención,
    los tres casos devuelven `null` (indistinguibles entre sí).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=orders\\.repository\\.spec`
- [x] T2.3 Extraer `computeRetentionCutoff()` compartido
  - **Pattern**: nuevo archivo `apps/api/src/checkout/retention-cutoff.ts`
    (función pura, ver `design.md` §D4); `OrdersRetentionService.cutoffDate()`
    pasa a delegar en ella — `per refactoring-discipline — Extract Method,
    behavior-preserving`.
  - **Exit criterion**: `orders-retention.service.spec.ts` (existente, sin
    modificar) sigue verde; `computeRetentionCutoff(12, new Date('2026-09-06'))`
    devuelve `2025-09-06`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern="orders-retention\\.service\\.spec|retention-cutoff\\.spec"`

## Fase 3: Servicio + DTOs del historial — 0,8 h

- [x] T3.1 `OrdersHistoryService` (`orders/orders-history.service.ts`)
  - **Pattern**: `list()` y `detail()` según `design.md` §Approach — `detail`
    lanza `OrderNotFoundError` (reusada de `checkout/checkout-errors.ts`) si
    el repositorio devuelve `null` — `per backend-node-standards.md §6 —
    errores de dominio, no HttpException ad-hoc`.
  - **Exit criterion**: `detail()` sobre un `order_number` inexistente/ajeno/
    fuera de retención lanza `OrderNotFoundError`; `list()` con 0 órdenes
    devuelve `{ data: [], pagination: { total: 0, ... } }` sin lanzar.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=orders-history\\.service\\.spec`
- [x] T3.2 DTOs (`orders/dto/order-history.dto.ts`)
  - **Pattern**: `ListOrderHistoryQueryDto`, `OrderHistorySummaryDto`,
    `OrderHistoryDetailDto` — ver clases completas en `design.md` §D5.
    `OrderHistoryDetailDto.fromDetail()` reusa `AdminOrderItemDto.from()` de
    `orders/dto/order.dto.ts` — `per base-standards.md — DRY, una sola
    proyección de ítem de orden`.
  - **Exit criterion**: `OrderHistorySummaryDto.from()` nunca incluye `id`
    (UUID) ni `buyer_*` en las claves del objeto devuelto — verificado con
    `Object.keys()` en el test, no sólo por inspección del tipo.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=order-history\\.dto\\.spec`
- [x] T3.3 `OrdersHistoryEventsService` (`observability/orders-history-events.service.ts`)
  - **Pattern**: mismo esqueleto que `CheckoutEventsService`/
    `OrdersRetentionEventsService` (`@Optional() metrics`, `emit()` sin PII en
    la firma) — `per observability-standards.md §9 — cero PII en payload de
    evento`.
  - **Exit criterion**: la firma de `emit()` no acepta ningún parámetro por el
    que pueda entrar email/nombre/teléfono; `customerId` va sólo al log
    (`entity_id`), nunca como dimensión de `MetricsService.increment()`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=orders-history-events\\.service\\.spec`

## Fase 4: Controller, throttler, wiring — 0,8 h

- [x] T4.1 `OrdersHistoryThrottlerGuard` + throttler nombrado `orders_history`
  - **Pattern**: guard espejo de `checkout-throttler.guard.ts` (cabeceras
    `RateLimit-*`/`Retry-After`); nueva entrada en el array de
    `ThrottlerModule.forRootAsync` de `auth.module.ts` con
    `limit: Number.MAX_SAFE_INTEGER` (techo inalcanzable) — `per §7.3 (mismo
    criterio que checkout/search/enrichment/payments_simulate): el
    presupuesto real va en @Throttle del handler, no acá`.
  - **Exit criterion**: agregar el throttler nombrado no cambia el
    comportamiento de rate-limit de NINGÚN controller existente (cart,
    checkout, storefront, auth, search, enrichment, imports, payments) —
    probado por la suite completa de esos controllers sin modificar.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern="throttler|ratelimit"`
- [x] T4.2 Env vars `ORDERS_HISTORY_RATE_LIMIT_MAX` / `_TTL_MS`
  - **Pattern**: `z.coerce.number().int().positive().default(60)` /
    `.default(60_000)` en `config/env.validation.ts`, mismo bloque de
    comentario que `CHECKOUT_RATE_LIMIT_*` — `per backend-node-standards.md
    §7 — config validada, fail-fast al arranque`.
  - **Exit criterion**: un valor no numérico para cualquiera de las dos hace
    fallar el arranque (test explícito), no cae al default en silencio.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=env\\.validation\\.spec`
- [x] T4.3 `OrdersHistoryController` (`orders/orders-history.controller.ts`)
  - **Pattern**: ver clase completa en `design.md` §D5 —
    `@Controller('v1/me/orders')`, `@UseGuards(OrdersHistoryThrottlerGuard,
    CustomerGuard)`, `@SkipThrottle` de los 7 buckets existentes, ruta de
    detalle restringida a dígitos (`:order_number(\\d+)`) — `per
    backend-node-standards.md §2 — controller fino, sin regla de negocio`.
  - **Exit criterion**: `GET /v1/me/orders` sin cookie responde 401 antes de
    ejecutar el handler (el guard corta); con cookie válida, 200 con el shape
    de `OrderHistoryListResponse`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=orders-history\\.controller\\.spec`
- [x] T4.4 Registrar en `orders.module.ts`
  - **Pattern**: sumar `OrdersHistoryController` a `controllers`,
    `OrdersHistoryService`/`OrdersHistoryEventsService`/
    `OrdersHistoryThrottlerGuard` a `providers` — cero imports nuevos (ya
    importa `AuthModule` + `CheckoutModule`) — `per backend-node-standards.md
    §2 — módulo por bounded context`.
  - **Exit criterion**: `AppModule` arranca sin error de DI
    (`OrdersHistoryController` resuelve sus 3 dependencias).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-orders-bootstrap\\.spec`

## Fase 5: Escritor del checkout + tests cross-cutting — 1,6 h

- [x] T5.1 `CheckoutController.create` gana `OptionalCustomerGuard`
  - **Pattern**: `@UseGuards(CartCsrfGuard, OptionalCustomerGuard)` en el
    único handler — `per design.md §D2`.
  - **Exit criterion**: el diff de `checkout.controller.ts` es de una línea
    (el decorador); ningún otro comportamiento del controller cambia.
  - **Verify**: `test "$(git diff --numstat -- apps/api/src/checkout/checkout.controller.ts | awk '{print $1+$2}')" -le 5`
- [x] T5.2 `CheckoutService.createOrder` lee y propaga `customerId`
  - **Pattern**: `CheckoutService.customerIdDe(req)` (espejo de `traceDe`) +
    `CreatePendingOrderData.customerId?: string` — ver `design.md` §D2.
  - **Exit criterion**: con `req.customerId` seteado, la orden creada tiene
    ese `customer_id`; sin él, `customer_id` es `null` — **exactamente el
    comportamiento actual** para el segundo caso.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=checkout\\.service\\.spec`
- [x] T5.3 `OrdersRepository.createPendingOrder` escribe `customer_id`
  - **Pattern**: `customer_id: data.customerId ?? null` dentro del mismo
    `tx.order.create` existente — sin transacción nueva, sin migración de
    escritura (la columna/FK/índice ya existen).
  - **Exit criterion**: el `INSERT` sigue siendo atómico con `order_items`
    (falla de una línea deja cero filas, invariante ya probado por
    `checkout.service.spec.ts` existente, sin modificar esa aserción).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=orders\\.repository\\.spec`
- [x] T5.4 Helper de test: `customerAccessCookie()` en `test/e2e-app.ts`
  - **Pattern**: firma un JWT con `role: 'customer', typ: 'access', jti:
    randomUUID(), sub: customerId` (a diferencia de `customerToken()`
    existente, que omite `typ`/`jti` a propósito porque se usa para probar
    rechazo de rol vía header — este helper nuevo es para pasar
    `CustomerGuard` de verdad, vía cookie). Devuelve el valor listo para
    `set('Cookie', ...)`.
  - **Exit criterion**: una request e2e con esta cookie pasa `CustomerGuard`
    en `GET /v1/auth/me` (endpoint ya existente, gateado por el mismo guard).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-app` (smoke del helper contra un endpoint ya `CustomerGuard`-protegido)
- [x] T5.5 Regresión completa del checkout guest (AC-6, prueba de "cero
  cambio observable")
  - **Pattern**: correr, **sin modificar una sola aserción**, toda la suite
    existente de US-008: `checkout.service.spec.ts`,
    `checkout.module.spec.ts`, `checkout-errors.spec.ts`,
    `e2e-checkout-cache.spec.ts`, `e2e-checkout-pii.spec.ts`,
    `e2e-checkout-ratelimit.spec.ts`, `e2e-checkout-security.spec.ts`,
    `e2e-checkout-validation.spec.ts`, `ac2-order-metrics-preserved.spec.ts`,
    `ac2-price-snapshot.spec.ts`, `ac6-order-not-deleted.spec.ts`,
    `ac6-stock-untouched.spec.ts`.
  - **Exit criterion**: el diff sobre esos 12 archivos es vacío (0 líneas
    tocadas) Y la suite completa está en verde — la prueba de que AC-1..AC-11
    de US-008 siguen intactos es que sus propios tests, escritos ANTES de
    este change y sin ningún conocimiento de `customerId`, no necesitan
    cambiar para seguir pasando.
  - **Verify**: `git diff --quiet -- apps/api/src/checkout/checkout.service.spec.ts apps/api/src/checkout/checkout.module.spec.ts apps/api/src/checkout/checkout-errors.spec.ts apps/api/src/checkout/e2e-checkout-cache.spec.ts apps/api/src/checkout/e2e-checkout-pii.spec.ts apps/api/src/checkout/e2e-checkout-ratelimit.spec.ts apps/api/src/checkout/e2e-checkout-security.spec.ts apps/api/src/checkout/e2e-checkout-validation.spec.ts apps/api/src/checkout/ac2-order-metrics-preserved.spec.ts apps/api/src/checkout/ac2-price-snapshot.spec.ts apps/api/src/checkout/ac6-order-not-deleted.spec.ts apps/api/src/checkout/ac6-stock-untouched.spec.ts && pnpm --filter @dsm/api test -- --testPathPattern="checkout"`
- [x] T5.6 Nuevo: checkout con sesión de cliente → `customer_id` en base
  (e2e, feliz)
  - **Pattern**: `bootTestApp([CheckoutModule, AuthModule])`, cookie de
    `customerAccessCookie()` (T5.4) + `POST /v1/checkout` con carrito válido
    → `prisma.order.findUnique({ where: { order_number } })` tiene
    `customer_id` igual al `sub` del token.
  - **Exit criterion**: la respuesta HTTP del 201 **no** incluye `customer_id`
    en ninguna clave (verificado con `Object.keys(res.body)`).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-checkout-customer-link`
- [x] T5.7 AC-1/AC-3/AC-7: listado del historial (e2e)
  - **Pattern**: 2 órdenes propias dentro de retención + 1 fuera + 1 ajena +
    1 `pending_payment` propia → `GET /v1/me/orders` devuelve sólo las 2,
    orden `-created_at`; con 0 órdenes, `{ data: [], pagination.total: 0 }`.
  - **Exit criterion**: el body nunca incluye el UUID interno de ninguna
    orden en ninguna clave.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-orders-history-list`
- [x] T5.8 AC-2/AC-4/AC-5: detalle del historial (e2e)
  - **Pattern**: `GET /v1/me/orders/:order_number` sin cookie → 401; con
    cookie de OTRO cliente sobre un `order_number` que no es suyo → 404; con
    cookie propia → 200 con `items`/`fulfillment`/`status`.
  - **Exit criterion**: los casos "orden ajena" y "orden inexistente" (id que
    no matchea ninguna orden) devuelven el MISMO `type`/`status` RFC 7807 —
    indistinguibles.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-orders-history-detail`
- [x] T5.9 AC-7 en el borde: orden justo en el corte de retención
  - **Pattern**: orden con `created_at` = cutoff exacto (incluida, `gte`) y
    orden con `created_at` = cutoff - 1ms (excluida) — prueba de límite sobre
    `computeRetentionCutoff` + `listByCustomer`/`findByOrderNumberForCustomer`.
  - **Exit criterion**: el borde se comporta como `gte` documentado, sin
    off-by-one.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=orders\\.repository\\.spec`

## Fase 6: Contratos + docs — 0,6 h

- [ ] T6.1 Publicar/validar los 2 yaml OpenAPI del change
  - **Pattern**: `contracts/openapi/list-order-history.yaml` +
    `contracts/openapi/get-order-history-detail.yaml` (ya en el change, ver
    checklist de `api-contract-completeness`) — lint con spectral (o el
    linter que use el repo para los demás yaml del proyecto).
  - **Exit criterion**: ambos yaml validan OpenAPI 3.x sin errores; cada uno
    declara `security`, `parameters`, `responses` con TODOS los status code
    posibles y `components.responses` con `type` URI RFC 7807.
  - **Verify**: `npx @stoplight/spectral-cli lint openspec/changes/US-015-historial-compras-backend/contracts/openapi/*.yaml`
- [ ] T6.2 `apps/api/src/checkout/README.md` — nota del escritor nuevo
  - **Pattern**: agregar una sección corta ("`customer_id` ahora tiene
    escritor — US-015") describiendo `OptionalCustomerGuard` y remitiendo a
    `design.md` de este change — `per documentation-standards.md §4/§8/§11`.
  - **Exit criterion**: el README ya no dice que `customer_id` "queda SIN
    ESCRITOR" (la frase original queda tachada/actualizada, no borrada sin
    rastro).
  - **Verify**: `grep -q "US-015" apps/api/src/checkout/README.md`
- [ ] T6.3 `apps/api/src/orders/README.md` — nueva superficie de cliente
  - **Pattern**: documentar `GET /v1/me/orders*` junto a la superficie admin
    existente, aclarando que son dos audiencias distintas sobre las mismas
    tablas.
  - **Exit criterion**: el README enumera los 2 endpoints nuevos con su guard
    (`CustomerGuard`) y su exclusión (`pending_payment`).
  - **Verify**: `grep -q "v1/me/orders" apps/api/src/orders/README.md`

## Verification (suite-level)

- [ ] Suite completa de `@dsm/api` verde: `pnpm --filter @dsm/api test`
- [ ] E2E verde: `pnpm --filter @dsm/api test:e2e`
- [ ] Lint/typecheck limpios: `pnpm --filter @dsm/api lint && pnpm --filter @dsm/api typecheck`
- [ ] Migración aplicada limpia en Postgres local: `pnpm --filter @dsm/db migrate:deploy`
- [ ] Los 2 yaml OpenAPI nuevos validan sin errores (T6.1)
- [ ] Diff vacío sobre los 12 archivos de la suite de US-008 (T5.5): `git diff --quiet -- apps/api/src/checkout/checkout.service.spec.ts apps/api/src/checkout/checkout.module.spec.ts apps/api/src/checkout/checkout-errors.spec.ts apps/api/src/checkout/e2e-checkout-cache.spec.ts apps/api/src/checkout/e2e-checkout-pii.spec.ts apps/api/src/checkout/e2e-checkout-ratelimit.spec.ts apps/api/src/checkout/e2e-checkout-security.spec.ts apps/api/src/checkout/e2e-checkout-validation.spec.ts apps/api/src/checkout/ac2-order-metrics-preserved.spec.ts apps/api/src/checkout/ac2-price-snapshot.spec.ts apps/api/src/checkout/ac6-order-not-deleted.spec.ts apps/api/src/checkout/ac6-stock-untouched.spec.ts`
