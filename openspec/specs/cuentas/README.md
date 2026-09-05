# Capacidad: Cuentas de cliente — registro, login y sesión (CAP-6)

**Estado**: entregada — backend completo, incluida la entrega real del email de
recuperación (adapter Resend, adelantado desde US-011 por decisión del PO
2026-08-19). Sin UI propia todavía: las pantallas de registro/login/reset son
`US-014-registro-login-frontend-web` (mergeado, pendiente de su propio archive).

Estado declarado del sistema para la capacidad CAP-6 del PRD §2.1. Este
directorio es el **acumulado** de los changes archivados: se extiende en cada
`/archive-change`, nunca se reescribe.

## Por qué esta capacidad no existía todavía

Hasta este change, la única identidad persistida del sistema era el seam admin
de US-001 (JWT `role=admin` sobre un bootstrap token). US-014 introduce al
**cliente registrado** como segundo actor: credenciales reales, PII básica y
sesión de larga duración — la primera vez que el producto custodia secretos de
personas. `openspec/specs/cuentas/` nace hermana de `catalogo/`, no anidada:
comparte primitivas (hash, lockout, throttler) con el seam admin pero es una
superficie propia (`/v1/auth/*`, pública, namespace fuera de `/admin`).

## Qué está vivo hoy

Un solo módulo (`apps/api/src/auth/`, extendido — no reemplazado — sobre el de
US-001), dos seams de emisión separados por actor sobre **una** tabla de
identidad (`customers` con `role: customer|admin`):

- **Registro con sesión inmediata** (AC-1): `POST /auth/register` crea la
  cuenta y devuelve `201` + las tres cookies de sesión — sin verificación de
  email bloqueante.
- **Login/logout reales** (AC-2/AC-3): `POST /auth/login` / `POST /auth/logout`.
  El logout revoca la familia de refresh del dispositivo actual (las otras
  sesiones siguen vivas); la ventana residual del access (≤ 15 min) es una
  consecuencia declarada de un access stateless.
- **Sesión por cookie con refresh rotado** (AC-9, ADR-0011): access JWT
  `httpOnly` de vida corta (15 min) en `dsm_access`; refresh **opaco** (256
  bits, nunca un JWT) de un solo uso en `dsm_refresh` (`Path=/v1/auth`), 30
  días. `POST /auth/refresh` rota dentro de la misma familia; presentar un
  refresh ya rotado se trata como robo — revoca la familia entera y devuelve
  el mismo 401 que un token inexistente.
- **CSRF double-submit firmado** (§7.5): cookie `dsm_csrf` legible por JS
  (`HMAC-SHA256(JWT_SECRET, jti)`), exigida como header `X-CSRF-Token` en toda
  escritura autenticada por cookie, más verificación de `Origin` contra la
  allowlist de CORS.
- **Recuperación de contraseña completa** (AC-4/AC-7), **incluida la entrega
  real del email**: token opaco de 32 bytes, SHA-256 en reposo, TTL ≤ 60 min,
  uso único, cupo de 3/hora por cuenta. `POST /password-reset/confirm` revoca
  TODAS las sesiones de la cuenta y no abre una nueva. El adapter Resend (no
  el de log) es el de producción — decisión del PO que adelantó esto desde
  US-011 porque esa US dependía de todo el loop de compra y dejaba el flujo
  inalcanzable por varios ciclos.
- **Anti-enumeración estructural** (AC-5/AC-6/AC-11): login y reset devuelven
  respuestas idénticas exista o no la cuenta (incluido el costo de CPU vía
  hash señuelo); registro duplicado responde `409` genérico.
- **Rate-limit por IP + lockout por cuenta** (AC-10): throttler `auth`
  reusado con presupuesto por ruta; lockout temporal con backoff exponencial
  acotado a 60 min (nunca permanente).
- **Endurecimiento del seam admin** (Fase 8, ADR-0009 intacto):
  `POST /admin/auth/login` acepta ahora `{email, password}` además del
  bootstrap token, sin tocar `AdminGuard` ni el contrato `role=admin`.
- **`CustomerResponseDto`** expone exactamente `{id, email, name, phone,
  created_at}` — nunca `password_hash`, `role`, contadores de lockout ni
  `deleted_at` (AC-8).

## Qué NO está vivo todavía

- **2FA** (cliente y admin) — `Deferred: follow-up de ADR-0009 — owner: Arquitecto`.
- **Borrado de cuenta / RTBF** — `deleted_at` existe en el esquema, ningún
  endpoint la escribe. `Deferred: US futura de gestión de datos — owner: PO`.
- **Fusión del carrito guest con la cuenta** — fuera de v1 (US §4).
- **Historial de compras** — US-015.
- **Purga programada de tokens vencidos por job** — limpieza oportunista sí
  (en cada rotación/confirm); el job BullMQ global
  `Deferred: US-011/operaciones — owner: Arquitecto` (Redis no aprovisionado).
- **Regla de rate-limit de borde (Cloudflare/WAF) sobre `/v1/auth/*`** —
  `Deferred: US-019 (infraestructura) — owner: Arquitecto`, defensa en
  profundidad adicional al throttler de aplicación.
- **UI** (formularios de registro/login/reset) — construida y mergeada
  (`US-014-registro-login-frontend-web`), pendiente de su propio
  `/archive-change`.

## Contratos

El contrato vivo de la superficie REST está en [`contracts/openapi.yaml`](contracts/openapi.yaml)
+ un archivo por endpoint bajo [`contracts/openapi/paths/`](contracts/openapi/paths/).
Ocho endpoints vivos:

| Endpoint | Métodos | AC |
|---|---|---|
| `/auth/register` | POST | AC-1, AC-6 |
| `/auth/login` | POST | AC-2, AC-5 |
| `/auth/refresh` | POST | AC-9 (ADR-0011) |
| `/auth/logout` | POST | AC-3 |
| `/auth/me` | GET | — |
| `/auth/password-reset/request` | POST | AC-11 |
| `/auth/password-reset/confirm` | POST | AC-4, AC-7 |
| `/admin/auth/login` | POST | AC-8 (seam admin, ADR-0009) |

**`POST /admin/auth/login` se mudó de `catalogo` a `cuentas`** (decisión del PO,
2026-08-19): es un endpoint de autenticación, no de catálogo, y su hogar
natural es la capacidad que lo gobierna. `catalogo` queda con una nota que
apunta acá; no se declara en las dos (dos copias driftean).

## Changes que formaron esta capacidad

| Change | Disciplina | Aporte |
|---|---|---|
| [`US-014-registro-login-backend`](../../changes/archive/US-014-registro-login-backend/) | BE | Módulo de auth de cliente completo: registro/login/logout/refresh/me/reset, sesión por cookie + refresh rotado, CSRF double-submit, lockout, endurecimiento del seam admin |

Pendiente de archivar sobre esta misma capacidad: `US-014-registro-login-frontend-web`
(pantallas de registro/login/reset, mergeado). `US-014-registro-login-qa` tiene
un `[Open]` real (NFR de latencia de login sin ratificar) y no puede cerrarse
hasta esa decisión del PO/Arquitecto.

## Estado de la provisión

Corre hoy en **entorno local** (`docker-compose`, Postgres). Requiere
`RESEND_API_KEY` provisionada para el envío real de email de recuperación —
sin ella, en producción el arranque falla (fail-fast, mismo criterio que
`GEMINI_API_KEY` de US-005); en desarrollo/test cae al adapter de log. La
provisión de nube es US-019, igual que el resto del sistema.
