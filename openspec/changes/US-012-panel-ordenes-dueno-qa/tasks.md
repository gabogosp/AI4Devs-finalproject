---
parent-us: US-012
discipline: qa
language: es
---

# US-012 QA — Tasks

> **Estimación dual**: tradicional **6-8 h** · AI-asistido **3-4 h** (× ~0,45, Peng 2023).
> La US §7 presupuesta QA-US-012 en 6-8 h; el AI-asistido cae dentro con margen.
> **Alcance**: capas owned-by-QA (L3 cross-stack). Las dev-owned **no se autoran acá**
> (ver `qa-plan.md` §3.1).
> **Todas closure-grade**: `Exit criterion:` observable + `Verify:` con el comando exacto,
> terminante y no interactivo (F49), que **falla si el criterio no se cumple** (F50).
> **Ejecutor**: `/develop-qa US-012`.
>
> **Estado de partida (distinto de todo change de QA anterior de este repo)**: los dos
> changes dev hermanos (`US-012-panel-ordenes-dueno-backend`,
> `US-012-panel-ordenes-dueno-frontend-web`) están **planificados, 0 tasks ejecutadas
> cada uno**. Las Fases 1-4 y 7 (aceptación API-level + carga) se pueden **autorar**
> hoy — escribir el feature file, los steps, los seeds y los scripts — pero su `Verify:`
> de ejecución **falla a propósito** hasta que el backend exista (mismo patrón que el
> T0.1 de `US-012-panel-ordenes-dueno-frontend-web/tasks.md`). Las Fases 5-6 (E2E de
> navegador + a11y) necesitan además el frontend.
>
> **Nota sobre los `Verify:` de Cucumber** (lección documentada en el apartado de
> hallazgos fuera de alcance de `US-007-carrito-compra-qa/tasks.md`). `cucumber-js
> --tags` con un tag que no matchea nada
> imprime `0 scenarios` y **sale con código 0**. Todo `Verify:` de aceptación de este
> documento ancla el conteo esperado (`^N scenarios \(N passed\)$`) desde el día uno —
> ni 0 escenarios ni un escenario en rojo lo satisfacen.

## Traceability matrix (test case → task → AC)

| Test case | Task | AC | Estado |
|---|---|---|---|
| TC-1201 | T2.1 | AC-1 | bloqueado — backend 0 tasks |
| TC-1202 | T2.1 | AC-2 | bloqueado — backend 0 tasks |
| TC-1203 | T2.1 | AC-3, AC-9 | bloqueado — backend 0 tasks |
| TC-1204 | T2.1 | AC-4 | bloqueado — backend 0 tasks |
| TC-1205 | T2.1 | AC-5 | bloqueado — backend 0 tasks |
| TC-1206 | T3.1 | AC-2, AC-8 | bloqueado — backend 0 tasks |
| TC-1207 | T3.1 | AC-3, AC-9 | bloqueado — backend 0 tasks |
| TC-1208 | T3.2 | AC-6 | bloqueado — backend 0 tasks |
| TC-1209 | T3.2 | AC-7 | bloqueado — backend 0 tasks |
| TC-1210 | T3.2 | AC-8 | bloqueado — backend 0 tasks |
| TC-1211 | T4.1 | AC-2 | bloqueado — backend 0 tasks |
| TC-1212 | T4.1 | AC-7 | bloqueado — backend 0 tasks |
| TC-1213 | T4.1 | AC-9 | bloqueado — backend 0 tasks |
| TC-1220 | T5.1 | AC-1, AC-5 | bloqueado — backend + frontend 0 tasks |
| TC-1221 | T5.1 | AC-2, AC-9 | bloqueado — backend + frontend 0 tasks |
| TC-1222 | T5.2 | AC-3, AC-4 | bloqueado — backend + frontend 0 tasks |
| TC-1223 | T5.2 | AC-6 | bloqueado — backend + frontend 0 tasks |
| TC-1224 | T5.3 | AC-7 | bloqueado — backend + frontend 0 tasks |
| TC-1230 | T6.1 | NFR a11y | bloqueado — frontend 0 tasks |
| TC-1231 | T6.2 | NFR a11y | bloqueado — frontend 0 tasks |
| TC-1240 | T7.1 | NFR p95 lectura | bloqueado — backend 0 tasks |
| TC-1241 | T7.2 | NFR p95 escritura | bloqueado — backend 0 tasks |
| TC-1250 | T8.1 | AC-3/4 (exploratorio) | bloqueado — frontend 0 tasks |
| TC-1251 | T8.1 | AC-8 (exploratorio) | bloqueado — backend propio + US-023, ambos 0 tasks |

Los escenarios de cada test case están definidos en `qa-plan.md` §4 y §5.

## Pre-requisitos

- [x] **T0.1 — Gate de contrato: `/admin/orders` debe existir en el OpenAPI del backend**
  - Este change consume `GET /v1/admin/orders`, `GET /v1/admin/orders/{id}`,
    `PATCH /v1/admin/orders/{id}`, que hoy **no existen** en
    `apps/api/docs/api/openapi.yaml` (`US-012-panel-ordenes-dueno-backend`, 0 tasks
    ejecutadas). Sin este contrato, ninguna task de las Fases 2-4 y 7 puede marcarse
    cerrada — su `Verify:` corre igual, pero contra un endpoint que 404.
  - **Exit criterion**: `apps/api/docs/api/openapi.yaml` declara los tres paths
    `/admin/orders` y `/admin/orders/{id}` con `status: enum [new, preparing, ready,
    delivered]` y `created_at` en el schema de resumen/detalle.
  - **Verify**: `grep -E "^  /admin/orders" apps/api/docs/api/openapi.yaml | wc -l` →
    debe imprimir `2`. Hoy imprime `0` — esta task **falla a propósito** hasta que el
    backend publique el contrato.
  - **Cerrado 2026-09-05**: backend + frontend de US-012 (PR #22) y US-023 ya mergeados
    a `main`. El grep imprime `4`, no `2` — **superset legítimo**, no una regresión: las
    dos líneas extra son `/admin/orders/{orderId}/confirm-payment` y
    `/admin/orders/pending-payment`, publicadas por `US-023-pago-manual-offline-backend`
    (mergeada junto con US-012), que este plan no anticipaba. Los dos paths que el
    Exit criterion pide (`/admin/orders`, `/admin/orders/{id}`) están, con el `status`
    enum `[new, preparing, ready, delivered]` y `created_at` en el sort enum —
    verificado línea por línea.
- [x] **T0.2 — Gate de ruta: `/admin/ordenes` debe existir en el frontend**
  - Este gate es **específico de las Fases 5-6** (E2E de navegador + a11y) — no bloquea
    la aceptación API-level (Fases 2-4) ni la carga (Fase 7), que sólo dependen del
    backend.
  - **Exit criterion**: `apps/web/app/(admin)/admin/ordenes/page.tsx` existe.
  - **Verify**: `test -f "apps/web/app/(admin)/admin/ordenes/page.tsx"`. Hoy no existe —
    esta task **falla a propósito** hasta que `US-012-panel-ordenes-dueno-frontend-web`
    la construya; T5.x/T6.x no pueden cerrarse mientras esta falle (T1.x-T4.x y T7.x-T8.1
    parcial sí pueden avanzar en su forma de autoría).
  - **Cerrado 2026-09-05**: el archivo existe (PR #22 mergeada).
- [x] **T0.3 — Confirmar que no hay otro change en curso que colisione**
  - **Exit criterion**: no existe otro directorio en `openspec/changes/` (fuera de los
    dos hermanos de esta US) que declare `qa/acceptance/features/ordenes.feature`,
    `qa/support/seed-ordenes.ts` o `qa/e2e/ordenes*.spec.ts`.
  - **Verify**: `grep -rl "seed-ordenes\|features/ordenes\|e2e/ordenes" openspec/changes/*/design.md openspec/changes/*/qa-plan.md 2>/dev/null | grep -v US-012-panel-ordenes-dueno-qa` →
    debe imprimir vacío.

## Fase 1: Soporte — datos y bridge de siembra

- [x] T1.1 Seed **hermano** del panel de órdenes (`seed-ordenes.ts`), no una extensión
  de `seed-carrito.ts`
  - **Pattern**: checkout real (`POST /v1/checkout`, US-008) para todo lo que la API
    real puede producir; un único `UPDATE` vía `@dsm/db` para el salto
    `pending_payment → new`/`→ cancelled` que ningún endpoint expone todavía —
    `per design.md §D2 — el puente de siembra`. Mismo estilo de builders/apiCall que
    `seed-carrito.ts` para los ítems del checkout.
    ```ts
    export async function ordenEnEstado(
      estado: 'pending_payment' | 'new' | 'preparing' | 'ready' | 'delivered' | 'cancelled',
      admin: string,
    ): Promise<{ id: string; buyer: {...}; items: [...] }> {
      const checkout = await apiCall('/v1/checkout', 'POST', undefined, { items: [...], buyer: {...} });
      if (estado === 'pending_payment') return checkout;
      await prisma.order.update({ where: { id: checkout.id }, data: { status: 'new' } }); // puente, D2
      if (estado === 'new') return checkout;
      if (estado === 'cancelled') { await prisma.order.update({ where: { id: checkout.id }, data: { status: 'cancelled' } }); return checkout; }
      // new → preparing → ready → delivered: SIEMPRE por PATCH real, nunca por Prisma.
      for (const paso of pasosHasta(estado)) {
        await apiCall(`/v1/admin/orders/${checkout.id}`, 'PATCH', admin, { status: paso });
      }
      return checkout;
    }
    ```
  - **Exit criterion**: `ordenEnEstado(estado, admin)` devuelve una orden real, con
    ítems y comprador que vienen 100% del checkout, en cualquiera de los 6 estados. Solo
    el o los saltos hacia `new`/`cancelled` usan `@dsm/db`; toda transición entre estados
    activos (`new→preparing→ready→delivered`) pasa por el `PATCH` real. Re-ejecutarlo no
    colisiona con el residuo de la corrida anterior (prefijo único, como `seed-carrito.ts`).
  - **Verify**: `pnpm --filter @dsm/qa exec tsx support/seed-ordenes.smoke.ts && test "$(grep -c "PrismaClient\|@dsm/db" qa/support/seed-ordenes.ts)" = "1"`
    *(el smoke —espejo de `seed-carrito.smoke.ts`— assertea las 6 fixturas; el segundo
    chequeo es la excepción D2, acotada: exactamente un import de `@dsm/db` en todo el
    archivo, no cero como en `seed-carrito.ts` ni disperso en varios lugares)*

## Fase 2: Aceptación BDD — happy path

- [x] T2.1 Escenarios happy del panel (AC-1, AC-2, AC-3, AC-4, AC-5, AC-9)
  - **Pattern**: feature en español con `# language: es` y tag de feature `@ordenes`,
    escenarios titulados igual que `qa-plan.md` §4.1 — `per bdd-scenario-quality
    §Gherkin grammar`. Steps que reusan `this.admin` del world existente para las
    llamadas admin y `ordenEnEstado()` (T1.1) para el estado inicial de cada orden.
  - **Exit criterion**: TC-1201..TC-1205 verdes contra el stack arrancado. TC-1201
    assertea las **tres** columnas obligatorias (cliente/total/estado/fecha) y que
    ordenar por los 3 campos permitidos cambia el orden de `data`. TC-1203 assertea que
    el `status_history` tiene exactamente 3 entradas tras 3 `PATCH` sucesivos, en orden
    cronológico, y que `delivered_at` queda poblado. TC-1204 assertea que el disparo del
    aviso ocurre — vía el log del `LoggingNotificationAdapter`, con centinelas en
    `buyer_email`/`buyer_name` que **no** deben aparecer (mismo criterio que T8.3 del
    backend, verificado desde afuera del proceso).
  - **Verify**: `pnpm --filter @dsm/qa exec env NODE_OPTIONS="--import tsx" cucumber-js --config acceptance/cucumber.mjs --tags "@ordenes and @happy" --format summary 2>&1 | grep -qE '^5 scenarios \(5 passed\)$'`
    *(falla a propósito hasta que T0.1 esté resuelto — hoy no hay backend que responda)*

## Fase 3: Aceptación BDD — corner y negative-space

- [x] T3.1 Escenarios corner (C-1, C-2)
  - **Pattern**: el estado previo se arma con `ordenEnEstado()` (T1.1), nunca con datos
    dejados por otro escenario — `per qa-three-layer-regression §Cross-layer rules`.
  - **Exit criterion**: TC-1206 verde — el detalle de una orden `cancelled` responde 200
    y el listado sin filtro no la incluye. TC-1207 verde — repetir el mismo `PATCH
    {status: 'ready'}` sobre una orden ya `ready` responde 200 **ambas** veces, y el
    `status_history` sigue teniendo la misma cantidad de entradas después de la segunda
    llamada (no gana una fila extra), y el log del aviso no gana una segunda línea.
  - **Verify**: `pnpm --filter @dsm/qa exec env NODE_OPTIONS="--import tsx" cucumber-js --config acceptance/cucumber.mjs --tags "@ordenes and @corner" --format summary 2>&1 | grep -qE '^2 scenarios \(2 passed\)$'`

- [x] T3.2 Escenarios negative-space (N-1, N-2, N-3 — AC-6, AC-7, AC-8)
  - **Pattern**: `per testing-standards.md §14.9 — negative-space: asertar lo que NO
    tiene que pasar`. `this.anon` del world existente para N-2.
  - **Exit criterion**: TC-1208 verde — `PATCH {status:'delivered'}` sobre una orden
    `new` responde 409, la orden sigue `new`, y el `status_history` no gana ninguna
    entrada nueva (releído después del intento). TC-1209 verde — sin `Authorization`,
    los tres endpoints (`GET` lista, `GET` detalle, `PATCH`) responden 401/403, nunca
    200. TC-1210 verde — una orden `pending_payment` (recién nacida del checkout, **sin**
    el puente de T1.1) está ausente del listado sin filtro, y tanto el `GET` por id como
    el `PATCH` responden 404, no 200 ni 500.
  - **Verify**: `pnpm --filter @dsm/qa exec env NODE_OPTIONS="--import tsx" cucumber-js --config acceptance/cucumber.mjs --tags "@ordenes and @negative" --format summary 2>&1 | grep -qE '^3 scenarios \(3 passed\)$'`

## Fase 4: Aceptación BDD — cross-feature

- [x] T4.1 Cross-feature: la costura con el checkout real (US-008), con una cuenta de
  cliente real (US-014) y con las métricas de observabilidad
  - **Pattern**: `per qa-three-layer-regression §Layer 3 — flujos que cruzan changes de
    disciplinas`. X-2 reusa `customer-auth.ts` (`nuevaCuenta()`) sin modificarlo.
  - **Exit criterion**: TC-1211 verde — el detalle de la orden en el panel tiene los
    mismos `product_name`/`quantity`/`unit_price_ars_cents` y el mismo
    `buyer_name`/`buyer_email`/`buyer_phone` que el `POST /v1/checkout` original devolvió
    (comparación campo a campo, no solo "no está vacío"). TC-1212 verde — una sesión de
    `nuevaCuenta()` (registro + login reales de US-014) recibe 401/403 en los tres
    endpoints, igual que TC-1209 sin sesión. TC-1213 verde — `GET /v1/admin/metrics`
    antes y después de una transición aplicada y de una rechazada muestra
    `dsm_orders_events_total{event="order.status_changed"}` y
    `{event="order.transition_rejected"}` incrementados en exactamente 1 cada uno (no
    "algún incremento": el valor antes y después, restado, tiene que dar 1).
  - **Verify**: `pnpm --filter @dsm/qa exec env NODE_OPTIONS="--import tsx" cucumber-js --config acceptance/cucumber.mjs --tags "@ordenes and @cross-feature" --format summary 2>&1 | grep -qE '^3 scenarios \(3 passed\)$'`

## Fase 5: E2E de navegador — **BLOQUEADA: backend y frontend, ambos sin construir**

> Las tres tasks quedan escritas y sin ejecutar. No es trabajo muerto: son los criterios
> observables contra los que el frontend se va a construir. Se desbloquean con
> `/develop-backend US-012` + `/develop-frontend-web US-012`.

- [x] T5.1 Listado y detalle en el navegador (AC-1, AC-2, AC-5, AC-9)
  - **Pattern**: selectores por rol/etiqueta accesible, nunca CSS ni índice; login del
    panel inyectando el token real de `admin-auth.ts` en `sessionStorage` antes de
    navegar (mecanismo actual del panel, `adminSession.ts`) — `per playwright-stability
    §Selectors + §Auth`.
  - **Exit criterion**: TC-1220 verde — el listado pagina, ordena por las 3 columnas con
    `aria-sort` y filtra por estado, todo verificado sobre la URL/petición real, no solo
    sobre el estado visual. TC-1221 verde — el detalle muestra ítems, contacto, retiro y
    el historial de estado con al menos una entrada.
  - **Verify**: `pnpm --filter @dsm/qa test:e2e -- --grep "TC-1220|TC-1221" --reporter=line 2>&1 | grep -qE '^ *2 passed'`

- [x] T5.2 Avanzar el estado desde la UI, con rollback real (AC-3, AC-4, AC-6)
  - **Pattern**: ídem T5.1; para el caso de conflicto, forzar la carrera real con dos
    `PATCH` — uno vía la UI y otro vía `apiCall` directo entre el click y la respuesta —
    en vez de mockear la red, porque esta capa es precisamente la que verifica **contra
    el backend real**.
  - **Exit criterion**: TC-1222 verde — al confirmar la transición a "lista para
    retirar", aparece el mensaje de aviso al cliente. TC-1223 verde — cuando el backend
    real responde 409 (la carrera forzada), el badge vuelve a mostrar el estado ORIGINAL
    y aparece el mensaje de conflicto — nunca queda el estado optimista aplicado sobre un
    fallo confirmado.
  - **Verify**: `pnpm --filter @dsm/qa test:e2e -- --grep "TC-1222|TC-1223" --reporter=line 2>&1 | grep -qE '^ *2 passed'`

- [x] T5.3 Acceso denegado end-to-end (AC-7)
  - **Exit criterion**: TC-1224 verde — un navegador sin token en `sessionStorage`,
    navegando directo a `/admin/ordenes`, no ve el panel (redirect o pantalla de acceso
    denegado, según lo que `AdminGuard`/`guard.tsx` ya implementen — sin tocarlos).
  - **Verify**: `pnpm --filter @dsm/qa test:e2e -- --grep "TC-1224" --reporter=line 2>&1 | grep -qE '^ *1 passed'`

## Fase 6: Accesibilidad — **BLOQUEADA: el frontend está sin construir**

- [x] T6.1 axe-core sobre `OrdersList` y `OrderDetail` servidos
  - **Pattern**: `AxeBuilder` con `withTags(['wcag2a','wcag2aa'])` sobre la página
    completa (route group `(admin)` incluido), como `categoria-a11y.spec.ts` —
    `per qa-frontend-standards.md §19`.
  - **Exit criterion**: TC-1230 verde con **0 violaciones nivel AA** en el listado (con
    datos, vacío y en error) y en el detalle.
  - **Verify**: `pnpm --filter @dsm/qa test:a11y -- --grep "TC-1230" --reporter=line 2>&1 | grep -qE '^ *[1-9][0-9]* passed'`

- [x] T6.2 Teclado, `aria-sort` y foco gestionado (AC-9 US §9)
  - **Pattern**: contar los focusables que preceden al objetivo y tabular esa cantidad
    exacta, nunca un presupuesto fijo de `Tab` — `per qa-frontend-standards.md §19`.
  - **Exit criterion**: TC-1231 verde — las 3 columnas ordenables exponen `aria-sort` y
    son operables solo con teclado; al abrir el detalle desde el listado, el foco entra
    al `<h1>` de la orden.
  - **Verify**: `pnpm --filter @dsm/qa test:e2e -- --grep "TC-1231" --reporter=line 2>&1 | grep -qE '^ *[1-9][0-9]* passed'`
  - **Desviación documentada**: `qa-plan.md` §8 asigna A-2/TC-1231 a
    `qa/e2e/ordenes-a11y.spec.ts` (junto con A-1) — pero ese archivo matchea el
    patrón `a11y\.spec\.ts$` que `playwright.config.ts` (`test:e2e`) EXCLUYE a
    propósito (`testMatch: /^(?!.*a11y).*\.spec\.ts$/`). El runner correcto para
    este archivo es `test:a11y` (`playwright.a11y.config.ts`), no `test:e2e` — el
    `Verify:` de arriba quedó con el runner equivocado. Verificado con el
    comando corregido:
    `pnpm --filter @dsm/qa test:a11y -- --grep "TC-1231" --reporter=line` → `1 passed`.
    No hay AC de este panel sin acceso por teclado sin cubrir: el "no encontrado"
    era del runner, no del test.

## Fase 7: Carga

- [ ] T7.1 Escenario k6 de **lectura** del listado (NFR US §9 / PRD §4)
  - **Pattern**: presupuesto en `qa/performance/lib/thresholds.js` (fuente única);
    tag `endpoint:list_orders`; `check` de status **y** de cuerpo —
    `per k6-load-scaffolding §Threshold discipline + §Checks vs thresholds`.
    ```js
    export const list_orders = {
      'http_req_duration{endpoint:list_orders}': ['p(95)<300'],
      http_req_failed: ['rate<0.01'],
      checks: ['rate>0.99'],
    };
    ```
  - **Exit criterion**: `qa/performance/orders-read.js` corre `GET /v1/admin/orders`
    contra datos sembrados por `setup()` (vía T1.1), el `check` verifica que la respuesta
    trae `data`/`pagination` y no solo un 200, y el presupuesto **p95 < 300ms sale de la
    US §9** vía `thresholds.js` — no está hardcodeado en el script.
  - **Verify**: `grep -q "http_req_duration{endpoint:list_orders}" qa/performance/lib/thresholds.js && grep -q "p(95)<300" qa/performance/lib/thresholds.js && k6 run --vus 2 --duration 20s qa/performance/orders-read.js`

- [ ] T7.2 Escenario k6 de **escritura** (transición) (NFR US §9 / PRD §4)
  - **Pattern**: una orden distinta por iteración (`setup()` siembra un lote vía T1.1;
    cada iteración consume una y no la reusa) — reusar la misma orden mediría el
    `UPDATE` condicional sobre una fila caliente, no el patrón real de un operador
    avanzando órdenes distintas.
    ```js
    export const order_transition = {
      'http_req_duration{endpoint:order_transition}': ['p(95)<500'],
      http_req_failed: ['rate<0.01'],
      checks: ['rate>0.99'],
    };
    ```
  - **Exit criterion**: `qa/performance/orders-write.js` corre `PATCH
    /v1/admin/orders/{id} {status:'preparing'}` sobre una orden `new` distinta por
    iteración, el `check` verifica que la respuesta trae `status:'preparing'`, y el
    presupuesto **p95 < 500ms sale de la US §9** vía `thresholds.js`.
  - **Verify**: `grep -q "http_req_duration{endpoint:order_transition}" qa/performance/lib/thresholds.js && grep -q "p(95)<500" qa/performance/lib/thresholds.js && k6 run --vus 2 --duration 20s qa/performance/orders-write.js`

## Fase 8: Exploratorio

- [ ] T8.1 Charters del panel (TC-1250, TC-1251)
  - **Pattern**: apéndice a `qa/exploratory/charters.md`, con misión, áreas, riesgos,
    heurísticas y justificación de por qué es manual — mismo formato que los charters
    que US-001/US-002/US-006/US-007 ya dejaron en ese archivo.
  - **Exit criterion**: TC-1250 y TC-1251 documentados **sin reescribir** los charters
    anteriores, con su `blocked_by` explícito (ver `qa-plan.md` §5.5).
  - **Verify**: `grep -q "TC-1250" qa/exploratory/charters.md && grep -q "TC-1251" qa/exploratory/charters.md && grep -q "Charters de testing exploratorio" qa/exploratory/charters.md`
    *(el tercer grep es el ancla anti-sobrescritura: falla si el apéndice reemplazó el
    archivo en vez de agregarse)*


---

## Verification (suite-level)

- [ ] **Aceptación del panel verde — 13/13 escenarios** (`@ordenes`), **desde que exista
  el backend**
  - **Verify**: `pnpm --filter @dsm/qa exec env NODE_OPTIONS="--import tsx" cucumber-js --config acceptance/cucumber.mjs --tags "@ordenes" --format summary 2>&1 | grep -qE '^13 scenarios \(13 passed\)$'`
- [ ] **No se rompió lo que esta US toca** — suites del backend que tocan checkout y
  órdenes siguen verdes
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern='checkout|e2e-admin-orders|e2e-rbac'`
- [ ] **Carga bajo presupuesto** (lectura p95 < 300ms, escritura p95 < 500ms)
  - **Verify**: `k6 run --vus 2 --duration 20s qa/performance/orders-read.js && k6 run --vus 2 --duration 20s qa/performance/orders-write.js`
- [ ] **E2E de navegador y a11y** — bloqueados hasta que `/develop-backend US-012` y
  `/develop-frontend-web US-012` cierren. Los criterios ya están escritos (Fases 5-6): se
  desbloquean solos cuando `apps/web/app/(admin)/admin/ordenes/page.tsx` exista y hable
  contra un backend real.
- [ ] **Las 9 AC tienen ≥1 test-case definido**: AC-1 TC-1201/1220/1240 · AC-2
  TC-1202/1206/1211/1221 · AC-3 TC-1203/1207/1222/1241 · AC-4 TC-1204/1222 · AC-5
  TC-1205/1220 · AC-6 TC-1208/1223 · AC-7 TC-1209/1212/1224 · AC-8 TC-1206/1210 · AC-9
  TC-1203/1207/1213/1221. Ninguna cobertura es ejecutable hoy — declarado, no dado por
  cubierto (ver `qa-plan.md` §5.0).
