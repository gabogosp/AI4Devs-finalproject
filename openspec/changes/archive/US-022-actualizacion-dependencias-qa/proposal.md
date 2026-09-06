# Proposal — US-022 QA: revalidación cross-cutting de suites propias contra las nuevas versiones

> **Ticket**: US-022 — Actualización de dependencias del frontend (vulnerabilidades críticas)
> **Author**: qa-engineer agent (assisted by @Gabriel Suarez)
> **Date**: 2026-09-06
> **Status**: Proposed
> **Affected layers**: ninguna de producción — revalidación de suites QA-owned (`qa/`) ya existentes
> **Affected platform**: qa (Layer 3 cross-stack) contra `apps/web` + `apps/api` ya bumpeados

## Why

El backend/frontend de US-022 (PR #95, mergeado a `main`, commit `7366c1c`,
24/24 tasks) subió `next` 15.1.6 → 15.5.21, `sharp` (nueva, `^0.35.0`, para
optimización de imágenes en producción), `postcss` → 8.5.18, `undici` (override
de raíz, vía `testcontainers` de `apps/api`), y — dev-only de `apps/web` —
`@playwright/test` 1.49.1 → 1.55.1 y `vitest` 2.1.8 → 3.2.6 (integrado tras
spike con blast radius medido). El criterio de éxito de la US entera (§8) es
que **nada cambie salvo los números de versión**.

Esa US ya revalidó, dev-owned, la suite propia de `apps/web`/`apps/api`
(996/996 + 1966/1966 tests, E2E dev-owned de `apps/web` 58/58). Lo que **no**
revalidó — porque no le pertenece (`qa-backend-standards.md`/`qa-frontend-standards.md`
§2.1, ownership matrix) — es la suite **QA-owned** de `qa/`: la que corre
Layer 3 cross-stack, contra el stack real servido (FE construido + API viva),
y que es la única que prueba SSR/SEO, accesibilidad WCAG AA y el circuito de
aceptación BDD end-to-end. Ésa es exactamente la superficie que la US-022 pide
en su §7 ("QA: revalidar las suites propias —E2E de SSR/SEO, a11y,
aceptación— contra las versiones nuevas y confirmar que la cobertura no
bajó") y la única disciplina que falta para que US-022 llegue a `Done`.

Tres hechos concretos gobiernan el alcance de este change:

1. **`qa/package.json` declara su propia copia de `@playwright/test` en
   `1.49.1`**, sin bumpear — explícitamente fuera de alcance del change de FE
   ("Bump de `@playwright/test` dentro de `qa/package.json` — es devDependency
   propia de la disciplina QA"). Esto significa que hoy `qa/e2e/*` y
   `qa/e2e/*a11y*` corren con un Chromium más viejo que el que ya usa
   `apps/web` — una asimetría de versión que hay que evaluar, no aplicar a
   ciegas (ver Open questions).
2. **`qa/e2e/pdp-ssr-seo.spec.ts` (TC-305) tiene el mismo patrón de carrera**
   que `apps/web/e2e/pdp-invalidation.spec.ts` documentó y diagnosticó en
   detalle durante el change de FE (fetch fire-and-forget de invalidación vs.
   `expect.poll`) — con un timeout más angosto (10s, sin backoff explícito) que
   el que `apps/web` terminó necesitando (20s, con `intervals` crecientes) para
   estabilizarse al 100% en modo paralelo. Es un hallazgo de flakiness
   preexistente en la suite QA-owned, no introducido por esta US, que hay que
   documentar (ver Open questions), no arreglar en este plan.
3. **El gate nightly de `qa.yml` (`qa-cross-stack`) está roto desde antes de
   esta US** — falla en el paso "Aceptación BDD (Cucumber)" en TODAS las
   corridas verificadas (2026-08-30 → 2026-09-06, antes y después del merge de
   FE), porque ese workflow arranca la API a mano (`node
   apps/api/dist/.../main.js`) en vez de usar `qa/scripts/api-up.sh`, y por lo
   tanto no exporta `CORS_ALLOWED_ORIGINS` — el preflight del carrito falla con
   404 en el segundo request. Los pasos "Build + arranque del front", "E2E
   cross-stack (Playwright)" y "Accesibilidad (axe-core)" quedan sin correr
   (`skipped`) desde entonces: **el propio gate de CI que debería demostrar
   "sin regresión" no corre desde antes de esta US**, así que la revalidación
   de este change tiene que hacerse **localmente**, con el mismo mecanismo que
   ya usa `qa/scripts/api-up.sh` (que sí exporta `CORS_ALLOWED_ORIGINS`
   correctamente) — no delegando en un CI que hoy no llega a ejecutar ninguna
   de las tres suites que esta US pide revalidar.

## What changes

Revalidación (no funcionalidad nueva) de las suites QA-owned de `qa/` contra
el stack ya bumpeado por el change de FE (mergeado):

- **Aceptación BDD** (`pnpm --filter @dsm/qa test:acceptance`): 14 features,
  136 escenarios (`Escenario`/`Esquema del escenario` en español).
- **E2E cross-stack SSR/SEO y funcional** (`pnpm --filter @dsm/qa test:e2e`):
  16 specs, 68 tests (excluye los de a11y por `testMatch`).
- **Accesibilidad WCAG AA** (`pnpm --filter @dsm/qa test:a11y`, axe-core): 9
  specs, 38 tests.
- **Comparación explícita de conteos** contra el baseline (el propio conteo
  actual, porque `qa/` no se tocó durante el change de FE — el baseline y el
  "después" son la misma suite corrida contra dos stacks distintos: antes y
  después del bump).
- **Evaluación** (no aplicación) del bump de `@playwright/test` propio de
  `qa/package.json` — decisión diferida al usuario, ver Open questions.
- **Documentación** del hallazgo de flakiness en TC-305 y del gate roto de
  `qa.yml` — ninguno de los dos se corrige en este change.

No se agregan escenarios nuevos de funcionalidad: el "caso de prueba" de este
change es, en cada capa, "correr la suite existente contra las versiones
nuevas y confirmar que el conteo de escenarios/specs que pasan no bajó" — ver
`qa-plan.md` §7 para por qué el formato difiere del Gherkin happy/corner/negative
tradicional.

## Out of scope

- **Bump de `@playwright/test` dentro de `qa/package.json`** — evaluado en
  este plan (ver `design.md` §D-QA1 y Open questions) pero **no aplicado**:
  requiere medir blast radius primero (mismo criterio de prudencia que el
  change de FE ya aplicó a sus propios bumps de major/minor).
- **Arreglar la carrera de fondo de TC-305** (`qa/e2e/pdp-ssr-seo.spec.ts`) ni
  la de `apps/web/e2e/pdp-invalidation.spec.ts` — ambas quedan documentadas
  como hallazgo, no como tarea de este change (mismo criterio que el change de
  FE ya aplicó al dejar su propia carrera como "hallazgo separado, fuera de
  alcance de una US de actualización de dependencias").
- **Arreglar el gate roto de `qa.yml`** (CORS ausente por no usar
  `qa/scripts/api-up.sh`) — es un defecto de pipeline preexistente, no
  introducido por esta US ni por el change de FE; corregirlo es un cambio de
  CI, y "endurecer la CI" está explícitamente fuera de alcance de US-022 (es
  US-019, per la propia US §4).
- **Escribir tests nuevos de funcionalidad** — esta US es explícita en que
  "nada cambia salvo los números de versión" (US §8); no hay superficie nueva
  que cubrir.
- **Contract testing (`test:contract`) y carga (`test:load`)** — ambos golpean
  `QA_API_BASE_URL` directamente (la API), nunca el front servido; no están en
  la ruta de ninguno de los paquetes bumpeados por el change de FE (`next`,
  `sharp`, `postcss`, `@playwright/test` de `apps/web`). Se confirma esta
  exclusión en `design.md` §D-QA2, no se asume en silencio.
- **Funcional (`test:functional`, Newman)** — corre contra la API, no contra
  el front; el `handlebars`/`newman` que sí se tocó en el change de FE (T5.1)
  es una transitiva de `postman-runtime`, y ese override ya se revalidó ahí
  mismo (`pnpm --filter @dsm/qa test:functional` en el `tasks.md` de FE).

## Standards consultados

- `docs/base-standards.md` — vocabulario prescriptivo.
- `docs/quality/testing-standards.md` §2 (pirámide), §8 (coverage policy —
  "coverage no bajó" es el criterio de éxito explícito de este change), §9.1
  (zero tolerance para flakiness — gobierna cómo se documenta el hallazgo de
  TC-305, nunca silenciándolo), §18 (anti-patterns).
- `docs/quality/qa-frontend-standards.md` §2.1 (ownership matrix — por qué
  este plan no re-autora nada dev-owned), §12 (regression suite — el
  mecanismo de este change ES la suite de regresión ya existente, corrida de
  nuevo), §19 (accesibilidad — baseline WCAG AA), §23.4 (E2E con Playwright),
  §24 (BDD y Gherkin — Cucumber + Playwright).
- Skill `qa-three-layer-regression` — este change es explícitamente Layer 3
  (cross-stack), la capa que el propio skill asigna al change QA hermano.
- Skill `playwright-stability` — el hallazgo de TC-305 se documenta con el
  vocabulario de esa skill (auto-waiting vs. `expect.poll` contra un efecto
  fire-and-forget).
- Skill `flakiness-detection` — señal 1 (espera sin condición observable) no
  aplica acá (el `expect.poll` sí tiene condición observable), pero el
  criterio de "prevalencia + capa + costo de falla" de esa skill es el que
  clasifica el hallazgo de TC-305 como Major, no Minor (toca el único test que
  cubre AC-9/TC-305 de una capacidad ya en producción).

## Preguntas abiertas / hallazgos

**[Deferred — owner: usuario, motivo: bump de `@playwright/test` en
`qa/package.json` (1.49.1 → 1.55.1, para consistencia con la copia que ya usa
`apps/web`). No se aplica en este plan: el propio change de FE (T4.1) midió
que ese mismo bump, con el Chromium más nuevo, angostó una carrera preexistente
en `apps/web/e2e/pdp-invalidation.spec.ts` (de ~33% de flakiness documentada a
reproducible 100% en modo serie; 2/5 en paralelo, dentro del perfil de riesgo
ya aceptado). `qa/e2e/pdp-ssr-seo.spec.ts` TC-305 tiene el mismo patrón
estructural (fire-and-forget + `expect.poll`) con un timeout más angosto (10s
vs. los 20s que `apps/web` necesitó) y sin los `intervals` de backoff que
`apps/web` agregó — bumpear el Chromium de `qa/` sin medir antes podría
angostar esa misma carrera en Layer 3, exactamente el mismo modo de falla,
sin que nadie lo haya diagnosticado ahí todavía. La decisión (bumpear
igualando el diagnóstico ya hecho, diferir indefinidamente, o medir con un
spike aislado como hizo T4.2 de FE para `vitest`) queda para quien retome
`/develop-qa` de este change, con el dato del spike en mano — no una
suposición. Ver `design.md` §D-QA1 y `qa-plan.md` §6.]**

**[Deferred — owner: usuario, motivo: `qa/e2e/pdp-ssr-seo.spec.ts` TC-305 (la
ficha pública se refresca tras editar el precio en el panel) corre la misma
carrera que el change de FE ya diagnosticó a fondo en
`apps/web/e2e/pdp-invalidation.spec.ts` — un fetch fire-and-forget de
invalidación (`revalidateProductSafely`) contra un `expect.poll` que reintenta
la navegación. Hoy TC-305 usa `timeout: 10_000` sin `intervals` explícitos
(default de Playwright); `apps/web` necesitó ensanchar a `timeout: 20_000` con
`intervals` crecientes para estabilizarse al 100% en paralelo con
`@playwright/test@1.55.1`. Mientras `qa/` siga en `@playwright/test@1.49.1`
(Chromium más viejo, más lento de arrancar/navegar — la causa que angostó la
ventana en `apps/web`), es plausible que TC-305 no muestre el problema todavía
— pero es exactamente el mismo mecanismo, y un bump futuro de la copia de
`qa/` (ítem anterior) lo expondría. No se arregla en este change (no se toca
código de `qa/` sin evaluar blast radius primero, mismo criterio que el
change de FE aplicó a cada uno de sus overrides). Queda registrado para que
quien ejecute la revalidación de este plan (`/develop-qa`) lo tenga en cuenta
si T-QA2 (ver `tasks.md`) muestra alguna falla intermitente en TC-305, y para
que si se decide bumpear `@playwright/test` de `qa/` (ítem anterior), se
ensanche el timeout de TC-305 en el mismo cambio, no después de que falle en
CI. Ver `design.md` §D-QA1.]**

**[Deferred — owner: usuario, motivo: el gate nightly `qa-cross-stack`
(`.github/workflows/qa.yml`) falla en el paso "Aceptación BDD (Cucumber)" en
TODAS las corridas verificadas desde 2026-08-30 (antes del merge de US-022) —
la API se arranca a mano (`node apps/api/dist/.../main.js`) en vez de con
`qa/scripts/api-up.sh`, así que no exporta `CORS_ALLOWED_ORIGINS` y el
preflight del carrito falla con 404. Los pasos "Build + arranque del front",
"E2E cross-stack (Playwright)" y "Accesibilidad (axe-core)" —las tres suites
que esta US pide revalidar— quedan `skipped` desde entonces: el propio gate
de CI que debería demostrar "sin regresión" no ejecuta ninguna de las tres
desde antes de esta US. Es un defecto de pipeline preexistente, no introducido
por el bump de dependencias, y arreglarlo es tocar `.github/workflows/qa.yml`
— fuera de alcance tanto de este change como del de FE ("endurecer la CI... es
US-019", per `proposal.md` del change de FE §Out of scope). Este plan
revalida **localmente**, vía `qa/scripts/api-up.sh` (que sí exporta
`CORS_ALLOWED_ORIGINS` correctamente), sin depender de que el nightly corra.
Se deja constancia acá porque bloquea la única confirmación automática e
independiente de "no hay regresión" que el proyecto tiene — quien lo retome
puede decidir si corregir `qa.yml` es un follow-up de US-019 o un fix
aislado. Ver `design.md` §D-QA3.]**

**[Deferred — owner: usuario, motivo: `qa/e2e/carrito.spec.ts` TC-731 (navegación
por teclado + anuncio del total en región viva) **falla de forma real y
reproducible** — 3/3 en T-QA2 (`next` 15.5.21) y 3/3 adicionales en un bisect
posterior contra `next` 15.1.6 (pre-bump, mismo stack, mismo commit del
componente): el test tabula hasta el botón "sumar una unidad" con un loop
acotado por `document.activeElement` (no un presupuesto de `Tab` fijo) y
nunca lo alcanza dentro de 40 `Tab` — **idéntico en ambas versiones de
`next`**. **Diagnóstico (2026-09-06, post-escalación del coordinador)**:
el bump de `next` 15.1.6 → 15.5.21 queda **descartado como causa** — la falla
es un bug de accesibilidad/orden de foco preexistente en el carrito, ajeno a
esta US, y NO una regresión de este bump. Reclasificado al mismo bucket que
los otros 3 hallazgos de esta revalidación (preexistente, no bloquea el
`/commit` de este change QA). Dado que toca navegación por teclado en un
flujo MVP-crítico (carrito), amerita su propio bug/CR independiente de
US-022 — no se investigó la causa raíz del bug en sí (guardrail: no
auto-arreglar `apps/web` sin revisión), sólo se descartó al bump como
causante. Reproducir (con stack propio, cualquier versión de `next`):
`pnpm --filter @dsm/qa exec playwright test carrito.spec.ts -g "TC-731"`. Ver
`tasks.md` T-QA2.]**

Sin más preguntas abiertas fuera de estas cuatro.

## Referencias

- User Story: `docs/user-stories/US-022-actualizacion-dependencias-frontend.md`
- Change de FE (mergeado, PR #95, pendiente de su propio `/archive-change`):
  [`US-022-actualizacion-dependencias-frontend-web`](../US-022-actualizacion-dependencias-frontend-web/proposal.md)
  — `proposal.md`, `design.md`, `tasks.md` (24/24 tasks)
- Precedente estructural directo (Mode A, variante sibling — backend/FE ya
  archivado o mergeado, change QA hermano cubre lo QA-owned): [`US-010-orden-webhook-stock-qa`](../archive/US-010-orden-webhook-stock-qa/proposal.md),
  [`US-015-historial-compras-qa`](../archive/US-015-historial-compras-qa/proposal.md)
- Workflow de CI cross-stack (con el defecto documentado arriba):
  `.github/workflows/qa.yml`
- Hallazgo de flakiness ya diagnosticado por el change de FE (mismo mecanismo
  que TC-305): `apps/web/e2e/pdp-invalidation.spec.ts`,
  `openspec/changes/US-022-actualizacion-dependencias-frontend-web/proposal.md`
  §Open questions (tercera entrada)
- Suites QA-owned revalidadas por este plan: `qa/acceptance/features/*.feature`,
  `qa/e2e/*.spec.ts` (excepto `*a11y*`), `qa/e2e/*a11y*.spec.ts`
