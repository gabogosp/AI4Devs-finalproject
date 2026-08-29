---
parent-us: null
discipline: frontend-web
variant: null
language: es
audit-derived: true
---

# Endurecimiento del panel — frontend · Tasks

> Cada task es closure-grade: `Exit criterion:` observable + `Verify:` con el comando exacto.
> Comandos desde la raíz. `pnpm --filter @dsm/web test` es `vitest run` (terminante, F49) y
> `test:e2e` es Playwright (one-shot). El typecheck de `@dsm/web` es rápido.
>
> **Estimación**: **2,7 h AI-asistido** / ~5,5 h tradicional (7 tasks, suma de las fases:
> 1,0 + 0,8 + 0,6 + 0,3). El grueso no es la
> migración —el modelo de cookie + CSRF ya existe para la sesión de cliente— sino el E2E de
> topología, que es el único test capaz de detectar el defecto que sólo aparece en producción.
>
> **ORDEN OBLIGATORIO**: `AUDIT-dsm-web-007-endurecimiento-panel-backend` **primero**. Si
> esto se despliega antes, el panel manda cookie contra un guard que sólo lee `Bearer` y
> devuelve 401 en todas sus rutas.

## Traceability matrix

| Finding | Título | Tasks | Estado |
|---|---|---|---|
| `AUDIT-DSM-WEB-007` | Token de admin en `sessionStorage` en vez de cookie `httpOnly` | T1.1, T1.2, T2.1, T2.2, T3.1 | **en este change** (fase de migración) |
| — | Sacar el `{ token }` del cuerpo de la respuesta de login | — | **deferred → follow-up de backend**, cuando este change confirme que nadie lo lee |

## Pre-requisitos

- [ ] **El change de backend está construido**: el guard acepta cookie y el bootstrap la
  emite. Su T2.2 es el pre-requisito concreto — sin eso, esto no puede funcionar.
  **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern='e2e-admin-cookie-auth|admin-guard'`
- [ ] **`apps/web` limpio, lint y typecheck verdes.**
  **Verify**: `git status --porcelain apps/web` vacío **y** `pnpm --filter @dsm/web typecheck && pnpm --filter @dsm/web lint`
- [ ] **`API_INTERNAL_ORIGIN` en el `.env` local** — sin ella el rewrite apunta a `undefined`
  y el panel devuelve 404, el mismo síntoma que ADR-0013 describe para el login.
  **Verify**: `grep -q "^API_INTERNAL_ORIGIN=" .env`

---

## Fase 1: Topología y borde HTTP — 1,0 h

- [ ] T1.1 Extender el rewrite same-origin a `/v1/admin/*` (**el gate de todo el change**)
  - **Pattern**: una entrada más en el array de `rewrites()` de `next.config.mjs`, junto a
    las de auth y cart. Declarativo: no agrega un `fetch` ni un route handler, así que la
    regla de un solo cliente HTTP (F48) queda intacta — `per ADR-0013`.
    ```js
    { source: '/v1/admin/:path*', destination: `${apiOrigin()}/v1/admin/:path*` },
    ```
  - **Exit criterion**: las tres superficies con cookies (`/v1/auth/*`, `/v1/cart/*`,
    `/v1/admin/*`) se resuelven contra `API_INTERNAL_ORIGIN` desde el origen del sitio.
    `API_INTERNAL_ORIGIN` sigue siendo **server-only** (sin `NEXT_PUBLIC_`). Las dos
    entradas existentes quedan **idénticas**.
  - **Verify**: `pnpm --filter @dsm/web test -- rewrites`
    (el spec existente de `rewrites.test.ts` gana el caso de admin: el array contiene **las
    tres** entradas con el destino derivado de `API_INTERNAL_ORIGIN` y ninguna lleva
    `NEXT_PUBLIC_`) — la prueba real de que la cookie vuelve es T3.1

- [ ] T1.2 Tercer sujeto de CSRF y el cliente deja de mandar `Authorization`
  - **Pattern**: agregar `admin: 'dsm_csrf'` al mapa de `CSRF_COOKIES` (mismo patrón con el
    que US-007 agregó el segundo sujeto) y, en `client.ts`, tratar `session: 'admin'` como
    ya se trata `'customer'`: URL relativa, `credentials: 'include'`, header de
    double-submit en las escrituras. **El `Authorization` deja de inyectarse.** — `per
    security-standards.md §7.5` y `per frontend-standards.md §11.1`.
  - **Exit criterion**: una llamada con `session: 'admin'` sale con URL **relativa**,
    `credentials: 'include'` y —en escrituras— `x-csrf-token` con el valor de `dsm_csrf`;
    **no** lleva header `Authorization`. Sigue habiendo **un solo** `document.cookie.match`
    en toda la app. El comportamiento de `session: 'customer'` y de las llamadas públicas
    queda **sin cambios** (sus specs corren sin editarse). **Fail closed** se mantiene: sin
    la cookie de CSRF la escritura sale sin header y el 403 se propaga.
  - **Verify**: `pnpm --filter @dsm/web test -- 'csrf|client'`
    (casos nuevos: `session:'admin'` + `POST` → URL relativa, `credentials:'include'`, header
    de CSRF presente y **`Authorization` ausente** —el assert de ausencia es el que prueba la
    migración—; `session:'admin'` + `GET` → sin header de CSRF; los casos de `'customer'` y
    públicos pasan sin editar) **y**
    `test $(rg -c "document\.cookie" apps/web/src --glob '!**/*.test.*' | wc -l | tr -d ' ') -eq 1`

---

## Fase 2: La sesión deja de vivir en la app — 0,8 h

- [ ] T2.1 `adminSession` sin `sessionStorage` y `authToken.ts` eliminado
  - **Pattern**: la sesión pasa a ser una propiedad del navegador. `isAuthenticated()`
    optimista, reaccionando al 401 con el mecanismo que ya existe (`design.md` D3).
  - **Exit criterion**: **`sessionStorage` no aparece en `adminSession.ts`** y
    `apps/web/src/lib/http/authToken.ts` **no existe**. `login()` hace el POST y **no
    persiste nada** —la cookie la setea el backend—; `restore()` **se elimina** (no hay nada
    que rehidratar) y sus llamadores se limpian; `signOut()` deja de borrar memoria. Ningún
    archivo de `apps/web` importa `authToken`.
  - **Verify**: `pnpm --filter @dsm/web typecheck && pnpm --filter @dsm/web test -- adminSession`
    **y** `test ! -f apps/web/src/lib/http/authToken.ts`
    **y** `test -z "$(rg -l 'authToken|sessionStorage' apps/web/src/features/auth apps/web/src/lib/http)"`
    (los tres asserts de **ausencia** son el criterio: si algo de eso sobrevive, el token
    sigue en la app)

- [ ] T2.2 El guard del panel redirige al perder la sesión
  - **Exit criterion**: una llamada del panel que devuelve **401** lleva a
    `/admin/acceso`, sin pantalla en blanco ni bucle de redirección. Es la contraparte de
    haber elegido `isAuthenticated()` optimista: el 401 es la señal autoritativa. Reusa el
    `kind: 'unauthorized'` de `AppError`, **no** agrega un mecanismo nuevo.
  - **Verify**: `pnpm --filter @dsm/web test -- 'adminGuard|AdminLayout'`
    (con el service mockeado devolviendo `unauthorized`: se navega a `/admin/acceso` **una**
    sola vez —espía del router con 1 llamada, no N: un bucle sería el defecto obvio acá—; con
    200 no se navega)

---

## Fase 3: La prueba que sólo un E2E puede dar — 0,6 h

- [ ] T3.1 La cookie del panel vuelve, verificado contra la app construida
  - **Pattern**: espejo de `e2e/auth-topology.spec.ts`, el precedente que ADR-0013 dejó: se
    asserta sobre `response.status()` y `context.cookies()`, **nunca sobre el DOM**. Es el
    único test capaz de detectar el defecto que aparece sólo en producción.
  - **Exit criterion**: contra la app **construida**, el login del panel desde el origen del
    sitio devuelve 200; `context.cookies()` muestra `dsm_access` como **`httpOnly` en el host
    del sitio** y `dsm_csrf` legible; una llamada posterior a una ruta admin devuelve 200 (la
    cookie volvió); y la misma llamada en un contexto **nuevo** devuelve 401 (el 200 anterior
    no fue un falso positivo). **Y `sessionStorage` está vacío** de cualquier clave de DSM
    tras el login — la prueba directa de que el finding está cerrado.
  - **Verify**: `pnpm --filter @dsm/web test:e2e -- admin-cookie-topology`
    (nuevo `e2e/admin-cookie-topology.spec.ts`)

- [ ] T3.2 Sin regresión en las superficies que comparten el borde
  - **Exit criterion**: los E2E de topología de auth y de cart siguen verdes (el rewrite se
    tocó), el panel sigue sin indexarse, y las páginas indexables siguen respondiendo con su
    contenido en el HTML del servidor.
  - **Verify**: `pnpm --filter @dsm/web test:e2e -- 'auth-topology|cart-topology|admin-noindex|storefront-home|pdp-ssr'`

---

## Fase 4: Cierre — 0,3 h

- [ ] T4.1 Marcar el finding y dejar el follow-up de contracción
  - **Exit criterion**: `docs/_index/audit-findings.yaml` pone `AUDIT-DSM-WEB-007` en
    `status: addressed` con la fecha. Y queda anotado el follow-up pendiente: **sacar el
    `{ token }` del cuerpo** de `POST /v1/admin/auth/login` y quitar la aceptación de
    `Bearer` del guard — la fase de contracción, que sólo es segura una vez que este change
    demostró que nadie lee el token.
  - **Verify**: `python3 -c "
import yaml; d=yaml.safe_load(open('docs/_index/audit-findings.yaml'))
f=[x for x in d if x['id']=='AUDIT-DSM-WEB-007'][0]
assert f['status']=='addressed', f['status']; print('finding cerrado')"`
    **y** `rg -q "contracción|Bearer" docs/audits/follow-ups/AUD-DSM-WEB-007-contraccion.md`

---

## Verification (suite-level)

- [ ] Type-check y lint limpios: `pnpm --filter @dsm/web typecheck && pnpm --filter @dsm/web lint`
- [ ] Suite de Vitest completa: `pnpm --filter @dsm/web test`
- [ ] E2E de topología: `pnpm --filter @dsm/web test:e2e -- 'admin-cookie-topology|auth-topology|cart-topology'`
- [ ] **El token no está en la app**, verificado por ausencia:
      `test ! -f apps/web/src/lib/http/authToken.ts && test -z "$(rg -l 'sessionStorage' apps/web/src/features/auth)"`
- [ ] Verificación manual en `dev`: login al panel, recargar (la sesión sobrevive sin
      `sessionStorage`), operar el catálogo, cerrar sesión. Queda registrado en el PR.
