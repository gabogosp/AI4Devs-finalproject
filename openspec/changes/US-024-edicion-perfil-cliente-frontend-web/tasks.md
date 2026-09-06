# Tasks — Edición de perfil del cliente (frontend-web)

> Per [`AGENTS.md`](../../../AGENTS.md) sección 1.1: tasks pequeñas, una a la
> vez. Sin change `-qa` propio (US §7): la cobertura L1-L3 vive en Fases 3-4
> de este mismo `tasks.md`.

## Traceability matrix (AC → tasks)

| AC | Título | Task IDs | Status |
|---|---|---|---|
| AC-1 | Editar el nombre, reflejado de inmediato **y** en `buyer.name` del próximo checkout logueado | T1.4, T2.1, T2.3, T2.5, T3.3, T3.8, T4.1 | en este change (segunda mitad agregada 2026-09-06 tras confirmar con backend que `orders.buyer_name` nunca sale de `Customer.name`) |
| AC-2 | Agregar/cambiar avatar por URL | T2.1, T2.2, T3.3 | en este change |
| AC-3 | Quitar el avatar (vuelve al placeholder) | T2.1, T3.2, T3.3 | en este change |
| AC-4 | Nombre vacío rechazado, sin cambio | T2.1, T3.3 | en este change |
| AC-5 | URL inválida/esquema≠http(s) rechazada | T2.1, T3.3 | en este change |
| AC-6 (negative-space) | Email de sólo lectura, sin control | T2.3, T3.4 | en este change |
| AC-7 (negative-space) | Ningún parámetro apunta a otro cliente | T1.3, T3.3 | en este change (verificación del lado FE; la garantía de autoridad es del backend, `US-024-edicion-perfil-cliente-backend`) |

Ninguna AC queda diferida.

## Pre-requisitos

- [ ] Confirmar nombre de rama sigue `git-workflow-standards.md`
  (`feature/US-024-edicion-perfil-cliente-frontend-web` o equivalente).
- [ ] Confirmar que no hay otro change activo en `openspec/changes/` en
  conflicto sobre `apps/web/src/features/account/` (verificado al planificar:
  ninguno).

## Fase 0 — Reconciliación de contrato (gate de ejecución)

> **Bloqueante real**: `apps/api/docs/api/openapi.yaml` en este worktree NO
> declara todavía `patch` bajo `/me` ni `avatar_url` en `Customer` —
> `US-024-edicion-perfil-cliente-backend` (sesión 07) lo construye en
> paralelo. Ninguna task de Fase 1 en adelante puede ejecutarse contra un
> contrato que no existe. Esta fase es el gate explícito, mismo patrón usado
> en este repo para US-010/US-012/US-020 (ver
> `docs/_index/openspec-changes.yaml`).

- [x] T0.1 Verificar que el contrato del backend hermano publica `PATCH /me`
  (bajo el path `/me` existente, junto al `delete` de US-020) y que
  `Customer` gana la propiedad `avatar_url` (`string`, nullable). Leer el
  `design.md` real de `US-024-edicion-perfil-cliente-backend` cuando esté
  disponible (rama/PR de 07) y ajustar el nombre exacto del `operationId` /
  la forma del response (`Customer` plano vs `{customer: Customer}`) contra
  lo asumido en `design.md` §Approach de este change.
  - **Exit criterion**: `apps/api/docs/api/openapi.yaml` (en este worktree,
    sincronizado con la rama/PR de 07) contiene `patch:` bajo `/me:` y
    `avatar_url` bajo `components.schemas.Customer.properties`.
  - **Verify**: `grep -A2 "^  /me:" apps/api/docs/api/openapi.yaml | grep -q "patch:" && grep -q "avatar_url" apps/api/docs/api/openapi.yaml`
- [x] T0.2 Regenerar el cliente derivado del contrato (`orval`) una vez T0.1
  está verde.
  - **Pattern**: `pnpm --filter @dsm/web codegen` — mismo comando que
    `apps/web/orval.config.ts` documenta en su docblock. Nunca escribir a
    mano el DTO/Zod resultante (`frontend-standards.md` §3.1/§3.2).
  - **Exit criterion**: `apps/web/src/api/generated/model/customer.ts`
    incluye `avatar_url`; `apps/web/src/api/generated/endpoints.ts` incluye
    la función generada para `PATCH /me`.
  - **Verify**: `grep -q "avatar_url" apps/web/src/api/generated/model/customer.ts && grep -qi "patch" apps/web/src/api/generated/endpoints.ts`
- [x] T0.3 Confirmar que el regen no dejó diff sucio (gate `frontend-codegen-fresh`
  de CI simulado localmente) antes de commitear los archivos generados.
  - **Exit criterion**: correr el codegen dos veces seguidas produce el mismo
    output byte a byte (regenerar no es hand-editable).
  - **Verify**: `pnpm --filter @dsm/web codegen && git diff --exit-code apps/web/src/api/generated/` (verde tras el primer commit de los generados; se corre de nuevo antes de abrir PR)

## Fase 1 — Dominio / capa de servicio

- [ ] T1.1 Crear `apps/web/src/lib/format/avatar.ts` con `initialsFrom(name)`
  y `avatarColor(id)` — funciones puras, sin React, mismo criterio que
  `currency.ts`/`datetime.ts` del mismo directorio.
  - **Pattern**: `per design.md §"Placeholder determinístico — algoritmo"` —
    hash simple `(hash*31 + charCode) >>> 0`, `hue = hash % 360`,
    `hsl(hue 65% 55%)`. Sin librería nueva (US §8).
  - **Exit criterion**: `initialsFrom('Ana María Pérez')` devuelve `'AP'`
    (primera + última palabra); `avatarColor(id)` devuelve el mismo string
    para el mismo `id` en llamadas repetidas.
  - **Verify**: `pnpm --filter @dsm/web vitest run src/lib/format/avatar.test.ts`
- [ ] T1.2 Crear `apps/web/src/components/ui/Avatar.tsx` — componente
  compartido con fallback `onError` a iniciales (nunca el ícono roto nativo).
  - **Pattern**: `frontend-resilience-patterns` skill, patrón #11 (image
    error fallback) — `<img onError={() => setBroken(true)} />`, render
    condicional al círculo de iniciales cuando `broken || !avatarUrl`.
  - **Exit criterion**: sin `avatarUrl`, renderiza el círculo de iniciales
    con `avatarColor(customerId)` de fondo; con `avatarUrl` válido, renderiza
    `<img>`; si el `<img>` dispara `onError`, se re-renderiza como iniciales
    sin romper el layout (mismo tamaño).
  - **Verify**: `pnpm --filter @dsm/web vitest run src/components/ui/Avatar.test.tsx`
- [ ] T1.3 Agregar `updateProfile(input: { name: string; avatar_url: string | null }): Promise<Customer>`
  a `accountService.ts`, llamando la operación generada de `PATCH /me` con
  `conSesion` (mismo criterio que `deleteAccount()`/`me()` del mismo archivo)
  y validando la respuesta con `parseContract` contra el schema Zod generado.
  - **Pattern**: `per accountService.ts` (líneas 111-113, `deleteAccount()`)
    — `await updateProfileOp(input, conSesion); return parseContract(UpdateProfileResponse, res.data)`
    (nombres exactos de la operación/schema generados se confirman en T0.1/T0.2).
  - **Exit criterion**: `updateProfile` nunca acepta ni serializa un campo
    `id`/`customer_id` en el body (AC-7 desde el lado FE); ningún componente
    fuera de `accountService.ts` importa `@/api/generated/endpoints`
    directamente (mismo grep que ya corre T1.1 de `US-014-registro-login-frontend-web`).
  - **Verify**: `grep -c "customer_id\|: *id" apps/web/src/features/account/accountService.ts | grep -q "^0$" ; ! grep -rl "@/api/generated/endpoints" apps/web/src/features/account/ProfileForm.tsx apps/web/src/features/account/AccountPanel.tsx 2>/dev/null`
- [ ] T1.4 Extender `SessionContextValue` en `SessionProvider.tsx` con
  `updateCustomer(patch: Partial<Customer>): void`.
  - **Pattern**: `per SessionProvider.tsx` (líneas 44-47, `onAuthenticated`) —
    `useCallback` que hace `setState(s => s.kind === 'authenticated' ? { ...s, customer: { ...s.customer, ...patch } } : s)`.
  - **Exit criterion**: llamar `updateCustomer({ name: 'X' })` mientras
    `state.kind === 'authenticated'` actualiza `state.customer.name` sin
    tocar los demás campos; llamarlo en cualquier otro `kind` es un no-op.
  - **Verify**: `pnpm --filter @dsm/web vitest run src/features/account/SessionProvider.test.tsx`

## Fase 2 — Componentes UI

- [ ] T2.1 Crear `ProfileForm.tsx` en `apps/web/src/features/account/` —
  formulario nombre + avatar URL, `react-hook-form` + `zodResolver`.
  - **Pattern**: `per ProductForm.tsx` línea 25 —
    `image_url: z.string().url('URL inválida').optional().or(z.literal(''))`
    — **endurecido** con `.refine` de esquema http/https
    (`per design.md §"Formulario — schema Zod"`, el `.url()` solo NO basta
    para AC-5 porque acepta cualquier esquema sintácticamente válido). Banner
    de error/éxito y `FIELD_MAP` por nombre de columna del 422, mismo
    esqueleto que `ProductForm.tsx` líneas 96-117. Eventos
    `profile_edit_attempted/succeeded/failed` (`track(...)`, mismo criterio
    que `DeleteAccountSection.tsx`). Al resolver con éxito, llama
    `session.updateCustomer({ name, avatar_url })` (AC-1).
  - **Exit criterion**: enviar el form con `name` vacío/sólo-espacios NO
    dispara ningún request de red y muestra el mensaje de error en el campo
    (AC-4); enviar con `avatar_url` no-URL o esquema `ftp:`/`javascript:` NO
    dispara request y muestra error en el campo (AC-5); enviar con
    `avatar_url: ''` sobre un cliente con avatar previo envía `avatar_url:
    null` en el body (AC-3); un 422 del backend con `field: 'name'` o
    `field: 'avatar_url'` marca el campo correspondiente vía `setError`.
  - **Verify**: `pnpm --filter @dsm/web vitest run src/features/account/ProfileForm.test.tsx`
- [ ] T2.2 Integrar `<Avatar>` en `ProfileForm`/`AccountPanel`, alimentado
  por el `customer` confirmado de `useSession()` (no por el valor tipeado sin
  guardar — OQ-FE-2, default sin live-preview).
  - **Exit criterion**: tras un `updateProfile` exitoso, el `<Avatar>` visible
    en pantalla cambia de placeholder a `<img>` (AC-2) o de `<img>` a
    placeholder (AC-3) sin recargar la página.
  - **Verify**: cubierto por los casos AC-2/AC-3 de `ProfileForm.test.tsx`
    (mismo archivo que T2.1) — assert sobre el `src`/rol del `<Avatar>`
    renderizado tras `waitFor` del banner de éxito.
- [ ] T2.3 Modificar `AccountPanel.tsx`: sustituir el `dd` estático de
  "Nombre" por `<ProfileForm>`; mantener el `dl` de Email (AC-6, sin ningún
  control de edición) y "Cliente desde" sin cambios; montar `<Avatar>` sobre
  el bloque.
  - **Exit criterion**: el DOM de `/mi-cuenta` no contiene ningún elemento
    interactivo (`input`, `button`, link) asociado al campo Email — sólo
    texto de sólo lectura (AC-6 verificado por ausencia, mismo criterio que
    `design.md` §D5 de US-020 para el botón de borrar).
  - **Verify**: `pnpm --filter @dsm/web vitest run src/features/account/AccountPanel.test.tsx`
- [ ] T2.4 Agregar `profile_edit_attempted`, `profile_edit_succeeded`,
  `profile_edit_failed` a `BusinessEvent` y a `PUBLIC_EVENTS` en
  `apps/web/src/lib/observability/events.ts`.
  - **Pattern**: `per events.ts` líneas 126-129/185-188 (`account_delete_*`)
    — sin PII: ningún evento lleva `name`/`avatar_url`, sólo el nombre del
    evento (mismo criterio que `login_failed`).
  - **Exit criterion**: los 3 eventos están en `PUBLIC_EVENTS` (no llevan
    `operator_id: 'admin'` — son superficie de cliente, no de backoffice).
  - **Verify**: `pnpm --filter @dsm/web vitest run src/lib/observability/events.test.ts` (si no existe un test dedicado, extender `account.events.test.tsx` en T3.7 y correr ese archivo)
- [ ] T2.5 Precargar `buyer.name` en `CheckoutForm.tsx` con el nombre de la
  sesión activa (AC-1, segunda mitad — hallazgo 2026-09-06, confirmado con
  backend: `orders.buyer_name` nunca sale de `Customer.name`, sólo de lo que
  manda este form; hoy no tiene ninguna noción de sesión).
  - **Pattern**: `per design.md §"Precarga de buyer.name en CheckoutForm"` —
    opción `values` de `react-hook-form` (no `defaultValues`, que sólo aplica
    una vez) + `resetOptions: { keepDirtyValues: true }` (disponible desde
    v7.20, el proyecto usa 7.54.2) para no pisar un campo que la persona ya
    tocó si `useSession()` resuelve tarde.
  - **Exit criterion**: la suite existente de `CheckoutForm.test.tsx` sigue
    100% verde (sin sesión, comportamiento idéntico al actual) y con una
    sesión `authenticated` mockeada, `buyer.name` arranca precargado con
    `customer.name`. La matriz completa de escenarios (no-clobber incluido)
    la cubre T3.8.
  - **Verify**: `pnpm --filter @dsm/web vitest run src/features/checkout/CheckoutForm.test.tsx`
- [ ] T2.6 Envolver los `render(...)` de `CheckoutForm.test.tsx`,
  `checkoutA11y.test.tsx` y `CheckoutPage.test.tsx` en `<SessionProvider>`
  (mecánico — con `SessionProvider` en su estado default `anonymous`, ninguna
  aserción existente cambia).
  - **Exit criterion**: los 3 archivos siguen 100% verdes tras el wrap, sin
    editar ninguna aserción preexistente.
  - **Verify**: `pnpm --filter @dsm/web vitest run src/features/checkout/CheckoutForm.test.tsx src/features/checkout/checkoutA11y.test.tsx src/features/checkout/CheckoutPage.test.tsx`

## Fase 3 — Tests unitarios / componente / a11y

- [ ] T3.1 `apps/web/src/lib/format/avatar.test.ts` — determinismo de
  `avatarColor` (mismo id → mismo string en 2 llamadas), casos de
  `initialsFrom` (nombre de una palabra, dos palabras, con espacios extra).
  - **Exit criterion**: 100% de los casos anteriores cubiertos.
  - **Verify**: `pnpm --filter @dsm/web vitest run src/lib/format/avatar.test.ts`
- [ ] T3.2 `apps/web/src/components/ui/Avatar.test.tsx` — sin `avatarUrl`
  renderiza iniciales; con `avatarUrl` renderiza `<img>`; `fireEvent.error`
  sobre el `<img>` degrada a iniciales (AC-3 a nivel componente).
  - **Exit criterion**: los 3 casos anteriores en verde.
  - **Verify**: `pnpm --filter @dsm/web vitest run src/components/ui/Avatar.test.tsx`
- [ ] T3.3 `apps/web/src/features/account/ProfileForm.test.tsx` — matriz
  completa de AC:
  - AC-1: submit con nombre nuevo → banner de éxito → `useSession().state.customer.name`
    actualizado sin nueva llamada a `GET /auth/me`.
  - AC-2: submit con `avatar_url` https válida sobre cliente sin avatar →
    `<Avatar>` pasa a `<img>`.
  - AC-3: submit con `avatar_url: ''` sobre cliente con avatar previo →
    body capturado tiene `avatar_url: null`; `<Avatar>` vuelve a iniciales.
  - AC-4: submit con nombre vacío/sólo-espacios → sin request; error en campo.
  - AC-5: submit con `'no-es-url'` y con `'javascript:alert(1)'` → sin
    request; error en campo en ambos casos.
  - AC-7 (FE-side): body capturado vía `server.use` NUNCA contiene `id` ni
    `customer_id`.
  - Mapeo de errores: 422 con `errors: [{field: 'name', message: '...'}]` →
    `setError` en el campo correcto; 429 → `copyRateLimited`; 500/network →
    banner genérico "No se pudo guardar. Intentá de nuevo." (mismo copy que
    `ProductForm.tsx`).
  - **Exit criterion**: los 9 casos anteriores en verde.
  - **Verify**: `pnpm --filter @dsm/web vitest run src/features/account/ProfileForm.test.tsx`
- [ ] T3.4 Actualizar `AccountPanel.test.tsx` — reemplazar la aserción sobre
  el `dd` estático de nombre por la presencia de `<ProfileForm>` (input con
  label "Nombre" pre-cargado con `customer.name`); agregar caso AC-6
  (ningún `input`/`button` asociado al email).
  - **Exit criterion**: la suite existente sigue verde + el caso AC-6 nuevo.
  - **Verify**: `pnpm --filter @dsm/web vitest run src/features/account/AccountPanel.test.tsx`
- [ ] T3.5 Actualizar `SessionProvider.test.tsx` con el caso de `updateCustomer`
  descrito en T1.4.
  - **Exit criterion**: caso en verde.
  - **Verify**: `pnpm --filter @dsm/web vitest run src/features/account/SessionProvider.test.tsx`
- [ ] T3.6 Extender `a11y.test.tsx` — montar `AccountPanel` con `ProfileForm`
  y correr `axe(container)`; verificar navegación por teclado hasta el botón
  "Guardar" (`Tab` sucesivos, foco visible).
  - **Exit criterion**: `expect(await axe(container)).toHaveNoViolations()`
    sobre el árbol con `ProfileForm` montado, sin nuevas violaciones.
  - **Verify**: `pnpm --filter @dsm/web vitest run src/features/account/a11y.test.tsx`
- [ ] T3.7 Extender `account.events.test.tsx` con los 3 eventos nuevos de
  T2.4 (presentes en `PUBLIC_EVENTS`, sin propiedades PII en el payload
  emitido).
  - **Exit criterion**: caso en verde para los 3 eventos.
  - **Verify**: `pnpm --filter @dsm/web vitest run src/features/account/account.events.test.tsx`
- [ ] T3.8 `CheckoutForm.test.tsx` — matriz completa de la precarga de
  `buyer.name` (AC-1, T2.5):
  - Anónimo (`SessionProvider` default `anonymous`): `buyer.name` arranca
    vacío — comportamiento idéntico al actual, sin regresión.
  - Logueado (`state.kind: 'authenticated'` mockeado con `customer.name`):
    `buyer.name` arranca precargado con ese nombre.
  - Logueado, editando: la persona escribe un nombre distinto en el campo
    ANTES de que la sesión resuelva (mock con una promesa demorada de
    `useSession`) → cuando resuelve, el valor tipeado NO se pierde
    (`keepDirtyValues` real, no sólo el código presente).
  - El campo sigue habilitado/editable en los 3 casos (nunca `readOnly`).
  - **Exit criterion**: los 4 casos anteriores en verde.
  - **Verify**: `pnpm --filter @dsm/web vitest run src/features/checkout/CheckoutForm.test.tsx`

## Fase 4 — E2E (app construida)

- [ ] T4.1 Crear `apps/web/e2e/profile-edit-topology.spec.ts` — mismo
  esqueleto que `account-deletion-topology.spec.ts` (login real por
  `fetch` + lectura de la cookie `dsm_csrf` + assert sobre
  `response.status()`, nunca DOM, F59).
  - **Pattern**: `per account-deletion-topology.spec.ts` líneas 14-51 —
    `login()` + `csrfDeSesion()` helpers reusados/adaptados; el request de
    prueba es `fetch('/v1/me', { method: 'PATCH', headers: { 'X-CSRF-Token': token }, body: JSON.stringify({ name: 'Nuevo Nombre' }) })`.
  - **Exit criterion**: con sesión y CSRF válidos, `PATCH /v1/me` responde
    `200` (no `404` de rewrite ausente — prueba que `/v1/me/:path*` cubre
    también `PATCH`, no sólo `DELETE`/`GET`); sin CSRF, responde `403`.
  - **Verify**: `pnpm --filter @dsm/web exec playwright test e2e/profile-edit-topology.spec.ts` (requiere Fase 0 cerrada — el endpoint real debe existir en el backend contra el que corre Playwright)

## Fase 5 — Documentación

- [ ] T5.1 Ninguna actualización de `README.md` — sin nuevas env vars ni
  dependencias (US §8 exige explícitamente "sin librería nueva").
  - **Exit criterion**: `package.json` de `apps/web` sin diff de
    dependencias tras este change.
  - **Verify**: `git diff --stat apps/web/package.json` (vacío)
- [ ] T5.2 Al `/archive-change`, sumar la sección "Desde US-024
  frontend-web" a `openspec/specs/cuentas/requirements.md`/`decisions.md`
  (nuevo requisito: `ProfileForm` + `Avatar` + `updateCustomer`) — no se
  toca `contracts/openapi.yaml` de `cuentas/` en este change (lo actualiza
  el archive del backend, ver `design.md` §"Spec delta").
  - **Exit criterion**: sección nueva presente tras el archive.
  - **Verify**: manual, ejecutado por `/archive-change` — no aplica en este
    plan.

## Verification (suite-level)

- [ ] Suite completa de `@dsm/web` verde: `pnpm --filter @dsm/web vitest run`
- [ ] Lint + typecheck limpios: `pnpm --filter @dsm/web lint && pnpm --filter @dsm/web typecheck`
- [ ] Codegen fresco (sin diff tras regenerar): `pnpm --filter @dsm/web codegen && git diff --exit-code apps/web/src/api/generated/`
- [ ] E2E de este change verde: `pnpm --filter @dsm/web exec playwright test e2e/profile-edit-topology.spec.ts`
- [ ] Accesibilidad sin violaciones nuevas: incluido en `a11y.test.tsx` (T3.6), corre dentro de la suite completa de Vitest.
