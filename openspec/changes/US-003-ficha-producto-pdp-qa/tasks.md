---
parent-us: US-003
discipline: qa
language: es
---

# US-003 QA — Tasks

> **Estimación dual**: tradicional **5-7 h** · AI-asistido **2-3 h** (× ~0.45, Peng 2023).
> **Alcance**: capas owned-by-QA (L3 cross-stack). Las dev-owned NO se autoran acá.
> **Todas closure-grade**: `Exit criterion:` observable + `Verify:` con el comando exacto.
> **Ejecutor**: `/develop-qa US-003`.

## Pre-requisitos

- [ ] **FE-US-003 desarrollado y verde** — la PDP debe existir para poder ejercitarla (OQ-QA-1).
  - **Exit criterion**: existe la ruta de ficha en `apps/web` y `pnpm -r test` está verde.
  - **Verify**: `pnpm -r test`
- [x] Backend de US-003 verde (19/19 tasks; `StorefrontModule` con 6 specs e2e-nest).
  - **Verify**: `pnpm --filter @dsm/api test -- --testPathPattern=storefront`

## Fase 1: Datos de test de la ficha pública

- [ ] T1.1 Extender el seed con los estados que esta US necesita
  - **Exit criterion**: `seedFichaPublica()` en `qa/support/seed.ts` crea, vía API admin, un producto publicado **con** stock e imagen, uno publicado **sin stock**, uno publicado **sin imagen** y uno **archivado**; devuelve sus identificadores; re-ejecutar no colisiona (prefijo por-run).
  - **Verify**: `pnpm --filter @dsm/qa exec tsx support/seed-ficha.smoke.ts` (siembra los cuatro estados y los reporta sin error)

## Fase 2: E2E de la costura SSR/SEO (Playwright)

- [ ] T2.1 Asertar SSR real sobre el HTML sin JavaScript (AC-2)
  - **Exit criterion**: TC-302 verde — con JS **deshabilitado** en el contexto, el HTML servido ya contiene nombre y precio del producto. Un test que pasara con la página hidratada no vale: la aserción corre sobre el HTML crudo.
  - **Verify**: `pnpm --filter @dsm/qa test:e2e -- --grep "TC-302"`
- [ ] T2.2 Asertar JSON-LD y metadatos propios de la ficha (AC-2)
  - **Exit criterion**: TC-303 verde — el `<script type="application/ld+json">` parsea, es `@type: Product`, y su precio y disponibilidad coinciden con los que devuelve la API; `title` y `meta description` son propios del producto, no genéricos del sitio.
  - **Verify**: `pnpm --filter @dsm/qa test:e2e -- --grep "TC-303"`
- [ ] T2.3 Ficha completa y 404 sin fuga de contenido (AC-1, AC-7, AC-8)
  - **Exit criterion**: TC-301 verde (nombre, precio ARS, categoría, disponibilidad) y TC-304 verde — draft, archivado e inexistente devuelven 404 y el HTML **no** contiene el nombre del producto ni se ofrece como indexable.
  - **Verify**: `pnpm --filter @dsm/qa test:e2e -- --grep "TC-301|TC-304"`
- [ ] T2.4 Precio vigente cruzando panel → ficha (AC-9)
  - **Exit criterion**: TC-305 verde — lee el precio en la ficha, lo cambia vía API admin (fixture de auth de US-001), espera la ventana de caché declarada por el backend, relee y asierta el precio nuevo. No asierta "inmediatamente": eso no probaría nada contra `max-age=60`.
  - **Verify**: `pnpm --filter @dsm/qa test:e2e -- --grep "TC-305"`
- [ ] T2.5 LCP bajo el presupuesto del NFR
  - **Exit criterion**: TC-306 verde — LCP medido en la ficha **< 2.5 s**; el umbral sale del NFR de la US, no hardcodeado en el spec.
  - **Verify**: `pnpm --filter @dsm/qa test:e2e -- --grep "TC-306"`

## Fase 3: Aceptación BDD (Cucumber + Playwright)

- [ ] T3.1 Features de happy path y corner (AC-1, AC-3, AC-4, AC-6)
  - **Exit criterion**: TC-310..TC-313 verdes contra el stack real; runner en modo `strict` (sin steps pending). C-1 asierta que con stock cero **no** se ofrece agregar al carrito y **sí** el canal de contacto.
  - **Verify**: `pnpm --filter @dsm/qa exec env NODE_OPTIONS="--import tsx" cucumber-js --config acceptance/cucumber.mjs --tags "@happy or @corner"`
- [ ] T3.2 Features negative + el diferido de AC-5
  - **Exit criterion**: TC-314 verde — draft e inexistente son **indistinguibles** para el visitante (mismo status y mismo cuerpo). TC-315 (X-1, descripción enriquecida) presente y excluido por `@deferred`.
  - **Verify**: `pnpm --filter @dsm/qa exec env NODE_OPTIONS="--import tsx" cucumber-js --config acceptance/cucumber.mjs --tags "@negative and not @deferred"`

## Fase 4: Accesibilidad

- [ ] T4.1 axe-core sobre las dos variantes de la ficha
  - **Exit criterion**: TC-320 verde con **0 violaciones nivel AA** en la ficha con imagen y en la ficha con placeholder; la segunda verifica que el placeholder lleva `alt` descriptivo (requisito del AC-6).
  - **Verify**: `pnpm --filter @dsm/qa test:a11y`

## Fase 5: Carga

- [ ] T5.1 Escenario k6 de la ficha pública
  - **Exit criterion**: TC-330 verde — `qa/performance/storefront-product.js` contra `GET /v1/products/{sku}` con el dataset de `seed:load`; budget `p95 < 300ms` tomado de `thresholds.js` bajo el tag `endpoint:storefront_product` (fuente única, no duplicado en el spec); `setup()` **sin** login, porque la superficie es anónima.
  - **Verify**: `pnpm --filter @dsm/qa seed:load && k6 run --vus 2 --duration 30s qa/performance/storefront-product.js`

## Fase 6: Exploratorio

- [ ] T6.1 Charters de SEO/compartir y de caché bajo CDN
  - **Exit criterion**: TC-340 y TC-341 documentados en `qa/exploratory/charters.md` con misión, áreas, riesgos y heurísticas; ambos marcados `execution_mode: manual` con la justificación de por qué automatizarlos daría falsa confianza.
  - **Verify**: `grep -q "TC-340" qa/exploratory/charters.md && grep -q "TC-341" qa/exploratory/charters.md`

## Verification (suite-level)

- [ ] Aceptación (excluyendo `@deferred`) verde: `pnpm --filter @dsm/qa test:acceptance`
- [ ] E2E SSR/SEO verde: `pnpm --filter @dsm/qa test:e2e`
- [ ] Accesibilidad 0 violaciones AA: `pnpm --filter @dsm/qa test:a11y`
- [ ] Carga p95 bajo presupuesto: `pnpm --filter @dsm/qa seed:load && k6 run --vus 2 --duration 30s qa/performance/storefront-product.js`
- [ ] Cada AC activo (AC-1 a AC-4, AC-6 a AC-9) tiene ≥1 test-case verde; **AC-5 presente `@deferred`**; la cláusula "URL amigable (slug)" de AC-1 queda **declarada sin cubrir** hasta OQ-BE-1 (ver proposal §Open questions — no es un olvido, es un diferido con dueño).
