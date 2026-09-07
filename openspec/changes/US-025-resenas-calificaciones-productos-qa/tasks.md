# Tasks — US-025 QA: reseñas y calificaciones de productos

> Nació como planificación pura (Modo B, antes de BE/FE) y se ejecutó en 3
> fases a medida que BE/FE aterrizaron: T-QA1 (escribir el plan), T-QA2
> (aceptación BDD, 9/9), T-QA3 (E2E Playwright, 4/4 — incluye un defecto
> real de backend encontrado y corregido en el camino).

## Traceability matrix

| AC (US-025) | Título | Escenario(s) qa-plan.md | Estado |
|---|---|---|---|
| AC-1 | Dejar reseña (comprador, orden delivered) | SC-025-H1 | in this change |
| AC-2 | Calificar sin comentario | SC-025-H2 | in this change |
| AC-3 | Ver promedio y conteo | SC-025-H3 | in this change |
| AC-4 | Producto sin reseñas | SC-025-H4 | in this change |
| AC-5 | Editar la propia reseña | SC-025-H5 | in this change |
| AC-6 | No comprado → no puede reseñar | SC-025-N1 | in this change |
| AC-7 | Invitado no puede reseñar | SC-025-N2 | in this change |
| AC-8 | El dueño oculta una reseña | SC-025-H6 | in this change |
| AC-9 | Calificación fuera de rango rechazada | SC-025-N3 | in this change |

Los 9 AC de US-025 quedan cubiertos, uno a uno, en `qa-plan.md` §3.

## Fase única — Escribir el qa-plan

- [x] T-QA1 Escribir `qa-plan.md`: perfil de riesgo, matriz de test, 9
  escenarios Gherkin (1 por AC), seeds/builders requeridos (reusando
  `crearOrdenEnEstado`), exploratory charters, dependencias declaradas.
  - **Exit criterion**: `qa-plan.md` existe, cubre los 9 AC de la US (uno a
    uno, verificable por número), y declara explícitamente qué test-case
    depende de qué disciplina/change todavía inexistente.
  - **Verify**: `grep -c "AC-[1-9]" openspec/changes/US-025-resenas-calificaciones-productos-qa/qa-plan.md` (≥ 9) `&& test -f openspec/changes/US-025-resenas-calificaciones-productos-qa/qa-plan.md`
  - **Nota de ejecución (2026-09-06)**: hecho. 9/9 AC cubiertos. Elegibilidad
    (AC-1/AC-6) se prueba con el seed real `crearOrdenEnEstado(...,
    'delivered')` que ya existe en `qa/support/seed-ordenes.ts` — no hizo
    falta un seed nuevo. Todo test-case que necesita el endpoint de reseñas
    real queda `Blocked-by: BE-US-025` en §7/§8.
  - **Corrección posterior (T-QA2)**: `crearOrdenEnEstado` resultó ser
    SIEMPRE de invitado (`checkoutReal` usa `nuevoInvitado()`, `customer_id`
    queda `null`) — no sirve para elegibilidad de reseñas, que exige una
    orden ligada a un cliente logueado. Se construyó `compraEntregada`
    (`qa/support/seed-resenas.ts`) en su lugar, ver T-QA2.

## Fase 2 — Ejecutar la aceptación BDD (BE ya mergeado)

- [x] T-QA2 Scaffoldear y correr `qa/acceptance/features/resenas.feature` +
  `qa/acceptance/steps/resenas.steps.ts` + `qa/support/resenas.ts` +
  `qa/support/seed-resenas.ts` contra el BE real (endpoints de reviews,
  mergeados a main).
  - **Exit criterion**: 9 escenarios (SC-025-H1..H6, N1..N3) terminan en
    verde, en Postgres/API aislados propios de esta sesión. AC-8 (moderación)
    verificado sólo a nivel API — el escenario de UI (panel admin) queda
    para cuando el FE de moderación aterrice, per acuerdo con la
    coordinadora (2026-09-06).
  - **Verify**: `env NODE_OPTIONS="--import tsx" npx cucumber-js --config acceptance/cucumber.mjs --tags "@resenas"` (exit 0, "9 scenarios (9 passed)")
  - **Nota de ejecución (2026-09-06)**: 9/9 verdes, 3 corridas consecutivas
    limpias. Descubrimiento real durante la ejecución: `crearOrdenEnEstado`
    (asumido en el plan original) es SIEMPRE de invitado — se construyó
    `compraEntregada` (checkout logueado real vía `compraLogueadaConSesion`
    + `simulate-payment` + los mismos `PATCH` admin de avance de estado que
    `crearOrdenEnEstado` usa) para tener una orden con `customer_id` real.
    Requiere `PAYMENTS_SIMULATED_ENABLED=true` en el entorno de QA (apagado
    por defecto, obligatorio en prod) — documentado para la próxima corrida.
    Postgres/Redis/API propios (puertos 55700/56700/45509).

## Fase 3 — E2E Playwright (FE ya mergeado)

- [x] T-QA3 Scaffoldear y correr `qa/e2e/resenas.spec.ts` (navegador real,
  sin stubs, mismo patrón que `cuenta-compras-cross-stack.spec.ts`) contra
  el FE+BE reales: QA-025-E2E-1 (dejar/editar reseña, ver promedio), E2E-2a/b
  (sin control si no elegible — logueado sin compra, e invitado), y E2E-3
  (moderación por UI, agregado tras el cierre de US-022/TC-731).
  - **Exit criterion**: los 4 escenarios terminan en verde, en stack aislado
    propio (Postgres/Redis/API/web), navegador real de punta a punta.
  - **Verify**: `env QA_API_BASE_URL=... QA_WEB_BASE_URL=... npx playwright test resenas.spec.ts --config=e2e/playwright.config.ts --reporter=list` (exit 0, "4 passed")
  - **Nota de ejecución (2026-09-07)**: primera corrida — 2/4 verdes
    (E2E-2a/2b), 2 rojos (E2E-1, E2E-3 moderación) por un **defecto real de
    backend**: `StorefrontCacheInterceptor` (US-002/US-003 AC-9, pensado
    para el precio) está aplicado a nivel de CLASE en `StorefrontController`
    — `GET /products/:slug/reviews` heredaba el mismo `Cache-Control:
    public, max-age=60, stale-while-revalidate=30`. Confirmado con logs de
    red: el navegador servía la respuesta cacheada (mismo `{average:0,
    count:0}`) incluso después de un PUT/PATCH exitoso — `loadPublic()` del
    FE disparaba el refetch pero nunca llegaba a la red. No se debilitó el
    assert; se reportó tal cual (root cause + evidencia) y se asignó a otra
    sesión (BE). **Fix real (PR #139)**: `@StorefrontCache({maxAge:0,
    swr:0})` sólo en la ruta de reviews, precio/stock intactos. Tras el fix:
    **4/4 verdes, 3 corridas limpias en proceso fresco** (una corrida
    repetida en el MISMO proceso largo mostró fallas intermitentes de
    registro — ver nota de riesgo abajo, no bloqueante). Un ajuste de test
    (no de producto): `getByText('Anduvo bien...')` matcheaba también el
    `<textarea>` con el mismo valor tipeado (violación de "strict mode" de
    Playwright) — se acotó a `page.locator('li', {hasText: ...})`.

## Nota de riesgo (no bloqueante, no investigado a fondo)

Al re-correr la suite VARIAS veces seguidas contra el MISMO proceso de API
ya arrancado (sin reiniciarlo), el registro de cuenta (`POST /v1/auth/register`
vía UI) empezó a fallar intermitentemente (el redirect a `/mi-cuenta` nunca
llegaba) — sin ningún error visible en el log de la API. 3 corridas en
proceso FRESCO (reinicio completo, patrón realista de CI) fueron limpias
las 3. Podría ser contención de recursos de esta máquina (mismo mecanismo
que el hallazgo de baja confianza de `e2e-auth-csrf.spec.ts` en la
verificación de `main`, PR #135) o un throttler acumulando estado entre
corridas repetidas del mismo proceso — no se investigó cuál. Documentado
para que quede en el radar, no bloquea el cierre de esta task.

## Próximo paso

`/commit` de este change — 3/3 fases cerradas (T-QA1 planificación, T-QA2
aceptación BDD, T-QA3 E2E). a11y (`qa-plan.md` QA-025-A11Y-1) queda fuera
de esta iteración — no fue pedida por la coordinadora, se puede retomar
como follow-up si se prioriza.
