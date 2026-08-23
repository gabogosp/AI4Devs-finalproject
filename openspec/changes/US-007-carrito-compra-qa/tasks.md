---
parent-us: US-007
discipline: qa
language: es
---

# US-007 QA — Tasks

> **Estimación dual**: tradicional **8-10 h** · AI-asistido **4 h** (× ~0,45, Peng 2023).
> La US §7 presupuesta QA-US-007 en 4-6 h; el AI-asistido cae dentro.
> **Alcance**: capas owned-by-QA (L3 cross-stack). Las dev-owned **no se autoran acá**.
> **Todas closure-grade**: `Exit criterion:` observable + `Verify:` con el comando exacto,
> terminante y no interactivo (F49), que **falla si el criterio no se cumple** (F50).
> **Ejecutor**: `/develop-qa US-007`.

> **Nota sobre los `Verify:` de Cucumber (medido, no supuesto).** `cucumber-js --tags` con
> un tag que no matchea nada imprime `0 scenarios` y **sale con código 0**. Un `Verify:`
> que sólo corriera el comando pasaría **verde antes de que exista el feature file** — el
> trap exacto de F50. Por eso cada `Verify:` de aceptación **ancla el conteo esperado**
> (`^N scenarios \(N passed\)$`): ni 0 escenarios ni un escenario en rojo lo satisfacen.
> Playwright, en cambio, sale con código 1 cuando el `--grep` no matchea (verificado), así
> que ahí el ancla es defensa en profundidad.

## Trazabilidad: test case → task → AC

| Test case | Task | AC | Estado |
|---|---|---|---|
| TC-701 | T2.1 | AC-1 | ejecutable hoy |
| TC-702 | T2.1 | AC-2 | ejecutable hoy |
| TC-703 | T2.1 | AC-3 | ejecutable hoy |
| TC-704 | T2.1 | AC-4 | ejecutable hoy |
| TC-705 | T2.2 | AC-5 | ejecutable hoy |
| TC-706 | T2.2 | AC-7 | ejecutable hoy |
| TC-707 | T2.2 | AC-6 (señal) | ejecutable hoy |
| TC-708 | T3.2 | AC-10 | ejecutable hoy |
| TC-709 | T3.1 | **AC-8** | ejecutable hoy |
| TC-710 | T3.3 | AC-6 | ejecutable hoy |
| TC-711 | T3.3 | AC-9 | ejecutable hoy |
| TC-712 | T3.3 | AC-1 | ejecutable hoy |
| TC-720 | T4.1 | AC-1/2/3 | **bloqueado — FE sin construir** |
| TC-721 | T4.1 | AC-4 | **bloqueado — FE sin construir** |
| TC-722 | T4.1 | AC-7 | **bloqueado — FE sin construir** |
| TC-723 | T4.2 | AC-5 | **bloqueado — FE sin construir** |
| TC-724 | T4.2 | AC-6 | **bloqueado — FE sin construir** |
| TC-725 | T4.2 | AC-9 | **bloqueado — FE sin construir** |
| TC-730 | T5.1 | NFR a11y | **bloqueado — FE sin construir** |
| TC-731 | T5.2 | NFR a11y | **bloqueado — FE sin construir** |
| TC-740 | T6.1 | NFR p95 escritura | ejecutable (ver OQ-QA-2) |
| TC-750 | T7.1 | AC-4 (exploratorio) | **bloqueado — FE sin construir** |
| TC-751 | T7.1 | AC-4 (exploratorio) | ejecutable hoy |

Los escenarios de cada test case están definidos en `qa-plan.md` §4 y §5.

## Pre-requisitos

- [x] **Backend de US-007 desarrollado y su contrato publicado** *(verificado 2026-08-22:
  36/37 tasks cerradas; la única abierta es el gate de CI del monorepo, que no es de este
  change).*
  - **Exit criterion**: los tres endpoints del carrito están publicados en el contrato de
    la API (`getCart`, `setCartItem`, `removeCartItem`) y la suite e2e del carrito del
    backend está verde.
  - **Verify**: `grep -q "operationId: getCart" apps/api/docs/api/openapi.yaml && grep -q "operationId: setCartItem" apps/api/docs/api/openapi.yaml && grep -q "operationId: removeCartItem" apps/api/docs/api/openapi.yaml && pnpm --filter @dsm/api test -- --testPathPattern='e2e-cart' --ci`
- [x] **Entorno de ejecución del carrito arriba** — la API arrancada con la allowlist de
  CORS que incluye el origen del cliente QA y con `ADMIN_BOOTSTRAP_TOKEN`.
  - **Exit criterion**: el preflight de un `PUT` del carrito desde el origen web devuelve
    el `Access-Control-Allow-Origin` de ese origen y anuncia `PUT` y `DELETE` entre los
    métodos permitidos. Sin esto, toda escritura posterior a la primera muere en 403
    (`CartCsrfGuard` verifica `Origin` contra la allowlist) y **ningún navegador** puede
    usar la superficie, aunque `curl` sin `Origin` funcione perfecto.
  - **Verify**: `curl -sS --max-time 10 -o /dev/null -D - -X OPTIONS "${QA_API_BASE_URL:-http://localhost:3000}/v1/cart/items/x" -H "Origin: ${QA_WEB_BASE_URL:-http://localhost:3210}" -H 'Access-Control-Request-Method: PUT' | tee /dev/stderr | grep -qi "^access-control-allow-methods:.*PUT.*DELETE"`
- [ ] **FE de US-007 desarrollado** — *el change `US-007-carrito-compra-frontend-web` se
  planificó el 2026-08-22 en una sesión paralela y está **sin desarrollar** (0 tasks
  cerradas).* **Bloquea la ejecución de las fases 4 y 5**, no la planificación.
  - **Exit criterion**: la ruta del carrito existe en `apps/web` y la suite del monorepo
    pasa. Que el **plan** de FE exista no alcanza: lo que las fases 4 y 5 necesitan es la
    UI construida, así que el chequeo apunta al artefacto, no al openspec change.
  - **Verify**: `test -f "apps/web/app/(storefront)/carrito/page.tsx" && pnpm -r test`

---

## Fase 1: Soporte — datos y cliente del carrito

- [x] T1.1 Seed **hermano** del carrito (`seed-carrito.ts`), no una extensión del de US-002
  - **Pattern**: mismo patrón que `qa/support/seed-categorias.ts` — `adminAuth()` +
    `apiCall('/v1/admin/products', 'POST'|'PATCH')` + builders con prefijo único; creación
    **secuencial** (en paralelo el orden deja de ser determinista) y archivado por la FSM
    real (`publicar` → `archivar`), nunca un estado que la app no produciría —
    `per qa-backend-standards.md §15 — datos sintéticos por la API real`.
  - **Exit criterion**: `seedCarrito()` devuelve, sembrados por `/v1/admin/*`: un producto
    publicado con stock **exactamente 3** (tope de AC-5 e invariante de AC-8); dos
    publicados con stock ≥ 2 para el carrito mixto; uno publicado para despublicar en
    vuelo; uno publicado para cambiarle el precio en vuelo; un `draft`; y un `archived`
    obtenido publicando y después archivando. Ningún acceso directo a la base: el archivo
    no importa Prisma. Re-ejecutarlo no colisiona con el residuo de la corrida anterior.
  - **Verify**: `pnpm --filter @dsm/qa exec tsx support/seed-carrito.smoke.ts && ! grep -q "PrismaClient" qa/support/seed-carrito.ts`
    *(el smoke —espejo de `seed-ficha.smoke.ts`— assertea las 7 fixturas y que el stock del
    producto de la invariante es exactamente 3, no «alguno»: sin ese número, N-2 no puede
    distinguir una reserva)*

- [x] T1.2 Cliente de carrito con identidad, CSRF y «cerrar y volver» (`cart-client.ts`)
  - **Pattern**: un invitado = un `APIRequestContext` propio (su propio almacén de
    cookies); antes de cada escritura, leer `dsm_cart_csrf` de `context.storageState()` y
    mandarla en `X-CSRF-Token` junto con `Origin` de la allowlist; «cerrar el navegador»
    = serializar `storageState()`, descartar el contexto y abrir uno nuevo con ese estado
    — `per security-standards.md §7.5 — double-submit cuando la identidad viaja en cookie`
    + `playwright-stability §Fixtures lifecycle`.
    ```ts
    const invitado = await request.newContext({
      baseURL: API,
      extraHTTPHeaders: { origin: WEB },
    });
    ```
  - **Exit criterion**: `nuevoInvitado()` devuelve un cliente aislado de los demás; la
    **primera** escritura pasa sin `X-CSRF-Token` (no hay cookie que secuestrar) y toda
    escritura posterior lo manda derivado de la cookie legible; **omitirlo a propósito en
    una segunda escritura es rechazado con 403** — la prueba de que el cliente habla CSRF
    de verdad y no lo está esquivando; `reabrir(invitado)` devuelve un cliente nuevo que
    sólo conserva las cookies persistentes y recupera el mismo carrito. Ninguna función
    recibe ni expone el token de `dsm_cart`: pasarlo a mano probaría que el servidor
    acepta un token, no que el invitado conserva su carrito.
  - **Verify**: `pnpm --filter @dsm/qa exec tsx support/cart-client.smoke.ts`
    *(el smoke recorre las cuatro propiedades: primera escritura sin CSRF → 200; segunda
    con CSRF → 200; segunda **sin** CSRF → 403; reapertura → mismo `cart.id`; invitado
    nuevo → carrito vacío con `id: null`)*

## Fase 2: Aceptación BDD API-level — happy y corner

- [ ] T2.1 Escenarios happy del carrito (AC-1, AC-2, AC-3, AC-4)
  - **Pattern**: feature en español con `# language: es` y tag de feature `@carrito`,
    escenarios titulados `TC-NNN — …` como `browse.feature`; steps que reusan el world
    existente (`this.admin` para sembrar, el cliente de T1.2 para el invitado) —
    `per bdd-scenario-quality §Gherkin grammar — imperativo en la acción, declarativo en
    el resultado`.
  - **Exit criterion**: TC-701..TC-704 verdes contra el stack arrancado. TC-701 assertea
    el **precio que el dueño le puso** (no un precio cualquiera), el subtotal como
    producto de precio × cantidad, y el total. TC-704 usa `reabrir()`: el carrito se
    recupera desde un cliente **nuevo** que sólo lleva las cookies persistentes y **sin
    ninguna cuenta** de por medio; reusar el mismo contexto no probaría AC-4.
  - **Verify**: `pnpm --filter @dsm/qa exec env NODE_OPTIONS="--import tsx" cucumber-js --config acceptance/cucumber.mjs --tags "@carrito and @happy" --format summary 2>&1 | grep -qE '^4 scenarios \(4 passed\)$'`

- [ ] T2.2 Escenarios corner del carrito (AC-5, AC-7, AC-6 parcial)
  - **Pattern**: el estado previo se arma con el cliente del invitado, nunca con datos
    dejados por otro escenario — `per qa-three-layer-regression §Cross-layer rules — un
    escenario nunca depende del residuo de otro`.
  - **Exit criterion**: TC-705..TC-707 verdes. TC-705 assertea las **tres** cosas: que
    rechaza, que informa la cantidad realmente disponible, y que **la línea queda como
    estaba** (un rechazo que dejara el carrito a medias pasaría un test que sólo mirara el
    status). TC-706 assertea que **mirar el carrito no lo crea**: dos lecturas seguidas
    siguen vacías y el sistema no abrió carrito. TC-707 assertea que el total suma **sólo**
    la línea comprable, que la bloqueada conserva su propio subtotal, y que el carrito
    prende la señal de bloqueo que el checkout de US-008 consume.
  - **Verify**: `pnpm --filter @dsm/qa exec env NODE_OPTIONS="--import tsx" cucumber-js --config acceptance/cucumber.mjs --tags "@carrito and @corner" --format summary 2>&1 | grep -qE '^3 scenarios \(3 passed\)$'`

## Fase 3: Negative-space y cross-feature

- [ ] T3.1 **AC-8 — el carrito no reserva ni descuenta stock** (el escenario de más valor)
  - **Pattern**: tres `APIRequestContext` independientes ponen el stock completo cada uno;
    la aserción de inventario se hace **contra el panel del dueño** (`GET /v1/admin/products`)
    y contra la **ficha pública**, nunca contra el repositorio del carrito —
    `per testing-standards.md §14.9 — negative-space: asertar lo que NO tiene que pasar`.
  - **Exit criterion**: TC-709 verde, y **diseñado para ponerse rojo si alguien reserva**:
    (a) con stock 3, **tres** invitados distintos quedan con las 3 unidades y
    `availability: available` — con reserva, el segundo recibiría rechazo o quedaría sin
    stock suficiente, que es la única forma de distinguirla; (b) el **dueño sigue viendo 3
    unidades en su panel**, no 0 ni «3 con 9 reservadas»; (c) la **ficha pública** sigue
    anunciando el producto disponible; (d) tras un ciclo completo de subir, bajar y quitar
    líneas, el dueño **sigue viendo 3** — descarta un decremento diferido. La versión de un
    solo invitado no vale: pasa igual con la reserva implementada.
  - **Verify**: `pnpm --filter @dsm/qa exec env NODE_OPTIONS="--import tsx" cucumber-js --config acceptance/cucumber.mjs --tags "@carrito" --name "N-2" --format summary 2>&1 | grep -qE '^1 scenario \(1 passed\)$'`

- [ ] T3.2 AC-10 — lo no publicado no entra, y no se distingue de lo inexistente
  - **Pattern**: `Esquema del escenario` con `Ejemplos` para los tres estados, en vez de
    tres escenarios casi idénticos — `per bdd-scenario-quality §Scenario Outline`.
  - **Exit criterion**: TC-708 verde en los tres ejemplos (borrador, archivado,
    inexistente). Assertea las **tres** propiedades: rechazo, que el producto **no queda
    incorporado** al carrito (releerlo lo confirma), y que las tres respuestas son
    **indistinguibles entre sí** — si el borrador respondiera distinto del inexistente, el
    carrito sería un oráculo de enumeración del catálogo oculto.
  - **Verify**: `pnpm --filter @dsm/qa exec env NODE_OPTIONS="--import tsx" cucumber-js --config acceptance/cucumber.mjs --tags "@carrito" --name "N-1" --format summary 2>&1 | grep -qE '^3 scenarios \(3 passed\)$'`

- [ ] T3.3 Cross-feature: la costura con el panel (US-001) y con la ficha (US-003)
  - **Pattern**: el dueño muta **por la API de admin real** (no por la base) mientras el
    invitado tiene el producto en el carrito; el invitado relee — `per
    qa-three-layer-regression §Layer 3 — flujos que cruzan changes de disciplinas`.
  - **Exit criterion**: TC-710..TC-712 verdes. TC-710 (AC-6): despublicado desde el panel,
    la línea **sigue existiendo** marcada, queda **fuera del total**, prende la señal de
    bloqueo, **y se puede quitar** — la última parte cierra el callejón sin salida de un
    ítem que no se puede comprar ni sacar. TC-711 (AC-9): cambiado el precio, la lectura
    siguiente usa el **nuevo** en unitario, subtotal y total, avisa que cambió, y la
    respuesta **no es cacheable** — la ficha puede seguir sirviendo el precio viejo desde
    su caché de 60 s y el carrito no. TC-712: el identificador que **publica la ficha** es
    el que el carrito acepta, y el precio de las dos superficies coincide.
  - **Verify**: `pnpm --filter @dsm/qa exec env NODE_OPTIONS="--import tsx" cucumber-js --config acceptance/cucumber.mjs --tags "@carrito and @cross-feature" --format summary 2>&1 | grep -qE '^3 scenarios \(3 passed\)$'`

## Fase 4: E2E de navegador — **BLOQUEADA: el FE está planificado, sin construir**

> Las dos tasks quedan escritas y sin ejecutar. No es trabajo muerto: son los criterios
> observables contra los que el FE se va a construir — y el plan de FE se escribió **hoy,
> en paralelo**, así que llegan a tiempo. Se desbloquean con `/develop-frontend-web US-007`.

- [ ] T4.1 Recorrido de compra y persistencia real (AC-1, AC-2, AC-3, AC-4, AC-7)
  - **Pattern**: selectores por rol/etiqueta accesible, nunca cadenas CSS ni índices;
    esperar asertando el estado siguiente, nunca `waitForTimeout` — `per
    playwright-stability §Selectors + §Auto-waiting`.
  - **Exit criterion**: TC-720 verde (desde la ficha: agregar, ver la línea con precio y
    subtotal, editar con el stepper, quitar); TC-721 verde — el carrito se recupera en un
    **contexto de navegador nuevo** que sólo conserva las cookies persistentes, sin
    cuenta; TC-722 verde — el carrito vacío muestra estado vacío **con salida al catálogo**
    (AC-7 pide la invitación a seguir comprando, no sólo la ausencia de ítems).
  - **Verify**: `pnpm --filter @dsm/qa test:e2e -- --grep "TC-720|TC-721|TC-722" --reporter=line 2>&1 | grep -qE '^ *3 passed'`

- [ ] T4.2 Los tres avisos del carrito (AC-5, AC-6, AC-9)
  - **Pattern**: ídem T4.1; para cualquier cambio hecho por el panel, `expect.poll`
    re-navegando —nunca una espera fija— porque el storefront cachea el catálogo 3600 s
    (el carrito no, pero la ficha sí) — `per playwright-stability §Anti-patterns`.
  - **Exit criterion**: TC-723 verde — el stepper **no deja** superar el stock y muestra el
    motivo; TC-724 verde — la línea no disponible se ve marcada y no ofrece camino al pago;
    TC-725 verde — el importe mostrado es el vigente y el cambio de precio queda avisado.
  - **Verify**: `pnpm --filter @dsm/qa test:e2e -- --grep "TC-723|TC-724|TC-725" --reporter=line 2>&1 | grep -qE '^ *3 passed'`

## Fase 5: Accesibilidad — **BLOQUEADA: el FE está planificado, sin construir**

- [ ] T5.1 axe-core sobre las tres variantes del carrito
  - **Pattern**: `AxeBuilder` con `withTags(['wcag2a','wcag2aa'])` sobre cada variante,
    como en `categoria-a11y.spec.ts` — `per qa-frontend-standards.md §19`.
  - **Exit criterion**: TC-730 verde con **0 violaciones nivel AA** en las tres variantes
    que esta US produce: carrito con ítems, carrito vacío y carrito **con una línea
    bloqueada** (la tercera es la de mayor superficie: suma avisos y estados).
  - **Verify**: `pnpm --filter @dsm/qa test:a11y -- --grep "TC-730" --reporter=line 2>&1 | grep -qE '^ *[1-9][0-9]* passed'`

- [ ] T5.2 Stepper y quitar por teclado, con anuncio del total
  - **Pattern**: contar los focusables que preceden al objetivo y tabular esa cantidad
    exacta —nunca un presupuesto fijo de `Tab`—, y asertar foco **visible** en cada parada;
    el anuncio se verifica sobre la región viva, no sobre el texto suelto — `per
    qa-frontend-standards.md §19 + la lección del recorrido de teclado de US-002`.
  - **Exit criterion**: TC-731 verde — el stepper y la acción de quitar se alcanzan y se
    operan **sólo con teclado**, con orden de foco lógico y foco visible; y al cambiar la
    cantidad, **el nuevo total queda anunciado** por una región viva. Los dos requisitos
    están en la US §9 por su nombre y **axe no detecta ninguno**: ni la alcanzabilidad por
    `Tab` ni la ausencia de anuncio.
  - **Verify**: `pnpm --filter @dsm/qa test:e2e -- --grep "TC-731" --reporter=line 2>&1 | grep -qE '^ *[1-9][0-9]* passed'`

## Fase 6: Carga

- [ ] T6.1 Escenario k6 de **escritura** del carrito (NFR PRD §4)
  - **Pattern**: presupuesto en `qa/performance/lib/thresholds.js` (fuente única, como
    `list_products` y `storefront_product`), consumido por el script; tag
    `endpoint:cart_write`; `check` de status **y** de cuerpo — `per k6-load-scaffolding
    §Threshold discipline + §Checks vs thresholds`.
    ```js
    export const cart_write = {
      'http_req_duration{endpoint:cart_write}': ['p(95)<500'],
      http_req_failed: ['rate<0.01'],
      checks: ['rate>0.99'],
      'rate_limited': ['count<1'],   // un 429 invalida la medición, no la degrada
    };
    ```
  - **Exit criterion**: `qa/performance/cart-write.js` corre `PUT` + `DELETE` con **un
    invitado nuevo por iteración** (cookie propia y su double-submit; reusar un carrito
    mediría el upsert de una fila caliente, no el patrón real), los `check` verifican que
    la respuesta trae la línea y no sólo un 200, y el presupuesto **p95 < 500 ms sale del
    PRD §4** («latencia p95 escritura (carrito/orden)») vía `thresholds.js` — no está
    hardcodeado en el script. El contador `rate_limited` con umbral `count<1` **aborta la
    corrida si aparece un 429**: con `CART_WRITE_RATE_LIMIT_MAX = 30` por minuto y por IP
    (0,5 rps), un k6 sin esa guarda reportaría un p95 del throttler y no del carrito
    (OQ-QA-2).
  - **Verify**: `grep -q "http_req_duration{endpoint:cart_write}" qa/performance/lib/thresholds.js && grep -q "p(95)<500" qa/performance/lib/thresholds.js && k6 run --vus 2 --duration 20s qa/performance/cart-write.js`

- [ ] T6.2 Registrar el **rechazo** del stub de carga de lectura (OQ-QA-1)
  - **Pattern**: cuando no hay número ratificado, no se emite el stub — se documenta el
    rechazo con su fundamento y se mide sin umbral — `per k6-load-scaffolding
    §Anti-patterns — thresholds no trazables a un budget`.
  - **Exit criterion**: **no existe** ningún script de carga sobre `GET /v1/cart`, el
    rechazo queda documentado en `qa-plan.md` §5.4 con su fundamento (el PRD §4 acota sus
    300 ms a «catálogo/ficha»; el `design.md` del backend marca el valor del carrito como
    `[propuesto — confirma Arquitecto]`), y la lectura se **mide sin threshold** dentro de
    la corrida de T6.1 para que el número exista cuando haya que firmarlo.
  - **Verify**: `! test -f qa/performance/cart-read.js && grep -q "stub rechazado a propósito" openspec/changes/US-007-carrito-compra-qa/qa-plan.md && grep -q "endpoint:cart_read" qa/performance/cart-write.js && ! grep -q "endpoint:cart_read" qa/performance/lib/thresholds.js`
    *(las cuatro partes juntas son el criterio: no hay script de lectura, el rechazo está
    fundamentado, la lectura **se mide** con su tag, y ese tag **no tiene** presupuesto)*

## Fase 7: Exploratorio

- [ ] T7.1 Charters del carrito (TC-750, TC-751)
  - **Pattern**: apéndice a `qa/exploratory/charters.md`, con misión, áreas, riesgos,
    heurísticas y **justificación de por qué es manual** — mismo formato que los charters
    que US-001 y US-002 ya dejaron en ese archivo.
  - **Exit criterion**: TC-750 y TC-751 documentados **sin reescribir** los charters
    anteriores. TC-750 (bloqueado hasta que el FE esté construido): el carrito frente a navegadores
    reales — incógnito, cookies bloqueadas, varias pestañas, y el techo de vida de cookie
    de Safari/ITP que cae justo en los mismos 7 días de `CART_TTL_DAYS`. TC-751
    (ejecutable ya): la ventana de 7 días contra el ciclo real de compra del gremio, que
    es el costo que el PO aceptó por escrito en OQ-BE-1.
  - **Verify**: `grep -q "TC-750" qa/exploratory/charters.md && grep -q "TC-751" qa/exploratory/charters.md && grep -q "Charters de testing exploratorio" qa/exploratory/charters.md`
    *(el tercer grep es el ancla anti-sobrescritura: falla si el apéndice reemplazó el
    archivo en vez de agregarse; se probó en seco contra el archivo actual)*

---

## Hallazgos fuera de alcance (no abren trabajo en esta US)

- **H-1 — Un `Verify:` de Cucumber sin ancla de conteo pasa verde con 0 escenarios.**
  - **Síntoma**: `cucumber-js --config acceptance/cucumber.mjs --tags "@lo-que-sea"` con un
    tag que no matchea nada imprime `0 scenarios` y **sale con código 0** (medido el
    2026-08-22 en este repo). Un `Verify:` que sólo corra el comando pasa **antes de que el
    feature file exista**, que es exactamente el trap F50 («verde pero no probado»).
  - **Dónde aplica**: los `Verify:` de aceptación de los changes de QA de US-002 (T3.1,
    T3.2, T3.3) tienen esa forma. **No están mal hoy** —sus escenarios existen y están
    verdes—, pero la línea no probaría el criterio si el feature file desapareciera o si
    un tag se renombrara: el gate se volvería decorativo en silencio.
  - **Contraste**: Playwright **no** tiene el problema — `playwright test --grep` sin match
    sale con código **1** (medido igual).
  - **Fuera de alcance de US-007**: acá se aplica el ancla de conteo en las tasks nuevas;
    corregir los `Verify:` de los changes de US-002/US-003 es trabajo de esos changes.
    Queda registrado para que el PO decida si vale un pase de saneamiento.

## Verification (suite-level)

- [ ] **Aceptación del carrito verde — 12/12 escenarios** (`@carrito`)
  - **Verify**: `pnpm --filter @dsm/qa exec env NODE_OPTIONS="--import tsx" cucumber-js --config acceptance/cucumber.mjs --tags "@carrito" --format summary 2>&1 | grep -qE '^12 scenarios \(12 passed\)$'`
- [ ] **La suite de aceptación completa sigue verde** (no se rompió US-001/US-002/US-003)
  - **Verify**: `pnpm --filter @dsm/qa test:acceptance`
- [ ] **Carga de escritura bajo presupuesto** (p95 < 500 ms, sin 429)
  - **Verify**: `k6 run --vus 2 --duration 20s qa/performance/cart-write.js`
- [ ] **E2E de navegador y a11y** — **Bloqueados**: el FE de US-007 está planificado y sin
  desarrollar (fases 4 y 5).
- [ ] **Los 10 AC tienen ≥1 test-case ejecutable**: AC-1 TC-701/TC-712 · AC-2 TC-702 ·
  AC-3 TC-703 · AC-4 TC-704 · AC-5 TC-705 · AC-6 TC-710/TC-707 (**la mitad «no permite
  avanzar al pago» la ejecuta US-008**, ver OQ-QA-3) · AC-7 TC-706 · AC-8 **TC-709** ·
  AC-9 TC-711 · AC-10 TC-708. La cobertura de UI de AC-1..AC-7 y AC-9 (TC-720..TC-725,
  TC-730, TC-731) queda **pendiente del FE**, declarada, no dada por cubierta.
