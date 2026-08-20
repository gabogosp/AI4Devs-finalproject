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

- [ ] **Backend de US-002 desarrollado y verde** (hoy 18 tasks abiertas).
  - **Exit criterion**: los tres endpoints públicos responden y `pnpm --filter @dsm/api test` está verde.
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=categor`
- [ ] **FE-US-002 desarrollado y verde** — las páginas de categoría deben existir (OQ-QA-1).
  - **Exit criterion**: existen las rutas de rubro y subrubro en `apps/web` y `pnpm -r test` está verde.
  - **Verify**: `pnpm -r test`
- [ ] **D-1 propagada al plan de backend** — el enlace del listado debe usar `slug`, no `sku` (OQ-QA-2).
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
- [ ] T2.5 Core Web Vitals con catálogo grande (AC-7)
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

- [ ] T4.1 axe-core sobre las dos variantes de la categoría
  - **Exit criterion**: TC-220 verde con **0 violaciones nivel AA** en la categoría con productos y en la vacía.
  - **Verify**: `pnpm --filter @dsm/qa test:a11y`
- [ ] T4.2 Navegación y paginación operables sólo con teclado
  - **Exit criterion**: TC-221 verde — recorrido con `Tab`/`Enter` que alcanza el árbol rubro→subrubro y los controles de paginación, con orden de foco lógico y foco **visible** en cada parada. axe no cubre esto: no detecta alcanzabilidad.
  - **Verify**: `pnpm --filter @dsm/qa test:e2e -- --grep "TC-221"`

## Fase 5: Carga

- [ ] T5.1 Escenario k6 del listado paginado
  - **Exit criterion**: TC-230 verde — `qa/performance/category-products.js` contra `GET /v1/categories/{slug}/products` con el dataset de `seed:load`; **varía el offset** para recorrer páginas distintas (martillar un offset fijo mediría la caché de 60 s y daría un p95 falso); budget `p95 < 300ms` tomado de `thresholds.js` bajo el tag `endpoint:category_products`; `setup()` sin login.
  - **Verify**: `pnpm --filter @dsm/qa seed:load && k6 run --vus 2 --duration 30s qa/performance/category-products.js`

## Fase 6: Exploratorio

- [ ] T6.1 Charters de indexación real y de coherencia del árbol
  - **Exit criterion**: TC-240 y TC-241 documentados en `qa/exploratory/charters.md` con misión, áreas, riesgos y heurísticas; marcados `execution_mode: manual` con su justificación.
  - **Verify**: `grep -q "TC-240" qa/exploratory/charters.md && grep -q "TC-241" qa/exploratory/charters.md`

## Verification (suite-level)

- [ ] Aceptación verde: `pnpm --filter @dsm/qa test:acceptance`
- [ ] E2E SSR/SEO/sitemap verde: `pnpm --filter @dsm/qa test:e2e`
- [ ] Accesibilidad 0 violaciones AA + recorrido de teclado verde: `pnpm --filter @dsm/qa test:a11y`
- [ ] Carga p95 bajo presupuesto recorriendo páginas: `pnpm --filter @dsm/qa seed:load && k6 run --vus 2 --duration 30s qa/performance/category-products.js`
- [ ] **Los 10 AC** (AC-1 a AC-10) tienen ≥1 test-case verde. Ninguno queda diferido en esta US.
