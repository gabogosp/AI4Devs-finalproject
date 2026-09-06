# Design — US-022 QA: revalidación cross-cutting

## Context

Este change no construye ninguna capacidad nueva: revalida capas QA-owned ya
existentes (`qa/acceptance`, `qa/e2e`, `qa/e2e/*a11y*`) contra un stack cuyo
único cambio, por diseño de la US (§8), es "los números de versión". Por eso
ninguna decisión de este `design.md` dispara ADR — no hay arquitectura nueva,
sólo la ejecución de un mecanismo de verificación ya existente contra un
target distinto.

Tres hallazgos concretos, todos verificados durante la fase de exploración de
este plan (no supuestos), gobiernan el diseño:

## D-QA1 — El bump de `@playwright/test` propio de `qa/` no se decide en este plan

`qa/package.json` fija `@playwright/test` en `1.49.1`. El change de FE
(`US-022-actualizacion-dependencias-frontend-web`) bumpeó la copia de
`apps/web` a `1.55.1` y documentó, con un diagnóstico exhaustivo (bisect con
`next` revertido, medición en serie vs. paralelo, descarte de caché HTTP), que
ese bump por sí solo **angostó una carrera preexistente** en
`apps/web/e2e/pdp-invalidation.spec.ts`: de ~33% de flakiness histórica a
reproducible 100% en modo serie (el modo serie nunca fue válido para ese spec,
así que ese 100% no es comparable al perfil de riesgo real de CI, que corre en
paralelo con `retries: 2` — ahí se midió 2/5, coherente con el 33% histórico).
La causa raíz que el propio change de FE identificó: un Chromium más nuevo
(el que trae `@playwright/test@1.55.1`) tiene latencia de arranque/navegación
marginalmente distinta, lo suficiente para angostar una ventana de carrera ya
existente entre un fetch fire-and-forget de invalidación de caché y un
`expect.poll` que reintenta la navegación.

`qa/e2e/pdp-ssr-seo.spec.ts` TC-305 tiene **el mismo patrón estructural**: edita
el precio desde el panel real (`/admin/productos/{id}`), espera la confirmación
del PATCH vía `page.waitForResponse`, y luego reintenta con `expect.poll` hasta
que la ficha pública muestre el precio nuevo — la invalidación en sí es
fire-and-forget del lado del servidor. La diferencia con `apps/web`: TC-305 usa
`{ timeout: 10_000 }` sin `intervals` explícitos (el default de Playwright),
mientras que `apps/web/e2e/pdp-invalidation.spec.ts` terminó necesitando
`{ timeout: 20_000, intervals: [200, 300, 500, 500, 1000, 1000, 2000, 2000,
2000, 2000] }` para estabilizarse al 100% en paralelo con el Chromium nuevo.

**Opciones consideradas**:

- **Bumpear `qa/package.json` a `@playwright/test@1.55.1` en este mismo
  change, ya que el diagnóstico de FE ya existe** — descartado por ahora:
  el diagnóstico de FE mide la ventana de carrera de `apps/web/e2e/`, que
  siembra contra un stub (`api-stub.mjs`) con datos fijos; `qa/e2e/` corre
  contra el stack real (API real + Postgres real), con latencias de red
  distintas (posiblemente mayores, lo que podría angostar la ventana todavía
  más, o el trust boundary de auth real podría cambiar el timing de forma
  distinta). Aplicar el mismo bump sin medir sería repetir exactamente el
  error que el propio commit `a4ea348` (precedente citado por el change de
  FE) advierte evitar: decidir sin medir.
- **Diferir indefinidamente, dejando la asimetría de versión** — descartado
  como decisión final (aunque es el estado actual): dos copias de
  `@playwright/test` en el mismo monorepo, en versiones distintas, es una
  divergencia de tooling que alguien va a tener que resolver eventualmente
  (aunque sea al bumpear la próxima vez que aparezca un advisory sobre
  `1.49.1`).
- **Elegida para este plan**: registrar la decisión como
  `[Deferred — owner: usuario, ...]` en `proposal.md`, documentando el riesgo
  concreto (el mismo mecanismo de carrera, medido en un contexto adyacente) en
  vez de una suposición genérica ("puede que se rompa algo"). Si se decide
  bumpear, el mismo change debe ensanchar el timeout de TC-305 preventivamente
  (no esperar a que falle en CI), aplicando el aprendizaje que el change de FE
  ya pagó.

**ADR triggered?**: no — es una decisión operativa de versión de tooling de
test, no arquitectura.

## D-QA2 — Contract testing y carga quedan fuera de la revalidación

Verificado en `qa/package.json` y en el propio código de los scripts:

- `qa/contract/*.contract.ts` son scripts `tsx` con `fetch` directo contra
  `QA_API_BASE_URL` (la API) — nunca instancian un browser ni tocan
  `apps/web`.
- `qa/performance/*.js` (k6) leen `__ENV.QA_API_BASE_URL` — ninguno de los
  scripts de carga usa `QA_WEB_BASE_URL` (confirmado por grep sobre
  `performance/*.js`: sólo `auth-login.js`, `cancel-order-write.js`,
  `cart-write.js`, `confirm-payment.js`, `checkout.js`,
  `orders-history-read.js`, `simulate-payment.js` referencian alguna base
  URL, y todos son `QA_API_BASE_URL`).

Ninguno de los paquetes bumpeados por el change de FE (`next`, `sharp`,
`postcss`, `@playwright/test` de `apps/web`, `undici` vía `testcontainers` de
`apps/api`) está en la ruta de ejecución de `test:contract` ni `test:load`.
La única excepción parcial es `undici` — pero esa transitiva entra por
`testcontainers` (devDependency de `apps/api`, usado en sus tests de
integración), no por ningún script de `qa/`; y ese override ya se revalidó en
el propio `tasks.md` de FE (T5.3, `pnpm --filter @dsm/api test:e2e`). No hay
nada que revalidar acá que no se haya revalidado ya.

`test:functional` (Newman) tampoco entra: corre contra la API, y el único
paquete de esa ruta que el change de FE tocó (`handlebars`, vía `newman`) ya
se revalidó ahí mismo (T5.1, `pnpm --filter @dsm/qa test:functional`).

**ADR triggered?**: no — es una constatación de alcance, no una decisión de
arquitectura.

## D-QA3 — El gate roto de `qa.yml` obliga a revalidar localmente, no vía CI

Verificado con `gh run list --workflow=qa.yml` y `gh run view --log-failed`
sobre las corridas `schedule` (nightly) desde 2026-08-30 hasta 2026-09-06 (la
más reciente, ya con el merge de FE incluido): las 8 corridas fallan
idénticamente en el paso "Aceptación BDD (Cucumber)", con el mismo error —
```
Error: [qa/entorno] La API en http://localhost:3000 NO tiene http://localhost:3100
en su allowlist de CORS (el preflight devolvió 404 y allow-origin=ausente)...
```
— porque el paso "Build + arranque de la API" del propio `qa.yml` arranca la
API con `node apps/api/dist/apps/api/src/main.js` directamente, sin pasar por
`qa/scripts/api-up.sh` (que sí exporta `CORS_ALLOWED_ORIGINS=http://localhost:3100`
entre otras variables). Como consecuencia, los pasos "Build + arranque del
front", "E2E cross-stack (Playwright)" y "Accesibilidad (axe-core)" — las
tres suites que esta US pide revalidar — quedan con estado `skipped` en las 8
corridas verificadas.

Esto **no es un efecto del bump de dependencias**: el mismo patrón de falla
aparece en corridas de 2026-08-30, una semana antes de que el change de FE
empezara a tocar código (`git log` confirma que los primeros commits de
`US-022-actualizacion-dependencias-frontend-web` son del 2026-09-06). Es un
defecto de pipeline preexistente, y corregirlo requiere editar
`.github/workflows/qa.yml` — un cambio de CI, fuera de alcance tanto de este
change como del de FE (que dejó "endurecer la CI" explícitamente para
US-019).

**Consecuencia para este plan**: ninguna de las tareas de `tasks.md` depende
de que `qa.yml` corra o pase. Todas las tareas de revalidación levantan el
entorno igual que ya lo hace `qa/scripts/api-up.sh` (que exporta
`CORS_ALLOWED_ORIGINS` correctamente) más `pnpm --filter @dsm/web build &&
pnpm --filter @dsm/web start` con las mismas variables que `qa.yml` ya
declara para ese paso (`NEXT_PUBLIC_API_BASE_URL`, `API_INTERNAL_ORIGIN`,
`PORT=3100`) — el mismo mecanismo que el workflow pretende, ejecutado a mano.

**Opciones consideradas**:

- **Arreglar `qa.yml` como parte de este change** (una línea: reemplazar el
  arranque manual de la API por `qa/scripts/api-up.sh`) — descartado: es un
  cambio de CI, y el propio change de FE ya estableció el precedente de
  dejar "endurecer/tocar el pipeline" fuera de alcance de esta US
  (delegado a US-019). Tentador por lo simple del fix, pero cambiar el criterio
  de alcance a mitad de la US sienta un precedente peor que dejarlo
  documentado.
- **Elegida**: documentar el hallazgo con evidencia (`gh run view --log-failed`)
  en `proposal.md` como `[Deferred — owner: usuario, ...]`, y revalidar
  localmente en `tasks.md` sin depender de este gate.

**ADR triggered?**: no — es un defecto operativo de configuración de CI, no
una decisión de arquitectura.

## Goals

- Confirmar, corriendo cada suite QA-owned de `qa/` contra el stack ya
  bumpeado (mergeado en `main`), que el conteo de escenarios/specs que pasan
  no bajó respecto al conteo actual (el propio `qa/` no cambió durante el
  change de FE, así que el "baseline" es el conteo vigente de cada suite).
- Dejar registrada la decisión pendiente sobre el bump de `@playwright/test`
  propio de `qa/`, con el riesgo concreto medido en un contexto adyacente
  (D-QA1), no una suposición.
- Dejar registrado el hallazgo de flakiness estructural en TC-305 (D-QA1) y
  el gate roto de `qa.yml` (D-QA3), ninguno de los dos corregido en este
  change.

## Non-goals

- No se escribe ningún escenario Gherkin, spec de Playwright ni test nuevo de
  funcionalidad — no hay superficie nueva que cubrir (US §8).
- No se bumpea `@playwright/test` de `qa/package.json` — queda diferido
  (D-QA1).
- No se arregla la carrera de TC-305 ni la de
  `apps/web/e2e/pdp-invalidation.spec.ts` — ambas quedan documentadas, no
  corregidas.
- No se toca `.github/workflows/qa.yml` — el defecto queda documentado
  (D-QA3), no corregido.
- No se revalida `test:contract`, `test:load` ni `test:functional` más allá
  de lo que el propio change de FE ya revalidó — D-QA2 confirma que ninguno
  está en la ruta de los paquetes bumpeados.

## Approach

La revalidación es, en cada capa, el mismo mecanismo de tres pasos:

1. **Levantar el entorno** — `qa/scripts/api-up.sh` (API real + Postgres real,
   con las variables que ya corrige ese script) + `pnpm --filter @dsm/web
   build && pnpm --filter @dsm/web start` (con `NEXT_PUBLIC_API_BASE_URL`,
   `API_INTERNAL_ORIGIN`, `PORT=3100` — las mismas que `qa.yml` ya declara
   para ese paso, per D-QA3).
2. **Correr la suite** — `pnpm --filter @dsm/qa test:acceptance -- --tags "not
   @deferred"`, `pnpm --filter @dsm/qa test:e2e`, `pnpm --filter @dsm/qa
   test:a11y` — sin modificar ningún `.feature`/`.spec.ts` existente.
3. **Comparar el conteo final** contra el conteo vigente documentado en
   `qa-plan.md` §1 (136 escenarios de aceptación, 68 tests de E2E SSR/SEO/
   funcional, 38 tests de a11y) — el criterio de éxito es "igual o mayor,
   nunca menor" (mismo criterio que el `tasks.md` de FE ya aplicó a la suite
   dev-owned, T3.1).

Ninguna task de `tasks.md` modifica código de `qa/` — sólo lo ejecuta y
documenta el resultado (T-QA6 es la única excepción: registra, no aplica, la
decisión sobre el bump de `@playwright/test`).

## Trade-offs

- **Revalidar localmente en vez de esperar a que se arregle `qa.yml`**: más
  trabajo manual por esta vez (levantar el stack a mano), pero es la única
  forma de completar esta US sin bloquearla en un defecto de CI ajeno a su
  alcance (D-QA3).
- **No bumpear `@playwright/test` de `qa/` "ya que se está revisando todo"**:
  deja una asimetría de versión conocida en el monorepo, pero evita repetir
  sin medir un bump que el propio change de FE ya probó que puede angostar
  una carrera real — el costo de diferir es menor que el costo de aplicar a
  ciegas.

## Open questions

Ver `proposal.md` — las tres entradas `[Deferred — owner: usuario, ...]`
(bump de `@playwright/test` de `qa/`, carrera de TC-305, gate roto de
`qa.yml`).

## References

- Ticket: US-022 (`docs/user-stories/US-022-actualizacion-dependencias-frontend.md`)
- Change de FE (mergeado, PR #95): `openspec/changes/US-022-actualizacion-dependencias-frontend-web/{proposal,design,tasks}.md`
- Evidencia de D-QA3: `gh run list --workflow=qa.yml` (8 corridas nightly
  2026-08-30 → 2026-09-06, todas con el mismo fallo), `gh run view
  34021954006 --log-failed`
- Precedente de mismo mecanismo de carrera: `apps/web/e2e/pdp-invalidation.spec.ts`,
  diagnóstico completo en `proposal.md` de FE §Open questions (tercera entrada)
- Standards: `docs/quality/testing-standards.md` §8 (coverage), §9.1
  (flakiness), `docs/quality/qa-frontend-standards.md` §12 (regression
  suite), §19 (accesibilidad), §23.4/§24 (Playwright/BDD)
- Related ADRs: ninguno (ninguna decisión de este change califica)
- Related OpenSpec changes: `US-010-orden-webhook-stock-qa`,
  `US-015-historial-compras-qa` (precedente de formato de change QA hermano)
