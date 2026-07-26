# US-001 QA — Tasks

> **Estimación dual**: tradicional **6-8h** · AI-asistido **3-4h** (× ~0.45, Peng 2023). Coherente con QA-US-001 (§7 del US: 6-8h).
> **Alcance**: capas owned-by-QA (L3 cross-stack). Las capas dev-owned NO se autoran acá.
> **Todas las tasks son closure-grade**: cada una con `Exit criterion:` observable + `Verify:` (el comando que `/develop-qa` corre para cerrarla).
> **Ejecutor**: `/develop-qa`. Los `Verify:` nombran comandos que existirán tras el scaffolding (Fase 1).

## Pre-requisitos

- [ ] L1 (backend) + L2 (frontend) verdes en sus changes de disciplina (`qa-three-layer-regression`: L3 no corre sin ellas).
  - **Exit criterion**: `pnpm -r test` verde en `apps/api` y `apps/web`.
  - **Verify**: `pnpm -r test`

## Fase 1: Scaffolding del paquete `@dsm/qa`

- [x] T1.1 Crear el paquete workspace `@dsm/qa` (`qa/`) con la estructura `acceptance|e2e|functional|performance|support` y su `package.json` (cucumber, @playwright/test, newman, @axe-core/playwright, tsx).
  - **Exit criterion**: `qa/package.json` existe, resuelve en el workspace pnpm, y expone los scripts `test:acceptance`, `test:e2e`, `test:functional`, `test:load`, `test:a11y`.
  - **Verify**: `pnpm --filter @dsm/qa install && node -e "const p=require('./qa/package.json'); for (const s of ['test:acceptance','test:e2e','test:functional','test:load','test:a11y']) if(!(s in (p.scripts||{}))) process.exit(1)" && pnpm --filter @dsm/qa exec cucumber-js --version` (nota: `run test:acceptance -- --help` no sirve — pnpm reenvía el `--` literal y cucumber trata `--help` como path; se verifica install + scripts + runner invocable)
- [x] T1.2 Implementar el fixture de auth `qa/support/admin-auth.ts` (precedencia login-real → fallback JWT `role=admin` minteado con `JWT_SECRET`).
  - **Exit criterion**: `adminAuthWithSource()` devuelve el token `role=admin` **y de qué rama salió**. Con `ADMIN_BOOTSTRAP_TOKEN` configurado la ruta real es **obligatoria**: si la API no responde o devuelve ≠200, se **falla ruidoso** en vez de mintear un reemplazo (`testing-standards` §14.2 prohíbe las factories que mockean en silencio una dependencia que el test debería conocer — un fallback callado dejaría toda la suite verde contra una costura de login rota). El fallback minteado queda sólo para entornos SIN credenciales, y está prohibido en modo estricto (`QA_AUTH_STRICT=true`, automático en CI).
  - **Verify**: `pnpm --filter @dsm/qa exec tsx support/admin-auth.smoke.ts --require-real` (con la API arriba: exige la rama `real-login`, no sólo un JWT bien formado)
- [ ] T1.3 Implementar seed determinista `qa/support/seed.ts` + builders `qa/support/builders.ts` (vía API real; SKU con prefijo único por-run).
  - **Exit criterion**: `seedCatalogo()` crea categorías/productos vía la API y devuelve sus ids; re-ejecutar no colisiona (idempotente).
  - **Verify**: `pnpm --filter @dsm/qa exec tsx support/seed.smoke.ts` (siembra y limpia sin error contra la API local)

## Fase 2: Aceptación BDD (Cucumber.js + Playwright)

- [ ] T2.1 Escribir los `.feature` (Happy H-1..H-5, Corner C-1..C-4) y sus step defs, reusando `world.ts`/`adminAuth`/`seed`.
  - **Exit criterion**: TC-001..TC-009 verdes contra la API viva; runner en modo `strict` (sin steps pending).
  - **Verify**: `pnpm --filter @dsm/qa test:acceptance -- --tags "@critical-path or @regression" --profile happy-corner`
- [ ] T2.2 Escribir los `.feature` Negative (N-1/2/3, N-4, N-5, N-8, N-6, N-7) y step defs, con negative-space (sin escritura parcial, sin doble efecto, RBAC).
  - **Exit criterion**: TC-010..TC-015 verdes; N-1/2/3 asertan que el producto **no se crea** y N-5 que **no crea un segundo** con el SKU.
  - **Verify**: `pnpm --filter @dsm/qa test:acceptance -- --tags "@acceptance and @regression" --profile negative`
- [ ] T2.3 Escribir los cross-feature (X-1, X-2, **X-6**) y marcar X-5 `@deferred` sin ejecutarlo.
  - **Exit criterion**: TC-016/TC-017 verdes cross-stack (FE→API real); **TC-019 (X-6, login real por `/acceso`) verde** — desbloqueado 2026-07-25, el backend expone `POST /v1/admin/auth/login` (change backend, Fase 9), así que el fixture `adminAuth` usa la rama de login REAL, no el fallback; TC-018 (`@deferred`) presente y excluido por tag.
  - **Verify**: `pnpm --filter @dsm/qa test:acceptance -- --tags "@critical-path and not @deferred"`

## Fase 3: E2E cross-stack de la costura FE↔BE (Playwright)

- [ ] T3.1 Escribir los specs de mapeo de error contra la API real (422→inline, 409→banner, 401→redirect) + negative-space de publicar-incompleto y archivar-2-pasos.
  - **Exit criterion**: TC-020..TC-024 verdes; sin `waitForTimeout`; selectores por rol/label.
  - **Verify**: `pnpm --filter @dsm/qa test:e2e`

## Fase 4: Funcional API (Newman) + Accesibilidad (axe-core)

- [ ] T4.1 Crear la colección Postman `catalogo-admin.postman_collection.json` (barrido RBAC 401/403 en toda la superficie `/v1/admin/*` + forma RFC 7807 sin fuga de esquema).
  - **Exit criterion**: TC-025..TC-027 verdes; cada endpoint admin verifica 401 sin token y 403 con rol no-admin; los errores validan el envelope y la ausencia de stack/SQL crudo.
  - **Verify**: `pnpm --filter @dsm/qa test:functional` (`newman run qa/functional/catalogo-admin.postman_collection.json`)
- [ ] T4.2 Escribir el check de accesibilidad axe-core sobre las 4 pantallas contra la API real.
  - **Exit criterion**: TC-030 verde con **0 violaciones nivel AA** en las 4 pantallas.
  - **Verify**: `pnpm --filter @dsm/qa test:a11y`

## Fase 5: Carga k6 (NFR ≥5.000 SKUs)

- [x] T5.1 Implementar `qa/performance/lib/thresholds.js` (budgets atados al NFR — fuente única) + `data/seed-skus.js` (≥5.000 SKUs deterministas).
  - **Exit criterion**: `thresholds.js` exporta `p(95)<300`, `p(99)<800`, `http_req_failed rate<0.01`, `checks rate>0.99`, tagueado `endpoint:list_products`; el seed genera ≥5.000 filas.
  - **Verify**: `node -e "import('./qa/performance/lib/thresholds.js').then(t=>{if(!t.list_products)process.exit(1)}).catch(e=>{console.error(e);process.exit(1)})"` (el paquete `@dsm/qa` es ESM — `type: module` para tsx/cucumber/k6 — así que se valida con `import()` dinámico, no `require`)
- [ ] T5.2 Escribir `baseline.js` + `stress.js` (executors de modelo abierto) con `check()` de status + `pagination.total>=5000` + `data.length<=limit`, y auth en `setup()`.
  - **Exit criterion**: TC-028 (baseline) verde contra el dataset sembrado; TC-029 (stress) corre y documenta el knee; smoke-load (1-2 VUs) reusa los mismos thresholds.
  - **Verify**: `k6 run --vus 2 --duration 30s qa/performance/baseline.js` (smoke-load exit 0)

## Fase 6: Exploratorio + cableado de CI

- [x] T6.1 Documentar los charters de exploratorio (TC-031 máquina de estado, TC-032 auth/sesión) en `qa/exploratory/charters.md`.
  - **Exit criterion**: cada charter con misión, áreas, riesgos y heurísticas; marcados `execution_mode: manual` con justificación.
  - **Verify**: `test -f qa/exploratory/charters.md && grep -q "TC-031" qa/exploratory/charters.md && grep -q "TC-032" qa/exploratory/charters.md`
- [x] T6.2 Cablear los gates de §12 del qa-plan en la CI (smoke-load en PR; aceptación/E2E/funcional nightly+pre-uat; a11y+baseline pre-release).
  - **Exit criterion**: `.github/workflows/qa.yml` parsea como YAML válido; levanta el stack (Postgres + migraciones + API, y `apps/web` para las suites de browser); exige el **login real** (`QA_AUTH_STRICT`, sin fallback minteado); y cada suite está **auto-gated** por la existencia de sus archivos, de modo que el workflow **no rompe ningún PR** mientras las fases restantes se autoran y se activa sola cuando aterrizan.
  - **Verify**: `python3 -c "import yaml,sys; d=yaml.safe_load(open('.github/workflows/qa.yml')); s=d['jobs']['qa-cross-stack']['steps']; sys.exit(0 if all('if' in x for x in s if any(k in str(x.get('run',''))+str(x.get('uses','')) for k in ['test:functional','test:acceptance','test:e2e','test:a11y','k6'])) else 1)"` (todo paso que invoca una suite está gated; un Verify de existencia — `grep -q` — no probaría el exit criterion, per F50)

## Verification (suite-level)

- [ ] La suite de aceptación (excluyendo sólo `@deferred`) pasa: `pnpm --filter @dsm/qa test:acceptance -- --tags "not @deferred"`
- [ ] E2E de costura pasa: `pnpm --filter @dsm/qa test:e2e`
- [ ] Funcional API pasa: `pnpm --filter @dsm/qa test:functional`
- [ ] Accesibilidad 0 violaciones AA: `pnpm --filter @dsm/qa test:a11y`
- [ ] Carga smoke-load exit 0: `k6 run --vus 2 --duration 30s qa/performance/baseline.js`
- [ ] Cada AC activo (AC-1..AC-9) tiene ≥1 test-case verde, **incluido el login real por `/acceso`** (TC-019, desbloqueado por la Fase 9 del backend); AC-10 presente `@deferred`.
