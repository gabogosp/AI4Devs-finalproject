# Tasks — US-021 Frontend Web (retención y anonimización de órdenes)

> Per [`AGENTS.md`](../../../spekode/AGENTS.md) §1.1: tasks chicas, una a la vez.
> **T0.1/T0.2 resueltas (2026-09-05, PR #52, `91aa3f1`)** — el contrato publicado
> (`apps/api/docs/api/openapi.yaml`) ya incluye `admin-orders-retention` +
> `anonymized_at`/`anonymization_reason`, el contrato vivo de `openspec/specs/ordenes/` está
> sincronizado, y `apps/web/src/api/generated/` ya fue regenerado. El resto de las tasks se
> ejecuta en orden normal.

## Traceability (AC → tasks)

| AC | Descripción (scope FE) | Task IDs | Estado |
|---|---|---|---|
| AC-3 | Acción "anonimizar" con confirmación de dos pasos | T2.1, T3.1, T3.2 | depende de T0.1 |
| AC-4 | Se ve cuándo y por qué motivo se anonimizó | T3.3, T4.1 | depende de T0.1/T0.2 |
| AC-5 | Orden anonimizada sigue operable, PII sustituida por indicación | T4.1, T4.2 | depende de T0.1/T0.2 |
| AC-8 (UI) | La acción no se reofrece sobre una orden ya anonimizada | T3.1 | depende de T0.1 |
| AC-9 (FE) | Sólo alcanzable dentro de `(admin)` | T1.3 (verificación, sin código nuevo) | no bloqueada |

## Fase 0 — Pre-flight y gate de contrato

- [x] T0.1 Verificar (o disparar) la publicación del contrato de backend
  - **Depends on**: nada — es la primera task, y bloquea todo lo demás.
  - **Qué falta exactamente** (ver `design.md` §"El gap de contrato"): dos paths
    (`/admin/orders/{id}/anonymize`, `/admin/orders/retention-sweep`) ausentes de
    `apps/api/docs/api/openapi.yaml`, y el schema `AdminOrderDetail` de ese mismo archivo
    sin `anonymized_at`/`anonymization_reason`.
  - **No es tarea de este agente resolverlo** (backend, fuera de `apps/web`) — esta task es
    el checkpoint que `/develop-frontend-web` corre ANTES de tocar cualquier código.
  - **Exit criterion**: `apps/api/docs/api/openapi.yaml` contiene el tag
    `admin-orders-retention` con los dos paths, Y el schema `AdminOrderDetail` de ese
    archivo tiene `anonymized_at`/`anonymization_reason` como propiedades nullable.
  - **Verify**: `grep -c "admin-orders-retention" apps/api/docs/api/openapi.yaml` → ≥ 1, Y
    `grep -c "anonymized_at" apps/api/docs/api/openapi.yaml` → ≥ 1. Si cualquiera de los
    dos da 0, **detener la ejecución del resto de este `tasks.md`** y reportar el bloqueo
    — nunca continuar con un DTO/Zod/mock escrito a mano como sustituto (prohibido por
    `frontend-standards.md` §3.2).
- [x] T0.2 Sincronizar el contrato vivo de la capability (`openspec/specs/ordenes/`)
  - **Depends on**: T0.1 resuelto.
  - **Pattern**: corrección de contrato — agregar al `AdminOrderDetail` de
    `openspec/specs/ordenes/contracts/openapi.yaml` las mismas 2 propiedades que ya
    publicó el backend en T0.1 (copiar la forma exacta, no reinventar tipos).
  - **Exit criterion**: `openspec/specs/ordenes/contracts/openapi.yaml` declara
    `anonymized_at`/`anonymization_reason` en `AdminOrderDetail`, coincidiendo con el
    contrato publicado del backend.
  - **Verify**: `npx --yes @stoplight/spectral-cli lint openspec/specs/ordenes/contracts/openapi.yaml` sin errores, y `grep -c "anonymized_at" openspec/specs/ordenes/contracts/openapi.yaml` ≥ 1.
- [x] T0.3 Confirmar rama y ausencia de changes en conflicto
  - **Exit criterion**: rama `feat/US-021-retencion-datos-ordenes-frontend-web` (o
    equivalente per `git-workflow-standards.md`) creada desde `main` actualizado; ningún
    otro change abierto en `openspec/changes/` toca `apps/web/src/features/orders/`.
  - **Verify**: `git log --oneline main..HEAD` no vacío tras el primer commit; `ls openspec/changes/ | grep -i orders` no muestra otro change de frontend-web activo sobre el mismo módulo.

## Fase 1 — Codegen (contrato → cliente)

- [x] T1.1 Regenerar el cliente, Zod y mocks del panel
  - **Depends on**: T0.1.
  - **Pattern**: `pnpm --filter @dsm/web codegen` (orval, `apps/web/orval.config.ts`) — NO
    se edita nada dentro de `apps/web/src/api/generated/` a mano. `per openapi-client-codegen skill — regenerate, never hand-edit`.
  - **Exit criterion**: `@/api/generated/endpoints` exporta `anonymizeOrder`;
    `@/api/generated/zod` exporta el schema de respuesta de esa operación;
    `@/api/generated/model` incluye `anonymized_at`/`anonymization_reason` en
    `AdminOrderDetail`. `@/api/generated/msw` (o el archivo mock generado equivalente)
    incluye un handler por defecto para `POST /admin/orders/:id/anonymize`.
  - **Verify**: `pnpm --filter @dsm/web codegen && git diff --exit-code apps/web/src/api/generated/` — el segundo comando debe fallar en la corrida INICIAL (hay diff nuevo, se commitea) y dar limpio en corridas subsiguientes sin más cambios de contrato (mismo criterio que el gate `frontend-codegen-fresh`).
- [x] T1.2 Confirmar que el gate `frontend-codegen-fresh` de CI corre sobre este change
  - **Exit criterion**: el workflow `.github/workflows/frontend-codegen-fresh.yml` ya
    existe y corre en cada PR — no hace falta wiring nuevo, sólo confirmar cobertura.
  - **Verify**: `grep -q "apps/web" .github/workflows/frontend-codegen-fresh.yml` (o el
    path/glob equivalente que dispare el workflow sobre `apps/web`).
- [x] T1.3 Confirmar que AC-9 (FE) no requiere código nuevo
  - **Pattern**: verificación, no implementación — `apps/web/app/(admin)/layout.tsx`
    envuelve toda la route group con `AdminGuard` (`apps/web/src/features/auth/guard.tsx`);
    `OrderDetail`/`OrderAnonymizeAction` se montan siempre dentro de esa route.
  - **Exit criterion**: no existe ningún acceso a `OrderDetail`/`OrderAnonymizeAction` fuera
    de `apps/web/app/(admin)/`.
  - **Verify**: `grep -rL "app/(admin)" $(grep -rl "OrderAnonymizeAction" apps/web/app 2>/dev/null)` da vacío (no hay ninguna ruta fuera de `(admin)` que la use); adicionalmente, `apps/web/src/features/auth/guard.test.tsx` sigue verde sin modificar.

## Fase 2 — Servicio (repository pattern)

- [x] T2.1 `ordersService.anonymize(id)`
  - **Depends on**: T1.1.
  - **Pattern**: `per frontend-standards.md §11.5 — repository pattern` + `§3.3 — service
    layer hand-written, contract mirrors generated`. Mismo archivo que `get`/`updateStatus`
    (`apps/web/src/features/orders/ordersService.ts`), misma forma:
    ```ts
    async anonymize(id: string) {
      const res = await anonymizeOrder(id);
      return parseContract(AnonymizeOrderResponse, res.data);
    }
    ```
  - **Exit criterion**: `ordersService.anonymize` existe, tipado con los tipos generados
    (nunca un tipo escrito a mano), y usa `anonymizeOrder` del cliente generado — ningún
    `fetch`/`axios` directo.
  - **Verify**: `pnpm --filter @dsm/web typecheck` limpio; `apps/web/src/features/orders/ordersService.test.ts` — nuevo caso `anonymize() llama a POST /admin/orders/{id}/anonymize y devuelve el resultado parseado` verde (`vitest run`).

## Fase 3 — Componente `OrderAnonymizeAction`

- [x] T3.1 Componente base — botón + `ConfirmDialog` + estado busy/error/message
  - **Depends on**: T2.1.
  - **Pattern**: `per frontend-standards.md §11.bis.5 — destructive action confirmation` +
    mismo esqueleto que `apps/web/src/features/products/ProductActions.tsx` (reuso directo
    de `@/components/ui/ConfirmDialog`, sin crear un segundo componente de diálogo). Ver
    snippet completo en `design.md` §Approach.
  - **Exit criterion**: si `order.anonymizedAt` no es `null`, el componente no renderiza
    nada (`return null`) — AC-8 (UI). Si es `null`, renderiza el botón "Anonimizar datos
    del comprador"; al hacer click abre `ConfirmDialog`; el botón de confirmar sólo se
    habilita cuando el texto tipeado coincide con `ANONIMIZAR`.
  - **Verify**: `apps/web/src/features/orders/OrderAnonymizeAction.test.tsx` (nuevo) —
    casos: "no renderiza nada si la orden ya está anonimizada", "abre el ConfirmDialog al
    click", "el botón de confirmar está deshabilitado hasta tipear la palabra exacta" —
    `vitest run` verde.
- [x] T3.2 Wiring de la mutación — éxito y error
  - **Depends on**: T3.1.
  - **Exit criterion**: al confirmar, llama a `ordersService.anonymize(id)`; en éxito,
    hace un segundo `ordersService.get(id)` y llama a `onAnonymized(refreshed)`; en error,
    muestra `role="alert"` con mensaje distinto para 404 (`notFound`) vs cualquier otro
    (genérico "No se pudo anonimizar. Reintentá."); en ambos casos el diálogo se cierra
    sólo en el camino de éxito.
  - **Verify**: `OrderAnonymizeAction.test.tsx` — casos con MSW: éxito (`server.use` de
    `POST .../anonymize` 200 + `GET .../{id}` 200 con `anonymized_at` seteado → llama
    `onAnonymized` con el objeto refrescado), error 404, error 500/network — `vitest run`
    verde. `msw-setup` skill: handlers via `server.use`, reset en `afterEach` (ya
    configurado en `apps/web/src/test/setup.ts`, sin tocar).
- [x] T3.3 Copy y tono
  - **Pattern**: `per design-system.md §10.2 — voz/tono "práctico y confiable"`, mismo
    registro que "¿Seguro que querés cancelar esta orden? Esta acción no se puede
    deshacer.". Copy exacto: título "Anonimizar datos del comprador", descripción "Se van a
    reemplazar el nombre, el email y el teléfono del comprador por un valor genérico. Los
    productos, importes, estado y fechas de la orden NO cambian. Esta acción no se puede
    deshacer.", palabra de confirmación `ANONIMIZAR`.
  - **Exit criterion**: el copy del componente coincide textualmente con lo anterior (o una
    variante aprobada por Producto si la open question #2 de `proposal.md` se resuelve con
    cambios).
  - **Verify**: `screen.getByText(/Esta acción no se puede deshacer/)` presente en
    `OrderAnonymizeAction.test.tsx`.

## Fase 4 — Integración en `OrderDetail`

- [x] T4.1 Sección de contacto condicional (AC-4/AC-5)
  - **Depends on**: T0.2, T3.2.
  - **Pattern**: `per frontend-standards.md §11.bis.4 — audit trail surfacing` (mostrar
    cuándo + por qué junto al dato, no en un log aparte). Ver snippet completo en
    `design.md` §Approach — reemplaza el bloque `<dl>` de nombre/email/teléfono por un
    párrafo cuando `order.anonymized_at` no es `null`.
  - **Exit criterion**: con `anonymized_at` seteado, la sección "Datos de contacto" NO
    muestra `buyer_name`/`buyer_email`/`buyer_phone`; muestra la fecha/hora de
    anonimización y distingue "a pedido del comprador" (`requested`) de "por plazo de
    retención cumplido" (`retention_policy`). Con `anonymized_at: null`, el comportamiento
    es idéntico al actual (sin regresión).
  - **Verify**: `apps/web/src/features/orders/OrderDetail.test.tsx` — 2 casos nuevos: orden
    no anonimizada (regresión: sigue mostrando buyer_email) y orden anonimizada (muestra la
    indicación, NO muestra buyer_email/buyer_phone/buyer_name reales) — `vitest run` verde.
- [x] T4.2 Montar `OrderAnonymizeAction` dentro de `OrderDetail`
  - **Depends on**: T4.1.
  - **Exit criterion**: `OrderDetail` pasa `{ id, anonymizedAt, anonymizationReason }` a
    `OrderAnonymizeAction` y usa el mismo `onConfirmed` que ya usa `OrderStatusActions` para
    reemplazar el estado (`setState({ status: 'success', data: updated })`) — sin
    duplicar lógica de actualización de estado.
  - **Verify**: `OrderDetail.test.tsx` — caso "tras confirmar la anonimización, la sección
    de contacto se actualiza sin recargar la página completa (no hay un segundo `render`)"
    — `vitest run` verde.
- [x] T4.3 Helper de formato de fecha (o reuso)
  - **Pattern**: verificar primero si `OrderStatusHistory.tsx` ya tiene un helper de
    formato de `changed_at`; si existe, reusarlo tal cual (no duplicar formato de fecha en
    dos lugares del mismo feature). Si no existe, crear
    `apps/web/src/lib/format/datetime.ts` con `Intl.DateTimeFormat('es-AR', {...})`, mismo
    criterio que `formatArs` en `lib/format/currency.ts` (un solo lugar, server+client).
  - **Exit criterion**: la fecha de anonimización se muestra en formato local `es-AR`
    consistente con el resto del panel (mismo formato que `status_history`).
  - **Verify**: `grep -rn "Intl.DateTimeFormat" apps/web/src/features/orders/ apps/web/src/lib/format/` muestra un único punto de definición reusado por ambos consumidores (no dos implementaciones distintas).

## Fase 5 — Observabilidad

- [x] T5.1 Eventos `order_anonymize_*`
  - **Pattern**: `per observability-patterns skill §9.5` + mismo criterio que
    `order_status_change_*` — sólo `{ order_id }`, nunca PII ni `anonymization_reason` en
    el payload (ver `design.md` §Observabilidad para el razonamiento completo).
  - **Exit criterion**: `BusinessEvent` (`apps/web/src/lib/observability/events.ts`) incluye
    `order_anonymize_attempted` / `_succeeded` / `_failed`; cada `track(...)` en
    `OrderAnonymizeAction` manda únicamente `{ order_id }`.
  - **Verify**: nuevo test `apps/web/src/features/orders/orders.events.test.tsx` — caso
    "OrderAnonymizeAction emite attempted antes del POST y succeeded al confirmar, sin
    buyer_name/buyer_email/anonymization_reason" (mismo estilo que el test ya existente
    para `OrderStatusActions` en el mismo archivo) — `vitest run` verde.

## Fase 6 — Accesibilidad

- [x] T6.1 Auditoría axe-core del `OrderDetail` con orden anonimizada
  - **Pattern**: extender `apps/web/src/features/orders/a11y.test.tsx` (no crear un archivo
    nuevo) con un tercer caso, mismo `auditar()` helper ya definido ahí.
  - **Exit criterion**: cero violaciones `serious`/`critical` en `OrderDetail` cuando la
    orden está anonimizada (con `OrderAnonymizeAction` no renderizado, por AC-8) y cuando
    no lo está (con el botón + diálogo cerrado visibles).
  - **Verify**: `apps/web/src/features/orders/a11y.test.tsx` — nuevo `it(...)` — `vitest run` verde.
- [x] T6.2 Foco del `ConfirmDialog` reusado — sin regresión
  - **Pattern**: `ConfirmDialog` ya tiene sus propios tests
    (`apps/web/src/components/ui/ui.test.tsx` probablemente cubre foco/Escape) — esta task
    es verificar que reusarlo desde `OrderAnonymizeAction` no rompe ese comportamiento, no
    reimplementarlo.
  - **Exit criterion**: al abrir el diálogo desde `OrderAnonymizeAction`, el foco entra al
    input de confirmación; `Escape` cierra sin ejecutar la mutación.
  - **Verify**: caso en `OrderAnonymizeAction.test.tsx` — `userEvent.keyboard('{Escape}')`
    tras abrir el diálogo → `ordersService.anonymize` NO fue llamado (spy/mock sin
    invocaciones) — `vitest run` verde.

## Fase 7 — Documentación

- [x] T7.1 Nota en el README del feature (si existe) o comentario de cabecera
  - **Pattern**: mismo estilo que las notas de `apps/api/src/checkout/README.md` — si
    `apps/web/src/features/orders/` tiene un README, agregar una sección breve
    "Anonimización (US-021)"; si no existe README de feature en este módulo (no se detectó
    uno al inspeccionar el árbol), un comentario de cabecera en
    `OrderAnonymizeAction.tsx` documentando el porqué del refetch-on-success y la
    dependencia del contrato (T0.1) es suficiente — no crear un README nuevo sólo para
    esto (YAGNI).
  - **Exit criterion**: la decisión de refetch-on-success (vs. optimista) queda documentada
    en el código, citando por qué difiere de `OrderStatusActions`.
  - **Verify**: `grep -n "refetch" apps/web/src/features/orders/OrderAnonymizeAction.tsx` ≥ 1 coincidencia.

## Verification (suite-level)

- [x] Unit + component completos: `pnpm --filter @dsm/web test` (forma terminante, ya
  configurada como `vitest run` en `package.json` — no hay riesgo F49 de modo watch).
- [x] Typecheck limpio: `pnpm --filter @dsm/web typecheck`.
- [x] Lint limpio: `pnpm --filter @dsm/web lint`.
- [x] Codegen sin diff pendiente: `pnpm --filter @dsm/web codegen && git diff --exit-code apps/web/src/api/generated/`.
- [x] Gate de contrato consumido (F48): `bash scripts/check-consumer-contract.sh` (o el
  script equivalente que respalda `.github/workflows/consumer-contract-check.yml`) sin
  hallazgos nuevos en `apps/web/src/features/orders/`.
- [x] a11y: `apps/web/src/features/orders/a11y.test.tsx` verde (incluye el caso nuevo de
  T6.1).
- [x] Ningún test de este change usa un DTO/Zod/mock hand-escrito fuera de
  `apps/web/src/api/generated/` para la operación `anonymizeOrder` — verificación manual:
  `grep -rn "anonymize" apps/web/src/features/orders/*.test.tsx` sólo debe referenciar
  tipos importados desde `@/api/generated/*` o desde `./ordersService`, nunca una
  interfaz declarada ad-hoc en el archivo de test.

## Pre-merge checklist

- [x] T0.1 resuelto (contrato publicado) — **si no lo está, este change no se mergea**,
  sólo se deja planificado.
- [x] Todos los tests pasan localmente (`vitest run`).
- [x] Linter y typecheck limpios.
- [ ] Sin console errors/warnings nuevos en `pnpm --filter @dsm/web dev` al abrir
  `/admin/ordenes/{id}` de una orden anonimizada y de una no anonimizada.
- [ ] PR describe el ticket (US-021), referencia este change
  (`openspec/changes/US-021-retencion-datos-ordenes-frontend-web/`) y **linkea el follow-up
  de backend** que resolvió T0.1.
