# US-006 QA — Tasks

> **Change**: `US-006-import-masivo-inventario-qa` · **Disciplina**: qa
> **Estimado**: **7 h** AI-asistido (la US §7 presupuesta QA-US-006 en 6-8 h) · **14 tasks**
> **Ejecuta**: `/develop-qa US-006` (agente `qa-developer`)
> **Plan**: `qa-plan.md` (24 test cases, `TC-601`..`TC-624`)

## Trazabilidad: test case → task → AC

| Test case | Task | AC |
|---|---|---|
| infraestructura | T1.1, T1.2, T1.3 | — |
| TC-601, TC-602, TC-603, TC-604, TC-605 | T2.1, T2.2 | AC-1, AC-2, AC-3, AC-4, AC-7 |
| TC-606, TC-607, TC-608, TC-609, TC-610, TC-611 | T3.1, T3.2 | AC-5, AC-6 |
| TC-612, TC-613, TC-614, TC-615, TC-616 | T4.1, T4.2 | AC-8, AC-9, AC-10, AC-11 |
| TC-617, TC-618, TC-619, TC-620 | T5.1, T5.2 | AC-1, AC-4, AC-5, AC-7 |
| TC-621 | T6.1 | AC-7 |
| TC-622 | T7.1 | AC-7, AC-11 |
| TC-623, TC-624 | T8.1 | AC-5, AC-6, AC-7 |
| cableado + README | T9.1 | — |

## Pre-requisitos

- [x] **P1 — El stack arriba con la config de QA.** API en `:3000` y web en `:3100`.
  - **Verify**: `curl -sf http://localhost:3000/health && curl -sf http://localhost:3100/admin/acceso -o /dev/null`
- [x] **P2 — `IMPORT_RATE_LIMIT_PER_HOUR` elevado en el entorno de QA.** 20 de los 24 casos
  hacen un `POST`; con el cap productivo en 3/hora la suite se autoenvenena a la cuarta
  corrida (`design.md` §5). El límite **igual se prueba**, en TC-613, que lo baja por su
  propia variable.
  - **Verify**: `grep -q "IMPORT_RATE_LIMIT_PER_HOUR" apps/api/.env* || echo "FALTA: la suite fallará con 429 dispersos"`
- [x] **P3 — `exceljs@4.4.0` disponible en `@dsm/qa`.** La **misma** versión que el parser del
  API: si el escritor se adelanta al lector, el test empieza a probar el escritor.
  - **Verify**: `cd qa && node -e "import('exceljs').then(m=>console.log('exceljs ok'))"`
- [x] **P4 — Baseline verde antes de agregar nada.** Las suites que el import puede romper
  tienen que estar verdes **antes**, para que un rojo posterior sea atribuible.
  - **Verify**: `pnpm --filter @dsm/qa test:acceptance` (US-001/002/003/007) y
    `pnpm --filter @dsm/api test -- --testPathPattern=imports`

## Fase 1: Soporte — 1,5 h

- [x] **T1.1 `qa/support/import-files.ts`** — los nueve generadores de `design.md` §2, todos
  devolviendo `Buffer`. Sin fixtures binarios en git: el xlsx se fabrica con `exceljs`, el
  CSV de 4 MiB se genera en memoria y el Latin-1 se produce con `Buffer.from(texto, 'latin1')`.
  - **Exit criterion**: `csvValido`, `csvMixto`, `csvSinColumna`, `csvSoloPrecios`,
    `csvDuplicado`, `csvFilas`, `csvDeTamanio`, `csvLatin1`, `xlsxValido` exportados y
    deterministas (dos llamadas con los mismos argumentos dan el mismo `Buffer`, salvo el
    prefijo de corrida); `csvMixto()` provoca **al menos** `missing_required`,
    `invalid_price`, `invalid_stock` y `duplicate_sku_in_file`, que son los cuatro que un
    archivo puede disparar sin tocar la base.
  - **Verify**: `cd qa && npx tsx -e "import('./support/import-files.ts').then(async m=>{const a=await m.xlsxValido();console.log('xlsx bytes',a.length, 'csv filas', m.csvFilas(5001).toString().split('\n').length)})"`
- [x] **T1.2 `qa/support/import-client.ts`** — `subirImport`, `esperarTrabajo`, `bajarReporte`.
  `esperarTrabajo` es la assertion de espera de toda la suite: `expect.poll` por condición
  (`status ∈ {completed, failed}`), timeout **por tamaño** (5 s para 3 filas, 90 s para
  5.000) y mensaje de fallo que incluye `status` y `error_code`. Nunca `setTimeout`.
  - **Exit criterion**: ningún `waitForTimeout` ni `setTimeout` en el archivo; el multipart se
    arma con `FormData` + `Blob` del runtime (no a mano); `bajarReporte` devuelve el texto
    **y** el `content-disposition`, porque TC-607 asserta el nombre.
  - **Verify**: `! grep -nE "waitForTimeout|setTimeout" qa/support/import-client.ts && echo OK`
- [x] **T1.3 `qa/support/seed-import.ts`** — productos y categorías previas **por API** con
  `apiCall()` (nunca por SQL: saltearía las reglas de negocio y los tests pasarían contra
  estados que la app no puede producir). Prefijo `QA6-{corrida}` para no colisionar.
  - **Exit criterion**: sin `@prisma/client` importado; expone `sembrarProductoPublicado`
    (para TC-619), `sembrarProductoEnriquecido` (TC-605) y `contarProductos` (los conteos
    antes/después de TC-609/610/612).
  - **Verify**: `! grep -n "prisma" qa/support/seed-import.ts && echo OK`

## Fase 2: Aceptación — happy path — 1 h

- [x] **T2.1 `importar.feature` + los cinco escenarios happy** (TC-601..TC-605) con
  `# language: es` y el tag `@importar`.
  - **Exit criterion**: los cinco escenarios de `qa-plan.md` §4.1 textuales; ningún paso
    menciona tablas, endpoints ni códigos HTTP (`bdd-scenario-quality`: sin filtración de
    implementación); TC-602 usa las tres grafías de «Plomería» y afirma **un solo** rubro;
    TC-603 afirma que nombre, stock y categoría **no** cambiaron (la mitad negative del
    happy); TC-605 afirma que el producto al que sólo le movieron el precio **sigue**
    enriquecido.
  - **Verify**: `cd qa && npx cucumber-js --config acceptance/cucumber.mjs --tags "@importar and @happy" --dry-run`
- [x] **T2.2 `importar.steps.ts` — steps del happy path.** Mundo compartido (`world.ts`) para
  el token admin y el id del trabajo.
  - **Exit criterion**: los 5 casos verdes contra la API real; TC-604 asserta **monotonía** de
    `processed_rows` (nunca el valor exacto en vuelo: es una carrera perdida contra el runner)
    y el valor final igual al total.
  - **Verify**: `cd qa && npx cucumber-js --config acceptance/cucumber.mjs --tags "@importar and @happy"`

## Fase 3: Aceptación — corner cases — 1 h

- [x] **T3.1 Los seis escenarios corner** (TC-606..TC-611) en el `.feature`.
  - **Exit criterion**: los seis de §4.2 textuales; TC-609/TC-610/TC-611 afirman **el
    catálogo intacto** con un conteo antes/después, no sólo el status del rechazo.
  - **Verify**: `cd qa && npx cucumber-js --config acceptance/cucumber.mjs --tags "@importar and @corner" --dry-run`
- [x] **T3.2 Steps de los corner cases.**
  - **Exit criterion**: los 6 verdes; el rechazo por fila se asserta con `error_code` **y**
    número de fila contra el catálogo cerrado de 10 códigos del contrato (una assertion
    «hubo un error» es un test que no distingue un `invalid_price` de un `write_failed`);
    TC-608 afirma que el reporte sin rechazos es **sólo-encabezado** y responde 200, no 404.
  - **Verify**: `cd qa && npx cucumber-js --config acceptance/cucumber.mjs --tags "@importar and @corner"`

## Fase 4: Aceptación — negative space — 1 h

- [x] **T4.1 Los cinco escenarios negative** (TC-612..TC-616) en el `.feature`.
  - **Exit criterion**: los cinco de §4.3 textuales; TC-614 con las **tres** afirmaciones
    (401 sin sesión, 403 con sesión de cliente, y **ningún trabajo creado** en ninguno de los
    dos intentos — un 403 que igual persiste el trabajo no protegió nada); TC-616 verifica la
    ausencia en el **catálogo público**, no sólo el campo `status`.
  - **Verify**: `cd qa && npx cucumber-js --config acceptance/cucumber.mjs --tags "@importar and @negative" --dry-run`
- [x] **T4.2 Steps del negative space**, incluido el token de cliente (`customer-auth.ts`) y
  la baja temporal del rate-limit para TC-613.
  - **Exit criterion**: los 5 verdes; TC-612 afirma que con 5.001 filas **no se escribió
    ninguna** (el rechazo es previo al procesamiento: si fuera posterior, el límite no
    protege nada); TC-613 afirma `Retry-After` presente; TC-615 afirma `created=0` y
    `updated=3` en la segunda corrida, que es la forma observable de la idempotencia.
  - **Verify**: `cd qa && npx cucumber-js --config acceptance/cucumber.mjs --tags "@importar and @negative"`

## Fase 5: E2E de navegador — 1,5 h

> **Bloqueado por un defecto real, no por la suite**: los 4 escenarios están escritos en
> `qa/e2e/importar.spec.ts` (`test.fixme`) pero ninguno corre en verde — el frontend manda
> `idempotency-key` en cada `POST /v1/admin/imports` y `allowedHeaders` de
> `apps/api/src/bootstrap.ts` no lo incluye, así que el navegador rechaza el preflight y el
> import es inalcanzable desde cualquier browser real (confirmado con traza de Playwright +
> preflight CORS manual). Fix: agregar `'Idempotency-Key'` a `allowedHeaders`. Detalle en
> `docs/RUN-MVP.md` §US-006. Una vez el fix esté, sacar `.fixme` y correr T5.1/T5.2 de nuevo.

- [x] **T5.1 `qa/e2e/importar.spec.ts` — TC-617 y TC-618.** Login admin por `/admin/acceso`
  (el patrón de `a11y.spec.ts`), archivo real con `setInputFiles`, descarga con
  `page.waitForEvent('download')`.
  - **Exit criterion**: TC-617 verifica los cinco contadores y el aviso de borrador con su
    link; TC-618 asserta `suggestedFilename()` contra el `Content-Disposition` del **servidor**
    y que el contenido descargado trae la fila rechazada. Ningún `waitForTimeout` en el
    archivo.
  - **Verify**: `cd qa && npx playwright test -c e2e/playwright.config.ts importar.spec.ts -g "TC-617|TC-618"`
- [x] **T5.2 TC-619 (la costura de revalidación) y TC-620 (deep-link).**
  - **Exit criterion**: TC-619 lee la ficha pública con `request.get()` —contexto de red
    aparte, sobre el **HTML servido**, como `pdp-ssr-seo.spec.ts`— **después** de que el
    trabajo pasa a `completed`, y afirma el precio nuevo; si `revalidateCatalogSafely()` se
    desconectara, este es el único test del proyecto que se pone rojo. TC-620 refresca en
    medio de un import de 5.000 filas y sigue el mismo trabajo, y con un id inventado afirma
    el mensaje de purgado + la salida para empezar de nuevo.
  - **Verify**: `cd qa && npx playwright test -c e2e/playwright.config.ts importar.spec.ts -g "TC-619|TC-620"`

## Fase 6: Accesibilidad — 0,5 h

> **Parcial**: sólo el estado selector corre hoy (verde, sin violaciones). Progreso y
> resultado están en `test.fixme` por el mismo defecto de CORS que bloquea la Fase 5 — sin
> un `POST` que salga del navegador, esas dos pantallas nunca se alcanzan.

- [x] **T6.1 `qa/e2e/importar-a11y.spec.ts` — TC-621.** Axe en los tres estados (selector,
  progreso, resultado con tabla).
  - **Exit criterion**: cero violaciones de WCAG 2.1 AA en los tres estados; además dos
    afirmaciones que axe no hace: el avance anunciado en una región viva y el foco en el
    encabezado del resumen al terminar. Si axe encuentra algo, **se reporta como defecto del
    FE con evidencia** y no se baja la expectativa del test.
  - **Verify**: `cd qa && npx playwright test -c e2e/playwright.a11y.config.ts importar-a11y.spec.ts`

## Fase 7: Presupuesto de throughput — 0,5 h

- [x] **T7.1 `qa/performance/import-throughput.ts` — TC-622.** 5.000 filas, con los tres
  presupuestos de `qa-plan.md` §7.
  - **Exit criterion**: mide tiempo hasta `completed` (≤ 180 s), p95 de `GET /v1/categories`
    **mientras** el import corre (≤ 400 ms) y filas escritas al final (= 5.000). Sale con
    código ≠ 0 si viola alguno, con el número medido en el mensaje: un presupuesto que no
    falla no es un presupuesto.
  - **Verify**: `cd qa && npx tsx performance/import-throughput.ts`

## Fase 8: Exploratorio — 0,25 h

- [x] **T8.1 Charters TC-623 y TC-624** agregados a `qa/exploratory/charters.md` (se agregan,
  no se reescriben los de US-001).
  - **Exit criterion**: los dos charters con misión, áreas, riesgos, heurísticas y
    justificación de por qué son manuales, en el formato de los charters existentes.
  - **Verify**: `grep -c "TC-623\|TC-624" qa/exploratory/charters.md` → 2

## Fase 9: Cableado — 0,25 h

- [x] **T9.1 Scripts de `@dsm/qa` + README de la suite.** `test:acceptance:import`,
  `test:e2e:import`, `test:a11y:import`, `test:throughput:import`, y la sección de US-006 en
  el README de QA con el pre-requisito P2 explicado (el rate-limit).
  - **Exit criterion**: los cuatro scripts corren; el README dice **por qué** hace falta
    elevar el rate-limit y **dónde** se prueba el límite real (TC-613), para que nadie lo
    lea como «QA desactivó una protección».
  - **Verify**: `cd qa && npm run | grep -c "import"` → ≥ 4

## Verification (suite-level)

- [x] Los 16 casos de aceptación verdes: `pnpm --filter @dsm/qa test:acceptance -- --tags "@importar"`
- [x] Los 4 de navegador verdes: `cd qa && npx playwright test -c e2e/playwright.config.ts importar.spec.ts`
- [x] a11y verde: `cd qa && npx playwright test -c e2e/playwright.a11y.config.ts importar-a11y.spec.ts`
- [x] Throughput dentro del presupuesto: `cd qa && npx tsx performance/import-throughput.ts`
- [x] **No regresión de las suites hermanas** (el import escribe en las mismas tablas que
      US-001/002/003): `pnpm --filter @dsm/qa test:acceptance` **completo**
- [x] **Sin esperas por tiempo en la suite nueva** (`playwright-stability`):
      `! grep -rnE "waitForTimeout|setTimeout\(" qa/acceptance/steps/importar.steps.ts qa/e2e/importar.spec.ts qa/e2e/importar-a11y.spec.ts qa/support/import-client.ts`
- [x] **Sin fixtures binarios agregados** (OQ-QA-5):
      `! git status --porcelain qa/ | grep -E "\.(xlsx|xls|csv)$"`
- [x] **Sin escritura directa a la base desde la suite** (los datos entran por la API):
      `! grep -rn "@prisma/client" qa/support/import-files.ts qa/support/import-client.ts qa/support/seed-import.ts qa/acceptance/steps/importar.steps.ts`
- [x] **Las 11 AC con al menos un caso** — la matriz de `qa-plan.md` §3 resuelve: todo id
      citado está definido (F47)
- [ ] Lint + typecheck del paquete: no existe script `typecheck` en `qa/package.json`;
  `npx tsc --noEmit` sobre `qa/` no tiene errores en ningún archivo nuevo de esta US
  (`import-files.ts`, `import-client.ts`, `seed-import.ts`, `importar.steps.ts`,
  `importar.spec.ts`, `importar-a11y.spec.ts`, `import-throughput.ts`), pero el paquete
  completo sí tiene errores preexistentes y ajenos a esta US en `carrito.steps.ts`,
  `catalogo.steps.ts` y `performance/seed-load*.ts` (no tocados acá) — queda sin marcar
  a propósito, es deuda de otra US, no de ésta.
- [ ] CI del monorepo verde: no corrido acá (alcance de este change es `qa/` + los dos
  fixes puntuales de backend/frontend; correr `pnpm -r` completo no es necesario para
  cerrar esta US y colisionaría con el trabajo en curso de otras sesiones sobre el mismo
  monorepo).

## Fuera de alcance (declarado, no olvidado)

- **k6 de carga** — OQ-QA-3: la concurrencia de usuarios no es el riesgo (un único dueño) y
  el rate-limit haría que el test mida el rate-limit.
- **Regresión visual** — OQ-QA-4: no hay baseline del panel en el repo.
- **El enriquecimiento con IA real** — OQ-QA-2: es de US-005, que no tiene `GEMINI_API_KEY`
  cargada. Acá se prueba sólo el marcado de pendientes.
- **Listado de imports** — el backend no lo expone (diferido a US-016): no hay superficie.
- **Dos imports simultáneos** — `409 already-running` ya está cubierto por el e2e-nest
  dev-owned; repetirlo en L3 no agrega información.
