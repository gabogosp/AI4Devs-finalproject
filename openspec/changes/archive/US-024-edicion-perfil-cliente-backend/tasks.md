---
tracker-id: null
tracker-source: null
parent-us: US-024
discipline: backend
variant: null
language: es
---

# US-024 Backend — Tasks

- [x] **T1 — Migración: `customers.avatar_url`**
  Agregar `avatar_url String? @db.VarChar(2048)` al modelo `Customer` en
  `packages/db/prisma/schema.prisma` (comentario breve, sin default). Generar
  la migración con `pnpm --filter @dsm/db exec prisma migrate dev --name
  add_customer_avatar_url --create-only`, revisar el SQL generado (debe ser
  un único `ALTER TABLE ... ADD COLUMN` aditivo, sin `NOT NULL`), luego
  aplicarla.
  Exit criterion: la migración existe en
  `packages/db/prisma/migrations/`, el SQL es aditivo (ADD COLUMN nullable,
  sin default), y `prisma migrate deploy` corre limpio contra una base
  descartable.
  Verify: `pnpm --filter @dsm/db exec prisma migrate deploy` contra un
  Postgres descartable (`pgvector/pgvector:pg16`) sale con exit 0 y
  `\d customers` muestra la columna `avatar_url` como `character varying(2048)`
  nullable.

- [x] **T2 — Nuevo throttler nombrado `account_profile_update`**
  Agregar la entrada al array de `ThrottlerModule.forRootAsync` en
  `apps/api/src/auth/auth.module.ts` (mismo patrón que `account_deletion`:
  techo global `Number.MAX_SAFE_INTEGER`, ttl desde
  `ACCOUNT_PROFILE_UPDATE_RATE_LIMIT_TTL_MS` default 60_000). Agregar
  `ACCOUNT_PROFILE_UPDATE_RATE_LIMIT_MAX` (default 20) y
  `ACCOUNT_PROFILE_UPDATE_RATE_LIMIT_TTL_MS` (default 60_000) a
  `apps/api/src/config/env.validation.ts` (mismo bloque que las
  `ACCOUNT_DELETION_RATE_LIMIT_*`). No se agrega a `.env.example`: verificado
  que ese archivo sólo documenta valores que requieren un real en prod
  (secretos/URLs) — ningún otro `*_RATE_LIMIT_*` con default seguro está ahí,
  tampoco `ACCOUNT_DELETION_RATE_LIMIT_*` (mismo criterio, no un descuido).
  Pattern: `apps/api/src/account/account.controller.ts` líneas ~15-20
  (constante `ACCOUNT_DELETION_RATE_LIMIT_MAX` leída de `process.env`
  directamente porque el decorador se evalúa antes del contenedor).
  Exit criterion: el nuevo nombre existe en el array de throttlers, las dos
  env vars están validadas por Zod con default.
  Verify: `pnpm --filter @dsm/api typecheck` (el array tipado de
  Nest Throttler no acepta una entrada mal formada sin fallar el build) +
  `grep -c ACCOUNT_PROFILE_UPDATE_RATE_LIMIT apps/api/src/config/env.validation.ts`
  devuelve `2`.

- [x] **T3 — `UpdateProfileDto`**
  Crear `apps/api/src/account/dto/update-profile.dto.ts`: `name` (`@Transform`
  trim + `@IsString()` + `@Length(1, 120)`), `avatar_url` (`string | null`,
  `@ValidateIf((o) => o.avatar_url !== null)` + `@IsUrl({ protocols:
  ['http','https'], require_protocol: true })` + `@MaxLength(2048)`).
  Pattern: `apps/api/src/auth/dto/customer-auth.dto.ts` (`RegisterDto.name`
  para el `@Length`; el header del archivo explica por qué NO se copia el
  patrón laxo de `image_url` — ver `design.md` D2).
  Exit criterion: el DTO rechaza nombre vacío/sólo-espacios, rechaza
  `avatar_url` no-URL, acepta `avatar_url: null`.
  Verify: `pnpm --filter @dsm/api exec jest
  src/account/dto/update-profile.dto.spec.ts` — 1 test por caso (nombre
  vacío rechazado, sólo-espacios rechazado tras trim, avatar_url inválida
  rechazada, avatar_url null aceptada, avatar_url http(s) válida aceptada,
  esquema `ftp://` rechazado) — todos en rojo antes de escribir el DTO,
  verde después (TDD).

- [x] **T4 — `CustomersRepository.updateProfile()`**
  Agregar el método a `apps/api/src/auth/customers.repository.ts`:
  `updateMany({ where: { id, deleted_at: null }, data: { name, avatar_url } })`
  + `count === 0 → null` + `findUniqueOrThrow` + `stripHash`, acepta `tx`
  opcional (mismo shape que `anonymize()`).
  Pattern: `apps/api/src/auth/customers.repository.ts` método `anonymize()`
  (líneas ~178-196) — mismo idioma `updateMany` guardado.
  Exit criterion: el método actualiza `name`/`avatar_url` de una cuenta
  activa, devuelve `null` para una cuenta con `deleted_at` seteado o un id
  inexistente, nunca expone `password_hash`.
  Verify: `pnpm --filter @dsm/api exec jest
  src/auth/customers.repository.spec.ts -t updateProfile` — verde contra
  Postgres real (no mock, mismo criterio que el resto del repositorio).

- [x] **T5 — `CustomerResponseDto.avatar_url`**
  Agregar `avatar_url!: string | null;` a `CustomerResponseDto`
  (`apps/api/src/auth/dto/customer-auth.dto.ts`) y a su `.from()` (lee
  `customer.avatar_url`).
  Exit criterion: `GET /v1/auth/me`, `register`, `login` y el nuevo
  `PATCH /v1/me` devuelven todos `avatar_url` en el body. Los tests que
  fijaban la lista EXACTA de campos (`e2e-auth-register.spec.ts`,
  `e2e-auth-login.spec.ts`) y el F40 de columnas materializadas
  (`auth-schema.spec.ts`) se actualizan para incluirlo.
  Verify: `pnpm --filter @dsm/api exec jest src/auth/e2e-auth-register.spec.ts
  src/auth/e2e-auth-login.spec.ts src/auth/auth-schema.spec.ts` — todos en
  verde.

- [x] **T6 — `PATCH /v1/me` en `AccountController`**
  Agregar el handler: `@Patch() @HttpCode(200) @Throttle({
  account_profile_update: { limit: ACCOUNT_PROFILE_UPDATE_RATE_LIMIT_MAX } })
  @UseGuards(CustomerGuard, CsrfGuard)`. Inyecta `CustomersRepository` en el
  constructor (ya exportado por `AuthModule`, sin cambios de módulo). Body
  tipado `UpdateProfileDto`. Si `updateProfile()` devuelve `null`, lanza
  `UnauthenticatedError` (`../common/errors/auth-errors`). Responde
  `CustomerResponseDto.from(actualizado)`. NO se toca el `@SkipThrottle({...})`
  de clase — `account_profile_update` sigue el mismo criterio que
  `account_deletion` (nunca estuvo en esa lista, ver `design.md`).
  Pattern: el propio `deleteMe()` en el mismo archivo — mismo par de guards,
  misma fuente de identidad (`req.customerId!`).
  Exit criterion: `PATCH /v1/me` sin sesión → 401; con sesión ajena, sólo
  afecta la propia fila (AC-7); nombre vacío/URL inválida → 422 sin tocar la
  fila; `avatar_url: null` limpia un avatar existente (AC-3); URL válida lo
  setea (AC-2); URL sin http/https → 422 (AC-5); `email` en el body → 422
  (AC-6, `forbidNonWhitelisted`).
  Verify: `pnpm --filter @dsm/api exec jest
  src/account/ac1-ac2-ac3-edit-profile.spec.ts
  src/account/ac4-ac5-invalid-input-rejected.spec.ts
  src/account/ac6-email-read-only.spec.ts
  src/account/ac7-only-owner-edits-own-profile.spec.ts` — 4 archivos nuevos,
  supertest contra Postgres real (`bootTestApp([AuthModule, AccountModule])`,
  mismo estilo que `ac13-only-owner-deletes.spec.ts`), todos en verde.

- [x] **T7 — Contrato OpenAPI**
  En `apps/api/docs/api/openapi.yaml`: agregar `patch:` bajo el path `/me:`
  existente (tag `account`, requestBody `UpdateProfileRequest`, 200
  `Customer`, 401/403/422/429). Agregar `avatar_url` (required, nullable,
  `format: uri`) al schema `Customer`. Nuevo schema `UpdateProfileRequest`
  (`name` + `avatar_url` requeridos, `additionalProperties: false`).
  Exit criterion: el YAML lintea limpio y describe exactamente el
  comportamiento implementado en T6 (mismos status codes, mismo shape).
  Verify: `pnpm dlx @stoplight/spectral-cli lint apps/api/docs/api/openapi.yaml
  --ruleset .spectral.yaml --fail-severity=warn` (mismo comando que
  `.github/workflows/ci.yml`) sale con exit 0.

- [x] **T8 — Suite completa + typecheck + lint**
  Correr la suite completa del backend (no sólo los archivos nuevos) para
  detectar regresiones cruzadas (mismo criterio que PR #99/#122 de esta
  sesión — un campo aditivo en un DTO compartido puede romper un fixture en
  otro archivo).
  Exit criterion: 0 tests rotos, 0 errores de typecheck, 0 errores de lint
  en todo `apps/api`.
  Verify: `pnpm --filter @dsm/api test` (suite completa) +
  `pnpm --filter @dsm/api typecheck` + `pnpm --filter @dsm/api lint`
  — los tres en verde.
