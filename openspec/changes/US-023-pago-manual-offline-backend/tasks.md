---
parent-us: US-023
discipline: backend
variant: null
language: es
---

# US-023 Backend — Tasks

> Cada task es closure-grade: atómica, con `Exit criterion:` observable y
> `Verify:` con el comando exacto que `/develop-backend` corre (forma
> terminante — F49). Los comandos asumen la **raíz del repo** como cwd.
> Integration corre contra el Postgres real de `docker-compose`, que debe
> estar arriba.
>
> **Estimación**: **~8,0 h AI-asistido** / **~17 h tradicional** (7 fases: 1,0 +
> 0,8 + 0,6 + 2,0 + 1,0 + 1,4 + 0,5 + 0,7). La US §7 presupuesta `BE-US-023` en
> 6-10h asumiendo "confirmar un pago y actualizar un estado" — lo que ese
> presupuesto no veía: **nada de `payments` ni de `products.stock` existe
> todavía en código** (US-009/US-010 son sólo plan, 1/40 y 0/40 tasks hechas).
> Este change es la primera migración de `payments`, el primer escritor de
> `products.stock`, y la primera transacción que cruza tres repositorios en el
> repo — trabajo que el enrich de la US no podía anticipar porque describe el
> *resultado* ("la orden pasa a `new`"), no lo que hace falta construir para
> que eso sea cierto de verdad.

## Pre-requisitos

- [ ] **`US-008` backend cerrado y sin tasks en vuelo sobre `checkout/`.** Este
  change extiende `orders.repository.ts` y agrega un `exports` a
  `checkout.module.ts` — con tasks de US-008 abiertas sobre esos archivos se
  pisan.
  **Verify**: `git status --porcelain apps/api/src/checkout` vacío

- [ ] **Ninguna migración de `payments` generada todavía** (evita choque de
  historia de Prisma con quien planifique US-009/US-010 después).
  **Verify**: `ls packages/db/prisma/migrations | grep -c payment` devuelve `0`

- [ ] **`ac6-stock-untouched.spec.ts` sigue verde** (la restricción que dicta
  todo el layout de este change no cambió de forma silenciosa).
  **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=ac6-stock-untouched`

- [ ] **Postgres local arriba**: `docker compose up -d postgres`.

> **Estado intermedio declarado (F51).** Al cerrar este change, `PaymentConfirmationPort`
> tiene un solo adaptador (`manual`) — el camino de MercadoPago (webhook, firma,
> reconciliación, reembolso automático) sigue sin construirse (US-009/US-010).
> El panel de órdenes (US-012) tampoco existe: `GET /pending-payment` es un
> endpoint sin UI propia hasta que esa US se planifique. Es deliberado: el
> objetivo de esta US es que el loop de venta funcione de punta a punta **sin**
> depender de esas dos piezas.

---

## Fase 0: Esquema — 1,0 h

- [ ] T0.1 Migración aditiva `payments` (F40 — column-complete: las 11
  columnas del §Persistence de `design.md`, ni una menos)
  - **Pattern**: `model Payment` nuevo en `packages/db/prisma/schema.prisma`
    con `@id @default(dbgenerated("gen_random_uuid()")) @db.Uuid` (igual que
    `Order`), `@@map("payments")`; migración generada con
    `pnpm --filter @dsm/db migrate -- --name add_payments --create-only` y los
    **CHECK** de `provider`/`status` agregados a mano al `migration.sql`
    generado, igual que `orders_status_check` en
    `20260829172227_add_orders/migration.sql` — per `design.md` §Persistence.
    El CHECK de `provider` incluye los **tres** valores del dominio
    (`'mercadopago','simulated_dsm','manual'`), no sólo `'manual'` — per
    `design.md` §Persistence "Reconciliación con US-009".
  - **Exit criterion**: `payments` existe con las 11 columnas (`id`, `order_id`,
    `provider`, `external_id`, `status`, `amount_ars_cents`, `idempotency_key`,
    `processed_at`, `confirmed_by`, `created_at`, `updated_at`), FK a `orders`,
    índices `idx_payments_external_id` + `idx_payments_order_id` + UNIQUE en
    `idempotency_key`, y los CHECK `payments_provider_check` (con los tres
    valores) + `payments_status_check`. `confirmed_by` **sin** FK.
  - **Verify**: `for col in id order_id provider external_id status amount_ars_cents idempotency_key processed_at confirmed_by created_at updated_at; do grep -q "\"$col\"" packages/db/prisma/migrations/*_add_payments/migration.sql || echo "FALTA: $col"; done` no imprime nada **y**
    `for v in mercadopago simulated_dsm manual; do grep -q "payments_provider_check.*'$v'" packages/db/prisma/migrations/*_add_payments/migration.sql || echo "FALTA valor: $v"; done` no imprime nada **y**
    `grep -c "UNIQUE" packages/db/prisma/migrations/*_add_payments/migration.sql | grep -qv '^0$'`

- [ ] T0.2 Aplicar la migración y regenerar el client
  - **Exit criterion**: la migración corre contra el Postgres local sin error;
    `@dsm/db` exporta el tipo `Payment`.
  - **Verify**: `pnpm --filter @dsm/db migrate:deploy && pnpm --filter @dsm/db generate && pnpm --filter @dsm/db typecheck`

---

## Fase 1: Módulo `stock/` — 0,8 h

- [ ] T1.1 `StockRepository.decrementForOrder` — único punto de ORM que
  escribe `products.stock`
  - **Pattern**: `UPDATE products SET stock = stock - :qty WHERE id = :id AND
    stock >= :qty` por línea (Prisma `updateMany` con `data: { stock: { decrement: qty } }`
    y `where: { id, stock: { gte: qty } }`); acepta un `tx?: Prisma.TransactionClient`
    (default `this.prisma`) — per `design.md` §Approach "primera vez que una
    transacción cruza repositorios". Si `count === 0` para alguna línea,
    `throw new InsufficientStockError(productId)` y corta el loop (no sigue
    decrementando las líneas restantes).
  - **Exit criterion**: decrementar una línea con stock suficiente reduce
    exactamente `qty`; decrementar una línea con stock insuficiente no cambia
    ningún `products.stock` de la orden (ni las líneas ya procesadas antes de
    la que falló, gracias al `tx` compartido) y lanza `InsufficientStockError`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=stock.repository`
    (el spec cubre ambos casos: éxito y corte con rollback — no un test que
    sólo confirme que el método existe, F50)

- [ ] T1.2 `InsufficientStockError` (409) + `StockModule`
  - **Pattern**: extiende `DomainError` igual que `checkout-errors.ts`;
    `type: 'dsm:payments/insufficient-stock'` (vive acá porque el consumidor es
    `payments/`, no porque el error sea "de stock").
  - **Exit criterion**: `StockModule` exporta `StockRepository`; el error
    mapea a 409 vía el `HttpProblemFilter` existente sin registrar nada nuevo
    en él.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=stock-errors`

---

## Fase 2: Extender `orders.repository.ts` — 0,6 h

- [ ] T2.1 `transitionToNewIfPending(orderId, tx)` + `listByStatus(status)`
  - **Pattern**: `updateMany({ where: { id: orderId, status: 'pending_payment' },
    data: { status: 'new' } })` dentro del mismo `tx` que recibe el parámetro;
    si `count === 0`, el método devuelve `null` (no lanza — `ConfirmOrderService`
    decide el error, per `design.md` §Approach). `listByStatus` es una lectura
    simple (`findMany({ where: { status }, orderBy: { created_at: 'desc' } })`),
    sin `tx` (fuera de cualquier transacción de escritura).
  - **Exit criterion**: `transitionToNewIfPending` sobre una orden
    `pending_payment` la deja en `new` y devuelve la orden con sus `items`;
    sobre una orden en cualquier otro estado, no cambia nada y devuelve `null`.
    `listByStatus('pending_payment')` devuelve sólo las órdenes en ese estado,
    ordenadas por más nueva primero.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=orders.repository`

- [ ] T2.2 `CheckoutModule` exporta `OrdersRepository`
  - **Pattern**: agregar `OrdersRepository` al array `exports` de
    `checkout.module.ts` (hoy sólo está en `providers`) — sin tocar ningún
    otro provider ni el contrato público del módulo (`CheckoutController`
    sigue siendo el único endpoint que expone).
  - **Exit criterion**: `PaymentsModule` (Fase 3) puede importar
    `CheckoutModule` e inyectar `OrdersRepository` sin re-declararlo como
    provider propio.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=checkout.module`
    (spec nuevo, chico: instancia el módulo de Nest y confirma que
    `OrdersRepository` resuelve desde afuera vía un módulo consumidor de
    prueba — no sólo que la palabra `OrdersRepository` aparezca en el archivo)

---

## Fase 3: Módulo `payments/` — la transacción — 2,0 h

- [ ] T3.1 `PaymentConfirmationPort` (interfaz) + `PaymentsRepository`
  - **Pattern**: interfaz per `design.md` §Approach (`ConfirmPaymentInput`,
    `ConfirmedPayment`); `PaymentsRepository.create(data, tx)` — único punto de
    ORM de `payments`, traduce `P2002` sobre `idempotency_key` a
    `OrderNotPendingPaymentError` (per `common/prisma-errors.ts`
    `isPrismaError`/`PRISMA_UNIQUE_VIOLATION`, igual patrón que
    `orders.repository.ts` traduce `PRISMA_FK_VIOLATION`).
  - **Exit criterion**: `PaymentsRepository.create` inserta una fila
    `provider: 'manual'` con todos los campos de `design.md` §Persistence; una
    segunda llamada con el mismo `idempotencyKey` no crea una segunda fila y
    lanza `OrderNotPendingPaymentError` en vez del `P2002` crudo de Prisma.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=payments.repository`

- [ ] T3.2 `OrderNotPendingPaymentError` (409, unifica AC-4 + AC-5)
  - **Pattern**: extiende `DomainError`; `type: 'dsm:payments/order-not-pending-payment'`;
    constructor recibe el `currentStatus` para el `detail` (per contrato
    OpenAPI del change).
  - **Exit criterion**: el error mapea a 409 con `detail` que menciona el
    estado actual de la orden.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=payment-confirmation-errors`

- [ ] T3.3 `ConfirmOrderService.confirm()` — la transacción de las tres
  escrituras (AC-1, AC-4, AC-5, AC-6)
  - **Pattern**: `prisma.$transaction(async (tx) => { … })` orquestando, en
    orden, `orders.transitionToNewIfPending` → si `null`, throw
    `OrderNotPendingPaymentError` (corta acá, no sigue a stock) → `stock.decrementForOrder`
    (per T1.1) → `payments.create` (per T3.1) — per `design.md` §Approach,
    paso a paso. `confirmedBy` llega como parámetro (lo resuelve el
    controller, Fase 4, no este service).
  - **Exit criterion**: sobre una orden `pending_payment` con stock suficiente,
    `confirm()` deja la orden en `new`, el stock de cada línea decrementado
    exactamente lo que la orden pedía, y una fila en `payments` con
    `provider: 'manual'`, `status: 'approved'`, `idempotency_key: 'manual:{orderId}'`.
    Sobre una orden que no está `pending_payment`, no toca stock ni crea
    `payments` y lanza `OrderNotPendingPaymentError`. Sobre una orden
    `pending_payment` con una línea sin stock suficiente, la orden **sigue**
    en `pending_payment`, **ningún** producto de esa orden queda con el stock
    tocado (ni los de líneas anteriores a la que falló) y no se crea fila en
    `payments`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=confirm-order.service`
    (integration contra Postgres real — los tres escenarios de arriba son
    los que F50 exige probar, no sólo que el método resuelva sin tirar)

---

## Fase 4: Superficie HTTP — 1,0 h

- [ ] T4.1 DTOs de respuesta + `PaymentConfirmationController`
  - **Pattern**: `@Controller('v1/admin/orders')` `@UseGuards(AdminGuard)`,
    sin throttler dedicado (mismo criterio que `ProductsController` —
    `design.md` §Approach "Endpoints"). `confirmedByFrom(req)` decodifica
    (`JwtService.decode`, sin re-verificar) el bearer token para leer `sub` —
    **no** toca `apps/api/src/auth/admin.guard.ts` (per `design.md` §Approach
    "Identidad del que confirma").
  - **Exit criterion**: `POST /v1/admin/orders/:orderId/confirm-payment`
    responde 200 con `{order_number, status: "new"}`; `GET
    /v1/admin/orders/pending-payment` responde 200 con la lista de
    `{id, order_number, buyer_name, total_ars_cents, created_at}` — **con**
    `id` (el UUID que el `POST` espera en el path — sin él ningún consumidor
    puede construir esa URL desde el listado) y **sin**
    `buyer_email`/`buyer_phone` (`design.md` §Threat model, Info disclosure).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=payment-confirmation.controller`

- [ ] T4.2 `PaymentsModule` completo + wiring en `app.module.ts`
  - **Pattern**: `PaymentsModule` importa `PrismaModule`, `AuthModule` (por
    `AdminGuard` + `JwtModule` re-exportado), `CheckoutModule` (por
    `OrdersRepository`), `StockModule`. `app.module.ts` agrega
    `PaymentsModule` y `StockModule` al array `imports`, en el mismo lugar
    donde ya están `CartModule`/`CheckoutModule` (orden alfabético/temático
    que el archivo ya sigue).
  - **Exit criterion**: la app arranca (`Nest.create` no lanza) con los dos
    módulos nuevos cargados; ningún `forwardRef` en ninguno de los dos (per
    `design.md` §Approach, dirección acíclica).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-payments-bootstrap`
    (spec nuevo, chico: `Test.createTestingModule({ imports: [AppModule] }).compile()`
    no lanza) **y** `! grep -r "forwardRef" apps/api/src/payments apps/api/src/stock`

---

## Fase 5: Los AC como invariantes probadas — 1,4 h

- [ ] T5.1 AC-1 + AC-2: confirmación exitosa de punta a punta + listado
  - **Pattern**: e2e contra Postgres real (mismo estilo que
    `e2e-checkout-validation.spec.ts` de US-008) — siembra una orden
    `pending_payment` real (vía `OrdersRepository.createPendingOrder`, no un
    insert directo), la confirma por HTTP con un JWT admin válido, verifica
    `status: new` en base + stock decrementado + fila en `payments`; siembra
    una segunda orden `pending_payment` y confirma que `GET /pending-payment`
    la lista y ya no lista la primera (que pasó a `new`).
  - **Exit criterion**: el recorrido completo (checkout real → confirmar →
    verificar en base) queda verde, no sólo la respuesta HTTP.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-payments-confirm-happy`

- [ ] T5.2 AC-3: sin JWT admin, o JWT sin `role=admin`, rechaza (401/403)
  - **Pattern**: reusa el mismo estilo de `e2e-admin-auth.spec.ts` (auth
    module) aplicado a las dos rutas nuevas.
  - **Exit criterion**: ninguna de las dos rutas cambia estado ni devuelve
    datos sin un JWT `role=admin` válido.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-payments-auth`

- [ ] T5.3 AC-4 + AC-5: estado inválido y doble confirmación son el mismo 409
  - **Pattern**: tres casos en un `describe`: orden `new` de entrada, orden
    `cancelled` de entrada, y doble-click real (dos `POST` seguidos sobre la
    misma orden `pending_payment` — el segundo debe 409, el primero 200).
    Cubre también la concurrencia mínima: dos `POST` disparados con
    `Promise.all` sobre la misma orden — exactamente uno 200, exactamente uno
    409, nunca dos filas en `payments` para esa orden.
  - **Exit criterion**: los tres casos + el caso concurrente devuelven
    `dsm:payments/order-not-pending-payment`; tras el caso concurrente,
    `payments` tiene **exactamente una** fila para esa orden.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-payments-idempotency`

- [ ] T5.4 AC-6: registro auditable de quién y cuándo
  - **Pattern**: confirma con un JWT cuyo `sub` es un uuid conocido, lee la
    fila de `payments` por `order_id`, verifica `confirmed_by` = ese uuid y
    `processed_at` dentro de los 5s del request (mismo margen que
    `SC-008-N3` de US-008 usó para `consent_accepted_at`).
  - **Exit criterion**: `confirmed_by` y `processed_at` quedan poblados y
    correctos; con el token de bootstrap (`sub: 'admin'`), `confirmed_by`
    guarda el literal `'admin'` sin romper (columna sin FK, per `design.md`).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-payments-audit-trail`

- [ ] T5.5 Insuficiencia de stock al confirmar (invariante de ADR-0008, no un
  AC nuevo — ver `design.md` §Non-goals)
  - **Pattern**: siembra una orden `pending_payment` y luego, **entre el
    checkout y la confirmación**, baja el stock del producto por debajo de lo
    que la orden pidió (simulando otra venta concurrente); confirma; verifica
    409 `dsm:payments/insufficient-stock`, orden sigue `pending_payment`, sin
    fila nueva en `payments`.
  - **Exit criterion**: el rechazo es observable en los tres lugares (HTTP,
    `orders.status`, ausencia de fila en `payments`), no sólo en la respuesta.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-payments-insufficient-stock`

---

## Fase 6: Observabilidad — 0,5 h

- [ ] T6.1 `PaymentEventsService` (`payments.manual_confirmed` +
  `payments.manual_confirm_rejected`)
  - **Pattern**: mismo esqueleto que `CheckoutEventsService` — delega el
    contador en `MetricsService` (`@Optional()`), firma que sólo acepta
    `orderId | null` (nunca PII), `reason` como segundo argumento del evento
    de rechazo (`'not-pending-payment' | 'insufficient-stock'`) — nunca como
    label libre que dispare cardinalidad.
  - **Exit criterion**: cada llamada exitosa a `ConfirmOrderService.confirm()`
    emite `payments.manual_confirmed`; cada rechazo emite
    `payments.manual_confirm_rejected` con el motivo correcto; ninguna firma
    del servicio acepta un string que pueda ser email/nombre/teléfono.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=payments-events`

---

## Fase 7: Contratos y documentación — 0,7 h

- [ ] T7.1 Mergear los dos contratos draft al OpenAPI publicado del servicio
  - **Pattern**: agregar el tag `admin-payments` + las dos rutas de
    `contracts/openapi/orders-confirm-payment.yaml` y
    `contracts/openapi/orders-pending-payment.yaml` a
    `apps/api/docs/api/openapi.yaml`, reusando el `Problem` compartido que ya
    declara ese archivo (no duplicar el schema).
  - **Exit criterion**: `apps/api/docs/api/openapi.yaml` declara
    `POST /admin/orders/{orderId}/confirm-payment` y
    `GET /admin/orders/pending-payment` con sus 401/403/404/409, y lintea
    limpio.
  - **Verify**: `pnpm dlx @stoplight/spectral-cli lint apps/api/docs/api/openapi.yaml --ruleset .spectral.yaml --fail-severity=warn`

- [ ] T7.2 Nota operativa en el runbook del servicio
  - **Pattern**: una entrada corta en `docs/services/dsm-ecommerce/runbook.md`
    — mientras `US-009` esté `Blocked`, **toda** orden requiere confirmación
    manual del dueño; si el panel (US-012) todavía no existe, `GET
    /v1/admin/orders/pending-payment` es el único punto de verdad de qué
    quedó pendiente.
  - **Exit criterion**: el runbook menciona la confirmación manual como el
    único camino de pago mientras US-009 esté en pausa.
  - **Verify**: `rg -q "confirm-payment|pago manual" docs/services/dsm-ecommerce/runbook.md`

## Verification (suite-level)

- [ ] Todos los unit + integration pasan: `pnpm --filter @dsm/api test`
- [ ] Typecheck limpio: `pnpm --filter @dsm/api typecheck`
- [ ] Lint limpio: `pnpm --filter @dsm/api lint`
- [ ] Contrato OpenAPI lintea: `pnpm dlx @stoplight/spectral-cli lint apps/api/docs/api/openapi.yaml --ruleset .spectral.yaml --fail-severity=warn`
- [ ] `ac6-stock-untouched.spec.ts` sigue verde (nada de este change tocó
  `checkout/` para escribir stock): `pnpm --filter @dsm/api test -- --testPathPattern=ac6-stock-untouched`
