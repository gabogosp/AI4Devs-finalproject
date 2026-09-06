# Tasks — US-015 Historial de compras del cliente (frontend web)

> Per [`AGENTS.md`](../../../spekode/AGENTS.md) §1.1: tasks chicas, una a la vez.
>
> **Gate de contrato ya resuelto al planificar** (2026-09-06): PR #71 (publica el contrato de
> US-015) ya estaba mergeado a `main` (`2a0eb62`) cuando se escribió este plan; esta rama se
> actualizó con `git fetch origin main && git merge --ff-only origin/main` **antes** de escribir
> `design.md`. T0.1 es, por lo tanto, una **verificación**, no un bloqueo — se deja como task
> explícita igual que en `US-021-retencion-datos-ordenes-frontend-web/tasks.md` porque es el
> checkpoint que `/develop-frontend-web` corre antes de tocar código, no un trámite descartable.

## Traceability (AC → tasks)

| AC | Descripción (scope FE) | Task IDs | Estado |
|---|---|---|---|
| AC-1 | Listado con fecha/estado/total, orden desc de la API | T2.1, T3.1, T3.2 | depende de T0.1 |
| AC-2 | Detalle con ítems/cantidades/precios/estado/retiro | T2.1, T4.1 | depende de T0.1 |
| AC-3 | Estado vacío con invitación a comprar | T3.3 | depende de T0.1 |
| AC-4 | Sólo las propias (consumida, no reimplementada) | T2.1 (sin lógica propia — verificación) | no bloqueada |
| AC-5 | Requiere sesión — `CustomerGuard` reusado | T5.1 | no bloqueada |
| AC-6 | Guest no vinculado (consumida) | — (garantía de backend, nada que construir en FE) | fuera de alcance FE, ver `proposal.md` |
| AC-7 | Retención (consumida) | — (garantía de backend, nada que construir en FE) | fuera de alcance FE, ver `proposal.md` |

## Fase 0 — Pre-flight y gate de contrato

- [x] T0.1 Verificar la publicación del contrato de backend (ya resuelto — verificación, no bloqueo)
  - **Depends on**: nada — primera task.
  - **Exit criterion**: `apps/api/docs/api/openapi.yaml` contiene los `operationId`
    `listOrderHistory` y `getOrderHistoryDetail`, Y `apps/web/src/api/generated/model/index.ts`
    exporta `OrderHistorySummary`/`OrderHistoryDetail`.
  - **Verify**: `grep -c "operationId: listOrderHistory" apps/api/docs/api/openapi.yaml` → ≥1 Y
    `grep -c "operationId: getOrderHistoryDetail" apps/api/docs/api/openapi.yaml` → ≥1 Y
    `grep -c "OrderHistorySummary\|OrderHistoryDetail" apps/web/src/api/generated/model/index.ts` → ≥1.
    Si cualquiera da 0, **detener la ejecución del resto de este `tasks.md`** y reportar el
    bloqueo — nunca continuar con un DTO/Zod/mock escrito a mano como sustituto (prohibido por
    `frontend-standards.md` §3.2).
- [x] T0.2 Confirmar rama y ausencia de changes en conflicto
  - **Exit criterion**: rama `feat/US-015-historial-compras-frontend-web` creada desde `main`
    actualizado (ya incluye `2a0eb62`); ningún otro change abierto en `openspec/changes/` toca
    `apps/web/src/features/order-history/` ni `apps/web/app/(storefront)/mi-cuenta/compras/`.
  - **Verify**: `git merge-base --is-ancestor 2a0eb62 HEAD` → exit 0; `ls openspec/changes/ | grep -i historial-compras-frontend` sólo muestra este change.

## Fase 1 — Codegen (verificación de frescura, sin regenerar)

- [x] T1.1 Confirmar que el cliente generado no requiere regeneración
  - **Depends on**: T0.1.
  - **Pattern**: `per openapi-client-codegen skill — regenerate, never hand-edit`. No se corre
    codegen en este change (ya se corrió en PR #71) — sólo se verifica ausencia de diff.
  - **Exit criterion**: `pnpm --filter @dsm/web codegen` no produce cambios en
    `apps/web/src/api/generated/` (el contrato no cambió desde PR #71).
  - **Verify**: `pnpm --filter @dsm/web codegen && git diff --exit-code apps/web/src/api/generated/` → exit 0 (sin diff).
- [x] T1.2 Confirmar que el gate `frontend-codegen-fresh` de CI cubre este change
  - **Exit criterion**: `.github/workflows/frontend-codegen-fresh.yml` ya corre sobre `apps/web`
    — no hace falta wiring nuevo.
  - **Verify**: `grep -q "apps/web" .github/workflows/frontend-codegen-fresh.yml`.

## Fase 2 — Servicio (repository pattern)

- [ ] T2.1 `orderHistoryService.ts` — `list()` y `get()`
  - **Depends on**: T1.1.
  - **Pattern**: `per frontend-standards.md §11.5 — repository pattern` + `§3.3 — service layer
    hand-written, contract mirrors generated`. Mismo criterio que `accountService.ts`: marca
    `session: 'customer'` en cada llamada (ADR-0013) — sin ella la cookie de sesión no viaja.
    Snippet completo en `design.md` §Approach.
  - **Exit criterion**: `orderHistoryService.list({ limit, offset })` llama a
    `listOrderHistory` con `{ session: 'customer' }` y devuelve el resultado parseado con
    `ListOrderHistoryResponse`; `orderHistoryService.get(orderNumber)` llama a
    `getOrderHistoryDetail` con el mismo criterio y `GetOrderHistoryDetailResponse`. Ningún
    `fetch`/`axios` directo; ningún tipo escrito a mano (todos vienen de `@/api/generated/*`).
  - **Verify**: `pnpm --filter @dsm/web typecheck` limpio; nuevo
    `apps/web/src/features/order-history/orderHistoryService.test.ts` con MSW — casos: "list()
    llama a GET /v1/me/orders?limit=20&offset=0 con las cookies de sesión y devuelve data +
    pagination parseados", "get() llama a GET /v1/me/orders/{orderNumber} y devuelve el detalle
    parseado" — `vitest run` verde.

## Fase 3 — Listado (`PurchaseHistoryList` + estado vacío)

- [ ] T3.1 `PurchaseHistoryList` — composición de estados (idle/loading/success/error)
  - **Depends on**: T2.1.
  - **Pattern**: `per frontend-standards.md §11.4/§11.9 — AsyncState + composición explícita de
    estados`, mismo esqueleto que `OrdersList`/`OrderDetail` (`apps/web/src/features/orders/`)
    pero **sin TanStack Table** (`design.md` §Trade-offs — Decisión 1: design-system §7.9 es
    explícitamente panel del dueño). Snippet completo en `design.md` §Approach.
  - **Exit criterion**: al montar, dispara `orderHistoryService.list({ limit: 20, offset: 0 })`;
    renderiza `role="status"` en loading, `role="alert"` + botón "Reintentar" en error, y la
    lista de órdenes en success — cada fila es un `<Link>` a
    `/mi-cuenta/compras/{order_number}` con fecha (`formatDateTime`), `OrderStatusBadge` y total
    (`formatArs`), en el orden exacto que devuelve la API (sin `sort()` en el componente).
  - **Verify**: nuevo `apps/web/src/features/order-history/PurchaseHistoryList.test.tsx` con
    MSW — casos: loading, success con 2+ órdenes (verifica orden de renderizado == orden de la
    respuesta mockeada, sin reordenar), error con reintento — `vitest run` verde.
- [ ] T3.2 "Cargar más" — paginación incremental
  - **Depends on**: T3.1.
  - **Pattern**: `design.md` §Approach — acumula `items` en vez de reemplazar; el botón sólo se
    muestra si `items.length < total`.
  - **Exit criterion**: con `pagination.total` mayor que `pagination.limit`, aparece el botón
    "Cargar más"; al hacer click, pide el siguiente `offset` y **agrega** los resultados nuevos
    al final de la lista existente (no reemplaza los ya mostrados); cuando `items.length ===
    total`, el botón desaparece.
  - **Verify**: `PurchaseHistoryList.test.tsx` — caso con MSW devolviendo `total: 25` en la
    primera página (`limit: 20`) y una segunda página con los 5 restantes al click en "Cargar
    más"; se verifica que las 20 filas originales siguen presentes tras el click (no hay un
    segundo `render`, es el mismo árbol) — `vitest run` verde.
- [ ] T3.3 `PurchaseHistoryEmptyState` (AC-3)
  - **Depends on**: T3.1.
  - **Pattern**: `per design-system.md §10.1/§10.2` + mismo patrón estructural que
    `apps/web/src/features/cart/CartEmptyState.tsx` (copy propio del dominio —
    `design.md` §Trade-offs Decisión 2). Snippet completo en `design.md` §Approach.
  - **Exit criterion**: cuando `orderHistoryService.list(...)` devuelve `data: []`,
    `PurchaseHistoryList` renderiza `PurchaseHistoryEmptyState` (no una tabla vacía, no un
    mensaje genérico) con un CTA `<Link href="/categorias">` que cumple ≥44px de área táctil.
  - **Verify**: `PurchaseHistoryList.test.tsx` — caso "con `data: []`, muestra 'Todavía no
    compraste nada' y el link a /categorias, no un botón 'Cargar más'" — `vitest run` verde.

## Fase 4 — Detalle (`PurchaseDetail`)

- [ ] T4.1 `PurchaseDetail` — composición de estados + 404 distinguido
  - **Depends on**: T2.1.
  - **Pattern**: `per frontend-standards.md §11.4/§11.9` + foco gestionado al cargar (mismo
    patrón que `OrderDetail` admin, `headingRef.current?.focus()`). Snippet completo en
    `design.md` §Approach. `order_number` no numérico (`NaN`) se trata como 404 (AC-4/AC-6/AC-7
    — las tres causas del backend ya son indistinguibles a propósito; un segmento inválido es
    una cuarta causa que debe verse igual, nunca un error distinto que revele la forma
    esperada del identificador).
  - **Exit criterion**: renderiza `role="status"` en loading; en success muestra
    "Pedido #{order_number}", `OrderStatusBadge`, tabla de ítems (producto/cantidad/precio
    unitario/subtotal vía `formatArs`), total, y la sección de retiro (`"Retiro en sucursal"` si
    `fulfillment === 'pickup'`, el valor crudo en cualquier otro caso); en 404 muestra "No
    encontramos ese pedido" SIN botón "Reintentar" (no tiene sentido reintentar un 404) pero SÍ
    un link de vuelta a `/mi-cuenta/compras`; en cualquier otro error (401/429/network/5xx)
    muestra un mensaje genérico CON botón "Reintentar".
  - **Verify**: nuevo `apps/web/src/features/order-history/PurchaseDetail.test.tsx` con MSW —
    casos: loading, success (verifica ítems/total/retiro renderizados), 404 (verifica "No
    encontramos ese pedido" sin botón Reintentar, con link de vuelta), error 500 (verifica
    mensaje genérico CON botón Reintentar), `orderNumber="abc"` (no numérico, sin llamar a la
    red — se comporta como el caso 404 sin disparar `orderHistoryService.get`) — `vitest run`
    verde.

## Fase 5 — Routing e integración

- [ ] T5.1 Páginas de listado y detalle bajo `(storefront)/mi-cuenta/compras`
  - **Depends on**: T3.1, T4.1.
  - **Pattern**: `per ADR-0010 — namespace storefront vs admin` (confirmado: `/mi-cuenta/*` es
    storefront, sin conflicto de namespace) + mismo esqueleto que
    `app/(storefront)/mi-cuenta/page.tsx` (envolver en `CustomerGuard`, `metadata.robots:
    {index:false, follow:false}`) y `app/(admin)/admin/ordenes/[id]/page.tsx` (Server Component
    que desenvuelve `params` y monta un componente cliente). Snippets completos en `design.md`
    §Approach.
  - **Exit criterion**: `apps/web/app/(storefront)/mi-cuenta/compras/page.tsx` monta
    `<CustomerGuard><PurchaseHistoryList /></CustomerGuard>`, con `metadata.robots.index: false`.
    `apps/web/app/(storefront)/mi-cuenta/compras/[orderNumber]/page.tsx` desenvuelve
    `params.orderNumber` y monta `<CustomerGuard><PurchaseDetail orderNumber={orderNumber}
    /></CustomerGuard>`. Sin sesión, ninguna de las dos rutas renderiza contenido de órdenes
    (AC-5) — `CustomerGuard` redirige a `/ingresar?next=...` antes.
  - **Verify**: `pnpm --filter @dsm/web build` sin errores de rutas (confirma que no hay
    conflicto de segmento dinámico, mismo chequeo que detectó el bug original de ADR-0010);
    nuevo caso en `apps/web/src/features/account/CustomerGuard.test.tsx` (o un test dedicado en
    el feature nuevo) verificando que, con `state.kind === 'anonymous'`, ni
    `PurchaseHistoryList` ni `PurchaseDetail` llegan a montarse (ningún `fetch` a
    `/v1/me/orders*` se dispara) — `vitest run` verde.
- [ ] T5.2 Cerrar el placeholder de `AccountPanel`
  - **Depends on**: T5.1.
  - **Pattern**: reemplaza el bloque `<section>` "Tus compras — Próximamente" (líneas 40-45
    actuales de `AccountPanel.tsx`) por un link real. Snippet exacto en `design.md` §Approach.
  - **Exit criterion**: `AccountPanel` ya no contiene el texto "Próximamente"; en su lugar hay
    un `<Link href="/mi-cuenta/compras">` con el texto "Ver historial de compras".
  - **Verify**: `apps/web/src/features/account/AccountPanel.test.tsx` — caso nuevo "muestra un
    link a /mi-cuenta/compras y ya no muestra 'Próximamente'" (regresión sobre el test
    existente, que hoy probablemente asertaba lo contrario — actualizar esa aserción, no
    duplicar el test) — `vitest run` verde.

## Fase 6 — Observabilidad

- [ ] T6.1 Eventos `order_history_*` / `order_detail_*`
  - **Pattern**: `per observability-patterns skill §9.5` + mismo criterio que `cart_viewed`
    (superficie de cliente, no de operador — van en `PUBLIC_EVENTS`, nunca con `operator_id:
    'admin'` por defecto). Ninguno lleva PII: `OrderHistorySummary`/`OrderHistoryDetail` no
    tienen `buyer_name`/`buyer_email`/`buyer_phone` en su shape (a diferencia de
    `AdminOrderSummary`), así que no hay nada que filtrar por accidente.
  - **Exit criterion**: `BusinessEvent` (`apps/web/src/lib/observability/events.ts`) incluye
    `order_history_shown`, `order_history_load_more_clicked`, `order_detail_shown`,
    `order_detail_not_found` — los cuatro agregados a `PUBLIC_EVENTS`. `PurchaseHistoryList`
    emite `order_history_shown` con `{ item_count }` una sola vez por montaje exitoso (no por
    cada re-render) y `order_history_load_more_clicked` al click en "Cargar más" (sin
    propiedades adicionales). `PurchaseDetail` emite `order_detail_shown` con `{ order_number }`
    en success, y `order_detail_not_found` con `{ order_number }` en el caso 404.
  - **Verify**: nuevo `apps/web/src/features/order-history/orderHistory.events.test.tsx` (mismo
    estilo que `apps/web/src/features/orders/orders.events.test.tsx`) — casos: "emite
    order_history_shown una sola vez con item_count correcto aunque el componente re-renderice",
    "emite order_detail_shown con order_number y SIN buyer_name/buyer_email aunque el mock los
    incluyera" (centinela anti-fuga, mismo patrón que el precedente), "un 404 emite
    order_detail_not_found, no order_detail_shown" — `vitest run` verde.

## Fase 7 — Accesibilidad

- [ ] T7.1 Auditoría axe-core de `PurchaseHistoryList` y `PurchaseDetail`
  - **Pattern**: nuevo `apps/web/src/features/order-history/a11y.test.tsx`, mismo `auditar()`
    helper que `apps/web/src/features/orders/a11y.test.tsx` (copiar el helper, no importarlo
    cruzado entre features — cada feature es dueño de su propio test de a11y).
  - **Exit criterion**: cero violaciones `serious`/`critical` en: `PurchaseHistoryList` con
    datos, `PurchaseHistoryList` en estado vacío, `PurchaseDetail` con datos.
  - **Verify**: `apps/web/src/features/order-history/a11y.test.tsx` — `vitest run` verde.

## Fase 8 — Documentación

- [ ] T8.1 Evaluar necesidad de README de feature (esperado: no)
  - **Pattern**: mismo criterio que `US-021-retencion-datos-ordenes-frontend-web` T7.1 — sólo
    `apps/web/src/features/cart/` tiene README hoy; ni `features/orders/` ni `features/account/`
    lo tienen. Crear uno nuevo sólo para `order-history/` rompería esa convención sin motivo
    (YAGNI).
  - **Exit criterion**: decisión documentada (sin README nuevo) O, si al ejecutar se decide que
    hace falta, un README breve creado — cualquiera de las dos cierra la task, no ambas a medias.
  - **Verify**: `find apps/web/src/features/order-history -iname "README*"` — si no existe, la
    ausencia está explícitamente confirmada como decisión (este mismo comentario) y no como
    olvido.

## Verification (suite-level)

- [ ] Unit + component completos: `pnpm --filter @dsm/web test` (forma terminante, `vitest run`
  ya configurado en `package.json` — sin riesgo F49 de modo watch).
- [ ] Typecheck limpio: `pnpm --filter @dsm/web typecheck`.
- [ ] Lint limpio: `pnpm --filter @dsm/web lint`.
- [ ] Codegen sin diff pendiente: `pnpm --filter @dsm/web codegen && git diff --exit-code apps/web/src/api/generated/`.
- [ ] Gate de contrato consumido (F48): `bash spekode/scripts/check-consumer-contract.sh` (o el
  script equivalente que respalda `.github/workflows/consumer-contract-check.yml`) sin
  hallazgos nuevos en `apps/web/src/features/order-history/`.
- [ ] Build de Next sin errores de rutas: `pnpm --filter @dsm/web build`.
- [ ] a11y: `apps/web/src/features/order-history/a11y.test.tsx` verde.
- [ ] Ningún test de este change usa un DTO/Zod/mock hand-escrito fuera de
  `apps/web/src/api/generated/` para `listOrderHistory`/`getOrderHistoryDetail` — verificación
  manual: `grep -rn "OrderHistorySummary\|OrderHistoryDetail" apps/web/src/features/order-history/*.test.ts*`
  sólo debe referenciar tipos importados desde `@/api/generated/*` o desde
  `./orderHistoryService`, nunca una interfaz declarada ad-hoc en el archivo de test.

## Pre-merge checklist

- [ ] T0.1 confirmado verde (contrato publicado — si no lo está, este change no se mergea, sólo
  queda planificado).
- [ ] Todos los tests pasan localmente (`vitest run`).
- [ ] Linter y typecheck limpios.
- [ ] Sin console errors/warnings nuevos en `pnpm --filter @dsm/web dev` al abrir
  `/mi-cuenta/compras` (con y sin compras) y `/mi-cuenta/compras/{orderNumber}` (válido, ajeno,
  inexistente) — verificación manual en navegador.
- [ ] PR describe el ticket (US-015), referencia este change
  (`openspec/changes/US-015-historial-compras-frontend-web/`) y menciona que depende de PR #70 +
  PR #71 (ambos ya mergeados a `main` al momento de planificar).
