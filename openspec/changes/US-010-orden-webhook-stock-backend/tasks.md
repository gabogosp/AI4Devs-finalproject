---
parent-us: US-010
discipline: backend
variant: null
language: es
---

# US-010 Backend — Tasks

> Cada task es closure-grade: atómica, con `Exit criterion:` observable y `Verify:` con el
> comando exacto que `/develop-backend` corre. Los comandos asumen la **raíz del repo** como
> cwd. El runner es el de US-001/US-003/US-007:
> `pnpm --filter @dsm/api test -- --testPathPattern=<patrón>` corre Jest en su forma
> **terminante** (no watch — F49). Integration y e2e corren contra el Postgres real de
> `docker-compose` (`ai4devs-finalproject-postgres-1`, host `:55432`).
>
> **Estimación dual**: **13,6 h AI-asistido** / **~26 h tradicional** (26 tasks, suma de las
> fases: 1,2 + 1,8 + 2,6 + 1,8 + 1,4 + 0,6 + 1,8 + 1,6 + 0,8). La US §7 presupuesta
> `BE-US-010` en 16-24 h —es la task más grande del proyecto y la US ya lo sabía—. El
> tradicional excede el techo ~2 h por tres cosas que la US menciona en una línea cada una:
> (a) **«se disparan las notificaciones»** no tiene cola (Redis no aprovisionado — cuarta
> instancia de ADR-0012/0014), así que hace falta el puerto + adaptador de log;
> (b) **«corre la reconciliación»** y **«corre el job de limpieza»** no tienen planificador
> (no hay `@nestjs/schedule`), así que hay dos runners en proceso + dos endpoints admin;
> (c) el **reembolso durable** de AC-4 necesita un estado persistido y un runner de
> reintentos, porque perder un reembolso en memoria es perder plata de un cliente.
> La transacción del camino feliz son ~1,5 h; el resto es todo condición adversa, que es
> donde está el valor de esta US.

## Pre-requisitos

- [ ] **US-008 backend construido**: `orders` y `order_items` existen.
  **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=order-schema`
- [ ] **US-009 backend construido**: `payments`, el `MercadoPagoClient` (que T1.1 extiende) y
  el `PaymentConfirmationPort` con su `NoopPaymentConfirmation` (que T2.4 reemplaza).
  **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern='payment-schema|http-mercadopago|noop-payment-confirmation'`
- [ ] **US-009 no en vuelo sobre `src/payments/`.** T1.1 modifica su puerto y T2.4 su
  registro de provider. Con esa sesión escribiendo ahí se pisan.
  **Verify**: `git status --porcelain apps/api/src/payments` vacío
- [ ] **`apps/api` limpio y `typecheck` en exit 0** (baseline conocido).
  **Verify**: `git status --porcelain apps/api` vacío **y** `pnpm --filter @dsm/api typecheck`
- [ ] **Postgres local arriba**: `docker compose up -d postgres`.
- [ ] **`MP_WEBHOOK_SECRET` de sandbox en `.env`** — ningún test lo necesita (se firma con un
  secreto de prueba), pero la verificación manual del gate de release sí.

> **Estado intermedio declarado (F51).** Al cerrar este change **no se manda ningún email**:
> `NotificationPort` tiene un adaptador que loguea. `Deferred: US-011 — owner: BE`. Y la
> orden llega a `new` pero **nadie la ve**: el panel del dueño es US-012.
> `Deferred: US-012 — owner: BE/FE`.

---

## Fase 0: Esquema y configuración — 1,2 h

- [ ] T0.1 Migración aditiva: `refund_pending` + `confirmed_at` + `cancelled_at`
  - **Pattern**: `ALTER TABLE` aditivo; el `CHECK` se **reemplaza** (drop + add) porque
    Postgres no permite extender un `CHECK` en el lugar — igual que los `CHECK` a mano de
    US-007/US-008 — `per backend-node-standards.md §5 — migración aditiva, nunca destructiva
    en un solo deploy`.
    ```sql
    ALTER TABLE "payments" DROP CONSTRAINT "payments_status_check";
    ALTER TABLE "payments" ADD CONSTRAINT "payments_status_check" CHECK ("status" IN
      ('pending','approved','rejected','refunded','refund_pending'));
    ALTER TABLE "orders" ADD COLUMN "confirmed_at" TIMESTAMP(3);
    ALTER TABLE "orders" ADD COLUMN "cancelled_at" TIMESTAMP(3);
    ```
  - **Exit criterion**: `payments.status` acepta los **5** valores y sigue rechazando
    cualquier otro; `orders` gana `confirmed_at` y `cancelled_at` (nullable). **Ninguna
    columna existente se modifica** y ninguna fila se toca (las columnas nacen `NULL`). El
    índice único parcial `payments_one_pending_per_order` de US-009 **sigue existiendo y
    sigue aplicando sólo a `pending`** — extender el `CHECK` no puede haberlo alterado.
  - **Verify**: `pnpm --filter @dsm/db migrate:deploy && pnpm --filter @dsm/api test -- --testPathPattern='payment-schema|order-schema'`
    (los specs de esquema de US-008 y US-009 corren **actualizados con las columnas nuevas**;
    casos nuevos: `INSERT` con `status='refund_pending'` **pasa**; con `status='weird'`
    **falla**; `confirmed_at` y `cancelled_at` existen y admiten `NULL`;
    `payments_one_pending_per_order` sigue en `pg_indexes` con `indpred` no nulo)

- [ ] T0.2 Variables de entorno del webhook y los trabajos
  - **Pattern**: extender `envSchema` + el `superRefine` de producción, igual que
    `MP_ACCESS_TOKEN` en US-009 — `per backend-node-standards.md §7 — fail-fast` y
    `per security-standards.md §5 — secretos desde la plataforma`.
  - **Exit criterion**: se declaran `MP_WEBHOOK_SECRET` (opcional a nivel de campo,
    **requerido en producción**: sin él la verificación de firma no puede correr y el
    arranque **falla**), `MP_WEBHOOK_TOLERANCE_SEC` (300), `ORDER_ABANDON_HOURS` (48 —
    OQ-BE-1), `RECONCILE_INTERVAL_MS` (900 000), `RECONCILE_MIN_AGE_MS` (300 000),
    `CLEANUP_INTERVAL_MS` (3 600 000), `REFUND_MAX_ATTEMPTS` (5),
    `REFUND_RETRY_BASE_MS` (60 000). Un valor inválido hace fallar el arranque.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=env.validation`
    (sin las variables → los 8 defaults **literales**, con
    `expect(env.ORDER_ABANDON_HOURS).toBe(48)`; `NODE_ENV=production` sin
    `MP_WEBHOOK_SECRET` → **lanza** y el mensaje nombra la variable;
    `MP_WEBHOOK_TOLERANCE_SEC=abc` → lanza; `REFUND_MAX_ATTEMPTS=0` → lanza; los casos
    existentes siguen verdes)

---

## Fase 1: Extender el puerto de MercadoPago y verificar la firma — 1,8 h

- [ ] T1.1 `MercadoPagoClient` gana `getPayment` y `refund`
  - **Pattern**: se **extiende** la interfaz y el adaptador HTTP de US-009 (que ya tiene
    timeout, reintentos con jitter y circuit breaker); **no se crea un segundo cliente**. El
    `refund` es una escritura con dinero: lleva `X-Idempotency-Key` derivado de
    `payments.id` para que un reintento nuestro no genere dos devoluciones — `per
    backend-node-standards.md §8 — idempotency keys para mutaciones reintentables`.
    ```ts
    getPayment(paymentId: string): Promise<{ status: PaymentStatus; externalReference: string; amountArs: number }>;
    refund(paymentId: string, amountArs?: number): Promise<{ refundId: string }>;
    ```
  - **Exit criterion**: los dos métodos existen en el puerto, en `HttpMercadoPagoClient` y en
    `FakeMercadoPagoClient` (con modos programables OK / 4xx / 5xx / timeout). `getPayment`
    reintenta como una lectura; `refund` manda la clave de idempotencia y **la misma en los
    reintentos**. Los errores se mapean a los tipos de dominio que US-009 ya declaró
    (`ProviderUnavailableError` / `ProviderRejectedError`); **no se agrega un tipo nuevo**.
    Los specs de US-009 pasan **sin editarse**.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern='http-mercadopago|fake-mercadopago|mercadopago-secrecy'`
    (los specs existentes corren sin editar + nuevos: `getPayment` con un `500` seguido de
    `200` → 2 llamadas y resultado OK; `refund` con timeout y reintento manda el **mismo**
    `X-Idempotency-Key` en las 2 llamadas; el token centinela no aparece en logs ni en los
    errores de los métodos nuevos)

- [ ] T1.2 `webhook-signature.ts` — HMAC en tiempo constante + ventana de `ts`
  - **Pattern**: función **pura**, sin tipos de framework, para poder ejercer la criptografía
    sin HTTP. Comparación con `crypto.timingSafeEqual` — `per security-standards.md §6` y
    `per design.md D5`.
    ```ts
    // manifiesto: `id:${dataId};request-id:${requestId};ts:${ts};`
    export function verifyWebhookSignature(input: {...}, secret: string, toleranceSec: number): boolean
    ```
  - **Exit criterion**: acepta una firma válida dentro de la ventana; **rechaza** firma
    inválida, firma válida con `ts` fuera de la ventana (replay), header ausente, header
    malformado, `ts` no numérico, y un secreto distinto. La comparación es de **tiempo
    constante** (usa `timingSafeEqual`, no `===`), y con longitudes distintas no lanza.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=webhook-signature`
    (`webhook-signature.spec.ts`: los 6 casos de rechazo y el de aceptación; un caso con
    `ts` de hace 10 min y firma **correcta** → rechaza (prueba la ventana, no sólo el HMAC);
    firmas de longitudes distintas → `false` sin excepción) **y**
    `rg -q "timingSafeEqual" apps/api/src/payments/webhook-signature.ts`

- [ ] T1.3 `NotificationPort` + adaptador de log
  - **Pattern**: puerto por token de DI con adaptador que sólo registra; US-011 registra el
    real sin tocar este archivo — mismo patrón que `PaymentConfirmationPort` de US-009 —
    `per backend-node-standards.md §3` y `per ADR-0012/0014` (no hay cola).
  - **Exit criterion**: `orders/ports/notification.port.ts` declara el token
    `NOTIFICATION_PORT` y una interfaz con `orderConfirmed(...)` y
    `orderCancelledNoStock(...)`. `LoggingNotificationAdapter` los implementa registrando una
    línea **sin PII** (sólo `order_id`, `payment_id`, montos) y **sin escribir en base**. El
    TODO nombra `US-011` como dueño del reemplazo.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=notification.port`
    (los dos métodos resuelven, loguean una línea con las claves esperadas y **ninguna** con
    `buyer_email`/`buyer_name`/`buyer_phone`; el espía de `PrismaService` registra **0**
    llamadas)

---

## Fase 2: La transacción de confirmación — 2,6 h

- [ ] T2.1 `order-state.ts` — la FSM como función pura
  - **Pattern**: tabla de transiciones válidas del E2E §12, pura y sin framework — `per
    backend-node-standards.md §2`.
  - **Exit criterion**: `canTransition(from, to)` acepta exactamente las transiciones del
    §12 y rechaza el resto. En particular: `pending_payment → new` ✅,
    `pending_payment → cancelled` ✅, `new → cancelled` ✅, `delivered → cancelled` ❌,
    `cancelled → new` ❌, `new → pending_payment` ❌. Este change **sólo** usa las dos
    primeras; el resto queda declarado para US-012/US-013.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=order-state`
    (`order-state.spec.ts`: matriz completa 6×6 asertada contra la lista del §12 —36 casos—,
    de modo que agregar o quitar una transición rompe el test)

- [ ] T2.2 `StockRepository` — el único escritor de `products.stock`
  - **Pattern**: `UPDATE` condicional atómico verificando `rowCount`, e ítems recorridos
    **ordenados por `product_id`** para no generar deadlocks entre órdenes que comparten
    productos — `per ADR-0008` y `per design.md D3`.
    ```sql
    UPDATE products SET stock = stock - $q, updated_at = now()
     WHERE id = $id AND stock >= $q;   -- rowCount === 1 o no hay stock
    ```
  - **Exit criterion**: expone `decrementMany(tx, items)` que devuelve `ok` o el
    `product_id` del primer ítem sin stock, recorriendo **en orden de `product_id`**. Acepta
    la transacción como parámetro (el llamador es dueño de la transacción, no el
    repositorio). **Ningún otro archivo del repo escribe `products.stock`**.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=stock.repository`
    (integration: decremento de 3 ítems deja los stocks exactos; con un ítem de `stock=1` y
    `q=2` devuelve ese `product_id` y **no** decrementa ninguno de los otros dentro de la
    misma transacción; el orden de las sentencias emitidas es por `product_id` ascendente
    —espía sobre la transacción— **independientemente** del orden de entrada) **y**
    `rg -l "products.*SET stock|stock = stock" apps/api/src --glob '!**/stock.repository.ts' --glob '!**/*.spec.ts'` sin resultados

- [ ] T2.3 `ConfirmOrderService` — idempotencia por `FOR UPDATE` + confirmación
  - **Ubicación**: `src/payments/confirm-order.service.ts`, **no** `src/orders/`. Orquesta la
    fila del pago, el stock y la orden, y necesita `MercadoPagoClient.refund`: puesto en
    `orders/` obligaría a que `PaymentsModule` importe `OrdersModule` **y** viceversa —
    ciclo. La dirección es `payments → orders` y `payments → stock`, en un solo sentido
    (`design.md` §D9).
  - **Pattern**: **una** transacción con `SELECT … FOR UPDATE` sobre la fila del pago; sólo
    la transición `pending → approved` hace trabajo. **No hay check-then-act** — `per
    design.md D2` y `per backend-node-standards.md §5`.
    ```ts
    await this.prisma.$transaction(async (tx) => {
      const [pay] = await tx.$queryRaw`SELECT * FROM payments WHERE id = ${id} FOR UPDATE`;
      if (pay.status !== 'pending') return { outcome: 'already_processed' };
      …
    }, { isolationLevel: 'ReadCommitted' });
    ```
  - **Exit criterion**: con un pago `pending` y estado verificado `approved`: decrementa por
    ítem, pone `payments.status='approved'` con `processed_at`, `orders.status='new'` con
    `confirmed_at`, y **después del COMMIT** invoca `NotificationPort.orderConfirmed` una
    vez. Con estado verificado `rejected`: pago → `rejected`, **la orden queda en
    `pending_payment`** y el stock intacto (AC-3, OQ-BE-4). Con el pago ya `approved`:
    **no-op** que devuelve `already_processed` sin tocar nada. Ninguna llamada externa ocurre
    **dentro** de la transacción.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=confirm-order.service`
    (integration contra Postgres real: aprobado → stock decrementado, orden `new`,
    `confirmed_at` no nulo, puerto de notificación invocado **1** vez; rechazado → orden
    sigue `pending_payment` y stock **idéntico**; pago ya `approved` → los 3 valores
    idénticos antes y después y el puerto invocado **0** veces; y un espía que asserta que
    el `NotificationPort` se llamó **después** del commit —visible porque la fila ya está
    consultable desde otra conexión cuando se invoca)

- [ ] T2.4 Reemplazar `NoopPaymentConfirmation` por el servicio real (**cierra el seam de US-009**)
  - **Pattern**: cambiar el `useClass` del provider `PAYMENT_CONFIRMATION` en el módulo; el
    archivo del puerto **no se toca** — es exactamente el punto de extensión que US-009
    diseñó.
  - **Exit criterion**: `PaymentsModule` registra `ConfirmOrderService` como implementación
    de `PAYMENT_CONFIRMATION`. **El medio simulado de US-009 confirma la orden de verdad**
    sin que su código cambie (AC-9): el mismo camino, no dos. `NoopPaymentConfirmation` se
    **elimina** (era interino y su TODO nombraba a US-010) y su spec también.
    **Y el grafo de módulos queda acíclico**: `OrdersModule` y `StockModule` **no importan**
    `PaymentsModule`, y **no existe un solo `forwardRef`** en el change — su presencia
    significaría que la dirección de dependencias se eligió mal y el ciclo quedó tapado.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern='e2e-payments-simulate|confirm-order'`
    **y** `test -z "$(rg -l 'forwardRef' apps/api/src/payments apps/api/src/orders apps/api/src/stock)"`
    **y** `test -z "$(rg -l 'PaymentsModule' apps/api/src/orders apps/api/src/stock)"`
    (el ciclo se comprueba por ausencia de import y de `forwardRef`, no por que la app arranque
    —Nest arranca igual con `forwardRef` y el problema queda escondido)
    (el spec de US-009 `e2e-payments-simulate.spec.ts` se **actualiza** en una sola
    aserción: donde antes esperaba `order_status: 'pending_payment'` ahora espera `'new'`, y
    se agrega que el stock **bajó** — el resto del spec corre igual, lo que demuestra que el
    camino es el mismo) **y** `test ! -f apps/api/src/payments/confirmation/noop-payment-confirmation.ts`

---

## Fase 3: Compensación y reembolso durable — 1,8 h

- [ ] T3.1 Rama de compensación: cobrado y sin stock (AC-4)
  - **Pattern**: la transacción del decremento **revierte**; en una transacción **nueva** se
    marca la cancelación; el reembolso se ejecuta **fuera** de toda transacción — `per
    design.md D1` (una llamada a un tercero adentro bloquearía filas de `products` durante
    segundos).
  - **Exit criterion**: cuando `decrementMany` reporta falta de stock con el pago ya
    aprobado: la primera transacción revierte (**ningún** stock quedó decrementado a
    medias), la segunda pone `orders.status='cancelled'` con `cancelled_at` y
    `payments.status='refund_pending'`, y se invoca
    `NotificationPort.orderCancelledNoStock`. La orden **no** queda en `new` en ningún
    instante intermedio observable.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=compensation-no-stock`
    (integration con 3 ítems, el **segundo** sin stock: tras procesar, los stocks de los 3
    son **idénticos** a los iniciales —prueba el rollback, no sólo que no explotó—, la orden
    es `cancelled` con `cancelled_at`, el pago es `refund_pending`, y el puerto de
    notificación recibió `orderCancelledNoStock` una vez)

- [ ] T3.2 `RefundService` — el reembolso, con reintentos durables
  - **Exit criterion**: toma un pago en `refund_pending`, llama a
    `MercadoPagoClient.refund` y lo pasa a `refunded` con `processed_at`. Si el proveedor
    falla, **la fila queda en `refund_pending`** y se emite `refund.failed`; tras
    `REFUND_MAX_ATTEMPTS` intentos sigue en `refund_pending` (OQ-BE-3: **no** se marca como
    fallido definitivo — es plata de un cliente) y el evento se emite en cada intento. El
    reintento usa backoff `REFUND_RETRY_BASE_MS × 2ⁿ`. Es **idempotente**: un pago ya
    `refunded` no se vuelve a reembolsar.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=refund.service`
    (integration: happy → `refunded`; proveedor `5xx` → sigue `refund_pending` y
    `count('refund.failed') === 1`; 6 intentos con proveedor caído → **sigue**
    `refund_pending` —nunca un estado terminal de fallo—; un pago `refunded` procesado de
    nuevo → 0 llamadas al fake)

- [ ] T3.3 Runner de reembolsos pendientes
  - **Pattern**: runner en proceso no reentrante con intervalo y cooldown, mismo patrón que
    los de US-005/US-006 — `per ADR-0012/0014` (no hay cola).
  - **Exit criterion**: barre los `refund_pending` cuyo próximo intento venció y los procesa
    por `RefundService`. **No reentrante**: dos ticks solapados no procesan la misma fila dos
    veces. Se puede deshabilitar por config para los tests.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=refund.runner`
    (con 3 filas `refund_pending` y el reloj avanzado, las 3 quedan `refunded`; dos ticks
    disparados **en paralelo** procesan cada fila **una sola vez** —el fake registra 3
    llamadas, no 6)

---

## Fase 4: Superficie HTTP — 1,4 h

- [ ] T4.1 `POST /v1/webhooks/mercadopago`
  - **Pattern**: verificar firma → **re-consultar el pago a MP** → delegar en
    `ConfirmOrderService`. El cuerpo aporta **sólo el id**; la verdad sale de la consulta —
    `per ADR-0006` y `per design.md D5`. **Sin throttler y sin CSRF, a propósito** (D5):
    limitar por IP la entrada del dinero descarta pagos cuando el proveedor reintenta.
  - **Exit criterion**: firma válida + pago `approved` en MP → **200** y la orden confirmada.
    Firma inválida → **401** y **cero** cambios en base. Firma válida pero MP dice
    `rejected` → 200, orden intacta. Error transitorio nuestro (base caída) → **200** con el
    caso registrado para la reconciliación, **no** un 5xx (D5: un 5xx desata una tormenta de
    reintentos justo cuando el sistema está mal). El endpoint **no** está registrado en
    ningún throttler y **no** exige `X-CSRF-Token`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-webhook-mercadopago`
    (`e2e-webhook-mercadopago.spec.ts` con supertest y el fake de MP: los 4 escenarios con
    su status; en el de firma inválida se comparan `orders.status`, `payments.status` y los
    stocks **antes y después** y son idénticos; se asserta que el body con
    `status: 'approved'` **y firma inválida** no confirma nada —el payload no manda—; y que
    100 requests seguidas **no** reciben 429)

- [ ] T4.2 Endpoints admin de los dos trabajos
  - **Exit criterion**: `POST /v1/admin/payments/reconcile` y
    `POST /v1/admin/orders/cleanup-abandoned` corren su trabajo de forma **sincrónica** y
    devuelven un resumen (`{ processed, confirmed, cancelled, failed }`). Los dos exigen
    `AdminGuard` (401/403 sin JWT de admin) y llevan `Cache-Control: no-store` del borde. Son
    **idempotentes**: dispararlos dos veces seguidas no cambia nada la segunda vez.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-admin-jobs`
    (sin token → 401; con token de cliente (no admin) → 403; con admin → 200 con el resumen;
    **dos disparos seguidos**: el segundo devuelve contadores en 0 y la base queda igual)

- [ ] T4.3 `Cache-Control: no-store` en la superficie del webhook y los jobs
  - **Pattern**: extender la condición del middleware de `bootstrap.ts` que ya cubre
    `/v1/admin`, `/v1/cart`, `/v1/checkout` y `/v1/payments` — `per security-standards.md §7.1`.
  - **Exit criterion**: toda respuesta bajo `/v1/webhooks` lleva `no-store`, incluidas las
    401. Las superficies existentes no cambian y la caché acotada del storefront sigue intacta.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern='e2e-webhook-mercadopago|e2e-storefront-cache'`
    (el 200 y el 401 del webhook llevan `no-store`; el spec de caché del storefront corre
    **sin editarse**)

---

## Fase 5: Reconciliación y limpieza — 0,6 h

- [ ] T5.1 `ReconcileService` + runner (AC-10)
  - **Pattern**: usa **el mismo `ConfirmOrderService`** que el webhook — es idempotente por
    construcción, así que reconciliar algo ya procesado es un no-op. **No hay una segunda
    implementación** que pueda divergir (`design.md` D8).
  - **Exit criterion**: toma las órdenes `pending_payment` con un pago `pending` de más de
    `RECONCILE_MIN_AGE_MS`, consulta su estado a MP y las procesa. Un pago que MP reporta
    `approved` confirma la orden **igual que si hubiera llegado el webhook**; uno que reporta
    `rejected` marca el pago; uno todavía `pending` se deja para la próxima. Devuelve el
    resumen.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=reconcile.service`
    (integration: una orden con pago `pending` que MP reporta `approved` y **sin** webhook
    → queda `new` con stock decrementado; correr la reconciliación **otra vez** no cambia
    nada; una orden cuyo webhook **sí** llegó antes → no-op)

- [ ] T5.2 `CleanupAbandonedService` + runner (AC-11)
  - **Exit criterion**: las órdenes `pending_payment` con `created_at` de más de
    `ORDER_ABANDON_HOURS` (48, OQ-BE-1) pasan a `cancelled` con `cancelled_at`. **No** toca
    stock (nunca se decrementó) ni intenta reembolsos (no hubo pago aprobado). Una orden de
    47 h **no** se cancela. Es idempotente.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=cleanup-abandoned`
    (integration con órdenes de 47 h, 49 h y una ya `cancelled`: sólo la de 49 h cambia;
    los stocks de todos los productos quedan **idénticos**; segunda corrida → 0 cambios)

---

## Fase 6: Los AC negativos como invariantes probadas — 1,8 h

> Siete de los once AC son negative space. Esta fase es la que hace que esta US valga lo que
> cuesta: son las propiedades que, si se rompen, cuestan plata.

- [ ] T6.1 AC-5 + AC-6 — idempotencia bajo duplicados **concurrentes**
  - **Exit criterion**: el mismo webhook enviado **10 veces en paralelo** confirma la orden
    **una** vez: el stock baja exactamente `q` (no `10q`), la orden es `new`, el pago
    `approved`, `count('payment.duplicate_ignored') === 9` y el puerto de notificación se
    invocó **1** vez. Lo mismo enviado en secuencia con un webhook tardío al final: sin
    cambios adicionales.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=ac5-ac6-idempotency`
    (`ac5-ac6-idempotency.spec.ts`, integration: `Promise.all` de 10 requests al endpoint
    real; asserts sobre el stock leído de Postgres, el estado de orden y pago, y los
    contadores. Es el test que un check-then-act **no** pasaría)

- [ ] T6.2 AC-8 — el stock nunca queda negativo bajo concurrencia real
  - **Exit criterion**: con un producto de `stock = 1` y **5 órdenes distintas** cuyos pagos
    se aprueban en paralelo, exactamente **una** se confirma y **cuatro** terminan
    `cancelled` con su pago en `refund_pending`. El `stock` final es **0** y nunca fue
    negativo. `count('stock.decrement_blocked') === 4`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=ac8-no-oversell`
    (`ac8-no-oversell.spec.ts`, integration con `Promise.all` de 5 confirmaciones: conteo
    exacto de órdenes `new` (1) y `cancelled` (4), `stock = 0`, y **ninguna** violación del
    `CHECK` en los logs de Postgres —si el `CHECK` es lo que salva, el `UPDATE` condicional
    está mal escrito)

- [ ] T6.3 AC-7 — un webhook no verificado no puede cambiar nada
  - **Exit criterion**: seis variantes de webhook no verificable (firma inválida, secreto
    distinto, `ts` viejo con firma válida, header ausente, header malformado, cuerpo que
    dice `approved` sin firma) devuelven **401** y dejan `orders.status`,
    `payments.status` y todos los stocks **idénticos**. Y ninguna llega a llamar a
    `getPayment` —el fake registra 0 llamadas—: se rechaza **antes** de gastar una consulta.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=ac7-signature-required`
    (los 6 casos con snapshot de los 3 estados antes/después + el espía de `getPayment` en 0)

- [ ] T6.4 AC-9 — el simulado y el real son un solo camino
  - **Exit criterion**: se ejercen los dos caminos —`POST /v1/payments/simulate` de US-009 y
    el webhook real— sobre órdenes equivalentes, y el **estado final es indistinguible**:
    orden `new` con `confirmed_at`, pago `approved` con `processed_at`, mismo decremento de
    stock, misma invocación del puerto de notificación con el mismo payload salvo `provider`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=ac9-same-path`
    (`ac9-same-path.spec.ts`: los dos flujos completos y una comparación **campo por campo**
    del estado resultante, excluyendo `provider` y los ids. Si alguien duplica el camino de
    confirmación, este test lo detecta)

- [ ] T6.5 AC-2 — la notificación se invoca, con el payload correcto y sin PII en logs
  - **Exit criterion**: `orderConfirmed` recibe `order_id`, `payment_id`, el total y las
    líneas necesarias para el email de US-011; `orderCancelledNoStock` recibe lo suyo. Ambas
    se invocan **después** del commit. Y ninguna línea de log de todo el flujo contiene el
    email, el nombre o el teléfono del comprador —que están en `orders` y son la primera PII
    del proyecto (US-008).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=ac2-notifications`
    (el puerto recibe el payload esperado en ambos casos; con centinelas sembrados en
    `buyer_email`/`buyer_name`/`buyer_phone`,
    `expect(JSON.stringify(todasLasLineas)).not.toContain(centinela)` para los tres)

---

## Fase 7: Observabilidad — 1,6 h

- [ ] T7.1 `OrderEventsService`
  - **Pattern (actualizado 2026-08-23 — AUDIT-dsm-api-006)**: el servicio **delega en
    `MetricsService`**, que ya existe en `src/observability/metrics.service.ts` y expone
    el registro por `GET /v1/admin/metrics`. **NO se abre un `Map` privado nuevo**: ese
    era exactamente el patrón que la auditoría encontró repetido cuatro veces, con
    contadores invisibles desde afuera. `MetricsModule` es `@Global`, así que se inyecta
    sin importarlo.
    ```ts
    constructor(@Optional() private readonly metrics?: MetricsService) {}
    // en emit():
    this.metrics?.increment('orders', name);   // → dsm_orders_events_total{event="..."}
    ```
    `@Optional()` sigue el precedente de `CatalogEventsService`: permite construir el
    servicio a mano en los unit tests sin arrastrar el contenedor.
    **Etiqueta única `event`** — ningún id de orden, de pago, de cliente ni el texto de
    una búsqueda entra como dimensión (`observability-standards.md` §9; el spec de
    `metrics.service.ts` tiene un assert que falla si alguien agrega una segunda clave).
 con los 10 eventos
  - **Pattern**: contador por nombre de evento, identificadores sólo en la línea de log —
    `per observability-standards.md §9`.
  - **Exit criterion**: declara `order.confirmed`, `order.cancelled_no_stock`,
    `payment.webhook_received`, `payment.webhook_rejected_signature`,
    `payment.duplicate_ignored`, `stock.decrement_blocked`, `refund.enqueued`,
    `refund.failed`, `reconcile.recovered`, `cleanup.cancelled`. La firma **no acepta** PII.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=order-events`
    (los 10 nombres tipan; `count` incrementa por nombre; **y el valor sale por
    `MetricsService.render()` como `dsm_orders_events_total{event="..."}`** —lo que el
    contador local NO probaba; el conjunto de claves de la línea
    de log es exactamente el esperado)

- [ ] T7.2 Instrumentación de los 10 eventos + el runbook
  - **Exit criterion**: los 10 se emiten en su punto exacto. Y
    `docs/services/dsm-ecommerce/runbook.md` gana **tres** entradas del E2E §18.5:
    (1) **órdenes atascadas en `pending_payment`** — síntoma (`payment.webhook_received` sin
    `order.confirmed` correspondiente), acción (`POST /v1/admin/payments/reconcile`);
    (2) **reembolso que no sale** — síntoma (`refund.failed` repetido), efecto (**hay plata
    de un cliente sin devolver**), acción (verificar estado en el panel de MP y reintentar
    con el runner; **no** marcar como resuelto a mano);
    (3) **oversell bloqueado** — síntoma (`stock.decrement_blocked` en alza), lectura (el
    catálogo tiene stock desactualizado, no es un bug del pago).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-webhook-observability`
    (los 10 escenarios con `count` en 1) **y**
    `rg -q "reconcile" docs/services/dsm-ecommerce/runbook.md && rg -q "refund.failed" docs/services/dsm-ecommerce/runbook.md && rg -q "stock.decrement_blocked" docs/services/dsm-ecommerce/runbook.md`

---

## Fase 8: Contratos y documentación — 0,8 h

- [ ] T8.1 OpenAPI publicado
  - **Exit criterion**: `apps/api/docs/api/openapi.yaml` declara los tres endpoints con sus
    status (webhook: `200`/`401`; admin: `200`/`401`/`403`), el header `x-signature` como
    requerido en el webhook, y el envelope `problem+json` por `$ref`. Lintea limpio.
  - **Verify**: `pnpm dlx @stoplight/spectral-cli lint apps/api/docs/api/openapi.yaml --ruleset .spectral.yaml --fail-severity=warn`

- [ ] T8.2 README de los módulos
  - **Exit criterion**: `apps/api/src/orders/README.md` (≤ 40 líneas) explica la FSM y qué
    transiciones escribe **este** change vs US-012/US-013, por qué la idempotencia es
    `FOR UPDATE` y no un `if`, por qué el reembolso va fuera de la transacción, y por qué el
    webhook **no** tiene throttler. `apps/api/src/stock/README.md` (≤ 20 líneas) explica que
    es el único escritor de `products.stock` y por qué el `UPDATE` es condicional (ADR-0008).
  - **Verify**: `test -f apps/api/src/orders/README.md && test -f apps/api/src/stock/README.md && rg -q "ADR-0008" apps/api/src/stock/README.md && rg -q "FOR UPDATE" apps/api/src/orders/README.md && test $(wc -l < apps/api/src/orders/README.md) -le 40`

---

## Verification (suite-level)

- [ ] Type-check limpio: `pnpm --filter @dsm/api typecheck`
- [ ] Lint limpio: `pnpm --filter @dsm/api lint`
- [ ] Esquema aplicado desde cero: `pnpm --filter @dsm/db migrate:deploy`
- [ ] Suite completa verde: `pnpm --filter @dsm/api test -- --ci`
- [ ] Los invariantes de la Fase 6, aislados y **en serie** (son de concurrencia):
      `pnpm --filter @dsm/api test -- --ci --runInBand --testPathPattern='ac5-ac6|ac7-|ac8-|ac9-|ac2-'`
- [ ] **Sin regresión** en lo que este change tocó de US-008 y US-009:
      `pnpm --filter @dsm/api test -- --ci --testPathPattern='payment-schema|order-schema|http-mercadopago|e2e-payments|e2e-checkout'`
- [ ] Contrato publicado lintea limpio:
      `pnpm dlx @stoplight/spectral-cli lint apps/api/docs/api/openapi.yaml --ruleset .spectral.yaml --fail-severity=warn`
- [ ] **Gate de release (manual, no automatizable en repo)**: en staging, un pago con el
      medio simulado de US-009 confirma la orden y decrementa stock de punta a punta, y un
      webhook real de sandbox hace lo mismo. Queda registrado en el PR.

---

## Trazabilidad AC → tasks

| AC de US-010 | Tasks |
|---|---|
| AC-1 aprobado confirma y decrementa | T2.1, T2.2, T2.3, T4.1 |
| AC-2 dispara notificaciones | T1.3, T2.3, T6.5 — entrega `Deferred: US-011` |
| AC-3 rechazado no confirma ni toca stock | T2.3, T4.1 |
| AC-4 aprobado sin stock → reembolso | T0.1, T3.1, T3.2, T3.3 |
| AC-5 duplicado no decrementa dos veces | T2.3, T6.1 |
| AC-6 tardío o fuera de orden | T2.3, T6.1 |
| AC-7 webhook no verificado se rechaza | T1.2, T4.1, T6.3 |
| AC-8 el stock nunca queda negativo | T2.2, T6.2 |
| AC-9 el simulado por el mismo camino | T2.4, T6.4 |
| AC-10 reconciliación | T1.1 (`getPayment`), T5.1, T4.2 |
| AC-11 limpieza de abandonadas | T5.2, T4.2 |
| Declaraciones no-AC del design (F51) | T0.1 (`confirmed_at`/`cancelled_at`), T0.2 (config + secreto), T1.1 (puerto extendido — lo reusa US-013), T4.3 (`no-store`), T7.1/T7.2 (observabilidad + runbook), T8.1/T8.2 (contrato y READMEs) |
