---
parent-us: US-014
discipline: backend
variant: null
language: es
---

# US-014 Backend — Design

> Diseño de la **superficie de credenciales** del producto: identidad del cliente
> registrado, sesión por cookie con refresh rotado y recuperación de contraseña.
> Reusa íntegro el borde HTTP endurecido por US-001 (helmet §7.1, allowlist CORS
> §7.2, `ValidationPipe` 422, filtro RFC 7807, throttler nombrado `auth`) y **no
> reescribe** el `AdminGuard` (ADR-0009).

## Context

`apps/api` tiene hoy **cero identidad persistida**. El esquema AS-BUILT
(`packages/db/prisma/schema.prisma`) sólo declara `Category` y `Product`; el único
camino autenticado es el seam admin de US-001: `POST /v1/admin/auth/login`
intercambia un *bootstrap token* de configuración por un JWT `role=admin` de 1 h,
que `AdminGuard` valida por firma + claim. No hay usuarios, ni contraseñas, ni
sesión, ni revocación.

US-014 introduce el **cliente registrado**: un segundo actor, con credenciales
reales, PII básica (email, nombre, teléfono) y sesión de larga duración. Es la
primera vez que el producto custodia secretos de personas. El E2E ya fijó el
modelo (§8 DER `CUSTOMERS`, §14 STRIDE de la superficie "Login / registro /
sesión", §16 "JWT propio + bcrypt") y ADR-0005 lo ratificó; este change **no
re-arquitectura**, materializa y refina.

Dos condiciones de borde gobiernan el diseño:

1. **ADR-0009** promete que US-014 endurece la *emisión* del token admin
   **preservando el contrato `role=admin`** y sin tocar el guard. Su criterio de
   validación es literalmente "US-014 aterriza sin modificar `AdminGuard` ni
   ningún consumidor de `/v1/admin/*`".
2. **ADR-0010** fija el namespace: la raíz es del storefront público, `/admin/*`
   es del panel. El cliente es público ⇒ su auth vive en `/v1/auth/*`.

## Goals

- Registro que crea la cuenta con contraseña hasheada y **deja la sesión iniciada
  de inmediato** (AC-1), sin verificación bloqueante.
- Login/logout con sesión que se **invalida de verdad** al cerrar (AC-2/AC-3).
- Recuperación de contraseña por token de un solo uso, expirable, hasheado en
  reposo (AC-4/AC-7).
- Indistinguibilidad de respuestas para email existente vs inexistente en login y
  reset (AC-5/AC-11) y no-confirmación en registro (AC-6).
- Cookie `httpOnly`+`Secure`+`SameSite`, access corto + refresh rotado (AC-9), con
  detección de reuso.
- Rate-limit y lockout en las tres rutas sensibles (AC-10), reusando el throttler
  `auth` existente.
- La contraseña nunca sale del proceso: ni en respuestas, ni en logs, ni en
  eventos (AC-8).

## Non-goals

- **2FA** (cliente y admin) — `Deferred: follow-up de ADR-0009 — owner: Arquitecto`.
- **Borrado de cuenta / RTBF** — la columna `deleted_at` se crea (DER E2E §8) pero
  ningún endpoint la escribe. `Deferred: US futura de gestión de datos — owner: PO`.
- **Fusión del carrito guest con la cuenta** — fuera de v1 (US §4).
- **Historial de compras** — US-015.
- **Adapter Resend real** — `Deferred: US-011` (acá va el puerto; OQ-BE-1 ratificada
  2026-08-17). Consecuencia: **el email de recuperación no llega al cliente hasta
  US-011** — ver el recuadro de §Puerto de email.
- **Purga programada de tokens vencidos** — limpieza oportunista sí; job BullMQ
  `Deferred: US-011 / operaciones` (Redis aún no provisionado, ADR-0004).
- **Pantallas** (registro/login/reset) — `FE-US-014`.

## Decisión de arquitectura: ¿el cliente EXTIENDE el seam admin o es un seam aparte?

**Decisión: un solo módulo y una sola tabla de identidad; dos seams de emisión
separados por actor; un único guard por actor.**

Concretamente:

| Pieza | Admin (US-001, ADR-0009) | Cliente (US-014) |
|---|---|---|
| Tabla | `customers` con `role='admin'` (fila sembrada) | `customers` con `role='customer'` |
| Ruta de emisión | `POST /v1/admin/auth/login` (**se conserva**) | `POST /v1/auth/login` (nueva) |
| Transporte del token | `Authorization: Bearer` (**sin cambios**) + cookies aditivas | **Sólo** cookie `httpOnly` |
| Guard | `AdminGuard` — **no se toca** | `CustomerGuard` (nuevo) |
| Claim de rol | `role=admin` — **contrato preservado** | `role=customer` |
| Primitivas | comparten `PasswordHasher`, lockout, `SessionService`, throttler `auth` | idem |

**Por qué una sola tabla y no dos**: el E2E §8 lo modela así explícitamente —
`CUSTOMERS { … string role "customer|admin" }`. El PRD §7 tiene **un** dueño y
ningún multi-tenant. Dos tablas de credenciales significan dos implementaciones de
bcrypt, dos de lockout y dos de reset — precisamente la duplicación que la sección
"Negative" de ADR-0009 pide acotar. La separación de privilegios se sostiene en el
claim + el guard, que son server-side y autoritativos (`security-standards §4`).

**Por qué dos seams de emisión y no uno**: los actores tienen transporte,
audiencia y ciclo de vida distintos. El panel de US-001 ya consume
`adminSession.login` esperando `{ token }` en el cuerpo y manda `Authorization`;
unificar la emisión obligaría a migrar el FE admin (change archivado) sin ningún
AC que lo pida. Mantener la ruta admin y **agregarle** el login por credenciales
es aditivo: cero churn en consumidores, contrato `role=admin` intacto, y el
criterio de validación de ADR-0009 se cumple al pie de la letra (el guard no se
modifica).

**¿Dispara un ADR nuevo?** El *seam* en sí, **no**: ADR-0009 ya autorizó
exactamente este reparto (guard de US-001, emisión endurecida por US-014) y
ADR-0005 el modelo JWT propio + bcrypt + cookie + refresh rotado. Lo que **sí**
dispara ADR es una consecuencia colateral: la tabla `refresh_tokens`
**contradice** una nota `Neutral` de ADR-0005 ("la invalidación se logra vía TTL
corto + rotación **en vez de** un almacén server-side"). AC-3 y
`security-standards §3.3` exigen un camino de revocación real ⇒ **ADR-0011**
(enmienda, no supersede) es obligatorio antes de implementar. Está como T0.1 y
como OQ-BE-2.

## Approach

### Estructura de módulo

```
apps/api/src/auth/
  auth.module.ts                     # EXTENDIDO: registra lo nuevo, conserva lo de US-001
  admin-auth.controller.ts           # EXTENDIDO (Fase 8): acepta {email,password} además del bootstrap
  admin-auth.service.ts              # EXTENDIDO (Fase 8): delega en CredentialsService
  admin.guard.ts                     # INTACTO (ADR-0009)
  auth-throttler.guard.ts            # INTACTO — se reusa tal cual
  customer-auth.controller.ts        # NUEVO — /v1/auth/*
  customer-auth.service.ts           # NUEVO — register / login / logout / me
  session.service.ts                 # NUEVO — emisión, rotación, revocación de familia
  password-reset.service.ts          # NUEVO — request / confirm
  credentials.service.ts             # NUEVO — verificación + lockout (compartido admin/cliente)
  customer.guard.ts                  # NUEVO — cookie de access, role=customer
  csrf.guard.ts                      # NUEVO — double-submit firmado + chequeo de Origin (§7.5)
  cookies.ts                         # NUEVO — atributos de cookie en un solo lugar
  password/
    password-hasher.ts               # NUEVO — bcrypt cost 12 + hash señuelo
    password-policy.ts               # NUEVO — §3.2 + corpus offline
    breached-passwords.txt           # NUEVO — corpus versionado
  tokens/
    opaque-token.ts                  # NUEVO — CSPRNG 256 bits + SHA-256 para reposo
  customers.repository.ts            # NUEVO — único punto de ORM de customers
  refresh-tokens.repository.ts       # NUEVO
  password-reset-tokens.repository.ts# NUEVO
  dto/
    admin-auth.dto.ts                # EXTENDIDO (Fase 8)
    customer-auth.dto.ts             # NUEVO — Register/Login/ResetRequest/ResetConfirm/CustomerResponse
apps/api/src/common/errors/auth-errors.ts   # NUEVO — dsm:auth/*
apps/api/src/observability/auth-events.service.ts # NUEVO
```

Layering estricto `controller → service → repository`
(`backend-node-standards §2`): el controller valida el DTO, delega y mapea a
respuesta; **ningún** service toca `PrismaService` directamente (§5).

### API — superficie nueva

| Método | Ruta | Auth | Éxito | Errores |
|---|---|---|---|---|
| `POST` | `/v1/auth/register` | ninguna | `201` + cookies + `{ customer }` | `409 dsm:auth/registration-failed`, `422`, `429` |
| `POST` | `/v1/auth/login` | ninguna | `200` + cookies + `{ customer }` | `401 dsm:auth/invalid-credentials`, `422`, `429` |
| `POST` | `/v1/auth/refresh` | cookie refresh + CSRF | `200` + cookies rotadas | `401 dsm:auth/invalid-refresh`, `403 dsm:auth/csrf`, `429` |
| `POST` | `/v1/auth/logout` | cookie access + CSRF | `204` + cookies borradas | `401 dsm:auth/unauthenticated`, `403 dsm:auth/csrf` |
| `GET` | `/v1/auth/me` | cookie access | `200` `{ customer }` | `401 dsm:auth/unauthenticated` |
| `POST` | `/v1/auth/password-reset/request` | ninguna | `202` (siempre) | `422`, `429` |
| `POST` | `/v1/auth/password-reset/confirm` | ninguna | `200` | `400 dsm:auth/invalid-reset-token`, `422`, `429` |

`CustomerResponseDto` expone **exactamente** `{ id, email, name, phone, created_at }`.
Nunca `password_hash`, `role`, contadores de lockout ni `deleted_at` (AC-8 y
§Information disclosure).

El namespace `/v1/auth/*` (no `/v1/admin/auth/*`) sale de ADR-0010: el cliente es
público, la raíz es del storefront. `/v1/admin/auth/login` sigue siendo la ruta del
panel.

### Sesión — access JWT en cookie + refresh opaco rotado

- **Access token**: JWT firmado HS256 con `JWT_SECRET` (ya existente), claims
  `{ sub: <customer_id>, role: 'customer', typ: 'access', jti: <uuid>, iss: 'dsm-api', aud: 'dsm-web' }`,
  `expiresIn = AUTH_ACCESS_TTL_MIN` (default **15 min**, US §9). Viaja **sólo** en
  la cookie `dsm_access`. Verificación con **pin de algoritmo** (`algorithms: ['HS256']`),
  y validación de `exp` + `iss` + `aud` + `typ` (`security-standards §3.3`); un
  refresh no puede usarse como access ni viceversa.
- **Refresh token**: **opaco**, 32 bytes de `crypto.randomBytes` en base64url. No
  es un JWT — no necesita ser auto-descriptivo y así no hay riesgo de aceptar uno
  con claims manipulados. Viaja en la cookie `dsm_refresh` con
  `path=/v1/auth` (reduce la superficie: no se envía en ninguna otra ruta).
  TTL `AUTH_REFRESH_TTL_DAYS` (default **30**, OQ-BE-4).
- **Rotación**: cada `POST /refresh` marca el token usado (`rotated_at`) y emite
  uno nuevo **en la misma familia** (`family_id` heredado), dentro de una
  `$transaction` (§5) para que no exista estado parcial.
- **Detección de reuso** (obligatoria, §3.3): si llega un refresh cuyo hash existe
  pero ya tiene `rotated_at` o `revoked_at`, se **revoca la familia entera**
  (`revoked_at = now()` para todas las filas con ese `family_id`), se emite el
  evento `auth.refresh_reuse_detected` y se responde `401` — el usuario legítimo
  debe re-loguearse. Es la señal canónica de robo de token.
- **Logout (AC-3)**: revoca la familia del refresh presentado y borra las tres
  cookies. La ventana residual del access token es ≤ 15 min y está **declarada**
  como consecuencia aceptada (idéntica a la nota de ADR-0005); un denylist por
  `jti` se descarta por costo/beneficio a este volumen y queda documentado.

### Cookies (AC-9, §7.4)

| Cookie | Contenido | `httpOnly` | `Secure` | `SameSite` | `path` | `Max-Age` |
|---|---|---|---|---|---|---|
| `dsm_access` | access JWT | **sí** | `AUTH_COOKIE_SECURE` (default `true`) | `Lax` | `/` | TTL del access |
| `dsm_refresh` | refresh opaco | **sí** | idem | `Lax` | `/v1/auth` | TTL del refresh |
| `dsm_csrf` | token CSRF firmado | **no** (el JS debe leerlo) | idem | `Lax` | `/` | TTL del access |

`SameSite=Lax` y no `Strict`: web y API viven en subdominios del mismo sitio
registrable (`dsm.com` / `api.dsm.com`), así que `Lax` cubre el XHR con
`credentials: 'include'` que ya habilita la config CORS de US-001
(`credentials: true`), y `Strict` rompería navegaciones legítimas de vuelta al
sitio. Sin `Domain` ⇒ cookies host-only del API. Prefijos `__Host-`/`__Secure-`
descartados con justificación (OQ-BE-6). `Secure` se gobierna por config para no
romper el loop local en HTTP; **en cualquier entorno desplegado vale `true`** y la
validación Zod lo declara.

### CSRF (§7.5) — double-submit firmado

Al autenticar por cookie, §7.5 exige una segunda capa además de `SameSite`. Se
implementa **double-submit firmado sin estado**:

- Al emitir sesión se setea `dsm_csrf = HMAC-SHA256(JWT_SECRET, jti_del_access)`
  en base64url (cookie legible por JS).
- Toda escritura autenticada por cookie (`/logout`, `/refresh` y, a futuro,
  `/v1/me/*`) exige el header `X-CSRF-Token` con ese valor; el guard **recalcula**
  el HMAC desde el `jti` del token presentado y compara con `timingSafeEqual`.
  Sin estado adicional en DB y sin posibilidad de forjarlo sin `JWT_SECRET`.
- Además se verifica `Origin` (fallback `Referer`) contra la **misma allowlist de
  CORS** (`parseCorsOrigins`); ausencia de `Origin` en una escritura autenticada
  por cookie ⇒ rechazo (§7.5).
- Las rutas **no autenticadas** (`register`, `login`, `password-reset/*`) no llevan
  CSRF: no hay cookie sobre la que cabalgar; su defensa es el rate-limit.

Consecuencia de contrato con FE-US-014: el cliente debe leer `dsm_csrf` y enviar
`X-CSRF-Token`. Se declara acá y se agrega el header a `allowedHeaders` de CORS.

### Credenciales — hash, política, anti-timing

- **bcrypt, cost 12** (`security-standards §3.1`, mínimo cost ≥ 12).
  **Justificación de bcrypt sobre argon2id** (que el estándar prefiere): AC-8 de la
  US nombra bcrypt textualmente, ADR-0005 `Accepted` lo fija, y el E2E §16 lo
  repite; cambiar a argon2id sería una desviación de tres artefactos aprobados que
  requiere enmienda de ADR, sin beneficio proporcional a este perfil de riesgo
  (un e-commerce de barrio, sin cumplimiento declarado en `project-config.yml`).
  bcrypt cost 12 **es** una opción aceptable del estándar, no una excepción.
- **Límite de 72 bytes**: bcrypt trunca a 72 bytes y §3.1 prohíbe truncar antes de
  hashear ⇒ el DTO **rechaza** (`422`) contraseñas de más de 72 bytes en vez de
  truncarlas silenciosamente. Satisface el "máximo ≥ 64" de §3.2 para el juego
  ASCII; el límite se documenta en el mensaje de validación.
- **Política (§3.2)**: mínimo **8**, máximo **72 bytes**, cualquier carácter
  imprimible incluido espacios y Unicode, **sin** reglas de composición, **sin**
  preguntas de recuperación. Chequeo contra corpus offline de contraseñas
  filtradas (top 10 000, versionado en el repo y cargado a un `Set` una vez al
  arranque) — la opción "offline list" que §3.2 admite explícitamente, elegida
  sobre la API de HIBP para no meter una dependencia de red en el camino de
  registro.
- **Anti-timing**: si el email no existe, el service igual ejecuta
  `bcrypt.compare(password, DUMMY_HASH)` contra un hash constante generado al
  arranque, de modo que el costo de CPU sea el mismo (§7.3 "timing comparable").
  La comparación siempre es la función `compare` de la librería (tiempo constante),
  nunca `===`.

### Anti-enumeración (AC-5 / AC-6 / AC-11)

| Situación | Respuesta |
|---|---|
| Login con contraseña incorrecta | `401 dsm:auth/invalid-credentials` — "Email o contraseña incorrectos." |
| Login con email inexistente | **idéntica** (mismo `type`, `status`, `detail`, mismo trabajo de hash) |
| Login de cuenta bloqueada por lockout | **idéntica** — revelar el bloqueo confirmaría que la cuenta existe |
| Reset de email existente | `202` — "Si el email está registrado, te enviamos un link." |
| Reset de email inexistente | **idéntica**, y el envío es fuera de banda ⇒ no hay diferencia de timing |
| Registro con email nuevo | `201` + sesión |
| Registro con email existente | `409 dsm:auth/registration-failed` — "No pudimos crear la cuenta con esos datos." (no confirma; ver OQ-BE-5) |
| Reset con token inválido / vencido / usado | `400 dsm:auth/invalid-reset-token` — idéntico en los tres casos |

### Rate-limit y lockout (AC-10, §7.3)

Dos controles **complementarios**, no redundantes: el throttler es por **IP** (para
el atacante distribuido con muchas cuentas), el lockout es por **cuenta** (para el
atacante concentrado contra una víctima).

- **Throttler**: se **reusa el throttler nombrado `auth`** ya registrado en
  `AuthModule` y su `AuthThrottlerGuard` (que emite `RateLimit-*` + `Retry-After`,
  `api-standards §12`). No se registra un throttler nuevo. Presupuesto por ruta con
  `@Throttle({ auth: { … } })`:

  | Ruta | Límite por IP |
  |---|---|
  | `POST /v1/auth/login` | 10 / 15 min |
  | `POST /v1/auth/register` | 5 / 60 min |
  | `POST /v1/auth/password-reset/request` | 5 / 60 min |
  | `POST /v1/auth/password-reset/confirm` | 10 / 60 min |
  | `POST /v1/auth/refresh` | 60 / 15 min |

  Todas llevan además `@SkipThrottle({ storefront: true })`, igual que
  `AdminAuthController`, para que sólo las limite el throttler `auth`.
- **Lockout por cuenta**: `failed_login_attempts` se incrementa en cada fallo; al
  llegar a `AUTH_LOGIN_MAX_FAILURES` (default **5**) se fija
  `locked_until = now() + min(15 min × 2^(bloqueos-1), 60 min)` — **temporal con
  backoff exponencial acotado**, nunca permanente (§7.3: el lockout permanente es
  un vector de DoS contra el usuario legítimo). Un login exitoso resetea contador y
  bloqueo. La solicitud de reset **no** desbloquea (sería un bypass trivial), pero
  completar el reset sí (el dueño real recuperó la cuenta).
- **Reset por cuenta**: máximo **3 por hora** (§7.3), contado sobre
  `password_reset_tokens` creados en la última hora — sin columna extra. Al
  excederlo **no** se emite token pero **sí** se responde `202` (la
  indistinguibilidad manda).

### Recuperación de contraseña (AC-4 / AC-7)

1. `POST /password-reset/request { email }` → normaliza el email, busca la cuenta.
   Si existe y no superó el cupo horario: genera token opaco de 32 bytes, guarda
   **sólo su SHA-256**, `expires_at = now() + PASSWORD_RESET_TTL_MIN` (default
   **60 min**, tope de §3.7), y despacha el email **fuera de banda** por el puerto
   `PasswordResetMailer`. Responde `202` siempre.
2. `POST /password-reset/confirm { token, password }` → hashea el token recibido,
   busca por hash, valida `used_at IS NULL` y `expires_at > now()`. En una
   `$transaction`: actualiza `password_hash` + `password_changed_at`, marca
   `used_at`, **borra el resto de tokens de reset** de esa cuenta, **revoca todas
   las familias de refresh** (§3.7 — "completar un reset invalida todas las
   sesiones activas") y resetea lockout. Responde `200` **sin** emitir sesión
   nueva (el usuario vuelve a loguearse; evita convertir el link de email en un
   camino de login de un clic).

**Por qué SHA-256 y no bcrypt para los tokens**: son secretos de **alta entropía**
generados por el servidor (256 bits), no contraseñas humanas — no hay diccionario
que atacar, así que el factor de trabajo no aporta, y la búsqueda por hash exige
determinismo (bcrypt saltea por diseño y haría imposible el `WHERE token_hash = …`).
Es la práctica estándar y satisface §3.7 ("almacenado hasheado — un token de
verificación es una credencial").

### Persistencia

**Paso 1-2 (clasificación de carga → motor ideal)**: datos relacionales, acceso por
id y por clave única (email, hash de token), volumen pequeño (≤ decenas de miles de
filas), consistencia **estricta** (unicidad de email, uso único de token, rotación
atómica) ⇒ **RDBMS**. **Paso 3-4 (reglas del proyecto)**: la baseline del proyecto
es PostgreSQL único (ADR-0002, E2E §8) ⇒ **Postgres/Neon**, sin desviación.
**Paso 5 (estado actual)**: motor actual == motor ideal ⇒ se **extiende**, no se
migra. **Paso 6**: sin trade-off que reportar; `data-architect` Mode B **no** se
invoca (tres tablas nuevas sin movimiento de datos, sin nuevo motor, sin
cumplimiento declarado en `project-config.yml`).

> **Nota de cumplimiento**: `cliente.compliance: []` — no hay GDPR/PCI declarados.
> Igual aplican PRD §6 (PII básica, base legal Ley 25.326, consentimiento en
> checkout — US-017) y las reglas de PII de `observability-standards §9`: el email
> es PII y **no** entra en logs, métricas ni eventos.

#### `customers` (nueva — DER E2E §8 + columnas operativas de auth)

| Columna | Tipo Prisma / SQL | Nulo | Default | Notas |
|---|---|---|---|---|
| `id` | `String @db.Uuid` / `uuid` | no | `gen_random_uuid()` | PK. Mismo patrón `dbgenerated` que `Category`/`Product` |
| `email` | `String` / `text` | no | — | **UNIQUE**. Guardado ya normalizado (trim + NFKC + `toLowerCase`) |
| `password_hash` | `String` / `text` | no | — | bcrypt cost 12 (60 chars). Nunca sale del backend |
| `name` | `String` / `text` | no | — | 1..120 chars (DTO) |
| `phone` | `String?` / `text` | **sí** | — | DER E2E §8. AC-1 sólo pide email/nombre/contraseña; lo completa el checkout (US-008) |
| `role` | `String` / `text` | no | `'customer'` | `'customer' \| 'admin'` (DER E2E §8). Validado en app; el guard es la autoridad |
| `failed_login_attempts` | `Int` / `integer` | no | `0` | Contador de lockout (§7.3) |
| `lockout_count` | `Int` / `integer` | no | `0` | Nº de bloqueos consecutivos → exponente del backoff |
| `locked_until` | `DateTime?` / `timestamp(3)` | **sí** | — | Bloqueo temporal; `null` = sin bloqueo |
| `password_changed_at` | `DateTime` / `timestamp(3)` | no | `now()` | Auditoría + invalidación de sesiones tras cambio |
| `last_login_at` | `DateTime?` / `timestamp(3)` | **sí** | — | Señal operativa (sin IP: la IP es PII) |
| `deleted_at` | `DateTime?` / `timestamp(3)` | **sí** | — | Soft-delete del DER E2E §8. **Ningún endpoint la escribe en este change** (`Deferred`); el login la filtra desde ya |
| `created_at` | `DateTime` / `timestamp(3)` | no | `now()` | |
| `updated_at` | `DateTime` / `timestamp(3)` | no | `now()` `@updatedAt` | Mismo patrón que `Product` |

Índices: `@@unique([email])` (índice único implícito, cubre el login) y
`@@map("customers")`. Sin índice por `role` (cardinalidad 2 y tabla chica: un scan
es más barato que el índice).

**Unicidad de email — estrategia**: normalización **en la aplicación** (trim,
Unicode NFKC, `toLowerCase()`) + `UNIQUE` plano, **no** `citext`. Razón: es la
convención de la casa —`categories.slug` y la migración
`20260816120000_add_product_slug` normalizan en app/SQL explícito y evitan
deliberadamente depender de extensiones (`unaccent`)—, es testeable sin base y
mantiene el comportamiento idéntico entre Prisma, tests y SQL directo. Coste
aceptado: cualquier escritura futura de `customers` debe pasar por
`CustomersRepository`, que es el único lugar que normaliza (§5 lo garantiza).

**Soft-delete y unicidad**: el `UNIQUE` es sobre `email` sin condición. Una cuenta
borrada **no libera** su email hasta que el flujo de borrado (fuera de alcance) lo
anonimice. Se documenta como contrato para esa US futura: *anonimizar, no liberar*.

#### `refresh_tokens` (nueva — no está en el DER; extensión declarada acá)

| Columna | Tipo | Nulo | Default | Notas |
|---|---|---|---|---|
| `id` | `String @db.Uuid` | no | `gen_random_uuid()` | PK |
| `customer_id` | `String @db.Uuid` | no | — | FK → `customers.id`, `onDelete: Cascade` |
| `token_hash` | `String` | no | — | **UNIQUE**. SHA-256 hex del token opaco. **Nunca** el token en claro |
| `family_id` | `String @db.Uuid` | no | — | Familia de rotación; el reuso revoca la familia entera |
| `expires_at` | `DateTime` | no | — | `now() + AUTH_REFRESH_TTL_DAYS` |
| `rotated_at` | `DateTime?` | **sí** | — | Marca de uso; un token con `rotated_at` presentado de nuevo = reuso |
| `revoked_at` | `DateTime?` | **sí** | — | Logout, reuso detectado o reset de contraseña |
| `created_at` | `DateTime` | no | `now()` | |

Índices: `@@unique([token_hash])`, `@@index([customer_id])` (revocar todo al
resetear), `@@index([family_id])` (revocar familia), `@@index([expires_at])`
(limpieza). `@@map("refresh_tokens")`.

#### `password_reset_tokens` (nueva — no está en el DER; extensión declarada acá)

| Columna | Tipo | Nulo | Default | Notas |
|---|---|---|---|---|
| `id` | `String @db.Uuid` | no | `gen_random_uuid()` | PK |
| `customer_id` | `String @db.Uuid` | no | — | FK → `customers.id`, `onDelete: Cascade` |
| `token_hash` | `String` | no | — | **UNIQUE**. SHA-256 hex; el claro sólo viaja en el email |
| `expires_at` | `DateTime` | no | — | `now() + PASSWORD_RESET_TTL_MIN` (≤ 1 h, §3.7) |
| `used_at` | `DateTime?` | **sí** | — | Uso único (AC-7) |
| `created_at` | `DateTime` | no | `now()` | Base del cupo de 3/hora |

Índices: `@@unique([token_hash])`, `@@index([customer_id, created_at])` (cupo
horario + borrado masivo al confirmar), `@@index([expires_at])` (limpieza).
`@@map("password_reset_tokens")`.

#### Forma de la migración

**Una sola migración aditiva**, `packages/db/prisma/migrations/<ts>_add_customer_auth/`,
que sólo hace `CREATE TABLE` + `CREATE INDEX` + `ALTER TABLE … ADD CONSTRAINT`
(FKs). **No** hace falta el patrón de tres pasos del precedente
`20260816120000_add_product_slug`: ese existía porque `products` ya tenía filas y
la columna nueva llegaba `NOT NULL`; acá las tres tablas **nacen vacías**, así que
`NOT NULL` + `UNIQUE` se declaran de entrada. Es hacia-atrás compatible: la versión
vieja del API ignora tablas que no conoce ⇒ sirve un rolling deploy.

**Aviso heredado de US-003 §Deployment**: `prisma migrate deploy` aplica **todas**
las migraciones pendientes de `packages/db`, no las de una US. Ningún plan puede
asumir deferral de columnas por-US a nivel de migración.

**Limpieza**: cada `confirm` de reset borra los tokens de reset de esa cuenta, y
cada rotación de refresh borra los `expires_at < now()` **de esa misma cuenta**
(barrido acotado, sin tabla completa). El job programado global queda
`Deferred: US-011 / operaciones` (necesita BullMQ, ADR-0004).

### Manejo de errores

Se agregan clases de dominio en `apps/api/src/common/errors/auth-errors.ts`,
extendiendo la `DomainError` existente (§6) para que el `HttpProblemFilter` global
las mapee sin tocarlo:

| Clase | `status` | `type` |
|---|---|---|
| `InvalidCredentialsError` | 401 | `dsm:auth/invalid-credentials` |
| `UnauthenticatedError` | 401 | `dsm:auth/unauthenticated` |
| `InvalidRefreshError` | 401 | `dsm:auth/invalid-refresh` |
| `CsrfError` | 403 | `dsm:auth/csrf` |
| `RegistrationFailedError` | 409 | `dsm:auth/registration-failed` |
| `InvalidResetTokenError` | 400 | `dsm:auth/invalid-reset-token` |

El `TITLES` del filtro ya cubre 400/401/403/409/422/429. **Wart conocido y
aceptado**: el 429 del throttler sale por la rama `HttpException` con
`type: dsm:catalog/http-429` (prefijo heredado de US-001). Renombrar el prefijo
genérico rompería el contrato publicado y los tests de US-001/US-003 sin ganancia
funcional; se documenta y se deja para una limpieza transversal.

### Observabilidad (US §9, E2E §18)

`AuthEventsService` espeja la forma de `CatalogEventsService` (contador en memoria
+ log pino estructurado) pero con su propia unión de nombres — extender
`CatalogEventName` con eventos de auth mezclaría dominios y arrastraría el
parámetro `admin_user_id`.

| Evento | Cuándo | `entity_id` |
|---|---|---|
| `auth.registered` | alta OK | `customer_id` |
| `auth.login_succeeded` | login OK | `customer_id` |
| `auth.login_failed` | credenciales inválidas | `customer_id` si existe, si no **`null`** |
| `auth.account_locked` | se fija `locked_until` | `customer_id` |
| `auth.logout` | logout OK | `customer_id` |
| `auth.password_reset_requested` | se emite token | `customer_id` |
| `auth.password_reset_completed` | confirm OK | `customer_id` |
| `auth.refresh_reuse_detected` | reuso ⇒ familia revocada | `customer_id` |

**Reglas de PII** (`observability-standards §9` + `observability-patterns §3.3`):
`entity_id` es el UUID (pseudónimo) — **jamás** el email, ni siquiera hasheado, ni
la IP; jamás la contraseña, el hash, el token de refresh o el de reset. Los
contadores **no** llevan dimensión por usuario (explosión de cardinalidad); el
detalle por usuario vive en el log correlacionado por `trace_id`.

`auth.refresh_reuse_detected` es la señal que merece alerta operativa: indica robo
de token. Se declara como candidata a alerta P2 en el runbook
`[propuesto — confirma Arquitecto]`.

### Puerto de email (OQ-BE-1 — ratificada por el PO el 2026-08-17)

```ts
export interface PasswordResetMailer {
  send(to: string, resetToken: string): Promise<void>;
}
```

Adapter de este change: `LoggingPasswordResetMailer` — registra que se despachó un
reset para `customer_id` (**nunca** el email ni el token) y, sólo cuando
`NODE_ENV !== 'production'`, escribe el link en el log de desarrollo para poder
ejercer AC-4 end-to-end en local y en los tests. En producción el adapter de log
**no** escribe el token: si US-011 no aterrizó, el flujo queda inerte y visible en
métricas, no filtrando secretos por el log.

> **`Deferred: US-011 — entrega real del email de recuperación`.** Qué **no**
> funciona hasta que US-011 aterrice, dicho sin eufemismos:
>
> | Parte de AC-4 | Estado tras US-014 |
> |---|---|
> | Emisión del token (CSPRNG 256 bits, hash SHA-256 en reposo, TTL ≤ 1 h) | **Completo** |
> | Cupo de 3 solicitudes por hora y respuesta `202` indistinguible (AC-11) | **Completo** |
> | Uso único, expiración y `400` uniforme del token (AC-7) | **Completo** |
> | Cambio de contraseña + revocación de todas las sesiones al confirmar | **Completo** |
> | **Que al cliente le llegue el email con el link** | **NO funciona en producción.** El adapter de log no envía nada y, por diseño, tampoco escribe el token fuera de desarrollo |
>
> Consecuencia operativa: desplegar US-014 sin US-011 deja un flujo de
> recuperación **inalcanzable para el usuario final** — el botón "olvidé mi
> contraseña" responde `202` y no pasa nada más. El ciclo completo se ejercita en
> tests (donde el adapter sí expone el token) y en local, no en producción. Esto
> debe estar en las notas de release y, si el despliegue de US-014 precede a
> US-011, el FE debería ocultar o deshabilitar la entrada al flujo — decisión de
> `FE-US-014` que este change señala pero no toma.

## Seguridad — threat model lite (STRIDE de la frontera de auth)

Frontera: **Untrusted (Internet) → API NestJS** sobre las rutas `/v1/auth/*` y la
tabla de credenciales (E2E §14, fila "Login / registro / sesión"). No dispara la
regla de escalado a threat model formal: sin PCI (el pago es hosted, ADR-0006), sin
PHI, **sin primitiva criptográfica nueva** (bcrypt de librería, HMAC-SHA256
estándar, JWT HS256 ya en uso) y sin nueva frontera de confianza con terceros.

| Amenaza | Vector concreto | Control en este diseño |
|---|---|---|
| **S** Spoofing | *Credential stuffing* con listas filtradas | bcrypt cost 12 + lockout por cuenta con backoff + throttler `auth` por IP + rechazo de contraseñas del corpus filtrado |
| **S** Spoofing | Robo de cookie por XSS | `httpOnly` en access y refresh (el JS **no** puede leerlos) + CSP `default-src 'none'` ya global (§7.1) |
| **S** Spoofing | Replay de un refresh robado | Rotación de un solo uso + **detección de reuso** que revoca la familia y fuerza re-login |
| **T** Tampering | `role: 'admin'` inyectado en el body del registro | El DTO tiene `whitelist: true` + `forbidNonWhitelisted: true` (rechaza campos desconocidos con 422) y `role` **no** es campo de entrada: se fija server-side a `'customer'` |
| **T** Tampering | JWT con `alg: none` o cambio de algoritmo | Pin `algorithms: ['HS256']` + validación de `exp`/`iss`/`aud`/`typ` |
| **T** Tampering | CSRF: sitio hostil dispara `POST /v1/auth/logout` o `/refresh` con las cookies de la víctima | `SameSite=Lax` + double-submit **firmado** (`X-CSRF-Token` ligado por HMAC al `jti`) + verificación de `Origin` contra la allowlist |
| **R** Repudiation | El usuario niega el cambio de contraseña | Eventos `password_reset_requested` / `completed` con `customer_id` + `trace_id` + `password_changed_at` en la fila |
| **I** Info disclosure | **Enumeración de cuentas** — el vector principal de esta superficie | Respuestas idénticas en login (existente/inexistente/bloqueada) y en reset (`202` siempre); hash señuelo para igualar el timing; registro con `409` genérico (OQ-BE-5) |
| **I** Info disclosure | Fuga de credenciales por respuesta o log | `CustomerResponseDto` explícito (sin `password_hash`/`role`/lockout); ningún log ni evento incluye contraseña, hash, tokens ni email; test e2e que barre cuerpo y logs (AC-8) |
| **I** Info disclosure | Tokens legibles en la base ante lectura no autorizada | Contraseña con bcrypt; refresh y reset **hasheados con SHA-256 en reposo** — la base nunca guarda un secreto usable |
| **D** DoS | Fuerza bruta que satura CPU (bcrypt es caro **a propósito**) | Throttler por IP **antes** del hash (el guard corre antes del handler) + cupo de reset por cuenta + presupuestos por ruta |
| **D** DoS | Lockout usado como arma contra un usuario legítimo | Bloqueo **temporal** con backoff acotado a 60 min, **nunca** permanente (§7.3) |
| **E** Elevation | Cliente que se promueve a admin | `role` server-side, jamás del cliente; `AdminGuard` intacto exige `role=admin` en un JWT firmado; `CustomerGuard` exige `role=customer` — un access de cliente **no** abre `/v1/admin/*` (test e2e explícito) |
| **E** Elevation | Un refresh usado como access | Claim `typ` validado por el guard; además el refresh es opaco, no un JWT |

**Fail closed (§3.8)**: cualquier error en la verificación (base caída, secreto
ausente, token ilegible) devuelve 401/503 y **rechaza**; no hay `catch` que
continúe. `JWT_SECRET` sigue viniendo de variables de plataforma, validado por Zod
al arranque (§5, §7).

## NFRs cuantificados (`nfr-quantification`)

| NFR | Valor propuesto | Cómo se sostiene |
|---|---|---|
| Latencia `POST /v1/auth/login` | **p95 < 600 ms / p99 < 1 s** `[propuesto — confirma Arquitecto]` | bcrypt cost 12 cuesta ~250-350 ms de CPU **por diseño** (es el factor de trabajo). Es una desviación **deliberada** del presupuesto de escritura del E2E §17 (p95 < 500 ms), justificada: bajar el cost para entrar en 500 ms debilitaría el control principal |
| Latencia `POST /v1/auth/register` | **p95 < 700 ms** `[propuesto — confirma Arquitecto]` | bcrypt + insert + chequeo del corpus (en memoria, O(1)) |
| Latencia `GET /v1/auth/me` y `POST /refresh` | **p95 < 150 ms** | Sin bcrypt: verificación de JWT + un lookup por índice único |
| Throughput pico de login | **~3 rps** `[propuesto — confirma PO con datos reales]` | ~50 concurrentes pico (E2E §17), cuentas opcionales sobre un loop dominado por guest: adopción estimada 20% ⇒ el pico de login no compite con el catálogo. A 3 rps, bcrypt cost 12 consume ~1 core |
| Disponibilidad | **99,5% mensual** (tier heredado del E2E §17) | Sin cambio de tier: es la misma app |
| RPO / RTO de credenciales | **RPO ≤ 24 h / RTO ≤ 4 h** (heredado E2E §17) | Neon PITR. Nota: perder ≤ 24 h de altas es tolerable a este volumen; el usuario puede re-registrarse |
| Ventana de invalidación de sesión | **≤ 15 min** (TTL del access) | Consecuencia declarada del modelo sin denylist por `jti` |

Cada número tiene su medición: los eventos de `AuthEventsService` + los logs pino
con `trace_id` alimentan las métricas; la alerta candidata es
`auth.refresh_reuse_detected` (P2) y una tasa anómala de `auth.login_failed`.

## Testing (owned-by-dev; `qa-backend-standards §2.1`)

- **Unit**: hasher (hash ≠ claro, `verify` OK/KO, señuelo con costo equivalente);
  política de contraseña (mínimo, 72 bytes, sin reglas de composición, corpus);
  normalización de email; generador de tokens (entropía, hash determinista);
  `SessionService` con repos mockeados (rotación, reuso ⇒ revocación de familia);
  lockout (umbral, backoff, tope, reset al éxito); HMAC de CSRF.
- **Integration (Postgres real, esquema `@dsm/db`)**: unicidad de email
  normalizado (`Ana@X.com` vs `ana@x.com`); rotación y revocación de familia;
  uso único y expiración del token de reset; borrado en cascada.
- **e2e-nest (supertest)**: los 11 AC + atributos de cookie + ausencia de token en
  el cuerpo + 429 con `Retry-After` + indistinguibilidad de respuestas + CSRF +
  cliente que **no** abre `/v1/admin/*`.
- **Fuera de alcance (QA)**: Playwright del flujo completo, pruebas de abuso/carga
  del login, revisión de accesibilidad de los formularios → `QA-US-014`.

## Trade-offs

- **bcrypt cost 12 vs argon2id.** Elegido bcrypt por alineación con AC-8, ADR-0005
  y E2E §16 (tres artefactos aprobados que lo nombran) y porque el estándar lo
  admite. Coste: bcrypt trunca a 72 bytes (mitigado rechazando entradas mayores) y
  es menos resistente a GPU que argon2id. Revisable con enmienda de ADR si el
  perfil de riesgo cambia.
- **Tabla de refresh tokens vs sólo TTL corto.** La tabla es imprescindible para
  AC-3 (logout real) y para la detección de reuso que §3.3 exige. Coste: una
  escritura por login y una por refresh, y contradice una nota `Neutral` de
  ADR-0005 ⇒ ADR-0011 (OQ-BE-2).
- **Access en cookie `httpOnly` vs en memoria del cliente.** La cookie es el
  mandato de AC-9 y de ADR-0005. Coste: obliga a la maquinaria CSRF (§7.5) que un
  esquema con `Authorization` header no necesitaría. Aceptado: XSS es un riesgo más
  probable que CSRF en un storefront público.
- **Una tabla `customers` con `role` vs tablas separadas admin/cliente.**
  Elegida la del DER (E2E §8). Coste: una fila mal seteada promueve a admin ⇒ el
  `role` nunca es entrada del cliente y hay test explícito de esa negativa.
- **Corpus offline de contraseñas filtradas vs API de HIBP.** Offline: sin
  dependencia de red en el camino de registro (que además tendría que fallar
  abierto). Coste: cobertura menor y un archivo que envejece; se documenta como
  candidato a refresco anual.
- **`409` en registro duplicado vs indistinguibilidad total.** Ver OQ-BE-5: AC-1
  (sesión inmediata) hace imposible la indistinguibilidad total sin cambiar el
  flujo a mediado por email.

## Deployment considerations

**Este change requiere planificación de despliegue (`/plan-deployment`)** —
dispara cinco de los criterios a la vez:

1. **Migración de esquema**: tres tablas nuevas. `prisma migrate deploy` **antes**
   de arrancar la versión nueva del API. Aditiva y hacia-atrás compatible ⇒ rolling
   deploy válido; rollback = redeploy del commit anterior (las tablas quedan
   huérfanas, inertes).
2. **Variables de entorno nuevas** (todas validadas por Zod al arranque, §7, con
   default seguro salvo donde se indica):
   `AUTH_ACCESS_TTL_MIN` (15), `AUTH_REFRESH_TTL_DAYS` (30, OQ-BE-4),
   `AUTH_COOKIE_SECURE` (`true`; **`false` sólo en local**),
   `AUTH_LOGIN_MAX_FAILURES` (5), `AUTH_LOCKOUT_BASE_MIN` (15),
   `AUTH_LOCKOUT_MAX_MIN` (60), `PASSWORD_RESET_TTL_MIN` (60),
   `PASSWORD_RESET_MAX_PER_HOUR` (3), `BCRYPT_COST` (12).
   `JWT_SECRET` ya existe y **pasa a proteger sesiones de personas**: su rotación
   deja de ser inocua (invalida todas las sesiones **y** todos los tokens CSRF) ⇒
   actualizar la fila "Rotar secretos" del runbook E2E §18.5.
3. **Dependencias nuevas**: `bcrypt` (módulo nativo — verificar que el build de
   Railway compile; alternativa `bcryptjs` si el toolchain no lo permite, a costa
   de ~3× de latencia) y `cookie-parser` (+ `@types/cookie-parser`).
4. **Cambio en el borde HTTP compartido**: `configureApp` suma `cookie-parser` y
   `X-CSRF-Token` a `allowedHeaders` de CORS. Toca el bootstrap que usan **todas**
   las superficies ⇒ la suite completa (US-001/002/003) debe correr verde.
5. **Superficie pública nueva** (7 rutas sin auth previa) ⇒ el WAF/edge de
   Cloudflare debe conocerlas; conviene una regla de rate-limit de borde sobre
   `/v1/auth/*` como defensa en profundidad, coordinada con US-019.

Coordinación con **FE-US-014**: contrato de cookies (nombres y atributos), header
`X-CSRF-Token` obligatorio en escrituras autenticadas, y `credentials: 'include'`
en el cliente HTTP. API y FE deben ir en el mismo release.

**Dependencia de US-011 — bloqueo funcional parcial declarado** (OQ-BE-1): mientras
US-011 no aterrice, el flujo de recuperación de contraseña **no es alcanzable por el
usuario final en producción** (el adapter de log no envía email y no expone el token
fuera de desarrollo). Debe figurar en las notas de release; si US-014 se despliega
antes que US-011, coordinar con `FE-US-014` ocultar o deshabilitar la entrada al
flujo. Ver el recuadro `Deferred` de §Puerto de email.

## ADR triggers

- **ADR-0011 (nuevo, obligatorio)** — almacén server-side de refresh tokens con
  rotación, detección de reuso y revocación; **enmienda** la nota `Neutral` de
  ADR-0005 que descartaba el almacén server-side. Materializado por T0.1
  (`/write-adr`). Sin este ADR el change queda inconsistente con una decisión
  `Accepted`.
- **ADR-0009** — no se modifica: su criterio de validación ("US-014 aterriza sin
  modificar `AdminGuard`") se cumple; el 2FA admin que menciona queda
  explícitamente diferido y anotado en su seguimiento.
- **ADR-0005 / ADR-0010** — se honran sin cambio (auth propia JWT + bcrypt;
  namespace público en la raíz).

## Delta de contrato (para `/archive-change`)

Este change abre una **capacidad nueva**: `openspec/specs/cuentas/`
(`README.md`, `requirements.md`, `decisions.md`, `contracts/openapi.yaml` raíz +
`contracts/openapi/paths/*.yaml`), hermana de `catalogo/`. La única excepción es
`admin-auth-login.yaml`, que **ya vive** en `openspec/specs/catalogo/contracts/openapi/paths/`
y se **modifica** allí (la Fase 8 amplía su `requestBody`), no se muda.

**Recordatorio de convención** (ya causó un `Verify` roto en este repo): en
`apps/api/docs/api/openapi.yaml` el `/v1` vive en `servers`, así que los paths se
declaran **sin** el prefijo — `/auth/login`, no `/v1/auth/login`.

## Open questions

**Ninguna abierta.** Las seis están resueltas y documentadas en `proposal.md`
§Open questions:

| Id | Decisión | Fecha |
|---|---|---|
| OQ-BE-1 | Puerto + adapter de log; Resend en US-011 (`Deferred` acotado arriba) | 2026-08-17 (PO) |
| OQ-BE-2 | Se levanta ADR-0011 como **enmienda** a ADR-0005 (T0.1, bloquea la implementación) | 2026-08-17 (Arquitecto) |
| OQ-BE-3 | La Fase 8 **entra**: login admin por credenciales conservando ruta, Bearer y `{ token }` | 2026-08-17 (PO) |
| OQ-BE-4 | Refresh de **30 días** vía `AUTH_REFRESH_TTL_DAYS` | 2026-08-17 (PO) |
| OQ-BE-5 | `409` genérico en registro duplicado (AC-1 impide la indistinguibilidad total) | decisión de ingeniería |
| OQ-BE-6 | Sin prefijos `__Host-`/`__Secure-`; nombres fijos + `Secure` por config | decisión de ingeniería |

## References

- US: `docs/user-stories/US-014-registro-login.md` (AC-1…AC-11, §9, §10).
- E2E: `docs/product/design-e2e.md` §6.1, §8 (DER `CUSTOMERS`), §14 (STRIDE),
  §17 (NFRs), §18 / §18.5 (observabilidad y runbook), §20 (ADRs).
- PRD: `docs/product/prd.md` §6 (PII y retención), §7 (roles).
- Standards: `backend-node-standards §2/§3/§4/§5/§6/§7/§8/§9/§10/§11`,
  `security-standards §3.1/§3.2/§3.3/§3.7/§3.8/§5/§6/§7.1/§7.2/§7.3/§7.4/§7.5/§8.5`,
  `api-standards §2/§8/§12`, `observability-standards §9`,
  `qa-backend-standards §2.1`, `testing-standards §14`.
- Skills: `openspec-workflow`, `threat-modeling-lite`, `data-architecture-patterns`,
  `api-contract-completeness`, `observability-patterns`, `nfr-quantification`.
- ADRs: `0005-own-jwt-authentication.md`, `0009-admin-auth-seam-us001.md`,
  `0010-url-namespace-storefront-vs-admin.md`; **ADR-0011 pendiente** (T0.1).
- Código AS-BUILT reconciliado: `apps/api/src/auth/*`, `apps/api/src/bootstrap.ts`,
  `apps/api/src/config/env.validation.ts`,
  `apps/api/src/common/errors/domain-errors.ts`,
  `apps/api/src/common/filters/http-problem.filter.ts`,
  `packages/db/prisma/schema.prisma`,
  `packages/db/prisma/migrations/20260816120000_add_product_slug/migration.sql`.
