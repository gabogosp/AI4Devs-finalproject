# Tasks — US-026 QA: productos destacados en el home

> Este change **planifica**, no ejecuta. La única task es escribir el plan;
> la ejecución real es `/develop-qa US-026`, bloqueada hasta que exista al
> menos los 2 endpoints (BE-US-026).

## Traceability matrix

| AC (US-026) | Título | Escenario(s) qa-plan.md | Estado |
|---|---|---|---|
| AC-1 | Novedades | SC-026-H1 | in this change |
| AC-2 | Más vendidos | SC-026-H2 | in this change |
| AC-3 | Menos de 8 disponibles | SC-026-E1 | in this change |
| AC-4 | Catálogo vacío | SC-026-N1 | in this change |
| AC-5 | Sin ventas todavía | SC-026-N2 | in this change |
| AC-6 | Empate determinista | SC-026-N3 | in this change |
| AC-7 | Producto despublicado no aparece | SC-026-N4 | in this change |
| AC-8 | Sin stock, visible pero marcado | SC-026-N5 | in this change |

Los 8 AC de US-026 quedan cubiertos, uno a uno, en `qa-plan.md` §3.

## Fase única — Escribir el qa-plan

- [x] T-QA1 Escribir `qa-plan.md`: perfil de riesgo, matriz de test, 8
  escenarios Gherkin (1 por AC), test-case de shape público + caché
  per-handler (D-QA2/D-QA3), seeds/builders requeridos, dependencias
  declaradas.
  - **Exit criterion**: `qa-plan.md` existe, cubre los 8 AC de la US (uno a
    uno, verificable por número), y declara explícitamente qué test-case
    depende de qué disciplina/change todavía inexistente.
  - **Verify**: `grep -c "AC-[1-8]" openspec/changes/US-026-productos-destacados-home-qa/qa-plan.md` (≥ 8) `&& test -f openspec/changes/US-026-productos-destacados-home-qa/qa-plan.md`
  - **Nota de ejecución (2026-09-07)**: hecho. 8/8 AC cubiertos. Elegibilidad
    de "más vendidos" (AC-2/AC-5) reusa `crearOrdenEnEstado` de
    `qa/support/seed-ordenes.ts` tal cual (a diferencia de US-025-qa, acá
    NO hace falta una compra logueada — el ranking es agregado global, no
    por cliente). Todo test-case que necesita los 2 endpoints reales queda
    `Blocked-by: BE-US-026/FE-US-026` en §4/§5.

## Fase 2 — Ejecutar la aceptación BDD + contract (BE ya mergeado)

- [x] T-QA2 Scaffoldear y correr `qa/acceptance/features/destacados.feature`
  + `qa/acceptance/steps/destacados.steps.ts` + `qa/support/destacados.ts`
  contra el BE real (`GET /v1/products/novedades` + `.../mas-vendidos`,
  PR #146, mergeado a main).
  - **Exit criterion**: los 8 escenarios de AC (SC-026-*) + los 2 de
    contrato (QA-026-CT-1/CT-2) terminan en verde, en Postgres/API
    aislados propios de esta sesión.
  - **Verify**: `env NODE_OPTIONS="--import tsx" npx cucumber-js --config acceptance/cucumber.mjs --tags "@destacados"` (exit 0, "10 scenarios (10 passed)")
  - **Nota de ejecución (2026-09-07)**: 10/10 verdes, 3 corridas limpias en
    proceso/DB fresca (Postgres/Redis/API propios, puertos
    56100/57100/46209). Corrección real de metodología (no de producto):
    `this.state` de Cucumber se resetea por escenario — la continuidad
    narrativa entre SC-026-N2/E1 usa un acumulador de módulo, no World
    (documentado en `qa-plan.md`). Ambos test-cases de contrato
    (QA-026-CT-1 shape público, QA-026-CT-2 Cache-Control) confirmados
    contra el código real: `StorefrontProductListItemDto` exacto (sin
    id/status/revenue_ars_cents), `Cache-Control: public, max-age=60,
    stale-while-revalidate=30` declarado per-handler en ambas rutas — la
    lección de US-025 (PR #139) se aplicó correctamente en BE-US-026. E2E
    Playwright (§5 de `qa-plan.md`) sigue `Blocked-by: FE-US-026` — sin
    cambios, el FE todavía no aterrizó.

## Fase 3 — Ejecutar el E2E Playwright (FE ya mergeado, PR #149)

- [x] T-QA3 Scaffoldear y correr `qa/e2e/destacados.spec.ts` contra el home
  real construido (`next build && next start`, no dev server), FE de
  `US-026-productos-destacados-home-frontend-web` (PR #149, mergeado a
  main).
  - **Exit criterion**: QA-026-E2E-1 (ambas secciones + link a ficha) y
    QA-026-E2E-2 (catálogo vacío) terminan en verde, en Postgres/API/web
    aislados propios de esta sesión, sobre el build de producción real.
  - **Verify**: `QA_API_BASE_URL=... QA_WEB_BASE_URL=... JWT_SECRET=... DATABASE_URL=... npx playwright test destacados.spec.ts --config=e2e/playwright.config.ts --reporter=list` (exit 0, "2 passed")
  - **Nota de ejecución (2026-09-08)**: 2/2 verdes, 3 corridas limpias en
    proceso/DB fresca (Postgres propio, puerto 56200; API/web propios,
    puertos 46309/46310). Hallazgo real de metodología (no de producto): el
    home (`app/(storefront)/page.tsx`) es ISR (`○ Static`, `revalidate: 60`
    — hereda el `maxAge:60` del BE), no un fetch SSR por request — una
    navegación inmediata tras sembrar puede caer dentro de la ventana
    "fresh" del cache de Next y servir HTML viejo. El spec poll-ea
    re-navegando hasta que la regeneración en background incorpora el dato
    sembrado (detalle en `qa-plan.md` §5). Efecto colateral de entorno
    (no del spec): un `next build` reejecutado sin `rm -rf .next` reusa el
    fetch-cache en disco de una corrida anterior aunque la DB se haya
    vaciado — necesario para una baseline ISR limpia en cada corrida.

## Próximo paso

Los 3 aspectos QA de US-026 (qa-plan, BDD+contract, E2E) están cerrados.
Avisar a la coordinadora — PR de esta fase, luego `/archive-change
US-026-productos-destacados-home-qa` post-merge.
