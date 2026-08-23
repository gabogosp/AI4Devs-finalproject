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

## Importación masiva de inventario (US-006)

Tres rutas admin, todas bajo `AdminGuard`:

| Método | Ruta | Qué hace |
|---|---|---|
| `POST` | `/v1/admin/imports` | Recibe el archivo, lo valida y responde **202** con el `id` del trabajo |
| `GET` | `/v1/admin/imports/{id}` | Estado, progreso y filas rechazadas paginadas |
| `GET` | `/v1/admin/imports/{id}/report` | CSV descargable de las filas rechazadas |

El `POST` **no procesa el archivo**: el trabajo corre en segundo plano dentro del
proceso del API (ADR-0012, mientras Redis no esté aprovisionado) detrás del mismo
contrato asíncrono que tendrá con la cola. El progreso se consulta por `GET`.

### Esquema de columnas v1 (fijo)

| Encabezado | Requerido | Regla |
|---|---|---|
| `sku` | **sí** | 1..64 caracteres, único dentro del archivo |
| `nombre` | **sí** | 1..200 caracteres, sin caracteres de control |
| `precio` | **sí** | ARS con IVA incluido, `> 0`, hasta 2 decimales |
| `stock` | **sí** | entero `>= 0` |
| `categoria` | **sí** | 1..120 caracteres; se normaliza a slug para reconciliar |
| `descripcion` | no | 0..2000 caracteres |
| `imagen_url` | no | esquema **`https:`** únicamente, ≤ 2048 caracteres |

El encabezado se reconoce **normalizado** con la misma `slugify()` de la app, así
que `Descripción`, `DESCRIPCION` y `descripcion` son la misma columna. Un
encabezado desconocido se **ignora**; si falta uno **requerido**, se rechaza el
archivo entero con `422 dsm:import/missing-columns` enumerando cuáles faltan.

**El separador de miles se rechaza.** `1.234` es ambiguo entre 1,234 y 1234, y
adivinar sobre el precio de un catálogo es inaceptable: sólo dígitos y un
separador decimal (`1234,56` o `1234.56`). Los centavos se calculan con aritmética
entera, nunca con `parseFloat * 100`.

**Una celda vacía significa «no cambiar ese campo»** cuando el SKU **ya existe**.
Es lo que hace posible el archivo de ajuste de precios del día 2: se exporta la
plantilla, se borra todo menos el `sku` y se escribe el precio nuevo. El
**encabezado** sí tiene que traer las cinco columnas requeridas (si falta una, se
rechaza el archivo entero: AC-6), pero sus **celdas** pueden ir vacías.

En una fila de **alta** —un SKU que no está en el catálogo— una celda requerida
vacía rechaza esa fila con `missing_required`, y el motivo enumera qué falta. El
`sku` es la excepción: nunca puede estar vacío, porque es la clave de la
reconciliación.

```csv
sku,nombre,precio,stock,categoria
REF-1,,135000,,          # actualiza SÓLO el precio de REF-1
REF-2,,121500,,          # idem
NUEVO-1,,99000,,         # RECHAZADA: para crear hacen falta nombre, stock y categoria
```

### Límites vigentes

| Límite | Valor | Qué pasa al excederlo |
|---|---|---|
| Tamaño del archivo | **4 MiB** | `413 dsm:import/file-too-large` |
| Filas de datos | **5.000** | `422 dsm:import/row-limit-exceeded` |
| Expansión de un XLSX | **32 MiB** | `415 dsm:import/unsupported-format` |
| Imports por hora y por IP | **3** | `429` con `Retry-After` |
| Filas del reporte | **1.000** | se marca `report_truncated`; `failed_count` sigue siendo el total real |

> **El tope de 5.000 filas coincide con el catálogo objetivo del proyecto**, así
> que **no queda margen**: cuando el catálogo crezca, el archivo hay que partirlo
> en dos y subirlo de a uno. Es una decisión consciente del PO (OQ-BE-3, se eligió
> el tope ajustado sobre el holgado), y está acá para que se sepa por la
> documentación y no por un `422` en el peor momento. Subirlo es cambiar
> `IMPORT_MAX_ROWS`, sin deploy de código.

### Qué se toca y qué no al reconciliar por SKU

Un SKU nuevo **crea** el producto; uno existente lo **actualiza**. Re-importar el
mismo archivo no duplica nada.

- `slug`: **no se recalcula** al renombrar. La URL ya pudo indexarse y regenerarla
  la rompería (regla heredada de US-003).
- `status`: **el import no publica ni despublica**. El archivo no tiene columna de
  estado y no la va a tener: publicar es una decisión del dueño sobre un producto
  que ya revisó. Los nuevos nacen `draft`.
- `enrichment_done`: vuelve a `false` al crear y **sólo** si cambió
  `description_raw` — re-enriquecer un producto al que sólo le movieron el precio
  es pagarle al proveedor de IA por el mismo resultado.

Una categoría referenciada que no existe **se crea** como rubro raíz, normalizada:
«Plomería», «plomeria» y «PLOMERÍA» son un solo rubro.

### Códigos de error por fila (catálogo cerrado)

Aparecen en `errors[].error_code` del `GET` y en la columna `codigo` del CSV.

| `error_code` | Cuándo |
|---|---|
| `missing_required` | falta el `sku`, o es un **alta** sin `nombre`, `precio`, `stock` o `categoria` |
| `invalid_sku` | sku de más de 64 caracteres o con caracteres no imprimibles |
| `invalid_text` | texto libre inválido: `nombre` > 200, `descripcion` > 2000 o con caracteres de control |
| `invalid_price` | no numérico, `<= 0`, más de 2 decimales, separador de miles o fuera de rango |
| `invalid_stock` | no entero, negativo o fuera de rango |
| `invalid_category` | categoría de más de 120 caracteres, con controles, o que no se pudo resolver |
| `invalid_image_url` | URL no `https:`, mal formada o de más de 2048 caracteres |
| `duplicate_sku_in_file` | el sku aparece más de una vez: se procesa **la primera** aparición |
| `slug_conflict` | no se pudo generar una URL única ni tras reintentar |
| `write_failed` | la escritura de esa fila falló; las demás del lote sí se escribieron |

Los errores del **archivo entero** son distintos y viajan como RFC 7807:
`dsm:import/unsupported-format` (415), `dsm:import/file-too-large` (413),
`dsm:import/missing-columns` (422), `dsm:import/row-limit-exceeded` (422),
`dsm:import/invalid-encoding` (422), `dsm:import/already-running` (409) y
`dsm:import/not-found` (404).

Un archivo que no está en **UTF-8** se rechaza en vez de decodificarse con
reemplazos: un catálogo con «Refrigeraci�n» en la base es peor que un import que
falla, porque el error lo descubre el cliente en el storefront.

### El frontend tiene que invalidar el catálogo al completarse el import

El backend **no tiene canal** hacia el renderizado de Next: cuando el panel vea
`status: "completed"`, tiene que llamar a `revalidateCatalog()`. Sin eso, el
storefront puede seguir sirviendo **precios viejos** después de un ajuste masivo.
Queda del lado de FE-US-006; es un corte a coordinar, no un detalle de UI.

### Runbook: import interrumpido o atascado en `running`

El ejecutor vive en el proceso del API, así que un redeploy lo mata a mitad de
camino y el trabajo queda `running` en la base.

1. Al arrancar, la API **cierra sola** los trabajos sin latido reciente
   (`IMPORT_JOB_STALE_MS`, default 2 min) marcándolos `failed` con
   `error_code = 'interrupted'`. Después de un reinicio, esperar ese margen.
2. **Volver a subir el mismo archivo.** Es seguro: la reconciliación es por SKU,
   así que lo ya importado se actualiza en vez de duplicarse.
3. Si un `POST` devuelve `409 dsm:import/already-running` y **no** hay ningún
   import corriendo de verdad, es un trabajo huérfano que todavía no fue barrido:
   verificar con `GET /v1/admin/imports/{id}` el `heartbeat_at` del vigente y
   esperar el barrido del próximo arranque.
4. Los trabajos y sus filas de error se purgan a los **90 días**
   (`IMPORT_RETENTION_DAYS`), de forma oportunista al arrancar la API. Un `GET` de
   un import viejo puede devolver `404` por eso.

### Variables de entorno

| Variable | Default | Para qué |
|---|---|---|
| `IMPORT_MAX_FILE_BYTES` | 4194304 | Cap del archivo subido (4 MiB) → 413 |
| `IMPORT_MAX_ROWS` | 5000 | Cap de filas de datos → 422 |
| `IMPORT_MAX_UNCOMPRESSED_BYTES` | 33554432 | Cap de expansión de un XLSX (32 MiB) → 415 |
| `IMPORT_BATCH_SIZE` | 200 | Filas por lote del runner (cada cuánto publica progreso) |
| `IMPORT_MAX_REPORT_ROWS` | 1000 | Filas rechazadas persistidas antes de truncar el reporte |
| `IMPORT_JOB_STALE_MS` | 120000 | Antigüedad del latido para considerar un trabajo huérfano |
| `IMPORT_RETENTION_DAYS` | 90 | Retención de trabajos y filas de error |
| `IMPORT_RATE_LIMIT_MAX` | 3 | `POST` por ventana e IP |
| `IMPORT_RATE_LIMIT_TTL_MS` | 3600000 | Ventana del presupuesto del `POST` (1 h) |

Un valor inválido **hace fallar el arranque** (Zod, fail-fast §7): un cap que se
degrada a su default por un typo es un cap que no existe.

> **Diferido a US-019**: el encolado en BullMQ. US-005 ya conectó el enriquecimiento
> por el mismo puerto (`ENRICHMENT_QUEUE`): al terminar un import se empuja el
> ejecutor in-process. La marca durable `products.enrichment_done = false` sigue
> siendo la cola real, así que un empujón perdido no pierde trabajo.

## Enriquecimiento IA y embeddings (US-005)

Convierte las descripciones pobres del catálogo en descripciones ricas y genera el
**vector** con el que funciona la búsqueda semántica (US-004). Es la capacidad que
habilita el diferenciador del producto: sin vectores, `/search` no tiene qué consultar.

El trabajo corre **en proceso** dentro de `apps/api` (ADR-0014, que enmienda ADR-0004
igual que ADR-0012 lo hizo para el import): no hay worker ni Redis todavía. La cola no
es una tabla de jobs: **es `WHERE enrichment_done = false`**, y el reparto seguro entre
réplicas lo da un claim por lease (`UPDATE … FOR UPDATE SKIP LOCKED`).

### Superficie admin

| Método y ruta | Para qué |
|---|---|
| `GET /v1/admin/enrichment/status` | Cobertura del catálogo y estado del ejecutor (AC-3) |
| `POST /v1/admin/enrichment/runs` | Dispara una corrida: **202**, o 409 si ya hay una |
| `PATCH /v1/admin/products/{id}` con `description_enriched` | El dueño **cura** el texto: la IA no lo vuelve a pisar (AC-7) |

El `GET` **no** consume el presupuesto del `POST`: el panel lo consulta en loop mientras
una corrida avanza, y si mirar el progreso gastara el cupo de disparo, el dueño se
quedaría sin poder lanzar una corrida por haber mirado la barra.

### Sin `GEMINI_API_KEY` la app arranca, pero el enriquecimiento **no corre**

Es deliberado y conviene entenderlo antes de la primera demo:

- **En desarrollo**, sin la clave los dos puertos resuelven al `DisabledAiProvider`, el
  `/status` reporta `runner_state: "disabled"` y **no se genera ni un vector**. El
  catálogo queda navegable por categoría (AC-5) y la búsqueda semántica no tiene con qué
  responder. No hay adapter que devuelva vectores sintéticos: uno haría que la búsqueda
  «funcione» devolviendo basura, y eso se descubre en la demo.
- **En producción**, faltar la clave **hace fallar el arranque** (refinement de
  `envSchema`, mismo criterio que `RESEND_API_KEY`). Una feature que "funciona" sin hacer
  nada es peor que un arranque roto.
- El estado del ejecutor (`idle | running | cooldown | disabled`) es **en memoria**; lo
  durable es `products.enrichment_done`. Un reinicio no pierde trabajo pendiente.

### Cuándo se gasta plata, y cuándo no

Cada corrida son llamadas pagas al proveedor, así que el control de costo está en el
código y probado por tests que **cuentan invocaciones**:

| Cambio en el producto | Enricher | Embedder |
|---|---|---|
| Nada cambió y ya tiene vector | 0 | 0 |
| Cambió sólo el precio o el stock | 0 | 0 |
| Cambió `description_raw` | 1 | 1 |
| El dueño curó el texto (`description_curated = true`) | **0** | 1 |
| Nada cambió pero le falta el vector (falló una corrida previa) | 0 | 1 |

La decisión se toma comparando `enrichment_source_hash` con el hash de **lo que el dueño
controla** (nombre + rubro + texto curado o base). El texto que escribió la IA **no
participa del hash**: si participara, corregir una `description_raw` no cambiaría el hash
y el vector describiría el texto viejo para siempre.

### Variables de entorno

| Variable | Default | Para qué |
|---|---|---|
| `GEMINI_API_KEY` | — | Clave del proveedor. **Requerida en producción**; sin ella el runner queda `disabled`. Viaja en el header `x-goog-api-key`, nunca en la URL (AC-9) |
| `GEMINI_ENRICH_MODEL` | `gemini-1.5-flash` | Modelo del enriquecedor de texto (ADR-0003) |
| `GEMINI_EMBED_MODEL` | `text-embedding-004` | Modelo de embeddings. Su dimensión (768) está fijada en el esquema |
| `GEMINI_ENRICH_TIMEOUT_MS` | 20000 | Timeout por llamada de enriquecimiento |
| `GEMINI_EMBED_TIMEOUT_MS` | 10000 | Timeout por llamada de embedding |
| `GEMINI_MAX_RPM` | 15 | Tope de requests por minuto del free tier. El adapter espacia las salidas a `60000 / GEMINI_MAX_RPM`. **Es 15 sólo para la primera corrida** (decisión del PO 2026-08-23): cuando `/v1/search` entre en servicio baja a **5** y la búsqueda se queda con 10, porque es interactiva y el enriquecimiento puede esperar. Ver runbook §3.6 |
| `ENRICHMENT_ENABLED` | `true` | Kill-switch. En `false` el catálogo queda navegable sin enriquecer (AC-5) |
| `ENRICHMENT_BATCH_SIZE` | 25 | Productos arrendados por lote |
| `ENRICHMENT_CONCURRENCY` | 2 | Productos procesados en paralelo dentro del lote |
| `ENRICHMENT_MAX_ATTEMPTS` | 5 | Intentos antes de abandonar un producto (AC-5) |
| `ENRICHMENT_LEASE_MS` | 120000 | Duración del lease del claim: cuánto tarda en volver a la cola un producto de una corrida que murió |
| `ENRICHMENT_COOLDOWN_MS` | 300000 | Enfriamiento del breaker tras fallos consecutivos (AC-4) |
| `ENRICHMENT_FAILURE_THRESHOLD` | 5 | Fallos **consecutivos** que abren el breaker |
| `ENRICHMENT_MAX_ENRICHED_CHARS` | 1200 | Tope del texto generado (se recorta sin partir palabras) |
| `ENRICHMENT_RATE_LIMIT_MAX` | 6 | `POST /runs` por ventana e IP |
| `ENRICHMENT_RATE_LIMIT_TTL_MS` | 60000 | Ventana del presupuesto del `POST` (1 min) |

Un valor inválido **hace fallar el arranque** (Zod, fail-fast §7).

### Resiliencia: degradar sin desaparecer

- Un fallo **transitorio** (429, 5xx, timeout) se reintenta dentro de la llamada
  respetando el `Retry-After` del proveedor, y si igual falla queda un **backoff durable
  en la base** (1 m · 5 m · 25 m · 2 h · 10 h): el reintento sobrevive a un reinicio.
- A los `ENRICHMENT_MAX_ATTEMPTS` el producto queda **abandonado**: sale de la cola,
  conserva su `description_raw`, **sigue publicado y visible en la tienda** y aparece en
  `coverage.abandoned`. Se recupera con `POST /runs` y `{ "force": true }` — explícito,
  porque un reintento automático haría que el tope de intentos no sirva para nada.
- Tras `ENRICHMENT_FAILURE_THRESHOLD` fallos **consecutivos** el breaker abre y el
  ejecutor deja de llamar durante `ENRICHMENT_COOLDOWN_MS`. Insistir contra un proveedor
  caído sólo quema cuota que después falta para el catálogo real.
- **El enriquecimiento nunca publica ni despublica** (AC-10): el `UPDATE` enumera sus
  columnas y `status` no está entre ellas. Un borrador se enriquece y **sigue** borrador.
