---
tracker-id: null
tracker-source: null
parent-us: US-024
discipline: backend
variant: null
language: es
---

# US-024 Backend — Design

## Context

Hereda el seam de `AccountModule`/`AccountController` (US-020) sin tocar su
wiring: `AccountModule` ya importa `AuthModule` (que exporta `CustomerGuard`,
`CsrfGuard` y `CustomersRepository`) — el nuevo handler `PATCH /me` no
necesita ningún cambio de módulo, sólo declarar `CustomersRepository` como
dependencia del constructor de `AccountController` (Nest la resuelve desde
`AuthModule` importado, sin re-declararla como provider — `AGENTS.md` §5,
mismo criterio documentado en el comentario de `AccountModule`).

## Decisions

### D1 — `name` y `avatar_url` van juntos, ambos SIEMPRE presentes en el body

La US §10 confirma que el dueño quiere nombre + avatar en un solo formulario
(mismo patrón que `ProductForm.tsx`, que también submitea el estado completo,
no un patch parcial). El DTO declara ambos campos **requeridos** (`avatar_url`
acepta `null` como valor válido para "sin avatar" — no es lo mismo que
"ausente"). Esto evita la ambigüedad de semántica de PATCH parcial
(¿omitir `avatar_url` significa "no tocar" o "vaciar"?) que ningún AC pide
resolver.

### D2 — Validación de `avatar_url`: `@IsUrl` estricto, NO el patrón laxo de `image_url`

`apps/api/src/products/dto/product.dto.ts` valida `image_url` como
`@IsOptional() @IsString()` — sin verificar forma de URL. Ese patrón **no**
sirve acá porque AC-5 pide explícitamente rechazar `"no-es-url"` o un esquema
que no sea http/https. Se usa `@IsUrl({ protocols: ['http', 'https'],
require_protocol: true })` de `class-validator`, con `@ValidateIf` para
saltear la validación cuando el valor es `null` (AC-3). NFR §9 de la US ya
aclara que la validación es de FORMA únicamente — nunca un fetch server-side
(SSRF, `security-standards.md`).

### D3 — `CustomersRepository.updateProfile()`: mismo idioma guardado que `anonymize()`

`updateMany({ where: { id, deleted_at: null }, ... })` + `count === 0 → null`.
Consistente con la invariante documentada en el header de la clase ("toda
lectura de identidad filtra `deleted_at: null`"). El controller trata `null`
como sesión inválida (`UnauthenticatedError`, mismo 401 que `CustomerGuard`
ya usa) — no se introduce un error nuevo para un caso que en la práctica es
inalcanzable (la sesión ya pasó por `CustomerGuard`), pero mantiene el
fail-closed sin una rama silenciosa.

### D4 — Respuesta 200 con `CustomerResponseDto` completo (no 204)

A diferencia de `DELETE /me` (204, no hay nada que devolver), acá el AC-1
pide "se refleja de inmediato en la pantalla" — el FE necesita el estado
actualizado sin un segundo `GET /auth/me`. Se devuelve el mismo DTO que ya
usa `GET /v1/auth/me`.

## Persistence

Trivial — una columna nullable, sin índice, sin relación, sin migración de
datos existentes (todas las filas actuales quedan con `avatar_url = NULL`,
que es exactamente "sin avatar", el estado correcto para cuentas
preexistentes). No se invoca `data-architect` Mode B.

```sql
ALTER TABLE "customers" ADD COLUMN "avatar_url" VARCHAR(2048);
```

## API shape

```
PATCH /v1/me
Cookie: dsm_access=...
X-CSRF-Token: ...

{ "name": "Ana María Pérez", "avatar_url": "https://cdn.example.com/ana.jpg" }
→ 200 { "id", "email", "name", "phone", "avatar_url", "created_at" }

{ "name": "Ana María Pérez", "avatar_url": null }
→ 200 (avatar_url vuelve a null)

{ "name": "   ", "avatar_url": null }
→ 422 problem+json (name)

{ "name": "Ana", "avatar_url": "no-es-url" }
→ 422 problem+json (avatar_url)

{ "name": "Ana", "avatar_url": null, "email": "otro@x.com" }
→ 422 (forbidNonWhitelisted — AC-6)
```

## Resilience / Observability

Ninguna llamada saliente (sin resiliencia numérica que declarar). Sin evento
de observabilidad nuevo — a diferencia de US-020 (que audita
`account.deleted`/`account.deletion_blocked` por ser irreversible y de alto
impacto), una edición de perfil reversible por el propio titular no amerita
un evento de negocio propio; el log HTTP estándar (método+ruta+status) ya
cubre trazabilidad operativa (`observability-standards.md` baseline).

## Deployment considerations

`Requires deployment-planner: no` — migración aditiva de una columna
nullable sin default, mismo patrón de bajo riesgo que otras migraciones
aditivas ya mergeadas en este proyecto (US-020, US-021). Deploy estándar
rolling, sin flag de feature.

## Non-AC declarations (F51 checklist)

- CORS/headers: sin cambios — `AccountController` ya corre bajo el bootstrap
  global (`bootstrap.ts`), ningún middleware nuevo.
- Rate-limit: **sí necesita throttler nombrado propio** — el `@SkipThrottle`
  a nivel de clase de `AccountController` (US-020) sólo lista las 8
  superficies AJENAS (auth/storefront/cart/enrichment/search/checkout/
  payments_simulate/orders_history); `account_deletion` (el propio de este
  controller) NUNCA estuvo en esa lista — queda "activo" para la clase y
  `DELETE /me` fija su presupuesto concreto con su propio `@Throttle`. Se
  agrega un décimo throttler nombrado `account_profile_update` con el MISMO
  criterio (techo global inalcanzable `Number.MAX_SAFE_INTEGER` en
  `ThrottlerModule.forRootAsync` — no afecta a ningún otro controller — y el
  presupuesto real, `ACCOUNT_PROFILE_UPDATE_RATE_LIMIT_MAX` default 20,
  ventana `ACCOUNT_PROFILE_UPDATE_RATE_LIMIT_TTL_MS` default 60_000 = 1 min,
  vía `@Throttle` en el handler de `PATCH /me`) — tampoco se agrega al
  `@SkipThrottle` de clase, por la misma razón que `account_deletion` no lo
  está.
- Feature flags: ninguno.
