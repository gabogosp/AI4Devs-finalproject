# Tasks — US-022 actualización de dependencias del frontend

> Per [`AGENTS.md`](../../../AGENTS.md) section 1.1: small tasks, one at a time.
> Per `openspec-workflow` skill: every task carries `Exit criterion:` + `Verify:`, and `Pattern:` where a non-obvious pattern applies.

## Traceability matrix

| AC | Title | Task IDs | Status |
|---|---|---|---|
| AC-1 | Ninguna dependencia de producción con vulnerabilidad critical | T2.1–T2.5, T7.1, T8.1 | in this change |
| AC-2 | `next` en línea 15.x sin critical/high | T2.1, T2.2, T8.1 | in this change |
| AC-3 | El sitio sigue funcionando igual | T2.2, T3.1, T3.2 | in this change |
| AC-4 | Dependencias de dev saneadas | T4.1 (playwright), T4.2 (spike de vitest, decisión posterior según blast radius) | in this change |
| AC-5 | Audit como gate ejecutable | T6.1, T6.2, T6.3, T8.1 | in this change |
| AC-6 | No se actualiza a ciegas | T4.2 (spike de vitest antes de decidir integrar/diferir), cláusula de escalamiento en T5.1–T5.3 | in this change (como restricción de proceso) |
| AC-7 | No se silencia una vulnerabilidad para pasar el gate | T6.1, T6.2 | in this change |

Ninguna AC se difiere completa: **AC-4 y AC-6 tienen una porción explícitamente bloqueada** (el bump de `vitest`) que no se ejecuta en este change hasta que el usuario resuelva la pregunta abierta en `proposal.md`. No se marca "deferred → change de seguimiento" porque la propia US ya prevé esta rama en su AC-6 (negative space) — la resolución queda dentro de este mismo change, simplemente sin ese task cerrado.

## Pre-flight

- [x] T0.1 Confirmar que la rama activa es `feat/US-022-actualizacion-dependencias-frontend-web` (ya existe — este worktree fue creado desde `origin/main` actualizado).
  - **Exit criterion**: `git branch --show-current` imprime `feat/US-022-actualizacion-dependencias-frontend-web`.
  - **Verify**: `git branch --show-current`
- [x] T0.2 Confirmar que no hay otro change en `openspec/changes/` con el mismo `us-id` en conflicto.
  - **Exit criterion**: ningún directorio `openspec/changes/US-022-*` existe salvo el que este plan crea.
  - **Verify**: `ls openspec/changes | grep -c '^US-022-' ` (debe imprimir `1`, contando sólo este directorio)
- [x] T0.3 Capturar el baseline: conteo de tests por workspace y salida cruda de `pnpm audit --audit-level=high --json` ANTES de tocar ninguna versión. No se commitea el baseline (es sólo para comparar en T3.1/T8.1); se pega en la descripción del PR.
  - **Exit criterion**: se tiene, para comparar después, el número total de tests que reportan `pnpm --filter @dsm/web test`, `pnpm --filter @dsm/api test` y las suites de `qa/`, más la lista completa de advisories `high`/`critical` actuales.
  - **Verify**: `pnpm -r test 2>&1 | tee /tmp/us-022-baseline-tests.log` y `pnpm audit --audit-level=high --json > /tmp/us-022-baseline-audit.json`

## Fase 1 — Reconciliación de hallazgos nuevos

- [x] T1.1 Re-auditar en fresco y reconciliar contra la tabla de la US §10 + los 4 hallazgos nuevos que la US ya anticipa (`browserslist`×2, `path-to-regexp`, `@faker-js/faker`). Ninguno es de producción, pero cuentan para AC-5.
  - **Exit criterion**: cada advisory `high`/`critical` presente en el audit fresco está o bien cubierto por una tarea de las Fases 2–5 de este `tasks.md`, o bien tiene una entrada planificada para `scripts/.audit-exclusions.json` (Fase 6) con motivo, dueño y fecha de revisión.
  - **Verify**: `pnpm audit --audit-level=high --json > /tmp/us-022-fresh-audit.json && node -e "const a=require('/tmp/us-022-fresh-audit.json'); console.log(Object.keys(a.advisories ?? {}).length, 'advisories')"` — el número de advisories listado debe quedar en cero al final de Fase 8 (T8.1), no acá; esta verificación es sólo de inventario.

## Fase 2 — Producción: `next`, `sharp`, `postcss`

- [x] T2.1 Bump `next` en `apps/web/package.json` de `15.1.6` a `15.5.21`.
  - **Pattern**: edición directa del campo `dependencies.next` (bump dentro de línea, sin `pnpm.overrides` — es el paquete directo, no una transitiva) — `per design.md D1`.
  - **Exit criterion**: `apps/web/package.json` declara `"next": "15.5.21"`; `pnpm-lock.yaml` resuelve `next@15.5.21` sin el aviso `deprecated` que hoy trae `next@15.1.6`.
  - **Verify**: `pnpm install && grep -A2 "^  next@15.5.21" pnpm-lock.yaml | grep -c deprecated` (debe imprimir `0`)
- [x] T2.2 Revalidar SSR/middleware/topología tras el bump de `next` — es el paso que prueba AC-2 y AC-3, no basta con que compile.
  - **Exit criterion**: la suite E2E de topología y SSR sigue verde con el mismo comportamiento observable (mismos guards, mismo rewrite de `/v1/auth/*`, mismo `noindex` en `/admin/*`).
  - **Verify**: `pnpm --filter @dsm/web test:e2e -- auth-topology cart-topology checkout-topology admin-noindex cart-noindex category-ssr pdp-ssr`
- [x] T2.3 Agregar `sharp` como dependencia explícita de producción en `apps/web/package.json`.
  - **Pattern**: `"sharp": "^0.35.0"` en `dependencies` (NO en `pnpm.overrides` — es una dependencia directa nueva, no un override de transitiva) — `per design.md D2`.
  - **Exit criterion**: `apps/web/package.json` declara `sharp` en `dependencies`; `pnpm-lock.yaml` resuelve `sharp@0.35.0` (o superior dentro del rango) como dependencia directa de `apps/web`, no como `optionalDependencies` implícito de `next`.
  - **Verify**: `pnpm install && pnpm --filter @dsm/web ls sharp`
- [x] T2.4 Bump `postcss` (devDependency directa de `apps/web`) a `8.5.18`.
  - **Exit criterion**: `apps/web/package.json` declara `"postcss": "8.5.18"` en `devDependencies`.
  - **Verify**: `pnpm install && pnpm --filter @dsm/web ls postcss`
- [x] T2.5 Agregar `postcss: "8.5.18"` a `pnpm.overrides` en el `package.json` raíz, para forzar también la copia interna que `next` fija (hoy `8.4.31`).
  - **Pattern**: extender el objeto `pnpm.overrides` existente (mismo mecanismo que `multer: "^2.0.0"`, commit `a4ea348`) — `per design.md D3`.
  - **Exit criterion**: `pnpm-lock.yaml` no resuelve ninguna copia de `postcss` por debajo de `8.5.18` en todo el árbol.
  - **Verify**: `pnpm install && grep -c "postcss@8.4" pnpm-lock.yaml` (debe imprimir `0`)
  - **Si este override rompe el pipeline de Tailwind (build de CSS visualmente distinto, warnings nuevos de PostCSS, o `pnpm --filter @dsm/web build` falla)**: PARAR. No revertir en silencio ni buscar un workaround — agregar una entrada `[Deferred — owner: usuario, ...]` a `proposal.md` describiendo qué rompió, y dejar el override sin aplicar hasta la decisión del usuario (per instrucción explícita del coordinador — ver `proposal.md` Open questions, segunda entrada).

## Fase 3 — Revalidación de superficie de producción (AC-3)

- [ ] T3.1 Build de producción completo + comparación de conteo de tests contra el baseline de T0.3.
  - **Exit criterion**: `pnpm --filter @dsm/web build` termina en exit 0; el número total de tests reportado por `pnpm -r test` es igual o mayor al baseline de T0.3, nunca menor (US §9 — "mismo número de tests").
  - **Verify**: `pnpm --filter @dsm/web build && pnpm -r test 2>&1 | tee /tmp/us-022-post-tests.log && diff <(grep -oE '[0-9]+ passed' /tmp/us-022-baseline-tests.log) <(grep -oE '[0-9]+ passed' /tmp/us-022-post-tests.log)`
- [ ] T3.2 Verificar específicamente que el sitemap y los metadatos siguen intactos (AC-3 lo nombra explícito, no sólo "la suite pasa").
  - **Exit criterion**: `apps/web/src/features/storefront/sitemap.test.ts` sigue verde con el mismo contenido esperado (mismas URLs, mismo `lastmod` shape); no aparece ningún `loading.tsx` nuevo en `(storefront)` (regla ya documentada en `apps/web/README.md` — un soft-200 rompería el 404 real de categoría/ficha, gap F59).
  - **Verify**: `pnpm --filter @dsm/web test -- sitemap.test.ts && find apps/web/app/\(storefront\) -iname "loading.tsx"` (el `find` debe imprimir vacío)

## Fase 4 — Dev-only: `playwright` (bump) y `vitest` (spike aislado)

- [ ] T4.1 Bump `@playwright/test` de `apps/web/package.json` de `1.49.1` a `1.55.1`.
  - **Exit criterion**: `apps/web/package.json` declara `"@playwright/test": "1.55.1"`; la suite E2E completa de `apps/web` sigue verde con la misma cantidad de specs.
  - **Verify**: `pnpm install && pnpm --filter @dsm/web test:e2e`
- [ ] T4.2 **Spike de `vitest` 2.1.8 → 3.2.6 (major) — decisión del usuario 2026-09-06: opción (b), spike aislado antes de decidir.**
  Crear una rama de spike separada (`spike/US-022-vitest-3` desde esta misma rama, o un commit fácilmente revertible en esta rama si el spike resulta limpio) y aplicar el bump ahí para medir el blast radius real, ANTES de decidir si se integra a esta US:
  - Bump `vitest`/`@vitest/coverage-v8` (o el provider de coverage que use el repo) a `3.2.6` en los `package.json` que lo declaren.
  - Correr la suite completa de `apps/web` (unit + component) y anotar: qué se rompe (config de `vitest.config.ts`, compatibilidad con `msw@2.7.0`, `@testing-library/react@16`, setup de `jsdom`), cuántos tests fallan y por qué (config vs. assertion real), y si el arreglo es mecánico (cambiar config) o estructural (reescribir tests).
  - **Exit criterion**: existe un resumen escrito del blast radius (en el propio PR del spike, o en una nota que se agregue a `proposal.md` bajo la pregunta Deferred original) con datos concretos — no una opinión ("parece que rompe poco"), sino el conteo real de fallas y su causa.
  - **Verify**: `pnpm --filter @dsm/web test` corrido contra el bump del spike, con el resumen de resultados documentado.
  - **Decisión posterior** (fuera de esta task, vuelve al usuario con el dato del spike en mano): si el blast radius es chico/mecánico → se integra el bump a esta US como una nueva task con su propio `Exit criterion:`/`Verify:`. Si es grande/estructural → se difiere por AC-6 (exclusión nominal en `scripts/.audit-exclusions.json`, Fase 6), documentando el motivo con el dato real del spike, no una suposición.

## Fase 5 — Transitivas restantes vía `pnpm.overrides`

> **Regla de esta fase, aplicable a TODAS las tareas de acá abajo**: si aplicar el override rompe algo (build, runtime, o cualquier suite), PARAR inmediatamente. No revertir en silencio, no buscar un workaround alternativo por cuenta propia. Agregar una entrada `[Deferred — owner: usuario, ...]` a `proposal.md` describiendo exactamente qué se rompió, y dejar esa entrada del override sin aplicar (o revertida a la versión anterior, documentando que se revirtió y por qué) hasta que el usuario decida. Esto es una instrucción directa del coordinador humano — per `proposal.md` Open questions, segunda entrada.

- [ ] T5.1 `handlebars` — caso especial: entra sólo por `postman-runtime` (dependencia de `newman`, devDependency de `qa/package.json`), no toca ningún bundle de producción.
  - **Pattern**: `pnpm.overrides` raíz, versión = la mínima que `pnpm audit` reporte como "fixed in" al momento de ejecutar (no se fija de antemano — per `design.md` D5, mismo motivo por el que `a4ea348` midió antes de decidir).
  - **Exit criterion**: `pnpm audit --audit-level=high --json` ya no reporta `handlebars` como vulnerable; la suite funcional de QA que usa `newman` (`pnpm --filter @dsm/qa test:functional`, requiere el backend arriba vía `pnpm --filter @dsm/qa run api:up`) sigue pasando con el reporte renderizado sin errores de templating.
  - **Verify**: `pnpm install && pnpm audit --audit-level=high --json | node -e "const chunks=[];process.stdin.on('data',c=>chunks.push(c));process.stdin.on('end',()=>{const a=JSON.parse(Buffer.concat(chunks));const hit=JSON.stringify(a).includes('handlebars');console.log(hit?'STILL VULNERABLE':'OK')})"` (debe imprimir `OK`), seguido de `pnpm --filter @dsm/qa run api:up && pnpm --filter @dsm/qa test:functional` cuando el backend esté disponible localmente.
- [ ] T5.2 Batch del resto de transitivas con múltiples versiones conviviendo en el lockfile (`node-forge`, `tar-fs`, `brace-expansion`, `js-yaml`, `flatted`, `fast-uri`, `picomatch`, `glob`, `tmp`, `lodash`, `underscore`, `nanoid`, `vite`) — sólo las que NO se hayan resuelto solas al aplicar T2.1/T4.1.
  - **Pattern**: mismo mecanismo que T5.1 — un override por paquete en `pnpm.overrides` raíz, versión leída del advisory vivo, no fijada de antemano.
  - **Exit criterion**: para cada paquete de la lista que siga apareciendo en `pnpm audit --audit-level=high` tras T2.1/T4.1, `pnpm-lock.yaml` resuelve la versión que el advisory marca como corregida; ninguno de los que ya se resolvió solo (arrastrado por el bump de `next` o `playwright`) recibe un override redundante.
  - **Verify**: `pnpm install && pnpm audit --audit-level=high --json > /tmp/us-022-post-overrides-audit.json && node -e "const a=require('/tmp/us-022-post-overrides-audit.json'); const targets=['node-forge','tar-fs','brace-expansion','js-yaml','flatted','fast-uri','picomatch','glob','tmp','lodash','underscore','nanoid','vite']; const s=JSON.stringify(a); const hits=targets.filter(t=>s.includes(t)); console.log(hits.length===0?'OK':'STILL VULNERABLE: '+hits.join(','))"` (debe imprimir `OK`)
- [ ] T5.3 `undici` (viene de `testcontainers` en `apps/api`, no de `apps/web` — ver `design.md` D4).
  - **Pattern**: `pnpm.overrides` raíz, `undici: "6.27.0"` — mismo mecanismo, per `design.md` D4.
  - **Exit criterion**: `pnpm audit --audit-level=high` ya no reporta `undici`; la suite de integración de `apps/api` que usa `testcontainers` (`pnpm --filter @dsm/api test:e2e`, requiere Docker disponible) sigue pasando.
  - **Verify**: `pnpm install && pnpm --filter @dsm/api test:e2e`

## Fase 6 — Gate ejecutable de auditoría (AC-5)

- [ ] T6.1 Crear `scripts/.audit-exclusions.json` (raíz) — array vacío o con las exclusiones nominales que hayan quedado de las Fases 1/5 (p. ej. si `vitest` termina diferido, o si algún hallazgo de Fase 1 no se pudo cerrar sin major).
  - **Pattern**: cada entrada requiere `package`, `advisoryId`, `reason`, `owner`, `reviewBy` (fecha ISO) — ningún campo opcional; una entrada incompleta debe hacer fallar el gate igual que un hallazgo sin cubrir (`design.md` D6).
  - **Exit criterion**: el archivo existe, es JSON válido, y cada entrada (si las hay) tiene los cinco campos.
  - **Verify**: `node -e "const e=require('./scripts/.audit-exclusions.json'); const bad=e.filter(x=>!x.package||!x.advisoryId||!x.reason||!x.owner||!x.reviewBy); console.log(bad.length===0?'OK':'INCOMPLETE: '+JSON.stringify(bad))"`
- [ ] T6.2 Crear `scripts/check-audit-exclusions.mjs` (raíz).
  - **Pattern**: script Node plano (sin dependencias nuevas), lee JSON de `pnpm audit --audit-level=high --json` por stdin, cruza contra `.audit-exclusions.json` por `package`+`advisoryId`, `console.error` + `process.exit(1)` en el camino de falla — mismo estilo que `apps/web/scripts/check-whatsapp-configured.mjs` — `per design.md D6`.
  - **Exit criterion**: con un input de audit sintético que contenga UN hallazgo `high` sin excluir, el script termina con exit 1 y un mensaje que nombra el paquete; con el mismo input pero el hallazgo cubierto por una exclusión completa en `.audit-exclusions.json`, termina con exit 0.
  - **Verify**: `echo '{"advisories":{"1":{"module_name":"fake-pkg","severity":"high","github_advisory_id":"GHSA-fake-0000"}}}' | node scripts/check-audit-exclusions.mjs; echo "exit=$?"` (debe imprimir `exit=1`, y el mensaje debe nombrar `fake-pkg`)
- [ ] T6.3 Agregar el script `"audit:gate"` al `package.json` raíz.
  - **Pattern**: `"audit:gate": "pnpm audit --audit-level=high --json | node scripts/check-audit-exclusions.mjs"` — el `--audit-level=high` queda hardcodeado en esta línea, nunca parametrizable desde `.audit-exclusions.json` ni desde variables de entorno (es lo que impide subir el umbral por accidente, AC-7).
  - **Exit criterion**: `pnpm run audit:gate` es invocable desde la raíz del monorepo sin argumentos adicionales.
  - **Verify**: `grep -n '"audit:gate"' package.json`

## Fase 7 — Reconciliación final de Fase 1

- [ ] T7.1 Cerrar los 4 hallazgos nuevos identificados en T1.1 (`browserslist`×2, `path-to-regexp`, `@faker-js/faker`) — vía override si el fix no exige major, o vía exclusión nominal en `scripts/.audit-exclusions.json` si sí lo exige (aplicando la misma cláusula de escalamiento de Fase 5 si romper algo al intentarlo).
  - **Exit criterion**: cada uno de los 4 hallazgos está o resuelto (ya no aparece en `pnpm audit --audit-level=high`) o cubierto por una exclusión nominal completa en `scripts/.audit-exclusions.json`.
  - **Verify**: `pnpm audit --audit-level=high --json | node scripts/check-audit-exclusions.mjs; echo "exit=$?"` (debe imprimir `exit=0`, contingente en que T6.1-T6.3 ya existan)

## Fase 8 — Verificación suite-level (cierre)

- [ ] T8.1 `pnpm run audit:gate` en exit 0 sobre el estado final del árbol (con `vitest` deferred documentado en `.audit-exclusions.json` si esa es la decisión del usuario, o resuelto si eligió forzarlo).
  - **Exit criterion**: AC-1, AC-2, AC-5 y AC-7 cumplidas simultáneamente — cero hallazgos `high`/`critical` sin cubrir, ninguna exclusión sin los 5 campos, umbral de severidad intacto en `high`.
  - **Verify**: `pnpm run audit:gate; echo "exit=$?"` (debe imprimir `exit=0`)
- [ ] T8.2 Suite completa del monorepo verde, lint y typecheck limpios — cierre de AC-3.
  - **Exit criterion**: `pnpm -r lint`, `pnpm -r typecheck` y `pnpm -r test` terminan en exit 0, con el mismo conteo de tests (o mayor) que el baseline de T0.3.
  - **Verify**: `pnpm -r lint && pnpm -r typecheck && pnpm -r test`
- [ ] T8.3 Build de producción final (mismo paso que corre `ci.yml` — "Build del frontend").
  - **Exit criterion**: `pnpm --filter @dsm/web build` termina en exit 0 con las mismas variables de entorno que usa `ci.yml` (`API_INTERNAL_ORIGIN`, `NEXT_PUBLIC_API_BASE_URL`).
  - **Verify**: `API_INTERNAL_ORIGIN=http://localhost:3000 NEXT_PUBLIC_API_BASE_URL=http://localhost:3000 pnpm --filter @dsm/web build`

## Documentación

- [ ] T9.1 Confirmar que no hace falta tocar ningún README ni crear ningún ADR (ya evaluado en `design.md` — ninguna decisión de este change califica per `documentation-standards.md` §8.1).
  - **Exit criterion**: `apps/web/README.md` no requiere edición (no documenta versiones de dependencias); no existe ningún ADR nuevo bajo `docs/architecture/decisions/`.
  - **Verify**: `git status --porcelain docs/architecture/decisions/ apps/web/README.md` (debe imprimir vacío al final del change)

## Verification (suite-level)

- [ ] Todos los tests unitarios/integración pasan: `pnpm -r test`
- [ ] Lint / typecheck limpios: `pnpm -r lint && pnpm -r typecheck`
- [ ] E2E de `apps/web` verde: `pnpm --filter @dsm/web test:e2e`
- [ ] E2E de `apps/api` (testcontainers) verde: `pnpm --filter @dsm/api test:e2e`
- [ ] Build de producción verde: `pnpm --filter @dsm/web build`
- [ ] Gate de auditoría en exit 0: `pnpm run audit:gate`
- [ ] `vitest` 2→3: explícitamente resuelto (decisión del usuario tomada y ejecutada, o diferido con exclusión nominal) antes de considerar el change cerrado — no puede quedar en limbo sin ninguna de las dos.
