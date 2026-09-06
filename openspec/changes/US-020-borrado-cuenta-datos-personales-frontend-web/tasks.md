---
parent-us: US-020
discipline: frontend-web
variant: null
language: es
---

# US-020 Frontend-web — Tasks

> Cada task es closure-grade: atómica, con `Exit criterion:` observable y
> `Verify:` con el comando exacto que `/develop-frontend-web` corre — siempre
> en su forma **terminante** (F49): `pnpm --filter @dsm/web vitest run <patrón>`
> (el script `test` de `apps/web/package.json` ya es `vitest run`, no
> `vitest` a secas), `pnpm --filter @dsm/web test:e2e -- <patrón>` para
> Playwright (`playwright test`, ya terminante — un solo run, sin watch).
> Los comandos asumen la **raíz del repo** como cwd.
>
> **Estimación dual**: **~6,5 h AI-asistido** / **~11 h tradicional** (27
> tasks, 8 fases + pre-requisitos). La US §7 presupuesta `FE-US-020` sin un
> número propio todavía (`TBD` en la tabla de la US) — este plan lo fija en
> el rango de US-013 FE (~3,5/5 h) más el trabajo real que este change
> agrega y que US-013 no tuvo: un método nuevo de `SessionProvider`
> (`accountDeleted`), un campo nuevo en la unión `AppError` con un drift de
> contrato documentado (D2 de `design.md`), un componente de "pantalla
> post-borrado" que exige levantar estado por encima del guard (D3), y —lo
> más caro— una Fase de E2E dev-owned completa (stub + spec Playwright) que
> **cierra un hueco real** que US-015 FE dejó abierto (ver `design.md`
> §Context) y que ninguna US-013-shaped-task presupuesta.

## Traceability matrix (AC de la US → tasks)

| AC | Descripción | Task IDs |
|---|---|---|
| AC-1 | Borrado inmediato; sesión termina reflejada en la UI | T3.1, T4.1, T4.2, T7.1 |
| AC-2 | PII fuera de toda superficie | Backend-owned — la UI no re-prueba; superficie: `AccountDeletedNotice` no muestra ningún dato del cliente borrado (T4.2) |
| AC-3 | Historial comercial sobrevive anonimizado | Backend-owned — sin cambios en `orderHistoryService`/`PurchaseHistoryList` (US-015), no re-probado acá |
| AC-4 | Orden en curso bloquea, con detalle | T2.1, T3.2, T5.1, T7.2, T7.4 |
| AC-5 | Email liberado, re-registro limpio | Backend-owned — superficie: copy del `ConfirmDialog` lo menciona (T3.4) |
| AC-6 | Placeholder único por fila | Backend-owned, N/A frontend |
| AC-7 | Cancelar/cerrar sin confirmar no modifica nada | T3.4 |
| AC-8 | Cuenta sin órdenes / ya anonimizadas, sin error | Backend-owned (idempotencia) — superficie mínima en T7.4 |
| AC-9 | Verificación al ejecutar, no al mostrar | T3.4 (ausencia deliberada de pre-chequeo), T8.1 (grep que lo hace estructural, no una promesa) |
| AC-10 | Las 3 puertas cerradas | Backend-owned — superficie: `CustomerGuard` redirige si se revisita `/mi-cuenta` tras el borrado (cubierto por comportamiento ya existente, sin task nueva) |
| AC-11 | Sin vuelta atrás, sin estado "borrado pendiente" | T3.4 (copy), T4.2 (sin estado intermedio en `MiCuentaScreen`) |
| AC-12 | Panel de métricas no se mueve | Backend-owned, N/A frontend |
| AC-13 | Sólo el titular con sesión propia | Backend-owned (`CustomerGuard`+`CsrfGuard`) — sin cambios, sin task nueva |
| AC-14 | Observabilidad sin PII | T6.1, T6.2 (mitad FE — sólo los eventos que este change agrega) |
| AC-15 | Doble confirmación, un solo efecto | Backend-owned — superficie: T7.4 del topology spec ejercita un doble `DELETE` |

## Pre-requisitos

- [x] **T0.1 — `apps/web` limpio antes de empezar**
  - **Exit criterion**: no hay cambios sin commitear en
    `apps/web/src/features/account/`, `apps/web/src/lib/http/errors.ts`,
    `apps/web/src/lib/observability/events.ts`, `apps/web/e2e/`,
    `apps/web/app/(storefront)/mi-cuenta/` de otra sesión en vuelo en **este**
    worktree.
  - **Verify**: `git status --porcelain apps/web/src/features/account apps/web/src/lib/http/errors.ts apps/web/src/lib/observability/events.ts apps/web/e2e "apps/web/app/(storefront)/mi-cuenta"` vacío

- [x] **T0.2 — El cliente generado ya tiene `deleteAccount`/`AccountHasActiveOrdersProblem` (regenerado por el orquestador, no por este change)**
  - **Exit criterion**: `apps/web/src/api/generated/endpoints.ts` exporta
    `deleteAccount`; `apps/web/src/api/generated/model/accountHasActiveOrdersProblem.ts`
    existe; `apps/web/src/api/generated/zod.ts` exporta `DeleteAccountResponse`.
  - **Verify**: `grep -q "export const deleteAccount " apps/web/src/api/generated/endpoints.ts && test -f apps/web/src/api/generated/model/accountHasActiveOrdersProblem.ts && grep -q "^export const DeleteAccountResponse " apps/web/src/api/generated/zod.ts`

- [x] **T0.3 — El rewrite `/v1/me/:path*` ya existe (PR #89, no de este change)**
  - **Exit criterion**: `next.config.mjs` tiene una entrada de `rewrites()`
    con `source: '/v1/me/:path*'` — este change NO la agrega, sólo la
    consume y la verifica (T7.1-T7.4).
  - **Verify**: `grep -q "'/v1/me/:path\*'" apps/web/next.config.mjs`

## Fase 1 — Contrato: verificar que el cliente generado sigue vigente

- [ ] **T1.1 — `pnpm --filter @dsm/web codegen` no produce diff (gate `frontend-codegen-fresh`)**
  - **Pattern**: verificación de frescura, no regeneración — `per
    openapi-client-codegen` skill, "nunca a mano". El orquestador ya corrió
    el codegen antes de este plan.
  - **Exit criterion**: correr `codegen` de nuevo no modifica ningún archivo
    bajo `apps/web/src/api/generated/`.
  - **Verify**: `pnpm --filter @dsm/web codegen && git status --porcelain apps/web/src/api/generated/` vacío

## Fase 2 — Mapeo de errores (`AppError.conflict.blockingOrders`)

- [ ] **T2.1 — `AppError` gana `blockingOrders`; `mapProblemToAppError` lo propaga**
  - **Pattern**: `per design.md §D2` — extension member ad-hoc del 409,
    mismo criterio que `availableQuantity`/`maxItems` (US-007). `status` se
    tipa `string`, NO el enum generado (drift de contrato documentado en
    `design.md` §Context — el runtime puede emitir `pending_payment`, que el
    contrato publicado no declara):
    ```ts
    blockingOrders?: { order_number: number; status: string; total_ars_cents: number; created_at: string }[];
    // ...
    ...(Array.isArray(p.blocking_orders) ? { blockingOrders: p.blocking_orders } : {}),
    ```
  - **Exit criterion**: un 409 con `blocking_orders` en el body produce un
    `AppError.conflict.blockingOrders` con el mismo array (mismos campos,
    sin transformación); un 409 SIN `blocking_orders` (p. ej. el del carrito,
    US-007) sigue sin ese campo (`undefined`, no `[]`) — regresión cero sobre
    los casos existentes de `errors.test.ts`.
  - **Verify**: `pnpm --filter @dsm/web vitest run src/lib/http/errors.test.ts`

## Fase 3 — `accountService.deleteAccount` + `DeleteAccountSection`

- [ ] **T3.1 — `accountService.deleteAccount()`**
  - **Pattern**: `per design.md §D1` — alias de import para resolver la
    colisión de nombres (`deleteAccount` generado vs método del
    repositorio), mismo `conSesion` que el resto del archivo:
    ```ts
    import { deleteAccount as deleteAccountRequest } from '@/api/generated/endpoints';
    async deleteAccount(): Promise<void> {
      await deleteAccountRequest(conSesion);
    },
    ```
  - **Exit criterion**: `accountService.deleteAccount` existe, la llamada de
    red pasa por la operación **generada** (F48) — nunca `fetch`/`axios`
    crudo — y va con `session: 'customer'` (ADR-0013).
  - **Verify**: `pnpm --filter @dsm/web exec tsc --noEmit`

- [ ] **T3.2 — `accountService.test.ts` — caso `deleteAccount`**
  - **Exit criterion**: un test nuevo cubre el happy path (`DELETE /v1/me`
    responde `204`, `accountService.deleteAccount()` resuelve sin lanzar) y
    un caso de 409 con `blocking_orders` (el método propaga la excepción
    tipada, no la atrapa — a diferencia de `logout()`).
  - **Verify**: `pnpm --filter @dsm/web vitest run src/features/account/accountService.test.ts`

- [ ] **T3.3 — `SessionProvider` gana `accountDeleted()`**
  - **Pattern**: `per design.md §D4` — mismo cuerpo que el `finally` de
    `logout()`, expuesto como función propia (NO llama al backend):
    ```ts
    const accountDeleted = useCallback(() => {
      setSessionHint(false);
      setState({ kind: 'anonymous' });
    }, []);
    ```
    Se agrega a `SessionContextValue` y al `value` memoizado.
  - **Exit criterion**: llamar `accountDeleted()` pone `state.kind` en
    `'anonymous'` y borra `SESSION_HINT_KEY` de `localStorage`, sin disparar
    ninguna llamada de red (a diferencia de `logout()`).
  - **Verify**: `pnpm --filter @dsm/web vitest run src/features/account/SessionProvider.test.tsx -t "accountDeleted"`

- [ ] **T3.4 — `DeleteAccountSection` — componente base: copy, gate de apertura, `Escape`/Cancelar sin red (AC-7)**
  - **Pattern**: `per design.md §D5` — calcado a `OrderAnonymizeAction.tsx`
    en estructura (estado local `confirmOpen`/`busy`/`error`, `ConfirmDialog`
    reusado sin modificar), con el copy exacto de `design.md §D5`.
  - **Exit criterion**: renderiza el botón "Eliminar mi cuenta" + la
    descripción de qué se borra/qué sobrevive; al click, abre el diálogo con
    el copy exacto; `Escape` o click en "Cancelar" cierran el diálogo SIN
    invocar `accountService.deleteAccount` (AC-7); el botón de confirmar del
    diálogo queda deshabilitado hasta tipear "ELIMINAR" exacto (heredado de
    `ConfirmDialog`, este test verifica el wiring de `confirmWord`).
  - **Verify**: `pnpm --filter @dsm/web vitest run src/features/account/DeleteAccountSection.test.tsx -t "T3.4"`

## Fase 4 — Flujo de éxito: `MiCuentaScreen` + `AccountDeletedNotice`

- [ ] **T4.1 — Wiring de la mutación exitosa en `DeleteAccountSection`**
  - **Pattern**: `per design.md §D5` — orden exacto: `track('account_delete_attempted')`
    → `accountService.deleteAccount()` → `track('account_delete_succeeded')`
    → `session.accountDeleted()` → `props.onDeleted()` (en ese orden — D3
    exige que `accountDeleted()` y `onDeleted()` corran en el mismo manejador
    síncrono para que React los agrupe en un solo render).
  - **Exit criterion**: en éxito, se llama `session.accountDeleted()`
    ANTES de `onDeleted()`, ambas dentro del mismo `async function confirm()`
    sin ningún `await` entre medio que rompa el batching.
  - **Verify**: `pnpm --filter @dsm/web vitest run src/features/account/DeleteAccountSection.test.tsx -t "T4.1"`

- [ ] **T4.2 — `AccountDeletedNotice` (componente nuevo)**
  - **Pattern**: `per design.md §"Component breakdown"` — `role="status"`
    `aria-live="polite"` (confirmación, no interrupción), foco al propio
    `<h2 tabIndex={-1}>` al montar (design-system §11 — foco gestionado al
    cambiar de contenido), `<Link href="/">Volver al inicio</Link>`. NO
    muestra ningún dato del cliente (nombre/email/lo que sea) — sólo el
    mensaje genérico (AC-2, superficie).
  - **Exit criterion**: al montar, el foco queda en el `<h2>`; el texto
    menciona explícitamente que es irreversible, que el email queda libre, y
    que el historial se conserva anonimizado; no renderiza ningún dato
    personal.
  - **Verify**: `pnpm --filter @dsm/web vitest run src/features/account/AccountDeletedNotice.test.tsx`

- [ ] **T4.3 — `MiCuentaScreen` (componente nuevo) — levanta el estado por encima del guard**
  - **Pattern**: `per design.md §D3` — el componente EXACTO citado ahí
    (`useState<boolean>` + `if (deleted) return <AccountDeletedNotice />`).
  - **Exit criterion**: con `deleted=false` (inicial), renderiza
    `<CustomerGuard><AccountPanel onAccountDeleted={...} /></CustomerGuard>`;
    tras invocar la prop `onAccountDeleted` que le llega a `AccountPanel`,
    el árbol completo se reemplaza por `<AccountDeletedNotice />` — SIN que
    `CustomerGuard` llegue a renderizar `null` ni a disparar su `useEffect`
    de redirección (verificable con un spy sobre `router.replace`: nunca se
    llama en este flujo).
  - **Verify**: `pnpm --filter @dsm/web vitest run src/features/account/MiCuentaScreen.test.tsx`

- [ ] **T4.4 — `AccountPanel` reenvía `onAccountDeleted` a `DeleteAccountSection`**
  - **Pattern**: prop opcional (no rompe consumidores existentes que monten
    `<AccountPanel />` sin ella):
    ```tsx
    export function AccountPanel({ onAccountDeleted }: { onAccountDeleted?: () => void }) {
      // ...
      <DeleteAccountSection onDeleted={() => onAccountDeleted?.()} />
    ```
  - **Exit criterion**: `AccountPanel` renderiza `<DeleteAccountSection>`
    junto a las secciones existentes (datos, link a compras, cerrar sesión);
    `AccountPanel.test.tsx` (existente) sigue pasando SIN editarse — si hay
    que tocarlo, el comportamiento existente cambió y algo está mal.
  - **Verify**: `pnpm --filter @dsm/web vitest run src/features/account/AccountPanel.test.tsx`

- [ ] **T4.5 — Wiring en la página**
  - **Pattern**: `per design.md §D3` — `page.tsx` sigue siendo Server
    Component (conserva `metadata`), sólo cambia QUÉ renderiza:
    ```tsx
    import { MiCuentaScreen } from '@/features/account/MiCuentaScreen';
    // ...
    <MiCuentaScreen />
    ```
  - **Exit criterion**: `apps/web/app/(storefront)/mi-cuenta/page.tsx`
    importa y renderiza `<MiCuentaScreen />` en vez de
    `<CustomerGuard><AccountPanel /></CustomerGuard>` directamente; compila
    sin errores de tipos; `metadata` (`noindex`) sin cambios.
  - **Verify**: `pnpm --filter @dsm/web exec tsc --noEmit`

## Fase 5 — Wiring del error de bloqueo (AC-4/AC-9) + cierre del diálogo (D7)

- [ ] **T5.1 — 409 con `blockingOrders`: lista de pedidos + mensaje específico; diálogo se cierra (D7)**
  - **Pattern**: `per design.md §D5/§D6/§D7` — lookup local
    `BLOCKING_STATUS_LABEL: Record<string, string>` (NO `OrderStatusBadge`,
    ver D2/D6), fallback al valor crudo si no está en el lookup; en CUALQUIER
    error (bloqueo o genérico) `setConfirmOpen(false)` — se aparta
    deliberadamente del precedente de `OrderCancelAction` (motivo en D7).
  - **Exit criterion**: un 409 con 2 pedidos bloqueantes (uno
    `pending_payment`, uno `preparing`) muestra ambos con número/estado/
    importe en texto plano (sin `<Link>` — D6), el mensaje "No podés eliminar
    tu cuenta mientras tengas pedidos sin retirar o sin pagar.", y el diálogo
    queda CERRADO (no atenuado detrás de un overlay).
  - **Verify**: `pnpm --filter @dsm/web vitest run src/features/account/DeleteAccountSection.test.tsx -t "T5.1"`

- [ ] **T5.2 — Error genérico (401/403/429/network/500): mensaje genérico, diálogo cerrado**
  - **Exit criterion**: cualquier error que NO sea `conflict` con
    `blockingOrders` muestra "No se pudo eliminar tu cuenta. Reintentá." y
    cierra el diálogo — mismo criterio de D7.
  - **Verify**: `pnpm --filter @dsm/web vitest run src/features/account/DeleteAccountSection.test.tsx -t "T5.2"`

- [ ] **T5.3 — Idempotencia visual: doble-click no dispara un segundo `DELETE`**
  - **Pattern**: calcado al test equivalente de `OrderAnonymizeAction.test.tsx`
    ("idempotencia visual") — `per frontend-resilience-patterns` #3/#4/#9:
    `server.use` con una promesa que no resuelve hasta que el test la
    libera; el botón de confirmar queda `disabled` mientras `busy=true`.
  - **Exit criterion**: con la mutación en curso, un segundo click sobre el
    botón de confirmar no dispara una segunda llamada HTTP.
  - **Verify**: `pnpm --filter @dsm/web vitest run src/features/account/DeleteAccountSection.test.tsx -t "T5.3"`

## Fase 6 — Observabilidad (eventos sin PII)

- [ ] **T6.1 — 4 literales nuevos en `BusinessEvent`, en `PUBLIC_EVENTS`**
  - **Pattern**: agregar al bloque comentado "Historial de compras del
    cliente (US-015)" en `apps/web/src/lib/observability/events.ts` — son
    de superficie de CLIENTE, no de operador (mismo criterio que
    `order_history_shown`):
    ```ts
    | 'account_delete_attempted'
    | 'account_delete_succeeded'
    | 'account_delete_blocked'
    | 'account_delete_failed';
    ```
    Los 4 se agregan también al `Set` de `PUBLIC_EVENTS`.
  - **Exit criterion**: los 4 literales existen en `BusinessEvent`; los 4
    están en `PUBLIC_EVENTS` (sin `operator_id: 'admin'` por defecto);
    ninguno lleva `order_id`, nombre, email ni el detalle de
    `blockingOrders` — sólo el nombre del evento, sin props (mismo criterio
    que `login_failed`).
  - **Verify**: `pnpm --filter @dsm/web exec tsc --noEmit`

- [ ] **T6.2 — `account.events.test.tsx` (nuevo) — sin PII, secuencia correcta**
  - **Pattern**: calcado a `orders.events.test.tsx` (nombre/email
    "centinela" reconocibles; falla si aparecen en el volcado JSON de los
    eventos capturados) — `per design.md` referencia a ese archivo.
  - **Exit criterion**: en el camino de éxito, se emite
    `account_delete_attempted` antes de `account_delete_succeeded` (nunca
    `_blocked`/`_failed`); en el camino de bloqueo, se emite
    `account_delete_attempted` seguido de `account_delete_blocked` (nunca
    `_succeeded`); ninguno de los 4 eventos lleva el nombre/email
    "centinela" del cliente autenticado en el fixture del test, ni el
    `order_number`/importe de los pedidos bloqueantes.
  - **Verify**: `pnpm --filter @dsm/web vitest run src/features/account/account.events.test.tsx`

- [ ] **T6.3 — `a11y.test.tsx` (existente) — `AccountPanel` con "Eliminar mi cuenta" visible, sin violaciones serious/critical**
  - **Pattern**: nuevo `it` en el `describe` existente, mismo helper
    `auditar` (axe con `region` deshabilitada) que los casos ya presentes.
  - **Exit criterion**: `AccountPanel` autenticado, con la sección
    "Eliminar mi cuenta" visible (diálogo cerrado), no tiene violaciones
    axe-core `serious`/`critical`; con el `ConfirmDialog` ABIERTO, tampoco
    (el `Field`/`Input` del diálogo ya se prueba en otros consumidores, pero
    el `title`/`description` de ESTE uso son nuevos y pueden introducir un
    `aria-labelledby` roto si el `titleId` no se genera bien).
  - **Verify**: `pnpm --filter @dsm/web vitest run src/features/account/a11y.test.tsx`

## Fase 7 — E2E dev-owned: topología de `/v1/me` contra la app construida

> Cierra el hueco documentado en `design.md` §Context/§D8: US-015 FE no tuvo
> esta fase y el bug real de rewrite ausente lo encontró QA recién en PR
> #89. Esta fase es responsabilidad de **frontend-web**, no se difiere.

- [ ] **T7.1 — `api-stub.mjs` gana `DELETE /v1/me` (204, cookies limpias, 401, 403) + checks en `api-stub.selftest.mjs`**
  - **Pattern**: `per design.md §D8` — mismo criterio que la superficie de
    auth existente (cookies con atributos reales, sesión en el `Map`
    `sessions`). El stub es "un oráculo sin verificar" si no se prueba por su
    cuenta (`api-stub.selftest.mjs`, docstring del propio archivo) — se le
    agregan checks nuevos ahí, mismo estilo que los de la superficie de auth
    (`login`/`logout`) ya presentes.
  - **Exit criterion**: con una cookie `dsm_access` válida y el header
    `x-csrf-token` correcto, `DELETE /v1/me` responde `204` y limpia las 3
    cookies de sesión (`Max-Age=0`); sin sesión, `401`; con sesión pero sin
    CSRF válido, `403`.
  - **Verify**: `node apps/web/e2e/support/api-stub.selftest.mjs` (exit 0; agrega ≥3 `check(...)` nuevos para `/v1/me` — 204+cookies limpias, 401 sin sesión, 403 sin CSRF)

- [ ] **T7.2 — `api-stub.mjs` gana el header de fuerza `x-force-blocking-orders` (409 determinista) + check en `api-stub.selftest.mjs`**
  - **Pattern**: `per design.md §D8` — mismo criterio que
    `x-force-rate-limit` ya existente en la superficie de auth: determinista,
    sin sembrar una orden real.
  - **Exit criterion**: con `x-force-blocking-orders: 1`, `DELETE /v1/me`
    responde `409` con `blocking_orders` conteniendo al menos un pedido en
    `pending_payment` — el caso que D2 documentó como el más probable y el
    que el enum publicado no declara (a propósito: el stub, a diferencia del
    contrato, SÍ tiene que reproducir el comportamiento REAL del backend);
    la cookie de sesión NO se limpia en este camino.
  - **Verify**: `node apps/web/e2e/support/api-stub.selftest.mjs` (exit 0; incluye el check nuevo del 409 con `blocking_orders` conteniendo `status: 'pending_payment'`)

- [ ] **T7.3 — `account-deletion-topology.spec.ts` (nuevo) — happy path contra la app construida**
  - **Pattern**: `per design.md §D8` — espejo de `auth-topology.spec.ts`:
    login real → `DELETE /v1/me` con el CSRF leído de `context.cookies()` →
    asserts sobre `response.status()`/`context.cookies()`, NUNCA sobre el
    DOM.
  - **Exit criterion**: contra la app **construida** (`next build && next
    start`, no `next dev`): `DELETE /v1/me` desde el origen del sitio
    responde `204`; `context.cookies()` deja de tener `dsm_access` después;
    un `GET /v1/auth/me` posterior con la cookie vieja responde `401` (la
    sesión se cerró de verdad, no es un falso positivo del stub — mismo
    criterio que el 3er caso de `auth-topology.spec.ts`).
  - **Verify**: `pnpm --filter @dsm/web test:e2e -- account-deletion-topology`

- [ ] **T7.4 — `account-deletion-topology.spec.ts` — 409 por bloqueo + doble `DELETE` (AC-15, superficie)**
  - **Pattern**: `per design.md §D8` — usa el header de T7.2 para el 409;
    para el doble `DELETE`, dos llamadas seguidas con la MISMA cookie
    (simula doble clic).
  - **Exit criterion**: con `x-force-blocking-orders: 1`, la respuesta es
    `409` con `blocking_orders` no vacío en el body, y la cookie de sesión
    NO se limpia (sigue estando `dsm_access` en `context.cookies()`); dos
    `DELETE /v1/me` seguidos (sin el header de fuerza) responden `204`
    ambos, sin que el segundo lance un error (AC-15, superficie — el stub no
    reproduce la anonimización real, pero sí el contrato de idempotencia del
    status code).
  - **Verify**: `pnpm --filter @dsm/web test:e2e -- account-deletion-topology`

## Fase 8 — Pre-merge

- [ ] **T8.1 — Sin `fetch`/`axios` crudo; sin pre-chequeo de órdenes antes de mostrar el botón (AC-9)**
  - **Exit criterion**: ni `DeleteAccountSection.tsx` ni `accountService.ts`
    llaman `fetch`/`axios` directamente (F48); `DeleteAccountSection.tsx` no
    contiene ninguna llamada a `orderHistoryService`/`listOrderHistory` (AC-9
    — no pre-chequea, deja que el propio `DELETE` sea la única fuente de
    verdad).
  - **Verify**: `! grep -nE "fetch\(|axios\." apps/web/src/features/account/DeleteAccountSection.tsx apps/web/src/features/account/accountService.ts && ! grep -n "orderHistoryService\|listOrderHistory" apps/web/src/features/account/DeleteAccountSection.tsx` (exit 0 = ninguna coincidencia en ambos greps)

- [ ] **T8.2 — Suite completa de `apps/web` verde + lint + typecheck**
  - **Exit criterion**: lint, typecheck y la suite completa de `apps/web`
    (Vitest) pasan sin fallos ni skips inesperados.
  - **Verify**: `pnpm --filter @dsm/web lint && pnpm --filter @dsm/web exec tsc --noEmit && pnpm --filter @dsm/web test`

- [ ] **T8.3 — Codegen sigue fresco (gate `frontend-codegen-fresh`)**
  - **Exit criterion**: correr `codegen` de nuevo, después de todos los
    cambios de este change, sigue sin producir diff.
  - **Verify**: `pnpm --filter @dsm/web codegen && git status --porcelain apps/web/src/api/generated/` vacío

## Verification (suite-level)

- [ ] Todos los tests del feature `account` pasan:
      `pnpm --filter @dsm/web vitest run src/features/account/`
- [ ] El E2E dev-owned de topología pasa contra la app construida:
      `pnpm --filter @dsm/web test:e2e -- account-deletion-topology`
- [ ] Lint / typecheck limpios:
      `pnpm --filter @dsm/web lint && pnpm --filter @dsm/web exec tsc --noEmit`
- [ ] Codegen sigue fresco: `pnpm --filter @dsm/web codegen && git status --porcelain apps/web/src/api/generated/` vacío
- [ ] Ningún `fetch`/`axios` crudo en los archivos nuevos/modificados de esta
      US (F48) — ver T8.1.
