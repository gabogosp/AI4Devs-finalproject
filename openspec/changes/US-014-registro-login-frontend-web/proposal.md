---
tracker-id: null
tracker-source: null
parent-us: US-014
discipline: frontend-web
variant: null
language: es
created: 2026-08-20
---

# US-014 Frontend Web — Registro, login y sesión del cliente

> **El backend está terminado y su contrato publicado.** Este plan **consume** la superficie
> que `US-014-registro-login-backend` cerró (44/44 tasks) y **no la re-diseña**: siete
> operaciones declaradas en `apps/api/docs/api/openapi.yaml`, sesión por cookies `HttpOnly`,
> refresh rotado de un solo uso (ADR-0011), anti-enumeración garantizada del lado del
> servidor. Lo que este change decide es cómo el storefront **habla** con esa superficie sin
> romper el modelo de auth que el panel ya usa, y cómo evita ser él mismo el que filtra lo que
> el backend protege.

## Why

US-014 es la primera vez que el storefront tiene un **actor con identidad**. Hasta hoy toda la
superficie pública es anónima y cacheable: US-002 y US-003 construyeron catálogo y ficha con
`revalidate` + tags porque **todo el mundo ve lo mismo**. La cuenta rompe esa premisa por
primera vez, y la rompe justo en la capa donde el proyecto tiene su optimización más fuerte.

El valor de negocio lo fija el PRD (capacidad 8): las cuentas habilitan retención e historial
(US-015). El guest ya cierra el loop de compra, así que la cuenta no es un bloqueante de
ingresos — es la base de la relación repetida. Eso importa para el alcance: este change entrega
**la puerta** (registro, login, logout, recuperación) y el mínimo destino que la puerta
necesita, no el área de cuenta completa.

Hay además una razón de oportunidad. El backend cerró con una decisión que **colisiona de
frente** con el sustrato que US-001 construyó para el panel: la sesión del cliente viaja en
`Set-Cookie` con `HttpOnly` (el contrato declara un componente `SessionCookies` y **ningún**
campo `access_token`/`refresh_token` en el cuerpo de ninguna respuesta), mientras el panel
guarda un token en memoria y lo inyecta como `Authorization: Bearer`. Una cookie `HttpOnly` es,
por definición, ilegible desde JavaScript: la sesión del cliente **no puede** pasar por
`authToken.ts`. Resolver esa convivencia ahora, con un solo consumidor, es barato; resolverla
cuando US-007 (carrito) y US-015 (historial) ya dependan de ella, no.

## What changes

- **El navegador deja de hablar con otro origen para la superficie de sesión.** Un
  `rewrite` de Next monta `/v1/auth/*` sobre el propio origen del sitio; el navegador ve una
  sola aplicación y las cookies de sesión pasan a ser **first-party**. Sin esto la US es
  técnicamente inejecutable en el despliegue vigente (ver §"El hallazgo que gobierna el plan").
- **Un solo punto de red, dos modelos de auth.** `customFetch` gana una extensión de
  `FetchInit` (`session: 'customer'`) que activa cookies + CSRF + refresh; sin la marca, el
  comportamiento del panel queda **byte por byte igual**. Se preserva F48: sigue siendo el único
  `fetch` crudo del frontend y el cliente generado sigue siendo el único que nombra endpoints.
- **Nada personalizado se renderiza en el servidor.** Toda la UI con sesión es cliente. Un
  llamado con `session: 'customer'` ejecutado en servidor **lanza**: la fuga de cachear
  `/mi-cuenta` con los datos de otra persona se vuelve estructuralmente imposible, no
  "cuidada".
- **Refresh de un solo uso sin auto-sabotaje.** Los 401 concurrentes se coalescen en **un**
  `POST /auth/refresh` (mismo tab y entre tabs), porque dos refresh en paralelo con rotación
  single-use hacen que el segundo se lea como robo de token y el backend revoque la familia
  entera — el usuario legítimo quedaría deslogueado por culpa del frontend.
- **Cinco pantallas públicas nuevas**: `/crear-cuenta`, `/ingresar`, `/recuperar`,
  `/recuperar/confirmar` (ruta **fijada por el backend**) y `/mi-cuenta`.
- **El header del storefront pasa a ser consciente de la sesión**: "Ingresar" para anónimo,
  nombre + "Cerrar sesión" para autenticado.
- **AC-5 se protege del lado del cliente.** El backend garantiza que contraseña incorrecta,
  cuenta inexistente y cuenta bloqueada son indistinguibles; el frontend puede arruinarlo con
  copy distinto, un error de campo, un redirect distinto o una propiedad de telemetría. Se
  planifica un test que **falla** si la UI las distingue.

## El hallazgo que gobierna el plan

El backend emite cookies **host-only** (sin `Domain`, decisión OQ-BE-6). El despliegue vigente
—`US-019`, dominio propio **diferido** por decisión del PO— usa subdominios
`*.up.railway.app`. Y `up.railway.app` **está en la Public Suffix List**:

```
$ curl -s https://publicsuffix.org/list/public_suffix_list.dat | grep -n railway
15370:// Railway Corporation : https://railway.com
15372:up.railway.app
```

Consecuencia: para el navegador, `dsm-web-….up.railway.app` y `dsm-api-….up.railway.app` no son
"dos subdominios del mismo sitio" — son **dos sitios distintos**. Por lo tanto, sin cambio de
topología:

1. Las cookies `SameSite=Lax` del API **no se envían** en los XHR del storefront. El login
   respondería `200`, la cookie se guardaría, y el `GET /auth/me` siguiente sería `401`.
2. `document.cookie` del storefront **no puede leer** `dsm_csrf` (cookie de otro host), así que
   el double-submit del backend (`X-CSRF-Token`) es imposible de cumplir ⇒ `/logout` y
   `/refresh` responderían `403` para siempre.

Y —lo que lo vuelve peligroso— **en local funciona igual de bien que si no existiera el
problema**: web y API son ambos `localhost` y las cookies ignoran el puerto. Un plan que no
resuelva esto pasa todos los tests, pasa la review, y falla el día del despliegue.

La respuesta de este change es el `rewrite` same-origin (`design.md` D1), acotado a
`/v1/auth/*`: el catálogo público y el panel siguen llamando al origen absoluto, con cero
cambio de comportamiento.

## Out of scope

- **Historial de compras y el área de cuenta completa** — `Deferred: US-015`.
- **Fusión del carrito guest con la cuenta al iniciar sesión** — fuera de v1 (US §4).
- **Login social / SSO y 2FA de cliente** — fuera de v1 (US §4).
- **Migrar el panel del dueño de `Bearer` a cookie de sesión.** El backend ya emite cookies
  también en `/admin/auth/login` con credenciales, pero ADR-0009 preserva el contrato
  `{ token }` + `Authorization` y el panel no requiere cambios.
  `Deferred: change propio de endurecimiento del panel — owner: Arquitecto`.
- **Login por credenciales en la pantalla `/admin/acceso`** (hoy usa el `bootstrapToken`).
  `Deferred: mismo change de endurecimiento del panel`.
- **Renderizado en servidor de contenido personalizado.** Decisión explícita, no omisión
  (`design.md` D3). Cuando US-015 necesite SSR del historial, ése es el momento de reabrir la
  topología de cookies, no antes.
- **Página de perfil editable, cambio de contraseña con sesión activa, borrado de cuenta** — el
  backend no expone endpoints para eso (sólo `GET /auth/me`).
- **Verificación de email** — no aplica por decisión de alcance de la US §10.

## Superficie consumida (contrato del backend hermano)

Todas las operaciones salen del **cliente generado** por orval desde
`apps/api/docs/api/openapi.yaml` (monorepo, sin espejo). Ninguna se escribe a mano.

| Operación (`operationId`) | Ruta | Sesión | Usada por |
|---|---|---|---|
| `registerCustomer` | `POST /v1/auth/register` | emite cookies | `/crear-cuenta` (AC-1, AC-6) |
| `loginCustomer` | `POST /v1/auth/login` | emite cookies | `/ingresar` (AC-2, AC-5, AC-10) |
| `refreshSession` | `POST /v1/auth/refresh` | cookie + `X-CSRF-Token` | mutator (single-flight) |
| `logoutCustomer` | `POST /v1/auth/logout` | cookie + `X-CSRF-Token` | header / `/mi-cuenta` (AC-3) |
| `getCurrentCustomer` | `GET /v1/auth/me` | cookie de access | bootstrap de sesión |
| `requestPasswordReset` | `POST /v1/auth/password-reset/request` | ninguna | `/recuperar` (AC-11) |
| `confirmPasswordReset` | `POST /v1/auth/password-reset/confirm` | ninguna | `/recuperar/confirmar` (AC-4, AC-7) |

**Ruta fijada por el backend, no negociable**: el mailer de producción construye el enlace como
`${PASSWORD_RESET_URL_BASE}/recuperar/confirmar?token=…`
(`apps/api/src/auth/mail/resend-password-reset-mailer.ts:32`). El frontend **debe** servir esa
ruta exacta; cualquier otro nombre rompe AC-4 en producción sin romper ningún test.

**Nota de estado**: el `Deferred: US-011` del `design.md` del backend quedó **obsoleto** — el
adapter real de Resend entró en US-014 por decisión del PO (2026-08-19). El email de
recuperación **sí llega**; el frontend no tiene que ocultar el flujo.

`POST /v1/admin/auth/login` es una superficie **distinta** (seam ADR-0009) y este change no la
toca.

## Criterios de aceptación (recorte del frontend)

Los 11 AC de la US son de la US completa; el backend cerró su mitad. Lo que este change debe
poder demostrar:

- [ ] **AC-1** — desde `/crear-cuenta`, un email nuevo crea la cuenta y el visitante queda con
      sesión activa **sin pasar por login**: el header muestra su nombre inmediatamente.
- [ ] **AC-2** — desde `/ingresar` con credenciales correctas se llega a `/mi-cuenta` y el
      header refleja la sesión.
- [ ] **AC-3** — "Cerrar sesión" invalida la sesión: `/mi-cuenta` deja de ser accesible y el
      header vuelve a "Ingresar".
- [ ] **AC-4** — el enlace del email abre `/recuperar/confirmar?token=…`, permite fijar la
      contraseña nueva y luego se puede iniciar sesión con ella.
- [ ] **AC-5** — contraseña incorrecta, cuenta inexistente y cuenta bloqueada producen un DOM
      **idéntico**, sin error de campo, sin redirect distinto y sin propiedad de telemetría que
      las distinga.
- [ ] **AC-6** — registrarse con un email ya existente muestra un mensaje que no confirma la
      existencia y no crea cuenta.
- [ ] **AC-7** — un token de reset vencido o ya usado muestra el mismo mensaje accionable
      ("pedí un link nuevo"), sin distinguir los dos casos.
- [ ] **AC-8** — la contraseña nunca sale del formulario: no aparece en la URL, ni en eventos de
      telemetría, ni en `console`, ni en `localStorage`/`sessionStorage`.
- [ ] **AC-9** — ningún token de sesión es legible por JS: el frontend no lee ni escribe
      `dsm_access`/`dsm_refresh`, y no persiste tokens en ningún almacenamiento.
- [ ] **AC-10** — un `429` muestra un mensaje accionable derivado de `Retry-After` y **no**
      reintenta automáticamente.
- [ ] **AC-11** — la solicitud de recuperación muestra siempre la misma confirmación, exista o
      no el email.

Además, dos garantías que no son AC de la US pero que este change introduce y debe proteger:

- [ ] **G-1** — ningún contenido personalizado se renderiza en servidor ⇒ ninguna respuesta
      cacheada puede contener datos de una persona.
- [ ] **G-2** — N respuestas `401` concurrentes producen **exactamente un** `POST /auth/refresh`.

## Secuencia — pre-requisito verificable, no una nota al pie

Esta misma sesión (`9a385021`) está **a mitad de ejecución de US-018**
(`openspec/changes/US-018-contacto-whatsapp-frontend-web/`, Fase 1 commiteada en `d51079b`,
**8 tasks abiertas**). US-018 crea el `SiteFooter`, lo monta en `app/(storefront)/layout.tsx` y
agrega el enlace de WhatsApp al header. US-014 FE necesita montar el `SessionProvider` en **ese
mismo layout** y el punto de entrada de cuenta en **ese mismo header**.

No es un merge conflict lo que se teme —eso Git lo grita— sino el modo silencioso que en este
repo **ya ocurrió tres veces**: un `git add -A` de una sesión barre archivos sin commitear de la
otra. Además hay una tercera sesión ejecutando QA de US-002 en `qa/`.

Por eso el plan abre con un pre-requisito **bloqueante y verificable por comando** (P1 en
`tasks.md`): US-018 FE sin tasks abiertas y `apps/web` sin cambios sin commitear. Al cerrar este
planning la condición está **en rojo** (8 tasks abiertas), lo cual es correcto: el orden es
US-018 → US-014 FE.

## Reutilización — lo que NO se construye

| Pieza existente | Uso en este change |
|---|---|
| `customFetch` + `FetchInit` (`src/lib/http/client.ts`) | Se **extiende** con `session`; el camino del panel no se toca |
| `AppError` / `mapProblemToAppError` / `isAppError` | Se usan tal cual (RFC 7807 ya mapeado) |
| `parseContract` + Zod generado | Se usan tal cual en el borde de red |
| `Button`, `Field`/`Input`, `ConfirmDialog` | Se usan tal cual (design-system §7.1/§7.2) |
| `react-hook-form` + `@hookform/resolvers` + `zod` | Patrón ya establecido en `ProductForm.tsx` |
| `track` / `PUBLIC_EVENTS` (`src/lib/observability/events.ts`) | Se extiende la unión; los eventos nuevos entran a `PUBLIC_EVENTS` |
| `e2e/support/api-stub.mjs` + `__reset?scope=` | Se extiende con la superficie `/v1/auth/*` |
| `jest-axe` + patrón de `a11y.test.tsx` | Se usa tal cual (no se agrega `@axe-core/playwright`) |
| Codegen orval (DTOs + Zod + MSW) | Se **regenera**; hoy está desactualizado (0 ops de auth) |
| `AdminGuard` / `adminSession` / `authToken` | **No se tocan**. El guard de cliente es otro (ver `design.md` D8) |

## Standards consultados

- `docs/base-standards.md` — principios, KISS/YAGNI, vocabulario prescriptivo.
- `docs/code/frontend-standards.md` §2 (estructura), §3.1/§3.2/§3.3 (codegen obligatorio),
  §4.1/§4.2/§4.3/§4.4 (auth, refresh coalescido, sign-out), §5 (errores), §7 (observabilidad),
  §8 (cliente HTTP), §9 (estado), §11.2/§11.3/§11.4/§11.5/§11.9 (patrones),
  §12.1/§12.2/§12.3/§12.4/§12.6 (seguridad), §13 (anti-patterns).
- `docs/code/frontend-next-standards.md` §1 (App Router), §2 (Server vs Client), §3 (caché
  explícita), §6 (Metadata API), §8 (env), §8.bis (security headers), §9 (testing), §10.
- `docs/architecture/api-standards.md` §2 (errores RFC 7807), §12 (rate limit, `Retry-After`).
- `docs/cross-cutting/security-standards.md` §3.3 (revocación), §6 (output encoding), §7.4
  (cookies), §7.5 (CSRF).
- `docs/quality/testing-standards.md` §14 (patrones de código de test).
- `docs/quality/qa-frontend-standards.md` §19 (a11y), §23.2 (RTL), §23.3 (MSW), §23.4
  (Playwright), §23.6 (axe), §23.8 (anti-patterns).
- `docs/delivery/git-workflow-standards.md` (rama / commits).
- `docs/ai/documentation-standards.md` §4, §8, §11.
- `docs/product/design-system.md` §7.1, §7.2, §7.10, §10.1, §10.2, §11.
- ADRs: `0005` (auth propia), `0009` (seam admin), `0010` (namespace), `0011` (store de refresh).

## Open questions

Cuatro. **Ninguna bloquea el arranque** salvo OQ-FE-1, que gobierna la Fase 0 entera.

### OQ-FE-1 — Topología de cookies (BLOQUEANTE de la Fase 0)

`[Resolved: 2026-08-20 — opción (a): rewrite same-origin]` Ratificado por el usuario. Es la única
que funciona en local, en Railway hoy y con dominio propio después, sin reabrir el change de
backend. La premisa (`up.railway.app` en la Public Suffix List, línea 15372) quedó **verificada de
forma independiente** antes de ratificar. T0.3 igual la prueba con `context.cookies()` antes de
escribir UI: si falla, `/develop` para y devuelve la pregunta con evidencia.

Las cookies host-only del API son inservibles desde un origen que el navegador considera otro
sitio, y `up.railway.app` está en la PSL.

| Opción | Qué implica | Costo |
|---|---|---|
| **(a) `rewrite` de Next para `/v1/auth/*`** ← **recomendada** | El navegador sólo habla con el origen del sitio; cookies first-party; CSRF legible; CORS irrelevante para esa superficie | Un salto extra por request de auth (sólo auth); una env server-only nueva; hay que **probar** que el `Set-Cookie` atraviesa el rewrite (T0.3 lo prueba antes de construir nada encima) |
| (b) El backend agrega `Domain=.dsm.com.ar` a las cookies | Reabre un change **cerrado** (44/44) y revierte OQ-BE-6; y **no arregla el hoy**: en `*.up.railway.app` siguen siendo sitios distintos, así que sólo funcionaría después del dominio propio | Rework de backend + sigue bloqueado hasta el dominio |
| (c) Diferir US-014 FE hasta que exista dominio propio | Sin trabajo perdido | Bloquea US-015 y la capacidad 8 del PRD por tiempo indefinido; el dominio está `Deferred` en US-019 sin fecha |

**Recomendación: (a)**. Es la única que funciona en las tres topologías (local, Railway interino,
dominio propio) sin tocar el backend, y hace que el frontend deje de depender de una decisión de
infraestructura que aún no está tomada.

### OQ-FE-2 — Alcance de `/mi-cuenta` en esta US

`[Resolved: 2026-08-20 — opción (b): página mínima]` El usuario eligió primero el área completa; al
verificarlo se encontró que **no es construible hoy**: el contrato no expone ningún endpoint de
pedidos (0 coincidencias) y el historial vive en US-015, que sigue `Ready` con su backend por hacer.
Con esa evidencia el usuario ratificó la página mínima —perfil, alta, cerrar sesión y el historial
anunciado como próximo—, y US-015 la completa con sus propios endpoints. No es una preferencia de
alcance: era una dependencia faltante.

AC-2 dice "puede acceder a las secciones de su cuenta", pero el backend sólo expone
`GET /auth/me` y el historial es US-015.

| Opción | Qué se entrega |
|---|---|
| (a) Sin página: la sesión sólo se ve en el header | Menos superficie, pero AC-2 queda sin destino demostrable y el login no tiene a dónde ir |
| **(b) `/mi-cuenta` mínima** ← **recomendada** | Nombre, email, fecha de alta, "Cerrar sesión" y un placeholder honesto de "Tus compras — próximamente". Destino real para AC-2, ~0.4 h |
| (c) Área de cuenta completa | Fuera de alcance; depende de US-015 |

**Recomendación: (b)**.

### OQ-FE-3 — Indexabilidad de las páginas de auth

`[Resolved: 2026-08-20 — opción (a)]` Ratificado por el usuario: `/ingresar` y `/crear-cuenta`
indexables —el alta es superficie de conversión para una tienda sin reputación digital, y esconderla
no aporta seguridad—; `/recuperar/confirmar` y `/mi-cuenta` con `noindex`, la primera porque lleva un
token en la query.

ADR-0010 declara la raíz pública e indexable y `/admin/*` con `noindex`. Las páginas de cuenta
del cliente son públicas pero no son contenido.

| Opción | Consecuencia |
|---|---|
| **(a) `/ingresar` y `/crear-cuenta` indexables; `/recuperar/confirmar` y `/mi-cuenta` con `noindex`** ← **recomendada** | "Crear cuenta" es superficie de conversión y confianza (PRD §1.2, cero reputación digital); esconderla no aporta seguridad. La confirmación lleva un **token en la query** y jamás debe indexarse |
| (b) Todas con `noindex` | Consistente y conservador, pero renuncia a una landing legítima |
| (c) Todas indexables | Inaceptable: publica URLs con token de reset |

**Recomendación: (a)**. Además, la página de confirmación borra el token de la URL con
`history.replaceState` apenas lo lee, para que no viaje en `Referer`, historial ni telemetría.

### OQ-FE-4 — Cómo se descubre la sesión al cargar la página

`[Resolved: 2026-08-20 — opción (a)]` Ratificado por el usuario: marca no-secreta en el cliente y
consulta a `/auth/me` sólo si está presente. El visitante anónimo —la mayoría— no genera ningún
request de auth, no consume rate-limit y el header no parpadea.

`GET /auth/me` es la única forma de saber si hay sesión, pero llamarlo siempre significa que
**todo visitante anónimo** —que es la enorme mayoría— paga un request y un `401` por carga.

| Opción | Consecuencia |
|---|---|
| **(a) Marca no-secreta (`dsm.session=1` en `localStorage`) puesta al login y borrada al logout; `/auth/me` sólo si la marca existe** ← **recomendada** | Cero llamados de auth para el anónimo; sin flash de "Ingresar → tu nombre". La marca es una **pista**, no autoridad: el backend sigue decidiendo |
| (b) `GET /auth/me` siempre al montar | Simple, pero un `POST /auth/refresh` fallido por visitante anónimo con sesión vencida, ruido en métricas y consumo del presupuesto de rate-limit |
| (c) Probar sólo al entrar a rutas protegidas | El header nunca sabría si mostrar "Mi cuenta" |

**Recomendación: (a)**.

## Referencias

- US: `docs/user-stories/US-014-registro-login.md` (AC-1…AC-11, §7, §8, §9, §10).
- Change hermano (cerrado): `openspec/changes/US-014-registro-login-backend/` (`design.md`,
  `proposal.md`).
- Contrato: `apps/api/docs/api/openapi.yaml` (tag `customer-auth`).
- ADRs: `0005-own-jwt-authentication.md`, `0009-admin-auth-seam-us001.md`,
  `0010-url-namespace-storefront-vs-admin.md`, `0011-*` (store de refresh con rotación).
- Changes relacionados: `US-018-contacto-whatsapp-frontend-web` (secuencia),
  `US-019-provision-plataforma-cloud-infrastructure` (topología / dominio).
- Diseño: `docs/product/design-system.md` (sin Figma — skill `fe-design-without-figma`).
