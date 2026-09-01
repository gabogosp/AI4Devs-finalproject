# Tasks — US-012 Frontend: Panel de órdenes del dueño

> Per `AGENTS.md` §1.1: tasks chicas, una a la vez. Las Fases 1-11 (fulfillment) están
> bloqueadas por T0.1 (ver Pre-requisitos) — `/develop-frontend-web` NO debe avanzar más allá
> de la Fase 0 mientras T0.1 siga en rojo. La Fase 12 (pendientes de pago) tiene su propio gate
> independiente, T0.3 — puede desarrollarse en paralelo o después, según cuándo aterrice
> `US-023-pago-manual-offline-backend`; no depende de T0.1.
>
> **Actualización 2026-08-30 (realineación)**: se corrigieron todas las referencias a
> `confirmed_at` (columna inexistente → `created_at`) y a `sort` como param libre (→ enum
> cerrado de 6 valores) en T4.1. Se agregó la Fase 12 completa (`PendingPaymentsPanel`, nota
> §10 de la US, sin AC formal — ver `proposal.md` OQ-FE-4).

## Traceability matrix (AC de la US → tasks)

| AC | Descripción | Task IDs |
|---|---|---|
| AC-1 | Ver listado (paginable/ordenable/filtrable) | T4.1, T4.2, T4.3 |
| AC-2 | Ver detalle | T5.1, T5.2 |
| AC-3 | Avanzar estado | T6.1, T6.2 |
| AC-4 | "Lista" avisa al cliente (trigger FE) | T6.1, T6.2 |
| AC-5 | Filtrar por estado | T4.1, T4.3 |
| AC-6 | Transición inválida bloqueada | T3.1, T6.1, T6.3 |
| AC-7 | Acceso restringido | T8.1 |
| AC-8 | Solo pagadas | T4.1 |
| AC-9 | Trazabilidad de cambios | T7.1, T7.2 |
| *(sin AC formal — ver proposal.md OQ-FE-4)* | `PendingPaymentsPanel` (nota §10 de la US) | T12.1, T12.2, T12.3, T12.4 |

## Pre-requisitos

- [x] **T0.1 — Gate de contrato: `/admin/orders` debe existir en el OpenAPI del backend**
  - Este change consume `GET /v1/admin/orders`, `GET /v1/admin/orders/{id}`,
    `PATCH /v1/admin/orders/{id}`, que hoy **no existen** en
    `apps/api/docs/api/openapi.yaml` (verificado 2026-08-30). Dependen únicamente de
    `US-012-panel-ordenes-dueno-backend` (regenerado 2026-08-30, 0 tasks ejecutadas — ya NO
    depende de `US-010-orden-webhook-stock-backend`, que su propio proposal.md desacopló: la
    tabla `orders`/`order_items` ya existe desde `US-008`, mergeado).
  - **Exit criterion**: `apps/api/docs/api/openapi.yaml` declara los tres paths
    `/admin/orders` y `/admin/orders/{id}` con un schema de orden que incluya
    `status: enum [new, preparing, ready, delivered]` y `created_at` (nunca `confirmed_at`,
    que no existe como columna).
  - **Verify**: `grep -E "^  /admin/orders" apps/api/docs/api/openapi.yaml | wc -l` → debe
    imprimir `2` (las dos rutas: `/admin/orders` y `/admin/orders/{id}`). Hoy imprime `0` —
    esta task **falla a propósito** hasta que el backend publique el contrato; ninguna task
    de las Fases 1-12 puede marcarse cerrada mientras esta falle.
  - **Nota de ejecución (2026-08-30)**: `US-012-panel-ordenes-dueno-backend` completó sus
    22/22 tasks (PR #22) y publicó el contrato. `grep` imprime `2`. Schema confirmado con
    `status: enum [new, preparing, ready, delivered]` y `created_at` (sin `confirmed_at`).
    Gate desbloqueado — Fases 1-11 ejecutables.
- [x] **T0.2 — Confirmar que no hay change en curso que colisione**
  - **Exit criterion**: no existe otro directorio en `openspec/changes/` que declare rutas
    `app/(admin)/admin/ordenes/*` o el feature `apps/web/src/features/orders/`.
  - **Verify**: `grep -rl "features/orders\|admin/ordenes" openspec/changes/*/design.md
    2>/dev/null | grep -v US-012-panel-ordenes-dueno-frontend-web` → debe imprimir vacío.
  - **Nota de ejecución (2026-08-30)**: el grep encuentra
    `openspec/changes/US-012-panel-ordenes-dueno-qa/design.md` — no es una colisión, es el
    change hermano de QA de esta misma US describiendo qué rutas testea (línea 147, "el
    plan de FE que fijó /admin/ordenes..."). No es un change *distinto* construyendo el
    mismo feature — la intención del gate (evitar dos FE compitiendo por la misma
    superficie) está satisfecha.
- [ ] **T0.3 — Gate de contrato (pendientes de pago): `pending-payment`/`confirm-payment` deben
  existir en el OpenAPI del backend antes de cerrar la Fase 12**
  - Este gate es **específico de la Fase 12** (`PendingPaymentsPanel`) — a diferencia de T0.1,
    NO bloquea las Fases 1-11 (fulfillment), que solo dependen de
    `US-012-panel-ordenes-dueno-backend`. Depende de
    `US-023-pago-manual-offline-backend` (planificado, 0 tasks ejecutadas, worktree separado).
  - **Exit criterion**: `apps/api/docs/api/openapi.yaml` declara
    `GET /admin/orders/pending-payment` y `POST /admin/orders/{orderId}/confirm-payment`.
  - **Verify**: `grep -c "pending-payment\|confirm-payment" apps/api/docs/api/openapi.yaml` →
    mayor que `0`. Hoy imprime `0` — esta task falla a propósito hasta que
    `US-023-pago-manual-offline-backend` publique su contrato; T12.1-T12.4 no pueden cerrarse
    mientras esta falle (T1.1-T11.1 sí pueden, son independientes).

## Fase 1: Codegen (contract-derived artifacts)

- [x] **T1.1 — Regenerar el cliente/Zod/MSW desde el contrato**
  - **Pattern**: `orval.config.ts` ya declara `dsmCatalog` (cliente+MSW) y `dsmCatalogZod`
    (validación) apuntando a `../api/docs/api/openapi.yaml` completo — no hace falta tocar la
    config, solo re-ejecutar `codegen` una vez el contrato tenga los paths de T0.1. Per
    `frontend-standards.md` §3.1/§3.2 y el skill `openapi-client-codegen`: los tipos/Zod/mocks
    de órdenes se **generan**, nunca se escriben a mano.
  - **Exit criterion**: `apps/web/src/api/generated/model/` incluye tipos de orden admin
    (resumen, detalle, estado); `apps/web/src/api/generated/zod.ts` incluye los schemas
    correspondientes; `apps/web/src/api/generated/endpoints.ts` incluye las 3 operaciones.
  - **Verify**: `pnpm --filter @dsm/web codegen` sale con código 0, y
    `grep -ril "order" apps/web/src/api/generated/model/ | wc -l` → mayor que `0`.

## Fase 2: Dominio (repositorio + FSM pura)

- [x] **T2.1 — `ordersService.ts`**
  - **Pattern**: mismo shape que `apps/web/src/features/products/productsService.ts` —
    re-exporta tipos generados, envuelve las operaciones generadas con `parseContract`
    (nunca `fetch` crudo, F48). Ver `design.md` D3 para el shape exacto.
  - **Exit criterion**: `ordersService.list/get/updateStatus` existen, tipados con los tipos
    generados en T1.1, y `updateStatus` acepta un `idempotencyKey` que viaja como header
    `idempotency-key`.
  - **Verify**: `pnpm --filter @dsm/web vitest run src/features/orders/ordersService.test.ts`
    — el test asserta (vía MSW) que `updateStatus('id-1','ready','clave-1')` manda
    `PATCH /v1/admin/orders/id-1` con header `idempotency-key: clave-1` y body
    `{"status":"ready"}`; que el resultado se parsea con el schema Zod generado (un body con
    un campo `status` fuera del enum debe hacer fallar el test con `ZodError`, no pasar
    silenciosamente).
  - **Nota de ejecución (2026-08-30)**: `pnpm --filter @dsm/web vitest run <path>` falla
    ("None of the selected packages has a 'vitest' script") — el script real es `test`
    (`vitest run` ya está en su definición). Comando correcto: `pnpm --filter @dsm/web
    test -- <path>`. También: `id: zod.string().uuid()` en el schema generado — el `id-1`
    del escenario es válido como segmento de URL (no se valida), pero el `id` del **body de
    respuesta** mockeado tiene que ser un UUID real o `parseContract` lo rechaza (ya
    ejerciendo exactamente el caso "ZodError, no pasa silenciosamente" que pedía el Verify,
    sólo que en el fixture en vez del escenario de `status` — se agregó un test dedicado a
    `status` fuera del enum además).
- [x] **T2.2 — `orderStatus.ts` (FSM pura, vista FE)**
  - **Pattern**: ver `design.md` D4 — `NEXT_STATUS`, `STATUS_LABEL`, `ACTION_LABEL` como
    mapas puros, sin React ni red (análogo a por qué `order-state.ts` es puro en el backend).
  - **Exit criterion**: `NEXT_STATUS['new'] === 'preparing'`,
    `NEXT_STATUS['preparing'] === 'ready'`, `NEXT_STATUS['ready'] === 'delivered'`,
    `NEXT_STATUS['delivered'] === null`. Ningún valor mapea a `cancelled` (esa transición no
    existe en la UI de esta US).
  - **Verify**: `pnpm --filter @dsm/web vitest run src/features/orders/orderStatus.test.ts`
    — test parametrizado (`it.each`) sobre los 4 estados que assert exacto el valor de
    `NEXT_STATUS` y de `ACTION_LABEL`; falla si alguno de los 4 casos no matchea la FSM del
    E2E §12.

## Fase 3: `OrderStatusBadge`

- [ ] **T3.1 — Badge de estado (texto + color, design-system §7.7)**
  - **Pattern**: mismo shape que `apps/web/src/features/products/StatusBadge.tsx` — un mapa
    `Record<OrderStatus, {text, className}>` (ver `design.md` D6 para la tabla de 5 estados).
  - **Exit criterion**: cada uno de los 5 estados (`new/preparing/ready/delivered/cancelled`)
    renderiza un texto distinto (nunca solo color); `preparing` y `ready` comparten clase de
    color pero difieren en texto.
  - **Verify**: `pnpm --filter @dsm/web vitest run src/features/orders/OrderStatusBadge.test.tsx`
    — test que renderiza los 5 estados y hace `getByText('Nueva')`, `getByText('Preparando')`,
    `getByText('Lista para retirar')`, `getByText('Entregada')`, `getByText('Cancelada')`;
    falla si dos estados devuelven el mismo texto.

## Fase 4: `OrdersList` (AC-1, AC-5, AC-8)

- [ ] **T4.1 — Listado con TanStack Table: paginación + orden + filtro server-side**
  - **Pattern**: `design.md` D5 — `manualPagination` + `manualSorting` (nuevo respecto a
    `ProductList`, que no ordena) restringido a las 3 columnas que el **enum cerrado** del
    backend permite (`order_number`, `total_ars_cents`, `created_at` — `enableSorting: false`
    en `buyer_name`/`status`), filtro de estado con `<select>` nativo (5 opciones:
    "Todas"/4 estados activos, **nunca** `pending_payment`). Cambiar filtro u orden resetea
    `offset` a 0.
  - **Exit criterion**: columnas Nº de orden / cliente / total (ARS, `formatArs`) / estado
    (`OrderStatusBadge`) / fecha de creación (`created_at`); solo los `<th>` de Nº de orden,
    total y fecha son ordenables y exponen `aria-sort`; los `<th>` de cliente y estado NO
    exponen `aria-sort` (no son ordenables — el backend no tiene un valor de `sort` para
    ellos); cambiar el `<select>` de estado dispara una nueva request con `status=`
    correspondiente y `offset=0`.
  - **Verify**: `pnpm --filter @dsm/web vitest run src/features/orders/OrdersList.test.tsx`
    con MSW mockeando `GET /v1/admin/orders`. Casos que DEBEN estar cubiertos (y que fallarían
    si el comportamiento no está):
    1. filtrar por "Nuevas" → el `request.url` capturado por el handler MSW trae
       `status=new` Y `offset=0` (no solo que el select cambió de valor visualmente).
    2. hacer click en el header "Fecha" → la segunda request trae `sort=created_at` (asc) o
       `sort=-created_at` (desc, prefijo `-`, en el segundo click) — uno de los 6 valores del
       enum cerrado del backend (`order_number | -order_number | created_at | -created_at |
       total_ars_cents | -total_ars_cents`), nunca `confirmed_at` ni `sort`/`order` separados
       (OQ-FE-3, resuelta y luego revisada por `US-012-panel-ordenes-dueno-backend`
       design.md §D3/§D5) — asserta sobre la URL real, no sobre el estado interno.
    3. el `<th>` de "Cliente" y el de "Estado" NO tienen `aria-sort` ni disparan una request
       nueva al hacer click (`fireEvent.click` sobre esos headers → `expect(fetchCount)` no
       cambia) — cubre que el FE no ofrece ordenar por un campo fuera del enum del backend.
    4. el `<select>` de estado NO contiene una `option` con `value="pending_payment"`
       (`expect(screen.queryByRole('option', { name: /pendiente de pago/i}))` →
       `toBeNull()`) — cubre AC-8 estructuralmente.
- [ ] **T4.2 — Estados de carga/error/vacío**
  - **Exit criterion**: `status: 'loading'` renderiza filas skeleton (no texto plano);
    `status: 'error'` renderiza `role="alert"` + botón "Reintentar" que re-dispara la misma
    request; 0 resultados con un filtro activo renderiza "No hay órdenes con ese filtro" +
    acción para volver a "Todas" (§11.bis.2 — empty state accionable, no una tabla vacía muda).
  - **Verify**: `pnpm --filter @dsm/web vitest run src/features/orders/OrdersList.test.tsx -t "estados"`
    — un caso fuerza `HttpResponse.error()` en MSW y asserta `getByRole('alert')` +
    `getByRole('button', {name: /reintentar/i})`; otro caso devuelve `{data: [], pagination:
    {total: 0, ...}}` con un filtro activo y asserta el mensaje + el botón de reset (falla si
    la tabla simplemente queda vacía sin texto).
- [ ] **T4.3 — Página de ruta**
  - **Pattern**: calco de `app/(admin)/admin/productos/page.tsx` (Server Component delgado).
  - **Exit criterion**: `apps/web/app/(admin)/admin/ordenes/page.tsx` existe, renderiza
    `<h1>Órdenes</h1>` + `<OrdersList />`, sin lógica propia.
  - **Verify**: `pnpm --filter @dsm/web exec tsc --noEmit` pasa (el archivo tipa) y
    `grep -q "OrdersList" apps/web/app/\(admin\)/admin/ordenes/page.tsx`.

## Fase 5: `OrderDetail` (AC-2)

- [ ] **T5.1 — Vista de detalle**
  - **Exit criterion**: renderiza ítems (nombre, sku, cantidad, precio unitario, subtotal),
    total, datos de contacto del comprador (nombre/email/teléfono), retiro en sucursal
    (`fulfillment: 'pickup'` → texto fijo "Retiro en sucursal"), `OrderStatusBadge`, y el
    slot de `OrderStatusActions` (Fase 6) y `OrderStatusHistory` (Fase 7).
  - **Verify**: `pnpm --filter @dsm/web vitest run src/features/orders/OrderDetail.test.tsx`
    — MSW devuelve un detalle con 2 ítems; el test hace `getByText` sobre nombre+cantidad+
    subtotal de AMBOS ítems (no solo el primero) y sobre `buyer_email`/`buyer_phone` — falla
    si el componente trunca la lista de ítems o no muestra el contacto.
- [ ] **T5.2 — Página de ruta con `params` async (Next 15)**
  - **Pattern**: calco de `app/(admin)/admin/productos/[id]/page.tsx` (`params: Promise<{id}>`).
  - **Exit criterion**: `apps/web/app/(admin)/admin/ordenes/[id]/page.tsx` existe y pasa el
    `id` resuelto a `<OrderDetail id={id} />`.
  - **Verify**: `pnpm --filter @dsm/web exec tsc --noEmit` pasa.

## Fase 6: `OrderStatusActions` (AC-3, AC-4, AC-6)

- [ ] **T6.1 — Un botón por el único paso siguiente válido, con UI optimista + rollback**
  - **Pattern**: `design.md` D7 — snippet completo de `advance()` (optimista → confirma o
    revierte, `idempotency-key` por intento reusada en reintento manual, sin retry
    automático). Cita: `frontend-resilience-patterns` #3, #4, #9.
  - **Exit criterion**: para `status: 'new'` se renderiza EXACTAMENTE un botón
    ("Marcar como preparando"); para `status: 'delivered'` no se renderiza ningún botón de
    avance. Al hacer click, el badge de estado cambia **antes** de que resuelva la promesa
    (optimista) y, si la request fallara, vuelve al estado previo.
  - **Verify**: `pnpm --filter @dsm/web vitest run src/features/orders/OrderStatusActions.test.tsx`
    — casos:
    1. `getAllByRole('button', { name: /marcar/i })` tiene `length === 1` para una orden
       `new`, y `length === 0` para una `delivered` (no solo "existe un botón", sino que es
       exactamente uno y el texto correcto — cubre AC-6 en la superficie de UI).
    2. con MSW retrasando la respuesta (`await delay(50)` antes de resolver), inmediatamente
       después del click (antes del `await`) el badge ya muestra el estado siguiente —
       assert sobre el DOM en ese instante, no al final.
    3. con MSW devolviendo 409 (`dsm:orders/invalid-transition`), tras el fallo el badge
       vuelve a mostrar el estado ORIGINAL (no el optimista) y aparece un `role="alert"` con
       el mensaje de conflicto — falla si el componente deja el estado optimista aplicado
       sobre un fallo confirmado.
- [ ] **T6.2 — Mensaje de confirmación al marcar "lista" (AC-4)**
  - **Exit criterion**: al confirmar exitosamente la transición a `ready` (y solo esa), se
    muestra "Se avisó al cliente que su pedido está listo." Ninguna otra transición muestra
    ese texto.
  - **Verify**: `pnpm --filter @dsm/web vitest run src/features/orders/OrderStatusActions.test.tsx -t "AC-4"`
    — un caso transiciona `preparing → ready` y asserta el texto; otro transiciona
    `new → preparing` y asserta `queryByText(/se avisó al cliente/i)` → `null` (falla si el
    mensaje aparece para cualquier transición, no solo para `ready`).
- [ ] **T6.3 — Deshabilitado durante el vuelo (dedupe de clicks)**
  - **Exit criterion**: mientras la request está en curso, el botón está `disabled` y
    `aria-busy="true"`; un segundo click durante ese lapso NO dispara una segunda request.
  - **Verify**: en `OrderStatusActions.test.tsx`, contar cuántas veces MSW recibió el
    `PATCH` tras 2 clicks rápidos (`userEvent.click` x2 sin esperar entre medio) →
    debe ser `1`, no `2`.

## Fase 7: `OrderStatusHistory` (AC-9)

- [ ] **T7.1 — Lista de cambios de estado**
  - **Pattern**: `design.md` D8 — `{from_status ?? '—'} → {to_status}` + `changed_at`
    formateado con `Intl.DateTimeFormat('es-AR', {dateStyle:'short', timeStyle:'short'})` y
    la zona horaria visible (§11.bis.1).
  - **Exit criterion**: renderiza una fila por entrada de `status_history`, en orden
    cronológico; el primer registro (`from_status: null`) se muestra como "— → Nueva".
  - **Verify**: `pnpm --filter @dsm/web vitest run src/features/orders/OrderStatusHistory.test.tsx`
    — con 3 entradas mockeadas, `getAllByRole('listitem')` (o el rol equivalente) tiene
    `length === 3`, y el texto de cada fila incluye AMBOS estados (no solo el nuevo) — falla
    si el componente solo muestra `to_status`.
- [ ] **T7.2 — El detalle refleja el nuevo cambio sin recargar**
  - **Exit criterion**: al confirmar una transición en `OrderStatusActions` (Fase 6), la
    nueva entrada aparece en `OrderStatusHistory` sin un segundo `GET` al detalle completo
    (el `PATCH` ya devuelve el `AdminOrderDetail` actualizado — `design.md` D3).
  - **Verify**: en un test de integración de `OrderDetail.test.tsx`, tras simular el click de
    avance y resolver el `PATCH`, `getAllByRole('listitem')` en el historial pasa de N a N+1
    SIN que MSW haya recibido un segundo `GET /v1/admin/orders/{id}` (contar requests al
    handler de `GET`).

## Fase 8: Routing / acceso (AC-7)

- [ ] **T8.1 — Confirmar que las rutas nuevas heredan `AdminGuard` sin tocarlo**
  - **Exit criterion**: `apps/web/app/(admin)/admin/ordenes/page.tsx` y
    `.../ordenes/[id]/page.tsx` viven bajo el route group `(admin)`, cuyo único
    `layout.tsx` envuelve con `<AdminGuard>`; `apps/web/src/features/auth/guard.tsx` no se
    modifica en este change.
  - **Verify**: `git diff --stat -- apps/web/src/features/auth/guard.tsx` → sin salida (0
    líneas tocadas) tras completar el change; y
    `find apps/web/app/\(admin\) -iname "*ordenes*"` devuelve las 2 rutas nuevas.
    (La verificación negativa-espacio completa de AC-7 — acceso denegado end-to-end contra el
    backend real — es QA-owned, per `qa-frontend-standards.md` §23.4; no se duplica acá.)

## Fase 9: Observabilidad

- [ ] **T9.1 — Eventos de negocio nuevos**
  - **Pattern**: `design.md` §Observabilidad — agregar `'bo_screen_shown'` (si no existe ya
    en el enum), `'order_status_change_attempted'`, `'order_status_change_succeeded'`,
    `'order_status_change_failed'`, `'orders_filtered'` a `BusinessEvent` en
    `apps/web/src/lib/observability/events.ts`. Ninguno entra en `PUBLIC_EVENTS` (son del
    operador, `track()` les agrega `operator_id: 'admin'` automáticamente).
  - **Exit criterion**: los 4 eventos nuevos existen en el tipo `BusinessEvent`; `OrdersList`
    emite `orders_filtered` al cambiar el `<select>`; `OrderStatusActions` emite
    `order_status_change_attempted` antes del `PATCH` y `_succeeded`/`_failed` según
    corresponda.
  - **Verify**: `pnpm --filter @dsm/web vitest run src/features/orders/imports.events.test.tsx`
    (nuevo archivo, mismo patrón que `src/features/imports/imports.events.test.tsx`) — un
    spy sobre `setEventSink` captura las llamadas y asserta el nombre exacto del evento y que
    NO incluye `buyer_name`/`buyer_email` en las props (PII — falla si algún campo de
    comprador se filtra al evento).

## Fase 10: Accesibilidad

- [ ] **T10.1 — axe-core sobre `OrdersList` y `OrderDetail`**
  - **Exit criterion**: 0 violaciones `serious`/`critical` reportadas por `axe-core` en
    ambos componentes renderizados con datos de ejemplo.
  - **Verify**: `pnpm --filter @dsm/web vitest run src/features/orders/a11y.test.tsx` — usa
    `vitest-axe` (o `jest-axe` equivalente ya usado en el resto del panel, ver
    `qa-frontend-standards.md` §23.6); el test falla si `results.violations` no está vacío
    para severidad `serious`/`critical`.
- [ ] **T10.2 — Foco gestionado al navegar al detalle**
  - **Exit criterion**: al montar `OrderDetail`, el foco se mueve al `<h1>` de la orden
    (design-system §11).
  - **Verify**: en `OrderDetail.test.tsx`, tras el render, `document.activeElement` es el
    `<h1>` (o el contenedor con `tabIndex={-1}` que lo recibe) — falla si el foco queda en
    `<body>`.

## Fase 11: Documentación

- [ ] **T11.1 — Actualizar el módulo de eventos en la doc de observabilidad del panel (si existe)**
  - **Exit criterion**: si `docs/services/*/observability.md` (o equivalente) enumera
    `BusinessEvent`s del panel admin, se agregan los 4 nuevos de T9.1. Si no existe tal doc
    para el web, se documenta como no aplicable (no se crea un doc nuevo solo para esto).
  - **Verify**: `grep -rl "order_status_change_attempted" docs/` → si existe algún doc de
    eventos del panel, debe listar el nuevo evento; si no existe tal doc en el repo, esta
    task se marca cerrada con nota "no aplica — no existe doc de eventos del panel" (no se
    inventa documentación nueva fuera de alcance).

## Fase 12: `PendingPaymentsPanel` (feature aditiva, sin AC formal — ver proposal.md OQ-FE-4, `design.md` §D9)

> Bloqueada por T0.3, no por T0.1 — puede ejecutarse en paralelo a las Fases 1-11 o después,
> según cuándo `US-023-pago-manual-offline-backend` publique su contrato.

- [ ] **T12.1 — Regenerar el cliente/Zod/MSW con los endpoints de pendientes de pago**
  - **Pattern**: mismo `orval.config.ts` que T1.1 (un solo `dsmCatalog`/`dsmCatalogZod` sobre
    el contrato completo) — re-ejecutar codegen una vez `US-023-pago-manual-offline-backend`
    publique `GET /admin/orders/pending-payment` y `POST /admin/orders/{orderId}/confirm-payment`.
  - **Exit criterion**: `apps/web/src/api/generated/model/` incluye tipos de
    `PendingPaymentOrder`/`ConfirmOrderPayment` (nombres exactos derivados de `operationId`,
    ilustrativos acá); `apps/web/src/api/generated/zod.ts` y `endpoints.ts` incluyen los
    schemas/operaciones correspondientes.
  - **Verify**: `pnpm --filter @dsm/web codegen` sale con código 0, y
    `grep -ril "pending.payment\|confirm.payment" apps/web/src/api/generated/ | wc -l` → mayor
    que `0`.
- [ ] **T12.2 — `pendingPaymentsService.ts`**
  - **Pattern**: `design.md` §D9 — servicio separado de `ordersService.ts` (concern distinto,
    backend hermano), `parseContract` sobre las operaciones generadas (nunca `fetch` crudo,
    F48), `list()` sin params (el endpoint no pagina) y `confirm(orderId)`.
  - **Exit criterion**: `pendingPaymentsService.list()` y `.confirm(orderId)` existen, tipados
    con los tipos generados en T12.1.
  - **Verify**: `pnpm --filter @dsm/web vitest run src/features/orders/pendingPaymentsService.test.ts`
    — el test asserta (vía MSW) que `confirm('order-1')` manda
    `POST /v1/admin/orders/order-1/confirm-payment` (el id correcto en el path, no un id
    hardcodeado ni el `order_number`) y que `list()` parsea la respuesta con el schema Zod
    generado (un body con un campo fuera de forma debe hacer fallar el test con `ZodError`).
- [ ] **T12.3 — `PendingPaymentsPanel`: listado + confirmación por fila**
  - **Pattern**: `design.md` §D9 — estados explícitos (`idle`/`loading`/`success`/`error` a
    nivel panel, `confirming` por fila vía `Set<orderId>`), refetch-on-success (NO UI
    optimista — deviación explícita de D7, documentada en Trade-offs), botón "Confirmar pago"
    `disabled`+`aria-busy` solo en la fila en vuelo.
  - **Exit criterion**: al hacer click en "Confirmar pago" de una fila, se dispara
    exactamente un `POST /v1/admin/orders/{esa orden}/confirm-payment`; si resuelve OK, la
    fila desaparece del listado tras el refetch; si falla, la fila permanece con un mensaje
    `role="alert"` inline y el botón vuelve a estar habilitado. 0 filas (sin error) renderiza
    "No hay pagos pendientes de confirmar".
  - **Verify**: `pnpm --filter @dsm/web vitest run src/features/orders/PendingPaymentsPanel.test.tsx`
    con MSW mockeando `GET /v1/admin/orders/pending-payment` y
    `POST /v1/admin/orders/{orderId}/confirm-payment`. Casos que DEBEN estar cubiertos:
    1. MSW devuelve 2 filas (`order_number: 101` con id `order-a`, `order_number: 102` con id
       `order-b`); click en "Confirmar pago" de la fila de `order-a` → el handler MSW del
       `POST` recibe el path param `order-a` (no `order-b`, no un id fijo) — assert sobre
       `params.orderId` capturado por el handler, no solo que "se hizo un POST".
    2. tras resolver ese `POST` con 200, el próximo `GET` (refetch) devuelve solo la fila de
       `order-b` — el test asserta que la UI ya NO renderiza `getByText('101')` y sí
       `getByText('102')` (falla si la fila desaparece del estado local sin refetch real, o si
       no desaparece en absoluto).
    3. MSW devuelve 409 (`dsm:payments/order-not-pending-payment`) para el `POST` → la fila de
       `order-a` sigue visible, aparece `role="alert"` con el mensaje de conflicto, y el botón
       de esa fila vuelve a `disabled: false` (falla si el componente la remueve igual sobre
       un fallo confirmado, o si el botón queda deshabilitado para siempre).
    4. con MSW devolviendo `[]`, renderiza el texto "No hay pagos pendientes de confirmar" (no
       una tabla vacía muda).
- [ ] **T12.4 — Segunda pestaña en `/admin/ordenes`, mutuamente excluyente con `OrdersList`**
  - **Pattern**: `design.md` §D9 — `?tab=pendientes-de-pago` leído por el Server Component de
    `page.tsx`; nunca `OrdersList` y `PendingPaymentsPanel` montados a la vez.
  - **Exit criterion**: `apps/web/app/(admin)/admin/ordenes/page.tsx` renderiza
    `<PendingPaymentsPanel />` cuando `searchParams.tab === 'pendientes-de-pago'`, y
    `<OrdersList />` en cualquier otro caso (incluyendo ausencia del param); nunca ambos.
  - **Verify**: `pnpm --filter @dsm/web vitest run src/app/admin/ordenes/page.test.tsx` (o
    equivalente de test de Server Component) — un caso con `searchParams: {}` renderiza
    `OrdersList` y NO `PendingPaymentsPanel` (`queryByTestId` del otro → `null`); un caso con
    `searchParams: { tab: 'pendientes-de-pago' }` renderiza `PendingPaymentsPanel` y NO
    `OrdersList` — falla si ambos aparecen en el DOM simultáneamente en cualquiera de los dos
    casos.

## Verification (suite-level)

- [ ] Toda la suite de `apps/web` sigue verde: `pnpm --filter @dsm/web test` (`vitest run`,
      forma terminante — nunca `vitest` a secas).
- [ ] Type-check limpio: `pnpm --filter @dsm/web exec tsc --noEmit`.
- [ ] Lint limpio: `pnpm --filter @dsm/web lint`.
- [ ] Gate de contrato: `pnpm --filter @dsm/web codegen` no produce diff sin commitear
      (`git diff --exit-code apps/web/src/api/generated`) — el gate `frontend-codegen-fresh`
      de CI hace exactamente esto.
- [ ] Gate de choke-point de red (F48): `./scripts/check-consumer-contract.sh` (o el gate
      `consumer-contract-check` de CI) no reporta ningún `fetch`/`axios` crudo nuevo fuera de
      `src/lib/http/client.ts` en los archivos de `src/features/orders/`.
- [ ] `OrderStatusActions` NUNCA deja el estado optimista aplicado sin confirmación del
      backend — cubierto por T6.1 caso 3; si ese test se borra o se debilita, este ítem de
      suite-level debe volver a agregarlo.
