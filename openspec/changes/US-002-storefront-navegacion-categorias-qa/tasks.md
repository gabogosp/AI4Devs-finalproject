---
parent-us: US-002
discipline: qa
language: es
---

# US-002 QA — Tasks

> **Estimación dual**: tradicional **6-8 h** · AI-asistido **3-4 h** (× ~0.45, Peng 2023).
> **Alcance**: capas owned-by-QA (L3 cross-stack). Las dev-owned NO se autoran acá.
> **Todas closure-grade**: `Exit criterion:` observable + `Verify:` con el comando exacto.
> **Ejecutor**: `/develop-qa US-002`.

## Pre-requisitos

- [x] **Backend de US-002 desarrollado y verde** *(verificado 2026-08-20: 18/18 tasks cerradas, 0 abiertas).*
  - **Exit criterion**: los tres endpoints públicos responden y `pnpm --filter @dsm/api test` está verde.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=categor`
- [x] **FE-US-002 desarrollado y verde** — las páginas de categoría existen *(verificado 2026-08-20: 20/20 tasks cerradas).*
  - **Exit criterion**: existen las rutas de rubro y subrubro en `apps/web` y `pnpm -r test` está verde.
  - **Verify**: `pnpm -r test`
- [x] **D-1 propagada al plan de backend** — el enlace usa `slug` *(verificado 2026-08-20; además TC-215 lo prueba de punta a punta: si la grilla enlazara por un identificador que la ficha no resuelve, daría 404).*
  - **Exit criterion**: el `proposal.md` del change de backend de US-002 ya no declara `sku` como identificador del enlace a la ficha; el DTO del listado expone el identificador vigente.
  - **Verify**: `! grep -q "el enlace del listado usa \`sku\`" openspec/changes/US-002-storefront-navegacion-categorias-backend/proposal.md`

## Fase 1: Datos de test del browse

- [x] T1.1 Extender el seed con la topología de categorías   <!-- verde 2026-08-19 — qa/support/seed-categorias.ts + api.ts (af61431) -->
  - **Exit criterion**: `seedBrowse()` en `qa/support/seed.ts` crea, vía API admin: un rubro con al menos dos subrubros; productos publicados repartidos entre el rubro y un subrubro (para verificar la agregación D1); una categoría publicada **sin** productos publicados; y dentro de una categoría poblada, un producto `draft` y uno `archived`. Devuelve los slugs e identificadores; re-ejecutar no colisiona.
  - **Verify**: `pnpm --filter @dsm/qa exec tsx support/seed-browse.smoke.ts`

## Fase 2: E2E de SSR / SEO / sitemap (Playwright)

- [x] T2.1 SSR real sobre el HTML sin JavaScript (AC-10)   <!-- verde 2026-08-19 — TC-208, contexto con JS deshabilitado (af61431) -->
  - **Exit criterion**: TC-208 verde — con JS **deshabilitado** en el contexto, el HTML servido de la categoría ya contiene los productos del listado. Un test que pasara con la página hidratada no vale.
  - **Verify**: `pnpm --filter @dsm/qa test:e2e -- --grep "TC-208"`
- [x] T2.2 Metadatos propios y sitemap (AC-4)   <!-- verde 2026-08-19 — TC-203 + TC-204 (9da1e86) -->
  - **Exit criterion**: TC-203 verde — `title` y `meta description` son propios de la categoría, no genéricos del sitio. TC-204 verde — el sitemap **lista** las categorías publicadas **y no lista** una inexistente (la exclusión es la mitad que se olvida y la que genera URLs fantasma indexadas).
  - **Verify**: `pnpm --filter @dsm/qa test:e2e -- --grep "TC-203|TC-204"`
- [x] T2.3 Rubro por slug y grilla paginada (AC-1, AC-3)   <!-- verde 2026-08-19 — TC-201 + TC-202 (af61431) -->
  - **Exit criterion**: TC-201 verde (URL por slug, subrubros y productos agregados del rubro) y TC-202 verde (grilla con nombre/precio/imagen-o-placeholder/disponibilidad, paginada, y avanzar de página **no** recarga el catálogo completo).
  - **Verify**: `pnpm --filter @dsm/qa test:e2e -- --grep "TC-201|TC-202"`
- [x] T2.4 No-publicados invisibles y 404 sin fantasma (AC-8, AC-9)   <!-- verde 2026-08-19 — TC-206 + TC-207 (af61431) -->
  - **Exit criterion**: TC-206 verde — el HTML servido de una categoría poblada **no** contiene el producto `draft` ni el `archived`. TC-207 verde — una categoría inexistente devuelve 404, no es un 200 vacío, y no aparece en el sitemap.
  - **Verify**: `pnpm --filter @dsm/qa test:e2e -- --grep "TC-206|TC-207"`
- [ ] T2.5 Core Web Vitals con catálogo grande (AC-7) — **Deferred: decisión PO 2026-08-20**
  - **Motivo**: medir LCP con ≥5.000 SKUs exige sembrar ese volumen en la **base de desarrollo compartida** por cuatro sesiones. El PO ya lo había rechazado una vez y lo ratificó: el costo (todos los listados del equipo pasan a tener miles de filas) supera al de diferir la medición.
  - **Qué queda cubierto igual**: AC-7 tiene cobertura por **construcción** — `PAGE_SIZE` es fijo y no configurable por query, y el E2E de FE-US-002 asserta contra el log del servidor que **ningún request pide más de 20 ítems** y que nada supera el techo de 100 del contrato. El catálogo completo no puede viajar en una respuesta.
  - **Qué NO queda cubierto**: la medición de LCP con catálogo real. Revisar cuando exista un entorno de staging con datos propios (US-019 / `/plan-deployment`), que es donde la medición además es representativa.
  - **Exit criterion**: TC-205 verde — LCP **< 2.5 s** en una categoría del dataset sembrado con ≥5.000 SKUs; el umbral sale del NFR de la US, no hardcodeado en el spec.
  - **Verify**: `pnpm --filter @dsm/qa test:e2e -- --grep "TC-205"`

## Fase 3: Aceptación BDD (Cucumber + Playwright)

- [x] T3.1 Features de happy path (AC-1, AC-2, AC-3)   <!-- verde 2026-08-20 — TC-210..212 -->
  - **AS-BUILT**: 3 escenarios verdes. Tres asserts se reescribieron para no depender del **orden**: el backend ordena por `name ASC` y los nombres del seed llevan sufijo numérico, así que el orden alfabético no coincide con el de creación ("-11" va antes que "-9"). Fijar `publicados[0]` ataba el test a una suposición que no es parte de ningún AC; ahora se asserta la propiedad (que aparezca alguno de los sembrados, que el rubro agregue los del hijo).
  - **Exit criterion**: TC-210..TC-212 verdes contra el stack real; runner en modo `strict`. TC-211 asierta que el subrubro lista **sólo** sus productos y que se puede volver al rubro padre.
  - **Verify**: `pnpm --filter @dsm/qa exec env NODE_OPTIONS="--import tsx" cucumber-js --config acceptance/cucumber.mjs --tags "@happy"`
- [x] T3.2 Features corner (AC-5, AC-6)   <!-- verde 2026-08-20 — TC-213, TC-214 -->
  - **AS-BUILT**: 2 escenarios verdes. TC-213 recorre las páginas hasta encontrar el producto sin stock en vez de asumir en cuál cae (mismo motivo de orden que T3.1).
  - **Exit criterion**: TC-213 verde — el producto sin stock aparece con indicador y **sin** acción de compra. TC-214 verde — la categoría vacía muestra estado vacío y ofrece salida a otros rubros.
  - **Verify**: `pnpm --filter @dsm/qa exec env NODE_OPTIONS="--import tsx" cucumber-js --config acceptance/cucumber.mjs --tags "@corner"`
- [x] T3.3 Cross-feature: la costura con US-003 y con el panel (X-1, X-2)   <!-- verde 2026-08-20 — TC-215, TC-216 -->
  - **AS-BUILT**: 2 escenarios verdes. TC-216 muta **por la UI del panel** (login real con bootstrap token → publicar), que es el único camino que dispara la Server Action de invalidación; por API directa el escenario daría verde sin probar el circuito. Usa `expect.poll` (30 s) contra una caché de 1 h: si el producto aparece sólo puede ser por la invalidación, y si no corre el poll agota y falla.
  - **Requisitos de entorno descubiertos al ejecutar** (no estaban en el plan): (a) la API necesita `CORS_ALLOWED_ORIGINS` con el origen del web — la config por defecto sólo admite `http://localhost:3000`, que es el puerto de la propia API, así que **ningún navegador puede usar el panel**; (b) necesita `ADMIN_BOOTSTRAP_TOKEN`, sin el cual el fixture degrada a un JWT minteado y el login del panel falla; (c) `AUTH_RATE_LIMIT_MAX` por defecto es 5 cada 15 min y la suite hace 2 logins por escenario.
  - **Exit criterion**: TC-215 verde — hacer clic en un producto de la grilla lleva a **su** ficha, con el mismo nombre y precio. TC-216 verde — publicar desde el panel hace aparecer el producto en la categoría tras la ventana de caché. TC-215 es el único test que detecta una divergencia de identificador entre grilla y ficha (ver OQ-QA-2).
  - **Verify**: `pnpm --filter @dsm/qa exec env NODE_OPTIONS="--import tsx" cucumber-js --config acceptance/cucumber.mjs --tags "@cross-feature"`

## Fase 4: Accesibilidad

- [x] T4.1 axe-core sobre las dos variantes de la categoría   <!-- verde 2026-08-20 — TC-220 -->
  - **AS-BUILT**: 3 variantes auditadas, 0 violaciones AA en las tres. Se agregó el **rubro con subrubros y paginación** además de las dos del plan: es la que suma más controles y por lo tanto la de mayor superficie a11y.
  - **Exit criterion**: TC-220 verde con **0 violaciones nivel AA** en la categoría con productos y en la vacía.
  - **Verify**: `pnpm --filter @dsm/qa test:a11y`
- [x] T4.2 Navegación y paginación operables sólo con teclado   <!-- verde 2026-08-20 — TC-221 -->
  - **AS-BUILT**: 3 tests verdes (alcance del subrubro, alcance de "Siguiente", orden de foco), más el chequeo de **foco visible** al llegar (WCAG 2.4.7), que axe no cubre.
  - **Falso rojo evitado**: la primera versión tabulaba a ciegas con un presupuesto fijo y fallaba porque la barra de rubros lista **todas** las categorías de la base, y el entorno de desarrollo compartido acumula decenas de corridas previas. Ahora se cuenta cuántos focusables preceden al objetivo y se tabula esa cantidad exacta: falla igual si el elemento está fuera del orden de tabulación, pero no por la cantidad de datos.
  - **Exit criterion**: TC-221 verde — recorrido con `Tab`/`Enter` que alcanza el árbol rubro→subrubro y los controles de paginación, con orden de foco lógico y foco **visible** en cada parada. axe no cubre esto: no detecta alcanzabilidad.
  - **Verify**: `pnpm --filter @dsm/qa test:e2e -- --grep "TC-221"`

## Fase 5: Carga

- [ ] T5.1 Escenario k6 del listado paginado — **Deferred: decisión PO 2026-08-20**
  - **Motivo**: mismo que T2.5 — el escenario necesita el dataset de `seed:load` sobre la base compartida.
  - **Qué NO queda cubierto**: el presupuesto `p95 < 300ms` del endpoint no se verifica en esta US. Revisar junto con T2.5 cuando exista staging; el escenario ya está diseñado en el plan (variar el offset para no medir la caché de 60 s), así que retomarlo es escribirlo, no re-decidirlo.
  - **Exit criterion**: TC-230 verde — `qa/performance/category-products.js` contra `GET /v1/categories/{slug}/products` con el dataset de `seed:load`; **varía el offset** para recorrer páginas distintas (martillar un offset fijo mediría la caché de 60 s y daría un p95 falso); budget `p95 < 300ms` tomado de `thresholds.js` bajo el tag `endpoint:category_products`; `setup()` sin login.
  - **Verify**: `pnpm --filter @dsm/qa seed:load && k6 run --vus 2 --duration 30s qa/performance/category-products.js`

## Fase 6: Exploratorio

- [x] T6.1 Charters de indexación real y de coherencia del árbol   <!-- 2026-08-20 — TC-240, TC-241 -->
  - **AS-BUILT**: apéndice a `qa/exploratory/charters.md` (no se reescribió lo de US-003). Ambos con misión, áreas, riesgos, heurísticas y **justificación de por qué son manuales**: TC-240 porque el criterio lo decide un tercero (el crawler) en su propia ventana y exige un dominio público que no existe hasta US-019; TC-241 porque el criterio es de usabilidad y juicio, no un assert.
  - **Exit criterion**: TC-240 y TC-241 documentados en `qa/exploratory/charters.md` con misión, áreas, riesgos y heurísticas; marcados `execution_mode: manual` con su justificación.
  - **Verify**: `grep -q "TC-240" qa/exploratory/charters.md && grep -q "TC-241" qa/exploratory/charters.md`

## Verification (suite-level)

- [x] Aceptación verde — **22 escenarios** (incluye US-001 y US-003) *(2026-08-20)*
- [x] E2E SSR/SEO/sitemap verde — **18/18** *(2026-08-20)*
- [x] Accesibilidad 0 violaciones AA + recorrido de teclado — **13/13** *(2026-08-20)*
- [ ] Carga p95 bajo presupuesto — **Deferred con T5.1** (decisión PO 2026-08-20: no sembrar 5.000 SKUs en la base compartida).
- [x] **Los 10 AC tienen ≥1 test-case verde** *(2026-08-20)*: AC-1 TC-201/TC-210 · AC-2 TC-211 · AC-3 TC-202/TC-212 · AC-4 TC-203/TC-204 · AC-5 TC-213 · AC-6 TC-214 · AC-7 **por construcción** (`PAGE_SIZE` fijo + el E2E de FE asserta contra el log del servidor que ningún request pide más de 20; la *medición* de LCP se difiere con T2.5) · AC-8 TC-206/TC-216 · AC-9 TC-207 · AC-10 TC-208.
