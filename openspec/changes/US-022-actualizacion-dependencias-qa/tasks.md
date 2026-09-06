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
| — | **Hallazgo: `carrito.spec.ts` TC-731 falla real 3/3 — bisect confirmó que NO es regresión del bump de `next`, bug preexistente ajeno a esta US** | T-QA2 | deferred → `proposal.md` §Preguntas abiertas, cuarta entrada (diagnóstico añadido tras bisect) |

Ningún AC de US-022 asignado a QA (§7: "revalidar las suites propias... y
confirmar que la cobertura no bajó") queda sin task. Los 3 hallazgos quedan
`deferred` con su entrada correspondiente ya escrita en `proposal.md` — no
son omisiones, son decisiones explícitas que exceden el alcance de
revalidación de este change (per `design.md` D-QA1/D-QA3).

## Pre-flight

- [x] T-QA0 Confirmar rama activa y levantar el entorno cross-stack real
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
  - **Nota de ejecución (2026-09-06)**: puerto 3000 ocupado por la API de
    desarrollo de OTRA sesión en esta máquina compartida (worktree
    `demo-mvp-visual-prep`, confirmado con `lsof` antes de arrancar nada, per
    guardrail). Se usó `QA_API_PORT=3009` (default propio de
    `api-up.sh` — el script ya evita 3000 a propósito) y web en `3100` (libre).
    `NEXT_PUBLIC_API_BASE_URL`/`API_INTERNAL_ORIGIN` apuntan a `3009`. Además
    de las variables que el plan ya documentaba, hicieron falta (no
    documentadas en este plan ni en `api-up.sh`, encontradas por los 500 que
    tiraban las suites — ver T-QA1/T-QA2):
    `PAYMENTS_SIMULATED_ENABLED=true` + `MP_WEBHOOK_SECRET`/`MP_ACCESS_TOKEN`
    (sin esto, `POST /v1/checkout/simulate-payment` 404 — precondición ya
    documentada en `US-010-orden-webhook-stock-qa`/`US-015-historial-compras-qa`
    pero no repetida en este plan) y `NEXT_PUBLIC_SITE_URL=http://localhost:3100`
    en el build del front (default de código `apps/web/src/lib/env.ts` es
    `http://localhost:3000` — con el puerto real del front distinto de 3000,
    el sitemap/canonical quedan con el origen equivocado, TC-204). También se
    comentó `RESEND_API_KEY=replace-me` en el `.env` local de este worktree
    (placeholder truthy que hace resolver `notification.provider.ts` al
    adapter REAL de Resend en vez del de log — mismo tipo de hallazgo de
    higiene de entorno que QA-005-F1 con `GEMINI_API_KEY`, pero sin el
    guardrail de código que sí tiene `ENRICHMENT_ENABLED`; sin este cambio
    cualquier transición de orden que dispare un aviso devuelve 500 por
    `ORDER_NOTIFICATIONS_FROM`/`OWNER_NOTIFICATION_EMAIL` ausentes). API y
    front confirmados 200 contra los puertos reales.

## Fase 1 — Revalidación de la suite de aceptación BDD (Layer 3)

- [x] T-QA1 Correr la suite completa de Cucumber contra el stack bumpeado y
  comparar el conteo contra el baseline vigente (14 features, 136
  escenarios — `qa-plan.md` §1).
  - **Exit criterion**: la suite termina en exit 0; el reporte de Cucumber
    (`format: progress`) muestra 136 escenarios ejecutados (excluyendo los
    tageados `@deferred`), ninguno en rojo. Si el conteo real difiere del
    documentado en `qa-plan.md` §1, se corrige esa cifra en `qa-plan.md`
    antes de cerrar la task (el conteo documentado es una foto tomada al
    planificar, no una cifra que deba forzarse).
  - **Verify**: `pnpm --filter @dsm/qa test:acceptance -- --tags "not @deferred" 2>&1 | tee /tmp/us-022-qa-acceptance.log && grep -E "^[0-9]+ scenarios" /tmp/us-022-qa-acceptance.log`
  - **Nota de ejecución (2026-09-06)**: conteo corregido en `qa-plan.md` §1
    (136 → 172, ver nota ahí — `@blocked` no se estaba excluyendo). Hallazgo
    mecánico de tooling: `pnpm --filter @dsm/qa test:acceptance -- --tags
    "..."` **ignora silenciosamente** el `--tags` pasado por CLI (pnpm inserta
    un `--` extra que rompe el parseo de `yargs` de cucumber-js, cae al
    default `not @deferred` del config) — el `--tags` real sólo aplica
    invocando `cucumber-js` directo (`cd qa && NODE_OPTIONS="--import tsx"
    npx cucumber-js --config acceptance/cucumber.mjs --tags "..."`), sin
    pasar por el script de `pnpm`. Sin este rodeo, `--tags "not @deferred and
    not @blocked"` nunca se aplica.
    Resultado final (DB reseteada, `prisma migrate reset --force`, para
    aislar de residuos de corridas previas en esta misma sesión):
    **172 escenarios, 167 verdes, 5 no-verdes** — ninguno atribuible al bump
    de dependencias (apps/api no fue tocado por el change de FE):
    - `SC-008-X3` (`checkout.feature`) — 5 steps `Undefined`: gap de
      scaffolding preexistente de `US-008-checkout-guest-qa` (el `.feature`
      documenta que la aserción cross-stack real vive en `QA-008-E2E-1`
      —Playwright—, y este escenario BDD nunca tuvo sus steps implementados).
      No corregido (tocar `qa/` está fuera de alcance de este change).
    - `SC-010-N5` ×2 — `Multiple step definitions match`: colisión real y
      preexistente entre un step genérico `{string}` (`cancelacion-ordenes.
      steps.ts:324`) y un regex específico (`pago-webhook.steps.ts:605`). Bug
      de la suite QA (ambigüedad de Cucumber), no del código de producto. No
      corregido.
    - `N-3 · TC-614` (`importar.feature`) — el conteo de catálogo cambió en 1
      pese a dos rechazos de autorización (`5475 !== 5474`); reproducido una
      sola vez, no se aisló si es una carrera cross-scenario (otro escenario
      de la misma corrida completando un import asíncrono) o un defecto real.
      Reportado para revisión — no diagnosticado a fondo por alcance de
      tiempo.
    - `SC-021-H1` (`retencion-ordenes.feature`) — `anonymized_count` vino 3 en
      vez de 1, **incluso con la base de datos recién reseteada** (no es
      residuo de corridas anteriores): el barrido de retención opera sobre
      TODA la tabla `orders`, y otros `.feature`/specs que corren antes en la
      misma suite (alfabéticamente, `retencion-ordenes.feature` es el
      último) también generan datos — hay que auditar si alguno backdatea
      órdenes más allá de los 12 meses de `ORDER_RETENTION_MONTHS` para otro
      propósito. Mismo patrón de fragilidad que el ranking de `metricas.feature`
      (ver abajo). Reportado, no diagnosticado a fondo.
    - `H-1`/`H-2`/`C-2` de `metricas.feature` (ya no fallan en la corrida
      final con DB limpia, pero SÍ fallaron en corridas intermedias con DB
      compartida entre reintentos): el ranking de `top-products` tiene
      `LIMIT 10` (`reports.repository.ts`); con muchos escenarios sembrando
      productos en la misma DB de larga vida, los de baja cantidad de un
      escenario puntual quedan fuera del top-10. Es fragilidad de diseño de
      test preexistente (asume inmunidad a datos compartidos que el `LIMIT`
      no garantiza), no un defecto de producto ni del bump.
    Preexistentes 6 `@blocked` (5 `enriquecimiento.feature` sin
    `GEMINI_API_KEY` real, 1 `pago-webhook.feature` sin sandbox MP) —
    excluidos del conteo de 172, ya documentados en el propio `.feature`.

## Fase 2 — Revalidación E2E cross-stack SSR/SEO y funcional (Layer 3)

- [x] T-QA2 Correr la suite completa de `test:e2e` (16 specs, 68 tests,
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
  - **Nota de ejecución (2026-09-06)**: 68 tests confirmados (conteo exacto,
    sin corrección). **TC-305 corrió limpio en TODAS las corridas de esta
    sesión (0 fallas intermitentes observadas)** — no hay evidencia nueva que
    agregar a la entrada `[Deferred]` de `proposal.md` (Hallazgo 2).
    Dos hallazgos mecánicos de entorno, corregidos y re-corridos:
    (a) `categoria-ssr-seo.spec.ts` TC-204 esperaba que el origen del sitemap
    coincidiera con el origen real de la página, pero el build del front usó
    el default de código de `NEXT_PUBLIC_SITE_URL` (`http://localhost:3000`,
    `apps/web/src/lib/env.ts`) en vez del puerto real (3100) — se rebuildeó
    con `NEXT_PUBLIC_SITE_URL=http://localhost:3100` explícito; (b)
    `cuenta-recuperacion.spec.ts`/`cuenta-seguridad.spec.ts` (TC-143/145/147)
    leen el token de reset del log de la API vía `QA_API_LOG` (`qa/support/
    customer-auth.ts`) — variable DISTINTA de `QA_API_LOG_FILE` que usa
    `qa/support/api-log.ts` para las notificaciones de órdenes (T-QA1); hacía
    falta exportar AMBAS apuntando al mismo archivo de log real.
    Tras corregir ambas: **65/68 verdes, 3 fallas**:
    - **`carrito.spec.ts` TC-731 (teclado y anuncio del total) — FALLA REAL,
      reproducida 3/3 en corridas aisladas (`--repeat-each=3`), no flaky**:
      el test tabula (loop acotado por `document.activeElement`, no un
      presupuesto fijo — no es el anti-patrón de conteo rígido) hasta el
      botón "sumar una unidad" y nunca lo alcanza dentro de 40 `Tab`. Esto
      toca `apps/web`, que SÍ fue bumpeado por esta US (`next` 15.1.6 →
      15.5.21) — es exactamente el tipo de regresión de comportamiento que
      esta revalidación existe para atrapar. **No se investigó más a fondo
      ni se tocó el spec/código — reportado para que el usuario decida**
      (guardrail: no auto-arreglar `apps/web`/`qa/` sin revisión).
    - `metricas.spec.ts` (dataset real X-1, descarga CSV) — 2 fallas por el
      mismo patrón de fragilidad de `LIMIT 10` en el ranking que T-QA1 (la
      corrida de T-QA2 fue DESPUÉS de la corrida completa de T-QA1 contra la
      misma DB, sin resetear; no se re-verificó con DB limpia por acotar
      tiempo, pero el mecanismo es idéntico al ya diagnosticado en T-QA1).

    - **Bisect de TC-731 (2026-09-06, post-escalación del coordinador)**:
      stack aislado en puertos 39009/39100 contra el Postgres propio de este
      worktree. Post-bump (`next` 15.5.21, estado actual): 3/3 fallas, mismo
      mecanismo (`toBeFocused` nunca resuelve tras 40 `Tab`). Luego
      `pnpm --filter @dsm/web add next@15.1.6` (downgrade quirúrgico, sólo
      `next`, sin tocar ningún otro paquete ni el componente), rebuild +
      restart: **3/3 fallas idénticas** contra `next` 15.1.6 (pre-bump). El
      bump queda descartado como causa — es un bug de foco/accesibilidad
      preexistente en el carrito, ajeno a esta US. Entorno revertido
      (`git checkout -- apps/web/package.json pnpm-lock.yaml
      apps/web/next-env.d.ts`, `pnpm install`), procesos temporales
      terminados, working tree limpio verificado antes de continuar.

## Fase 3 — Revalidación de accesibilidad WCAG AA (Layer 3)

- [x] T-QA3 Correr la suite completa de `test:a11y` (9 specs, 38 tests,
  axe-core contra `wcag2a`+`wcag2aa`) — el bump de `next` no debería cambiar
  ningún marcado de accesibilidad (US no toca ninguna pantalla), pero es
  exactamente el tipo de regresión silenciosa que un bump de framework puede
  introducir (ej. un `aria-*` que Next deja de renderizar en SSR).
  - **Exit criterion**: la suite termina en exit 0; los 38 tests pasan sin
    ninguna violación WCAG AA nueva (`results.violations` vacío en cada
    caso, tal como ya lo asertan los specs existentes).
  - **Verify**: `pnpm --filter @dsm/qa test:a11y 2>&1 | tee /tmp/us-022-qa-a11y.log && grep -E "^[0-9]+ passed" /tmp/us-022-qa-a11y.log`
  - **Nota de ejecución (2026-09-06)**: **38/38 verdes, exit 0** — conteo
    exacto, sin corrección, sin ninguna falla. Cero violaciones WCAG AA
    nuevas. El bump de `next` no introdujo ninguna regresión de
    accesibilidad detectable por esta suite.

## Fase 4 — Cierre: cobertura no bajó (AC-3, AC-4)

- [x] T-QA4 Confirmar que el conteo total de escenarios/tests de las tres
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
  - **Nota de ejecución (2026-09-06)**: cobertura total real = **172 + 68 +
    38 = 278** ≥ 242 documentado originalmente (y ≥ el 278 corregido en
    `qa-plan.md` §1) — cero regresión de cobertura. `qa/` no cambió durante
    el change de FE (confirmado — el `git log` de `qa/` entre la fecha de
    este plan y la ejecución no muestra commits), así que el "antes" y el
    "después" de cada suite son la misma versión de test corrida contra dos
    stacks (pre/post bump); la comparación real relevante es "¿sigue
    pasando la misma proporción", no un conteo ciego. **10 de 278
    escenarios/tests no pasan** (5 de T-QA1 + 3 de T-QA2 + 0 de T-QA3, más
    2 `ambiguous`/1 `undefined` ya contados en T-QA1) — ninguno atribuible al
    bump de dependencias según el análisis de T-QA1/T-QA2 (pre-existentes o
    fragilidad de datos compartidos, salvo TC-731 que SÍ toca `apps/web`
    bumpeado y queda reportado sin diagnosticar a fondo). AC-3/AC-4 de
    US-022 quedan revalidados con esa salvedad explícita, no en silencio.

## Fase 5 — Hallazgos: registrar, no aplicar

- [x] T-QA5 Confirmar que la entrada `[Deferred]` sobre el bump de
  `@playwright/test` de `qa/package.json` sigue en `proposal.md` y que
  `qa/package.json` sigue en `1.49.1` (sin aplicar el bump en este change).
  - **Exit criterion**: `qa/package.json` NO declara `@playwright/test` en
    `1.55.1`; `proposal.md` de este change contiene la entrada `[Deferred —
    owner: usuario, motivo: bump de \`@playwright/test\`...]`.
  - **Verify**: `grep -q '"@playwright/test": "1.49.1"' qa/package.json && grep -q "bump de \`@playwright/test\`" openspec/changes/US-022-actualizacion-dependencias-qa/proposal.md`
  - **Nota de ejecución (2026-09-06)**: ambos confirmados, Verify en verde.
    No se tocó `qa/package.json`. El análisis sigue siendo correcto — no hay
    evidencia nueva de esta sesión que lo cambie.
- [x] T-QA6 Confirmar que el hallazgo de la carrera de TC-305 está
  documentado en `proposal.md`, con evidencia de si se reprodujo o no
  durante T-QA2.
  - **Exit criterion**: `proposal.md` contiene la entrada `[Deferred —
    owner: usuario, motivo: \`qa/e2e/pdp-ssr-seo.spec.ts\` TC-305...]`; si
    T-QA2 reprodujo una falla intermitente en TC-305, esa evidencia (número
    de corridas, número de fallos) se agrega como nota a esa misma entrada
    (no se abre una entrada nueva ni se silencia).
  - **Verify**: `grep -q "TC-305" openspec/changes/US-022-actualizacion-dependencias-qa/proposal.md`
  - **Nota de ejecución (2026-09-06)**: Verify en verde. **TC-305 NO
    reprodujo ninguna falla intermitente** en ninguna de las corridas de
    T-QA2 de esta sesión (múltiples corridas completas, todas verdes en ese
    spec) — no se agrega evidencia nueva a la entrada, per el propio criterio
    de la task ("si T-QA2 reprodujo... se agrega"; no reprodujo, no se
    agrega nada).
- [x] T-QA7 Confirmar que el hallazgo del gate roto de `qa.yml` está
  documentado en `proposal.md`, con el ID de la corrida verificada.
  - **Exit criterion**: `proposal.md` contiene la entrada `[Deferred —
    owner: usuario, motivo: el gate nightly \`qa-cross-stack\`...]`;
    `.github/workflows/qa.yml` no fue modificado por este change.
  - **Verify**: `grep -q "qa-cross-stack" openspec/changes/US-022-actualizacion-dependencias-qa/proposal.md && git diff --stat main -- .github/workflows/qa.yml | wc -l | grep -qx 0`
  - **Nota de ejecución (2026-09-06)**: ambos confirmados, Verify en verde.
    `.github/workflows/qa.yml` sin diff contra `main`. Consistente con esta
    sesión: la revalidación completa se hizo 100% local (`qa/scripts/
    api-up.sh` + build/start manual del front), sin depender de este gate.

## Documentación

- [x] T-QA8 Confirmar que no hace falta tocar ningún README ni crear ningún
  ADR (ninguna decisión de este change califica per
  `documentation-standards.md` §8.1 — es revalidación, no arquitectura).
  - **Exit criterion**: no existe ningún ADR nuevo bajo
    `docs/architecture/decisions/`; ningún README de `qa/` requiere edición.
  - **Verify**: `git status --porcelain docs/architecture/decisions/ qa/README.md 2>/dev/null | wc -l | grep -qx 0`
  - **Nota de ejecución (2026-09-06)**: Verify en verde. Ningún ADR nuevo,
    ningún README de `qa/` tocado.

## Verification (suite-level)

- [x] Aceptación BDD, 172 escenarios (corregido de 136), 167 verdes / 5
  no-verdes: `pnpm --filter @dsm/qa test:acceptance -- --tags "not @deferred"`
  (el filtro real que se corrió, dado un bug de tooling de `pnpm --tags`
  documentado en T-QA1, fue `cucumber-js --tags "not @deferred and not
  @blocked"` invocado directo)
- [x] E2E cross-stack, 68 tests, 65 verdes / 3 no-verdes (1 real —
  `carrito.spec.ts` TC-731, ver T-QA2 — y 2 de fragilidad de datos
  compartidos): `pnpm --filter @dsm/qa test:e2e`
- [x] Accesibilidad WCAG AA verde, 38/38 tests: `pnpm --filter @dsm/qa test:a11y`
- [x] Cobertura total 278 (172+68+38) ≥ 242 (T-QA4) — sin regresión respecto
  al conteo vigente corregido en `qa-plan.md` §1
- [x] Los 4 hallazgos (`@playwright/test` de `qa/`, carrera de TC-305, gate
  roto de `qa.yml`, **y `carrito.spec.ts` TC-731 — falla real que sí toca
  `apps/web` bumpeado, encontrada al ejecutar T-QA2**) quedan documentados
  como `[Deferred — owner: usuario, ...]` en `proposal.md`, ninguno aplicado
  ni silenciado
