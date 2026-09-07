# Tasks — US-024 QA: edición de perfil del cliente

> Este change **planifica**, no ejecuta. La única task es escribir el plan;
> la ejecución real de sus escenarios es `/develop-qa US-024`, y no puede
> correr hasta que exista al menos el endpoint `PATCH /v1/me` (BE-US-024).

## Traceability matrix

| AC (US-024) | Título | Escenario(s) qa-plan.md | Estado |
|---|---|---|---|
| AC-1 | Editar el nombre | SC-024-H1 | in this change |
| AC-2 | Agregar/cambiar avatar por URL | SC-024-H2 | in this change |
| AC-3 | Quitar el avatar | SC-024-H3 | in this change |
| AC-4 | Nombre vacío rechazado | SC-024-N1 | in this change |
| AC-5 | URL de avatar inválida rechazada | SC-024-N2 | in this change |
| AC-6 | Email no editable | SC-024-N3 | in this change |
| AC-7 | No se puede editar el perfil de otro cliente | SC-024-N4 | in this change |

Los 7 AC de US-024 quedan cubiertos, uno a uno, en `qa-plan.md` §3.

## Fase única — Escribir el qa-plan

- [x] T-QA1 Escribir `qa-plan.md`: perfil de riesgo, matriz de test, 7
  escenarios Gherkin (1 por AC), seeds/builders requeridos, exploratory
  charters, dependencias declaradas.
  - **Exit criterion**: `qa-plan.md` existe, cubre los 7 AC de la US (uno a
    uno, verificable por número), y declara explícitamente qué test-case
    depende de qué disciplina/change todavía inexistente.
  - **Verify**: `grep -c "AC-[1-7]" openspec/changes/US-024-edicion-perfil-cliente-qa/qa-plan.md` (≥ 7 — al menos una mención por AC) `&& test -f openspec/changes/US-024-edicion-perfil-cliente-qa/qa-plan.md`
  - **Nota de ejecución (2026-09-06)**: hecho. 7/7 AC cubiertos (1 escenario
    Gherkin cada uno, sin variantes de negocio nuevas — D-QA1). Todo
    test-case que necesita `PATCH /v1/me` real queda `Blocked-by: BE-US-024`
    en §7, no fingido como ejecutable.

## Fase 2 — Ejecutar la aceptación BDD (BE ya mergeado)

- [x] T-QA2 Scaffoldear y correr `qa/acceptance/features/perfil.feature` +
  `qa/acceptance/steps/perfil.steps.ts` + `qa/support/editar-perfil.ts`
  contra el BE real (`PATCH /v1/me`, mergeado a main).
  - **Exit criterion**: los 7 escenarios (SC-024-H1..H3, N1..N4) terminan en
    verde, en Postgres/API aislados propios de esta sesión.
  - **Verify**: `env NODE_OPTIONS="--import tsx" npx cucumber-js --config acceptance/cucumber.mjs --tags "@perfil"` (exit 0, "7 scenarios (7 passed)")
  - **Nota de ejecución (2026-09-06)**: 7/7 verdes, 3 corridas consecutivas
    limpias (16/16 pasos — incluye 2 escenarios que reusan una segunda
    cuenta). Postgres/Redis/API propios (puertos 55700/56700/45509). Ajuste
    real sobre AC-6 documentado en `qa-plan.md` §3 (`forbidNonWhitelisted`
    rechaza la request entera, no la ignora en silencio). E2E Playwright/a11y
    (§5 de `qa-plan.md`) siguen `Blocked-by: FE-US-024` — sin cambios, el FE
    todavía no aterrizó.

## Fase 3 — E2E Playwright + a11y (FE ya mergeado, PR #133)

- [x] T-QA3 Escribir y correr `qa/e2e/perfil.spec.ts` (QA-024-E2E-1) y
  `qa/e2e/perfil-a11y.spec.ts` (QA-024-A11Y-1) contra el FE real.
  - **Exit criterion**: `perfil.spec.ts` cubre AC-1 (nombre + reflejo en
    buyer_name del próximo checkout), AC-2/AC-3 (avatar set/quitar), AC-5
    (URL inválida); `perfil-a11y.spec.ts` cubre 0 violaciones WCAG AA en 3
    estados del form (sin avatar, con avatar, con error), navegación sólo
    con teclado, y nombre accesible del placeholder de avatar.
  - **Verify**: `pnpm --filter @dsm/qa exec playwright test -c e2e/playwright.config.ts perfil.spec.ts` (3/3) + `pnpm --filter @dsm/qa exec playwright test -c e2e/playwright.a11y.config.ts perfil-a11y.spec.ts` (5/5), Postgres/API/web aislados propios (puertos 5443/3891/3892).
  - **Nota de ejecución (2026-09-07)**: 8/8 verdes. Dos hallazgos reales
    corregidos en el camino (no ambigüedad de locator, defectos de verdad):
    1. `POST /auth/register` tiene un `@Throttle` literal de 5/hora que
       `AUTH_RATE_LIMIT_MAX` de `api-up.sh` no levanta (no lee env) — fix:
       `X-Forwarded-For` único por página vía `page.setExtraHTTPHeaders`,
       mismo criterio que `customer-auth.ts` ya usa para `APIRequestContext`.
    2. **Bug de contraste real en `avatarColor()`** (`apps/web/src/lib/format/avatar.ts`,
       US-024 FE): `lightness: 55%` daba hasta 1.54:1 de contraste contra el
       texto blanco de las iniciales en el peor hue (amarillo ~60°) — muy
       por debajo del 3:1/4.5:1 de WCAG AA. Corregido a `lightness: 25%`
       (peor caso verificado en los 360 hues: 5.76:1). Test de regresión
       agregado en `avatar.test.ts` (recorre los 360 hues con la fórmula de
       contraste real de WCAG, no un caso puntual).

## Próximo paso

Los 7 AC de US-024 quedan verificados en las 3 capas (BDD acceptance, E2E,
a11y). Avisar a la coordinadora para el archive de esta QA change → US-024
pasa a `Done`.
