---
parent-us: US-014
discipline: backend
variant: null
language: es
---

# US-014 Backend — Tasks

> Cada task es closure-grade: atómica, con `Exit criterion:` observable y `Verify:`
> con el comando exacto que `/develop-backend` corre. Los comandos asumen la **raíz
> del repo** como cwd. El runner es el de US-001: `pnpm --filter @dsm/api test -- …`
> ejecuta Jest en su forma terminante (no watch — F49); el config de unit
> (`jest.config.js`, `testRegex: src/.*\.spec\.ts$`) incluye también los specs
> `e2e-*` colocados en `src/`. Integration/e2e corren contra el Postgres real de
> `docker-compose` (:55432), que debe estar arriba.
>
> **Estimación dual**: **7,5 h AI-asistido** / **15 h tradicional** (coherente con
> `BE-US-014 12-16h` de la US §7 y con `story_points_ai_assisted: 4`; ~0,5× per
> Peng 2023). El peso está en la superficie de seguridad, no en el CRUD.

## Pre-requisitos

- [x] **US-001 backend archivado** (AS-BUILT verificado al planificar): `apps/api`
  corre con `HttpProblemFilter` (RFC 7807 `dsm:catalog/*`), `ValidationPipe`
  global con `whitelist`+`forbidNonWhitelisted` (422), helmet §7.1, allowlist CORS
  §7.2, throttler nombrado `auth` + `AuthThrottlerGuard`, y el seam admin
  (`AdminGuard`, `AdminAuthService`, `AdminAuthController`).
  **Verify**: `pnpm --filter @dsm/api typecheck && pnpm --filter @dsm/api test -- --testPathPattern=e2e-admin-auth`
- [x] **Postgres local arriba** (integration/e2e): `docker compose up -d db`.
- [x] **Open questions cerradas** (2026-08-17): OQ-BE-1 = puerto + adapter de log
  (Resend en US-011) · OQ-BE-2 = se levanta ADR-0011 como enmienda a ADR-0005
  (T0.1) · OQ-BE-3 = la Fase 8 entra en el alcance · OQ-BE-4 = refresh de 30 días.
  No queda ninguna decisión pendiente: el plan se ejecuta completo y en orden.

---

## Fase 0: ADR, esquema y configuración — 1,0 h

- [x] T0.1 ADR-0011 — almacén server-side de refresh tokens (enmienda a ADR-0005)
  - **Exit criterion**: existe `docs/architecture/decisions/0011-*.md` con
    `Status: Accepted`, que declara la tabla `refresh_tokens` con rotación,
    detección de reuso y revocación, y **enmienda explícitamente** la nota
    `Neutral` de ADR-0005 ("invalidación vía TTL corto + rotación en vez de un
    almacén server-side"), citando AC-3 y `security-standards §3.3` como fuerza
    motriz. ADR-0005 queda `Accepted` (enmendado, no superseded) con su sección
    `Related` actualizada. La entrada correspondiente existe en
    `docs/_index/decisions.yaml`.
  - **Verify**: `grep -q '^> \*\*Status\*\*: Accepted' docs/architecture/decisions/0011-*.md && grep -qi 'refresh' docs/architecture/decisions/0011-*.md && grep -q '0011' docs/architecture/decisions/0005-own-jwt-authentication.md && grep -q 'ADR-0011' docs/_index/decisions.yaml`

- [x] T0.2 Migración aditiva `customers` + `refresh_tokens` + `password_reset_tokens`
  - **Pattern**: en `packages/db/prisma/schema.prisma`, tres `model` nuevos con
    `@id @default(dbgenerated("gen_random_uuid()")) @db.Uuid` y `@@map("…")`,
    espejando `Category`/`Product`; FKs con `onDelete: Cascade`; migración generada
    con `pnpm --filter @dsm/db migrate` — `per backend-node-standards.md §5 —
    migraciones expand-and-contract, nunca destructivas`. **Un solo paso** (no el
    patrón de tres de `20260816120000_add_product_slug`): las tablas nacen vacías,
    así que `NOT NULL` + `UNIQUE` se declaran de entrada.
  - **Exit criterion**: el esquema materializado tiene **exactamente** las columnas
    de `design.md` §Persistencia — `customers`: `id`, `email`, `password_hash`,
    `name`, `phone`, `role`, `failed_login_attempts`, `lockout_count`,
    `locked_until`, `password_changed_at`, `last_login_at`, `deleted_at`,
    `created_at`, `updated_at` (14); `refresh_tokens`: `id`, `customer_id`,
    `token_hash`, `family_id`, `expires_at`, `rotated_at`, `revoked_at`,
    `created_at` (8); `password_reset_tokens`: `id`, `customer_id`, `token_hash`,
    `expires_at`, `used_at`, `created_at` (6). Índices únicos en `customers.email`,
    `refresh_tokens.token_hash` y `password_reset_tokens.token_hash`; índices en
    `refresh_tokens(customer_id)`, `(family_id)`, `(expires_at)` y en
    `password_reset_tokens(customer_id, created_at)`, `(expires_at)`. Las dos FKs
    borran en cascada. **Ninguna** tabla existente se modifica.
  - **Verify**: `pnpm --filter @dsm/db migrate:deploy && pnpm --filter @dsm/api test -- --testPathPattern=auth-schema`
    (nuevo `src/auth/auth-schema.spec.ts`: consulta `information_schema.columns`,
    `information_schema.table_constraints` y `pg_indexes` y compara el conjunto
    **completo** de columnas/índices por tabla contra la lista literal de arriba —
    falla si sobra o falta una sola columna, F40; además verifica el borrado en
    cascada insertando y borrando un `customer`)

- [x] T0.3 Variables de entorno de auth validadas por Zod
  - **Pattern**: extender `envSchema` en `apps/api/src/config/env.validation.ts`
    con `z.coerce.number().int().positive().default(…)` / `z.enum(['true','false'])`
    — `per backend-node-standards.md §7 — config validada al arranque, fail-fast`.
  - **Exit criterion**: `env.validation.ts` declara con default seguro
    `AUTH_ACCESS_TTL_MIN` (15), `AUTH_REFRESH_TTL_DAYS` (30),
    `AUTH_COOKIE_SECURE` (`'true'`), `AUTH_LOGIN_MAX_FAILURES` (5),
    `AUTH_LOCKOUT_BASE_MIN` (15), `AUTH_LOCKOUT_MAX_MIN` (60),
    `PASSWORD_RESET_TTL_MIN` (60), `PASSWORD_RESET_MAX_PER_HOUR` (3) y
    `BCRYPT_COST` (12); un valor inválido (p. ej. `BCRYPT_COST=abc` o
    `AUTH_ACCESS_TTL_MIN=-1`) hace **fallar el arranque** con el mensaje de
    fail-fast, no cae al default en silencio.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=env.validation`
    (casos nuevos: sin las variables → defaults exactos; `BCRYPT_COST=abc` →
    `validateEnv` lanza; `AUTH_ACCESS_TTL_MIN=-1` → lanza)

---

## Fase 1: Primitivas de credenciales — 0,7 h

- [x] T1.1 `PasswordHasher` — bcrypt cost 12 + hash señuelo
  - **Pattern**: `await bcrypt.hash(plain, cost)` / `await bcrypt.compare(plain, hash)`;
    señuelo `DUMMY_HASH = await bcrypt.hash(randomBytes(32).toString('hex'), cost)`
    calculado una vez al arranque — `per security-standards.md §3.1 — bcrypt cost ≥ 12,
    salt por contraseña de la librería, verificación en tiempo constante por la
    librería (nunca ===)`.
  - **Exit criterion**: `apps/api/src/auth/password/password-hasher.ts` expone
    `hash(plain)`, `verify(plain, hash)` y `verifyDummy(plain)`; el hash resultante
    empieza con `$2b$12$` (cost del env), dos hashes de la **misma** contraseña son
    **distintos** (salt por contraseña), `verify` es `true` sólo con la contraseña
    correcta, y `verifyDummy` **siempre** devuelve `false` consumiendo un
    `bcrypt.compare` real. La contraseña en claro no se guarda en ningún campo del
    objeto.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=password-hasher`
    (unit: prefijo `$2b$12$`; dos hashes distintos para la misma entrada;
    `verify` true/false; `verifyDummy` false y con duración del mismo orden que un
    `verify` fallido real — se compara `Math.abs(t1-t2) < t1` para evitar
    flakiness de reloj)

- [x] T1.2 Política de contraseña (§3.2) + corpus offline de filtradas
  - **Pattern**: función pura `validatePassword(plain): string[]` (lista de
    violaciones) + `Set<string>` cargado una vez desde
    `apps/api/src/auth/password/breached-passwords.txt` — `per
    security-standards.md §3.2 — mínimo 8, máximo ≥ 64, sin reglas de composición,
    rechazo contra corpus de filtradas (lista offline admitida)`.
  - **Exit criterion**: rechaza contraseñas de < 8 caracteres, de > 72 **bytes**
    (límite de bcrypt — se rechaza, **no** se trunca, §3.1) y las presentes en el
    corpus (≥ 10 000 entradas, fuente pública citada en la cabecera del archivo);
    **acepta** contraseñas con espacios, símbolos y Unicode sin exigir mayúscula ni
    dígito ni símbolo (sin reglas de composición); `password` y `123456789` son
    rechazadas por corpus.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=password-policy`
    (unit: `'aB3!'` → rechazada por longitud; `'a'.repeat(73)` → rechazada por
    bytes; `'ñ'.repeat(40)` (80 bytes) → rechazada por bytes; `'password'` y
    `'123456789'` → rechazadas por corpus; `'correo caballo batería grapa'` →
    **aceptada**; el archivo del corpus tiene ≥ 10 000 líneas)

- [x] T1.3 Normalización de email
  - **Pattern**: `email.trim().normalize('NFKC').toLowerCase()` en una función pura
    reusada por repositorio y DTO — `per security-standards.md §6 — normalizar
    antes de comparar; la normalización vive en un solo lugar`.
  - **Exit criterion**: `normalizeEmail` existe y es idempotente;
    `'  Ana.Perez@Example.COM '` y `'ana.perez@example.com'` producen **el mismo**
    valor; no elimina puntos ni sufijos `+tag` (eso cambiaría la identidad del
    buzón); la normalización es la única forma en que un email llega a la base.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=customers.repository`
    (integration: insertar `'  Ana.Perez@Example.COM '` y luego buscar por
    `'ana.perez@example.com'` devuelve la fila; un segundo insert con la variante
    en mayúsculas viola el UNIQUE)
  - **Nota de ejecución (2026-08-19)**: el `Verify:` de esta task apunta a un
    archivo que crea **T2.1**, así que T1.3 no puede cerrarse antes que T2.1 pese
    a estar antes en el plan. El código y su unit test (`normalize-email.spec.ts`)
    se entregaron acá; la task se marca al correr el spec del repositorio. Es una
    inversión de orden del plan, no un bloqueo — anotada por si se repite.

- [x] T1.4 Tokens opacos: generación CSPRNG + hash de reposo
  - **Pattern**: `randomBytes(32).toString('base64url')` para el claro y
    `createHash('sha256').update(raw).digest('hex')` para el reposo — `per
    security-standards.md §3.7 — token de un solo uso ≥ 128 bits de un CSPRNG,
    almacenado hasheado`.
  - **Exit criterion**: `apps/api/src/auth/tokens/opaque-token.ts` expone
    `newToken()` (≥ 256 bits de entropía, base64url, sin padding) y
    `hashToken(raw)` (determinista, 64 hex chars); dos llamadas a `newToken()`
    nunca coinciden; `hashToken` del mismo claro siempre coincide y del claro
    distinto no; el claro **nunca** se persiste (sólo se devuelve al llamador).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=opaque-token`
    (unit: 1 000 tokens sin colisiones; longitud ≥ 43 chars; `hashToken`
    determinista y de 64 hex; `hashToken(a) !== hashToken(b)`)

---

## Fase 2: Repositorios (único punto de ORM) — 0,6 h

- [x] T2.1 `CustomersRepository`
  - **Pattern**: clase `@Injectable()` que envuelve `PrismaService`; ningún service
    toca el cliente Prisma — `per backend-node-standards.md §5 — el repositorio
    envuelve el ORM; los services no lo llaman directo`.
  - **Exit criterion**: expone `create({email,name,phone,passwordHash})`,
    `findActiveByEmail(email)` (normaliza y filtra `deleted_at IS NULL`),
    `findActiveById(id)`, `registerFailedLogin(id)`, `resetLoginFailures(id)`,
    `updatePassword(id, hash)`. `create` traduce la violación de UNIQUE de Prisma
    (`P2002`) al error de dominio `RegistrationFailedError` (nunca escapa un error
    crudo de Prisma, §6). Ningún método devuelve `password_hash` fuera del uso de
    verificación.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=customers.repository`
    (integration contra Postgres real: alta OK; alta duplicada → `RegistrationFailedError`
    y **no** un error de Prisma; `findActiveByEmail` case-insensitive;
    un `customer` con `deleted_at` seteado a mano **no** lo devuelve)

- [x] T2.2 `RefreshTokensRepository`
  - **Exit criterion**: expone `issue({customerId, tokenHash, familyId, expiresAt})`,
    `findByHash(hash)`, `markRotated(id)`, `revokeFamily(familyId)`,
    `revokeAllForCustomer(customerId)` y `purgeExpiredForCustomer(customerId)`.
    `revokeFamily` marca `revoked_at` en **todas** las filas de la familia en una
    sola sentencia; `purgeExpiredForCustomer` borra sólo filas con
    `expires_at < now()` de **ese** cliente (nunca barre la tabla entera).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=refresh-tokens.repository`
    (integration: emitir 3 tokens de la misma familia + 1 de otra → `revokeFamily`
    marca exactamente 3 y deja la otra intacta; `purgeExpiredForCustomer` borra
    sólo el vencido de ese cliente y no toca el vencido de otro)

- [x] T2.3 `PasswordResetTokensRepository`
  - **Exit criterion**: expone `issue({customerId, tokenHash, expiresAt})`,
    `findUsableByHash(hash)` (devuelve `null` si `used_at IS NOT NULL` **o**
    `expires_at <= now()`), `markUsed(id)`, `countIssuedSince(customerId, since)` y
    `deleteAllForCustomer(customerId)`. Ninguna consulta acepta el token en claro.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=password-reset-tokens.repository`
    (integration: token fresco → se encuentra; el mismo tras `markUsed` → `null`;
    uno con `expires_at` en el pasado → `null`; `countIssuedSince` cuenta sólo los
    de la última hora del cliente correcto)

---

## Fase 3: Servicios de caso de uso — 1,0 h

- [x] T3.1 `CustomerAuthService.register` (AC-1, AC-6)
  - **Pattern**: validar política → normalizar email → hashear → `create` →
    emitir sesión, todo dentro de `prisma.$transaction` cuando hay más de una
    escritura — `per backend-node-standards.md §5 — transacción para casos de uso
    multi-escritura, sin escrituras parciales ante fallo`.
  - **Exit criterion**: crea la cuenta con `role='customer'` **fijado server-side**
    (el DTO no acepta `role`, ni siquiera para ignorarlo) y devuelve una sesión
    activa en la **misma** operación (AC-1); un email ya registrado lanza
    `RegistrationFailedError` (409) **sin** crear fila ni emitir sesión (AC-6); una
    contraseña que viola la política lanza `ValidationError` (422) antes de tocar
    la base.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=customer-auth.service`
    (unit con repos mockeados: alta OK devuelve par de tokens y `role='customer'`;
    un body con `role:'admin'` no altera el valor persistido; duplicado →
    `RegistrationFailedError` y `create` no se llama dos veces; contraseña del
    corpus → `ValidationError` sin llamar al repo)

- [x] T3.2 `CredentialsService` — verificación + lockout (AC-2, AC-5, AC-10)
  - **Pattern**: si el email no existe, ejecutar igual `hasher.verifyDummy(plain)`
    y lanzar **el mismo** `InvalidCredentialsError`; backoff
    `lockMinutes = min(BASE * 2 ** (lockoutCount - 1), MAX)` — `per
    security-standards.md §7.3 — 5 fallos/cuenta/15 min, lockout temporal con
    backoff exponencial (nunca permanente), respuestas y timing indistinguibles`.
  - **Exit criterion**: credenciales correctas → devuelve el `customer` y resetea
    `failed_login_attempts`/`lockout_count`/`locked_until`; contraseña incorrecta,
    email inexistente y cuenta con `locked_until > now()` lanzan **el mismo**
    `InvalidCredentialsError` con el **mismo** `detail`; al quinto fallo se fija
    `locked_until = now + 15 min` y `lockout_count` sube; el segundo ciclo de
    bloqueo da 30 min y el tope no supera los 60 min; ningún camino deja la cuenta
    bloqueada de forma permanente.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=credentials.service`
    (unit con reloj inyectado: los tres casos de fallo producen errores
    `deepEqual` en `type`+`detail`; 4 fallos no bloquean y el 5.º sí;
    backoff 15→30→60→60 min; login OK tras expirar el bloqueo resetea contadores)

- [x] T3.3 `SessionService` — emisión, rotación y detección de reuso (AC-3, AC-9)
  - **Pattern**: `jwt.sign({ sub, role, typ:'access', jti }, { secret, expiresIn, issuer, audience })`
    para el access; refresh **opaco** persistido por hash; en `refresh`, dentro de
    `$transaction`: `markRotated(viejo)` + `issue(nuevo, mismo familyId)`; si el
    token presentado ya tiene `rotated_at` o `revoked_at` → `revokeFamily` +
    `InvalidRefreshError` — `per security-standards.md §3.3 — refresh rotado de un
    solo uso; la detección de reuso es obligatoria y revoca la familia completa`.
  - **Exit criterion**: `issue(customer)` devuelve `{accessToken, refreshToken, jti, familyId}`
    con el access expirando en `AUTH_ACCESS_TTL_MIN` y claims
    `sub`/`role`/`typ='access'`/`jti`/`iss`/`aud`; `rotate(raw)` invalida el token
    presentado y devuelve uno nuevo de la **misma** familia; presentar un token ya
    rotado revoca **todas** las filas de la familia y lanza `InvalidRefreshError`;
    `revokeFamilyOf(raw)` (logout) deja la familia inutilizable; un refresh vencido
    o inexistente lanza el **mismo** `InvalidRefreshError`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=session.service`
    (unit con repos mockeados + integration del ciclo: emitir → rotar → rotar el
    **viejo** ⇒ `InvalidRefreshError` y las 2 filas de la familia con `revoked_at`;
    logout ⇒ el refresh vigente deja de rotar; claims del access verificados con
    `algorithms:['HS256']`, `issuer`, `audience`)

- [x] T3.4 `PasswordResetService` (AC-4, AC-7, AC-11)
  - **Pattern**: `request` responde igual exista o no la cuenta y despacha el mail
    **fuera de banda**; `confirm` corre en `$transaction`: actualizar hash +
    `password_changed_at`, `markUsed`, `deleteAllForCustomer`,
    `revokeAllForCustomer` (refresh) y reset del lockout — `per
    security-standards.md §3.7 — reset ≤ 1 h de un solo uso; completar un reset
    invalida todas las sesiones y familias de refresh de la cuenta`.
  - **Exit criterion**: `request` devuelve `void` (el controller responde 202) tanto
    para email existente como inexistente y **no** lanza; emite token sólo si la
    cuenta existe y no superó `PASSWORD_RESET_MAX_PER_HOUR`; el token persistido es
    el **hash**, nunca el claro; `confirm` con token válido cambia la contraseña,
    marca el token usado, **borra los demás** tokens de la cuenta, **revoca todas**
    las familias de refresh y desbloquea la cuenta; `confirm` con token vencido,
    ya usado o inexistente lanza **el mismo** `InvalidResetTokenError` (AC-7).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=password-reset.service`
    (integration: tras `confirm`, el login con la contraseña vieja falla y con la
    nueva funciona, los refresh previos quedan `revoked_at` no nulo, y el mismo
    token reusado lanza `InvalidResetTokenError` idéntico al de un token inventado;
    el 4.º `request` en una hora no crea fila pero tampoco lanza)

---

## Fase 4: Borde HTTP — cookies, guards, errores — 0,9 h

- [x] T4.1 Errores de dominio `dsm:auth/*`
  - **Pattern**: subclases de la `DomainError` existente con `readonly status` y
    `readonly type` — `per backend-node-standards.md §6 — errores de dominio
    tipados mapeados centralmente, nunca HttpException ad-hoc en services`.
  - **Exit criterion**: `apps/api/src/common/errors/auth-errors.ts` define
    `InvalidCredentialsError` (401 `dsm:auth/invalid-credentials`),
    `UnauthenticatedError` (401 `dsm:auth/unauthenticated`),
    `InvalidRefreshError` (401 `dsm:auth/invalid-refresh`), `CsrfError`
    (403 `dsm:auth/csrf`), `RegistrationFailedError` (409
    `dsm:auth/registration-failed`) e `InvalidResetTokenError` (400
    `dsm:auth/invalid-reset-token`); el `HttpProblemFilter` **existente** las mapea
    al envelope RFC 7807 con ese `type` y el `title` correcto **sin modificar el
    filtro**; ningún `detail` contiene la contraseña, el email ni el token.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=auth-errors`
    (unit sobre `mapErrorToProblem`: las 6 clases producen el `type`/`status`/
    `title` esperados y `detail` no contiene el literal de una credencial de prueba)

- [x] T4.2 `cookie-parser` + módulo de cookies con atributos §7.4
  - **Pattern**: `app.use(cookieParser())` en `configureApp` (un solo punto de
    borde, junto a helmet/CORS) y un helper `setSessionCookies(res, …)` /
    `clearSessionCookies(res)` que centraliza atributos — `per
    security-standards.md §7.4 — cookies de sesión Secure; HttpOnly; SameSite=Lax
    mínimo`.
  - **Exit criterion**: `dsm_access` (`httpOnly`, `sameSite=Lax`, `path=/`,
    `maxAge` = TTL del access), `dsm_refresh` (`httpOnly`, `sameSite=Lax`,
    `path=/v1/auth`, `maxAge` = TTL del refresh) y `dsm_csrf` (**no** `httpOnly`,
    `sameSite=Lax`, `path=/`); `secure` sale de `AUTH_COOKIE_SECURE` y es `true`
    por default; `clearSessionCookies` borra las tres con el **mismo** `path` (si
    no, la del refresh sobrevive). Ningún token de sesión viaja en el cuerpo de
    ninguna respuesta del seam de cliente (AC-9).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=cookies`
    (unit sobre el helper: los tres `Set-Cookie` generados llevan los flags
    exactos; `dsm_refresh` lleva `Path=/v1/auth`; `dsm_csrf` **no** lleva
    `HttpOnly`; con `AUTH_COOKIE_SECURE=false` desaparece `Secure` y con `true`
    aparece; el `clear` emite los tres con `Max-Age=0` y el path original)

- [ ] T4.3 `CustomerGuard` — cookie de access con pin de algoritmo
  - **Pattern**: `jwt.verifyAsync(token, { secret, algorithms: ['HS256'], issuer, audience })`
    y chequeo explícito de `payload.typ === 'access'` y `payload.role === 'customer'`
    — `per security-standards.md §3.3 — pinear el allowlist de algoritmos, rechazar
    'none' y el cambio de alg, validar siempre exp/iss/aud` y `§3.8 — fail closed`.
  - **Exit criterion**: lee el access **de la cookie `dsm_access`** (no del header
    `Authorization`); sin cookie, con firma inválida, con `alg` distinto de HS256,
    con `exp` vencido, con `iss`/`aud` que no coinciden o con `typ !== 'access'`
    lanza `UnauthenticatedError` (401) — **nunca** deja pasar; un token con
    `role='admin'` **no** abre las rutas de cliente y un token de cliente **no**
    abre `/v1/admin/*` (el `AdminGuard` sigue intacto). Cualquier excepción interna
    resulta en rechazo, no en paso.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=customer-guard`
    (unit: los 6 casos de rechazo lanzan `UnauthenticatedError`; un token firmado
    con otro secreto se rechaza; un token `HS256` válido con `typ='refresh'` se
    rechaza; el caso feliz pone `req.customerId`)

- [ ] T4.4 `CsrfGuard` — double-submit firmado + chequeo de `Origin` (§7.5)
  - **Pattern**: `csrf = base64url(hmacSha256(JWT_SECRET, jti))`; el guard
    recalcula desde el `jti` del token presentado y compara con
    `crypto.timingSafeEqual`; además `parseCorsOrigins(process.env.CORS_ALLOWED_ORIGINS)`
    debe contener el `Origin` (fallback `Referer`) — `per security-standards.md
    §7.5 — SameSite es la primera capa, no la única: segunda capa double-submit
    firmado + verificación de Origin; ausencia de Origin en escritura autenticada
    por cookie ⇒ rechazo`.
  - **Exit criterion**: en `POST /v1/auth/logout` y `POST /v1/auth/refresh`, un
    request sin header `X-CSRF-Token`, con un valor que no corresponde al `jti`
    presentado, o con `Origin` fuera de la allowlist (incluido `Origin` ausente)
    devuelve `403 dsm:auth/csrf`; con el valor correcto y `Origin` permitido pasa.
    Las rutas **no autenticadas** (`register`, `login`, `password-reset/*`) **no**
    exigen CSRF. El token CSRF no se puede forjar sin `JWT_SECRET`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=csrf` (unit del
    guard + e2e `src/auth/e2e-auth-csrf.spec.ts`: logout sin header → 403;
    con header de otra sesión → 403; sin `Origin` → 403; con `Origin` no permitido
    → 403; con ambos correctos → 204; `POST /v1/auth/login` sin CSRF → 200)

---

## Fase 5: Controller, DTOs y cableado — 0,7 h

- [ ] T5.1 DTOs de entrada y de respuesta
  - **Pattern**: `class-validator` sobre el DTO de entrada + DTO de respuesta con
    `static from(customer)` — `per backend-node-standards.md §4 — todo input de
    controller es un DTO validado en el borde; DTO de respuesta separado de la
    entidad de persistencia`. El `ValidationPipe` global ya corre con
    `whitelist: true, forbidNonWhitelisted: true` y `errorHttpStatusCode: 422`.
  - **Exit criterion**: `RegisterDto` (`email` `@IsEmail`, `name` 1..120,
    `password` string, `phone` opcional), `LoginDto`, `ResetRequestDto`,
    `ResetConfirmDto` (`token`, `password`); ninguno declara `role`, `id` ni
    `password_hash`, así que enviarlos produce **422** con `errors[]` por el
    `forbidNonWhitelisted`; `CustomerResponseDto.from()` emite **exactamente**
    `{ id, email, name, phone, created_at }` — sin `password_hash`, `role`,
    `failed_login_attempts`, `lockout_count`, `locked_until`, `deleted_at`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-auth-register`
    (e2e: alta con `role:'admin'` en el body → 422 `dsm:catalog/http-422` con
    `errors[]`; alta válida → 201 y `Object.keys(body.customer)` es exactamente el
    conjunto de 5 campos; `JSON.stringify(body)` no contiene `$2b$` ni la
    contraseña enviada)

- [ ] T5.2 `CustomerAuthController` + cableado del módulo
  - **Pattern**: `@Controller('v1/auth')` sin `AdminGuard`; `@UseGuards(AuthThrottlerGuard)`
    + `@SkipThrottle({ storefront: true })` a nivel de clase, espejando
    `AdminAuthController`; los guards de sesión (`CustomerGuard`, `CsrfGuard`) por
    ruta — `per backend-node-standards.md §2 — controller fino: valida, delega,
    mapea; nada de lógica de negocio`.
  - **Exit criterion**: existen y responden las 7 rutas de `design.md` §API —
    `POST /v1/auth/register` (201), `POST /v1/auth/login` (200),
    `POST /v1/auth/refresh` (200), `POST /v1/auth/logout` (204),
    `GET /v1/auth/me` (200), `POST /v1/auth/password-reset/request` (202),
    `POST /v1/auth/password-reset/confirm` (200); `AuthModule` registra el
    controller, los tres repositorios y los cuatro services, y `AppModule` no
    necesita cambios (ya importa `AuthModule`); las rutas admin de US-001 siguen
    respondiendo igual.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-auth-login`
    (e2e: las 7 rutas existen — ninguna devuelve 404 de ruta; login OK → 200 con
    `Set-Cookie` de `dsm_access`+`dsm_refresh`+`dsm_csrf` y **sin** token en el
    cuerpo; `GET /v1/auth/me` con la cookie → 200 con el email; sin cookie → 401
    `dsm:auth/unauthenticated`)

- [ ] T5.3 CORS: header `X-CSRF-Token` en la allowlist
  - **Pattern**: agregar `'X-CSRF-Token'` a `allowedHeaders` en `app.enableCors`
    de `configureApp` — `per security-standards.md §7.2 — permitir sólo los
    métodos y headers que la API realmente usa; nunca * con credenciales`.
  - **Exit criterion**: un preflight `OPTIONS /v1/auth/logout` desde un origen de
    la allowlist con `Access-Control-Request-Headers: x-csrf-token` responde con
    `Access-Control-Allow-Headers` incluyendo `X-CSRF-Token` y
    `Access-Control-Allow-Credentials: true`; un origen **fuera** de la allowlist
    sigue sin recibir `Access-Control-Allow-Origin`; no se introduce `*`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-auth-csrf`
    (e2e: el preflight desde el origen permitido incluye el header y
    `Allow-Credentials: true`; desde `http://evil.example` no aparece
    `Access-Control-Allow-Origin`)

---

## Fase 6: Rate-limit y anti-enumeración — 0,5 h

- [ ] T6.1 Presupuestos por ruta sobre el throttler `auth` (AC-10)
  - **Pattern**: `@Throttle({ auth: { limit: N, ttl: MS } })` por handler sobre el
    throttler **ya registrado** `auth` (no se registra uno nuevo) — `per
    security-standards.md §7.3 — rate-limit obligatorio en login, alta, solicitud
    de reset y refresh` y `api-standards.md §12 — 429 con Retry-After y
    RateLimit-*` (los emite el `AuthThrottlerGuard` existente).
  - **Exit criterion**: los límites por IP son login 10/15 min, register 5/60 min,
    `password-reset/request` 5/60 min, `password-reset/confirm` 10/60 min y
    refresh 60/15 min; al excederlos la respuesta es **429** con `Retry-After`,
    `RateLimit-Limit`, `RateLimit-Remaining: 0` y `RateLimit-Reset`, en envelope
    `application/problem+json`; el array de `ThrottlerModule` **sigue teniendo dos
    throttlers** (`auth`, `storefront`) — no se agrega un tercero; el surface
    público del storefront (US-003) conserva su límite intacto.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-auth-ratelimit`
    (e2e: N logins fallidos dentro del límite → 401; el N+1 → 429 con
    `Retry-After` y cuerpo `problem+json`; un `GET /v1/products/{slug}` en la misma
    corrida sigue respondiendo 200 — el throttler del storefront no se contaminó)

- [ ] T6.2 Indistinguibilidad de respuestas (AC-5, AC-6, AC-11)
  - **Exit criterion**: en `POST /v1/auth/login`, los tres casos —contraseña
    incorrecta, email inexistente y cuenta bloqueada por lockout— devuelven
    respuestas **byte-idénticas** salvo `instance` (mismo `status`, `type`, `title`
    y `detail`) y con latencias del mismo orden; en
    `POST /v1/auth/password-reset/request`, email existente e inexistente devuelven
    **202** con cuerpo idéntico; en `POST /v1/auth/register`, el duplicado devuelve
    `409 dsm:auth/registration-failed` cuyo `detail` no menciona el email ni
    afirma su existencia.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-auth-enumeration`
    (e2e: se comparan los tres cuerpos de login con `delete body.instance` +
    `toEqual`; se mide la latencia de los tres y se asserta que la máxima no supera
    3× la mínima; los dos cuerpos de reset con `toEqual`; el `detail` del 409 no
    contiene el email usado)

---

## Fase 7: Puerto de email de recuperación — 0,3 h

> **OQ-BE-1 REABIERTA Y RESUELTA DE NUEVO (2026-08-19, decisión del PO)**: se
> **adelanta el adapter Resend a US-014**. La resolución previa (puerto + adapter
> de log, Resend en US-011) dejaba AC-4 inalcanzable en producción durante varios
> ciclos: US-011 depende de US-003, 007, 008, 009, 010 y 012 — el loop de compra
> entero. Cerrar US-014 con un flujo de recuperación que ningún cliente puede usar
> no era aceptable.
>
> **Consecuencias**: (a) hace falta una API key de Resend, que pasa a ser
> pre-requisito de esta fase; (b) el alcance de **US-011 se reduce** — ya no
> enchufa el adapter, sólo consume el puerto para sus propias notificaciones;
> conviene anotarlo en US-011 antes de planificarla; (c) el puerto sigue siendo el
> diseño correcto y no cambia: lo que cambia es que ahora hay **dos** adapters.

- [x] T7.1 `PasswordResetMailer` (puerto) + `LoggingPasswordResetMailer` (adapter)
  - **Pattern**: interfaz + token de inyección (`provide: PASSWORD_RESET_MAILER`),
    inyectada por el service — `per backend-node-standards.md §3 — depender de
    interfaces/tokens, no de clases concretas, donde ayuda a sustituir/testear`.
  - **Exit criterion**: `PasswordResetService` depende del **puerto**, no de un
    adapter concreto; el adapter de log registra el despacho con `customer_id`
    (pseudónimo) y **nunca** el email ni el token; con `NODE_ENV !== 'production'`
    además escribe el token en claro para poder ejercer AC-4 en local/tests, y con
    `NODE_ENV === 'production'` **no** lo escribe; un fallo del mailer **no**
    cambia la respuesta 202 ni propaga excepción al cliente (se loguea).
    ~~`Deferred: adapter Resend — US-011` queda anotado en el código y en el
    README.~~ **Anulado por la decisión del PO del 2026-08-19**: el adapter Resend
    entra en T7.2, así que no hay diferimiento que anotar. El de log pasa a ser el
    adapter de **desarrollo y test**, no el de producción.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=password-reset.service`
    (los casos del mailer: con `NODE_ENV='production'` el log capturado **no**
    contiene el token ni el email; con `'test'` sí contiene el token; un mailer que
    lanza no altera el resultado de `request`)

- [x] T7.2 `ResendPasswordResetMailer` (adapter real) + selección por entorno
  - **Pattern**: segundo adapter del mismo puerto, registrado por factory según
    `RESEND_API_KEY` presente/ausente — `per backend-node-standards.md §3 —
    depender del token de inyección, no de la clase concreta`. El service **no se
    toca**: si hay que modificarlo, el puerto estaba mal diseñado.
  - **Exit criterion**: `RESEND_API_KEY` (opcional) y `PASSWORD_RESET_FROM`
    (email remitente) validadas en `envSchema`; con la key presente el provider
    resuelve al adapter Resend, sin key resuelve al de log — así local y tests no
    necesitan credenciales y producción no cae al de log en silencio: si
    `NODE_ENV === 'production'` **y** falta la key, el arranque **falla**
    (fail-fast §7), no degrada. El adapter envía el enlace de reset y **nunca**
    loguea el token ni el email. Un fallo de Resend no altera el 202 ni propaga
    excepción (mismo contrato que el de log, AC-11 anti-enumeración).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=resend-mailer`
    (unit con el cliente de Resend mockeado: con key → se elige Resend y se llama
    una vez con el destinatario y un cuerpo que contiene el enlace; sin key →
    se elige el de log; `NODE_ENV=production` sin key → `validateEnv` lanza; el
    cliente que rechaza no propaga y no cambia el resultado de `request`)

---

## Fase 8: Endurecimiento del seam admin (ADR-0009) — 0,6 h

> **OQ-BE-3 resuelta (2026-08-17)**: la fase **entra en el alcance**. El admin gana
> login por credenciales conservando su ruta, su transporte `Authorization: Bearer`
> y su respuesta `{ token }` — aditivo, con churn cero en FE-US-001. Cierra el
> criterio de validación de ADR-0009.

- [ ] T8.1 Login admin por credenciales, preservando el contrato `role=admin`
  - **Pattern**: `AdminLoginDto` pasa a aceptar `{ bootstrapToken }` **o**
    `{ email, password }` (validación condicional), y `AdminAuthService` delega en
    `CredentialsService` cuando llegan credenciales — `per ADR-0009 — US-014
    reemplaza sólo el lado de emisión preservando el contrato role=admin; el guard
    no se reescribe`.
  - **Exit criterion**: `POST /v1/admin/auth/login` con `{email,password}` de una
    fila `role='admin'` devuelve `200 { token }` (**mismo shape** que antes) con
    `role=admin` en los claims y además setea las cookies de sesión; con
    credenciales de un `role='customer'` devuelve el **mismo**
    `401 dsm:auth/invalid-credentials` que una contraseña incorrecta (no revela que
    la cuenta existe pero no es admin); el camino `{bootstrapToken}` sigue
    funcionando **sin cambios** detrás de `ADMIN_AUTH_ENABLED`; `AdminGuard` y sus
    consumidores `/v1/admin/*` **no se modifican** (diff vacío en `admin.guard.ts`);
    el login admin queda bajo el mismo lockout y throttler `auth`.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-auth-admin-credentials`
    (e2e: login por credenciales admin → 200 con `token` que abre
    `GET /v1/admin/categories`; credenciales de cliente → 401 idéntico al de
    contraseña incorrecta; el bootstrap token sigue devolviendo 200) `&& git diff --exit-code "$(git merge-base HEAD main)" -- apps/api/src/auth/admin.guard.ts`
    (el diff contra la base de la rama prueba que el guard **no** cambió, aunque el
    trabajo ya esté commiteado — un `git diff` a secas daría verde siempre)

- [ ] T8.2 Siembra de la cuenta admin + corte documentado del bootstrap
  - **Exit criterion**: `packages/db/prisma/seed.ts` crea/actualiza la fila
    `role='admin'` a partir de `ADMIN_SEED_EMAIL` + `ADMIN_SEED_PASSWORD`
    (idempotente, **sólo** si ambas están presentes; nunca con contraseña
    hardcodeada en el repo); el `README.md` de `apps/api` documenta el
    procedimiento de corte —sembrar admin → verificar login por credenciales →
    poner `ADMIN_AUTH_ENABLED=false`— y que el bootstrap token queda como camino de
    emergencia. La contraseña sembrada no aparece en ningún log del seed.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-auth-admin-credentials`
    (incluye el caso: correr el seed dos veces deja **una** fila admin y el login
    sigue funcionando; sin las env de siembra el seed no crea admin ni falla)

---

## Fase 9: Observabilidad — 0,3 h

- [ ] T9.1 `AuthEventsService` — 8 eventos sin PII
  - **Pattern**: espejo de `CatalogEventsService` (contador en memoria + log pino
    estructurado) con su propia unión de nombres; `entity_id` = UUID del cliente —
    `per observability-patterns §3.3 — el id va al log, NUNCA como dimensión de
    métrica (cardinalidad)` y `observability-standards §9 — el email es PII y no
    entra en logs, métricas ni traces`.
  - **Exit criterion**: se emiten `auth.registered`, `auth.login_succeeded`,
    `auth.login_failed`, `auth.account_locked`, `auth.logout`,
    `auth.password_reset_requested`, `auth.password_reset_completed` y
    `auth.refresh_reuse_detected` en sus momentos correspondientes;
    `auth.login_failed` de un email inexistente lleva `entity_id: null` (no el
    email, ni siquiera hasheado); **ningún** evento ni log de la superficie de auth
    contiene el email, la contraseña, el hash, el refresh ni el token de reset
    (AC-8); los contadores no llevan dimensión por usuario.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-auth-observability`
    (e2e con el logger pino capturado: registro+login+logout+reset producen los
    contadores esperados; el volcado completo de logs de la corrida **no** contiene
    el email de prueba, la contraseña, `$2b$` ni el refresh token; un login fallido
    de email inexistente emite `entity_id: null`)

---

## Fase 10: Cobertura e2e de los AC — 0,6 h

- [ ] T10.1 e2e de registro y login (AC-1, AC-2, AC-8)
  - **Exit criterion**: alta con email nuevo → 201, fila creada con
    `password_hash` que **no** es la contraseña, y sesión activa inmediata
    (`GET /v1/auth/me` con las cookies de la respuesta → 200) **sin** verificación
    intermedia (AC-1); login posterior con las mismas credenciales → 200 y sesión
    (AC-2); en ninguna respuesta ni en el cuerpo aparece la contraseña ni el hash
    (AC-8).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-auth-register`

- [ ] T10.2 e2e de sesión: logout, refresh, rotación y reuso (AC-3, AC-9)
  - **Exit criterion**: `POST /logout` → 204 y, tras él, el refresh usado ya no
    renueva (401) y `GET /me` con esa cookie de refresh no reabre sesión (AC-3);
    `POST /refresh` devuelve cookies **nuevas** y el refresh anterior deja de
    servir; presentar el refresh **ya rotado** devuelve 401 y **también** invalida
    el refresh vigente de la familia (detección de reuso); las cookies emitidas
    llevan `HttpOnly`, `SameSite=Lax` y `Secure` cuando `AUTH_COOKIE_SECURE=true`,
    y el access **no** viaja en el cuerpo (AC-9).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-auth-session`

- [ ] T10.3 e2e de recuperación de contraseña (AC-4, AC-7, AC-11)
  - **Exit criterion**: `request` → 202; con el token capturado del adapter de log,
    `confirm` fija la contraseña nueva y el login con la vieja falla y con la nueva
    funciona (AC-4); reusar el mismo token → 400 `dsm:auth/invalid-reset-token`, y
    un token vencido (fila con `expires_at` en el pasado) da **el mismo** 400
    (AC-7); `request` de un email inexistente devuelve 202 con cuerpo idéntico
    (AC-11); tras el `confirm`, las sesiones previas del cliente están revocadas.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-auth-password-reset`

---

## Fase 11: Contratos y documentación — 0,3 h

- [ ] T11.1 Siete contratos OpenAPI draft (1 por endpoint) + lint
  - **Pattern**: un yaml autocontenido por endpoint en `contracts/openapi/`
    (`auth-register`, `auth-login`, `auth-refresh`, `auth-logout`, `auth-me`,
    `auth-password-reset-request`, `auth-password-reset-confirm`) con
    `components.schemas` del request/response, `components.responses` RFC 7807 con
    el `type` URI canónico, y los `Set-Cookie` declarados como `headers` —
    `per api-contract-completeness — 1 yaml por endpoint + catálogo de errores
    RFC 7807 cerrado`.
  - **Exit criterion**: los 7 archivos validan como OpenAPI 3.x y coinciden con la
    implementación (rutas, shapes, y catálogo de errores
    `dsm:auth/invalid-credentials`, `dsm:auth/unauthenticated`,
    `dsm:auth/invalid-refresh`, `dsm:auth/csrf`,
    `dsm:auth/registration-failed`, `dsm:auth/invalid-reset-token` + 422 + 429);
    cada uno declara el header `X-CSRF-Token` donde aplica y ninguno declara el
    token de sesión en el cuerpo de la respuesta. Queda anotado que al archivar
    forman la capacidad nueva `openspec/specs/cuentas/`.
    **Decisión del PO (2026-08-19)**: al archivar, `POST /admin/auth/login` **se
    mueve** del contrato vivo de `catalogo` al de `cuentas` — es un endpoint de
    autenticación, no de catálogo, y su hogar natural es la capacidad que lo
    gobierna. `catalogo` queda con una nota apuntando al nuevo hogar; **no** se
    declara en las dos (dos copias driftean). Anotarlo acá porque `/archive-change`
    sincroniza `openspec/specs/` y necesita saberlo.
  - **Verify**: `npx @stoplight/spectral-cli lint openspec/changes/US-014-registro-login-backend/contracts/openapi/*.yaml`

- [ ] T11.2 Spec publicado del servicio + README
  - **Pattern**: en `apps/api/docs/api/openapi.yaml` el `/v1` vive en `servers`, así
    que los paths se declaran **sin** el prefijo (`/auth/login`, no
    `/v1/auth/login`) — `per api-standards.md §5 — el contrato declara todo campo y
    ruta que la API expone`, respetando la convención ya establecida del archivo.
  - **Exit criterion**: el spec publicado incorpora las 7 rutas bajo un tag nuevo
    `customer-auth` con `security: []` donde corresponde (las tres públicas) y el
    esquema de cookie donde no, más el `requestBody` ampliado de
    `/admin/auth/login` (Fase 8); `apps/api/README.md` documenta el surface de
    auth: rutas, atributos de cookie, header `X-CSRF-Token`, límites de rate-limit,
    variables de entorno nuevas y el procedimiento de corte del bootstrap admin.
  - **Verify**: `npx @stoplight/spectral-cli lint apps/api/docs/api/openapi.yaml && grep -q '^  /auth/login:' apps/api/docs/api/openapi.yaml && grep -q '^  /auth/password-reset/request:' apps/api/docs/api/openapi.yaml && grep -q 'X-CSRF-Token' apps/api/README.md`

---

## Verification (suite-level)

- [ ] Unit + integration + e2e colocados pasan: `pnpm --filter @dsm/api test`
- [ ] Suite e2e-nest dedicada pasa: `pnpm --filter @dsm/api test:e2e`
- [ ] Lint + typecheck limpios: `pnpm --filter @dsm/api lint && pnpm --filter @dsm/api typecheck`
- [ ] Esquema materializado == `design.md` §Persistencia (F40):
      `pnpm --filter @dsm/db migrate:deploy && pnpm --filter @dsm/api test -- --testPathPattern=auth-schema`
- [ ] Contratos válidos: `npx @stoplight/spectral-cli lint openspec/changes/US-014-registro-login-backend/contracts/openapi/*.yaml && npx @stoplight/spectral-cli lint apps/api/docs/api/openapi.yaml`
- [ ] **No regresión del seam admin (ADR-0009)**: `git diff --exit-code "$(git merge-base HEAD main)" -- apps/api/src/auth/admin.guard.ts && pnpm --filter @dsm/api test -- --testPathPattern='e2e-rbac|e2e-admin-auth'`
- [ ] **Ninguna credencial escapa por respuesta ni por log (AC-8)**: `pnpm --filter @dsm/api test -- --testPathPattern='e2e-auth-observability|e2e-auth-register'` (los dos specs barren el cuerpo de las respuestas y el volcado completo de logs de la corrida buscando la contraseña, el prefijo de hash, el email y los tokens — fallan si aparece cualquiera)
- [ ] CI del monorepo verde: `pnpm -r lint && pnpm -r typecheck && pnpm -r test`

---

## Trazabilidad AC → tasks

| AC | Tasks | Estado |
|---|---|---|
| AC-1 (registro con login inmediato) | T0.2, T1.1, T1.2, T2.1, T3.1, T3.3, T5.1, T5.2, T10.1 | en este change |
| AC-2 (login con credenciales válidas) | T3.2, T3.3, T4.3, T5.2, T10.1 | en este change |
| AC-3 (logout invalida la sesión) | T0.2, T2.2, T3.3, T5.2, T10.2 | en este change — ventana residual del access ≤ 15 min, declarada |
| AC-4 (recuperación de contraseña) | T1.4, T2.3, T3.4, T7.1, T7.2, T10.3 | **completo en este change** desde la decisión del PO del 2026-08-19: backend (emisión, hash, expiración, uso único, revocación de sesiones) **y entrega real del email** (adapter Resend, T7.2). La resolución previa lo dejaba parcial con el envío `Deferred: US-011`; queda anulada |
| AC-5 (login inválido genérico) | T3.2, T4.1, T6.2 | en este change |
| AC-6 (registro con email existente) | T2.1, T3.1, T6.2 | en este change — límite documentado (OQ-BE-5) |
| AC-7 (token de reset expirado o usado) | T2.3, T3.4, T10.3 | en este change |
| AC-8 (la contraseña nunca se expone) | T1.1, T5.1, T9.1, T10.1 | en este change |
| AC-9 (sesión segura por cookie) | T3.3, T4.2, T4.3, T10.2 | en este change |
| AC-10 (límite de intentos) | T3.2, T6.1 | en este change — throttler `auth` reusado + lockout por cuenta |
| AC-11 (reset de email inexistente) | T3.4, T6.2, T10.3 | en este change |

### Declaraciones de `design.md` que **no** son AC (F51)

| Declaración | Task | Estado |
|---|---|---|
| ADR-0011 (almacén server-side de refresh — enmienda a ADR-0005) | T0.1 | en este change — ratificado (OQ-BE-2); **bloquea la implementación**: T0.1 va primero |
| Migración: 3 tablas, 28 columnas, 8 índices, 2 FKs en cascada (§Persistencia, F40) | T0.2 | en este change |
| 9 variables de entorno validadas por Zod al arranque (§7) | T0.3 | en este change |
| Corpus offline de contraseñas filtradas (§3.2) | T1.2 | en este change |
| Normalización de email en app (estrategia de unicidad, §Persistencia) | T1.3 | en este change |
| Tokens opacos hasheados en reposo (SHA-256, §3.7) | T1.4, T2.2, T2.3 | en este change |
| Detección de reuso de refresh ⇒ revocación de familia (§3.3) | T3.3, T10.2 | en este change |
| Reset completado invalida **todas** las sesiones (§3.7) | T3.4, T10.3 | en este change |
| Errores de dominio `dsm:auth/*` mapeados por el filtro existente (§6) | T4.1 | en este change |
| Atributos de cookie `httpOnly`/`Secure`/`SameSite`/`path` (§7.4) | T4.2 | en este change |
| Pin de algoritmo + validación `exp`/`iss`/`aud`/`typ`; fail closed (§3.3, §3.8) | T4.3 | en este change |
| CSRF double-submit firmado + chequeo de `Origin` (§7.5) | T4.4, T5.3 | en este change |
| `X-CSRF-Token` en la allowlist de CORS (§7.2) | T5.3 | en este change |
| Presupuestos de rate-limit por ruta sobre el throttler `auth` (§7.3) | T6.1 | en este change |
| Puerto `PasswordResetMailer` + **dos** adapters (log para dev/test, Resend para producción) | T7.1, T7.2 | en este change — el diferimiento a US-011 quedó anulado por la decisión del PO del 2026-08-19 |
| Endurecimiento del seam admin sin tocar `AdminGuard` (ADR-0009) | T8.1, T8.2 | en este change — alcance ratificado por el PO (OQ-BE-3) |
| 8 eventos de auth sin PII, sin cardinalidad por usuario (E2E §18) | T9.1 | en este change |
| Contratos: 7 yaml + spec publicado + README (capacidad `cuentas`) | T11.1, T11.2 | en este change |
| Columna `deleted_at` creada pero **sin endpoint que la escriba** | T0.2 (creación), T2.1 (el login la filtra) | `Deferred: US futura de gestión de datos — owner: PO` |
| 2FA (cliente y admin) | — | `Deferred: follow-up de ADR-0009 — owner: Arquitecto` |
| Purga programada de tokens vencidos (job BullMQ) | T2.2 (limpieza oportunista acotada) | `Deferred: US-011 / operaciones — owner: Arquitecto` (Redis no provisionado, ADR-0004) |
| Regla de rate-limit de borde sobre `/v1/auth/*` en Cloudflare | — | `Deferred: US-019 (infraestructura) — owner: Arquitecto` (defensa en profundidad, no reemplaza T6.1) |
