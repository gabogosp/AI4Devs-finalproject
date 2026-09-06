# Tasks — US-022 QA: revalidación cross-cutting

> Cada task se cierra cuando su `Verify:` pasa. Los comandos asumen la
> **raíz del repo** como cwd. Ninguna task de este plan modifica código de
> `qa/`, `apps/web/` ni `apps/api/` — sólo los ejecuta y documenta el
> resultado (T-QA6/T-QA7/T-QA8 son la excepción explícita: registran una
> decisión diferida, nunca la aplican). **Ninguna task está ejecutada
> todavía** — este plan queda para `/develop-qa`.

## Traceability matrix

| AC (US-022) | Título | Task IDs | Estado |
|---|---|---|---|
| AC-3 | El sitio sigue funcionando igual después de actualizar (SSR/sitemap/metadatos intactos) | T-QA0, T-QA2, T-QA4 | in this change |
| AC-4 | Las dependencias de desarrollo también se sanean (suites siguen pasando con la misma cobertura) | T-QA0, T-QA1, T-QA2, T-QA3, T-QA4 | in this change |
| — | Hallazgo: bump de `@playwright/test` propio de `qa/` (consistencia con `apps/web`) | T-QA5 | deferred → `proposal.md` §Preguntas abiertas, primera entrada |
| — | Hallazgo: carrera preexistente en TC-305 (mismo mecanismo que `pdp-invalidation.spec.ts`) | T-QA6 | deferred → `proposal.md` §Preguntas abiertas, segunda entrada |
| — | Hallazgo: gate `qa.yml` roto desde antes de esta US (CORS ausente) | T-QA7 | deferred → `proposal.md` §Preguntas abiertas, tercera entrada |

Ningún AC de US-022 asignado a QA (§7: "revalidar las suites propias... y
confirmar que la cobertura no bajó") queda sin task. Los 3 hallazgos quedan
`deferred` con su entrada correspondiente ya escrita en `proposal.md` — no
son omisiones, son decisiones explícitas que exceden el alcance de
revalidación de este change (per `design.md` D-QA1/D-QA3).

## Pre-flight

- [ ] T-QA0 Confirmar rama activa y levantar el entorno cross-stack real
  (API + Postgres + front construido con las versiones ya bumpeadas).
  - **Pattern**: `qa/scripts/api-up.sh` (exporta `CORS_ALLOWED_ORIGINS`,
    `AUTH_RATE_LIMIT_MAX`, etc. — nunca arrancar la API a mano, es
    exactamente el defecto que rompe `qa.yml`, per `design.md` D-QA3) +
    `pnpm --filter @dsm/web build && pnpm --filter @dsm/web start` con
    `NEXT_PUBLIC_API_BASE_URL=http://localhost:3000`,
    `API_INTERNAL_ORIGIN=http://localhost:3000`, `PORT=3100` (mismas
    variables que declara `.github/workflows/qa.yml` para ese paso).
  - **Exit criterion**: `git branch --show-current` imprime
    `feat/US-022-actualizacion-dependencias-qa`; la API responde 200 en
    `/health`; el front responde 200 en `http://localhost:3100`.
  - **Verify**: `git branch --show-current && curl -sS -o /dev/null -w "%{http_code}" http://localhost:3000/health | grep -qx 200 && curl -sS -o /dev/null -w "%{http_code}" http://localhost:3100 | grep -qx 200`

## Fase 1 — Revalidación de la suite de aceptación BDD (Layer 3)

- [ ] T-QA1 Correr la suite completa de Cucumber contra el stack bumpeado y
  comparar el conteo contra el baseline vigente (14 features, 136
  escenarios — `qa-plan.md` §1).
  - **Exit criterion**: la suite termina en exit 0; el reporte de Cucumber
    (`format: progress`) muestra 136 escenarios ejecutados (excluyendo los
    tageados `@deferred`), ninguno en rojo. Si el conteo real difiere del
    documentado en `qa-plan.md` §1, se corrige esa cifra en `qa-plan.md`
    antes de cerrar la task (el conteo documentado es una foto tomada al
    planificar, no una cifra que deba forzarse).
  - **Verify**: `pnpm --filter @dsm/qa test:acceptance -- --tags "not @deferred" 2>&1 | tee /tmp/us-022-qa-acceptance.log && grep -E "^[0-9]+ scenarios" /tmp/us-022-qa-acceptance.log`

## Fase 2 — Revalidación E2E cross-stack SSR/SEO y funcional (Layer 3)

- [ ] T-QA2 Correr la suite completa de `test:e2e` (16 specs, 68 tests,
  excluye a11y por `testMatch`) — cubre específicamente `categoria-ssr-seo.spec.ts`
  y `pdp-ssr-seo.spec.ts`, que son las que prueban AC-3 (SSR/sitemap/
  metadatos intactos) desde Layer 3.
  - **Exit criterion**: la suite termina en exit 0; el reporter (`list`)
    confirma 68 tests pasando, ninguno en rojo, ninguno `skipped`
    inesperadamente. TC-305 (`pdp-ssr-seo.spec.ts`, la que comparte el
    patrón de carrera de T-QA6) se observa específicamente: si falla de
    forma intermitente en 2+ corridas de esta task, se anota como evidencia
    nueva en la entrada `[Deferred]` ya escrita de `proposal.md` (segunda
    entrada) — no se ensancha su timeout ni se modifica el spec sin que el
    usuario decida (`design.md` D-QA1).
  - **Verify**: `pnpm --filter @dsm/qa exec playwright install --with-deps chromium && pnpm --filter @dsm/qa test:e2e 2>&1 | tee /tmp/us-022-qa-e2e.log && grep -E "^[0-9]+ passed" /tmp/us-022-qa-e2e.log`

## Fase 3 — Revalidación de accesibilidad WCAG AA (Layer 3)

- [ ] T-QA3 Correr la suite completa de `test:a11y` (9 specs, 38 tests,
  axe-core contra `wcag2a`+`wcag2aa`) — el bump de `next` no debería cambiar
  ningún marcado de accesibilidad (US no toca ninguna pantalla), pero es
  exactamente el tipo de regresión silenciosa que un bump de framework puede
  introducir (ej. un `aria-*` que Next deja de renderizar en SSR).
  - **Exit criterion**: la suite termina en exit 0; los 38 tests pasan sin
    ninguna violación WCAG AA nueva (`results.violations` vacío en cada
    caso, tal como ya lo asertan los specs existentes).
  - **Verify**: `pnpm --filter @dsm/qa test:a11y 2>&1 | tee /tmp/us-022-qa-a11y.log && grep -E "^[0-9]+ passed" /tmp/us-022-qa-a11y.log`

## Fase 4 — Cierre: cobertura no bajó (AC-3, AC-4)

- [ ] T-QA4 Confirmar que el conteo total de escenarios/tests de las tres
  fases (T-QA1+T-QA2+T-QA3) es igual o mayor al documentado en `qa-plan.md`
  §1 al momento de planificar (136 + 68 + 38 = 242), nunca menor — mismo
  criterio que el `tasks.md` de FE ya aplicó a su propia suite dev-owned
  (T3.1, "el número total de tests... nunca menor").
  - **Exit criterion**: la suma de escenarios/tests verdes de T-QA1+T-QA2+T-QA3
    es ≥ 242; si algún conteo real difiere del documentado (por deriva desde
    que se escribió este plan), la comparación se hace contra el conteo real
    tomado al inicio de este plan (`git log` de `qa/` entre la fecha de este
    plan y la ejecución — si `qa/` no cambió, el "antes" y el "después" son
    el mismo número por definición, y la task confirma exactamente eso: cero
    regresión, no una mejora inventada).
  - **Verify**: `test $(grep -oE '^[0-9]+' /tmp/us-022-qa-acceptance.log | head -1) -ge 136 && test $(grep -oE '^[0-9]+' /tmp/us-022-qa-e2e.log | head -1) -ge 68 && test $(grep -oE '^[0-9]+' /tmp/us-022-qa-a11y.log | head -1) -ge 38 && echo OK`

## Fase 5 — Hallazgos: registrar, no aplicar

- [ ] T-QA5 Confirmar que la entrada `[Deferred]` sobre el bump de
  `@playwright/test` de `qa/package.json` sigue en `proposal.md` y que
  `qa/package.json` sigue en `1.49.1` (sin aplicar el bump en este change).
  - **Exit criterion**: `qa/package.json` NO declara `@playwright/test` en
    `1.55.1`; `proposal.md` de este change contiene la entrada `[Deferred —
    owner: usuario, motivo: bump de \`@playwright/test\`...]`.
  - **Verify**: `grep -q '"@playwright/test": "1.49.1"' qa/package.json && grep -q "bump de \`@playwright/test\`" openspec/changes/US-022-actualizacion-dependencias-qa/proposal.md`
- [ ] T-QA6 Confirmar que el hallazgo de la carrera de TC-305 está
  documentado en `proposal.md`, con evidencia de si se reprodujo o no
  durante T-QA2.
  - **Exit criterion**: `proposal.md` contiene la entrada `[Deferred —
    owner: usuario, motivo: \`qa/e2e/pdp-ssr-seo.spec.ts\` TC-305...]`; si
    T-QA2 reprodujo una falla intermitente en TC-305, esa evidencia (número
    de corridas, número de fallos) se agrega como nota a esa misma entrada
    (no se abre una entrada nueva ni se silencia).
  - **Verify**: `grep -q "TC-305" openspec/changes/US-022-actualizacion-dependencias-qa/proposal.md`
- [ ] T-QA7 Confirmar que el hallazgo del gate roto de `qa.yml` está
  documentado en `proposal.md`, con el ID de la corrida verificada.
  - **Exit criterion**: `proposal.md` contiene la entrada `[Deferred —
    owner: usuario, motivo: el gate nightly \`qa-cross-stack\`...]`;
    `.github/workflows/qa.yml` no fue modificado por este change.
  - **Verify**: `grep -q "qa-cross-stack" openspec/changes/US-022-actualizacion-dependencias-qa/proposal.md && git diff --stat main -- .github/workflows/qa.yml | wc -l | grep -qx 0`

## Documentación

- [ ] T-QA8 Confirmar que no hace falta tocar ningún README ni crear ningún
  ADR (ninguna decisión de este change califica per
  `documentation-standards.md` §8.1 — es revalidación, no arquitectura).
  - **Exit criterion**: no existe ningún ADR nuevo bajo
    `docs/architecture/decisions/`; ningún README de `qa/` requiere edición.
  - **Verify**: `git status --porcelain docs/architecture/decisions/ qa/README.md 2>/dev/null | wc -l | grep -qx 0`

## Verification (suite-level)

- [ ] Aceptación BDD verde, ≥136 escenarios: `pnpm --filter @dsm/qa test:acceptance -- --tags "not @deferred"`
- [ ] E2E cross-stack verde, ≥68 tests: `pnpm --filter @dsm/qa test:e2e`
- [ ] Accesibilidad WCAG AA verde, ≥38 tests: `pnpm --filter @dsm/qa test:a11y`
- [ ] Cobertura total ≥242 (T-QA4) — sin regresión respecto al conteo vigente
  documentado en `qa-plan.md` §1
- [ ] Los 3 hallazgos (`@playwright/test` de `qa/`, carrera de TC-305, gate
  roto de `qa.yml`) quedan documentados como `[Deferred — owner: usuario,
  ...]` en `proposal.md`, ninguno aplicado ni silenciado
