---
parent-us: US-014
discipline: frontend-web
variant: null
language: es
created: 2026-08-20
---

# US-014 Frontend Web — Tasks

> **El riesgo va primero.** La Fase 0 no construye pantallas: prueba que la topología de
> cookies funciona (T0.3) **antes** de que exista una sola línea de UI encima. Si esa prueba
> falla, el plan se detiene ahí con evidencia, en vez de descubrirlo el día del despliegue.
>
> Cada task es closure-grade: atómica, con `Pattern:` (snippet mínimo + cita de estándar),
> `Exit criterion:` observable y `Verify:` con el comando exacto — **terminante** (F49: el
> script `test` del paquete es `vitest run`; **macOS no tiene binario `timeout`**, así que
> ningún `Verify:` lo usa) y que **falla si el criterio no se cumple** (F50: se ejercita el
> comportamiento; los greps de contenido excluyen los artefactos de este plan, F57).
> Comandos desde la **raíz del repo**.
>
> **Estimación dual**: **~10.1 h AI-asistido / ~20 h tradicional** (24 tasks + 2
> pre-requisitos; las horas por task son AI-asistido). La US §7 presupuesta **FE-US-014 en
> 8-12 h tradicional**: **se excede ~8 h**, con causa nombrada en §"Por qué el plan excede el
> presupuesto" al final.

## Matriz de trazabilidad (AC → tasks)

| AC | Título | Task IDs | Estado |
|---|---|---|---|
| AC-1 | Registro con login inmediato | T0.1, T1.1, T1.2, **T2.1**, T4.1 | construido acá |
| AC-2 | Login con credenciales válidas | T1.1, T1.2, T1.3, **T2.2**, T2.6, T4.1 | construido acá |
| AC-3 | Logout | T0.5, T1.1, **T2.3**, T4.1 | construido acá |
| AC-4 | Recuperación de contraseña | T2.4, **T2.5**, T4.2 | construido acá |
| AC-5 | Login inválido con mensaje genérico | **T2.2** (implementación), **T3.1** (prueba), T5.1 (telemetría) | construido + protegido acá |
| AC-6 | Registro con email ya existente | **T2.1**, T4.1 | construido acá |
| AC-7 | Token de reset expirado o usado | **T2.5**, T4.2 | construido acá |
| AC-8 | La contraseña nunca se expone | T2.1, T2.2, T2.5, **T3.3** | garantizado del lado FE acá |
| AC-9 | Sesión segura por cookie | T0.3, T0.4, T0.5, **T3.3**, T4.1 | garantizado del lado FE acá |
| AC-10 | Límite de intentos | **T2.2**, T2.1, T2.4 | manejo FE construido acá |
| AC-11 | Reset de email inexistente | **T2.4**, T4.2 | construido acá |
| **G-1** | Nada personalizado se renderiza en servidor | T0.4, **T3.2** | garantía nueva de este change |
| **G-2** | N × 401 concurrentes ⇒ 1 refresh | **T0.6** | garantía nueva de este change |

**Cobertura no-AC del `design.md` (F51)**: D1 → T0.3 · D2 → T0.4 · D3 → T0.4 + T3.2 ·
D4 → T0.6 · D5 → T0.5 · D6 → T0.1 + T1.1 · D7 → T1.2 · D8 → T2.6 · D9 → T2.2 + T3.1 ·
D10 → T2.1, T2.2, T2.4 · D11 → T2.1…T2.6 + T4.2 · D12 → T5.1 · D13 → T2.1…T2.5 + T3.3 + T5.2 ·
secuencia vs US-018 → P1 · sin `loading.tsx` en `(storefront)` → Verification suite-level ·
a11y §11 → T3.4 · documentación y despliegue → T5.3.

**Diferidos declarados**: ~~`AppError` con `kind: 'rateLimited'`~~ → **cancelado**: otra sesión
lo landeó el 2026-08-20 mientras se escribía este plan (`design.md` D10, nota de
reconciliación) · panel del dueño migrado a cookies →
`Deferred: change de endurecimiento del panel — owner: Arquitecto` · SSR de contenido
personalizado → `Deferred: US-015` (con D3 reabierta explícitamente) · área de cuenta e
historial → `Deferred: US-015` · `@axe-core/playwright` → `Deferred:` si QA lo pide (hoy
jest-axe cubre §19.2) · fusión de carrito guest ↔ cuenta → fuera de v1 (US §4).

---

## Pre-requisitos

- [x] **P1 — BLOQUEANTE: US-018 FE cerrada y `apps/web` sin cambios sin commitear**

  > **DESVIACIÓN AUTORIZADA (2026-08-22, PO)** — el gate sigue **en rojo** y no se marca verde.
  > Estado al ejecutar: `apps/web` **limpio** (la condición que protege del barrido de trabajo
  > sin commitear, que es el peligro agudo, **se cumple**), pero US-018 FE tiene **8 tasks
  > abiertas** y su sesión editó el header hace tres commits.
  >
  > El PO autorizó ejecutar **sólo la Fase 0** (T0.1–T0.6), que es plomería de red y **no toca
  > `app/(storefront)/layout.tsx` ni el header**. La ejecución **para antes de T1.3**, que es la
  > task que los monta. Acordado con la sesión de US-018 por mensaje, con la lista de archivos.
  >
  > Esto es un alcance parcial deliberado, contrario a la instrucción "no scopea parcial" de este
  > mismo gate: se registra acá para que quede como decisión y no como olvido. **P1 se re-corre
  > entero antes de la Fase 1.**
  >
  > **Re-corrido 2026-08-22 durante la Fase 0: EN VERDE.** US-018 FE cerró 14/14 (último commit
  > `aef893a`) y `apps/web` está limpio, así que las dos condiciones se cumplen y la desviación
  > deja de aplicar. El layout y el header quedan disponibles: la Fase 1 puede montar el
  > `AccountMenu` sin restricción de alcance.
      (`design.md` §Riesgos, `proposal.md` §Secuencia)

  Esta misma sesión (`9a385021`) tiene US-018 a mitad de ejecución y US-014 FE toca **el mismo**
  `app/(storefront)/layout.tsx` y **el mismo** header. Una tercera sesión ejecuta QA de US-002
  en `qa/`. El modo de falla no es el merge conflict —eso Git lo grita— sino el silencioso: un
  `git add -A` de una sesión barre archivos sin commitear de la otra. **Ya pasó tres veces en
  este repo.**

  - **Exit criterion**: `openspec/changes/US-018-contacto-whatsapp-frontend-web/tasks.md` no
    tiene ninguna task abierta **y** `git status --porcelain -- apps/web` no devuelve ninguna
    línea. Si cualquiera de las dos falla, `/develop-frontend-web` **para acá** y reporta — no
    negocia, no scopea parcial, no "coordina sobre la marcha".
  - **Verify**:
    ```bash
    test -z "$(git status --porcelain -- apps/web)" \
      && test "$(grep -c '^- \[ \] \*\*T' openspec/changes/US-018-contacto-whatsapp-frontend-web/tasks.md)" -eq 0 \
      && echo "OK — US-018 FE cerrada y apps/web limpio"
    ```
    *(el grep apunta al `tasks.md` de **otro** change, nunca a los artefactos de este plan — F57)*
  - **Estado al cerrar el planning (2026-08-20, verificado con el comando de arriba)**: **en
    rojo por partida doble**, y la segunda razón apareció *durante* el planning:
    1. US-018 FE tiene **8 tasks abiertas**.
    2. `apps/web` **dejó de estar limpio**: otra sesión modificó
       `src/lib/http/errors.ts` y `src/lib/http/client.ts` sin commitear (agregó
       `AppError.kind: 'rateLimited'` + lectura del header `retry-after`). Son **exactamente**
       los archivos que modifican T0.4, T0.5 y T0.6.

    Es la demostración en vivo de por qué P1 existe. El orden es US-018 → (commit del cambio
    ajeno) → US-014 FE, y el gate se re-corre al ejecutar.
  - **Bonus de ese cambio ajeno**: `AppError` ya distingue `429` con `retryAfterSeconds`, así
    que AC-10 se resuelve consumiéndolo (T2.1/T2.2/T2.4) y el deferral que este plan iba a
    declarar **queda cancelado** (`design.md` D10, nota de reconciliación).

- [x] **P2 — BLOQUEANTE: OQ-FE-1 ratificada** (`proposal.md` §Open questions)

  La Fase 0 entera materializa la opción elegida. Arrancar sin ratificación significa construir
  el borde de red dos veces.

  - **Exit criterion**: `proposal.md` §OQ-FE-1 tiene una línea `Ratificada: {opción} — {rol},
    {fecha}`. Si la opción ratificada **no** es (a), este plan se regenera (`/plan-frontend-web-ticket
    US-014 --regenerate`) — no se "adapta sobre la marcha".
  - **Verify**:
    ```bash
    grep -qE '^`?\[Resolved: [0-9]{4}-[0-9]{2}-[0-9]{2} — opción \(a\)' openspec/changes/US-014-registro-login-frontend-web/proposal.md \
      && echo "OK — OQ-FE-1 ratificada en la opción (a)" || { echo "FALTA ratificación de OQ-FE-1"; exit 1; }
    ```
    *(única excepción a F57: el grep apunta a este plan **a propósito**, porque la ratificación
    se escribe acá; el patrón es un ancla de línea, no una mención suelta)*
    *(corregido 2026-08-22: el patrón original buscaba una línea `^Ratificada: ` que la
    convención del repo no usa — la ratificación se escribe `[Resolved: {fecha} — {opción}]`.
    Daba **rojo con la decisión ya tomada**: comprobaba el formato esperado en vez del hecho,
    la misma clase de defecto que F50. El ancla nuevo exige fecha **y** que la opción sea la
    (a), así que sigue fallando si se ratificara otra — que es cuando el plan debe regenerarse)*

---

## Fase 0: Cimiento de red y prueba de topología — `design.md` D1, D2, D3, D5, D6

> Es la fase cero: no entrega UI. Nada de la Fase 1 puede empezar antes de que T0.3 pase.

- [x] **T0.1** Regenerar los artefactos derivados del contrato (DTOs + Zod + MSW) (0.4 h)

  Hoy el contrato declara las 7 operaciones de `customer-auth` y el cliente generado no conoce
  ninguna (`grep -c loginCustomer src/api/generated/endpoints.ts` → `0`). El gate
  `frontend-codegen-fresh` no lo atrapó porque filtra por paths de PR y este repo integra por
  rama sin PR por change.

  - **Pattern**: `pnpm --filter @dsm/web codegen` — sin editar una sola línea de
    `src/api/generated/**`. `per frontend-standards.md §3.1/§3.2 — todo artefacto derivado del
    contrato se GENERA; escribirlo a mano reintroduce drift silencioso` (skill
    `openapi-client-codegen`).
  - **Exit criterion**: `src/api/generated/` contiene las 7 operaciones (`registerCustomer`,
    `loginCustomer`, `refreshSession`, `logoutCustomer`, `getCurrentCustomer`,
    `requestPasswordReset`, `confirmPasswordReset`), sus schemas Zod y sus mocks; y
    **re-ejecutar el codegen no produce diff** (el gate de CI queda verde).
  - **Verify**:
    ```bash
    pnpm --filter @dsm/web codegen \
      && A=$(find apps/web/src/api/generated -type f -exec md5 -q {} \; | sort | md5 -q) \
      && pnpm --filter @dsm/web codegen \
      && B=$(find apps/web/src/api/generated -type f -exec md5 -q {} \; | sort | md5 -q) \
      && [ "$A" = "$B" ] \
      && for op in registerCustomer loginCustomer refreshSession logoutCustomer \
                   getCurrentCustomer requestPasswordReset confirmPasswordReset; do
           grep -q "export const $op" apps/web/src/api/generated/endpoints.ts || { echo "FALTA $op"; exit 1; }
         done \
      && grep -q 'export const LoginCustomerResponse' apps/web/src/api/generated/zod.ts \
      && grep -q 'export const RegisterCustomerBody' apps/web/src/api/generated/zod.ts \
      && echo "OK — codegen fresco, idempotente y completo"
    ```
    *(**corregido 2026-08-22 al ejecutar** — el `Verify` original tenía dos defectos y ninguno
    era del criterio, que se cumplía:*
    1. *`git diff --quiet` comparaba contra **HEAD**, no contra la corrida anterior. En la task
       que **introduce** el código generado, el diff contra HEAD es enorme por definición: sólo
       podría pasar después de commitear, o sea nunca durante la ejecución. Medía "no cambió
       respecto de lo commiteado", no "regenerar es idempotente". Ahora se comparan los
       checksums de dos corridas seguidas, que es el hecho que interesa e independiente de git.*
    2. *`PostAuthLoginResponse` no existe: orval nombra por `operationId`, así que el schema es
       `LoginCustomerResponse`. El nombre viejo sale de la convención por-path, que es la que
       orval usa sólo cuando la operación **no** declara `operationId` — el caso del login admin
       (`PostAdminAuthLoginResponse`), no el de estas siete.)*

- [x] **T0.2** Stub E2E: superficie `/v1/auth/*` con `Set-Cookie` real (0.6 h)

  El fetch de auth ocurre en el navegador, pero el journey E2E necesita un backend que emita
  cookies con los atributos reales; sin él no se puede probar ni la topología (T0.3) ni AC-9.

  - **Pattern**: extender `e2e/support/api-stub.mjs` con el mismo estilo (sin dependencias,
    `node:http`) y **scope propio** de reset:
    ```js
    if (scope === null || scope === 'auth') customers = initialCustomers();
    // …
    res.setHeader('Set-Cookie', [
      `dsm_access=${access}; HttpOnly; SameSite=Lax; Path=/; Max-Age=900`,
      `dsm_refresh=${refresh}; HttpOnly; SameSite=Lax; Path=/v1/auth; Max-Age=2592000`,
      `dsm_csrf=${csrf}; SameSite=Lax; Path=/; Max-Age=900`,
    ]);
    ```
    `per playwright-stability — fixtures aisladas por scope; con fullyParallel el reset de un
    spec no puede pisarle los datos a otro`.
  - **Exit criterion**: el stub responde las 7 rutas con la semántica del contrato — `201`/`200`
    con las tres cookies, `401` **idéntico** para contraseña incorrecta / cuenta inexistente /
    cuenta bloqueada, `409` en email duplicado, `202` siempre en reset-request, `400` uniforme
    en token de reset vencido o usado, `403` si falta `X-CSRF-Token` en logout/refresh, `429`
    con `Retry-After` bajo un header de fuerza — y `POST /__reset?scope=auth` restaura el
    fixture **sin** tocar los de PDP y catálogo.
  - **Verify**:
    ```bash
    node apps/web/e2e/support/api-stub.selftest.mjs
    ```
    *(el selftest ya existe y se extiende en esta task: levanta el stub, ejerce las 7 rutas y
    asegura que `?scope=auth` no altera el catálogo — falla si cualquiera de las semánticas
    anteriores no se cumple)*

- [x] **T0.3** `rewrite` same-origin para `/v1/auth/*` — **y la prueba de que la cookie aterriza** (0.7 h)

  Es la premisa no verificada del plan. Se prueba antes de construir nada encima.

  - **Pattern**:
    ```js
    // next.config.mjs
    async rewrites() {
      return [{ source: '/v1/auth/:path*', destination: `${apiOrigin()}/v1/auth/:path*` }];
    }
    ```
    con `apiOrigin()` leyendo `API_INTERNAL_ORIGIN` **server-only** (sin `NEXT_PUBLIC_`) y
    fallando ruidoso si falta. `per frontend-next-standards.md §8 — las server-only env no
    llevan prefijo público` + `§10 — nada de mutaciones vía fetch a una API hand-rolled: el
    rewrite es declarativo y no agrega un solo fetch crudo (F48 intacto)`.
  - **Exit criterion**: con la app **construida** (`next build && next start`) y el stub como
    destino, un `POST /v1/auth/login` disparado desde el origen del sitio devuelve `200`, y el
    contexto del navegador queda con `dsm_access` **marcada `httpOnly`** y `dsm_csrf` legible,
    ambas en el **dominio del sitio** (no en el del API). Una llamada posterior a
    `GET /v1/auth/me` desde el mismo contexto devuelve `200` — o sea: la cookie **volvió**.
  - **Verify**:
    ```bash
    pnpm --filter @dsm/web exec playwright test e2e/auth-topology.spec.ts
    ```
    *(el spec afirma sobre `response.status()` y `context.cookies()`, nunca sobre el DOM; si el
    rewrite no propagara `Set-Cookie`, `cookies()` viene vacío y el test falla — que es
    exactamente el descubrimiento que queremos temprano)*
  - **Si falla**: `/develop-frontend-web` **para**, registra la evidencia en `proposal.md`
    §OQ-FE-1 y devuelve la decisión al Arquitecto/PO. No improvisa un Route Handler proxy (eso
    rompería F48).
  - **ADR**: si la prueba pasa, levantar **ADR-0013** ("el navegador sólo habla con el origen del
    sitio para la superficie de sesión") vía `/write-adr` — US-007 y US-015 heredan la decisión.

- [x] **T0.4** `FetchInit.session: 'customer'` en el mutator — dos modelos, un choke point (0.5 h)

  - **Pattern**:
    ```ts
    export type FetchInit = RequestInit & {
      next?: { revalidate?: number | false; tags?: string[] };
      session?: 'customer';
    };
    // dentro de customFetch:
    if (init.session === 'customer') {
      if (isServer) throw new AppErrorException({ kind: 'server',
        message: 'La sesión del cliente es sólo de navegador (design.md D3)' });
      absolute = url;                       // same-origin: lo resuelve el rewrite
      init = { ...init, credentials: 'include' };
    }
    ```
    `per frontend-standards.md §8.1 — cliente centralizado con cross-cutting en un solo lugar` +
    `§11.1`. El camino sin marca **no cambia**.
  - **Exit criterion**: (1) sin `session`, el mutator se comporta exactamente como antes (base
    URL absoluta, `Bearer` en browser, sin credenciales); (2) con `session: 'customer'` en
    navegador, la URL es relativa y `credentials` es `'include'`; (3) con `session: 'customer'`
    en servidor, **lanza** — un Server Component no puede renderizar contenido personalizado ni
    por accidente.
  - **Verify**:
    ```bash
    pnpm --filter @dsm/web exec vitest run src/lib/http/client.test.ts src/lib/http/client.server.test.ts
    ```
    *(los tests existentes del panel corren en la misma invocación: si el camino sin marca se
    hubiera movido, fallan)*

- [x] **T0.5** CSRF: `X-CSRF-Token` desde `dsm_csrf`, sólo donde el backend lo exige (0.3 h)

  - **Pattern**:
    ```ts
    // src/lib/http/csrf.ts — único lector de la cookie en toda la app
    export function readCsrfToken(): string | null {
      const m = document.cookie.match(/(?:^|;\s*)dsm_csrf=([^;]*)/);
      return m ? decodeURIComponent(m[1]) : null;
    }
    ```
    y en el mutator, sólo si `session === 'customer'` y el método **no** es seguro
    (`GET`/`HEAD`). `per security-standards §7.5 — double-submit firmado: el header lleva el
    valor de la cookie que el atacante puede provocar pero no leer`.
  - **Exit criterion**: `POST /v1/auth/logout` y `POST /v1/auth/refresh` salen con
    `X-CSRF-Token` igual al valor de `dsm_csrf`; `GET /v1/auth/me`, `POST /v1/auth/login`,
    `/register` y los de reset **no** lo llevan (el backend no lo exige y pedirlo rompería a un
    cliente sin sesión); si la cookie no existe, la llamada sale sin header y el `403`
    resultante se propaga (fail closed, no se inventa un valor).
  - **Verify**:
    ```bash
    pnpm --filter @dsm/web exec vitest run src/lib/http/csrf.test.ts src/lib/http/client.test.ts
    ```

- [x] **T0.6** Refresh single-flight con Web Lock, un reintento, cero bucles — **G-2** (0.6 h)

  Dos refresh en paralelo con rotación single-use hacen que el backend lea reuso y revoque la
  familia: el frontend desloguearía al usuario legítimo. Esta task existe para que eso no pase.

  - **Pattern**:
    ```ts
    // src/lib/http/customerSession.ts
    let inFlight: Promise<void> | null = null;
    export function refreshOnce(): Promise<void> {
      if (inFlight) return inFlight;                       // coalescing intra-tab
      const run = async () => { /* POST /v1/auth/refresh, sin reintento de red */ };
      inFlight = (navigator.locks                          // coalescing cross-tab
        ? navigator.locks.request('dsm-auth-refresh', run) // un refresh por ORIGEN
        : run()
      ).finally(() => { inFlight = null; });
      return inFlight;
    }
    ```
    `per frontend-standards.md §4.2 / §11.2 — los 401 concurrentes se COALESCEN en un solo
    refresh` + `§13 anti-pattern 22 — nunca bucles de refresh`.
  - **Exit criterion**: **G-2** — N peticiones concurrentes que reciben `401` producen
    **exactamente un** `POST /v1/auth/refresh` y todas se reintentan **una sola vez**; si el
    refresh falla (`401`/`403`), se limpia el estado de sesión, se borra la marca y se navega a
    `/ingresar?next=…` con el `next` **saneado a ruta relativa del mismo origen** (un
    `next=https://evil.tld` se descarta); el `POST /auth/refresh` **nunca** se reintenta ante
    error de red.
  - **Verify**:
    ```bash
    pnpm --filter @dsm/web exec vitest run src/lib/http/customerSession.test.ts
    ```
    *(el test cuenta requests reales con un contador en el handler MSW: dispara 5 llamadas
    concurrentes que responden `401` y asegura `refreshCount === 1` y `retries === 5`. Falla si
    alguien quita el coalescing — que es el escenario que estamos comprando)*

---

## Fase 1: Estado de sesión — `design.md` D6, D7

- [x] **T1.1** `accountService` — la capa hand-written sobre las operaciones generadas (0.4 h)

  - **Pattern**:
    ```ts
    import { loginCustomer } from '@/api/generated/endpoints';
    import { PostAuthLoginResponse } from '@/api/generated/zod';
    export const accountService = {
      async login(input: LoginInput): Promise<Customer> {
        const res = await loginCustomer(input, { session: 'customer' });
        return parseContract(PostAuthLoginResponse, res.data).customer;
      },
      // register / logout / me / requestReset / confirmReset — misma forma
    };
    ```
    `per frontend-standards.md §3.3 — sólo la lógica de servicio se escribe a mano` + `§11.5 —
    el repositorio esconde el HTTP; ningún componente importa el cliente generado`.
  - **Exit criterion**: los 7 métodos existen, todos pasan `{ session: 'customer' }`, todos
    validan la respuesta con el schema Zod **generado**, y ningún archivo fuera de
    `src/features/account/accountService.ts` (ni de los otros servicios ya existentes) importa
    `@/api/generated/endpoints`.
  - **Verify**:
    ```bash
    pnpm --filter @dsm/web exec vitest run src/features/account/accountService.test.ts \
      && test -z "$(grep -rn --include='*.tsx' '@/api/generated/endpoints' apps/web/src/features apps/web/app)" \
      && echo "OK — ningún componente importa el cliente generado"
    ```
    *(apunta a `generated/endpoints` —el **cliente**— y no a `generated/model`: importar los
    **tipos** del contrato desde un componente es el patrón correcto y ya establecido
    (`ProductCard.tsx`); lo que §11.5 prohíbe es que un componente haga la llamada HTTP. Grep
    acotado a `apps/web/**` y a `.tsx`, así que no puede matchearse a sí mismo — F57. Dry-run
    2026-08-20 con esta forma: verde)*

- [ ] **T1.2** `sessionState` (unión discriminada) + `SessionProvider` + marca no-secreta (0.5 h)

  - **Pattern**:
    ```ts
    export type SessionState =
      | { kind: 'unknown' } | { kind: 'anonymous' } | { kind: 'authenticating' }
      | { kind: 'authenticated'; customer: Customer }
      | { kind: 'error'; error: AppError };
    ```
    `per frontend-standards.md §11.4 — estados explícitos, nunca boolean + nullable` +
    `§9.3 — el estado de negocio vive en el holder; el de UI en el componente`.
    Bootstrap: si **no** hay marca `dsm.session` ⇒ `anonymous` sin tocar la red (OQ-FE-4).
  - **Exit criterion**: un visitante **sin** marca no dispara **ningún** request de auth al
    montar; con marca, se resuelve `authenticated` (`/auth/me` `200`), `anonymous`
    (`401` tras refresh fallido, y la marca se borra) o `error` (fallo de red — que **no** es lo
    mismo que anónimo y no muestra "Ingresar"); login/registro exitoso escribe la marca, logout
    la borra.
  - **Verify**:
    ```bash
    pnpm --filter @dsm/web exec vitest run src/features/account/sessionState.test.ts src/features/account/SessionProvider.test.tsx
    ```
    *(el caso "anónimo no llama a la red" se prueba con `onUnhandledRequest: 'error'` del setup
    MSW ya existente: si el provider llamara `/auth/me` sin handler, el test revienta)*

- [ ] **T1.3** Montaje en el layout `(storefront)` + `AccountMenu` en el header (0.4 h)

  - **Pattern**: el layout **sigue siendo Server Component**; sólo se envuelve `{children}`:
    ```tsx
    <SessionProvider>       {/* 'use client' — hoja */}
      <header>… <AccountMenu /></header>
      <main>{children}</main>
    </SessionProvider>
    ```
    `per frontend-next-standards.md §2 — Server Components por default, "use client" en las
    hojas; los children pasados como prop se siguen renderizando en servidor`.
  - **Exit criterion**: `app/(storefront)/layout.tsx` **no** tiene `'use client'`; el header
    muestra "Ingresar" para anónimo y el nombre del cliente + "Cerrar sesión" para autenticado;
    en `unknown` muestra un placeholder del **mismo ancho** (sin salto de layout); el panel
    (`(admin)`) **no** monta el provider ni el menú.
  - **Verify**:
    ```bash
    pnpm --filter @dsm/web exec vitest run src/features/account/AccountMenu.test.tsx \
      && ! grep -q "use client" "apps/web/app/(storefront)/layout.tsx" \
      && echo "OK — el layout sigue siendo Server Component"
    ```

---

## Fase 2: Pantallas — `design.md` D8, D9, D10, D11, D13

- [ ] **T2.1** `/crear-cuenta` — registro con sesión inmediata (AC-1, AC-6) (0.5 h)

  - **Pattern**: mismo patrón de formulario que `ProductForm.tsx` (ya establecido):
    `useForm({ resolver: zodResolver(schema) })` + `<Field>` + banner `role="alert"` + mapeo de
    `fieldErrors` del `422` con `setError`. `per frontend-standards.md §12.2 — la validación de
    cliente es UX; la del servidor es seguridad` + `design-system §7.2 / §10.2`.
    Schema cliente: `password` mínimo 8 y **máximo 72 bytes**
    (`new TextEncoder().encode(v).length <= 72`, no `.length`: el límite de bcrypt es en bytes).
  - **Exit criterion**: AC-1 — email nuevo ⇒ `201`, la marca se escribe y el header muestra el
    nombre **sin** pasar por login. AC-6 — email existente ⇒ `409` con copy que **no** confirma
    la existencia ("No pudimos crear la cuenta con esos datos"), sin cuenta creada y sin marcar
    el campo email como "ya registrado". AC-10 — ante `kind: 'rateLimited'` se muestra la espera
    derivada de `retryAfterSeconds` (copy genérico si el header no vino) y **no** se reintenta.
    `autocomplete="new-password"` y `username` en el email; el form es `POST` (nunca `GET`).
  - **Verify**:
    ```bash
    pnpm --filter @dsm/web exec vitest run src/features/account/RegisterForm.test.tsx
    ```

- [ ] **T2.2** `/ingresar` — login y la **no-distinción** de AC-5 (AC-2, AC-5, AC-10) (0.5 h)

  - **Pattern**:
    ```tsx
    const COPY_401 = 'Email o contraseña incorrectos.';   // constante, NUNCA error.message
    if (e.kind === 'unauthorized') { setBanner(COPY_401); track('login_failed'); return; }
    //  ↑ sin setError de ningún campo, sin navegar, sin propiedades en el evento
    ```
    `per design.md D9` + `security-standards §7.3 — anti-enumeración: la respuesta no puede
    revelar si la cuenta existe`.
  - **Exit criterion**: AC-2 — credenciales correctas ⇒ sesión + redirect a `?next=` saneado (o
    `/mi-cuenta`). AC-5 — ante `401`, el banner es la constante, **no** hay `setError` de
    ningún campo, **no** hay navegación y el evento `login_failed` va **sin propiedades**.
    AC-10 — `kind: 'rateLimited'` muestra la espera derivada de `retryAfterSeconds` y no
    reintenta. Errores de red ⇒ banner con CTA de reintento (design-system §10.1).
  - **Verify**:
    ```bash
    pnpm --filter @dsm/web exec vitest run src/features/account/LoginForm.test.tsx
    ```
    *(la prueba dura de indistinguibilidad es T3.1; acá se cubre el comportamiento por caso)*

- [ ] **T2.3** Cerrar sesión (AC-3) (0.2 h)

  - **Pattern**: `await accountService.logout()` ⇒ borrar marca ⇒ `setState({kind:'anonymous'})`
    ⇒ `router.replace('/')`. `per frontend-standards.md §4.3 — el sign-out limpia TODO el estado
    sensible; el que sigue no puede acceder a nada del anterior`.
  - **Exit criterion**: AC-3 — tras cerrar sesión el header vuelve a "Ingresar", la marca
    `dsm.session` no existe, el estado en memoria es `anonymous` y `/mi-cuenta` redirige a
    `/ingresar`. Si el `POST /logout` falla (red o `403`), la sesión local **igual** se limpia y
    se avisa: dejar al usuario "logueado en la UI" tras pedir salir es peor que el error.
  - **Verify**:
    ```bash
    pnpm --filter @dsm/web exec vitest run src/features/account/AccountMenu.test.tsx src/features/account/sessionState.test.ts
    ```

- [ ] **T2.4** `/recuperar` — solicitud de recuperación (AC-11) (0.3 h)

  - **Pattern**: respuesta **única** para todos los casos:
    ```tsx
    // 202 es el ÚNICO camino de éxito del backend, exista o no la cuenta
    setDone('Si el email está registrado, te enviamos un link para recuperar tu contraseña.');
    ```
    `per design-system §10.2 — voz práctica y confiable` + `security-standards §7.3`.
  - **Exit criterion**: AC-11 — la confirmación es idéntica exista o no el email (el frontend no
    tiene forma de saberlo y **no debe intentar averiguarlo**); no se ofrece "¿no te llegó?
    verificá si tenés cuenta" ni ninguna variante que insinúe existencia; `kind: 'rateLimited'`
    muestra la espera y no reintenta.
  - **Verify**:
    ```bash
    pnpm --filter @dsm/web exec vitest run src/features/account/ResetRequestForm.test.tsx
    ```

- [ ] **T2.5** `/recuperar/confirmar` — fijar contraseña nueva (AC-4, AC-7) (0.5 h)

  **Ruta fijada por el backend**: el mailer arma
  `${PASSWORD_RESET_URL_BASE}/recuperar/confirmar?token=…`
  (`apps/api/src/auth/mail/resend-password-reset-mailer.ts:32`). Otro nombre rompe AC-4 en
  producción sin romper un solo test.

  - **Pattern**:
    ```tsx
    export const metadata = { robots: { index: false, follow: false } };  // token en la query
    // en el cliente, apenas se lee el token:
    window.history.replaceState(null, '', window.location.pathname);
    ```
    `per frontend-next-standards.md §6 — Metadata API` + `design.md D11`.
  - **Exit criterion**: AC-4 — con token válido y contraseña que cumple la política, `200` y se
    invita a iniciar sesión (el backend **no** abre sesión a propósito). AC-7 — token vencido,
    inexistente o ya usado ⇒ **el mismo** mensaje accionable ("Ese link ya no sirve. Pedí uno
    nuevo.") con enlace a `/recuperar`; un `422` (contraseña débil) **no** consume el token y se
    muestra en el campo. El token **desaparece de la URL** apenas se lee y **nunca** entra a un
    evento de telemetría. La página lleva `noindex`.
  - **Verify**:
    ```bash
    pnpm --filter @dsm/web exec vitest run src/features/account/ResetConfirmForm.test.tsx
    ```

- [ ] **T2.6** `/mi-cuenta` + `CustomerGuard` (AC-2 — el destino de la sesión) (0.4 h)

  `Gated: OQ-FE-2 (recomendación: opción b — página mínima)`. Si se ratifica (a), esta task cae
  y AC-2 se demuestra sólo en el header.

  - **Pattern**:
    ```tsx
    // CustomerGuard — UX, NO autoridad (la autoridad es el CustomerGuard del backend)
    if (state.kind === 'unknown') return <Placeholder />;
    if (state.kind === 'anonymous') { router.replace(`/ingresar?next=${encodeURIComponent(path)}`); return null; }
    ```
    `per frontend-standards.md §11.bis.3 — el permiso lo decide el servidor; el cliente sólo
    evita mostrar UI que no corresponde` (mismo criterio que declara `AdminGuard`).
  - **Exit criterion**: autenticado ve nombre, email y fecha de alta + "Cerrar sesión" + el
    placeholder honesto "Tus compras — próximamente" (`Deferred: US-015`); anónimo es redirigido
    a `/ingresar?next=/mi-cuenta` y **no** alcanza a ver ni un fragmento de los datos; la página
    lleva `noindex`; el guard **no** reusa `AdminGuard` (D8).
  - **Verify**:
    ```bash
    pnpm --filter @dsm/web exec vitest run src/features/account/CustomerGuard.test.tsx
    ```

---

## Fase 3: Garantías verificables — `design.md` D3, D9, D13

> Estas cuatro tasks no agregan comportamiento: convierten propiedades verdaderas en
> propiedades **protegidas**. Sin ellas, el próximo cambio de copy reabre AC-5 y nadie se
> entera.

- [ ] **T3.1** AC-5: DOM idéntico para los tres `401` + telemetría sin discriminador (0.4 h)

  - **Pattern**:
    ```ts
    const render401 = async (detail: string) => { /* handler MSW con ese detail, submit */
      return container.innerHTML; };
    expect(await render401('Email o contraseña incorrectos'))
      .toBe(await render401('No existe una cuenta con ese email'));   // ← falla si la UI distingue
    ```
    `per design.md D9` + `qa-frontend-standards §23.3 — MSW por test, con override`.
  - **Exit criterion**: los tres `401` que el backend puede producir (contraseña incorrecta,
    cuenta inexistente, cuenta bloqueada) con `detail` **distintos** producen un `innerHTML`
    **idéntico**, y las propiedades capturadas del sink de telemetría son idénticas también. El
    test falla si aparece un `setError`, un banner extra, un copy derivado del `detail` o una
    propiedad nueva en el evento.
  - **Verify**:
    ```bash
    pnpm --filter @dsm/web exec vitest run src/features/account/ac5-indistinguibilidad.test.tsx
    ```
    *(es una comparación de igualdad, no tres asserts de texto: tres asserts pasan igual aunque
    la UI distinga, mientras el copy esperado esté bien escrito en cada rama)*

- [ ] **T3.2** G-1: nada personalizado se renderiza en servidor ⇒ nada personalizado se cachea (0.4 h)

  - **Pattern**: tres capas, la primera estructural:
    ```ts
    // 1. unit (entorno node): el mutator lanza si alguien personaliza en servidor
    await expect(customFetch('/v1/auth/me', { session: 'customer' })).rejects.toThrow();
    // 2. grep: ninguna página de app/ importa next/headers (cookies()/headers())
    // 3. E2E: el HTML servido a un contexto AUTENTICADO no contiene datos del cliente
    ```
    `per frontend-next-standards.md §3 — caché explícita` + `design.md D3`.
  - **Exit criterion**: (1) el mutator lanza en servidor con `session: 'customer'`; (2) ningún
    archivo de `apps/web/app` importa `next/headers`; (3) el HTML **servido** de `/mi-cuenta`
    para un contexto con sesión activa no contiene el email ni el nombre del cliente (todo llega
    por hidratación), verificado sobre `response.text()` de la navegación, no sobre el DOM ya
    hidratado.
  - **Verify**:
    ```bash
    pnpm --filter @dsm/web exec vitest run src/lib/http/client.server.test.ts \
      && ! grep -rn --include='*.tsx' --include='*.ts' "next/headers" apps/web/app \
      && pnpm --filter @dsm/web exec playwright test e2e/auth-no-ssr-personalizado.spec.ts
    ```
    *(el grep se acota a `apps/web/app`, donde este plan no vive — F57)*

- [ ] **T3.3** AC-8 / AC-9: la contraseña no sale del formulario; el token no es legible por JS (0.3 h)

  - **Pattern**:
    ```ts
    // el sink de telemetría se espía COMPLETO y se afirma que la contraseña no aparece
    expect(JSON.stringify(sink.mock.calls)).not.toContain(PASSWORD);
    expect(Object.keys(localStorage)).toEqual(['dsm.session']);   // sólo la marca, ningún token
    ```
    `per frontend-standards.md §4.1 — los tokens jamás se loguean, jamás van a crash reports,
    jamás a analítica` + `§13 anti-patterns 3 y 4`.
  - **Exit criterion**: AC-8 — tras registro, login y confirmación de reset, la contraseña no
    aparece en ninguna propiedad de telemetría, ni en `localStorage`/`sessionStorage`, ni en la
    URL (los tres forms son `POST`). AC-9 — el código de `src/features/account/` y
    `src/lib/http/customerSession.ts` **no lee ni escribe** `dsm_access` ni `dsm_refresh`
    (`document.cookie` sólo se toca desde `csrf.ts`, y sólo para `dsm_csrf`); el único valor que
    el frontend persiste es la marca booleana.
  - **Verify**:
    ```bash
    pnpm --filter @dsm/web exec vitest run src/features/account/ac8-ac9-secretos.test.tsx \
      && ! grep -rn --include='*.ts' --include='*.tsx' -E "dsm_access|dsm_refresh" apps/web/src apps/web/app \
      && echo "OK — el frontend no nombra las cookies HttpOnly"
    ```
    *(el grep excluye el stub E2E, que sí las emite por ser el "backend" de mentira, porque
    apunta a `src/` y `app/`, no a `e2e/` — y no puede matchearse a sí mismo, F57)*

- [ ] **T3.4** Accesibilidad de las cinco pantallas + gestión de foco (0.4 h)

  - **Pattern**:
    ```tsx
    const results = await axe(container, { rules: { region: { enabled: false } } });
    expect(results).toHaveNoViolations();
    ```
    `per qa-frontend-standards §19.2 — a11y automatizada` + `design-system §11 — labels
    siempre, focus ring visible, foco al heading al cambiar de ruta, target ≥44px`.
  - **Exit criterion**: cero violaciones de axe en los 5 formularios (estado inicial **y** con
    error visible, que es donde suele romperse el `aria-describedby`) y en el header
    autenticado; cada página tiene un `<h1>` único que recibe el foco al montar; el banner de
    error es `role="alert"` y la confirmación `role="status"`; toda la navegación de los forms
    funciona por teclado.
  - **Verify**:
    ```bash
    pnpm --filter @dsm/web exec vitest run src/features/account/a11y.test.tsx
    ```

---

## Fase 4: E2E de journey — `design.md` D11

- [ ] **T4.1** Journey: registro → sesión → logout → login (AC-1, AC-2, AC-3, AC-9) (0.5 h)

  - **Pattern**:
    ```ts
    await request.post(`${STUB}/__reset?scope=auth`);          // fixture propio, no toca PDP/catálogo
    const res = await page.waitForResponse('**/v1/auth/register');
    expect(res.status()).toBe(201);                             // estado por response.status(), no por DOM
    const [access] = (await context.cookies()).filter(c => c.name === 'dsm_access');
    expect(access.httpOnly).toBe(true);                         // AC-9 desde el navegador real
    ```
    `per playwright-stability — selectores por rol, auto-waiting, cero waitForTimeout` +
    `qa-frontend-standards §23.4`.
  - **Exit criterion**: el journey completo pasa contra la app **construida**
    (`next build && next start`, nunca dev): registro deja sesión activa sin login (AC-1),
    logout la invalida y `/mi-cuenta` redirige (AC-3), y volver a entrar con las mismas
    credenciales funciona (AC-2). `dsm_access` y `dsm_refresh` figuran como `httpOnly: true` en
    el contexto del navegador y `document.cookie` **no** las ve (AC-9).
  - **Verify**:
    ```bash
    pnpm --filter @dsm/web exec playwright test e2e/auth-journey.spec.ts
    ```

- [ ] **T4.2** Journey de recuperación + token inservible + `noindex` (AC-4, AC-7, AC-11) (0.5 h)

  - **Pattern**: el stub expone el token del último reset por una ruta de diagnóstico
    (`GET /__last-reset-token`, análoga a `/__requests` que ya existe) — el E2E **no** parsea
    emails ni adivina el token. `per playwright-stability — fixture determinista, sin
    dependencias externas`.
  - **Exit criterion**: AC-11 — la confirmación de `/recuperar` es idéntica para un email
    existente y uno inexistente (comparación de texto entre las dos corridas). AC-4 — con el
    token del stub, `/recuperar/confirmar` fija la contraseña y luego se puede iniciar sesión con
    ella. AC-7 — reusar el mismo token, o uno vencido, muestra el mismo mensaje. La respuesta de
    `/recuperar/confirmar` trae `X-Robots-Tag`/`<meta name="robots" content="noindex">` y la URL
    queda **sin** el `token` tras cargar.
  - **Verify**:
    ```bash
    pnpm --filter @dsm/web exec playwright test e2e/auth-recuperacion.spec.ts
    ```

---

## Fase 5: Observabilidad, hardening y documentación — `design.md` D12, D13

- [ ] **T5.1** Siete eventos públicos, sin una sola pieza de PII (0.3 h)

  - **Pattern**:
    ```ts
    const PUBLIC_EVENTS = new Set<BusinessEvent>([
      'pdp_shown', 'category_shown',
      'account_registered', 'login_succeeded', 'login_failed', 'logout',
      'password_reset_requested', 'password_reset_completed', 'session_expired',
    ]);
    ```
    `per observability-standards §9 — el email es PII y no entra a logs, métricas ni eventos` +
    `skill observability-patterns §9.5.6`.
  - **Exit criterion**: los 7 eventos nuevos existen en la unión `BusinessEvent` y **todos**
    están en `PUBLIC_EVENTS` (si faltara uno, `track()` le pegaría `operator_id: 'admin'` y
    ensuciaría la métrica del dueño de US-016); ninguna emisión lleva email, nombre, contraseña,
    token de reset, valor de cookie ni `customer_id`; `login_failed` va **sin propiedades**
    (D9).
  - **Verify**:
    ```bash
    pnpm --filter @dsm/web exec vitest run src/lib/observability/events.test.ts
    ```
    *(el test recorre la lista de eventos de cuenta y afirma que `track()` NO agrega
    `operator_id` para ninguno — falla si alguien suma un evento y se olvida de `PUBLIC_EVENTS`)*

- [ ] **T5.2** CSP: `form-action 'self'` (0.2 h)

  - **Pattern**: agregar la directiva al `Content-Security-Policy-Report-Only` existente en
    `next.config.mjs`. `per frontend-next-standards.md §8.bis` + `frontend-standards.md §12.4`.
  - **Exit criterion**: la política emitida incluye `form-action 'self'`; el resto de las
    directivas queda **sin cambios** (no se toca `connect-src`: bajo el rewrite, la superficie de
    sesión es same-origin y ya la cubre `'self'`).
  - **Verify**:
    ```bash
    pnpm --filter @dsm/web exec vitest run src/lib/security/headers.test.ts
    ```
    *(el test **importa** `next.config.mjs` y ejecuta `headers()`, en vez de greppear el archivo:
    un `form-action` dentro de un comentario no lo pondría verde — F50)*

- [ ] **T5.3** README, `.env.example` y notas de despliegue (0.3 h)

  - **Pattern**: `per documentation-standards §11.1 — el README se actualiza cuando cambian
    config o dependencias`.
  - **Exit criterion**: `apps/web/README.md` documenta las 5 rutas nuevas, el modelo de sesión
    (cookie vs Bearer, y por qué conviven), el rewrite y la marca no-secreta;
    `apps/web/.env.example` declara `API_INTERNAL_ORIGIN` **con la advertencia de que NO lleva
    `NEXT_PUBLIC_`**; y las notas de despliegue registran las tres dependencias de entorno del
    backend que este change asume: `CORS_ALLOWED_ORIGINS` **debe incluir el origen del
    storefront** (si no, `/logout` y `/refresh` responden `403`), `PASSWORD_RESET_URL_BASE`
    **debe apuntar al origen del storefront** (si no, el link del email va a ninguna parte) y
    `AUTH_COOKIE_SECURE=true` fuera de local. API y web **se despliegan juntas**.
  - **Verify**:
    ```bash
    for k in API_INTERNAL_ORIGIN; do grep -q "^$k=" apps/web/.env.example || { echo "falta $k"; exit 1; }; done \
      && grep -q 'NEXT_PUBLIC' apps/web/.env.example \
      && grep -q '/recuperar/confirmar' apps/web/README.md \
      && grep -q 'CORS_ALLOWED_ORIGINS' apps/web/README.md \
      && echo "OK — env y README documentados"
    ```
    *(greps acotados a `apps/web/`, fuera del alcance de este plan — F57)*

---

## Verification (suite-level)

- [ ] Suite unitaria y de componentes **en verde** (incluye US-001/002/003 — el mutator
      es sustrato compartido y esta US lo tocó):
      `pnpm --filter @dsm/web test`
      *(el script es `vitest run`: termina, no observa — F49)*
- [ ] Type-check y lint **limpios**: `pnpm --filter @dsm/web typecheck && pnpm --filter @dsm/web lint`
- [ ] **E2E completo en verde contra la app construida**: `pnpm --filter @dsm/web test:e2e`
      *(incluye los specs de US-002/US-003: si el rewrite hubiera alterado el ruteo público, se
      cae acá)*
- [ ] **Codegen fresco** (el gate `frontend-codegen-fresh` de CI):
      `pnpm --filter @dsm/web codegen && git diff --quiet -- apps/web/src/api/generated`
- [ ] **F48 intacto — un solo `fetch` crudo**:
      ```bash
      test -z "$(grep -rn --include='*.ts' --include='*.tsx' -E '(^|[^.[:alnum:]_])fetch\(' \
        apps/web/src apps/web/app | grep -v 'src/lib/http/client.ts' | grep -v '\.test\.')" \
        && echo "OK — el único fetch crudo sigue siendo el mutator"
      ```
      *(sin `ifne`: moreutils no está instalado en esta máquina. Dry-run 2026-08-20: verde)*
- [ ] **Sin `loading.tsx` en `(storefront)`** (F59 — degradaría el 404 real a un 200 ya
      confirmado):
      ```bash
      find "apps/web/app/(storefront)" -name 'loading.tsx' | grep -q . && exit 1 || echo "OK"
      ```
- [ ] **El panel no se movió**: `AdminGuard`, `adminSession` y `authToken.ts` sin cambios —
      `git diff --quiet HEAD -- apps/web/src/features/auth apps/web/src/lib/http/authToken.ts`

---

## Por qué el plan excede el presupuesto de la US §7

La US presupuesta **FE-US-014 en 8-12 h tradicional** con esta descripción: *"formularios de
registro, login y recuperación + manejo de sesión según design-system"*. Ese es, efectivamente,
el costo de todo lo que NO está en la tabla de abajo: **~5,9 h AI / ~11,8 h tradicional**,
que entra justo dentro del techo de 12 h.

Lo que la US no pudo prever, porque se escribió antes de que el backend eligiera cookies
`HttpOnly` con refresh rotado, es lo otro:

| Trabajo no presupuestado | Costo | Por qué es inevitable |
|---|---|---|
| Topología same-origin + prueba de que la cookie aterriza (T0.3) | 0.7 h | `up.railway.app` está en la PSL ⇒ sin esto la US **no funciona en producción**, aunque pase todos los tests |
| Dos modelos de auth en un solo choke point (T0.4, T0.5) | 0.8 h | El sustrato de US-001 es `Bearer` en memoria; una cookie `HttpOnly` no puede pasar por ahí |
| Refresh single-flight cross-tab (T0.6) | 0.6 h | Sin coalescing, la rotación single-use de ADR-0011 **desloguea al usuario legítimo** |
| Superficie `/v1/auth/*` en el stub E2E con `Set-Cookie` real (T0.2) | 0.6 h | El fetch es de navegador pero el journey necesita cookies reales; no hay stub previo de auth |
| Fase 3 completa — las cuatro garantías (T3.1-T3.4) | 1.5 h | AC-5, AC-8 y AC-9 son propiedades de **seguridad**: verdaderas hoy no alcanza, tienen que quedar protegidas |

Total no presupuestado: **~4.2 h AI / ~8.4 h tradicional**, que es casi exactamente el exceso.

Si OQ-FE-2 se ratifica como (a) —sin página `/mi-cuenta`— caen 0.4 h. Si OQ-FE-1 se ratifica
como (c) —diferir hasta el dominio propio— el change **no es más barato: queda bloqueado**.
