---
parent-us: US-007
discipline: backend
variant: null
language: es
---

# US-007 Backend — Design

## Context

Tres hechos del repo AS-BUILT (verificados al planificar, 2026-08-20) enmarcan todo
lo que sigue:

1. **No hay carrito en ningún lado.** `packages/db/prisma/schema.prisma` tiene
   `Category`, `Product`, `Customer`, `RefreshToken`, `PasswordResetToken`,
   `ImportJob`, `ImportJobRow`. El DER del E2E §8 declara `CARTS` y `CART_ITEMS`
   pero nunca se materializaron.
2. **La superficie pública es de sólo lectura.** `apps/api/src/storefront/` expone
   ficha y categorías sin auth, con throttler `storefront` por IP y `Cache-Control`
   estampado sólo en 2xx. Todo lo que escribe está detrás de `AdminGuard` (`/v1/admin/*`)
   o del seam de auth (`/v1/auth/*`). El carrito es la **primera escritura pública**.
3. **La identidad que existe es de cliente registrado**, no de invitado. US-014
   construyó sesión por cookie (`dsm_access`, `dsm_refresh`, `dsm_csrf`) con CSRF
   double-submit derivado del `jti` del access. Un invitado **no tiene `jti`**, así
   que el mecanismo existente no se puede reusar tal cual.

Y un cuarto hecho que no es del repo sino de la arquitectura: **ADR-0008 ya decidió
cuándo se descuenta el stock** (al aprobarse el pago, con `UPDATE` condicional
atómico) y rechazó explícitamente la reserva con TTL. Este diseño se subordina a esa
decisión: no la enmienda, no la bordea, y hace que su consecuencia negativa declarada
(«sell-out entre el add-to-cart y la aprobación del pago») sea **visible** en la
lectura del carrito en vez de sorpresiva en el checkout.

## Goals

- Un carrito que funciona **sin cuenta** y sobrevive al cierre del navegador (AC-4).
- Precios **siempre vigentes** en la lectura, con el cambio señalado (AC-9).
- Cantidad acotada al stock **sin reservarlo** (AC-5 + AC-8).
- Productos que dejaron de estar disponibles **marcados, no borrados** (AC-6).
- Una superficie de escritura pública con los controles §7 completos, no «los
  agregamos después».
- Cero churn en las superficies ya entregadas (storefront US-002/US-003, auth US-014,
  admin US-001).

## Non-goals

- Crear órdenes, tocar `orders` o hablar con MercadoPago (US-008/US-009).
- Escribir, reservar o decrementar `products.stock` (US-010, ADR-0008).
- Fusionar el carrito invitado con la cuenta (US §4, fuera de v1).
- Cupones, descuentos, envío, impuestos separados (el precio ya es final con IVA).
- Cola/worker para purgar carritos vencidos (Redis no aprovisionado).

---

## Decisión 1: ¿cómo se identifica un carrito sin cuenta?

Es **la** decisión de este change: define la persistencia (AC-4), la seguridad de la
frontera y qué pasa al iniciar sesión.

| Opción | Cómo | Por qué no / por qué sí |
|---|---|---|
| **A. Token opaco en cookie `httpOnly` propia + fila en Postgres** ✅ | El servidor genera 256 bits de CSPRNG, guarda el **hash** en `carts.session_token_hash`, manda el claro en `dsm_cart` | **Elegida.** Sobrevive al cierre del navegador; el claro no es legible por JS (un XSS no roba carritos); no adivinable (2²⁵⁶); no enumerable (no hay id en la URL); y una fuga de base no entrega carritos usables (misma disciplina que ADR-0011) |
| B. Carrito entero en el cliente (localStorage / cookie con el contenido) | El servidor no guarda nada | Rechazada: el precio y el stock hay que resolverlos server-side igual, así que la lectura no se abarata; y un carrito manipulado por el cliente llega al checkout con precios inventados — mover esa validación al checkout es peor lugar para el mismo trabajo |
| C. `cart_id` (UUID) en la URL o en un header | `GET /v1/carts/{id}` | Rechazada: sin dueño verificable, conocer el UUID **es** el permiso, y el UUID se filtra por Referer, logs de proxy, historial y compartir-enlace. La opción A hace la IDOR **estructuralmente imposible** en vez de depender de un chequeo |
| D. Colgar el carrito de la sesión de US-014 | `carts.customer_id` como identidad | Rechazada de plano: el PRD (§2.1 cap. 4, §7) hace del guest checkout el camino **principal**. Exigir cuenta para armar un carrito rompe la capacidad 4 |

**Consecuencias declaradas de A**:

- El carrito es **por navegador**, no por persona. Dos dispositivos = dos carritos.
  Eso es exactamente lo que la US §4 difiere al sacar la fusión del alcance.
- Iniciar sesión **no cambia nada**: el carrito del invitado sigue accesible por su
  cookie, no se pierde ni se fusiona. Es el comportamiento visible que OQ-BE-3 pide
  confirmar.
- Borrar cookies = perder el carrito. Aceptado y documentado.
- `carts.customer_id` se crea (está en el DER) y queda **sin escritor**: escribirlo
  sin un lector sería dato muerto (`AGENTS.md` §1.2). El día de la fusión, esa
  columna es donde aterriza el vínculo.

### Desviación declarada respecto del DER (E2E §8)

El DER declara `CARTS { uuid id PK; uuid customer_id FK; string session_token;
timestamp created_at }`. Este diseño materializa:

- `session_token` → **`session_token_hash`**. Guardar el token en claro es lo mismo
  que guardar una contraseña en claro: quien lea la tabla se lleva las sesiones de
  compra. Precedente directo: `refresh_tokens.token_hash` y
  `password_reset_tokens.token_hash` (ADR-0011). Es un cambio de forma de la misma
  columna, no un concepto nuevo.
- **`expires_at`** (nueva) y **`updated_at`** (nueva) — el DER no modela retención y
  AC-4 la exige («dentro del período de persistencia»). Sin una columna de
  vencimiento, «período de persistencia» no es verificable ni purgar es posible.

Ninguna de las dos es material a nivel arquitectura (no cambia el motor, ni las
relaciones, ni un contrato cross-stack), así que se declara acá y **no** se abre un
CR del E2E — mismo tratamiento que US-014 le dio a las columnas operativas de
`customers` y a las dos tablas de tokens que el DER no tenía.

---

## Decisión 2: stock — qué se valida, cuándo, y qué NO se hace

ADR-0008 es la autoridad. Traducida a este change:

| Momento | Qué hace el carrito | Qué NO hace |
|---|---|---|
| **Escritura** (`PUT` de cantidad) | Lee `products.stock` y rechaza con **409 `dsm:cart/insufficient-stock`** si `quantity > stock`, con la cantidad disponible en el cuerpo (AC-5) | No reserva, no bloquea la fila, no escribe `stock` |
| **Lectura** (`GET`) | Re-evalúa cada línea contra el stock actual y la marca `insufficient_stock` con su `available_quantity` (AC-6) | No corrige la cantidad sola, no borra la línea |
| **Checkout** (US-008) | — | Revalida antes de crear la orden (AC-5 «se revalida al confirmar») |
| **Pago aprobado** (US-010) | — | `UPDATE products SET stock = stock - :q WHERE id = :id AND stock >= :q` (ADR-0008) |

**Por qué el rechazo y no el clamp silencioso**: AC-5 dice «no permite superar el
stock disponible». Recortar la cantidad sin avisar entrega un carrito distinto del
que el cliente pidió; el 409 con `available_quantity` deja al FE poner el tope en el
stepper y explicar por qué.

**Qué pasa si el stock cae entre el agregado y la compra** — que es la consecuencia
negativa que ADR-0008 aceptó explícitamente:

1. Se detecta en la **lectura del carrito** (`GET`): la línea queda
   `insufficient_stock` y `has_blocking_issues: true`.
2. Se vuelve a detectar en el **checkout** (US-008), que es quien impide avanzar.
3. Y si aun así se colara, el `UPDATE` condicional + `CHECK (stock >= 0)` de
   ADR-0008 son la última red: la transacción no puede oversell.

Tres capas, ninguna de las cuales requiere reservar. **No se propone ninguna
desviación de ADR-0008, así que este change no dispara ningún ADR nuevo.**

---

## Decisión 3: precio — vigente al leer, con el cambio visible

AC-9 y el PRD (§11, precios en ARS con IVA incluido) no dejan margen: los importes
que ve el cliente son los **vigentes**. Pero el DER declara
`CART_ITEMS.unit_price_ars_cents`, y una columna que guarda precio y no se usa es una
trampa esperando a que alguien la use para calcular.

**Regla, escrita para que no haya ambigüedad al implementar**:

- **Todo importe** (`unit_price_ars_cents` de la respuesta, `subtotal_ars_cents`,
  `total_ars_cents`) se calcula con `products.price_ars_cents` **leído en la misma
  request**. La columna guardada **nunca** entra en una suma.
- `cart_items.unit_price_ars_cents` es una **instantánea del precio en el momento en
  que el cliente tocó la línea por última vez** (`PUT`). Su único uso es comparar:
  si difiere del vigente, la respuesta trae `price_changed: true` y
  `previous_unit_price_ars_cents`.
- El flag se **apaga** cuando el cliente vuelve a tocar la línea (el `PUT` re-sella
  la instantánea). Semántica legible: «desde que lo agregaste, esto cambió».
- `Cache-Control: no-store` en toda la superficie del carrito: sin esto, AC-9 se cae
  por una caché intermedia aunque el cálculo esté perfecto.

Qué ve el cliente si el precio cambió: **el precio nuevo**, más una marca de que
cambió. No se congela el precio viejo (no es una promesa comercial que el negocio
haya hecho) ni se cambia en silencio (es dinero).

---

## Decisión 4: disponibilidad — marcar, no borrar

Estados por línea (`availability`):

| Valor | Cuándo | Efecto |
|---|---|---|
| `available` | producto `published` y `stock >= quantity` | suma al `total_ars_cents` |
| `insufficient_stock` | producto `published` y `0 <= stock < quantity` | no suma al total; trae `available_quantity`; prende `has_blocking_issues` |
| `unavailable` | producto en `draft` o `archived` | no suma al total; prende `has_blocking_issues` |

**La línea nunca se borra sola.** Un carrito que se vacía solo entre dos visitas es
indistinguible de un bug, y el cliente pierde la información de *qué* quería. AC-6
pide «señala ese producto como no disponible», no «lo quita».

Un producto **borrado de verdad** no es un estado posible: US-001 archiva, no borra, y
la FK `cart_items.product_id` es `ON DELETE RESTRICT`, así que la base impide que un
producto con líneas en carritos desaparezca. Eso reduce AC-6 a los dos casos de
arriba y no hace falta manejar líneas huérfanas.

**Total**: `total_ars_cents` suma **sólo** las líneas `available` (OQ-BE-4). Un total
que incluye lo que no se puede comprar es un número que el checkout va a desmentir.
Cada línea igual expone su propio `subtotal_ars_cents`, así que el FE puede mostrar
el detalle completo.

---

## Approach

### Estructura de módulo

```
apps/api/src/cart/
├── cart.module.ts               # cablea controller + service + repo + guards
├── cart.controller.ts           # borde HTTP fino: valida, delega, mapea
├── cart.service.ts              # casos de uso (getCart / setItem / removeItem)
├── carts.repository.ts          # ÚNICO punto de ORM de carts + cart_items (§5)
├── cart-token.service.ts        # token opaco + hash + emisión de cookies
├── cart-csrf.guard.ts           # double-submit firmado + Origin (§7.5)
├── cart-throttler.guard.ts      # headers RateLimit-* (espejo del de storefront)
├── cart-view.ts                 # función PURA: precio vigente + disponibilidad
└── dto/
    ├── set-cart-item.dto.ts     # entrada (quantity)
    └── cart.dto.ts              # respuesta
```

Fuera del módulo, tres extensiones acotadas de código existente:

- `apps/api/src/auth/cookies.ts` — se agregan `CART_COOKIE`, `CART_CSRF_COOKIE`,
  `setCartCookies`, `clearCartCookies`. **No** se crea un segundo hogar de atributos
  de cookie: ese archivo declara explícitamente que los atributos «viven acá y en
  ningún otro lado», y un `res.cookie()` suelto en el controller del carrito es
  exactamente el modo de perder el `HttpOnly`.
  *(Si aparece un tercer consumidor, el módulo se muda a `common/http/cookies.ts`.
  Con dos, mudarlo es churn sin beneficio.)*
- `apps/api/src/common/http/origin.ts` — se **extrae** `verifyRequestOrigin` desde
  `csrf.guard.ts` para que los dos guards compartan la verificación de `Origin`
  (Extract Function, sin cambio de comportamiento; los tests de CSRF de auth son el
  guardarraíl).
- `apps/api/src/common/errors/domain-errors.ts` + `http-problem.filter.ts` — se
  agrega soporte de **extension members** de RFC 7807 (§3.2) para poder devolver
  `available_quantity` en el 409 de stock de forma estructurada, no incrustada en una
  frase.

### API — superficie nueva

Todo bajo `/v1/cart`, sin auth, sin `AdminGuard`, sin `CustomerGuard`.

| Método | Ruta | Cuerpo | Respuesta | Errores |
|---|---|---|---|---|
| `GET` | `/v1/cart` | — | `200` `CartDto` (vacío si no hay cookie) | `429` |
| `PUT` | `/v1/cart/items/{slug}` | `{ "quantity": 1..99 }` | `200` `CartDto` | `403` CSRF · `404` producto · `409` stock · `409` demasiadas líneas · `422` validación · `429` |
| `DELETE` | `/v1/cart/items/{slug}` | — | `200` `CartDto` | `403` CSRF · `429` |

**Por qué `PUT` con cantidad absoluta y no `POST` con cantidad relativa** (OQ-BE-5):

- `PUT` sobre `/v1/cart/items/{slug}` es **naturalmente idempotente**
  (`api-standards.md` §10.5), así que **no** hace falta `Idempotency-Key` ni el
  almacén de respuestas de §10.2. Un `POST` de suma relativa sí lo exigiría: es un
  endpoint público de escritura con reintentos de red, y sin idempotencia un
  reintento duplica unidades. Evitar una tabla de claves de idempotencia y su purga
  para un MVP de ~50 concurrentes es KISS aplicado (`base-standards.md` §1).
- El precio a pagar: un doble clic en «Agregar» desde la ficha, con el FE mandando
  `quantity: 1` dos veces, deja **1 unidad**, no 2. Es el comportamiento seguro
  (nunca compra de más por un reintento), y el FE siempre tiene la cantidad actual
  porque **las tres respuestas devuelven el carrito completo**.
- Todas las respuestas devuelven el carrito entero justamente para esto: el cliente
  nunca tiene que adivinar el estado ni encadenar un `GET`.

**Identificador del producto = `slug`**: `StorefrontProductDto` y
`StorefrontProductListItemDto` deliberadamente **no exponen `id`** (OQ-BE-3 de
US-003: no filtrar identificadores ni gestión). El slug es el identificador público
del producto en este sistema. Cumple el espíritu de `api-standards.md` §2.3 (no
enumerable, no filtra volumen); pedir un UUID obligaría a exponer `id` en el
storefront y sería una regresión de US-003.

### Forma de la respuesta

```jsonc
{
  "cart": {
    "id": "9b2f…",                    // UUID; conocerlo NO da acceso (el acceso es la cookie)
    "items": [
      {
        "slug": "amoladora-angular-115mm",
        "name": "Amoladora angular 115mm",
        "image_url": "https://…",
        "quantity": 2,
        "unit_price_ars_cents": 185000,   // VIGENTE, de products
        "currency": "ARS",
        "subtotal_ars_cents": 370000,
        "availability": "available",       // available | insufficient_stock | unavailable
        "available_quantity": 5,           // presente sólo si availability != available
        "max_quantity": 5,                 // min(stock, CART_MAX_QTY_PER_LINE) — OQ-BE-2
        "price_changed": true,
        "previous_unit_price_ars_cents": 179000
      }
    ],
    "item_count": 1,                   // líneas distintas
    "total_quantity": 2,               // unidades
    "total_ars_cents": 370000,         // suma SÓLO de líneas `available`
    "has_blocking_issues": false,
    "updated_at": "2026-08-20T12:00:00.000Z"
  }
}
```

Carrito vacío (AC-7): `id: null`, `items: []`, todos los contadores en 0,
`has_blocking_issues: false`. **200, no 404** — «no tengo carrito» es un estado
válido del recurso, no un recurso ausente.

**Sobre `max_quantity`** (OQ-BE-2): expone indirectamente el nivel de stock cuando es
bajo, algo que US-003 evita en el browse público. Es una excepción **acotada y
deliberada**: (a) el comprador necesita el tope para el stepper, (b) la información
ya es obtenible probando cantidades contra el 409, así que ocultarla no protege
nada — sólo encarece el sondeo, y (c) vive únicamente detrás de la cookie del
carrito y del throttler de escritura. Se declara en el threat model como divulgación
aceptada con mitigación.

### Ciclo de vida del carrito y la cookie

```
GET /v1/cart          →  resolve(cookie) → hay fila viva? → render : carrito vacío
                          NUNCA crea carrito ni emite cookie (GET es seguro)

PUT /v1/cart/items/x  →  resolve(cookie) → si no hay: crear fila + token + Set-Cookie
                          upsert de la línea (transacción)
                          expires_at = now + CART_TTL_DAYS  ← deslizamiento
                          Set-Cookie con el mismo Max-Age   ← cookie y fila deslizan JUNTAS

DELETE …/items/x      →  igual que PUT; si no había carrito, devuelve el vacío sin crear nada
```

**La cookie y la fila vencen a la vez** (`Max-Age` de `dsm_cart` = `expires_at` de la
fila, los dos derivados del **mismo** `CART_TTL_DAYS`) y sólo deslizan en
**escrituras**. Deslizar en `GET` obligaría a escribir en base en cada lectura;
re-estampar sólo la cookie crearía el peor de los casos — cookie viva apuntando a una
fila vencida, es decir un carrito que «desaparece» sin explicación.

### Qué mueve `CART_TTL_DAYS = 7` además del número (OQ-BE-1)

La ventana no es una constante aislada: toca otras tres cosas del diseño. Las tres se
revisaron al bajar de 30 a 7 y **ninguna obliga a cambiar el mecanismo**, pero dos
cambian de peso y la tercera conviene tenerla escrita.

1. **La purga oportunista se vuelve mucho más frecuente — y eso es bueno.** Con 7 días,
   el cliente que vuelve pasada la semana encuentra su fila vencida y la request la
   borra en el acto. La tabla `carts` se auto-limpia con el tráfico real en vez de
   acumular un mes de carritos muertos. Efecto lateral: **el job programado diferido
   (OQ-BE-6) pierde urgencia** — con 30 días era deuda que crecía; con 7 es un
   nice-to-have. La deuda sigue anotada, pero baja de prioridad.
2. **La ventana efectiva se cuenta desde la última *escritura*, no desde la última
   visita.** Con 30 días esto era casi inofensivo; con 7 es material: un cliente que
   abre el carrito el día 6 **sin tocarlo** igual lo pierde el día 8. Se mantiene el
   mecanismo (no deslizar en `GET`) porque la alternativa —escribir en base en cada
   lectura, o re-estampar sólo la cookie— cambia `GET` de seguro a mutante y
   reintroduce el desfase cookie/fila que este diseño evita a propósito. **Consecuencia
   declarada**: la persistencia que promete AC-4 es de 7 días **de actividad**, no de
   calendario desde la última vez que lo miró.
3. **El carrito ahora vive menos que la sesión.** `AUTH_REFRESH_TTL_DAYS = 30` contra
   `CART_TTL_DAYS = 7`: un cliente registrado puede seguir logueado y encontrar su
   carrito vacío. No es un bug —son dos ciclos de vida distintos y la fusión está
   fuera de alcance (OQ-BE-3)— pero es una asimetría visible que el FE debería explicar
   con el estado vacío (AC-7) en vez de dejar al cliente deduciéndola.

**Purga oportunista**: al resolver, si la fila está vencida se **borra** (cascada a
`cart_items`) y se responde como si no hubiera carrito. No hay barrido masivo — el
job programado queda diferido (OQ-BE-6, resuelta).

### Persistencia

Motor: **PostgreSQL** — el mismo y único de ADR-0002. No entra Redis: el carrito es
dato de negocio que tiene que sobrevivir a un reinicio (AC-4) y Redis no está
aprovisionado. Volumen esperado: ~50 concurrentes, unos miles de filas vivas — dos
tablas indexadas lo resuelven sin discusión (workload-first: relacional +
id-lookup + small + strong ⇒ Postgres; sin desvío de baseline).

#### `carts` (nueva — DER E2E §8 + retención)

| Columna | Tipo | Constraint | Por qué |
|---|---|---|---|
| `id` | `uuid` | PK, `gen_random_uuid()` | espeja `Category`/`Product`/`Customer` |
| `session_token_hash` | `text` | **UNIQUE**, NOT NULL | SHA-256 hex del token de la cookie. Único ⇒ la resolución es un index scan. Hasheado ⇒ una fuga de base no entrega carritos |
| `customer_id` | `uuid` | NULL, FK → `customers(id)` `ON DELETE SET NULL` | columna del DER. **Sin escritor en esta US** (ver Out of scope). `SET NULL` y no `CASCADE`: borrar una cuenta (US-020) no debe borrar el carrito, lo vuelve anónimo |
| `expires_at` | `timestamp` | NOT NULL | ventana de retención deslizante de **7 días** (`CART_TTL_DAYS`, OQ-BE-1), movida en cada escritura (AC-4). Sin ella, «período de persistencia» no es verificable ni se puede purgar |
| `created_at` | `timestamp` | NOT NULL, `now()` | del DER |
| `updated_at` | `timestamp` | NOT NULL, `@updatedAt` | última actividad; insumo de soporte y de la purga |

Índices: `UNIQUE (session_token_hash)` · `(expires_at)` (purga) · `(customer_id)`
(preparado para la fusión; barato).

#### `cart_items` (nueva — DER E2E §8)

| Columna | Tipo | Constraint | Por qué |
|---|---|---|---|
| `id` | `uuid` | PK, `gen_random_uuid()` | del DER |
| `cart_id` | `uuid` | NOT NULL, FK → `carts(id)` `ON DELETE CASCADE` | borrar el carrito borra sus líneas: la purga por retención es un solo `DELETE` sobre `carts` |
| `product_id` | `uuid` | NOT NULL, FK → `products(id)` `ON DELETE RESTRICT` | impide que un producto con líneas vivas desaparezca ⇒ no existen líneas huérfanas (ver Decisión 4) |
| `quantity` | `int` | NOT NULL, **`CHECK (quantity >= 1)`** | cantidad 0 no es una línea: es un `DELETE`. La base lo garantiza aunque la app regrese |
| `unit_price_ars_cents` | `int` | NOT NULL, **`CHECK (>= 0)`** | instantánea del precio al último toque. **Nunca** se usa para sumar (Decisión 3) |
| `created_at` | `timestamp` | NOT NULL, `now()` | cuándo entró al carrito |
| `updated_at` | `timestamp` | NOT NULL, `@updatedAt` | cuándo se tocó por última vez (sella la instantánea de precio) |

Índices: **`UNIQUE (cart_id, product_id)`** — una línea por producto; el `PUT` es un
upsert sobre esa clave, así que dos requests en paralelo no pueden duplicar la línea
(lo impide la base, no un `if` de la app) · `(cart_id)` para el `include` de la
lectura.

#### Forma de la migración

Un solo paso aditivo (`backend-node-standards.md` §5 — expand-and-contract; acá no
hay contract porque no hay nada que reemplazar): las dos tablas nacen vacías, así que
`NOT NULL`, `UNIQUE` y los `CHECK` se declaran de entrada. Los `CHECK` se agregan a
mano al `migration.sql` generado, como ya se hizo con
`products_stock_check`/`products_price_check` en `20260715230024_init_catalog`.
Ninguna tabla existente se modifica: `git diff` sobre las migraciones previas queda
vacío y la migración es reversible con un `DROP TABLE` de dos líneas.

### Manejo de errores

Errores de dominio nuevos en `apps/api/src/common/errors/cart-errors.ts`, subclases de
la `DomainError` existente. El `HttpProblemFilter` los mapea **sin modificaciones de
mapeo** (`backend-node-standards.md` §6):

| Error | Status | `type` | Cuándo |
|---|---|---|---|
| `InsufficientStockError` | 409 | `dsm:cart/insufficient-stock` | `quantity > stock` (AC-5). Extension member `available_quantity` |
| `CartTooManyItemsError` | 409 | `dsm:cart/too-many-items` | más de `CART_MAX_ITEMS` líneas distintas |
| *(reusa)* `NotFoundError` | 404 | `dsm:catalog/not-found` | slug inexistente **o** producto no publicado (AC-10) — **el mismo error para los dos**, o el carrito enumera el catálogo oculto |
| *(reusa)* `CsrfError` | 403 | `dsm:auth/csrf` | falta/no coincide `X-CSRF-Token`, u `Origin` fuera de la allowlist |
| *(pipe global)* | 422 | `dsm:catalog/http-422` | `quantity` fuera de rango, campo desconocido |
| *(throttler)* | 429 | `dsm:catalog/http-429` | presupuesto agotado, con `Retry-After` |

**Extension members RFC 7807**: `DomainError` gana un `readonly extensions?:
Record<string, unknown>` y el filtro lo esparce en el cuerpo. Es lo que RFC 7807 §3.2
contempla y evita la alternativa fea (meter el número en el `detail` y que el FE lo
parsee con una regex). Cambio aditivo: los errores existentes no declaran
`extensions` y su cuerpo no cambia — lo verifica el spec del filtro que ya existe.

### Observabilidad (US §9, E2E §18)

`CartEventsService` en `apps/api/src/observability/`, espejo exacto de
`CatalogEventsService` y `AuthEventsService`: contador en memoria + log pino
estructurado.

| Evento | Cuándo | `entity_id` |
|---|---|---|
| `cart.item_added` | `PUT` que crea una línea | `product.id` |
| `cart.item_quantity_changed` | `PUT` sobre una línea existente | `product.id` |
| `cart.item_removed` | `DELETE` que borra una línea | `product.id` |
| `cart.viewed` | `GET` con carrito no vacío | `cart.id` |
| `cart.stock_limit_rejected` | 409 de stock (AC-5) — **demanda por encima del stock**, señal de reposición para el dueño | `product.id` |
| `cart.item_unavailable` | lectura que encuentra una línea `unavailable`/`insufficient_stock` (AC-6) | `product.id` |

Reglas (`observability-standards.md` §9 + `observability-patterns` §3.3): el
`cart_id` va al **log**, nunca como dimensión del contador (cardinalidad); el **token
del carrito no se loguea jamás**, ni en claro ni hasheado; no hay PII de comprador en
esta US (los datos de contacto llegan en US-008). `cart.item_added` es el insumo
directo del embudo de conversión de US-016.

---

## Seguridad — threat model lite (STRIDE de la primera escritura pública)

Superficie: `PUT`/`DELETE` `/v1/cart/items/{slug}` y `GET /v1/cart`, sin
autenticación, identificadas por cookie. Aplica el walkthrough de
`threat-modeling-lite` §Superficie 1 (POST que crea) + §Superficie 4 (GET
autenticado). **No** dispara la escalation rule: no toca PCI (MercadoPago hosted, sin
datos de tarjeta), ni PHI, ni primitiva criptográfica nueva (reusa HMAC-SHA256 y
`randomBytes` ya en el repo), ni cambia una frontera de plataforma.

| Amenaza | Vector concreto | Control |
|---|---|---|
| **S** Spoofing | Adivinar la cookie de otro para leer/modificar su carrito | Token de **256 bits** de `randomBytes` (CSPRNG); guardado hasheado; sin id en la URL. El espacio de búsqueda hace inviable el sondeo aun sin rate-limit; con el throttler `cart` (120 lecturas/min/IP) es aritmética muerta |
| **S** Spoofing | Robo del token vía XSS en el storefront | `HttpOnly` en `dsm_cart`: JS no la lee. La cookie legible (`dsm_cart_csrf`) es sólo el HMAC — no sirve para autenticar sin la otra |
| **T** Tampering | Mandar `unit_price_ars_cents` o `product_id` en el cuerpo para fijar precio | El DTO declara **sólo** `quantity`; el `ValidationPipe` global corre con `forbidNonWhitelisted` ⇒ 422, no se ignora. **Todo importe se deriva server-side de `products`** |
| **T** Tampering | CSRF: sitio de terceros dispara `PUT`/`DELETE` con la cookie de la víctima | Dos capas (§7.5): `SameSite=Lax` **y** double-submit firmado `HMAC(JWT_SECRET, token)` en `X-CSRF-Token` + `Origin` en la allowlist; `Origin` ausente ⇒ 403 (fail closed) |
| **R** Repudiation | — | Riesgo bajo: el carrito no es un compromiso comercial. Los 6 eventos con `cart_id` + `trace_id` dan trazabilidad suficiente; el registro con valor legal lo aporta la orden (US-008) |
| **I** Info disclosure | El carrito filtra la existencia de productos `draft`/`archived` | `PUT` sobre un producto no publicado devuelve **exactamente el mismo 404** que un slug inventado (AC-10), misma disciplina que la ficha de US-003 |
| **I** Info disclosure | `max_quantity` revela el nivel de stock | **Aceptado y acotado** (OQ-BE-2): sólo en la superficie del carrito, nunca en browse; es equivalente a sondear con el 409; mitigado por el throttler de escritura (30/min/IP) |
| **I** Info disclosure | Un carrito cacheado en el edge se sirve a otro cliente | `Cache-Control: no-store` en **toda** la superficie `/v1/cart`, estampado en el borde y por lo tanto también en 4xx/429 — el hallazgo M1 de US-003 (cachear no-2xx) no se puede repetir acá |
| **D** DoS | Crear millones de carritos vacíos | El `GET` **no** crea carrito; sólo una escritura lo hace, y las escrituras están a 30/min/IP. Cada carrito tiene `expires_at` y purga oportunista |
| **D** DoS | Carrito gigante (10.000 líneas) para reventar la lectura | `CART_MAX_ITEMS` (50) líneas distintas ⇒ 409; `CART_MAX_QTY_PER_LINE` (99) por línea ⇒ 422; cuerpo ≤ 1 KiB |
| **E** Elevation | Escalar del carrito a algo del catálogo o del admin | La superficie no escribe nada fuera de `carts`/`cart_items`. **`products.stock` no se escribe en ningún camino de este change** — invariante verificada por test (AC-8) |

**Controles numéricos** (`security-standards.md` §7.3, presupuestos por IP):

| Superficie | Límite | En exceso |
|---|---|---|
| `GET /v1/cart` | 120 / min / IP | 429 + `Retry-After` + `RateLimit-*` |
| `PUT`/`DELETE` `/v1/cart/items/{slug}` | 30 / min / IP | idem |

---

## NFRs cuantificados (`nfr-quantification`)

| NFR | Valor | Medición |
|---|---|---|
| Latencia escritura (`PUT`/`DELETE`) | **p95 < 500 ms** (US §9, PRD §4; hereda E2E §17) | 2 queries + 1 transacción corta; sin llamadas externas |
| Latencia lectura (`GET /v1/cart`) | **p95 < 300 ms** `[propuesto — confirma Arquitecto]` | 1 query con `include`, acotada por `CART_MAX_ITEMS` = 50 |
| Disponibilidad | 99,5 % mensual (tier 2, E2E §17) | heredado; sin SLO propio |
| Retención del carrito invitado | **7 días** deslizantes desde la última **escritura** `[Resolved: 2026-08-22 — PO, OQ-BE-1]` | `CART_TTL_DAYS = 7`; cookie y fila con el mismo `Max-Age`, derivados del mismo valor |
| Cota de líneas por carrito | 50 | `CART_MAX_ITEMS` |
| Cota de cantidad por línea | 99 | `CART_MAX_QTY_PER_LINE` |
| Cuerpo máximo de request | 1 KiB (el DTO tiene un solo entero) | `ValidationPipe` + límite del body parser |
| Concurrencia objetivo | ~50 simultáneos (E2E §21) | dos índices resuelven el patrón id-lookup |

Cada NFR de latencia se observa con los logs pino ya estructurados (E2E §18); no se
crea dashboard nuevo — la superficie entra en el de `api` de Railway.

---

## Testing (dev-owned; `qa-backend-standards.md` §2.1)

| Capa | Qué cubre | Dónde |
|---|---|---|
| **Unit** (Jest, mocks) | `cart-view` (precio vigente, subtotales, total sin líneas bloqueadas, `price_changed`, disponibilidad), `CartTokenService`, `CartCsrfGuard`, cookies, `verifyRequestOrigin` | `src/cart/*.spec.ts` |
| **Integration** (Postgres real de `docker-compose`) | `CartsRepository`: upsert de línea, `UNIQUE (cart_id, product_id)`, cascada, `RESTRICT` sobre producto, purga de vencidos; reconciliación F40 del esquema | `src/cart/carts.repository.spec.ts`, `src/cart/cart-schema.spec.ts` |
| **E2E de API** (supertest sobre la app Nest) | los 10 AC + CSRF + rate-limit + `no-store` + atributos de cookie + aislamiento de throttlers | `src/cart/e2e-cart-*.spec.ts` |

Fuera de esta capa (van a `/plan-qa`): carga k6 sobre el carrito, E2E de navegador
(Playwright) del flujo ficha → carrito, y la suite BDD de aceptación cross-stack.

---

## Trade-offs

| Decisión | Se gana | Se paga |
|---|---|---|
| Cantidad **absoluta** vía `PUT` en vez de suma relativa vía `POST` | Idempotencia natural (§10.5): un reintento de red nunca duplica unidades. Sin tabla de `Idempotency-Key` ni su purga | Doble clic en «Agregar» con el mismo payload deja 1 unidad, no 2. El FE debe mandar `actual + 1` (lo sabe: toda respuesta trae el carrito completo) |
| Carrito **por navegador** (cookie), no por persona | El guest checkout —camino principal del PRD— funciona sin fricción; cero acoplamiento con US-014 | Dos dispositivos = dos carritos; borrar cookies pierde el carrito. Es exactamente lo que la US §4 difiere |
| Retención de **7 días** (OQ-BE-1, decisión del PO) | Poco dato residual; la purga oportunista mantiene la tabla chica sola y el job programado deja de ser urgente; el carrito que se retoma tiene precios todavía parecidos | **El cliente que vuelve a las dos semanas encuentra el carrito vacío**, sin aviso ni recuperación. En una ferretería el ciclo de reposición de un gremio supera los 7 días con facilidad, así que el caso no es marginal. Mitigación: es una variable de entorno, se sube sin deploy de código |
| Precio **vigente** siempre, instantánea sólo para el flag | AC-9 sin ambigüedad; el checkout nunca cobra un precio que el carrito no mostró | Un cliente puede ver subir el precio de algo que ya había agregado. Se mitiga haciéndolo visible, no escondiéndolo |
| Líneas no disponibles **se marcan**, no se borran | El cliente entiende qué pasó; el dueño recibe la señal `cart.item_unavailable` | La respuesta es más gorda y el FE tiene tres estados por línea en vez de uno |
| **Sin reserva** de stock | Coherencia total con ADR-0008; cero maquinaria de TTL/expiración | El «sell-out durante el pago» sigue siendo posible. Es la consecuencia que ADR-0008 aceptó a conciencia; acá se hace visible antes |
| Token **hasheado** en base | Una fuga de base no entrega carritos usables | Un índice extra y no se puede «buscar el carrito por token» desde una consola sin hashear primero |
| `no-store` en el borde por prefijo (no por interceptor) | El header también cubre 4xx/429 — imposible cachear un error del carrito | Es un prefijo más en el middleware de `bootstrap.ts`; hay que mantenerlo alineado si la ruta cambia |
| Tercer throttler nombrado (`cart`) | Presupuestos independientes por superficie | Obliga a tocar los `@SkipThrottle` de storefront y auth para no contaminar sus presupuestos — riesgo de regresión cubierto con el test de independencia |

**Deuda declarada**: sin job programado de purga, la tabla `carts` acumula filas
vencidas entre visitas de los mismos clientes. Con el volumen esperado (miles), es
irrelevante durante meses; el `Deferred:` de OQ-BE-6 tiene dueño.

---

## Deployment considerations

**Recomendación: SÍ correr `/plan-deployment`.** Motivos, por orden de peso:

1. **Migración de esquema** — dos tablas nuevas. Aditiva y sobre tablas vacías, pero
   es un `migrate deploy` contra Neon que debe ordenarse respecto del despliegue del
   código (el orden correcto es migración primero: el código nuevo requiere las
   tablas, el viejo las ignora).
2. **Superficie pública de escritura nueva** — la primera del producto. Cambia el
   perfil de tráfico y de abuso en el borde de Cloudflare; conviene decidir si hay
   regla de rate-limit de borde además del throttler de app (defensa en profundidad,
   no reemplazo).
3. **Variables de entorno nuevas** (6) — con default seguro, así que no rompen el
   arranque, pero deben quedar declaradas en Railway para poder endurecer por
   entorno sin redeploy de código.
4. **Cookie nueva en un dominio compartido con el FE** — `dsm_cart` con `Secure`
   exige TLS en el entorno donde se pruebe; en staging sin dominio custom
   (problema conocido del runbook §5) hay que verificar el comportamiento
   `SameSite=Lax` entre los subdominios `*.up.railway.app` de `web` y `api`.
5. **Cambio en la allowlist de métodos CORS** (`PUT`, `DELETE`) — afecta el preflight
   de todo el FE, no sólo del carrito.

Rollback: revertir el deploy del código deja las dos tablas huérfanas y sin
escritores (inocuas). No hace falta bajar la migración.

---

## ADR triggers

**Ninguno.** Verificado contra E2E §20 (los 8 ADR ya existen y ninguno cubre el
carrito porque no hay decisión nueva que tomar) y contra los ADR vigentes:

| Decisión de este change | ADR que la gobierna | ¿Desvía? |
|---|---|---|
| El carrito no reserva ni descuenta stock | ADR-0008 | No — la aplica al pie de la letra |
| El carrito vive en Postgres, no en Redis | ADR-0002 | No |
| Identidad por cookie `HttpOnly` + token opaco hasheado | ADR-0005 / ADR-0011 | No — misma familia de mecanismos, otro sujeto |
| Superficie pública fuera de `/v1/admin` | ADR-0010 | No |
| Módulo `CartModule` dentro del monolito | ADR-0007 | No |

Si el PO reabriera OQ-BE-3 pidiendo **reserva** de stock en el carrito, eso **sí**
sería un ADR (enmienda a ADR-0008) y se planificaría aparte antes de codificar.

---

## Delta de contrato (para `/archive-change`)

Al archivar, estos tres endpoints forman la capacidad **nueva** `openspec/specs/carrito/`
(raíz `contracts/openapi.yaml` + tres archivos en `contracts/openapi/paths/`). No se
mezclan con `catalogo`: son la capacidad 4 del PRD, con su propio `CartModule` en el
E2E §6.1. `catalogo` no se toca.

| Path | Métodos | Archivo |
|---|---|---|
| `/cart` | GET | `paths/cart.yaml` |
| `/cart/items/{slug}` | PUT, DELETE | `paths/cart-items-slug.yaml` |

Schemas compartidos que van a `components` de la raíz: `Cart`, `CartItem`,
`SetCartItemRequest`, `Problem` (referenciado desde la raíz de `carrito`, no
duplicado por archivo).

---

## Decisiones cerradas (ex-open questions)

Las seis preguntas que este diseño escaló quedaron **resueltas por el PO el
2026-08-22**. Ninguna queda abierta: el plan se ejecuta completo desde T0.1. Se
conservan las alternativas descartadas porque el fundamento es lo que impide que la
próxima US vuelva a abrir la misma discusión.

**OQ-BE-1 — ¿Cuánto vive un carrito abandonado de un invitado?**
`[Resolved: 2026-08-22 — **7 días** deslizantes (`CART_TTL_DAYS = 7`)]`
La US decía «dentro del período de persistencia» sin fijarlo.
- (a) **7 días** ← **elegida por el PO**. Menos dato residual y la tabla se mantiene
  chica sola; el carrito que el cliente retoma es el de la misma semana, con precios
  y disponibilidad que todavía se parecen a los que vio.
- (b) 30 días — *era la recomendación de este diseño* (cubría «lo veo el finde, lo
  compro el siguiente» y quedaba alineado con `AUTH_REFRESH_TTL_DAYS = 30`).
  Descartada por el PO.
- (c) 90 días — máxima recuperación; más filas vencidas y carritos que al volver
  muestran precios completamente distintos de los que el cliente recordaba.

> **Costo aceptado, declarado explícitamente** (mismo trato que el límite de filas de
> US-006): con 7 días, **el cliente que arma un carrito y vuelve a las dos semanas lo
> encuentra vacío** — sin aviso y sin forma de recuperarlo, porque la fila ya no
> existe y la cookie tampoco. En una ferretería la compra de reposición no siempre es
> semanal (un gremio que cotiza, junta materiales y compra al cobrar el trabajo
> tranquilamente pasa de 7 días), así que este caso **no es marginal**: es el precio
> de tener menos dato residual. La ventana es una variable de entorno, así que subirla
> no cuesta un deploy de código.
>
> **Gatillo de revisión**: si aparecen reclamos de «se me borró el carrito» o si la
> métrica de `cart.viewed` sobre carritos vacíos con cookie presente sube de forma
> sostenida, el número se sube por env sin tocar código.

**OQ-BE-2 — ¿El carrito le dice al cliente cuántas unidades quedan?**
`[Resolved: 2026-08-22 — sí, **sólo en la superficie del carrito**]`
- (a) **Sí, sólo en el carrito** ← **elegida**. `available_quantity` se devuelve cuando
  el cliente pide más de lo que hay, y `max_quantity` acota el stepper. La ficha y el
  listado siguen con el booleano `in_stock` de US-003: el nivel de inventario **no**
  se expone en browse. Fundamento: el dato ya es sondeable con el 409, así que
  ocultarlo no protege nada — sólo encarece el sondeo y empeora el stepper.
- (b) No — sólo un flag y el 409 genérico; un stepper que aprende su límite fallando.
- (c) Sí en todas partes — rompería la decisión de US-003 y expondría el inventario al
  scraping.

**OQ-BE-3 — Al iniciar sesión, ¿qué pasa con el carrito del invitado?**
`[Resolved: 2026-08-22 — **hoy no pasa nada**; la política de la US futura es **sumar cantidades**]`
Confirmado que en v1 el carrito del invitado **sigue vivo y accesible por su cookie**:
no se pierde, no se mezcla, no se descarta. La fusión sigue fuera de alcance (US §4).
- Política **registrada** para la US futura de fusión: **sumar cantidades**, con tope
  al stock ← **elegida**. Fundamento: nadie pierde nada de lo que había elegido.
- Descartadas: gana el carrito del invitado (borra en silencio lo guardado); gana el
  de la cuenta (descarta lo que la persona acaba de armar — el peor para la
  conversión); preguntar al usuario (la más respetuosa y la más cara en UI).

> Esta decisión **no se implementa acá**. Queda escrita para que la US de fusión la
> herede en vez de reabrirla, y `carts.customer_id` es la columna donde aterriza el
> vínculo cuando llegue.

**OQ-BE-4 — ¿El total del carrito incluye las líneas no comprables?**
`[Resolved: 2026-08-22 — **no**: el total suma sólo lo comprable]`
- (a) **No** ← **elegida**. `total_ars_cents` suma sólo las líneas `available`; el ítem
  bloqueado **sigue visible y marcado**, con su propio `subtotal_ars_cents`, y
  `has_blocking_issues` avisa. Fundamento: un total que incluye lo que no se puede
  comprar es un número que el checkout va a desmentir.
- (b) Sí — descartada por lo anterior.

**OQ-BE-5 — ¿«Agregar» fija la cantidad o la suma?**
`[Resolved: 2026-08-22 — **fija** (`PUT` absoluto, idempotente)]`
- (a) **Fija** ← **elegida**. Idempotente por `api-standards.md` §10.5, así que no hace
  falta `Idempotency-Key` ni el almacén de respuestas de §10.2. Fundamento: un
  reintento de red nunca compra de más.
- (b) Suma (`POST` relativo) — más natural para el botón «Agregar», pero obliga a la
  maquinaria de idempotencia o acepta duplicar unidades en un reintento.

**OQ-BE-6 — ¿Cómo se purgan los carritos vencidos?**
`[Resolved: 2026-08-22 — **oportunista ahora + job programado diferido**]`
- (a) **Oportunista + diferido** ← **elegida**. Redis/BullMQ no está aprovisionado
  (mismo estado que en US-006 / ADR-0012). Con `CART_TTL_DAYS = 7` la purga
  oportunista alcanza de sobra (ver §Ciclo de vida — la ventana corta la vuelve
  mucho más frecuente).
- (b) Job ya — exigiría aprovisionar la cola dentro de esta US.
- (c) Nunca purgar — la tabla crecería sin techo.

## References

- `docs/user-stories/US-007-carrito-compra.md` (AC-1..AC-10, §9 NFRs, §10 reglas)
- `docs/product/prd.md` §2.1 cap. 4 · §3.1 (loop + casos borde) · §6 (retención) · §7 (roles)
- `docs/product/design-e2e.md` §6.1 · §8 (DER) · §14 (STRIDE) · §17 (NFRs) · §18 (observabilidad) · §20 (ADR)
- ADR-0002, ADR-0005, ADR-0007, ADR-0008, ADR-0010, ADR-0011
- `openspec/changes/archive/US-003-ficha-producto-pdp-backend/` (anti-enumeración, caché sólo en 2xx)
- `openspec/changes/US-014-registro-login-backend/` (cookies, CSRF, throttler nombrado, tokens hasheados)
