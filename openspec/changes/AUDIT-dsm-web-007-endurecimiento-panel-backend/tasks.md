---
parent-us: null
discipline: backend
variant: null
language: es
audit-derived: true
---

# Endurecimiento del panel — backend · Tasks

> Cada task es closure-grade: `Exit criterion:` observable + `Verify:` con el comando exacto.
> Comandos desde la raíz del repo. `pnpm --filter @dsm/api test -- --testPathPattern=<p>`
> corre Jest en forma terminante (F49). El typecheck de `@dsm/api` tarda ~1 s.
>
> **Estimación**: **1,8 h AI-asistido** / ~3,5 h tradicional (5 tasks). Es chico porque la
> mitad del trabajo ya existe: `setSessionCookies` emite las tres cookies desde US-014 y el
> seed ya crea la cuenta admin. Lo que falta es que el guard las lea y que el camino de
> `bootstrapToken` las emita.
>
> **ORDEN OBLIGATORIO**: este change **antes** que
> `AUDIT-dsm-web-007-endurecimiento-panel-frontend-web`. Al revés, el panel queda
> inaccesible (el FE mandaría cookie contra un guard que sólo lee `Bearer`).

## Traceability matrix

| Finding | Título | Tasks | Estado |
|---|---|---|---|
| `AUDIT-DSM-WEB-007` | Token de admin en `sessionStorage` en vez de cookie `httpOnly` | T1.1, T1.2 (mitad de backend) | **en este change** (fase expand) |
| — | Apagar `Authorization` y sacar el token del cuerpo | — | **deferred → follow-up de contracción**, después del change de FE |

## Pre-requisitos

- [ ] **`apps/api` limpio y typecheck verde** (baseline conocido).
  **Verify**: `git status --porcelain apps/api` vacío **y** `pnpm --filter @dsm/api typecheck`
- [ ] **US-014 backend presente**: `auth/cookies.ts` expone `setSessionCookies` y
  `deriveCsrfToken`, y `SessionService.issue` funciona.
  **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern='cookies|session.service'`

---

## Fase 1: El guard acepta cookie y el bootstrap la emite — 1,0 h

- [ ] T1.1 `AdminGuard` lee la cookie de acceso, con precedencia sobre el header
  - **Pattern**: renombrar `extractBearer` a `extractToken` y consultar **primero** la
    cookie `dsm_access` (constante ya exportada por `auth/cookies.ts`), después el header.
    La precedencia es a favor de la cookie porque es la que un script inyectado no puede
    leer — `per security-standards.md §7.4`.
    ```ts
    private extractToken(req: Request): string | null {
      const cookie = (req as Request & { cookies?: Record<string,string> }).cookies?.[ACCESS_COOKIE];
      if (typeof cookie === 'string' && cookie.length > 0) return cookie;
      return this.extractBearer(req);   // ventana de convivencia (design.md D1)
    }
    ```
  - **Exit criterion**: una request con **sólo** la cookie `dsm_access` de un JWT
    `role=admin` **autoriza**; una con **sólo** `Bearer` sigue autorizando (nada se rompe);
    con **las dos** presentes y distintas, se usa la **cookie** —probado con una cookie
    válida y un header de rol `customer`, que debe dar **403 y no 200**—; sin ninguna, 401.
    Un JWT válido con `role=customer` en la cookie da **403**, no 401.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern='admin-guard|e2e-rbac'`
    (`admin-guard.spec.ts` gana 4 casos: sólo cookie → pasa; sólo header → pasa; ambos con
    la cookie de admin y el header de customer → **403** (prueba la precedencia, no sólo que
    lea la cookie); cookie con `role=customer` → 403. Y el barrido de `e2e-rbac` corre **sin
    editarse**: sus 16 rutas siguen dando 401 sin token y 403 con token de cliente)

- [ ] T1.2 El camino de `bootstrapToken` emite las cookies de sesión
  - **Pattern**: el `if (dto.email && dto.password)` ya llama a `sessions.issue` +
    `setSessionCookies`; se hace lo mismo en la rama del bootstrap, con un sujeto sintético.
    **Sin refresh persistido**: ADR-0011 exige una fila en `refresh_tokens` con
    `customer_id`, y el bootstrap no tiene cliente (`design.md` D4).
    ```ts
    const session = await this.sessions.issue({ id: 'admin-bootstrap', role: 'admin' }, { persistRefresh: false });
    ```
  - **Exit criterion**: `POST /v1/admin/auth/login` con `bootstrapToken` válido devuelve
    **200** con `{ token }` —**el contrato del cuerpo no cambia**— **y** emite
    `Set-Cookie: dsm_access` (`HttpOnly`, `SameSite=Lax`, `Path=/`) más `dsm_csrf`
    (legible). **No** emite `dsm_refresh`: no hay fila que respaldarlo. Un
    `bootstrapToken` inválido sigue dando 401 **sin emitir cookie alguna**, y con
    `ADMIN_AUTH_ENABLED=false` sigue dando 503.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern='e2e-admin-auth|admin-token'`
    (casos nuevos: bootstrap válido → 200 con `token` en el cuerpo **y** `dsm_access` +
    `dsm_csrf` en `Set-Cookie`, **sin** `dsm_refresh`; bootstrap inválido → 401 y
    `Set-Cookie` **ausente** —una cookie emitida en un 401 sería un bug de sesión—;
    `ADMIN_AUTH_ENABLED=false` → 503 sin cookie)

---

## Fase 2: La ventana de convivencia, probada de punta a punta — 0,5 h

- [ ] T2.1 El panel actual sigue funcionando sin cambiar una línea
  - **Exit criterion**: el flujo completo del panel con el mecanismo de **hoy** (login por
    bootstrap → `Authorization: Bearer` en las llamadas admin) sigue verde. Es la garantía
    que hace este change desplegable solo: si algo de esto se rompe, la fase expand está
    mal hecha y el frontend no puede migrar sobre ella.
  - **Verify**: `pnpm --filter @dsm/api test -- --ci --testPathPattern='e2e-products|e2e-categories|e2e-admin-auth|e2e-rbac|e2e-auth-admin-credentials'`
    (todas **sin editar** salvo las que T1.1/T1.2 amplían)

- [ ] T2.2 Autorizar con la cookie funciona end-to-end sobre una ruta admin real
  - **Exit criterion**: hacer login por bootstrap, tomar **sólo** la cookie de la respuesta
    (descartando el `token` del cuerpo) y llamar a `GET /v1/admin/products` con esa cookie
    devuelve **200**. Es la prueba de que el frontend va a poder migrar: no alcanza con que
    el guard lea la cookie en un unit test, tiene que funcionar sobre el ciclo completo con
    `cookie-parser` del borde y el JWT real.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=e2e-admin-cookie-auth`
    (nuevo `src/auth/e2e-admin-cookie-auth.spec.ts`: login → extrae `dsm_access` del header
    `set-cookie` → `GET /v1/admin/products` mandando **sólo** esa cookie → 200; y la misma
    llamada sin cookie ni header → 401)

---

## Fase 3: Contrato y documentación — 0,3 h

- [ ] T3.1 El contrato declara los dos portadores
  - **Exit criterion**: `apps/api/docs/api/openapi.yaml` declara un `securityScheme` de
    tipo `apiKey in: cookie name: dsm_access` **además** del `adminBearer` existente, y las
    operaciones bajo `/admin/*` aceptan **cualquiera de los dos** (lista de `security` con
    dos entradas, que en OpenAPI significa OR). `POST /admin/auth/login` documenta el
    `Set-Cookie` de su respuesta 200. Lintea limpio.
  - **Verify**: `pnpm dlx @stoplight/spectral-cli lint apps/api/docs/api/openapi.yaml --ruleset .spectral.yaml --fail-severity=warn`
    **y** `python3 -c "
import yaml; d=yaml.safe_load(open('apps/api/docs/api/openapi.yaml'))
sec=d['components']['securitySchemes']
assert any(v.get('in')=='cookie' for v in sec.values()), 'falta el scheme de cookie'
op=d['paths']['/admin/products']['get']
assert len(op.get('security', d.get('security'))) == 2, 'las rutas admin deben aceptar los dos portadores'
print('contrato declara cookie + bearer')"`

- [ ] T3.2 ADR-0009 registra el endurecimiento
  - **Exit criterion**: `docs/architecture/decisions/0009-admin-auth-seam-us001.md` gana una
    nota que dice: el seam sigue vigente (el `bootstrapToken` no se reemplaza), lo que cambia
    es **cómo se transporta** el JWT emitido — cookie `httpOnly` con `Bearer` aceptado
    durante la convivencia—, cuál es el finding que lo motivó (`AUDIT-DSM-WEB-007`), y que la
    contracción queda pendiente. **No** se abre un ADR nuevo: no hay decisión nueva, hay una
    consecuencia de ADR-0011 y ADR-0013 aplicada a una superficie que había quedado afuera.
  - **Verify**: `rg -q "AUDIT-DSM-WEB-007" docs/architecture/decisions/0009-admin-auth-seam-us001.md && rg -q "httpOnly" docs/architecture/decisions/0009-admin-auth-seam-us001.md`

---

## Verification (suite-level)

- [ ] Type-check limpio: `pnpm --filter @dsm/api typecheck`
- [ ] Lint limpio: `pnpm --filter @dsm/api lint`
- [ ] Suite de auth completa: `pnpm --filter @dsm/api test -- --ci --testPathPattern=auth`
- [ ] **Sin regresión en el panel** (la garantía de la fase expand):
      `pnpm --filter @dsm/api test -- --ci --testPathPattern='e2e-products|e2e-categories|e2e-rbac'`
- [ ] Contrato publicado lintea limpio.
- [ ] **El change de frontend puede empezar**: T2.2 verde es su pre-requisito.
