---
parent-us: US-007
discipline: backend
variant: null
language: es
---

# US-007 Backend — Tasks

> Cada task es closure-grade: atómica, con `Exit criterion:` observable y `Verify:`
> con el comando exacto que `/develop-backend` corre. Los comandos asumen la **raíz
> del repo** como cwd. El runner es el de US-001/US-014:
> `pnpm --filter @dsm/api test -- --testPathPattern=<patrón>` ejecuta Jest en su forma
> **terminante** (no watch — F49); el config de unit (`jest.config.js`,
> `testRegex: src/.*\.spec\.ts$`) incluye también los specs `e2e-*` colocados en `src/`.
> Integration y e2e corren contra el Postgres real de `docker-compose`
> (`ai4devs-finalproject-postgres-1`, host `:55432`), que debe estar arriba.
>
> **Estimación dual**: **7,7 h AI-asistido** / **~15 h tradicional** (24 tasks). La US §7
> presupuesta `BE-US-007` en 6-10 h: el tradicional excede el techo ~5 h porque la US
> describe «carrito CRUD con persistencia + chequeo de stock» y da por resuelto lo que
> en este repo todavía no existe — la **identidad del invitado** (token opaco + cookie
> propia + CSRF sin `jti`), los controles §7 de la **primera superficie pública de
> escritura** (tercer throttler + `no-store` + métodos CORS) y la extracción de la
> verificación de `Origin` para no duplicarla. El CRUD en sí son ~3 h.

## Pre-requisitos

- [x] **US-003 backend archivado** (AS-BUILT verificado al planificar): `apps/api` corre
  con `HttpProblemFilter` (RFC 7807), `ValidationPipe` global
  (`whitelist` + `forbidNonWhitelisted`, 422), helmet §7.1, allowlist CORS §7.2,
  throttlers nombrados `auth` + `storefront`, y `ProductsRepository` como único punto
  de ORM de `products`.
  **Verify**: `pnpm --filter @dsm/api typecheck && pnpm --filter @dsm/api test -- --testPathPattern='e2e-storefront-product|e2e-throttler-independence'`
- [x] **US-014 backend presente en el working tree**: `apps/api/src/auth/cookies.ts`,
  `csrf.guard.ts` y `tokens/opaque-token.ts` existen y sus specs pasan. T1.1, T1.2 y
  T2.3 los extienden o reusan.
  **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern='cookies|csrf|opaque-token'`
- [x] **Postgres local arriba**: `docker compose up -d postgres` (host `:55432`).
- [x] **Secuencia con changes en vuelo**: T1.2 toca `apps/api/src/auth/csrf.guard.ts`,
  compartido con el change de US-014. Correrla con ese working tree limpio
  (`git status --porcelain apps/api/src/auth` vacío) o rebasar antes.

---

## Fase 0: Esquema y configuración — 1,2 h

- [x] T0.1 Migración aditiva `carts` + `cart_items` (F40 — column-complete)
  - **Pattern**: dos `model` nuevos en `packages/db/prisma/schema.prisma` con
    `@id @default(dbgenerated("gen_random_uuid()")) @db.Uuid` y `@@map("…")`,
    espejando `Customer`/`RefreshToken`; `@@unique([cart_id, product_id])`;
    migración generada con `pnpm --filter @dsm/db migrate` y los dos `CHECK`
    **agregados a mano** al `migration.sql` generado, igual que
    `products_stock_check` en `20260715230024_init_catalog` (Prisma no los declara) —
    `per backend-node-standards.md §5 — migraciones aditivas, nunca destructivas en un
    solo deploy`.
    ```prisma
    model CartItem {
      quantity             Int
      unit_price_ars_cents Int
      cart    Cart    @relation(fields: [cart_id], references: [id], onDelete: Cascade)
      product Product @relation(fields: [product_id], references: [id], onDelete: Restrict)
      @@unique([cart_id, product_id])
      @@map("cart_items")
    }
    ```
  - **Exit criterion**: el esquema materializado tiene **exactamente** las columnas de
    `design.md` §Persistencia — `carts`: `id`, `session_token_hash`, `customer_id`,
    `expires_at`, `created_at`, `updated_at` (**6**); `cart_items`: `id`, `cart_id`,
    `product_id`, `quantity`, `unit_price_ars_cents`, `created_at`, `updated_at`
    (**7**). Índices: `UNIQUE(carts.session_token_hash)`, `carts(expires_at)`,
    `carts(customer_id)`, `UNIQUE(cart_items.cart_id, product_id)`,
    `cart_items(cart_id)`. Constraints: `CHECK (quantity >= 1)` y
    `CHECK (unit_price_ars_cents >= 0)`. FKs con la regla de borrado exacta —
    `carts.customer_id → customers` **SET NULL**, `cart_items.cart_id → carts`
    **CASCADE**, `cart_items.product_id → products` **RESTRICT**. **Ninguna** tabla
    existente se modifica.
  - **Verify**: `pnpm --filter @dsm/db migrate:deploy && pnpm --filter @dsm/api test -- --testPathPattern=cart-schema`
    (nuevo `src/cart/cart-schema.spec.ts`, espejo de `auth-schema.spec.ts`: compara el
    conjunto **completo** de columnas por tabla contra la lista literal —falla si falta
    **o sobra** una—, verifica los 5 índices por nombre en `pg_indexes`, y prueba el
    comportamiento real: `INSERT` con `quantity = 0` **falla**; borrar un `cart` borra
    sus `cart_items`; borrar un `product` con línea viva **falla**; borrar un
    `customer` deja `carts.customer_id` en `NULL` sin borrar el carrito)

- [x] T0.2 Variables de entorno del carrito validadas por Zod
  - **Pattern**: extender `envSchema` en `apps/api/src/config/env.validation.ts` con
    `z.coerce.number().int().positive().default(…)` — `per backend-node-standards.md
    §7 — config validada al arranque, fail-fast`.
  - **Exit criterion**: `env.validation.ts` declara con default seguro
    `CART_TTL_DAYS` (**7** — decisión del PO, OQ-BE-1), `CART_MAX_ITEMS` (50),
    `CART_MAX_QTY_PER_LINE` (99),
    `CART_RATE_LIMIT_TTL_MS` (60 000), `CART_RATE_LIMIT_MAX` (120) y
    `CART_WRITE_RATE_LIMIT_MAX` (30). Un valor inválido (`CART_TTL_DAYS=abc`,
    `CART_MAX_ITEMS=-1`) hace **fallar el arranque**, no cae al default en silencio.
    La cookie del carrito reusa `AUTH_COOKIE_SECURE` (no se agrega una segunda
    variable para el mismo concepto) y queda anotado en el comentario del esquema.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=env.validation`
    (casos nuevos: sin las variables → los 6 defaults exactos, con
    `expect(env.CART_TTL_DAYS).toBe(7)` **literal** —falla si quedó el 30 de la
    recomendación original—; `CART_TTL_DAYS=abc` → `validateEnv` lanza;
    `CART_MAX_ITEMS=-1` → lanza; `CART_MAX_QTY_PER_LINE=0` → lanza)

---

## Fase 1: Identidad del invitado y borde de seguridad — 1,0 h

- [x] T1.1 Cookies del carrito en el módulo de cookies existente
  - **Pattern**: agregar `CART_COOKIE = 'dsm_cart'`, `CART_CSRF_COOKIE = 'dsm_cart_csrf'`,
    `setCartCookies(res, { token, csrfToken }, { ttlDays, secure })` y
    `clearCartCookies(res, secure)` **dentro de** `apps/api/src/auth/cookies.ts`, que
    declara que los atributos «viven acá y en ningún otro lado» — `per
    security-standards.md §7.4 — cookies de sesión Secure; HttpOnly; SameSite=Lax
    mínimo`. El valor CSRF se deriva con `deriveCsrfToken(token, JWT_SECRET)`, la
    función que ya existe en ese archivo.
  - **Exit criterion**: `dsm_cart` se emite con `HttpOnly`, `SameSite=Lax`, `Path=/` y
    `Max-Age = CART_TTL_DAYS × 86400` (**604 800 s** con el default de 7 días,
    OQ-BE-1); `dsm_cart_csrf` con los mismos atributos
    **excepto** `HttpOnly` (el FE tiene que leerla); `Secure` sale de
    `AUTH_COOKIE_SECURE` y es `true` por default; `clearCartCookies` borra las dos con
    el **mismo** `Path` de emisión. El token del carrito **no** aparece en ningún
    cuerpo de respuesta: viaja sólo como `Set-Cookie`. Las tres cookies de US-014
    (`dsm_access`, `dsm_refresh`, `dsm_csrf`) siguen emitiéndose idénticas.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=cookies`
    (casos nuevos en `cookies.spec.ts`: `dsm_cart` lleva `HttpOnly` y `dsm_cart_csrf`
    **no**; ambas llevan `Path=/` y el `Max-Age` derivado de `ttlDays`; con
    `secure:false` desaparece `Secure` y con `true` aparece; `clearCartCookies` emite
    las dos con `Max-Age=0`; los casos existentes de las cookies de auth siguen verdes)

- [x] T1.2 Extraer `verifyRequestOrigin` a `common/http/origin.ts` (refactor sin cambio de comportamiento)
  - **Pattern**: **Extract Function** (Fowler) — mover el cuerpo de
    `CsrfGuard.verificarOrigen` a una función pura exportada
    `verifyRequestOrigin(req, allowedOrigins): void` que lanza `CsrfError`, y hacer que
    `CsrfGuard` la llame. Frontera que **no** se mueve: el comportamiento observable
    del CSRF de auth (mismos 403, misma preferencia `Origin` → `Referer`, mismo rechazo
    ante ausencia de ambos) — `per security-standards.md §7.5 — verificar Origin
    (fallback Referer) en toda escritura autenticada por cookie; ausencia ⇒ rechazo` y
    `per AGENTS.md §1.1 — detectar patrones repetidos y extraer`.
  - **Exit criterion**: la lógica de `Origin` vive en **un** archivo y `csrf.guard.ts`
    ya no la duplica; la función acepta `Origin` exacto de la allowlist, cae a
    `Referer` comparando **sólo su origen**, y lanza `CsrfError` cuando falta ninguno de
    los dos, cuando el `Origin` no está en la allowlist, cuando el `Referer` no parsea,
    y cuando el origen es un sufijo del permitido (`https://dsm.com.ar.evil.net` con
    `https://dsm.com.ar` en la lista). **Los tests de CSRF de auth pasan sin
    modificarse** — si hay que tocarlos, el comportamiento cambió y el refactor está mal.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern='csrf|origin|e2e-auth-csrf'`
    (los specs existentes `csrf-guard.spec.ts` y `e2e-auth-csrf.spec.ts` corren **sin
    editar** + nuevo `src/common/http/origin.spec.ts` con los 5 casos de rechazo y los
    2 de aceptación)

- [x] T1.3 `CartCsrfGuard` — double-submit firmado sobre el token del carrito
  - **Pattern**: espejo de `CsrfGuard` pero derivando de la cookie del carrito en vez
    del `jti` del access: `verifyRequestOrigin(req, allowed)` + comparación en tiempo
    constante de `X-CSRF-Token` contra `deriveCsrfToken(req.cookies[CART_COOKIE], JWT_SECRET)`
    con `crypto.timingSafeEqual` — `per security-standards.md §7.5 — SameSite es la
    primera capa, no la única: segunda capa double-submit firmado + verificación de
    Origin`.
  - **Exit criterion**: en `PUT` y `DELETE` de `/v1/cart/items/{slug}`, devuelven
    **403 `dsm:auth/csrf`**: sin header `X-CSRF-Token`; con un valor que no corresponde
    al token presentado; con el valor de **otra** sesión de carrito; con `Origin` fuera
    de la allowlist; y **sin** `Origin` ni `Referer`. Con header correcto y `Origin`
    permitido pasa. Una **primera** escritura sin cookie de carrito (todavía no hay
    carrito que secuestrar) pasa el guard: no hay double-submit posible y no hay nada
    que proteger. El `GET` **no** exige CSRF (es seguro). El valor no se puede forjar
    sin `JWT_SECRET`. Comparación en tiempo constante, nunca `===`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=cart-csrf`
    (unit `src/cart/cart-csrf.guard.spec.ts` con los 5 casos de rechazo + el de
    aceptación + el de primera escritura sin cookie; y un caso que prueba que el CSRF
    de **auth** no abre el del carrito: el valor derivado del `jti` presentado en
    `/v1/cart/items/x` → 403)

---

## Fase 2: Persistencia y resolución del carrito — 1,1 h

- [x] T2.1 `CartsRepository` — único punto de ORM de `carts` + `cart_items`
  - **Pattern**: clase `@Injectable()` que envuelve `PrismaService`; el upsert de línea
    va sobre la clave compuesta única, no con un `findFirst` + `if` (que carreraría) —
    `per backend-node-standards.md §5 — el repositorio envuelve el ORM; transacción
    para casos de uso multi-escritura`.
    ```ts
    await this.prisma.cartItem.upsert({
      where: { cart_id_product_id: { cart_id, product_id } },
      create: { cart_id, product_id, quantity, unit_price_ars_cents },
      update: { quantity, unit_price_ars_cents },
    });
    ```
  - **Exit criterion**: expone `findLiveByTokenHash(hash)` (devuelve el carrito **con
    sus líneas**, o `null` si no existe o si `expires_at <= now()`),
    `create({tokenHash, expiresAt})`, `deleteById(id)`, `upsertItem(...)`,
    `deleteItem(cartId, productId)`, `countItems(cartId)` y `touch(cartId, expiresAt)`.
    `upsertItem` sobre una línea existente **actualiza** cantidad e instantánea de
    precio sin crear una segunda fila. Ningún error crudo de Prisma escapa: los
    códigos se traducen a errores de dominio (§6). Ningún service toca `PrismaService`
    directamente.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=carts.repository`
    (integration contra Postgres real: `upsertItem` dos veces con el mismo
    `(cart, product)` deja **una** fila con la última cantidad; `findLiveByTokenHash`
    de un carrito con `expires_at` en el pasado devuelve `null` aunque la fila exista;
    `deleteById` borra las líneas en cascada; `countItems` cuenta líneas distintas, no
    unidades; `touch` mueve `expires_at` y `updated_at`)

- [x] T2.2 `ProductsRepository.findManyBySlugs` — lectura de las líneas del carrito
  - **Pattern**: método nuevo en el repositorio existente (no un acceso a ORM paralelo)
    que trae los productos de un conjunto de slugs **sin filtrar por estado**, porque
    la lectura del carrito necesita mostrar también los despublicados para poder
    marcarlos (AC-6) — `per backend-node-standards.md §5`. El camino de **agregar**
    sigue usando `findPublishedBySlug` (que ya existe y filtra `published`), y por eso
    AC-10 devuelve el mismo 404 que un slug inexistente.
  - **Exit criterion**: `findManyBySlugs(slugs)` devuelve los productos de todos los
    slugs pedidos, **incluidos `draft` y `archived`**, con `id`, `slug`, `name`,
    `image_url`, `price_ars_cents`, `stock` y `status`; una sola query para el conjunto
    (no N+1); slugs inexistentes simplemente no aparecen. `findPublishedBySlug` **no se
    modifica** y sigue devolviendo `null` para draft/archived (US-003 depende de eso).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern='products.repository|e2e-storefront-product'`
    (integration: con 3 productos `published`/`draft`/`archived`, `findManyBySlugs`
    devuelve los 3 y `findPublishedBySlug` sigue devolviendo `null` para los 2 ocultos;
    el e2e de la ficha de US-003 sigue en 404 para el archivado — sin regresión)

- [x] T2.3 `CartTokenService` — resolver, crear, deslizar y purgar
  - **Pattern**: reusa `newToken()` / `hashToken()` de
    `apps/api/src/auth/tokens/opaque-token.ts` (256 bits de CSPRNG, hash SHA-256) —
    `per security-standards.md §3.7 — token opaco ≥ 128 bits de un CSPRNG, almacenado
    hasheado`. El deslizamiento de `expires_at` y el `Max-Age` de la cookie se calculan
    del **mismo** `CART_TTL_DAYS`, en el mismo lugar, para que no puedan divergir.
  - **Exit criterion**: `resolve(req)` devuelve el carrito vivo de la cookie o `null`;
    si la fila está **vencida** la **borra** (purga oportunista) y devuelve `null`;
    `ensure(req, res)` devuelve el carrito vivo o crea uno nuevo (token nuevo, hash
    persistido, cookies emitidas); `slide(cart, res)` mueve `expires_at` a
    `now + CART_TTL_DAYS` y re-emite las cookies con el **mismo** `Max-Age`. El token en
    claro **nunca** se persiste ni se loguea. Una cookie con un token que no existe en
    base se trata igual que no tener cookie (sin error, sin filtrar el motivo).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=cart-token`
    (integration `src/cart/cart-token.service.spec.ts`: `ensure` sin cookie crea fila y
    emite `Set-Cookie`; `resolve` con esa cookie devuelve el mismo carrito; con la fila
    forzada a `expires_at` pasado devuelve `null` **y la fila ya no está en la base**;
    con un token inventado devuelve `null`; tras `slide`, `expires_at` y el `Max-Age` de
    la cookie coinciden con `CART_TTL_DAYS`; el valor de `session_token_hash` en base
    **no** es igual al token de la cookie)

---

## Fase 3: Dominio del carrito — 1,3 h

- [x] T3.1 Errores `dsm:cart/*` + extension members RFC 7807
  - **Pattern**: subclases de la `DomainError` existente con `readonly status` y
    `readonly type`; `DomainError` gana un `readonly extensions?: Record<string, unknown>`
    que `mapErrorToProblem` esparce en el cuerpo — `per api-standards.md §8 — envelope
    RFC 7807` (RFC 7807 §3.2 admite extension members) y `per backend-node-standards.md
    §6 — errores de dominio tipados mapeados centralmente`.
  - **Exit criterion**: `apps/api/src/common/errors/cart-errors.ts` define
    `InsufficientStockError` (409 `dsm:cart/insufficient-stock`, con
    `extensions.available_quantity`) y `CartTooManyItemsError`
    (409 `dsm:cart/too-many-items`, con `extensions.max_items`); el filtro **existente**
    los mapea al envelope con ese `type`, y el cuerpo del 409 de stock trae
    `available_quantity` como **campo de primer nivel**, no embebido en el `detail`. Los
    errores que **no** declaran `extensions` producen exactamente el mismo cuerpo que
    antes (cambio aditivo). Ningún `detail` contiene el token del carrito.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern='cart-errors|http-problem-filter'`
    (unit sobre `mapErrorToProblem`: las 2 clases nuevas producen `type`/`status`/`title`
    esperados y el cuerpo incluye la extensión; un `NotFoundError` sin `extensions`
    produce un cuerpo **`toEqual`** al esperado sin claves extra; los casos existentes
    del filtro siguen verdes sin editarse)

- [x] T3.2 `buildCartView` — función pura de precio vigente y disponibilidad
  - **Pattern**: función pura `buildCartView(items, products, limits): CartView` sin
    tipos de framework ni acceso a base, para poder ejercer las reglas de precio y
    stock sin HTTP ni Postgres — `per backend-node-standards.md §2 — la lógica de
    dominio no importa tipos de framework donde puede ser TS plano (testeabilidad)`.
  - **Exit criterion**: **todo** importe se calcula con `product.price_ars_cents`
    (vigente); la instantánea `item.unit_price_ars_cents` **no participa de ninguna
    suma** y sólo produce `price_changed` + `previous_unit_price_ars_cents` cuando
    difiere. `availability` es `available` si el producto es `published` y
    `stock >= quantity`; `insufficient_stock` si es `published` y `stock < quantity`
    (con `available_quantity = stock`); `unavailable` si está en `draft` o `archived`.
    `subtotal_ars_cents = precio_vigente × quantity` en **todas** las líneas, incluidas
    las bloqueadas; `total_ars_cents` suma **sólo** las `available`;
    `has_blocking_issues` es `true` si alguna línea no es `available`;
    `max_quantity = min(stock, CART_MAX_QTY_PER_LINE)`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=cart-view`
    (unit `src/cart/cart-view.spec.ts`, AAA: producto que subió de precio ⇒ el subtotal
    usa el **nuevo** y `price_changed` es `true` con el viejo en
    `previous_unit_price_ars_cents`; línea con `quantity: 3` y `stock: 1` ⇒
    `insufficient_stock`, `available_quantity: 1` y **fuera** del total; producto
    `archived` ⇒ `unavailable` y fuera del total; carrito mixto ⇒ el total es exactamente
    la suma de las disponibles y `has_blocking_issues` es `true`; carrito todo
    disponible ⇒ `has_blocking_issues` es `false`)

- [x] T3.3 `CartService.setItem` — agregar y editar cantidad (AC-1, AC-2, AC-5, AC-10)
  - **Pattern**: resolver producto publicado → validar stock → `ensure` carrito →
    upsert + `slide` dentro de `prisma.$transaction` — `per backend-node-standards.md
    §5 — transacción para casos de uso multi-escritura, sin escrituras parciales ante
    fallo`.
  - **Exit criterion**: con un slug **publicado** y `quantity <= stock`, crea o
    actualiza la línea a la cantidad **absoluta** pedida y devuelve el carrito completo;
    con un slug inexistente, `draft` o `archived` lanza `NotFoundError`
    (**el mismo** para los tres, AC-10); con `quantity > stock` lanza
    `InsufficientStockError` con `available_quantity = stock` **sin escribir nada**
    (AC-5); superar `CART_MAX_ITEMS` líneas distintas lanza `CartTooManyItemsError`;
    la instantánea `unit_price_ars_cents` se re-sella con el precio vigente en cada
    llamada. **`products.stock` no se escribe en ningún camino** (AC-8, ADR-0008).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=cart.service`
    (unit con repos mockeados: caso feliz devuelve la cantidad pedida; los tres casos de
    producto oculto producen errores `deepEqual` en `type` + `detail`; `quantity > stock`
    lanza con `available_quantity` correcto y el repo **no** recibe ninguna escritura;
    la línea 51 con `CART_MAX_ITEMS=50` lanza `CartTooManyItemsError`; ningún mock de
    `ProductsRepository` recibe llamadas de escritura)

- [ ] T3.4 `CartService.getCart` y `removeItem` (AC-3, AC-4, AC-6, AC-7, AC-9)
  - **Pattern**: `getCart` es **seguro**: resuelve, lee y renderiza; **no** crea carrito
    ni emite cookie — `per api-standards.md §3.1 — GET no tiene efectos de lado` y
    `per security-standards.md §7.5 — una operación con efectos nunca va por GET`.
  - **Exit criterion**: `getCart` sin cookie (o con cookie huérfana/vencida) devuelve el
    carrito **vacío** (`id: null`, `items: []`, contadores en 0) con **200** y **sin**
    `Set-Cookie` (AC-7); con carrito devuelve las líneas con precios vigentes y el
    estado de disponibilidad recalculado en esa misma request (AC-6, AC-9);
    `removeItem` borra la línea y devuelve el carrito recalculado (AC-3), y borrar algo
    que no está devuelve el carrito **igual** sin error (idempotente); ninguno de los
    dos crea un carrito nuevo.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=cart.service`
    (unit: `getCart` sin cookie no llama a `create` del repositorio y devuelve el vacío;
    `getCart` con una línea de producto archivado la devuelve marcada `unavailable` en
    vez de omitirla; `removeItem` de un producto ausente no lanza y no llama a
    `deleteItem`; ninguna de las dos operaciones llama a `ensure`/`create`)

---

## Fase 4: Borde HTTP — 1,1 h

- [ ] T4.1 DTOs de entrada y de respuesta
  - **Pattern**: `class-validator` en el DTO de entrada + DTO de respuesta con
    `static from(view)` — `per backend-node-standards.md §4 — todo input de controller
    es un DTO validado en el borde; DTO de respuesta separado de la entidad de
    persistencia`. El `ValidationPipe` global ya corre con `whitelist: true`,
    `forbidNonWhitelisted: true` y `errorHttpStatusCode: 422`.
  - **Exit criterion**: `SetCartItemDto` declara **sólo** `quantity`
    (`@IsInt`, `@Min(1)`, `@Max(CART_MAX_QTY_PER_LINE)`); mandar `unit_price_ars_cents`,
    `product_id`, `cart_id` o cualquier otro campo produce **422** con `errors[]`
    (no se ignora); `quantity: 0`, negativa, decimal o string produce 422.
    `CartDto.from()` emite exactamente `{ id, items[], item_count, total_quantity,
    total_ars_cents, has_blocking_issues, updated_at }` y cada ítem exactamente
    `{ slug, name, image_url, quantity, unit_price_ars_cents, currency,
    subtotal_ars_cents, availability, available_quantity?, max_quantity,
    price_changed, previous_unit_price_ars_cents? }` — **sin** `product_id`, `cart_id`,
    `status`, `stock` crudo ni ningún token.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=cart-dto`
    (unit `src/cart/dto/cart-dto.spec.ts` — el controller todavía no existe, así que el
    contrato se ejerce sin HTTP: `validate(plainToInstance(SetCartItemDto, …))` de
    `class-validator` devuelve violaciones para `{quantity: 0}`, `{quantity: -1}`,
    `{quantity: 2.5}`, `{quantity: "2"}` y `{quantity: 100}`, y **ninguna** para
    `{quantity: 1}`; con `forbidNonWhitelisted` el objeto `{quantity: 1,
    unit_price_ars_cents: 1}` produce violación por campo no declarado;
    `Object.keys(CartDto.from(view))` es **exactamente** el conjunto de 7 claves y
    `Object.keys(dto.items[0])` el del ítem — falla si sobra o falta una.
    El 422 extremo a extremo lo prueba T6.5)

- [ ] T4.2 `CartController` + `CartModule` + cableado en `AppModule`
  - **Pattern**: `@Controller('v1/cart')` sin `AdminGuard` ni `CustomerGuard`;
    `@UseGuards(CartThrottlerGuard)` a nivel de clase y `@UseGuards(CartCsrfGuard)` sólo
    en los handlers de escritura — `per backend-node-standards.md §2 — controller fino:
    valida, delega, mapea; nada de lógica de negocio` y `per ADR-0010 — namespace
    público fuera de /v1/admin`.
  - **Exit criterion**: responden las 3 rutas de `design.md` §API —
    `GET /v1/cart` (200), `PUT /v1/cart/items/{slug}` (200),
    `DELETE /v1/cart/items/{slug}` (200); `CartModule` registra controller, service,
    repositorio, `CartTokenService` y los dos guards, e importa `ProductsModule`;
    `AppModule` lo importa. El controller no contiene ninguna regla de negocio (ni
    cálculo de precio, ni comparación de stock). Las superficies existentes
    (`/v1/admin/*`, `/v1/auth/*`, `/v1/products/*`, `/v1/categories/*`) responden igual
    que antes.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern='e2e-cart-crud|e2e-rbac|e2e-storefront-acceptance'`
    (e2e: las 3 rutas existen —ninguna devuelve 404 de ruta— y el ciclo
    `PUT` → `GET` → `DELETE` → `GET` deja el carrito vacío; las suites de RBAC y de
    aceptación del storefront siguen verdes)

- [ ] T4.3 Tercer throttler nombrado `cart` + aislamiento de los presupuestos existentes
  - **Pattern**: agregar `{ name: 'cart', ttl: CART_RATE_LIMIT_TTL_MS, limit: CART_RATE_LIMIT_MAX }`
    al array **ya registrado** de `ThrottlerModule.forRootAsync` en `auth.module.ts`
    (el módulo es global y se registra una sola vez), `@Throttle({ cart: { limit: CART_WRITE_RATE_LIMIT_MAX } })`
    en los handlers de escritura, y **cross-`@SkipThrottle`** en los controllers
    existentes — `per security-standards.md §7.3 — presupuesto por endpoint en
    superficies públicas de escritura` y `per api-standards.md §12 — 429 con
    Retry-After y RateLimit-*` (los emite `CartThrottlerGuard`, espejo de
    `StorefrontThrottlerGuard`).
  - **Exit criterion**: `GET /v1/cart` admite `CART_RATE_LIMIT_MAX` (120/min/IP) y las
    escrituras `CART_WRITE_RATE_LIMIT_MAX` (30/min/IP); al excederlos la respuesta es
    **429** `application/problem+json` con `Retry-After`, `RateLimit-Limit`,
    `RateLimit-Remaining: 0` y `RateLimit-Reset`. Los tres throttlers son
    **independientes**: agotar `cart` no consume `auth` ni `storefront` y viceversa —
    para eso los controllers de storefront y auth suman `cart: true` a su
    `@SkipThrottle`, y el del carrito salta `auth` y `storefront`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern='e2e-throttler-independence|e2e-cart-ratelimit'`
    (el spec de independencia **existente** se extiende a los 3 throttlers y prueba las
    6 combinaciones: agotar cada uno deja los otros dos respondiendo 2xx; el nuevo
    `e2e-cart-ratelimit` prueba que el límite de escritura es más estricto que el de
    lectura —N escrituras → 429 mientras el `GET` sigue en 200— y que el 429 trae los
    4 headers y el envelope `problem+json`)

- [ ] T4.4 `Cache-Control: no-store` en `/v1/cart` + `PUT`/`DELETE` en CORS
  - **Pattern**: extender el middleware de prefijo de `configureApp`
    (`bootstrap.ts`) —que ya estampa `no-store` en `/v1/admin`— para cubrir también
    `/v1/cart`, y agregar `PUT` y `DELETE` a `methods` de `app.enableCors` — `per
    security-standards.md §7.1 — Cache-Control: no-store en respuestas autenticadas`
    y `§7.2 — permitir sólo los métodos y headers que la API realmente usa`. Va en el
    middleware de borde y **no** en un interceptor: el interceptor sólo corre en 2xx y
    acá hace falta que el header cubra **también** los 4xx/429 (un 429 del carrito
    cacheado en el edge convierte el rate-limit en un DoS — hallazgo M1 de US-003).
  - **Exit criterion**: `GET /v1/cart` (200), `PUT` con 422, `PUT` con 404 y cualquier
    429 del carrito responden con `Cache-Control: no-store`; el `Cache-Control` acotado
    de la ficha pública `/v1/products/{slug}` **no cambia**; un preflight
    `OPTIONS /v1/cart/items/x` desde un origen de la allowlist con
    `Access-Control-Request-Method: PUT` responde con `Access-Control-Allow-Methods`
    incluyendo `PUT` y `DELETE` y `Access-Control-Allow-Credentials: true`; un origen
    **fuera** de la allowlist sigue sin recibir `Access-Control-Allow-Origin`; no se
    introduce `*`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern='e2e-cart-security|e2e-storefront-cache'`
    (e2e nuevo: los 4 casos de `no-store` incluyendo el 429 y el 404; el preflight con
    `PUT` y con `DELETE`; el preflight desde `http://evil.example` sin
    `Allow-Origin`; y el spec de caché del storefront **sin editar** sigue verde —
    la ficha conserva su `Cache-Control` acotado)

---

## Fase 5: Observabilidad — 0,3 h

- [ ] T5.1 `CartEventsService` — 6 eventos de negocio sin PII
  - **Pattern**: espejo de `CatalogEventsService` (contador en memoria + log pino
    estructurado) con su propia unión de nombres — `per observability-patterns §3.3 —
    el id va al log, NUNCA como dimensión de métrica (cardinalidad)` y
    `per observability-standards §9 — nada de PII ni de secretos en logs/métricas/traces`.
  - **Exit criterion**: se emiten `cart.item_added` (alta de línea),
    `cart.item_quantity_changed` (línea existente), `cart.item_removed`, `cart.viewed`
    (lectura de carrito no vacío), `cart.stock_limit_rejected` (409 de stock, AC-5) y
    `cart.item_unavailable` (lectura con línea bloqueada, AC-6), cada uno en su momento
    exacto; el **token del carrito no aparece nunca** en un log, ni en claro ni
    hasheado; el `cart_id` va al log y **no** como dimensión del contador; no hay PII de
    comprador. Un `GET` de carrito vacío **no** emite `cart.viewed`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-cart-events`
    (e2e con el logger pino capturado: el ciclo agregar → cambiar cantidad → leer →
    quitar produce exactamente los contadores esperados; un `PUT` por encima del stock
    emite `cart.stock_limit_rejected`; una lectura con producto archivado emite
    `cart.item_unavailable`; el volcado **completo** de logs de la corrida no contiene
    el valor de la cookie `dsm_cart` ni su hash; el carrito vacío no emite `cart.viewed`)

---

## Fase 6: Cobertura e2e de los AC — 1,2 h

- [ ] T6.1 e2e agregar, editar y quitar (AC-1, AC-2, AC-3)
  - **Exit criterion**: `PUT` de un producto publicado con `quantity: 2` devuelve 200
    con la línea (cantidad, precio unitario vigente, subtotal) y el `total_ars_cents`
    actualizado (AC-1); un segundo `PUT` con `quantity: 5` deja **una** línea de 5 y
    recalcula subtotal y total (AC-2); `DELETE` la saca y el total vuelve a reflejar el
    resto (AC-3); un `DELETE` repetido devuelve el mismo carrito sin error; con dos
    productos, el total es exactamente la suma de los dos subtotales.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-cart-crud`

- [ ] T6.2 e2e persistencia entre visitas y carrito vacío (AC-4, AC-7)
  - **Exit criterion**: armado el carrito, una **nueva** petición que sólo lleva la
    cookie `dsm_cart` (simulando volver después de cerrar el navegador — cliente HTTP
    nuevo, sin estado en memoria) devuelve el mismo carrito con sus productos, **sin**
    ninguna cuenta de por medio (AC-4); la cookie emitida tiene `Max-Age = 604 800`
    (7 días, OQ-BE-1) y la fila un `expires_at` que cae en la **misma** ventana —
    cookie y fila vencen juntas, derivadas del mismo `CART_TTL_DAYS`; una **escritura**
    posterior corre las dos hacia adelante y una **lectura** deja las dos donde estaban
    (el deslizamiento es sólo en escrituras — consecuencia declarada en `design.md`
    §Qué mueve `CART_TTL_DAYS = 7`); un `GET` **sin** cookie devuelve **200** con
    carrito vacío (`items: []`, totales en 0) y **sin** `Set-Cookie` — no se crea
    carrito al mirar (AC-7); un `GET` con una cookie cuya fila fue vencida a mano
    devuelve el vacío **y la fila ya no está** (purga oportunista).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-cart-persistence`

- [ ] T6.3 e2e límite de stock y no-reserva (AC-5, AC-8)
  - **Exit criterion**: con `stock: 3`, un `PUT` de `quantity: 4` devuelve **409
    `dsm:cart/insufficient-stock`** con `available_quantity: 3` y **la línea no se
    crea**; `quantity: 3` pasa (AC-5). **Invariante AC-8**: leído `products.stock`
    antes y después del ciclo completo (agregar 3 → leer → cambiar a 1 → leer → quitar),
    el valor es **idéntico** — el carrito no reserva ni decrementa; y dos carritos
    distintos pueden tener simultáneamente las 3 unidades cada uno sin que ninguna
    operación falle ni el stock cambie (es exactamente la consecuencia que ADR-0008
    acepta).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-cart-stock`

- [ ] T6.4 e2e no disponible, precio vigente y no publicado (AC-6, AC-9, AC-10)
  - **Exit criterion**: con el producto en el carrito, despublicarlo (`archived`) hace
    que la lectura lo devuelva con `availability: "unavailable"`,
    `has_blocking_issues: true` y **fuera** del `total_ars_cents`, **sin borrar la
    línea** (AC-6); bajarle el stock por debajo de la cantidad lo deja
    `insufficient_stock` con `available_quantity` (AC-6). Cambiado el precio del
    producto, la siguiente lectura usa el **nuevo** en `unit_price_ars_cents`,
    `subtotal_ars_cents` y `total_ars_cents`, con `price_changed: true` y el viejo en
    `previous_unit_price_ars_cents` (AC-9). Un `PUT` sobre un producto `draft`, sobre
    uno `archived` y sobre un slug inventado devuelven respuestas **byte-idénticas
    salvo `instance`** (404 `dsm:catalog/not-found`) y ninguno crea línea (AC-10).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-cart-availability`

- [ ] T6.5 e2e de la frontera de seguridad (CSRF, cookie, aislamiento de carritos)
  - **Exit criterion**: una escritura con la cookie de carrito pero **sin**
    `X-CSRF-Token` devuelve **403 `dsm:auth/csrf`**; con el valor de otro carrito → 403;
    sin `Origin` → 403; con `Origin` fuera de la allowlist → 403; con todo correcto →
    200. La cookie `dsm_cart` llega con `HttpOnly` y `SameSite=Lax` (y con `Secure`
    cuando `AUTH_COOKIE_SECURE=true`), y `dsm_cart_csrf` **sin** `HttpOnly`. **Aislamiento**:
    el cliente A no puede leer ni modificar el carrito de B — con la cookie de A, el
    `GET` devuelve sólo lo de A, y no existe ninguna ruta que acepte un id de carrito
    como parámetro (`GET /v1/cart/{id}` no está ruteada → 404 de ruta). Ni el token ni
    su hash aparecen en ningún cuerpo de respuesta. **Validación en el borde**: un
    `PUT` con `{"quantity": 1, "unit_price_ars_cents": 1}` devuelve **422** con
    `errors[]` (el campo no se ignora — `forbidNonWhitelisted`), y uno con
    `{"quantity": 0}` también, sin crear línea.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-cart-security`

---

## Fase 7: Contratos y documentación — 0,5 h

- [ ] T7.1 Tres contratos OpenAPI draft (1 por endpoint) + lint
  - **Pattern**: un yaml autocontenido por endpoint en
    `openspec/changes/US-007-carrito-compra-backend/contracts/openapi/`
    (`cart-get.yaml`, `cart-set-item.yaml`, `cart-remove-item.yaml`) con `servers: [/v1]`
    y los paths **sin** el prefijo, `components.schemas` de request/response y
    `components.responses` RFC 7807 con el `type` URI canónico — `per
    api-contract-completeness — 1 yaml por endpoint + catálogo de errores RFC 7807
    cerrado`.
  - **Exit criterion**: los 3 archivos validan como OpenAPI 3.x y coinciden con la
    implementación (rutas, shape de `Cart`/`CartItem`/`SetCartItemRequest`, y el
    catálogo cerrado `dsm:cart/insufficient-stock` —con `available_quantity`
    declarado—, `dsm:cart/too-many-items`, `dsm:catalog/not-found`, `dsm:auth/csrf`,
    422 y 429); declaran el header `X-CSRF-Token` en las dos escrituras y el
    `Set-Cookie` de `dsm_cart`/`dsm_cart_csrf` como `headers` de respuesta; ninguno
    declara el token del carrito en el cuerpo. Queda anotado que al archivar forman la
    capacidad nueva `openspec/specs/carrito/`.
  - **Verify**: `npx @stoplight/spectral-cli lint openspec/changes/US-007-carrito-compra-backend/contracts/openapi/*.yaml`

- [ ] T7.2 Spec publicado del servicio + README + runbook
  - **Pattern**: en `apps/api/docs/api/openapi.yaml` el `/v1` vive en `servers`, así que
    los paths se declaran **sin** el prefijo (`/cart`, no `/v1/cart`) — `per
    api-standards.md §5 — el contrato declara todo campo y ruta que la API expone`,
    respetando la convención ya establecida del archivo.
  - **Exit criterion**: el spec publicado incorpora `/cart` (GET) y
    `/cart/items/{slug}` (PUT, DELETE) bajo un tag nuevo `cart` con `security: []`
    (superficie pública) y los schemas `Cart`, `CartItem`, `SetCartItemRequest`;
    `apps/api/README.md` documenta la superficie del carrito: rutas, semántica
    **absoluta** del `PUT`, cookies (`dsm_cart` / `dsm_cart_csrf`) y de **cuál** se lee
    el `X-CSRF-Token` en `/v1/cart/*` frente a `/v1/auth/*`, límites de rate-limit,
    la **ventana de retención de 7 días desde la última escritura** (con su costo
    declarado: el cliente que vuelve pasada la semana encuentra el carrito vacío) y las
    6 variables de entorno nuevas; `docs/services/dsm-ecommerce/runbook.md` gana la
    fila de day-2 «carrito perdido / carritos vencidos» con el procedimiento y la
    respuesta al reclamo típico: **la cookie es la identidad** (borrarla pierde el
    carrito y no hay forma de recuperarlo), **el carrito vive 7 días** desde la última
    modificación —no desde la última visita—, **la purga es oportunista** (la fila se
    borra al primer intento de usarla vencida) y **el job programado está diferido**;
    si los reclamos aparecen, `CART_TTL_DAYS` se sube por env **sin deploy de código**.
  - **Verify**: `npx @stoplight/spectral-cli lint apps/api/docs/api/openapi.yaml && grep -q '^  /cart:' apps/api/docs/api/openapi.yaml && grep -q '^  /cart/items/{slug}:' apps/api/docs/api/openapi.yaml && ! grep -q '^  /v1/cart' apps/api/docs/api/openapi.yaml && grep -q 'dsm_cart_csrf' apps/api/README.md && grep -q 'CART_TTL_DAYS' apps/api/README.md && grep -qi 'carrito' docs/services/dsm-ecommerce/runbook.md && grep -q '7 días' docs/services/dsm-ecommerce/runbook.md`

---

## Verification (suite-level)

- [ ] Unit + integration + e2e colocados pasan: `pnpm --filter @dsm/api test`
- [ ] Suite e2e-nest dedicada pasa: `pnpm --filter @dsm/api test:e2e`
- [ ] Lint + typecheck limpios: `pnpm --filter @dsm/api lint && pnpm --filter @dsm/api typecheck`
- [ ] **Esquema materializado == `design.md` §Persistencia (F40)**:
      `pnpm --filter @dsm/db migrate:deploy && pnpm --filter @dsm/api test -- --testPathPattern=cart-schema`
- [ ] Contratos válidos:
      `npx @stoplight/spectral-cli lint openspec/changes/US-007-carrito-compra-backend/contracts/openapi/*.yaml && npx @stoplight/spectral-cli lint apps/api/docs/api/openapi.yaml`
- [ ] **AC-8 — el carrito nunca toca el stock (ADR-0008)**:
      `pnpm --filter @dsm/api test -- --testPathPattern=e2e-cart-stock`
      (el spec lee `products.stock` antes y después del ciclo completo y falla si cambió
      en un solo caso)
- [ ] **Sin regresión de las superficies entregadas**:
      `pnpm --filter @dsm/api test -- --testPathPattern='e2e-storefront|e2e-auth|e2e-rbac|e2e-products|e2e-categories'`
      (storefront US-002/US-003, auth US-014 y admin US-001 responden igual — el tercer
      throttler, el `no-store` por prefijo y la extracción de `verifyRequestOrigin` son
      los tres puntos donde una regresión sería silenciosa)
- [ ] **Ningún token de carrito escapa por respuesta ni por log**:
      `pnpm --filter @dsm/api test -- --testPathPattern='e2e-cart-events|e2e-cart-security'`
- [ ] CI del monorepo verde: `pnpm -r lint && pnpm -r typecheck && pnpm -r test`

---

## Trazabilidad AC → tasks

| AC | Tasks | Estado |
|---|---|---|
| AC-1 (agregar un producto) | T0.1, T2.1, T2.3, T3.2, T3.3, T4.1, T4.2, T6.1 | en este change |
| AC-2 (editar la cantidad) | T2.1, T3.2, T3.3, T4.1, T6.1 | en este change |
| AC-3 (quitar un producto) | T2.1, T3.4, T4.2, T6.1 | en este change |
| AC-4 (persistencia entre visitas) | T0.1, T0.2, T1.1, T2.3, T6.2 | en este change — ventana de **7 días** deslizantes desde la última **escritura** (OQ-BE-1, decisión del PO 2026-08-22). Costo declarado: quien vuelve a las dos semanas encuentra el carrito vacío |
| AC-5 (cantidad limitada al stock) | T3.1, T3.2, T3.3, T6.3 | en este change — la **revalidación al confirmar** es de US-008 |
| AC-6 (producto que dejó de estar disponible) | T2.2, T3.2, T3.4, T5.1, T6.4 | en este change **la señal** (marca + `has_blocking_issues`); **impedir el avance al pago** es de US-008 |
| AC-7 (carrito vacío) | T3.4, T4.1, T6.2 | en este change |
| AC-8 (no reserva ni descuenta stock) | T3.3, T6.3 | en este change — invariante verificada, no sólo declarada |
| AC-9 (precios vigentes) | T3.2, T3.4, T4.4, T6.4 | en este change |
| AC-10 (no se agregan no publicados) | T2.2, T3.3, T6.4 | en este change — 404 idéntico al de un slug inexistente |

### Declaraciones de `design.md` que **no** son AC (F51)

| Declaración | Task | Estado |
|---|---|---|
| Migración: 2 tablas, 13 columnas, 5 índices, 3 FKs con reglas de borrado distintas, 2 CHECK (§Persistencia, F40) | T0.1 | en este change |
| Desviación declarada del DER: `session_token` → `session_token_hash`, `expires_at`, `updated_at` | T0.1 | en este change — declarada en `design.md`, sin CR del E2E |
| 6 variables de entorno validadas por Zod al arranque (§7) | T0.2 | en este change |
| Cookies `dsm_cart` / `dsm_cart_csrf` con atributos §7.4 en el módulo único de cookies | T1.1 | en este change |
| Extracción de `verifyRequestOrigin` (Extract Function, sin cambio de comportamiento) | T1.2 | en este change |
| CSRF double-submit firmado + `Origin` sobre una cookie que no es la de sesión (§7.5) | T1.3, T6.5 | en este change |
| Repositorio como único punto de ORM de `carts`/`cart_items` (§5) | T2.1 | en este change |
| Token opaco de 256 bits **hasheado** en reposo (§3.7) | T2.3 | en este change |
| Purga **oportunista** de carritos vencidos al resolver | T2.3, T6.2 | en este change |
| Deslizamiento conjunto de `expires_at` y `Max-Age`, sólo en escrituras | T2.3, T6.2 | en este change |
| Extension members RFC 7807 en `DomainError` + filtro (§3.2 del RFC) | T3.1 | en este change |
| Precio vigente en toda suma; la instantánea sólo alimenta `price_changed` | T3.2, T6.4 | en este change |
| `total_ars_cents` excluye las líneas bloqueadas (OQ-BE-4) | T3.2, T6.4 | en este change |
| `max_quantity` expuesto sólo en el carrito (OQ-BE-2, divulgación aceptada) | T3.2, T4.1 | en este change |
| Semántica **absoluta** del `PUT` ⇒ idempotencia natural sin `Idempotency-Key` (§10.5, OQ-BE-5) | T3.3, T4.2, T6.1 | en este change |
| Cota de líneas por carrito y de cantidad por línea (DoS, §7.3) | T3.3, T4.1 | en este change |
| `GET` seguro: no crea carrito ni emite cookie | T3.4, T6.2 | en este change |
| Tercer throttler nombrado + aislamiento de los presupuestos existentes (§7.3, §12) | T4.3 | en este change |
| `Cache-Control: no-store` en toda la superficie, **también en 4xx/429** (§7.1) | T4.4, T6.5 | en este change |
| `PUT`/`DELETE` en la allowlist de métodos CORS (§7.2) | T4.4 | en este change |
| 6 eventos de negocio sin PII, sin cardinalidad por carrito (E2E §18, US §9) | T5.1 | en este change |
| Contratos: 3 yaml draft + spec publicado + README + runbook (capacidad `carrito`) | T7.1, T7.2 | en este change |
| Columna `carts.customer_id` creada **sin escritor** | T0.1 (creación) | `Deferred: US futura de fusión invitado↔cuenta — owner: PO` (US §4). OQ-BE-3 resuelta: en v1 no pasa nada al iniciar sesión, y la política registrada para esa US es **sumar cantidades** con tope al stock |
| Ventana de retención de 7 días y su costo declarado (OQ-BE-1) | T0.2, T1.1, T2.3, T6.2, T7.2 | en este change — el número vive en `CART_TTL_DAYS`; el costo, en `design.md`, el README y el runbook |
| Job programado de purga de carritos vencidos | T2.3 (purga oportunista acotada) | `Deferred: US-019 / operaciones — owner: Arquitecto` (Redis no aprovisionado, ADR-0004) |
| Revalidación de stock al confirmar y bloqueo del avance al pago | — | `Deferred: US-008 (checkout) — owner: Arquitecto` (AC-5 y AC-6 lo nombran; la señal la entrega este change) |
| Decremento/reintegro de stock | — | `Deferred: US-010 — owner: Arquitecto` (ADR-0008) |
| Regla de rate-limit de borde sobre `/v1/cart/*` en Cloudflare | — | `Deferred: US-019 (infraestructura) — owner: Arquitecto` (defensa en profundidad, no reemplaza T4.3) |
| Carga k6 del carrito, E2E de navegador y BDD de aceptación cross-stack | — | `Deferred: /plan-qa US-007 — owner: QA` (`qa-backend-standards.md` §2.1) |
