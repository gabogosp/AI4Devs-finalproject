# Capacidad: Cuentas de cliente — registro, login y sesión (CAP-6)

**Estado**: entregada — backend + UI de cliente vivos, incluida la entrega
real del email de recuperación (adapter Resend, adelantado desde US-011 por
decisión del PO 2026-08-19).

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

Una **UI de cliente** sobre esta superficie (US-014 frontend-web, rutas
`/ingresar`, `/crear-cuenta`, `/recuperar`, `/recuperar/confirmar`,
`/mi-cuenta`, todas en `(storefront)` — públicas, con el chrome del sitio):

- **Rewrite same-origin** (`ADR-0013`) para `/v1/auth/*`: el despliegue vive
  en `*.up.railway.app`, que está en la Public Suffix List — sin el rewrite,
  web y API son sitios distintos para el navegador y las cookies
  `SameSite=Lax` nunca viajan. Acotado a `/v1/auth/*` para no tocar el
  catálogo/panel ya entregados.
- **Todo el contenido con sesión es Client Component** — el servidor sólo
  produce el shell anónimo, siempre, para todo el mundo. Ninguna página
  personalizada puede filtrar a una caché compartida porque nunca se genera
  en el servidor; el mutator **lanza** si algo intenta `session: 'customer'`
  desde el servidor.
- **Refresh single-flight cross-tab** (Web Locks API,
  `navigator.locks.request`, con fallback a promesa de módulo): un solo
  refresh a la vez por origen, no por pestaña — sin esto, dos pestañas que
  expiran a la vez se desloguean mutuamente al pisarse la rotación de un
  solo uso (ADR-0011).
- **CSRF**: lee `dsm_csrf` y reenvía `X-CSRF-Token` sólo en los métodos no
  seguros que el backend exige (`logout`, `refresh`) — nunca en
  `register`/`login`/`reset`, que no tienen sesión que secuestrar.
- **`CustomerGuard`** propio (no reutiliza el `AdminGuard` del panel): UX,
  no autoridad — la autoridad es el guard del backend.
- **AC-5 protegido también desde el frontend**: ante cualquier `401` de
  login, un solo copy fijo, sin `setError` por campo, sin redirect
  diferenciado, sin propiedad de telemetría derivada de la respuesta — un
  test de igualdad de `innerHTML` entre los tres casos (contraseña
  incorrecta / cuenta inexistente / cuenta bloqueada) falla si algo los
  distingue.
- **Observabilidad sin PII**: 7 eventos públicos, ninguno lleva `customer_id`
  ni ninguna propiedad derivada de la respuesta del servidor.
- `/recuperar/confirmar` no es indexable y borra el token de la URL
  (`history.replaceState`) apenas lo lee.

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
- **SSR de contenido personalizado** (p. ej. historial en `/mi-cuenta`) —
  `Deferred: US-015`, con la decisión D3 (todo cliente) explícitamente
  reabierta para cuando eso llegue.
- **Área de cuenta e historial de compras** — `Deferred: US-015`. Hoy
  `/mi-cuenta` es un placeholder honesto ("Tus compras — próximamente").
- **Endurecimiento del panel admin a cookies** — `Deferred: change de
  endurecimiento del panel — owner: Arquitecto`. El panel sigue con
  `Bearer` + `sessionStorage`.
- **`@axe-core/playwright`** — `Deferred:` si QA lo pide (hoy `jest-axe`
  cubre `frontend-standards §19.2`).

## Qué verificó QA

Suite QA-owned (`US-014-registro-login-qa`), Modo A sibling — la capa nueva se define
por correr contra la **API real** (no `api-stub.mjs`, donde `bcrypt` es una comparación
de strings, el rate-limit se dispara con un header y la rotación vive en un `Map`):

- **API real** (Playwright, `qa/e2e/cuenta-cliente.spec.ts`, API context — corrección de
  etiqueta: el `qa-plan.md` original lo llamaba "E2E de navegador", pero corre sobre
  `APIRequestContext`, sin un solo `page.goto`): 13/13 escenarios verdes — registro con
  sesión inmediata, login, logout que invalida de verdad, recuperación de punta a punta.
- **E2E de navegador real** (`qa/e2e/cuenta-acceso-cross-stack.spec.ts`, follow-up
  post-archive, sweep tras `historial-compras` PR #89): el hueco que dejaba la fila
  anterior — navegador de verdad + API real + app **construida**, no el stub de
  `apps/web/e2e/auth-journey.spec.ts` (Layer 2, dev-owned) ni el `APIRequestContext` de
  arriba. 2/2 verdes: registro con cookies `httpOnly` reales, logout que invalida de
  verdad, dos vueltas de login. `/v1/auth/*` ya tenía su rewrite same-origin (ADR-0013)
  desde US-008 — este spec es la prueba viva de que la cookie viaja ida y vuelta contra
  el build real, no sólo que el código la declara.
- **Seguridad observable** (Playwright, API context): anti-enumeración medida sobre
  **status + cuerpo + latencia** entre caso existente e inexistente (banda amplia, no un
  umbral fino — sería flaky); rotación y reuso del refresh; contraseña nunca expuesta,
  verificado también sobre el stdout del proceso.
- **Accesibilidad**: 9/9 — los cuatro formularios (registro, login, recuperación,
  confirmación) en WCAG 2.1 AA + recorrido por teclado.
- **Carga (k6)**: `POST /v1/auth/login` — presupuesto **propio** de login (no el de
  "escritura carrito/orden < 500ms" del PRD §4, que no cubre esta ruta): **p95 ≤ 800ms**,
  ratificado por el PO 2026-09-06 aceptando expresamente el costo de `bcrypt` cost 12
  (~250ms por diseño, mitigación de fuerza bruta) como parte del presupuesto. Medido:
  **p95 = 654,41ms**, 200/200 checks, dentro del presupuesto.

**Deuda conocida, no bloquea este archive** (documentada, no oculta):

| Ítem | Estado | Asignado a |
|---|---|---|
| Regresión sobre las suites QA ya existentes (`TC-2xx`/`TC-3xx`/`TC-7xx`) | No re-corrida en esta sesión de archive | El código de US-014 (BE/FE) está en `main` hace días; cada PR posterior corrió su propia suite completa en verde (CI continua) — no-regresión verificada de facto, sin una corrida dedicada explícita |
| Charters exploratorios `TC-170` (fuerza bruta/lockout) y `TC-171` (correo de recuperación como canal) | Escritos, `execution_mode: manual`, **pendientes de ejecución** (`qa/exploratory/us-014-cuentas.md` lo dice literalmente) | Fase de prueba local/visual del usuario — no bloquea `Done`, es trabajo exploratorio humano por diseño |

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
| [`US-014-registro-login-frontend-web`](../../changes/archive/US-014-registro-login-frontend-web/) | FE | Rewrite same-origin (ADR-0013), refresh single-flight cross-tab, `SessionProvider`/`CustomerGuard`, AC-5 protegido en el cliente, 5 rutas públicas sin SSR de contenido personalizado |
| [`US-014-registro-login-qa`](../../changes/archive/US-014-registro-login-qa/) | QA | 13 E2E de navegador + 9 a11y + 1 k6 (login, p95 ≤ 800ms ratificado por el PO) verdes. 2 charters manuales pendientes de ejecución humana, documentados como deuda conocida arriba |

Con esto, `disciplines: [BE, FE, QA]` de US-014 queda completo — las 3 disciplinas
archivadas.

## Estado de la provisión

Corre hoy en **entorno local** (`docker-compose`, Postgres). Requiere
`RESEND_API_KEY` provisionada para el envío real de email de recuperación —
sin ella, en producción el arranque falla (fail-fast, mismo criterio que
`GEMINI_API_KEY` de US-005); en desarrollo/test cae al adapter de log. La
provisión de nube es US-019, igual que el resto del sistema.
