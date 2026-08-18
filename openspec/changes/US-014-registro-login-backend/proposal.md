---
tracker-id: null
tracker-source: null
parent-us: US-014
discipline: backend
variant: null
language: es
---

# US-014 Backend — Registro, login y sesión del cliente (identidad propia)

## Why

Hasta hoy `apps/api` no tiene **identidad de personas**: el esquema `@dsm/db` sólo
conoce `categories` y `products`, y la única auth existente es el **seam admin** de
US-001 (ADR-0009) — un intercambio de *bootstrap token* de config por un JWT
`role=admin`, sin usuarios, sin contraseñas y sin sesión. US-014 introduce el
**primer actor humano persistido** del producto: el **cliente registrado**.

El valor es de retención: el guest checkout cubre el loop completo del MVP
(PRD §7), y las cuentas agregan la compra recurrente y el historial (US-015, que
está `blocked_by: [US-014]`). Pero la razón por la que esta US es cara no es el
CRUD de una cuenta: es que **abrimos una superficie de credenciales** — el vector
más atacado de cualquier e-commerce. Registro, login, sesión, refresh y
recuperación de contraseña son cinco flujos donde el error no se ve en QA sino en
un *credential stuffing* seis meses después. Por eso el cuerpo de este change es
seguridad: bcrypt con factor declarado, cookie `httpOnly`+`Secure`+`SameSite`,
refresh rotado con detección de reuso, tokens de reset hasheados y de un solo uso,
rate-limit + lockout, y respuestas indistinguibles para email existente vs
inexistente.

El sustrato de borde ya está y **no se re-arquitectura**: US-001 dejó helmet
(§7.1), allowlist de CORS (§7.2), `ValidationPipe` global con `whitelist` (422),
el filtro RFC 7807 (`HttpProblemFilter`) y el throttler nombrado `auth`
(`AuthThrottlerGuard`, con las cabeceras `RateLimit-*`/`Retry-After` de
`api-standards §12`). US-014 **reusa esas piezas tal cual** — en particular el
throttler `auth`, que es el mecanismo de rate-limit de la superficie de auth y no
se duplica. El `AdminGuard` (contrato `role=admin`) **no se reescribe**: ADR-0009
lo declaró explícitamente y su criterio de validación es justamente que US-014
aterrice sin tocarlo.

## What changes

- **Modelo de identidad nuevo en `@dsm/db`** (migración aditiva, tablas nuevas):
  `customers` (email normalizado único, `password_hash` bcrypt, `name`, `phone`,
  `role`, contadores de lockout, `deleted_at`), `refresh_tokens` (hash del token,
  `family_id`, expiración, revocación — habilita logout real y detección de reuso)
  y `password_reset_tokens` (hash, expiración ≤ 1 h, uso único). Detalle
  columna-por-columna en `design.md` §Persistencia.
- **`AuthModule` extendido con el seam de cliente** (`/v1/auth/*`, espacio público
  de la raíz per ADR-0010): `POST /register`, `POST /login`, `POST /logout`,
  `POST /refresh`, `GET /me`, `POST /password-reset/request`,
  `POST /password-reset/confirm`. Layering controller → service → repository
  (`backend-node-standards §2`), sin lógica de negocio en el controller.
- **Sesión por cookie (AC-9)**: access JWT corto (15 min) en cookie
  `httpOnly`+`Secure`+`SameSite=Lax`, **nunca** en el cuerpo de la respuesta ni en
  almacenamiento accesible por JavaScript; refresh opaco de 256 bits en cookie
  acotada a `path=/v1/auth`, **rotado** en cada uso, con **detección de reuso** que
  revoca la familia entera (`security-standards §3.3`).
- **CSRF (§7.5)**: al ser auth por cookie, se agrega la segunda capa obligatoria —
  double-submit **firmado** (cookie `dsm_csrf` legible + header `X-CSRF-Token`,
  ligado por HMAC al `jti` del access token) más verificación de `Origin` contra la
  allowlist de CORS en toda escritura autenticada.
- **Hash de contraseña bcrypt cost 12** (`security-standards §3.1`), verificación
  en tiempo constante por la librería, y **hash señuelo** para que un email
  inexistente consuma el mismo trabajo que uno existente (anti-timing).
- **Política de contraseña per §3.2**: mínimo 8 (sugerido 12+), sin reglas de
  composición, todos los caracteres imprimibles permitidos, y rechazo contra un
  corpus offline de contraseñas filtradas versionado en el repo.
- **Anti-enumeración (AC-5/AC-6/AC-11)**: login inválido, cuenta bloqueada y email
  inexistente devuelven **exactamente** el mismo `401 dsm:auth/invalid-credentials`;
  la solicitud de reset devuelve **siempre** `202` con el mismo cuerpo exista o no
  la cuenta; el registro con email existente devuelve un `409` genérico que no
  confirma la existencia.
- **Rate-limit + lockout (AC-10, §7.3)**: se **reusa el throttler nombrado `auth`**
  ya registrado (no se inventa un mecanismo paralelo), con presupuestos por ruta
  vía `@Throttle({ auth: … })`; sumado a un **lockout temporal por cuenta** con
  backoff exponencial acotado (nunca permanente — el lockout permanente es un
  vector de DoS).
- **Puerto de email de recuperación**: interfaz `PasswordResetMailer` con adapter
  de log en este change; el adapter Resend real es de **US-011** (ver
  §Open questions OQ-BE-1, ratificada por el PO el 2026-08-17). **El flujo de
  recuperación no queda completo end-to-end hasta US-011**: en producción no sale
  ningún email todavía.
- **Endurecimiento del seam admin (ADR-0009)**: `POST /v1/admin/auth/login` acepta
  además credenciales (`email` + `password`) de una fila `role='admin'`, con el
  mismo bcrypt, lockout y rate-limit, **preservando el contrato de respuesta
  `{ token }`** y el claim `role=admin`. El camino de *bootstrap token* queda
  intacto detrás de su flag para no romper el panel de US-001.
- **Observabilidad (US §9, E2E §18)**: `AuthEventsService` con eventos
  `auth.registered` / `login_succeeded` / `login_failed` / `logout` /
  `password_reset_requested` / `password_reset_completed` / `refresh_reuse_detected`
  / `account_locked`. **Sin PII**: `entity_id` es el UUID del cliente (pseudónimo),
  nunca el email; la contraseña no aparece en ningún log, respuesta ni evento (AC-8).
- **Contratos**: 7 yaml draft (uno por endpoint, `api-contract-completeness`) +
  actualización del spec publicado `apps/api/docs/api/openapi.yaml` y del README.
- **Tests owned-by-dev**: unit (hash, política, tokens, rotación, lockout, CSRF),
  integration contra Postgres real (unicidad de email normalizado, rotación y
  revocación de familia, uso único del token de reset) y e2e-nest (los 11 AC +
  cabeceras de cookie + 429 + indistinguibilidad).

## ACs de US-014 cubiertos (capa backend)

| AC | Qué cubre este change | Nota |
|---|---|---|
| **AC-1** (registro con login inmediato) | `POST /v1/auth/register` crea la cuenta con `password_hash` bcrypt y devuelve la sesión (cookies access + refresh) en la misma respuesta | Sin verificación de email bloqueante (decisión de la US §10) |
| **AC-2** (login con credenciales válidas) | `POST /v1/auth/login` → sesión activa; `GET /v1/auth/me` responde 200 con la cuenta bajo `CustomerGuard` | Las "secciones de cuenta" en sí son FE / US-015 |
| **AC-3** (logout) | `POST /v1/auth/logout` revoca la **familia** de refresh y borra las cookies; el refresh revocado ya no renueva | El access token vive ≤ 15 min por diseño (ventana acotada declarada) |
| **AC-4** (recuperación de contraseña) | `password-reset/request` emite token hasheado con TTL ≤ 1 h; `password-reset/confirm` fija la nueva contraseña, invalida el token y **todas** las sesiones | **Parcial**: el backend queda completo, pero el **envío** del email es `Deferred: US-011` (OQ-BE-1) — acá va el puerto + adapter de log. AC-4 no es demostrable en producción hasta que US-011 aterrice |
| **AC-5** (login inválido genérico) | Mismo `401 dsm:auth/invalid-credentials` para contraseña incorrecta, email inexistente y cuenta bloqueada, con trabajo de hash equivalente | |
| **AC-6** (registro con email existente) | No se crea duplicado (unique en `email` normalizado) → `409 dsm:auth/registration-failed` con detalle genérico | Trade-off explícito en `design.md` §Seguridad (AC-1 exige sesión inmediata ⇒ la respuesta de éxito no puede ser idéntica) |
| **AC-7** (token de reset expirado o usado) | `used_at` + `expires_at` ⇒ `400 dsm:auth/invalid-reset-token` con mensaje que pide un link nuevo | Idéntico para token inexistente (sin enumeración de tokens) |
| **AC-8** (la contraseña nunca se expone) | bcrypt cost 12; ninguna respuesta ni log ni evento contiene la contraseña ni el hash; DTO de respuesta explícito | Test e2e que barre cuerpo y logs |
| **AC-9** (sesión segura por cookie) | Cookies `httpOnly`+`Secure`+`SameSite=Lax`; access 15 min + refresh rotado; el token **no** viaja en el cuerpo | La lectura de la cookie en el cliente es FE |
| **AC-10** (límite de intentos) | Throttler `auth` por IP con presupuesto por ruta + lockout por cuenta con backoff | 429 con `Retry-After` + `RateLimit-*` |
| **AC-11** (reset de email inexistente) | `202` con cuerpo idéntico y envío fuera de banda ⇒ ni el status ni el timing distinguen | |

## Out of scope

- **Historial de compras** → US-015 (`blocked_by: [US-014]`).
- **Fusión del carrito guest con la cuenta al iniciar sesión** → fuera de v1 (US §4).
- **Login social / SSO** → fuera de v1 (ADR-0005 los descartó explícitamente).
- **2FA (cliente y admin)** → `Deferred: follow-up de ADR-0009 — owner: Arquitecto`.
  US §4 lo saca del alcance del cliente y §7 no lo lista en `BE-US-014`; el 2FA
  admin opcional del E2E §14 queda como cierre pendiente del criterio de validación
  de ADR-0009.
- **Borrado de cuenta / derecho al olvido** → la columna `deleted_at` se crea (DER
  E2E §8) pero **ningún endpoint la escribe** en este change. `Deferred: US futura
  de gestión de datos — owner: PO` (PRD §6 lo compromete, ninguna US lo tiene).
- **Adapter real de email (Resend)** → US-011. Este change entrega el **puerto** y
  un adapter de log. `Deferred: US-011 — entrega real del email de reset`
  (OQ-BE-1, ratificada 2026-08-17).
- **Verificación de email (bloqueante o no bloqueante)** → la US §4 la declara
  no aplicable; no se emite email de verificación.
- **Purga programada de tokens expirados** → se hace limpieza oportunista en cada
  operación; el job programado espera a Redis/BullMQ (ADR-0004, aún no
  provisionado). `Deferred: US-011 / operaciones — owner: Arquitecto`.
- **Pantallas de registro/login/reset** → `FE-US-014`.
- **Suite de aceptación cross-funcional (Playwright, abuso, carga)** → `QA-US-014`.

## Standards consultados

- `backend-node-standards.md` §2 (layering controller→service→repository), §3 (DI
  por constructor), §4 (DTO validado en el borde + DTO de respuesta separado), §5
  (Prisma detrás de repositorios, `$transaction` para escrituras múltiples,
  migración aditiva), §6 (errores de dominio → filtro RFC 7807), §7 (env validada
  con Zod al arranque, secretos de plataforma), §8 (async, sin bloquear el event
  loop), §9 (pino estructurado + trace id), §10 (unit/integration/e2e), §11
  (anti-patterns).
- `security-standards.md` §3.1 (bcrypt cost ≥ 12, salt por contraseña,
  verificación por la librería), §3.2 (política de contraseña NIST), §3.3 (access
  ≤ 15 min, refresh rotado de un solo uso, **detección de reuso obligatoria**,
  camino de revocación, pin de algoritmo, `exp`/`iss`/`aud`), §3.7 (ciclo de vida:
  reset ≤ 1 h de un solo uso, el reset invalida todas las sesiones, logout revoca
  de verdad), §3.8 (fail closed), §5 (secretos), §6 (validación de entrada), §7.1
  (headers, ya globales), §7.2 (CORS allowlist — se suma `X-CSRF-Token`), §7.3
  (rate-limit y lockout de la superficie de auth + no enumerar), §7.4 (TLS y
  atributos de cookie), §7.5 (CSRF obligatorio cuando la auth va en cookie), §8.5
  (nunca loguear credenciales).
- `api-standards.md` §2 (namespace `/v1/auth/*` público), §8 (envelope RFC 7807),
  §12 (cabeceras `RateLimit-*` / `Retry-After`).
- `testing-standards.md` §14 + `qa-backend-standards.md` §2.1 (ownership dev vs QA).
- Skills: `openspec-workflow` (3 archivos + tasks closure-grade + regla de contrato
  vivo), `threat-modeling-lite` (STRIDE de la frontera de auth), `data-architecture-patterns`
  (procedimiento de 6 pasos aplicado inline — ver `design.md` §Persistencia),
  `api-contract-completeness` (1 yaml por endpoint), `observability-patterns`
  (eventos sin PII, sin cardinalidad por usuario), `nfr-quantification` (presupuesto
  de latencia con bcrypt, límites numéricos).
- ADRs heredados: ADR-0005 (auth propia JWT + bcrypt — **este change requiere una
  enmienda**, ver OQ-BE-2), ADR-0009 (seam admin — se honra sin reescribir el
  guard), ADR-0010 (namespace: la raíz es del storefront, `/admin/*` del panel),
  ADR-0004 (Redis/BullMQ — aún no provisionado; ver §Out of scope).

## Open questions

> **Todas resueltas al 2026-08-17.** Las cuatro primeras se escalaron al PO/Arquitecto
> y volvieron ratificadas con la recomendación del plan; las dos últimas son
> decisiones de ingeniería documentadas. No queda ninguna abierta: `/develop-backend`
> puede ejecutar el plan completo.

- **OQ-BE-1 — ¿Cómo se entrega el email de recuperación (AC-4)?**
  `[Resolved: 2026-08-17 — opción (a): puerto PasswordResetMailer + adapter de log
  en US-014; el adapter Resend lo enchufa US-011]` US-011 (Resend) está `Ready`
  pero `blocked_by: [US-010, US-012]`, y hoy no existe ninguna integración de email
  en el repo. Se descartó adelantar el adapter Resend acá (duplicaría el alcance de
  US-011 y sumaría una API key nueva) y bloquear US-014 hasta US-011 (invertiría el
  DAG por un detalle de entrega). **Fundamento**: el puerto es el único acoplamiento
  real; el adapter es intercambiable sin tocar `PasswordResetService`.
  **Consecuencia explícita**: el flujo de recuperación **no está completo
  end-to-end hasta US-011** — el backend emite, hashea, expira e invalida el token
  correctamente y el ciclo se ejercita en tests con el adapter de log, pero **ningún
  email sale del sistema en producción**. Registrado como
  `Deferred: US-011 — entrega real del email de reset` en `design.md` §Puerto de email.
- **OQ-BE-2 — ADR-0011: almacén server-side de refresh tokens (enmienda a ADR-0005).**
  `[Resolved: 2026-08-17 — se levanta ADR-0011 como enmienda a ADR-0005, no como
  supersede]` ADR-0005 §Consequences/Neutral dice textualmente que la invalidación
  de sesión se logra "vía TTL corto + rotación **en vez de** un almacén
  server-side". AC-3 ("su sesión se invalida") y `security-standards §3.3` ("existe
  un camino de revocación: preferido, tabla server-side de refresh tokens") exigen
  lo contrario, y este change **necesita** la tabla `refresh_tokens` para el logout
  real y la detección de reuso. **Fundamento**: enmienda y no supersede porque el
  cuerpo de ADR-0005 (auth propia, JWT, bcrypt, cookie, refresh rotado) sigue
  vigente; lo único que cae es esa nota `Neutral`. **T0.1 lo materializa y bloquea
  la implementación**: sin ese ADR el plan queda inconsistente con una decisión
  `Accepted`.
- **OQ-BE-3 — ¿Entra el endurecimiento del login admin (Fase 8) en este change?**
  `[Resolved: 2026-08-17 — opción (a): la Fase 8 entra en el alcance]` El admin gana
  login por credenciales **conservando su ruta** (`POST /v1/admin/auth/login`), **su
  transporte** (`Authorization: Bearer`) y **su respuesta** (`{ token }`) sin
  cambios; el bootstrap token queda intacto detrás de su flag. Se descartó diferirlo
  (dejaría abierto el criterio de validación de ADR-0009) y la migración completa
  del admin a cookie + refresh (rompería `adminSession.login` de FE-US-001, que ya
  está archivado, sin ningún AC que lo pida). **Fundamento**: cierra la promesa de
  ADR-0009 con churn cero en consumidores. Las 0,6 h de la Fase 8 están **dentro**
  de las 7,5 h AI-asistido / 15 h tradicional del plan.
- **OQ-BE-4 — Vida del refresh token (sesión "recordarme").**
  `[Resolved: 2026-08-17 — 30 días, vía AUTH_REFRESH_TTL_DAYS]` El E2E y la US fijan
  el access en ~15 min pero **no** fijaban el refresh; `security-standards §3.3` no
  da número y el rango de industria para e-commerce es 7–90 días. **Fundamento**: 30
  días es el equilibrio habitual del rubro — no obliga al re-login semanal (7 días,
  fricción alta para una compra recurrente que es justamente el valor de la cuenta)
  ni deja una credencial viva un trimestre (90 días). Va por env, así que revisarlo
  es editar una variable, no tocar código.
- **OQ-BE-5 — ¿El registro con email existente puede ser 100% indistinguible?**
  `[Resolved: no, y se documenta el límite]` AC-1 exige **sesión inmediata** en el
  alta correcta; una respuesta idéntica para el duplicado obligaría a no emitir
  sesión nunca (flujo mediado por email), contradiciendo AC-1. Se elige el `409`
  con detalle genérico ("No pudimos crear la cuenta con esos datos") + rate-limit
  de registro por IP: no **confirma** la existencia (podría ser una violación de
  política) y hace inviable la enumeración masiva. AC-6 pide "no deducir **con
  certeza**", que es exactamente esta postura.
- **OQ-BE-6 — Prefijos de cookie `__Host-` / `__Secure-`.**
  `[Resolved: no se usan, con justificación]` `security-standards §7.4` los pide
  "donde las restricciones de path/dominio lo permitan". `__Host-` exige `path=/`,
  incompatible con el refresh acotado a `/v1/auth` (que es la mitigación más
  valiosa de las dos), y nombres dinámicos por entorno romperían el contrato con el
  FE y el loop local en HTTP. Se usan nombres fijos (`dsm_access`, `dsm_refresh`,
  `dsm_csrf`) con `Secure` gobernado por config.

## References

- User Story: `docs/user-stories/US-014-registro-login.md` (AC-1…AC-11, §9 NFRs, §10 notas).
- E2E: `docs/product/design-e2e.md` §6.1 (`AuthModule`), §8 (DER — `CUSTOMERS`),
  §14 (STRIDE — superficie "Login / registro / sesión"), §17 (NFRs), §18
  (observabilidad), §20 (ADR-0005).
- PRD: `docs/product/prd.md` §6 (PII, retención, base legal Ley 25.326), §7 (roles).
- Esquema (fuente de verdad): `packages/db/prisma/schema.prisma` (`@dsm/db`).
- Código AS-BUILT reconciliado: `apps/api/src/auth/` (seam admin ADR-0009),
  `apps/api/src/common/errors/domain-errors.ts`, `apps/api/src/common/filters/http-problem.filter.ts`,
  `apps/api/src/config/env.validation.ts`, `apps/api/src/bootstrap.ts`,
  `apps/api/src/storefront/storefront-throttler.guard.ts`.
- ADRs: `docs/architecture/decisions/0005-own-jwt-authentication.md`,
  `0009-admin-auth-seam-us001.md`, `0010-url-namespace-storefront-vs-admin.md`.
- Contrato vivo de la capacidad hermana: `openspec/specs/catalogo/contracts/openapi.yaml`
  (este change abre la capacidad **`cuentas`** al archivar — ver `design.md`).
- Precedentes de convención: `openspec/changes/archive/US-001-admin-catalogo-productos-backend/`,
  `openspec/changes/US-003-ficha-producto-pdp-backend/`.
