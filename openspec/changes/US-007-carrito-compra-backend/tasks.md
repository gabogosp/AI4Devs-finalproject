---
parent-us: US-007
discipline: backend
language: es
estimate-hours: 7
---

# US-007 Backend — Tasks

> **Orden**: las fases van en dependencia estricta. La Fase 1 (migración) bloquea
> todo lo demás; la Fase 5 (e2e) necesita el controller de la Fase 4.

---

## Fase 1: Persistencia — 1,0 h

- [ ] T1.1 Migración: tablas `carts` y `cart_items`
  - **Pattern**: modelos Prisma en `packages/db/prisma/schema.prisma` + `prisma
    migrate dev`, siguiendo el estilo de `RefreshToken` (US-014): `@id
    @default(dbgenerated("gen_random_uuid()")) @db.Uuid`, FKs con `onDelete:
    Cascade`, `@@map` a snake_case — `per data-architecture-patterns — migración
    aditiva, sin ALTER sobre tablas en uso`.
  - **Exit criterion**: existen las dos tablas de `design.md` §Persistencia con
    **exactamente** sus columnas —`carts`: id, customer_id, session_token,
    expires_at, created_at, updated_at; `cart_items`: id, cart_id, product_id,
    quantity, unit_price_ars_cents, created_at— más `UNIQUE(carts.session_token)`,
    `UNIQUE(cart_items.cart_id, product_id)`, `CHECK (quantity > 0)`, los índices
    de `expires_at` y `cart_id`, y las dos FKs en cascada. La migración **no
    contiene ningún `ALTER TABLE products`** ni `categories`.
  - **Verify**: `pnpm --filter @dsm/db migrate:deploy && pnpm --filter @dsm/api test -- --testPathPattern=cart-schema`
    (integration contra Postgres real, espejo de `auth-schema.spec.ts`: compara el
    conjunto COMPLETO de columnas por tabla —falla si falta una **o si sobra una**,
    reconciliación F40—; verifica los índices; inserta `quantity: 0` y espera que
    la base lo **rechace**; inserta dos filas del mismo `(cart_id, product_id)` y
    espera violación del UNIQUE; borra un `cart` y verifica que sus `cart_items`
    desaparecen; y ancla que las columnas de `products` no cambiaron)

- [ ] T1.2 `CartsRepository` — único punto de ORM de `carts`
  - **Pattern**: clase `@Injectable()` que envuelve `PrismaService`, espejo de
    `CustomersRepository` — `per backend-node-standards.md §5 — el repositorio
    envuelve el ORM; los services no lo llaman directo`.
  - **Exit criterion**: expone `createForToken(tokenHash, expiresAt)`,
    `findActiveByTokenHash(tokenHash)` (devuelve `null` si `expires_at <= now()`,
    comparado **por Postgres** contra su reloj, no por Node contra el suyo),
    `touch(cartId, expiresAt)` (renueva el vencimiento y `updated_at`) y
    `purgeExpired(tokenHash)`. **Ningún método acepta ni devuelve el token en
    claro** — sólo su hash.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=carts.repository`
    (integration: crear + buscar por hash devuelve la fila; un carrito con
    `expires_at` en el pasado devuelve `null` aunque el hash coincida; `touch`
    corre el vencimiento hacia adelante y una búsqueda posterior lo encuentra;
    `purgeExpired` borra el vencido y **no** toca el vigente de otro token)

- [ ] T1.3 `CartItemsRepository`
  - **Pattern**: `upsert` de Prisma sobre la clave compuesta para el "agregar dos
    veces suma" de OQ-BE-4, con `increment` atómico en el `update` — `per
    backend-node-standards.md §5` y el precedente de `registerFailedLogin`
    (US-014): leer-sumar-escribir pierde incrementos bajo concurrencia.
  - **Exit criterion**: expone `addOrIncrement({cartId, productId, quantity,
    unitPriceArsCents})` (crea o **suma** sobre la fila existente en una sola
    sentencia), `listWithProducts(cartId)` (devuelve los ítems **con el producto
    unido**, incluido su `price_ars_cents`, `stock` y `status` vivos),
    `findByIdInCart(itemId, cartId)`, `updateQuantity(itemId, quantity)` y
    `remove(itemId)`. `findByIdInCart` filtra **por carrito**: un `itemId` de otro
    carrito devuelve `null`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=cart-items.repository`
    (integration: agregar el mismo producto dos veces deja **una** fila con la
    cantidad sumada; 5 `addOrIncrement` concurrentes del mismo producto dejan la
    suma exacta, ninguno se pierde; `listWithProducts` trae el precio y el stock
    **actuales** tras actualizar el producto por fuera; `findByIdInCart` con el id
    de un ítem de OTRO carrito devuelve `null` — sin esto, adivinar un uuid
    permitiría borrarle ítems a un tercero)

---

## Fase 2: Identidad del carrito — 0,7 h

- [ ] T2.1 Cookie `dsm_cart` + resolución del carrito
  - **Pattern**: reusar `newToken()`/`hashToken()` de
    `apps/api/src/auth/tokens/opaque-token.ts` (US-014) y un helper
    `setCartCookie(res, raw, opts)` que centralice los atributos, espejo de
    `auth/cookies.ts` — `per security-standards.md §3.7 — token de ≥128 bits de un
    CSPRNG, almacenado hasheado` y `§7.4 — cookies HttpOnly, SameSite=Lax`.
    **No se escribe una primitiva de tokens nueva.**
  - **Exit criterion**: `CART_TTL_DAYS` validada en `envSchema` con default `7`;
    la cookie `dsm_cart` sale con `HttpOnly`, `SameSite=Lax`, `Path=/`,
    `Max-Age` = `CART_TTL_DAYS` y `Secure` desde `AUTH_COOKIE_SECURE`; en la base
    se persiste **el hash**, nunca el claro; un `GET /v1/cart` sin cookie **no**
    emite cookie ni crea fila (creación perezosa); una mutación sin cookie crea
    carrito y emite la cookie.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=cart-cookie`
    (unit sobre el helper contra los `Set-Cookie` **reales** que serializa Express:
    los flags exactos; `Max-Age` = 7 días en segundos; con
    `AUTH_COOKIE_SECURE=false` desaparece `Secure`; y un test de que el valor de la
    cookie **no** coincide con ningún `session_token` de la tabla — es su hash)

---

## Fase 3: Servicio de caso de uso — 2,0 h

- [ ] T3.1 `CartService.getCart` — importes vigentes y disponibilidad (AC-1, AC-6, AC-7, AC-9)
  - **Pattern**: calcular en el service a partir del join del repositorio; el
    precio que multiplica es **`product.price_ars_cents`**, nunca
    `item.unit_price_ars_cents` — `per backend-node-standards.md §2 — la lógica de
    caso de uso vive en el service` y AC-9.
  - **Exit criterion**: devuelve `{ items[], total_ars_cents, item_count }`; cada
    ítem trae `availability` (`available` | `unpublished` | `out_of_stock`),
    `unit_price_ars_cents` (**el vivo**), `unit_price_ars_cents_at_add` y
    `price_changed`; el `total_ars_cents` **excluye** los ítems no disponibles;
    un carrito inexistente o vencido devuelve `items: []` con totales en 0 y **sin
    lanzar** (AC-7); ningún ítem se borra ni se le ajusta la cantidad
    automáticamente (AC-6).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=cart.service`
    (integration: cambiar el precio del producto por fuera y verificar que el
    subtotal y el total del carrito reflejan **el nuevo** y que `price_changed` es
    `true`; despublicar un producto y verificar que su ítem sale `unpublished`,
    **sigue en la lista** y **no** suma al total; bajar el stock por debajo de la
    cantidad y verificar `out_of_stock`; un token inventado devuelve el carrito
    vacío sin excepción)

- [ ] T3.2 `CartService.addItem` (AC-1, AC-5, AC-10)
  - **Pattern**: validar el producto → resolver o crear el carrito → `addOrIncrement`,
    todo dentro de `prisma.$transaction` cuando hay más de una escritura — `per
    backend-node-standards.md §5 — transacción para casos de uso multi-escritura,
    sin escrituras parciales ante fallo`.
  - **Exit criterion**: un producto `draft` o `archived` o inexistente lanza
    `ProductNotPurchasableError` (409) con el **mismo** mensaje en los tres casos
    (AC-10, sin oráculo de qué SKUs existen en borrador) y **no** crea ni carrito
    ni ítem; una cantidad que supera `product.stock` lanza
    `InsufficientStockError` (409) cuyo `errors[]` **sí** informa el máximo
    disponible; el tope duro de 99 se aplica aunque el stock sea mayor; agregar
    dos veces el mismo producto suma la cantidad sin crear una segunda fila;
    `unit_price_ars_cents` se persiste con el precio del momento.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=cart.service`
    (integration: los tres modos de `ProductNotPurchasableError` producen errores
    `deepEqual` en `type` y `detail`; tras un alta fallida `prisma.cart.count()` y
    `cartItem.count()` **no** cambiaron —la transacción no dejó el carrito huérfano—;
    pedir `stock + 1` lanza y el `errors[]` contiene el stock real; pedir 100 con
    stock 500 lanza por el tope)

- [ ] T3.3 `CartService.updateQuantity` y `removeItem` (AC-2, AC-3, AC-5)
  - **Exit criterion**: `updateQuantity` valida contra el stock vivo y el tope de
    99 con los **mismos** errores que `addItem`; un `itemId` que no pertenece al
    carrito de la cookie lanza `CartItemNotFoundError` (404) — **el mismo** que un
    `itemId` inexistente; `removeItem` es idempotente en el sentido de que borrar
    dos veces el mismo ítem lanza 404 la segunda, no un 500; ninguna de las dos
    toca `products`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=cart.service`
    (integration: armar DOS carritos y verificar que el `itemId` del carrito A da
    404 desde el carrito B, **idéntico** al de un uuid inventado — sin esto,
    adivinar un uuid permite manipular el carrito de un tercero; editar a una
    cantidad válida recalcula el total; quitar el último ítem deja el carrito
    existente y vacío, no lo borra)

- [ ] T3.4 **AC-8 — el carrito NO reserva ni descuenta stock**
  - **Pattern**: no hay patrón que aplicar; el criterio es la **ausencia** de
    escritura sobre `products`. La task existe porque un negative space sin test
    es una promesa sin evidencia — `per ADR-0008 — el decremento ocurre sólo al
    aprobarse el pago`.
  - **Exit criterion**: ningún camino de esta US escribe en `products`. El stock
    se lee para comparar y nada más. No existe columna de reserva, contador de "en
    carritos" ni tabla intermedia.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=cart-no-reserva`
    (integration: un producto con `stock: 3`; **dos carritos distintos** agregan 3
    unidades cada uno; **las dos operaciones tienen éxito** y
    `products.stock` sigue en 3. Un test sobre un solo carrito no distinguiría "no
    reserva" de "reserva y todavía no la usó". Además: un `grep` que falla si
    aparece `prisma.product.update` o `products SET stock` en `src/cart/`)

---

## Fase 4: Borde HTTP — 1,3 h

- [ ] T4.1 Errores de dominio `dsm:cart/*`
  - **Pattern**: subclases de la `DomainError` existente con `readonly status` y
    `readonly type`, en `apps/api/src/common/errors/cart-errors.ts` — `per
    backend-node-standards.md §6 — errores de dominio tipados mapeados
    centralmente, nunca HttpException ad-hoc en services`. El
    `HttpProblemFilter` **no se modifica**.
  - **Exit criterion**: `CartItemNotFoundError` (404 `dsm:cart/item-not-found`),
    `ProductNotPurchasableError` (409 `dsm:cart/product-not-purchasable`) e
    `InsufficientStockError` (409 `dsm:cart/insufficient-stock`) atraviesan
    `mapErrorToProblem` produciendo su `type`/`status`/`title`; ningún `detail`
    contiene el `session_token`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=cart-errors`
    (unit sobre `mapErrorToProblem`: las 3 clases dan el `type` y `status`
    esperados **sin agregar ninguna rama al filtro**; los 3 `type` son distintos
    entre sí y todos empiezan con `dsm:cart/`)

- [ ] T4.2 DTOs de entrada y de respuesta
  - **Pattern**: `class-validator` sobre el DTO de entrada + DTO de respuesta con
    `static from()`, construido **campo por campo** — `per
    backend-node-standards.md §4 — todo input de controller es un DTO validado en
    el borde; DTO de respuesta separado de la entidad de persistencia`. El
    `ValidationPipe` global ya corre con `whitelist` + `forbidNonWhitelisted` +
    422.
  - **Exit criterion**: `AddCartItemDto` (`product_id` `@IsUUID`, `quantity`
    `@IsInt` `@Min(1)` `@Max(99)`) y `UpdateCartItemDto` (`quantity` ídem);
    ninguno declara `unit_price_ars_cents` ni `cart_id`, así que enviarlos da
    **422**; `CartResponseDto` emite **exactamente** `{ items, total_ars_cents,
    item_count }` y cada ítem exactamente `{ id, product_id, slug, name,
    image_url, quantity, unit_price_ars_cents, unit_price_ars_cents_at_add,
    price_changed, subtotal_ars_cents, availability }` — sin `cart_id`, sin
    `session_token`, sin el `stock` numérico del producto.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-cart-items`
    (e2e: mandar `unit_price_ars_cents` en el body da 422 —si el cliente pudiera
    fijar el precio, fijaría uno—; `quantity: 0` da 422; `quantity: 100` da 422;
    un `product_id` que no es uuid da 422; y `Object.keys` de la respuesta y de un
    ítem son **exactamente** los conjuntos declarados)

- [ ] T4.3 `CartController` + módulo + cableado
  - **Pattern**: `@Controller('v1/cart')` **sin** guard de auth (superficie
    guest); el carrito se resuelve desde la cookie en cada handler — `per
    backend-node-standards.md §2 — controller fino: valida, delega, mapea`.
    `CartModule` importa `ProductsModule` (que exporta el repositorio de
    productos) y se registra en `AppModule`.
  - **Exit criterion**: responden las 4 rutas — `GET /v1/cart` (200),
    `POST /v1/cart/items` (201), `PATCH /v1/cart/items/{itemId}` (200),
    `DELETE /v1/cart/items/{itemId}` (204); las mutaciones emiten la cookie
    `dsm_cart` cuando no había; `GET` sin cookie devuelve el carrito vacío **sin**
    emitirla; **el `session_token` no aparece en ningún cuerpo de respuesta**; las
    rutas de US-001/US-002/US-003 siguen respondiendo igual.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-cart`
    (e2e: las 4 rutas existen —ninguna da 404 de ruta—; el ciclo completo agregar →
    ver → editar → quitar con la cookie devuelta por la primera respuesta; `GET`
    sin cookie da 200 con `items: []` y **sin** `Set-Cookie`;
    `JSON.stringify(body)` no contiene el valor de la cookie)

- [ ] T4.4 Rate limit del carrito
  - **Pattern**: **tercer** throttler nombrado `cart` en el array de
    `ThrottlerModule` + `@UseGuards` en el controller con `@SkipThrottle` de los
    otros dos, espejo de cómo `AdminAuthController` scopea el suyo — `per
    security-standards.md §7.3`. Se agrega uno para **toda** la superficie de
    carrito, no uno por ruta.
  - **Exit criterion**: las mutaciones van a 60 / 15 min por IP y al excederlo
    devuelven **429** con `Retry-After` y `RateLimit-*` en envelope
    `application/problem+json`; `GET /v1/cart` usa el throttler `storefront`
    existente; el array pasa a tener **exactamente tres** throttlers (`auth`,
    `storefront`, `cart`) y **los presupuestos de `auth` y `storefront` no
    cambian**.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-cart-ratelimit`
    (e2e con `TRUST_PROXY_HOPS=1` e IP por test: la mutación 61 da 429 con las
    cabeceras y el content-type; en la misma corrida un `POST /v1/auth/login` y un
    `GET /v1/products/{slug}` **siguen respondiendo** —los presupuestos no se
    contaminaron—; y se lee `getOptionsToken()` del contenedor para verificar que
    los nombres son exactamente `['auth','cart','storefront']`)

---

## Fase 5: Cobertura e2e de los AC — 1,2 h

- [ ] T5.1 e2e del ciclo del carrito (AC-1, AC-2, AC-3, AC-7)
  - **Exit criterion**: agregar dos productos, editar la cantidad de uno, quitar
    el otro, y verificar en cada paso el `total_ars_cents` y el `item_count`
    calculados a mano en el test; el carrito vacío devuelve `items: []` con
    totales en 0.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-cart-lifecycle`

- [ ] T5.2 e2e de persistencia entre visitas (AC-4)
  - **Exit criterion**: armar un carrito, **descartar toda la sesión HTTP** y
    volver enviando **sólo** la cookie: el carrito sigue con sus ítems; un carrito
    cuya fila tiene `expires_at` en el pasado devuelve vacío aunque la cookie sea
    válida; tocar el carrito **renueva** el vencimiento (`touch`), de modo que un
    cliente que vuelve cada 6 días no lo pierde nunca.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-cart-persistence`

- [ ] T5.3 e2e de disponibilidad y precios (AC-5, AC-6, AC-9, AC-10)
  - **Exit criterion**: con el carrito armado, despublicar un producto por la API
    admin y verificar que el `GET` lo marca `unpublished`, lo **mantiene** en la
    lista y lo **excluye** del total; cambiar el precio y verificar que el total
    refleja el nuevo y `price_changed` es `true`; intentar agregar un producto
    `draft` da 409; pedir más del stock da 409 con el máximo en `errors[]`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-cart-availability`

---

## Fase 6: Observabilidad — 0,4 h

- [ ] T6.1 `CartEventsService` — 5 eventos sin PII
  - **Pattern**: espejo de `AuthEventsService` (US-014): contador en memoria +
    log estructurado, `entity_id` en el **log** y nunca como dimensión de métrica
    — `per observability-patterns §3.3` y `observability-standards §9`.
  - **Exit criterion**: se emiten `cart.item_added`, `cart.item_updated`,
    `cart.item_removed`, `cart.viewed` y `cart.item_unavailable_shown` en sus
    momentos; **ningún** evento ni log de la superficie de carrito contiene el
    `session_token`, ni en claro ni hasheado; los contadores no llevan dimensión
    por carrito ni por producto.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-cart-observability`
    (e2e con el logger capturado: el recorrido completo produce los 5 contadores
    esperados; el volcado **completo** de logs de la corrida no contiene el valor
    de la cookie ni su hash — un test que sólo mirara los eventos propios no vería
    una fuga por una excepción con el request adentro)

---

## Fase 7: Contratos y documentación — 0,4 h

- [ ] T7.1 Cuatro contratos OpenAPI draft + lint
  - **Pattern**: un yaml autocontenido por endpoint en `contracts/openapi/`
    (`cart-get`, `cart-items-post`, `cart-items-patch`, `cart-items-delete`), con
    `components.schemas` del request/response, `components.responses` RFC 7807 con
    el `type` URI canónico y la cookie declarada como `securityScheme` de tipo
    `apiKey`/`cookie` — `per api-contract-completeness — 1 yaml por endpoint +
    catálogo de errores RFC 7807 cerrado`. Los `$ref` internos usan la forma
    `../../openapi.yaml#/components/...` **sólo** al archivar; en el change son
    autocontenidos.
  - **Exit criterion**: los 4 archivos validan como OpenAPI 3.x con **0 errores**
    de spectral y coinciden con la implementación (rutas, shapes y el catálogo
    `dsm:cart/item-not-found`, `dsm:cart/product-not-purchasable`,
    `dsm:cart/insufficient-stock` + 422 + 429); ninguno declara el `session_token`
    en un cuerpo de respuesta. Queda anotado que al archivar se suman a la
    capacidad **`catalogo`** (el carrito opera sobre el catálogo) o a una
    capacidad `ventas` nueva — **decisión a tomar en el archivado, no acá**.
  - **Verify**: `npx @stoplight/spectral-cli lint openspec/changes/US-007-carrito-compra-backend/contracts/openapi/*.yaml`

- [ ] T7.2 Spec publicado + README
  - **Pattern**: en `apps/api/docs/api/openapi.yaml` el `/v1` vive en `servers`,
    así que los paths se declaran **sin** el prefijo (`/cart`, no `/v1/cart`) —
    `per api-standards.md §5`, respetando la convención ya establecida del archivo.
  - **Exit criterion**: el spec publicado incorpora las 4 rutas bajo un tag nuevo
    `cart` con `security: []`, más el `securityScheme` de la cookie `dsm_cart`;
    `apps/api/README.md` documenta la superficie: rutas, atributos de la cookie,
    `CART_TTL_DAYS`, los límites de rate-limit, y **explícitamente** que el carrito
    no reserva stock (ADR-0008) con el enlace al ADR.
  - **Verify**: `npx @stoplight/spectral-cli lint apps/api/docs/api/openapi.yaml && grep -q '^  /cart:' apps/api/docs/api/openapi.yaml && grep -q 'dsm_cart' apps/api/README.md && grep -q 'ADR-0008' apps/api/README.md`

---

## Verification (suite-level)

- [ ] Unit + integration + e2e colocados pasan: `pnpm --filter @dsm/api test`
- [ ] Suite e2e-nest dedicada pasa: `pnpm --filter @dsm/api test:e2e`
- [ ] Lint + typecheck limpios: `pnpm --filter @dsm/api lint && pnpm --filter @dsm/api typecheck`
- [ ] Esquema materializado == `design.md` §Persistencia (F40):
      `pnpm --filter @dsm/db migrate:deploy && pnpm --filter @dsm/api test -- --testPathPattern=cart-schema`
- [ ] **AC-8 verificado**: `pnpm --filter @dsm/api test -- --testPathPattern=cart-no-reserva`
- [ ] **Sin regresión del catálogo**: `pnpm --filter @dsm/api test -- --testPathPattern='e2e-storefront|e2e-products|e2e-categories'`
- [ ] **El token del carrito no escapa**: `pnpm --filter @dsm/api test -- --testPathPattern='e2e-cart-observability|e2e-cart'`
- [ ] Contratos válidos: `npx @stoplight/spectral-cli lint openspec/changes/US-007-carrito-compra-backend/contracts/openapi/*.yaml && npx @stoplight/spectral-cli lint apps/api/docs/api/openapi.yaml`
- [ ] CI del monorepo verde: `pnpm -r lint && pnpm -r typecheck && pnpm -r test`

---

## Trazabilidad AC → tasks

| AC | Tasks | Estado |
|---|---|---|
| AC-1 (agregar producto) | T1.3, T3.1, T3.2, T4.3, T5.1 | en este change |
| AC-2 (editar cantidad) | T3.3, T4.3, T5.1 | en este change |
| AC-3 (quitar producto) | T3.3, T4.3, T5.1 | en este change |
| AC-4 (persistencia entre visitas) | T1.2, T2.1, T5.2 | en este change — TTL 7 días (OQ-BE-2) |
| AC-5 (cantidad limitada al stock) | T3.2, T3.3, T5.3 | en este change — la revalidación en checkout es US-008 |
| AC-6 (producto no disponible) | T3.1, T5.3 | **parcial**: el backend lo **marca**; impedir avanzar al pago es US-008 |
| AC-7 (carrito vacío) | T3.1, T4.3, T5.1 | en este change — el estado vacío visual es FE |
| AC-8 (no reserva ni descuenta stock) | **T3.4**, T5.3 | en este change — negative space con test dedicado |
| AC-9 (precios vigentes) | T3.1, T5.3 | en este change |
| AC-10 (no se agregan no publicados) | T3.2, T5.3 | en este change |

### Declaraciones de `design.md` que **no** son AC (F51)

| Declaración | Task | Estado |
|---|---|---|
| Migración: 2 tablas, 11 columnas, 2 UNIQUE, 1 CHECK, 4 índices, 2 FK en cascada | T1.1 | en este change |
| `expires_at` y `updated_at` **agregadas al DER** (el DER no fijó política de expiración) | T1.1 | en este change — delta declarado |
| `session_token` guardado **hasheado** (§3.7), no en claro | T1.2, T2.1 | en este change |
| Creación perezosa: sólo las mutaciones crean carrito | T2.1, T4.3 | en este change |
| Tope duro de 99 unidades por ítem (integridad, no negocio) | T3.2, T4.2 | en este change |
| `ProductNotPurchasableError` no distingue inexistente de no publicado | T3.2 | en este change |
| `InsufficientStockError` **sí** informa el máximo disponible | T3.2 | en este change |
| Aislamiento entre carritos: un `itemId` ajeno da 404 | T1.3, T3.3 | en este change |
| Throttler `cart` nuevo (tercero), presupuestos existentes intactos | T4.4 | en este change |
| 5 eventos sin PII y sin el token en logs | T6.1 | en este change |
| Contratos: 4 yaml + spec publicado + README | T7.1, T7.2 | en este change |
| `carts.customer_id` creada pero **sin endpoint que la escriba** | T1.1 (creación) | `Deferred: fusión guest→cuenta — owner: PO` (OQ-BE-3) |
| Purga programada de carritos vencidos (job BullMQ) | T1.2 (limpieza oportunista acotada) | `Deferred: US-019 / operaciones — owner: Arquitecto` (Redis no provisionado, ADR-0004) |
| Capacidad destino de los contratos al archivar (`catalogo` vs `ventas` nueva) | T7.1 | **decisión abierta para el archivado** |
