---
parent-us: US-009
discipline: backend
variant: null
language: es
---

# US-009 Backend — Tasks

> Cada task es closure-grade: atómica, con `Exit criterion:` observable y `Verify:` con
> el comando exacto que `/develop-backend` corre. Los comandos asumen la **raíz del
> repo** como cwd. El runner es el de US-001/US-003/US-014:
> `pnpm --filter @dsm/api test -- --testPathPattern=<patrón>` ejecuta Jest en su forma
> **terminante** (no watch — F49); el config de unit (`jest.config.js`,
> `testRegex: src/.*\.spec\.ts$`) incluye también los specs `e2e-*` colocados en `src/`.
> Integration y e2e corren contra el Postgres real de `docker-compose`
> (`ai4devs-finalproject-postgres-1`, host `:55432`), que debe estar arriba.
>
> **Estimación dual**: **12,3 h AI-asistido** / **~24 h tradicional** (28 tasks, suma de
> las fases: 1,5 + 3,0 + 1,5 + 2,0 + 1,5 + 0,6 + 1,2 + 1,0). La US §7 presupuesta
> `BE-US-009` en 10-16 h: el tradicional excede el techo ~8 h por trabajo que la US da por
> resuelto al describirlo como «integración con MercadoPago + medio simulado detrás de
> flag» — la **primera llamada saliente del camino crítico** del proyecto (timeout +
> reintentos + breaker + adaptador falso, ~3,5 h de las cuales la US no presupuesta
> ninguna, porque en `apps/api` hoy no existe un solo control de resiliencia del que
> copiar), y las **dos capas** del flag en vez de un `if` (montaje condicional + fallo de
> arranque). La integración en sí —preferencia, `init_point`, retorno— son ~4 h.

## Pre-requisitos

- [ ] **US-008 backend archivado — BLOQUEANTE DURO.** Este change **lee** `orders` y
  `order_items` y **no** los crea. Necesita, del contrato de US-008:
  (a) tablas `orders` (con `status`, `total_ars_cents`) y `order_items`;
  (b) columna **`orders.access_token_hash`** (SHA-256 de un token opaco de 256 bit,
  patrón ADR-0011);
  (c) que `POST /v1/checkout` devuelva ese token en claro como `order_token` en su 201.
  **OQ-BE-1 está `[Resolved: 2026-08-22 — opción (a)]`**: el Arquitecto/PO ratificó el token
  opaco hasheado, y el plan de `US-008-checkout-guest-backend` lo entrega con esta forma
  exacta (su T0.1 + T2.2). Lo que falta es que **el código exista**.
  **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=order-schema` (el spec
  de esquema de US-008 pasa) **y** `node -e "const s=require('fs').readFileSync('packages/db/prisma/schema.prisma','utf8'); if(!/model Order\b/.test(s)||!/access_token_hash/.test(s)) { console.error('FALTA orders o access_token_hash'); process.exit(1) } console.log('seam US-008 presente')"`

- [ ] **US-007 backend con su módulo de carrito en el working tree.** No hay dependencia
  de código, pero la orden que este change cobra nace de un carrito: sin US-007
  ejecutado no hay forma de armar el dato de prueba end-to-end.
  **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern='cart-schema|e2e-cart'`

- [ ] **`US-010` no está en vuelo sobre `payments/`.** US-010 reemplaza el adaptador
  `NoopPaymentConfirmation` por el real; si las dos sesiones escriben
  `payments/confirmation/` a la vez se pisan (precedente: colisión de US-007).
  **Verify**: `git status --porcelain apps/api/src/payments` vacío antes de empezar.

- [ ] **Postgres local arriba**: `docker compose up -d postgres` (host `:55432`).

- [ ] **Credenciales de sandbox de MercadoPago disponibles en `.env` local**
  (`INFRA-US-009`). Ningún test de este plan las necesita —el adaptador falso cubre
  todo—, pero la verificación manual de la Fase 7 sí.

> **Estado intermedio declarado (F51).** Al cerrar este change, un pago aprobado —real
> o simulado— **no confirma la orden ni decrementa stock**: `NoopPaymentConfirmation`
> registra la invocación y no hace nada. La orden queda en `pending_payment`. Es
> deliberado (ADR-0008 pone esa transacción en US-010) y está anotado en el runbook por
> T7.2. `Deferred: US-010 — owner: BE`.

---

## Fase 0: Esquema y configuración — 1,5 h

- [ ] T0.1 Migración aditiva `payments` (F40 — column-complete)
  - **Pattern**: un `model` nuevo en `packages/db/prisma/schema.prisma` con
    `@id @default(dbgenerated("gen_random_uuid()")) @db.Uuid` y `@@map("payments")`,
    espejando `RefreshToken`; migración generada con `pnpm --filter @dsm/db migrate` y
    los **CHECK** y el **índice único parcial** agregados a mano al `migration.sql`
    generado, igual que `products_stock_check` en `20260715230024_init_catalog`
    (Prisma no declara ni `CHECK` ni índices parciales) — `per
    backend-node-standards.md §5 — migraciones aditivas, nunca destructivas en un solo
    deploy`.
    ```prisma
    model Payment {
      provider         String
      external_id      String?  @unique
      status           String
      amount_ars_cents Int
      idempotency_key  String   @unique
      preference_id    String?  @unique
      init_point       String?
      processed_at     DateTime?
      order            Order    @relation(fields: [order_id], references: [id], onDelete: Restrict)
      @@index([order_id])
      @@index([external_id])
      @@index([status, created_at])
      @@map("payments")
    }
    ```
    ```sql
    -- añadido a mano al migration.sql
    ALTER TABLE "payments" ADD CONSTRAINT "payments_provider_check"
      CHECK ("provider" IN ('mercadopago','simulated_dsm'));
    ALTER TABLE "payments" ADD CONSTRAINT "payments_status_check"
      CHECK ("status" IN ('pending','approved','rejected','refunded'));
    ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_check"
      CHECK ("amount_ars_cents" >= 0);
    CREATE UNIQUE INDEX "payments_one_pending_per_order"
      ON "payments" ("order_id") WHERE "status" = 'pending';
    ```
  - **Exit criterion**: el esquema materializado tiene **exactamente** las 12 columnas
    de `design.md` §Persistencia — `id`, `order_id`, `provider`, `external_id`,
    `status`, `amount_ars_cents`, `idempotency_key`, `preference_id`, `init_point`,
    `processed_at`, `created_at`, `updated_at` — **ni una más** (AC-6: ninguna columna
    capaz de alojar PAN/CVV/titular/token de tarjeta). Índices: `UNIQUE(external_id)`,
    `UNIQUE(idempotency_key)`, `UNIQUE(preference_id)`, `payments(order_id)`,
    `payments(external_id)`, `payments(status, created_at)` y el **único parcial**
    `payments_one_pending_per_order`. Constraints: los tres `CHECK` de arriba. FK
    `payments.order_id → orders` con **RESTRICT**. **Ninguna** tabla existente se
    modifica.
  - **Verify**: `pnpm --filter @dsm/db migrate:deploy && pnpm --filter @dsm/api test -- --testPathPattern=payment-schema`
    (nuevo `src/payments/payment-schema.spec.ts`, espejo de `auth-schema.spec.ts`:
    compara el conjunto **completo** de columnas contra la lista literal —falla si
    falta **o sobra** una—, verifica los 7 índices por nombre en `pg_indexes`
    incluyendo que `payments_one_pending_per_order` tenga `indpred` no nulo, y prueba
    el **comportamiento real**: `INSERT` con `provider='visa'` **falla**;
    `status='weird'` **falla**; `amount_ars_cents=-1` **falla**; dos filas `pending`
    para la misma orden → la segunda **falla**; una `pending` + una `rejected` para la
    misma orden **pasan**; borrar una `order` con pago vivo **falla**)

- [ ] T0.2 Variables de entorno de pagos validadas por Zod, con el flag imposible en producción
  - **Pattern**: extender `envSchema` en `apps/api/src/config/env.validation.ts` y su
    `superRefine`, calcando el mecanismo que US-014 usó para las credenciales de Resend
    — `per backend-node-standards.md §7 — config validada al arranque, fail-fast` y
    `per security-standards.md §5 — secretos desde la plataforma, nunca en el repo`.
    ```ts
    PAYMENTS_SIMULATED_ENABLED: z.enum(['true','false']).default('false'),
    // en el superRefine, junto al bloque de producción:
    if (env.PAYMENTS_SIMULATED_ENABLED === 'true') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['PAYMENTS_SIMULATED_ENABLED'],
        message: 'prohibida en producción: aprueba pagos sin cobrar (E2E §14, ADR-0006)' });
    }
    ```
  - **Exit criterion**: `env.validation.ts` declara, con default seguro:
    `MP_ACCESS_TOKEN` (opcional a nivel de campo, **requerida en producción**),
    `MP_API_BASE_URL` (`https://api.mercadopago.com`), `MP_TIMEOUT_MS` (4000),
    `MP_MAX_RETRIES` (2), `MP_BREAKER_FAILURE_THRESHOLD` (5),
    `MP_BREAKER_OPEN_MS` (30 000), `MP_PREFERENCE_TTL_HOURS` (24 — OQ-BE-5),
    `PAYMENTS_SIMULATED_ENABLED` (**`false`** — el default seguro es el que no
    enciende el peligro por accidente), `PAYMENTS_MAX_ATTEMPTS_PER_ORDER` (5 —
    OQ-BE-2), `PAYMENTS_RATE_LIMIT_TTL_MS` (300 000),
    `PAYMENTS_RATE_LIMIT_MAX` (10), `ORDER_COOKIE_TTL_HOURS` (2 — OQ-BE-3),
    `WEB_PUBLIC_BASE_URL` y `API_PUBLIC_BASE_URL` (URLs, requeridas en producción).
    Con `NODE_ENV=production`, `PAYMENTS_SIMULATED_ENABLED=true` **hace lanzar
    `validateEnv`** (AC-7, capa 1); un valor inválido en cualquiera de las numéricas
    también lanza, nunca cae al default en silencio. La cookie `dsm_order` reusa
    `AUTH_COOKIE_SECURE` (no se agrega una segunda variable para el mismo concepto) y
    queda anotado en el comentario del esquema.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=env.validation`
    (casos nuevos: sin las variables → los 13 defaults **literales**, con
    `expect(env.PAYMENTS_SIMULATED_ENABLED).toBe('false')` y
    `expect(env.MP_PREFERENCE_TTL_HOURS).toBe(24)`; `NODE_ENV=production` +
    `PAYMENTS_SIMULATED_ENABLED=true` → **lanza** y el mensaje nombra la variable;
    `NODE_ENV=production` sin `MP_ACCESS_TOKEN` → lanza; `NODE_ENV=development` +
    `PAYMENTS_SIMULATED_ENABLED=true` → **no** lanza; `MP_TIMEOUT_MS=abc` → lanza;
    `PAYMENTS_MAX_ATTEMPTS_PER_ORDER=0` → lanza; los casos existentes de auth y
    Resend siguen verdes)

---

## Fase 1: Puerto de MercadoPago y resiliencia de la llamada saliente — 3,0 h

- [ ] T1.1 Puerto `MercadoPagoClient` + tipos + adaptador falso
  - **Pattern**: interfaz + token de inyección `Symbol`, para que el servicio dependa
    de la abstracción y los tests no toquen red — `per backend-node-standards.md §3 —
    DI por token; el servicio no conoce la implementación`.
    ```ts
    export const MERCADOPAGO_CLIENT = Symbol('MercadoPagoClient');
    export interface MercadoPagoClient {
      createPreference(input: CreatePreferenceInput): Promise<CreatePreferenceResult>;
    }
    ```
  - **Exit criterion**: `mercadopago/mercadopago.client.ts` declara el puerto y los
    tipos `CreatePreferenceInput` (`externalReference`, `idempotencyKey`, `items[]` con
    `title`/`quantity`/`unitPriceArs`, `backUrls`, `notificationUrl`, `expiresAt`) y
    `CreatePreferenceResult` (`preferenceId`, `initPoint`). **Ningún tipo del puerto
    tiene un campo de tarjeta** (AC-6): la firma hace estructuralmente imposible pasar
    un PAN. `FakeMercadoPagoClient` permite programar respuesta OK, error `4xx`, error
    `5xx` y timeout, y **registra los inputs recibidos** para poder assertar el mapeo.
    El módulo compila sin `any` y sin `@ts-ignore`.
  - **Verify**: `pnpm --filter @dsm/api typecheck && pnpm --filter @dsm/api test -- --testPathPattern=fake-mercadopago`
    (`fake-mercadopago.client.spec.ts`: los 4 modos programables devuelven/lanzan lo
    esperado y el registro de inputs conserva el `idempotencyKey`)

- [ ] T1.2 Circuit breaker mínimo, sin dependencia nueva
  - **Pattern**: máquina de 3 estados con contador de fallos consecutivos y ventana de
    apertura; `half-open` admite **una** sonda — `per backend-node-standards.md §8 —
    circuit-breaking en dependencias críticas`.
    ```ts
    // closed → (n fallos consecutivos) → open → (openMs) → halfOpen → (1 ok) → closed
    ```
  - **Exit criterion**: `mercadopago/circuit-breaker.ts` expone
    `run<T>(fn: () => Promise<T>): Promise<T>` y: cuenta **sólo fallos consecutivos**
    (un éxito resetea el contador a 0); al llegar a `failureThreshold` pasa a `open` y
    **rechaza sin invocar `fn`** con un error propio `CircuitOpenError`; pasados
    `openMs` admite **exactamente una** sonda (`halfOpen`); si la sonda pasa vuelve a
    `closed` con contador en 0, si falla vuelve a `open` reiniciando la ventana. El
    reloj es **inyectable** (`now: () => number`) para que el test no duerma.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=circuit-breaker`
    (`circuit-breaker.spec.ts`: 4 fallos + 1 éxito → sigue `closed` y el contador
    volvió a 0; 5 fallos → la 6ª llamada **no invoca `fn`** —espía con 0 llamadas— y
    lanza `CircuitOpenError`; avanzando el reloj inyectado `openMs` la 7ª **sí**
    invoca `fn` una vez y sólo una; sonda OK → la 8ª también invoca; sonda fallida →
    vuelve a rechazar sin invocar)

- [ ] T1.3 `HttpMercadoPagoClient`: timeout + reintentos con backoff y jitter
  - **Pattern**: `fetch` global de Node 20 con `AbortSignal.timeout` y reintento
    **selectivo** — `per backend-node-standards.md §8 — timeouts + retries con backoff
    en llamadas salientes`. Un `4xx` es determinista: **no** se reintenta.
    ```ts
    const res = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(timeoutMs),
      headers: { Authorization: `Bearer ${token}`, 'X-Idempotency-Key': input.idempotencyKey } });
    ```
  - **Exit criterion**: el adaptador aplica `MP_TIMEOUT_MS` por intento, reintenta
    hasta `MP_MAX_RETRIES` **sólo** ante error de red / abort / `5xx`, con espera
    `250 ms × 2ⁿ ± 50 ms` (dormidor inyectable), y **no** reintenta ante `4xx`. Manda
    `X-Idempotency-Key` con el `idempotency_key` del intento y **el mismo valor en los
    reintentos** (un reintento no puede crear dos preferencias). Convierte los
    `amount_ars_cents` a decimal ARS dividiendo por 100 **sin coma flotante
    acumulada** (`123456` → `1234.56`). Envuelve todo en el breaker de T1.2. Lanza
    `ProviderUnavailableError` (red / `5xx` / `CircuitOpenError`) o
    `ProviderRejectedError` (`4xx`), nunca un error crudo de `fetch`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=http-mercadopago`
    (`http-mercadopago.client.spec.ts` con `fetch` inyectado/espiado: un `500` seguido
    de `200` → **2 llamadas** y resultado OK; tres `500` → `ProviderUnavailableError`
    y **3 llamadas exactas**; un `400` → `ProviderRejectedError` y **1 llamada**;
    `AbortError` en el primer intento → reintenta; el `X-Idempotency-Key` es
    **idéntico** en las 3 llamadas; `unitPriceArs` de un ítem de `123456` centavos es
    exactamente `1234.56`; el `signal` pasado a `fetch` está abortado tras
    `MP_TIMEOUT_MS` con reloj falso)

- [ ] T1.4 El token de MercadoPago no se filtra por ningún canal
  - **Pattern**: el secreto entra **sólo** al header `Authorization` y el cuerpo de
    error del proveedor **no se propaga** al error de dominio — `per
    security-standards.md §5 — secretos fuera de logs` y `per api-standards.md §8.6 —
    prohibido exponer detalles internos en la respuesta de error`.
  - **Exit criterion**: con un `MP_ACCESS_TOKEN` de valor centinela reconocible, el
    valor **no aparece** en: ninguna línea emitida por el logger durante un intento OK
    ni durante los tres modos de fallo, ni en `error.message`, ni en `error.stack`, ni
    en el `detail` del problem+json resultante. El cuerpo de error que devuelve
    MercadoPago (que puede traer identificadores de cuenta) tampoco aparece en la
    respuesta al cliente: se loguea con `trace_id` y se reemplaza por el `detail`
    genérico del catálogo.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=mercadopago-secrecy`
    (nuevo `mercadopago-secrecy.spec.ts`: captura **todas** las llamadas al logger y
    serializa los errores lanzados; asserta
    `expect(JSON.stringify(todo)).not.toContain(TOKEN_CENTINELA)` en los 4 escenarios,
    y `not.toContain('mp-internal-account-id')` sembrado en el cuerpo de error del
    fake)

---

## Fase 2: Persistencia, lectura de la orden y errores de dominio — 1,5 h

- [ ] T2.1 Errores de dominio de pagos
  - **Pattern**: extender `DomainError` en un archivo propio, como `auth-errors.ts`
    hace con los de auth — **no** se toca `common/errors/domain-errors.ts`, cuyos
    `type` llevan el prefijo `dsm:catalog/` — `per backend-node-standards.md §6 —
    errores de dominio mapeados centralmente, no `HttpException` ad-hoc`.
  - **Exit criterion**: `payments/payments-errors.ts` declara
    `OrderNotFoundError` (404, `dsm:payments/order-not-found`),
    `OrderNotPayableError` (409, `dsm:payments/order-not-payable`),
    `AttemptLimitReachedError` (409, `dsm:payments/attempt-limit-reached`),
    `ProviderUnavailableError` (502, `dsm:payments/provider-unavailable`) y
    `ProviderRejectedError` (502, `dsm:payments/provider-rejected`). El
    `HttpProblemFilter` existente los mapea **sin modificarse** (ya despacha por
    `DomainError`), y ningún `detail` incluye el nombre de la clase ni un stack.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern='payments-errors|http-problem-filter'`
    (`payments-errors.spec.ts`: los 5 errores producen el par `status`/`type` esperado
    al pasar por el filtro real, el body es `application/problem+json` y **no**
    contiene `Error:` ni `at ` (stack); los casos existentes del filtro siguen verdes)

- [ ] T2.2 `PaymentsRepository` — único punto de ORM de `payments`
  - **Pattern**: repositorio que envuelve Prisma; el servicio no ve el cliente — `per
    backend-node-standards.md §5 — el repositorio envuelve el ORM`. La violación del
    índice único parcial se traduce a dominio con el helper `common/prisma-errors.ts`
    ya existente (código `P2002`).
  - **Exit criterion**: expone `findPendingByOrder(orderId)`,
    `findLatestByOrder(orderId)` (orden por `created_at DESC`, desempate por `id`),
    `countByOrder(orderId)`, `createPending({orderId, provider, amountArsCents,
    idempotencyKey})`, `attachPreference(id, {preferenceId, initPoint})` y
    `markApproved(id, {processedAt})`. Ningún otro archivo del repo importa
    `PrismaService` para tocar `payments`. Una violación de
    `payments_one_pending_per_order` sale como `ConflictError`-de-pagos, **no** como
    error crudo de Prisma.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=payments.repository`
    (integration contra el Postgres real: `createPending` dos veces para la misma
    orden → la segunda lanza el error de dominio, **no** `PrismaClientKnownRequestError`;
    `findLatestByOrder` con tres intentos devuelve el de `created_at` mayor;
    `countByOrder` no cuenta los de otra orden) **y**
    `rg -l "prisma.payment" apps/api/src --glob '!**/payments.repository.ts' --glob '!**/*.spec.ts'` sin resultados

- [ ] T2.3 `OrdersReadRepository` — resolver la orden por su token opaco
  - **Pattern**: hash del token con SHA-256 y **comparación en tiempo constante**,
    reusando `auth/tokens/opaque-token.ts` (US-014) en vez de duplicar la primitiva —
    `per security-standards.md §6 — validación de entrada` y `per AGENTS.md §1.1 —
    detectar patrones repetidos y reusar`.
    ```ts
    const hash = sha256(token);            // opaque-token.ts
    // búsqueda por hash (indexado) + timingSafeEqual sobre el hash recuperado
    ```
  - **Exit criterion**: expone `findPayableByToken(orderToken)` que devuelve
    `{ id, status, total_ars_cents, items: [{ title, quantity, unit_price_ars_cents }] }`
    o `null`. **Sólo lee**: no hay un solo `update`/`create` sobre `orders` ni
    `order_items` en todo el change (ADR-0008 — la transición la hace US-010). Un token
    con formato inválido, inexistente o de una orden borrada devuelven **`null`
    indistinguible** (AC-9). No expone `buyer_email`/`buyer_name`/`buyer_phone` en el
    tipo de retorno: la PII del comprador no entra al módulo de pagos, así no puede
    llegar a un log por descuido.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=orders-read.repository`
    (integration: token correcto → la orden con sus ítems; token de otra orden →
    `null`; token con un carácter cambiado → `null`; token vacío / no hexadecimal →
    `null` sin lanzar; el objeto devuelto **no** tiene las claves `buyer_email`,
    `buyer_name` ni `buyer_phone`) **y**
    `rg "prisma.order\.(update|create|delete)|prisma.orderItem\.(update|create|delete)" apps/api/src` sin resultados

---

## Fase 3: Caso de uso — 2,0 h

- [ ] T3.1 `PaymentConfirmationPort` + adaptador interino
  - **Pattern**: puerto por token de DI con un adaptador no-op registrado por defecto;
    US-010 registra el real sin tocar este archivo — `per backend-node-standards.md §3`
    y `per base-standards.md §1 — YAGNI: el seam, no la implementación de otra US`.
    ```ts
    export const PAYMENT_CONFIRMATION = Symbol('PaymentConfirmationPort');
    export interface PaymentConfirmationPort {
      confirm(input: { paymentId: string; orderId: string; provider: string }): Promise<void>;
    }
    ```
  - **Exit criterion**: `confirmation/payment-confirmation.port.ts` declara la interfaz
    y el token; `confirmation/noop-payment-confirmation.ts` la implementa registrando
    la invocación por el logger y **no escribiendo nada** en base. El TODO del archivo
    nombra `US-010` como dueño del reemplazo. `PaymentsModule` lo registra con
    `{ provide: PAYMENT_CONFIRMATION, useClass: NoopPaymentConfirmation }`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=noop-payment-confirmation`
    (`noop-payment-confirmation.spec.ts`: `confirm()` resuelve, loguea una línea con
    `payment_id` y `order_id`, y **no** hay una sola escritura en base —espía sobre
    `PrismaService` con 0 llamadas)

- [ ] T3.2 `PaymentsService.createIntent` — camino real
  - **Pattern**: transacción corta para leer-y-asentar, llamada al proveedor **fuera**
    de la transacción, y persistencia del resultado después — `per
    backend-node-standards.md §5 — `$transaction` para el caso de uso multi-escritura`
    y §8 (nunca mantener una transacción abierta esperando a un tercero: bloquearía la
    fila mientras el timeout de 4 s corre).
  - **Exit criterion**: dado un `order_token` válido de una orden `pending_payment`,
    (1) crea la fila `payments(pending)` con `amount_ars_cents` **copiado del total de
    la orden** y un `idempotency_key` UUID nuevo; (2) llama a
    `MercadoPagoClient.createPreference` con `externalReference = order.id`,
    `notificationUrl = ${API_PUBLIC_BASE_URL}/v1/webhooks/mercadopago` (el handler es
    de US-010), las tres `backUrls` derivadas de `WEB_PUBLIC_BASE_URL` y
    `expiresAt = now + MP_PREFERENCE_TTL_HOURS`; (3) guarda `preference_id` e
    `init_point`. Si el proveedor falla, la fila `pending` **queda** (evidencia del
    intento) y el error es `502`. Orden en cualquier estado distinto de
    `pending_payment` → `OrderNotPayableError`; token no resoluble →
    `OrderNotFoundError`. **La orden no se modifica** en ningún camino.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=payments.service`
    (`payments.service.spec.ts` con repos y `FakeMercadoPagoClient`: happy path →
    `init_point` devuelto, `amount_ars_cents === order.total_ars_cents`,
    `externalReference === order.id`, `notificationUrl` y las 3 `backUrls` son las
    esperadas, `expiresAt` a 24 h; orden `new` → `OrderNotPayableError`; token
    desconocido → `OrderNotFoundError`; proveedor `5xx` → `ProviderUnavailableError`
    **y** la fila `pending` sigue existiendo; en los 4 escenarios el espía de
    `OrdersReadRepository` no registra ninguna escritura)

- [ ] T3.3 Reuso del intento vivo y tope de intentos por orden
  - **Pattern**: idempotencia **natural** apoyada en el índice único parcial de T0.1,
    sin máquina de `Idempotency-Key` — `per api-standards.md §10.5` y la deviación
    consciente de §10.1 declarada en `design.md` §Trade-offs.
  - **Exit criterion**: un segundo `createIntent` sobre una orden que ya tiene un
    intento `pending` **no llama al proveedor** y devuelve el `init_point` guardado;
    si ese intento no tiene `init_point` (el intento anterior murió entre el `INSERT` y
    la respuesta del proveedor) se completa la preferencia sobre **la misma fila**, sin
    crear otra. Con `PAYMENTS_MAX_ATTEMPTS_PER_ORDER` intentos ya registrados para la
    orden, el siguiente lanza `AttemptLimitReachedError` (409) **sin** llamar al
    proveedor.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=payments-idempotency`
    (`payments-idempotency.spec.ts`, integration contra Postgres real: dos
    `createIntent` seguidos → **1 sola** fila en `payments`, **1 sola** llamada al
    fake, mismo `init_point` en las dos respuestas; con la fila `pending` sin
    `init_point` → se completa esa fila y el conteo sigue en 1; sembrando 5 intentos
    `rejected` → el 6º lanza `AttemptLimitReachedError` y el fake registra **0**
    llamadas nuevas)

- [ ] T3.4 `PaymentsService.simulateApproval` — el mismo camino que un pago real
  - **Pattern**: reusa `createIntent` hasta el asiento y **salta** al proveedor; cierra
    invocando el **mismo** `PaymentConfirmationPort` que usará el webhook — es lo que
    hace verdadera la promesa de AC-3, y por eso se prueba sobre el puerto, no leyendo
    el código.
  - **Exit criterion**: crea (o reusa) el intento con `provider = 'simulated_dsm'`, lo
    marca `approved` con `processed_at`, y llama **exactamente una vez** a
    `PaymentConfirmationPort.confirm` con `{ paymentId, orderId, provider:
    'simulated_dsm' }`. **No** hay ninguna llamada a `MercadoPagoClient`. **No**
    modifica `orders` ni `products` (eso es US-010). Un intento simulado sobre una
    orden no pagable falla igual que el real (`OrderNotPayableError`).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=payments-simulate.service`
    (`payments-simulate.service.spec.ts`: el espía de `PAYMENT_CONFIRMATION` recibe
    **1** invocación con el payload exacto; el fake de MercadoPago registra **0**
    llamadas; la fila queda `approved` con `processed_at` no nulo; el `stock` del
    producto y el `status` de la orden son **idénticos** antes y después —lectura
    directa a Postgres—; orden `cancelled` → `OrderNotPayableError`)

---

## Fase 4: Superficie HTTP — 1,5 h

- [ ] T4.1 DTOs de entrada y de respuesta
  - **Pattern**: `class-validator` + el `ValidationPipe` global ya configurado
    (`whitelist`, `forbidNonWhitelisted`, 422) — `per backend-node-standards.md §4 —
    DTO validado en el borde, rechazar campos desconocidos`. Respuesta en `snake_case`
    y dinero en centavos — `per api-standards.md §5.2 y §5.5`.
  - **Exit criterion**: `dto/create-payment.dto.ts` declara **sólo**
    `order_token` (string, hex, longitud exacta 64) y `method`
    (`@IsIn(['mercadopago'])` — el simulado **no** es un valor aceptado acá, tiene su
    propia ruta). `dto/payment-status.dto.ts` declara la respuesta de lectura
    (`order_status`, `payment_status`, `payment_method`, `total_ars_cents`,
    `created_at`). Un cuerpo con `method: 'simulated_dsm'` → **422**; con un campo
    extra (`{ ..., amount: 1 }`) → **422**; sin `order_token` → 422. Ningún DTO acepta
    ni devuelve un campo de tarjeta ni de estado provisto por el cliente (AC-8).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-payments-validation`
    (nuevo `e2e-payments-validation.spec.ts` con supertest sobre la app real: los tres
    cuerpos inválidos devuelven **422** con `errors[]` por campo; un cuerpo con
    `payment_status: 'approved'` inyectado devuelve **422** por `forbidNonWhitelisted`
    —el cliente no puede proponer el estado del pago, AC-8)

- [ ] T4.2 `PaymentsController` — `POST /v1/payments` + cookie `dsm_order`
  - **Pattern**: controller delgado que delega en el servicio y emite la cookie con los
    atributos declarados en un solo lugar (`order-cookie.ts`, calcado de
    `auth/cookies.ts`) — `per backend-node-standards.md §2 — controllers delgados` y
    `per security-standards.md §7.4 — cookies Secure; HttpOnly; SameSite=Lax mínimo`.
  - **Exit criterion**: `POST /v1/payments` devuelve **201** con
    `{ payment_status: 'pending', init_point, order_status: 'pending_payment' }` y
    `Set-Cookie: dsm_order` con `HttpOnly`, `SameSite=Lax`, `Path=/`,
    `Max-Age = ORDER_COOKIE_TTL_HOURS × 3600` (**7200** con el default de 2 h) y
    `Secure` según `AUTH_COOKIE_SECURE`. **El `order_token` no aparece en ninguna URL**
    ni en la respuesta; **el `order_id` tampoco** viaja al cliente. `SameSite=Lax` (no
    `Strict`) es deliberado: el retorno desde MercadoPago es una navegación `GET` de
    nivel superior cross-site y con `Strict` la cookie no viajaría y la página de éxito
    quedaría ciega.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-payments-create`
    (`e2e-payments-create.spec.ts`: 201 con el cuerpo exacto; el header `Set-Cookie`
    contiene `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age=7200`; el cuerpo de la
    respuesta **no** contiene el `order_token` enviado ni ningún UUID de orden
    —`expect(JSON.stringify(body)).not.toContain(orderToken)`—; `AUTH_COOKIE_SECURE=false`
    → sin `Secure`, `true` → con `Secure`)

- [ ] T4.3 `GET /v1/payments/latest` — estado autoritativo (AC-8)
  - **Pattern**: la orden se resuelve **sólo** desde la cookie; el endpoint no declara
    ni un parámetro de path ni de query — `per api-standards.md §2.3` (nada que
    enumerar) y AC-8 (la verdad no viene del cliente).
  - **Exit criterion**: con la cookie `dsm_order` válida devuelve **200** con
    `{ order_status, payment_status, payment_method, total_ars_cents, created_at }` del
    **último** intento (OQ-BE-4). Sin cookie, con cookie vencida o con un token que no
    resuelve → **404** `dsm:payments/order-not-found`, los tres **idénticos**. La firma
    del handler **no tiene** parámetros de path ni query: ningún estado propuesto por
    el cliente puede entrar. Una orden sin intentos devuelve 404 (no un 200 con nulos).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-payments-latest`
    (`e2e-payments-latest.spec.ts`: 200 con el cuerpo exacto tras crear el intento;
    los tres escenarios de fallo devuelven **el mismo** `status` + `type` + `detail`
    byte a byte; `GET /v1/payments/latest?order_id=<uuid ajeno>` **sigue** devolviendo
    el estado de la orden de la cookie —el query se ignora, no se honra—; con la fila
    `payments` marcada `approved` a mano en base, la respuesta refleja `approved`
    —prueba que la fuente es la base y no la petición)

- [ ] T4.4 `POST /v1/payments/simulate` con **montaje condicional** (AC-7, capa 2)
  - **Pattern**: el controller entra o no en el array `controllers` del módulo según el
    flag; **no** hay un guard que rechace ni un `if` en el handler. Con el flag apagado
    la ruta **no existe** para el router — `per security-standards.md §2 — el control
    más fuerte es la ausencia de la superficie` y ADR-0006 §Consequences («the flag's
    "off in prod" state must be verified as a release gate»).
    ```ts
    @Module({
      controllers: [
        PaymentsController,
        ...(process.env.PAYMENTS_SIMULATED_ENABLED === 'true' ? [PaymentsSimulateController] : []),
      ],
    })
    ```
  - **Exit criterion**: con `PAYMENTS_SIMULATED_ENABLED=true`,
    `POST /v1/payments/simulate` devuelve **201** con
    `{ payment_status: 'approved', order_status: 'pending_payment' }` (la orden sigue
    pendiente: confirmarla es de US-010) y emite la cookie `dsm_order`. Con el flag en
    `false`, la misma petición devuelve **404** y el cuerpo es el del router de Nest,
    **indistinguible** del de una URL inventada (`POST /v1/payments/inexistente`). No
    existe ningún camino que registre el controller cuando el flag está apagado.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-payments-simulate`
    (`e2e-payments-simulate.spec.ts` levanta la app **dos veces** con el env
    correspondiente: con el flag en `true` → 201 y el cuerpo esperado; con el flag en
    `false` → 404 **y** el cuerpo es byte a byte igual al de
    `POST /v1/payments/inexistente`; además, el `router` de la instancia con flag
    apagado **no lista** la ruta `/v1/payments/simulate`)

- [ ] T4.5 Throttler nombrado `payments` con las cabeceras de §12
  - **Pattern**: cuarto throttler nombrado, espejo exacto de
    `StorefrontThrottlerGuard`; el controller lo scopea con
    `@SkipThrottle({ auth: true, storefront: true, cart: true })` para que sólo cuente
    el suyo — `per security-standards.md §7.3 — rate-limit en escritura pública` y
    `per api-standards.md §12 — cabeceras RateLimit-* y Retry-After`.
  - **Exit criterion**: `payments-throttler.guard.ts` emite `RateLimit-Limit`,
    `RateLimit-Remaining`, `RateLimit-Reset` y `Retry-After` **antes** de lanzar (si no,
    el filtro RFC 7807 reconstruye el body y las pierde). El límite es
    `PAYMENTS_RATE_LIMIT_MAX` (10) por `PAYMENTS_RATE_LIMIT_TTL_MS` (5 min) por IP,
    aplicado a los tres endpoints del módulo. Los throttlers `auth`, `storefront` y
    `cart` **no** cuentan las peticiones de pagos, y agotar el de pagos **no** bloquea
    login ni catálogo.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-payments-ratelimit`
    (`e2e-payments-ratelimit.spec.ts`: la 11ª petición devuelve **429** con las 4
    cabeceras presentes y `Retry-After` numérico > 0; tras agotar el de pagos,
    `POST /v1/auth/login` y `GET /v1/products/:slug` siguen respondiendo **no-429** —
    independencia de cubos, mismo patrón que `e2e-throttler-independence.spec.ts`)

- [ ] T4.6 `Cache-Control: no-store` en toda la superficie `/v1/payments`
  - **Pattern**: extender la condición del middleware de `bootstrap.ts` que hoy sólo
    mira `/v1/admin`. Va en el borde, **antes** del routing, para que cubra también
    404, 422 y 429 — `per security-standards.md §7.1`.
    ```ts
    if (path.startsWith('/v1/admin') || path.startsWith('/v1/payments'))
      res.setHeader('Cache-Control', 'no-store');
    ```
  - **Exit criterion**: **toda** respuesta bajo `/v1/payments` lleva
    `Cache-Control: no-store`, incluidas las de error (404 de token desconocido, 422 de
    validación, 429 de rate-limit) — un CDN compartido no puede servirle a nadie el
    estado de pago de otro. Las respuestas de `/v1/admin` siguen con `no-store` y la
    caché acotada de la ficha pública (`StorefrontCacheInterceptor`, AC-9 de US-003)
    **no** cambia.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern='e2e-payments-cache|e2e-storefront-cache'`
    (nuevo `e2e-payments-cache.spec.ts`: los 5 escenarios —201, 200 de `/latest`, 404,
    422, 429— llevan `no-store`; el spec existente de la caché del storefront corre
    **sin editar**, así que su `max-age` sigue intacto)

---

## Fase 5: Observabilidad — 0,6 h

- [ ] T5.1 `PaymentEventsService`
  - **Pattern (actualizado 2026-08-23 — AUDIT-dsm-api-006)**: el servicio **delega en
    `MetricsService`**, que ya existe en `src/observability/metrics.service.ts` y expone
    el registro por `GET /v1/admin/metrics`. **NO se abre un `Map` privado nuevo**: ese
    era exactamente el patrón que la auditoría encontró repetido cuatro veces, con
    contadores invisibles desde afuera. `MetricsModule` es `@Global`, así que se inyecta
    sin importarlo.
    ```ts
    constructor(@Optional() private readonly metrics?: MetricsService) {}
    // en emit():
    this.metrics?.increment('payments', name);   // → dsm_payments_events_total{event="..."}
    ```
    `@Optional()` sigue el precedente de `CatalogEventsService`: permite construir el
    servicio a mano en los unit tests sin arrastrar el contenedor.
    **Etiqueta única `event`** — ningún id de orden, de pago, de cliente ni el texto de
    una búsqueda entra como dimensión (`observability-standards.md` §9; el spec de
    `metrics.service.ts` tiene un assert que falla si alguien agrega una segunda clave).

  - **Pattern**: calco de `AuthEventsService` — contador **por nombre de evento**
    (nunca una dimensión por orden: 5 000 órdenes serían 5 000 series) y el
    identificador **sólo** en la línea de log — `per observability-standards.md §9` y
    `per observability-patterns §3.3 — cardinalidad de etiquetas`.
  - **Exit criterion**: declara los 8 eventos de `design.md` §Observabilidad
    (`payment.intent_created`, `intent_reused`, `simulated_approved`, `status_read`,
    `provider_error`, `provider_degraded`, `attempt_cap_reached`,
    `order_not_payable`), `emit(name, {orderId, paymentId}, traceId)` y `count(name)`.
    La firma **no acepta** email, nombre ni teléfono, y el módulo **no importa** nada
    de `orders` que los exponga.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=payment-events`
    (`payment-events.spec.ts`: los 8 nombres tipan; `count` incrementa por nombre; **y el valor sale por
    `MetricsService.render()` como `dsm_payments_events_total{event="..."}`** —lo que el
    contador local NO probaba—; la
    línea logueada tiene `order_id`, `payment_id`, `trace_id` y **nada más**
    —comparación de claves exacta)

- [ ] T5.2 Instrumentación de los tres endpoints, sin PII
  - **Exit criterion**: los 8 eventos se emiten en su punto exacto —creación, reuso,
    aprobación simulada, lectura de estado, fallo del proveedor tras reintentos,
    apertura del breaker, tope de intentos y 409 de orden no pagable— y **ninguna**
    línea de log de todo el flujo contiene `buyer_email`, `buyer_name`, `buyer_phone`,
    el `order_token` en claro ni `MP_ACCESS_TOKEN`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-payments-observability`
    (`e2e-payments-observability.spec.ts`: recorre los 8 escenarios contra la app real
    con el logger capturado; asserta `count(evento) === 1` en cada uno **y**
    `expect(JSON.stringify(todasLasLineas)).not.toMatch(/comprador@|\+54 9|<orderToken>|<mpToken>/)`)

---

## Fase 6: Los AC negativos como invariantes probadas — 1,2 h

> Esta fase no agrega comportamiento: **atornilla** las cuatro propiedades que hacen
> que este change sea seguro. AC-6, AC-7, AC-8 y AC-9 son propiedades de seguridad:
> que sean verdaderas hoy no alcanza, tienen que quedar **protegidas** contra la
> próxima edición.

- [ ] T6.1 AC-6 — imposibilidad estructural de custodiar datos de tarjeta
  - **Exit criterion**: un test recorre (a) las columnas reales de `payments` en
    Postgres, (b) los campos de **todos** los DTO del módulo y (c) los tipos del puerto
    `MercadoPagoClient`, y falla si aparece cualquiera de
    `card|pan|cvv|cvc|holder|expiry|exp_month|exp_year|token_tarjeta`. El test es el
    guardián: agregar mañana una columna `card_last4` rompe la suite, no pasa
    inadvertido.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=ac6-no-card-data`
    (`ac6-no-card-data.spec.ts`: consulta `information_schema.columns` para
    `payments`, introspecciona los DTO con `class-validator` metadata y hace el match
    de la lista negra sobre los tres conjuntos; se prueba a sí mismo con un caso
    negativo —una columna sembrada `card_last4` en una tabla temporal **sí** dispara
    el fallo—, para que el test no pueda pasar por no mirar nada)

- [ ] T6.2 AC-7 — el simulado no puede existir en producción, probado por las dos capas
  - **Exit criterion**: dos aserciones independientes: (1) `validateEnv` **lanza** con
    `NODE_ENV=production` + `PAYMENTS_SIMULATED_ENABLED=true` y el mensaje nombra la
    variable; (2) con el flag en `false` la ruta `/v1/payments/simulate` **no está
    registrada** en el router y responde el 404 genérico. Si alguien reemplaza el
    montaje condicional por un `if` en el handler, la aserción (2) falla.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=ac7-simulated-off-in-prod`
    (`ac7-simulated-off-in-prod.spec.ts`: la capa 1 con `expect(() => validateEnv({...}))
    .toThrow(/PAYMENTS_SIMULATED_ENABLED/)`; la capa 2 inspecciona el stack de rutas
    del adaptador Express de la instancia con flag apagado y asserta que **ninguna**
    ruta hace match con `/payments/simulate`)

- [ ] T6.3 AC-4 + AC-8 — ni el stock ni el estado de la orden se mueven acá
  - **Exit criterion**: en un recorrido completo (crear intento → proveedor rechaza →
    reintentar → proveedor aprueba → leer estado; y el equivalente simulado), el
    `products.stock` de cada ítem y el `orders.status` leídos **directamente de
    Postgres** son idénticos al valor inicial. Y: **ninguna** petición HTTP pública
    puede llevar un `payments.status` a `approved` en el camino real — sólo el webhook
    de US-010 (ausente) o la ruta simulada.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=ac4-ac8-invariants`
    (`ac4-ac8-invariants.spec.ts`, integration: snapshot de `stock` y `orders.status`
    antes y después de los dos recorridos, comparación estricta; y un barrido que
    intenta `POST /v1/payments` con `{ payment_status: 'approved' }`,
    `{ status: 'approved' }` y `{ order_status: 'new' }` en el cuerpo → los tres
    **422**, y la fila `payments` sigue `pending`)

- [ ] T6.4 AC-9 — la superficie no enumera órdenes
  - **Exit criterion**: token inexistente, token de otra orden, token con un carácter
    cambiado, token de longitud incorrecta y cookie vencida producen respuestas
    **idénticas** en `status`, `type`, `title` y `detail`, y con latencias del mismo
    orden (la comparación del hash es de tiempo constante). Ningún `order_id` ni
    `payment_id` interno aparece en ninguna respuesta de error.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=ac9-no-enumeration`
    (`ac9-no-enumeration.spec.ts`: los 5 escenarios producen el mismo cuerpo byte a
    byte; la mediana de 20 mediciones por escenario cae dentro de un factor 3 entre el
    caso «existe pero no es tuyo» y «no existe»; ningún cuerpo hace match con un UUID)

---

## Fase 7: Contratos y documentación — 1,0 h

- [ ] T7.1 OpenAPI publicado del servicio actualizado
  - **Pattern**: los tres drafts de `contracts/openapi/` de este change se integran a
    `apps/api/docs/api/openapi.yaml` (la copia publicada del servicio); el contrato
    **vivo** de `openspec/specs/pagos/` lo escribe `/archive-change`, no esta task —
    `per openspec-workflow §Living contract rule` y `per documentation-standards.md
    §11.1`.
  - **Exit criterion**: `apps/api/docs/api/openapi.yaml` declara los tres endpoints con
    sus status (`201`, `200`, `404`, `409`, `422`, `429`, `502`), el envelope
    `application/problem+json` por `$ref` a los `components` ya existentes, las
    cabeceras `RateLimit-*` en el 429 y el `Set-Cookie` del 201. Resuelve y lintea
    limpio con la config de `.spectral.yaml` del repo.
  - **Verify**: `pnpm dlx @stoplight/spectral-cli lint apps/api/docs/api/openapi.yaml --ruleset .spectral.yaml --fail-severity=warn` (termina con exit 0)

- [ ] T7.2 Runbook: degradación del proveedor, el estado intermedio y el gate del flag
  - **Exit criterion**: `docs/services/dsm-ecommerce/runbook.md` gana tres entradas
    accionables: (1) **breaker abierto / MercadoPago caído** — síntoma
    (`payment.provider_degraded`, 502 en `POST /v1/payments`), efecto (nadie puede
    iniciar pagos; las órdenes ya creadas quedan intactas), acción (verificar estado de
    MercadoPago, esperar el half-open, no reintentar a mano); (2) **órdenes en
    `pending_payment` con pago `approved`** — el estado intermedio que este change deja
    hasta US-010, con la aclaración de que **no** es un incidente todavía; (3) **gate
    de release del flag** — cómo verificar que `PAYMENTS_SIMULATED_ENABLED` no está
    encendido en producción (y que si lo estuviera, el servicio **no arranca**), per
    ADR-0006 §Validation criteria.
  - **Verify**: `rg -c "provider_degraded" docs/services/dsm-ecommerce/runbook.md && rg -c "PAYMENTS_SIMULATED_ENABLED" docs/services/dsm-ecommerce/runbook.md && rg -c "pending_payment" docs/services/dsm-ecommerce/runbook.md`
    (los tres > 0) **y** revisión humana de que cada entrada nombra síntoma + efecto +
    acción (el grep prueba presencia, no utilidad — la utilidad la firma quien revisa
    el PR)

- [ ] T7.3 README del módulo de pagos
  - **Exit criterion**: `apps/api/src/payments/README.md` explica en ≤ 40 líneas: los
    tres endpoints y quién los usa, por qué el `order_token` va en el cuerpo y no en la
    URL, las dos capas del flag del simulado, los números de resiliencia (4 s / 2
    reintentos / breaker 5-30 s) y **qué NO hace este módulo** (no confirma, no toca
    stock, no reembolsa — con el puntero a US-010/US-013).
  - **Verify**: `test -f apps/api/src/payments/README.md && rg -q "order_token" apps/api/src/payments/README.md && rg -q "US-010" apps/api/src/payments/README.md && test $(wc -l < apps/api/src/payments/README.md) -le 40`

---

## Verification (suite-level)

- [ ] Type-check limpio: `pnpm --filter @dsm/api typecheck`
- [ ] Lint limpio: `pnpm --filter @dsm/api lint`
- [ ] Esquema aplicado desde cero en base limpia: `pnpm --filter @dsm/db migrate:deploy`
- [ ] Suite completa de la API verde (unit + integration + e2e-nest, forma terminante):
      `pnpm --filter @dsm/api test -- --ci`
- [ ] Suite del módulo de pagos verde en aislamiento:
      `pnpm --filter @dsm/api test -- --ci --testPathPattern=payments`
- [ ] **Sin regresión** en las superficies existentes:
      `pnpm --filter @dsm/api test -- --ci --testPathPattern='e2e-auth|e2e-storefront|e2e-products|e2e-categories|e2e-security-edge'`
- [ ] Contrato publicado lintea limpio:
      `pnpm dlx @stoplight/spectral-cli lint apps/api/docs/api/openapi.yaml --ruleset .spectral.yaml --fail-severity=warn`
- [ ] Verificación manual contra el **sandbox** de MercadoPago (no automatizable: la
      URL hosted es de un tercero): con `MP_ACCESS_TOKEN` de sandbox, `POST /v1/payments`
      devuelve un `init_point` que **abre** el checkout de MercadoPago en el navegador y
      cuyo `external_reference` coincide con el `order_id`. Queda registrado en el PR con
      captura. Es el único punto de este plan que no se puede probar en el repo.

---

## Trazabilidad AC → tasks

| AC de US-009 | Tasks |
|---|---|
| AC-1 iniciar el pago real | T0.1, T1.1, T1.3, T3.2, T4.1, T4.2, T7.1 |
| AC-2 retorno tras pagar | T4.3, T7.1 |
| AC-3 medio simulado DSM | T3.1, T3.4, T4.4 |
| AC-4 pago rechazado / cancelado | T3.2, T4.3, T6.3 |
| AC-5 pago pendiente | T4.3, T6.3 |
| AC-6 no se almacenan datos de tarjeta | T0.1, T1.1, T4.1, T6.1 |
| AC-7 simulado off en producción | T0.2, T4.4, T6.2 |
| AC-8 no se confía en la URL de retorno | T4.1, T4.3, T6.3 |
| AC-9 el intento es trazable a su orden | T2.3, T4.2, T6.4 |
| Declaraciones no-AC del design (F51) | T0.2 (config), T1.2/T1.4 (resiliencia y secreto), T2.1/T2.2 (capas), T4.5 (rate-limit), T4.6 (`no-store`), T5.1/T5.2 (observabilidad), T7.1/T7.2/T7.3 (docs) |
