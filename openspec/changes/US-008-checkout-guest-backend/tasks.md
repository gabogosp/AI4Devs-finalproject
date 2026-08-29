---
parent-us: US-008
discipline: backend
variant: null
language: es
---

# US-008 Backend — Tasks

> Cada task es closure-grade: atómica, con `Exit criterion:` observable y `Verify:` con
> el comando exacto que `/develop-backend` corre. Los comandos asumen la **raíz del
> repo** como cwd. El runner es el de US-001/US-003/US-007/US-014:
> `pnpm --filter @dsm/api test -- --testPathPattern=<patrón>` ejecuta Jest en su forma
> **terminante** (no watch — F49); el config de unit (`jest.config.js`,
> `testRegex: src/.*\.spec\.ts$`) incluye también los specs `e2e-*` colocados en `src/`.
> Integration y e2e corren contra el Postgres real de `docker-compose`
> (`ai4devs-finalproject-postgres-1`, host `:55432`), que debe estar arriba.
>
> **Estimación dual**: **9,0 h AI-asistido** / **~18 h tradicional** (20 tasks, suma de
> las fases: 2,2 + 1,4 + 1,8 + 1,2 + 0,8 + 1,0 + 0,6). La US §7 presupuesta `BE-US-008`
> en 6-10 h: el tradicional excede el techo ~8 h por trabajo que la US da por resuelto al
> describirlo como «endpoint de checkout que crea la orden» —
> (a) el esquema son **dos tablas con 9 constraints y 5 deviaciones declaradas del DER**,
> tres de ellas por exigencia de AC-8 (el DER modela el consentimiento como un booleano y
> el AC pide marca temporal y trazabilidad legal); (b) es la **primera PII en reposo** del
> proyecto, lo que convierte §9 de `observability-standards` en una fase propia con su
> guardián automático en vez de una nota; (c) el seam con el carrito exige tocar el
> wiring de `CartModule`, que hoy no exporta lo que el checkout necesita. El caso de uso
> en sí —validar, snapshotear, insertar— son ~4 h.
>
> **Este plan resuelve OQ-BE-1 del change de US-009** (`orders.access_token_hash` + el
> `order_token` en el 201). Al cerrar T0.1 + T2.3, `US-009-pago-mercadopago-backend`
> queda desbloqueado.

## Pre-requisitos

- [ ] **US-007 backend con sus tasks cerradas y `apps/api/src/cart/` limpio.** Este
  change **reusa** `CartTokenService`, `CartsRepository` y `buildCartView`, y T1.3
  **modifica** `cart.module.ts`. Con tasks de US-007 abiertas sobre esos archivos se
  pisan (precedente: la colisión de sesiones de US-007).
  **Verify**: `git status --porcelain apps/api/src/cart` vacío **y**
  `pnpm --filter @dsm/api test -- --testPathPattern='cart-schema|cart-view|cart-token|e2e-cart'`

- [ ] **`ProductsRepository` sigue siendo el único punto de ORM de `products`.** El
  checkout lee precio, stock y estado por ahí, no con un `prisma.product` propio (§5).
  **Verify**: `rg -l "prisma\.product\b" apps/api/src --glob '!**/products.repository.ts' --glob '!**/*.spec.ts'` sin resultados

- [ ] **`US-009` no está en vuelo sobre el esquema.** El change de pagos agrega
  `payments` con una FK a `orders`; si las dos migraciones se generan a la vez, la
  historia de Prisma queda desordenada. **US-008 va primero**, siempre.
  **Verify**: `ls packages/db/prisma/migrations | grep -c payment` devuelve `0`

- [ ] **Postgres local arriba**: `docker compose up -d postgres` (host `:55432`).

> **Estado intermedio declarado (F51).** Al cerrar este change, una orden creada **no
> lleva a ninguna parte**: no hay pago (US-009), no se confirma (US-010), no se notifica
> (US-011) y no aparece en el panel del dueño (US-012, y a propósito: `pending_payment`
> es invisible para él). El entregable es la orden más el `order_token` que US-009
> consume. Es deliberado y es el orden del build-order (`docs/delivery/build-order.md`,
> camino crítico US-007 → US-008 → US-009 → US-010).

---

## Fase 0: Esquema y configuración — 2,2 h

- [x] T0.1 Migración aditiva `orders` + `order_items` (F40 — column-complete)
  - **Pattern**: dos `model` nuevos en `packages/db/prisma/schema.prisma` con
    `@id @default(dbgenerated("gen_random_uuid()")) @db.Uuid` y `@@map("…")`, espejando
    `Cart`/`CartItem`; migración generada con `pnpm --filter @dsm/db migrate` y los
    **CHECK** agregados a mano al `migration.sql` generado, igual que
    `products_stock_check` en `20260715230024_init_catalog` y que los dos `CHECK` de
    `cart_items` (Prisma no los declara) — `per backend-node-standards.md §5 —
    migraciones aditivas, nunca destructivas en un solo deploy`.
    ```prisma
    model Order {
      order_number          Int      @unique @default(dbgenerated("nextval('orders_order_number_seq')"))
      access_token_hash     String   @unique
      customer_id           String?  @db.Uuid
      customer              Customer? @relation(fields: [customer_id], references: [id], onDelete: SetNull)
      status                String   @default("pending_payment")
      fulfillment           String   @default("pickup")
      total_ars_cents       Int
      consent_accepted      Boolean
      consent_accepted_at   DateTime
      consent_terms_version String
      delivered_at          DateTime?
      items                 OrderItem[]
      @@index([status, created_at])
      @@map("orders")
    }
    ```
    ```sql
    -- añadido a mano al migration.sql, ANTES del CREATE TABLE de orders
    -- Arranca en 1000: un «Pedido #3» le informa al comprador que la tienda vendió dos
    -- veces en su vida (PRD §1.3 — las señales de confianza son conversión).
    CREATE SEQUENCE "orders_order_number_seq" START WITH 1000;

    -- y después del CREATE TABLE:
    ALTER TABLE "orders" ADD CONSTRAINT "orders_status_check" CHECK ("status" IN
      ('pending_payment','new','preparing','ready','delivered','cancelled'));
    ALTER TABLE "orders" ADD CONSTRAINT "orders_fulfillment_check" CHECK ("fulfillment" IN ('pickup'));
    ALTER TABLE "orders" ADD CONSTRAINT "orders_total_check" CHECK ("total_ars_cents" >= 0);
    ALTER TABLE "orders" ADD CONSTRAINT "orders_consent_check" CHECK ("consent_accepted" = true);
    ALTER TABLE "order_items" ADD CONSTRAINT "order_items_quantity_check" CHECK ("quantity" >= 1);
    ALTER TABLE "order_items" ADD CONSTRAINT "order_items_price_check" CHECK ("unit_price_ars_cents" >= 0);
    ```
  - **Exit criterion**: el esquema materializado tiene **exactamente** las columnas de
    `design.md` §Persistencia — `orders`: `id`, `order_number`, `access_token_hash`,
    `customer_id`, `buyer_name`, `buyer_email`, `buyer_phone`, `fulfillment`, `status`,
    `total_ars_cents`, `consent_accepted`, `consent_accepted_at`,
    `consent_terms_version`, `created_at`, `updated_at`, `delivered_at` (**16**);
    `order_items`: `id`, `order_id`, `product_id`, `quantity`, `unit_price_ars_cents`,
    `product_name`, `product_sku`, `created_at` (**8**). Ni una más (AC-7). Índices:
    `UNIQUE(orders.access_token_hash)`, `UNIQUE(orders.order_number)`,
    `orders(status, created_at)`, `orders(customer_id)`, `order_items(order_id)`,
    `UNIQUE(order_items.order_id, product_id)`. Los **6 `CHECK`** de arriba. La
    **`SEQUENCE`** `orders_order_number_seq` existe y su `start_value` es **1000**. FKs con
    la regla exacta: `orders.customer_id → customers` **SET NULL**,
    `order_items.order_id → orders` **CASCADE**, `order_items.product_id → products`
    **RESTRICT**. **Ninguna** tabla existente se modifica.
  - **Verify**: `pnpm --filter @dsm/db migrate:deploy && pnpm --filter @dsm/api test -- --testPathPattern=order-schema`
    (nuevo `src/checkout/order-schema.spec.ts`, espejo de `cart-schema.spec.ts`: compara
    el conjunto **completo** de columnas por tabla contra la lista literal —falla si
    falta **o sobra** una—, verifica los 6 índices por nombre en `pg_indexes`, y prueba
    el **comportamiento real**: `INSERT` con `status='weird'` **falla**;
    `fulfillment='delivery'` **falla**; `consent_accepted=false` **falla**;
    `total_ars_cents=-1` **falla**; `quantity=0` **falla**; dos líneas del mismo producto
    en la misma orden → la segunda **falla**; **dos órdenes consecutivas reciben
    `order_number` 1000 y 1001** —leído de la base, no del código— y un `INSERT` que
    repita un `order_number` **falla**; borrar una `order` borra sus `order_items`;
    borrar un `product` con línea vendida **falla**; borrar un `customer` deja
    `orders.customer_id` en `NULL` **sin borrar la orden**)

- [x] T0.2 Variables de entorno del checkout validadas por Zod
  - **Pattern**: extender `envSchema` en `apps/api/src/config/env.validation.ts` —
    `per backend-node-standards.md §7 — config validada al arranque, fail-fast`.
  - **Exit criterion**: `env.validation.ts` declara con default seguro
    `CHECKOUT_RATE_LIMIT_TTL_MS` (600 000), `CHECKOUT_RATE_LIMIT_MAX` (10) y
    `LEGAL_TERMS_VERSION` (string no vacío, default `'2026-06-15'`). Un valor inválido
    (`CHECKOUT_RATE_LIMIT_MAX=-1`, `LEGAL_TERMS_VERSION=''`) hace **fallar el arranque**,
    no cae al default en silencio. No se agrega ningún secreto.
  - ⚠ **`LEGAL_TERMS_VERSION` es un contrato con el frontend, ya verificado y ya rojo si se
    rompe** (OQ-FE-18 resuelta 2026-08-23: `BE-US-017` quedó absorbida por esta US, así que el
    versionado de los términos es responsabilidad de acá). El default **debe** coincidir con
    `LEGAL_TERMS_VERSION` de `apps/web/src/features/legal/content.ts` —hoy `'2026-06-15'`— y
    `apps/web/src/features/legal/versionContract.test.ts` (US-017 T4.3) lo verifica **en cada
    CI**, leyendo el `.env.example` de la raíz y, en cuanto exista, el default de este mismo
    `env.validation.ts`. Si divergen, la orden afirmaría que la persona aceptó una versión que
    el sitio nunca publicó: un registro que contradice la evidencia, peor que no tenerlo.
    Cambiar la versión es un cambio en **los dos lados a la vez**.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=env.validation`
    (casos nuevos: sin las variables → los 3 defaults **literales**, con
    `expect(env.CHECKOUT_RATE_LIMIT_MAX).toBe(10)`; `CHECKOUT_RATE_LIMIT_MAX=-1` →
    lanza; `CHECKOUT_RATE_LIMIT_TTL_MS=abc` → lanza; `LEGAL_TERMS_VERSION=''` → lanza;
    los casos existentes de auth, carrito y Resend siguen verdes)

---

## Fase 1: Errores, persistencia y el seam con el carrito — 1,4 h

- [ ] T1.1 Errores de dominio del checkout
  - **Pattern**: extender `DomainError` en un archivo propio, como `auth-errors.ts` —
    **no** se toca `common/errors/domain-errors.ts`, cuyos `type` llevan el prefijo
    `dsm:catalog/` — `per backend-node-standards.md §6 — errores de dominio mapeados
    centralmente, no `HttpException` ad-hoc`.
  - **Exit criterion**: `checkout/checkout-errors.ts` declara `CartEmptyError` (409,
    `dsm:checkout/cart-empty`) y `CartNotPurchasableError` (409,
    `dsm:checkout/cart-not-purchasable`, que **acepta `fieldErrors`** para llevar el
    slug + motivo de cada línea que molesta). El `HttpProblemFilter` existente los mapea
    **sin modificarse**, y ningún `detail` incluye el nombre de la clase ni un stack.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern='checkout-errors|http-problem-filter'`
    (`checkout-errors.spec.ts`: los 2 errores producen el par `status`/`type` esperado al
    pasar por el filtro real, el body es `application/problem+json`, el de
    `cart-not-purchasable` trae `errors[]` con `field` = slug, y ninguno contiene
    `Error:` ni `at ` (stack); los casos existentes del filtro siguen verdes)

- [ ] T1.2 `OrdersRepository` — único punto de ORM de `orders` + `order_items`
  - **Pattern**: repositorio que envuelve Prisma y expone la creación como **una
    transacción**; el service no ve el cliente — `per backend-node-standards.md §5 — el
    repositorio envuelve el ORM; `$transaction` para el caso de uso multi-escritura`.
    ```ts
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.create({ data: { …, items: { create: lineas } }, include: { items: true } });
      return order;
    });
    ```
  - **Exit criterion**: expone `createPendingOrder(data)` —que inserta la orden **y sus
    líneas en una sola transacción**, devolviendo la orden con sus ítems— y
    `findByTokenHash(hash)` (que US-009 no usa: consume el suyo). **Ningún otro archivo
    del repo** importa `PrismaService` para tocar `orders`/`order_items`. Un fallo en
    cualquier línea deja **cero filas**: no hay órdenes sin ítems. Los errores crudos de
    Prisma se traducen con el helper `common/prisma-errors.ts` existente.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=orders.repository`
    (integration contra el Postgres real: `createPendingOrder` con 3 líneas → 1 orden +
    3 `order_items`; con una línea de `product_id` inexistente → **0 órdenes** y **0
    líneas** en base tras el fallo —prueba la atomicidad, no sólo que lance—;
    `findByTokenHash` con hash correcto/incorrecto) **y**
    `rg -l "prisma\.order\b|prisma\.orderItem\b" apps/api/src --glob '!**/orders.repository.ts' --glob '!**/*.spec.ts'` sin resultados

- [ ] T1.3 `CartModule` exporta lo que el checkout consume (cambio de wiring, sin cambio de comportamiento)
  - **Pattern**: agregar `CartTokenService` y `CartsRepository` al array `exports` de
    `cart.module.ts` (hoy exporta sólo `CartEventsService`). **No** se duplica la
    resolución del carrito ni se abre un segundo acceso al ORM de `carts` — `per
    backend-node-standards.md §5` y `per AGENTS.md §1.1 — detectar patrones repetidos y
    reusar`.
  - **Exit criterion**: `CheckoutModule` puede inyectar `CartTokenService` y
    `CartsRepository` importando `CartModule`, y **no existe** en `checkout/` ningún
    acceso a `prisma.cart`/`prisma.cartItem` ni una segunda implementación de la
    resolución del carrito por cookie. **El comportamiento del carrito no cambia**: si
    algún spec de US-007 hay que editar, el cambio no fue de wiring y está mal.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern='e2e-cart|cart.service|carts.repository'`
    (los specs existentes de US-007 corren **sin editar**) **y**
    `rg -l "prisma\.cart" apps/api/src/checkout` sin resultados **y**
    `pnpm --filter @dsm/api typecheck`

---

## Fase 2: Caso de uso — 1,8 h

- [ ] T2.1 `order-draft.ts` — snapshot y total como función **pura**
  - **Pattern**: función pura sin tipos de framework ni acceso a base, igual que
    `cart-view.ts` de US-007, para poder ejercer las reglas que tienen dinero adentro sin
    HTTP ni Postgres — `per backend-node-standards.md §2 — la lógica de dominio no
    depende del framework`.
    ```ts
    export function buildOrderDraft(view: CartView, buyer: BuyerData, terms: string):
      { lines: OrderLineDraft[]; totalArsCents: number }
    ```
  - **Exit criterion**: dada una `CartView` **comprable**, devuelve una línea por ítem
    con `product_id`, `quantity`, `unit_price_ars_cents` (el **vigente** que la vista
    trae), `product_name` y `product_sku`, más el `totalArsCents` = suma de
    `quantity × unit_price_ars_cents` **de las líneas del draft** (no copiado del
    `total_ars_cents` de la vista: la orden queda aritméticamente cerrada sobre sus
    propias líneas). Si la vista está vacía o tiene `has_blocking_issues`, **lanza** — la
    función no produce drafts incomprables ni siquiera si el llamador se olvida de
    validar.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=order-draft`
    (`order-draft.spec.ts`: 3 líneas → total = suma exacta de subtotales; el total del
    draft coincide con el de la vista cuando todo está `available`; una vista con
    `has_blocking_issues: true` **lanza**; una vista vacía **lanza**; el snapshot copia
    `unit_price_ars_cents` de la vista y **no** el `previous_unit_price_ars_cents`
    —caso con `price_changed: true`, que es donde un error de copiado costaría plata)

- [ ] T2.2 `OrderTokenService` — identidad opaca de la orden (**resuelve OQ-BE-1 de US-009**)
  - **Pattern**: reusar `newToken` / `hashToken` de `auth/tokens/opaque-token.ts` (256
    bits de CSPRNG, SHA-256 en reposo) en vez de duplicar la primitiva — tercera vez que
    el proyecto necesita lo mismo (refresh de ADR-0011, carrito de US-007, ahora la
    orden) — `per security-standards.md §3.7` y `per AGENTS.md §1.1`.
  - **Exit criterion**: expone `issue(): { token, tokenHash }`. El claro **no se
    persiste** en ninguna columna ni se loguea; el hash es lo único que va a
    `orders.access_token_hash`. El `order_id` UUID **no** forma parte del token (no se
    puede derivar uno del otro). El formato del claro es hex de 64 caracteres — el mismo
    que el `pattern` que el contrato de US-009 declara para `order_token`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=order-token`
    (`order-token.service.spec.ts`: 1 000 emisiones → 1 000 claros distintos y 1 000
    hashes distintos; el claro matchea `/^[0-9a-f]{64}$/` —el mismo `pattern` del
    contrato de US-009—; `hashToken(token)` reproduce el hash emitido; el claro **no**
    aparece en el objeto devuelto por ninguna otra vía)

- [ ] T2.3 `CheckoutService.createOrder` — el caso de uso transaccional
  - **Pattern**: resolver el carrito, leer los productos **vigentes**, construir la
    vista, validar, snapshotear e insertar — todo dentro de la transacción, de modo que
    el precio guardado sea el que la transacción leyó — `per backend-node-standards.md §5`
    y AC-2 («precio unitario al momento de la compra»).
  - **Exit criterion**: con un carrito comprable y datos válidos, crea la orden en
    `pending_payment` con `total_ars_cents` del draft, sus `order_items`,
    `consent_accepted = true`, `consent_accepted_at = now()`,
    `consent_terms_version = LEGAL_TERMS_VERSION`, `fulfillment = 'pickup'`,
    `access_token_hash` de T2.2, y el email **normalizado** con `normalizeEmail` de
    US-014. Devuelve el `order_token` en claro **una sola vez** más el `order_number` que
    asignó la `SEQUENCE`. Carrito ausente / vencido / vacío → `CartEmptyError`; carrito con
    `has_blocking_issues` → `CartNotPurchasableError` con una entrada por línea (slug +
    motivo). **Ninguna escritura sobre `products` ni sobre `carts`/`cart_items`** en ningún
    camino.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=checkout.service`
    (`checkout.service.spec.ts`, integration contra Postgres real: happy path → orden
    `pending_payment` con el total y las líneas esperadas y el email en minúsculas;
    carrito sin cookie → `CartEmptyError`; carrito con una línea `insufficient_stock` →
    `CartNotPurchasableError` cuyo `fieldErrors` nombra **ese** slug; carrito con un
    producto despublicado → idem; en los 4 escenarios el `stock` de los productos y las
    filas de `cart_items` leídos **directamente de Postgres** son idénticos antes y
    después)

---

## Fase 3: Superficie HTTP — 1,2 h

- [ ] T3.1 DTOs de entrada y de respuesta
  - **Pattern**: `class-validator` + el `ValidationPipe` global ya configurado
    (`whitelist`, `forbidNonWhitelisted`, 422) — `per backend-node-standards.md §4 — DTO
    validado en el borde, rechazar campos desconocidos`. Respuesta en `snake_case` y
    dinero en centavos — `per api-standards.md §5.2 y §5.5`.
    ```ts
    class BuyerDto { @IsString() @Length(2,120) name!: string;
                     @IsEmail() email!: string;
                     @Matches(/^\+?[0-9 ()-]{8,20}$/) phone!: string; }
    class CreateCheckoutDto { @ValidateNested() @Type(() => BuyerDto) buyer!: BuyerDto;
                              @Equals(true) consent!: boolean;
                              @IsIn(['pickup']) fulfillment!: 'pickup'; }
    ```
  - **Exit criterion**: el cuerpo acepta **sólo** `buyer{name,email,phone}`, `consent` y
    `fulfillment`. `consent: false` o ausente → **422** (AC-4). Email malformado → 422
    con `errors[]` que nombra el campo (AC-3). Teléfono ausente → 422 (OQ-BE-2).
    **Cualquier** campo extra → 422; en particular `total_ars_cents`, `items`, `cart_id`
    o `status` inyectados en el cuerpo son rechazados: el total y las líneas salen del
    carrito y del catálogo, nunca del cliente. La respuesta declara `order_token`,
    `order_number`, `status`, `total_ars_cents` e `items_count` — y **no** el `order_id` UUID.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-checkout-validation`
    (`e2e-checkout-validation.spec.ts` con supertest sobre la app real: `consent:false`,
    `consent` ausente, email inválido, nombre de 1 carácter y teléfono ausente → **422**
    con `errors[]` por campo; los cuerpos con `total_ars_cents: 1`, `items: []`,
    `cart_id: '…'`, `status: 'new'` y **`order_number: 1`** → **422** por
    `forbidNonWhitelisted` —el cliente no elige el número de pedido—; el 201 trae
    `order_number` entero **≥ 1000** y no contiene ningún UUID
    —`expect(JSON.stringify(body)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/)`)

- [ ] T3.2 `CheckoutController` con CSRF y throttler propio
  - **Pattern**: controller fino que delega; **reusa `CartCsrfGuard`** porque acá la
    escritura se autoriza con la cookie `dsm_cart`, que es credencial **ambiente** —
    `per security-standards.md §7.5 — CSRF obligatorio en toda escritura autenticada por
    cookie` (la diferencia con `POST /v1/payments` de US-009, que se autoriza con un
    token en el cuerpo y por eso no lleva guard, está razonada en el `design.md` de ese
    change). Throttler nombrado propio, espejo de `CartThrottlerGuard`, con
    `@SkipThrottle` cruzado — `per api-standards.md §12`.
  - **Exit criterion**: `POST /v1/checkout` devuelve **201** con el cuerpo de T3.1.
    Sin `X-CSRF-Token` (habiendo cookie `dsm_cart`) → **403**; con `Origin` fuera de la
    allowlist → 403. `checkout-throttler.guard.ts` emite `RateLimit-Limit`,
    `RateLimit-Remaining`, `RateLimit-Reset` y `Retry-After` **antes** de lanzar (si no,
    el filtro RFC 7807 reconstruye el body y las pierde); el límite es
    `CHECKOUT_RATE_LIMIT_MAX` (10) por `CHECKOUT_RATE_LIMIT_TTL_MS` (10 min) por IP.
    Agotar el cubo del checkout **no** bloquea login, catálogo ni carrito.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern='e2e-checkout-security|e2e-checkout-ratelimit'`
    (`e2e-checkout-security.spec.ts`: 201 con CSRF válido; 403 sin header; 403 con
    `Origin` ajeno; 403 con `X-CSRF-Token` de **otro** carrito.
    `e2e-checkout-ratelimit.spec.ts`: la 11ª petición → **429** con las 4 cabeceras y
    `Retry-After` numérico > 0; tras agotarlo, `POST /v1/auth/login`, `GET /v1/cart` y
    `GET /v1/products/:slug` siguen respondiendo **no-429**)

- [ ] T3.3 `Cache-Control: no-store` en toda la superficie `/v1/checkout`
  - **Pattern**: extender la condición del middleware de `bootstrap.ts` que hoy mira
    `/v1/admin` (y `/v1/cart` desde US-007). Va en el borde, **antes** del routing, para
    que cubra también 403, 409, 422 y 429 — `per security-standards.md §7.1`.
  - **Exit criterion**: **toda** respuesta bajo `/v1/checkout` lleva
    `Cache-Control: no-store`, incluidas las de error — la respuesta contiene un token de
    acceso a la orden y el total de una compra, y un CDN compartido no puede servírsela a
    nadie más. Las superficies existentes no cambian: `/v1/admin` sigue con `no-store` y
    la caché acotada de la ficha pública (`StorefrontCacheInterceptor`) sigue intacta.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern='e2e-checkout-cache|e2e-storefront-cache'`
    (nuevo `e2e-checkout-cache.spec.ts`: los 5 escenarios —201, 403, 409, 422, 429—
    llevan `no-store`; el spec existente de la caché del storefront corre **sin editar**,
    así que su `max-age` sigue intacto)

---

## Fase 4: Observabilidad y PII — 0,8 h

- [ ] T4.1 `CheckoutEventsService`
  - **Pattern (actualizado 2026-08-23 — AUDIT-dsm-api-006)**: el servicio **delega en
    `MetricsService`**, que ya existe en `src/observability/metrics.service.ts` y expone
    el registro por `GET /v1/admin/metrics`. **NO se abre un `Map` privado nuevo**: ese
    era exactamente el patrón que la auditoría encontró repetido cuatro veces, con
    contadores invisibles desde afuera. `MetricsModule` es `@Global`, así que se inyecta
    sin importarlo.
    ```ts
    constructor(@Optional() private readonly metrics?: MetricsService) {}
    // en emit():
    this.metrics?.increment('checkout', name);   // → dsm_checkout_events_total{event="..."}
    ```
    `@Optional()` sigue el precedente de `CatalogEventsService`: permite construir el
    servicio a mano en los unit tests sin arrastrar el contenedor.
    **Etiqueta única `event`** — ningún id de orden, de pago, de cliente ni el texto de
    una búsqueda entra como dimensión (`observability-standards.md` §9; el spec de
    `metrics.service.ts` tiene un assert que falla si alguien agrega una segunda clave).

  - **Pattern**: calco de `CartEventsService` / `AuthEventsService` — contador **por
    nombre de evento** (nunca una dimensión por orden ni por email: haría explotar la
    cardinalidad) y el identificador **sólo** en la línea de log — `per
    observability-standards.md §9`.
  - **Exit criterion**: declara los 5 eventos de `design.md` §Observabilidad
    (`checkout.order_created`, `rejected_empty_cart`, `rejected_blocking_issues`,
    `rejected_consent`, `checkout.validation_failed`), `emit(name, orderId, traceId)` y
    `count(name)`. **La firma acepta `orderId | null` y nada más**: no hay parámetro por
    el que pueda entrar un email, un nombre o un teléfono, **ni hasheados** (un hash de
    email es reversible por diccionario, así que sigue siendo el dato con un paso extra —
    la misma nota que `AuthEventsService` dejó escrita).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=checkout-events`
    (`checkout-events.spec.ts`: los 5 nombres tipan; `count` incrementa por nombre; **y el valor sale por
    `MetricsService.render()` como `dsm_checkout_events_total{event="..."}`** —lo que el
    contador local NO probaba—; la
    línea logueada tiene **exactamente** las claves `event`, `entity_id`, `trace_id`
    —comparación de conjunto de claves, falla si aparece una sexta)

- [ ] T4.2 La PII del comprador no sale por ningún canal
  - **Pattern**: la PII vive en las columnas de `orders` y en el DTO de entrada, y en
    ningún otro lado. Los errores de validación nombran el **campo**, nunca el **valor**
    — `per observability-standards.md §9 — redacción de PII en logs` y `per
    api-standards.md §8.6`.
  - **Exit criterion**: con valores centinela sembrados (`Comprador Centinela`,
    `centinela@ejemplo.test`, `+54 9 11 0000 0001`), ninguno aparece en: ninguna línea
    emitida por el logger durante un checkout exitoso ni durante los 4 caminos de rechazo,
    ni en el cuerpo de ninguna respuesta de error, ni en `error.message`/`error.stack`. El
    `order_token` en claro tampoco aparece en ningún log (sí en el cuerpo del 201, que es
    su único destino legítimo).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-checkout-pii`
    (`e2e-checkout-pii.spec.ts`: captura **todas** las llamadas al logger y serializa
    respuestas y errores en los 5 escenarios; asserta
    `expect(JSON.stringify(todo)).not.toContain(v)` para cada uno de los 3 centinelas y
    para el `order_token`; el test se prueba a sí mismo con un caso negativo —una línea
    sembrada a mano con el email **sí** dispara el fallo—, para que no pueda pasar por no
    mirar nada)

---

## Fase 5: Los AC negativos como invariantes probadas — 1,0 h

> Esta fase no agrega comportamiento: **atornilla** las cuatro propiedades que hacen que
> la orden sea confiable. Que sean verdaderas hoy no alcanza; tienen que quedar
> protegidas contra la próxima edición.

- [ ] T5.1 AC-6 — el checkout no toca el stock (ADR-0008)
  - **Exit criterion**: en un recorrido completo (crear orden con 3 líneas, incluido un
    producto con `stock` exactamente igual a la cantidad pedida), el `products.stock` de
    cada ítem leído **directamente de Postgres** es idéntico antes y después. Y: no existe
    en `apps/api/src/checkout/` ninguna sentencia de escritura sobre `products`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=ac6-stock-untouched`
    (`ac6-stock-untouched.spec.ts`, integration: snapshot de `stock` por producto antes y
    después, comparación estricta; incluye el caso de stock justo, que es donde una
    reserva accidental se notaría) **y**
    `rg "stock" apps/api/src/checkout --glob '!**/*.spec.ts' | rg -v "^\S+:\s*(//|\*)" | rg "update|decrement|set" || true` sin resultados de escritura

- [ ] T5.2 AC-7 — imposibilidad estructural de custodiar datos de tarjeta
  - **Exit criterion**: un test recorre (a) las columnas reales de `orders` y
    `order_items` en Postgres y (b) los campos de **todos** los DTO del módulo, y falla si
    aparece cualquiera de
    `card|pan|cvv|cvc|holder|expiry|exp_month|exp_year|tarjeta`. Agregar mañana un
    `card_last4` «para el comprobante» rompe la suite en vez de pasar inadvertido.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=ac7-no-card-data`
    (`ac7-no-card-data.spec.ts`: consulta `information_schema.columns` para las dos
    tablas, introspecciona los DTO con la metadata de `class-validator`, y hace el match
    de la lista negra sobre los dos conjuntos; se prueba a sí mismo con un caso negativo
    —una columna sembrada `card_last4` en una tabla temporal **sí** dispara el fallo)

- [ ] T5.3 AC-8 — el consentimiento es trazable y no se puede eludir
  - **Exit criterion**: la orden creada tiene `consent_accepted = true`,
    `consent_accepted_at` dentro de los 5 s del request y `consent_terms_version` igual a
    `LEGAL_TERMS_VERSION`. Y —la parte que hace la garantía **estructural**— un `INSERT`
    directo en `orders` con `consent_accepted = false` **falla por el `CHECK` de la
    base**: AC-4 y AC-8 dejan de depender de que el código valide.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=ac8-consent-traceable`
    (`ac8-consent-traceable.spec.ts`, integration: las 3 columnas con los valores
    esperados tras un checkout real; `prisma.$executeRawUnsafe` de un `INSERT` con
    `consent_accepted = false` **rechaza** con violación de
    `orders_consent_check`; y un `UPDATE` que intente poner `false` en una orden existente
    también rechaza)

- [ ] T5.4 AC-2 — cambiar el precio del catálogo no altera una venta pasada
  - **Exit criterion**: creada una orden, se cambia `products.price_ars_cents` del ítem
    (y su `name`), y la orden sigue devolviendo el precio, el nombre y el total del
    momento de la compra. Es el invariante que US-001 fijó en su AC-10, verificado del
    lado de la orden y **de forma independiente de `buildCartView`**: se lee
    `order_items` directo de Postgres, así el test no queda a merced de un cambio en la
    función del carrito.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=ac2-price-snapshot`
    (`ac2-price-snapshot.spec.ts`, integration: `unit_price_ars_cents`, `product_name`,
    `product_sku` y `orders.total_ars_cents` leídos de Postgres son **idénticos** tras
    duplicar el precio y renombrar el producto; y el total de la orden sigue siendo la
    suma exacta de sus líneas)

---

## Fase 6: Contratos y documentación — 0,6 h

- [ ] T6.1 OpenAPI publicado del servicio actualizado
  - **Pattern**: el draft de `contracts/openapi/checkout-create.yaml` de este change se
    integra a `apps/api/docs/api/openapi.yaml` (la copia publicada del servicio); el
    contrato **vivo** de `openspec/specs/checkout/` lo escribe `/archive-change`, no esta
    task — `per openspec-workflow §Living contract rule` y `per documentation-standards.md
    §11.1`.
  - **Exit criterion**: `apps/api/docs/api/openapi.yaml` declara `POST /v1/checkout` con
    sus status (`201`, `403`, `409`, `422`, `429`), el envelope
    `application/problem+json` por `$ref` a los `components` ya existentes, las cabeceras
    `RateLimit-*` en el 429 y el header `X-CSRF-Token` requerido. Resuelve y lintea
    limpio con la config de `.spectral.yaml` del repo.
  - **Verify**: `pnpm dlx @stoplight/spectral-cli lint apps/api/docs/api/openapi.yaml --ruleset .spectral.yaml --fail-severity=warn` (termina con exit 0)

- [ ] T6.2 README del módulo, con el seam de US-009 explícito
  - **Exit criterion**: `apps/api/src/checkout/README.md` explica en ≤ 40 líneas: el
    endpoint y quién lo usa, por qué el carrito viene de la cookie y no del cuerpo, qué
    se congela en el snapshot y por qué, cómo se registra el consentimiento, **el
    contrato del `order_token` que US-009 consume** (hex de 64, hash en
    `orders.access_token_hash`) y **qué NO hace este módulo** (no cobra, no confirma, no
    toca stock, no notifica — con los punteros a US-009/US-010/US-011).
  - **Verify**: `test -f apps/api/src/checkout/README.md && rg -q "order_token" apps/api/src/checkout/README.md && rg -q "US-009" apps/api/src/checkout/README.md && rg -q "ADR-0008" apps/api/src/checkout/README.md && test $(wc -l < apps/api/src/checkout/README.md) -le 40`

- [ ] T6.3 Cerrar OQ-BE-1 en el change de US-009
  - **Contexto**: la **decisión** ya está ratificada por el Arquitecto/PO el 2026-08-22
    (token opaco de 256 bits con SHA-256 en base, opción (a)), y el `proposal.md` de US-009
    ya lo refleja. Lo que esta task cierra es el **hecho**: que el seam existe en el código.
  - **Exit criterion**: el `tasks.md` de `US-009-pago-mercadopago-backend` tiene su
    pre-requisito «US-008 backend» marcado `[x]`, y su `Verify` —el que busca
    `model Order` y `access_token_hash` en `schema.prisma`— **pasa**. Sin esto, el próximo
    `/develop-backend US-009` se detiene en un pre-requisito ya satisfecho.
  - **Verify**: `node -e "const s=require('fs').readFileSync('packages/db/prisma/schema.prisma','utf8'); if(!/model Order\b/.test(s)||!/access_token_hash/.test(s)) process.exit(1); console.log('seam presente')" && rg -q "Resolved.*OQ-BE-1|OQ-BE-1.*Resolved" openspec/changes/US-009-pago-mercadopago-backend/proposal.md`

---

## Verification (suite-level)

- [ ] Type-check limpio: `pnpm --filter @dsm/api typecheck`
- [ ] Lint limpio: `pnpm --filter @dsm/api lint`
- [ ] Esquema aplicado desde cero en base limpia: `pnpm --filter @dsm/db migrate:deploy`
- [ ] Suite completa de la API verde (unit + integration + e2e-nest, forma terminante):
      `pnpm --filter @dsm/api test -- --ci`
- [ ] Suite del módulo de checkout verde en aislamiento:
      `pnpm --filter @dsm/api test -- --ci --testPathPattern=checkout`
- [ ] **Sin regresión** en las superficies existentes — en particular el carrito, cuyo
      módulo se tocó en T1.3:
      `pnpm --filter @dsm/api test -- --ci --testPathPattern='e2e-cart|e2e-auth|e2e-storefront|e2e-products|e2e-categories|e2e-security-edge'`
- [ ] Contrato publicado lintea limpio:
      `pnpm dlx @stoplight/spectral-cli lint apps/api/docs/api/openapi.yaml --ruleset .spectral.yaml --fail-severity=warn`
- [ ] **Seam de US-009 verificado end-to-end**: el `order_token` que devuelve el 201
      resuelve la orden por `access_token_hash` con el mismo `hashToken` que usa
      `OrdersReadRepository` de US-009.
      `pnpm --filter @dsm/api test -- --ci --testPathPattern='order-token|orders.repository'`

---

## Trazabilidad AC → tasks

| AC de US-008 | Tasks |
|---|---|
| AC-1 checkout válido crea la orden | T0.1, T1.2, T2.3, T3.1, T3.2, T6.1 |
| AC-2 ítems con precio al momento | T0.1, T2.1, T2.3, T5.4 |
| AC-3 validación de los datos del comprador | T3.1 |
| AC-4 consentimiento obligatorio | T0.1 (`CHECK`), T3.1, T5.3 |
| AC-5 carrito inválido bloquea | T1.1, T1.3, T2.3 |
| AC-6 no se descuenta stock antes del pago | T2.3, T5.1 |
| AC-7 no se almacenan datos de tarjeta | T0.1, T3.1, T5.2 |
| AC-8 el consentimiento queda registrado | T0.1, T2.3, T5.3 |
| Declaraciones no-AC del design (F51) | T0.1 (`order_number` — OQ-BE-4), T0.2 (config), T1.1/T1.2/T1.3 (capas y wiring), T2.2 (seam de US-009), T3.1 (`order_number` en la respuesta), T3.2 (CSRF + rate-limit), T3.3 (`no-store`), T4.1/T4.2 (observabilidad y PII), T6.1/T6.2/T6.3 (docs y cierre de OQ-BE-1 de US-009) |
