# @dsm/api — API de administración del catálogo (US-001)

Backend NestJS del panel del dueño: CRUD de categorías y productos, máquina de
estado (borrador → publicado → archivado), validación por campo (RFC 7807) y
guard RBAC admin (seam ADR-0009). Consume el esquema de `@dsm/db` (Prisma).

## Requisitos

- Node 22, pnpm 9.15.9 (ver raíz del monorepo).
- Postgres + pgvector vía `docker-compose` en la raíz (`make up`).
- Variables (validadas al arranque, fail-fast): `DATABASE_URL`, `JWT_SECRET`,
  `PORT` (opc.), `ADMIN_AUTH_ENABLED`, `ADMIN_BOOTSTRAP_TOKEN`.

## Correr

```bash
# desde la raíz del monorepo
make up                              # Postgres + Redis
pnpm --filter @dsm/db migrate        # aplica el esquema del catálogo
pnpm --filter @dsm/api start:dev     # arranca la API en :3000
```

## Testear

```bash
pnpm --filter @dsm/api test          # unit + integration + e2e-nest (serial, DB compartida)
pnpm --filter @dsm/api test -- <patrón>   # un archivo (p.ej. e2e-products-publish)
pnpm --filter @dsm/api lint
pnpm --filter @dsm/api typecheck
```

Los tests de integración/e2e usan el Postgres de `docker-compose` (misma imagen
pgvector) y hacen `TRUNCATE` entre casos; corren en serie (`maxWorkers: 1`).

## Endpoints (todos bajo `AdminGuard`, requieren JWT `role=admin`)

| Método | Ruta | AC |
|---|---|---|
| POST | `/v1/admin/categories` | AC-1 |
| GET | `/v1/admin/categories` | AC-1 |
| PATCH | `/v1/admin/categories/{id}` | AC-1 |
| POST | `/v1/admin/products` | AC-2, AC-5, AC-9 |
| GET | `/v1/admin/products` | listado paginado (NFR) |
| GET | `/v1/admin/products/{id}` | AC-3 |
| PATCH | `/v1/admin/products/{id}` | AC-3, AC-4, AC-6, AC-7 |
| GET | `/health` · `/ready` | liveness / readiness |

### Superficie pública del storefront (US-003 ficha + US-002 navegación)

Las rutas **sin auth** que el storefront SSR consume:

| Método | Ruta | US / AC |
|---|---|---|
| GET | `/v1/products/{slug}` | US-003 AC-1/AC-2 — ficha pública de un producto `published` |
| GET | `/v1/categories` | US-002 AC-1 — árbol de navegación de dos niveles |
| GET | `/v1/categories/{slug}` | US-002 AC-1/AC-2/AC-9 — detalle con `parent` (breadcrumb) y `children` |
| GET | `/v1/categories/{slug}/products` | US-002 AC-3/AC-6/AC-7/AC-8 — listado paginado de publicados |

- **Sin `AdminGuard`.** Sólo se expone lo `published`: draft/archived/inexistente
  → **404** RFC 7807 uniforme (sin enumeration leak). Una categoría inexistente
  también da 404 en su listado, nunca un 200 vacío — una página fantasma sería
  indexable.
- **Identificador público: el `slug`**, tanto de producto como de categoría. Lo
  deriva el servidor del nombre; no se acepta del cliente ni se recalcula al
  renombrar (una URL ya indexada no se rompe), y ante colisión lleva sufijo.
- **Agregación por rubro (decisión D1)**: el listado de un **rubro** incluye los
  productos de sus subrubros directos; el de un **subrubro**, sólo los propios.
  Sin esto, un rubro cuyos productos cuelgan de los hijos se vería vacío.
- **Paginación offset (decisión D3)**: `?limit=&offset=` con envelope
  `{ data, pagination: { limit, offset, total } }`. `limit` default 20, **tope
  100** — el catálogo completo nunca se transfiere de una (AC-7). Fuera de rango
  → **422**. Orden estable `name ASC, id ASC`, así el offset es determinista.
- **Rate-limit por IP** (§7.3): throttler `storefront`
  (`STOREFRONT_RATE_LIMIT_TTL_MS`/`STOREFRONT_RATE_LIMIT_MAX`, default 60/min);
  al excederlo, **429** con `Retry-After` + `RateLimit-*`.
- **Caché por endpoint (decisión D5)**: el árbol de categorías lleva
  `max-age=300, stale-while-revalidate=60` (cambia poco); la ficha, el detalle y
  el listado se quedan en `max-age=60, stale-while-revalidate=30`, que acota la
  frescura del precio (AC-9). El header se estampa **sólo en 2xx**, así un CDN
  compartido nunca cachea un 404/422/429. El surface admin conserva `no-store`.
- **Evento de negocio**: el detalle de categoría emite `category.viewed`
  (decisión D4) — insumo del panel de métricas de US-016. El árbol y el listado
  no emiten: paginar dentro de una categoría no es una vista nueva.

Contrato completo: [`docs/api/openapi.yaml`](./docs/api/openapi.yaml). Errores en
envelope RFC 7807 con `type` `dsm:catalog/*`.

## Auth (seam ADR-0009)

`AdminGuard` valida un JWT `role=admin` firmado con `JWT_SECRET`. **US-014**
endureció la **emisión** preservando el contrato `role=admin` — el guard no se
tocó, y hay una verificación en el plan que lo prueba contra el rango de commits
del change.

`POST /v1/admin/auth/login` acepta **dos** formas, en la misma ruta y con la
misma respuesta `{ token }`:

- `{ email, password }` de una cuenta con `role='admin'` (el camino normal desde
  US-014). Además de `{ token }`, emite las cookies de sesión.
- `{ bootstrapToken }` — el camino interino de US-001, detrás de
  `ADMIN_AUTH_ENABLED`. Queda como **salida de emergencia**.

Las credenciales de una cuenta que existe pero **no** es admin devuelven el mismo
`401` que una contraseña incorrecta: decir "esta cuenta no es admin" confirmaría
que existe.

### Procedimiento de corte del bootstrap token

1. Sembrar la cuenta admin:
   `ADMIN_SEED_EMAIL=... ADMIN_SEED_PASSWORD=... pnpm --filter @dsm/db seed`
   (idempotente; sin ambas variables no siembra admin y tampoco falla).
2. Verificar el login por credenciales contra `POST /v1/admin/auth/login` y que
   el token devuelto abra `GET /v1/admin/categories`.
3. Recién entonces, `ADMIN_AUTH_ENABLED=false`.

El orden importa: invertir 2 y 3 deja el panel inaccesible si la siembra falló.
El bootstrap token no se borra — es el único camino de vuelta si la cuenta admin
queda inaccesible (contraseña perdida, fila borrada).

## Auth de cliente (US-014)

Siete rutas bajo `/v1/auth`, declaradas en `docs/api/openapi.yaml` con el tag
`customer-auth`:

| Ruta | Código | Notas |
|---|---|---|
| `POST /auth/register` | 201 | Sesión activa inmediata, sin verificación de email |
| `POST /auth/login` | 200 | |
| `POST /auth/refresh` | 200 | Rotación + detección de reuso (ADR-0011) |
| `POST /auth/logout` | 204 | Revoca la familia de refresh |
| `GET /auth/me` | 200 | |
| `POST /auth/password-reset/request` | 202 | **Siempre** 202 (anti-enumeración) |
| `POST /auth/password-reset/confirm` | 200 | Revoca todas las sesiones |

### Cookies

**Ningún token de sesión viaja en el cuerpo.** Se emiten tres cookies (§7.4):

| Cookie | HttpOnly | Path | Vida |
|---|---|---|---|
| `dsm_access` | sí | `/` | `AUTH_ACCESS_TTL_MIN` |
| `dsm_refresh` | sí | `/v1/auth` | `AUTH_REFRESH_TTL_DAYS` |
| `dsm_csrf` | **no** | `/` | `AUTH_ACCESS_TTL_MIN` |

`dsm_csrf` es legible a propósito: el frontend la lee para reenviarla en el
header `X-CSRF-Token`. Ahí está el double-submit — un atacante en otro origen
puede provocar que el navegador **mande** la cookie, pero la política de mismo
origen le impide **leerla** para poner el header.

`dsm_refresh` se acota a `/v1/auth` para que no viaje en cada petición al
catálogo. `Secure` sale de `AUTH_COOKIE_SECURE` (default `true`).

### CSRF

`POST /auth/refresh` y `POST /auth/logout` exigen el header `X-CSRF-Token`
**y** un `Origin` de `CORS_ALLOWED_ORIGINS`. La **ausencia** de `Origin` también
se rechaza: una escritura autenticada por cookie que no declara origen no es
verificable. Las rutas no autenticadas (`register`, `login`, los de reset) no lo
exigen — ahí todavía no hay sesión que secuestrar.

### Rate limit (por IP, throttler `auth`)

| Ruta | Límite |
|---|---|
| `login` | 10 / 15 min |
| `register` | 5 / hora |
| `password-reset/request` | 5 / hora |
| `password-reset/confirm` | 10 / hora |
| `refresh` | 60 / 15 min |

Más un límite **por cuenta** de `PASSWORD_RESET_MAX_PER_HOUR` en el reset: el de
IP se evade rotando IPs y el de cuenta rotando destinatarios, así que hacen falta
los dos. Y un **lockout por cuenta** tras `AUTH_LOGIN_MAX_FAILURES` fallos, con
backoff `min(BASE × 2^(n-1), MAX)` — nunca permanente, para que nadie pueda dejar
a un usuario fuera de su cuenta fallando el login a propósito.

> ⚠️ **`TRUST_PROXY_HOPS` hay que configurarlo en el deploy.** El rate-limit
> cuenta por IP, y detrás de un CDN Express devuelve la IP del proxy para
> **todos** los clientes: el límite se volvería global. El default es `0` porque
> el riesgo inverso es peor —confiar de más deja falsificar `X-Forwarded-For` y
> evadir el límite por completo—, así que en producción detrás de Cloudflare va
> `TRUST_PROXY_HOPS=1`.

### Variables de entorno

| Variable | Default | Para qué |
|---|---|---|
| `AUTH_ACCESS_TTL_MIN` | 15 | Vida del access |
| `AUTH_REFRESH_TTL_DAYS` | 30 | Vida del refresh |
| `AUTH_COOKIE_SECURE` | `true` | Flag `Secure` de las cookies |
| `AUTH_LOGIN_MAX_FAILURES` | 5 | Fallos antes del lockout |
| `AUTH_LOCKOUT_BASE_MIN` | 15 | Primer bloqueo |
| `AUTH_LOCKOUT_MAX_MIN` | 60 | Tope del backoff |
| `PASSWORD_RESET_TTL_MIN` | 60 | Vida del token de reset |
| `PASSWORD_RESET_MAX_PER_HOUR` | 3 | Emisiones por cuenta |
| `BCRYPT_COST` | 12 | Costo del hash |
| `TRUST_PROXY_HOPS` | 0 | Saltos de proxy confiables (ver aviso) |
| `RESEND_API_KEY` | — | Envío real del email de reset |
| `PASSWORD_RESET_FROM` | — | Remitente |
| `PASSWORD_RESET_URL_BASE` | — | Base del enlace del email |

Las tres últimas son opcionales **fuera** de producción: sin `RESEND_API_KEY` se
usa el adapter de log, que escribe el token en el log para poder probar en local.
Con `NODE_ENV=production` y alguna faltante, **el arranque falla** — un deploy mal
configurado caería al adapter de log y el reset "funcionaría" sin enviar un solo
email, que nadie notaría hasta que un cliente no pueda recuperar su cuenta.

## Carrito del invitado (US-007)

Tres rutas **públicas** bajo `/v1/cart`, declaradas en `docs/api/openapi.yaml`
con el tag `cart`. Es la primera superficie del servicio que **escribe sin
autenticación**.

| Ruta | Código | Notas |
|---|---|---|
| `GET /cart` | 200 | Nunca crea carrito ni emite cookie. Sin cookie devuelve el carrito **vacío**, no un 404 |
| `PUT /cart/items/{slug}` | 200 | Fija la cantidad **absoluta**. Crea la línea y, si no había, el carrito |
| `DELETE /cart/items/{slug}` | 200 | Idempotente: quitar lo que no está devuelve el carrito igual |

Las tres devuelven el **carrito completo**, así el cliente nunca tiene que
adivinar el estado ni encadenar un `GET`.

### Semántica absoluta del `PUT`

El cuerpo (`{ "quantity": n }`) **fija** la cantidad; no la suma. Eso hace la
operación naturalmente idempotente (`api-standards` §10.5) y evita la maquinaria
de `Idempotency-Key`: un reintento de red nunca compra de más. **El FE tiene que
mandar `actual + 1`** para un botón «Agregar» — lo sabe, porque toda respuesta
trae la cantidad vigente. Un doble clic con el mismo payload deja 1 unidad, no 2.

El producto se identifica por **`slug`** (los DTO del storefront no exponen `id`).
El carrito **no** aparece en ninguna URL: la identidad es la cookie, así que la
superficie es estructuralmente inmune a IDOR.

### Cookies y CSRF — cuál se lee en `/v1/cart/*`

| Cookie | HttpOnly | Path | Vida |
|---|---|---|---|
| `dsm_cart` | sí | `/` | `CART_TTL_DAYS` |
| `dsm_cart_csrf` | **no** | `/` | `CART_TTL_DAYS` |

`dsm_cart` lleva un token opaco de 256 bits; en base vive **sólo su hash**
(SHA-256), igual que los refresh de ADR-0011. Nunca viaja en el cuerpo de una
respuesta ni se escribe en un log.

**Cuidado con la cookie del double-submit — no es la misma que en auth:**

| Superficie | Header | Se lee de la cookie |
|---|---|---|
| `/v1/auth/*` | `X-CSRF-Token` | `dsm_csrf` (derivada del `jti` del access) |
| `/v1/cart/*` | `X-CSRF-Token` | **`dsm_cart_csrf`** (derivada del token del carrito) |

Los dos usan HMAC con `JWT_SECRET`, pero **sobre sujetos distintos**: el valor de
la sesión no abre el carrito y viceversa. Un invitado no tiene `jti`, así que el
mecanismo de US-014 no se podía reusar tal cual.

`PUT` y `DELETE` exigen el header **y** un `Origin` de `CORS_ALLOWED_ORIGINS`
(su ausencia también se rechaza, fail closed). La **primera** escritura de un
cliente nuevo —la que todavía no manda `dsm_cart`— pasa sin double-submit: no hay
carrito que secuestrar ni valor que derivar. El `GET` no exige CSRF: es seguro.

### Rate limit (por IP, throttler `cart`)

| Superficie | Límite |
|---|---|
| `GET /cart` | `CART_RATE_LIMIT_MAX` (120 / min) |
| `PUT` / `DELETE` | `CART_WRITE_RATE_LIMIT_MAX` (30 / min) |

Los presupuestos se cuentan **por endpoint**, y el throttler `cart` es
independiente de `auth` y `storefront`: agotar uno no consume los otros. Igual que
en auth, esto depende de `TRUST_PROXY_HOPS` en el deploy.

### Retención: 7 días desde la última **escritura**

`CART_TTL_DAYS` (default **7**) fija a la vez el `Max-Age` de las dos cookies y
`carts.expires_at`. Los dos números salen del mismo valor a propósito: una cookie
viva apuntando a una fila vencida es un carrito que «desaparece» sin explicación.

La ventana **se desliza sólo en escrituras**. Abrir el carrito sin tocarlo no lo
renueva: la persistencia que promete AC-4 es de 7 días **de actividad**, no de
calendario desde la última visita.

> **Costo declarado y aceptado** (decisión del PO, OQ-BE-1): quien arma un carrito
> y vuelve **a las dos semanas lo encuentra vacío**, sin aviso y sin forma de
> recuperarlo — la fila ya no existe. En una ferretería el gremio que cotiza,
> junta materiales y compra al cobrar el trabajo pasa de 7 días con facilidad, así
> que el caso no es marginal. Es una variable de entorno justamente para poder
> **subirla sin deploy de código** si aparecen reclamos.

Los carritos vencidos se purgan de forma **oportunista**: la fila se borra al
primer intento de usarla vencida (con sus líneas, por `ON DELETE CASCADE`). No hay
job programado — está diferido a US-019 porque Redis/BullMQ todavía no está
aprovisionado.

### El carrito no reserva ni descuenta stock

Lo mira para no dejar pedir más de lo que hay (409 `dsm:cart/insufficient-stock`
con `available_quantity`) y lo vuelve a mirar en cada lectura (`availability` +
`has_blocking_issues`), pero **nunca lo escribe** (ADR-0008). Dos clientes pueden
tener las mismas últimas unidades en su carrito: es la consecuencia que ADR-0008
aceptó, y se resuelve al aprobarse el pago (US-010) con un `UPDATE` condicional.
Los importes se calculan **siempre** con el precio vigente; la instantánea guardada
sólo prende `price_changed`.

### Variables de entorno

| Variable | Default | Para qué |
|---|---|---|
| `CART_TTL_DAYS` | 7 | Ventana de retención (cookie **y** fila) |
| `CART_MAX_ITEMS` | 50 | Líneas distintas por carrito → 409 |
| `CART_MAX_QTY_PER_LINE` | 99 | Unidades por línea → 422 |
| `CART_RATE_LIMIT_TTL_MS` | 60000 | Ventana del throttler `cart` |
| `CART_RATE_LIMIT_MAX` | 120 | Lecturas por ventana e IP |
| `CART_WRITE_RATE_LIMIT_MAX` | 30 | Escrituras por ventana e IP |

La cookie del carrito **reusa `AUTH_COOKIE_SECURE`**: no hay una segunda variable
para el mismo concepto, porque dos flags para «¿emito cookies `Secure`?» terminan
con una superficie endurecida y la otra no.
