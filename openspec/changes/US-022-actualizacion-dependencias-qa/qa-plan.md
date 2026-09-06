---
parent-us: US-022
discipline: qa
language: es
---

# US-022 — Plan de QA (revalidación cross-cutting, Layer 3)

> **Naturaleza de este plan**: a diferencia de un `qa-plan.md` típico (que
> diseña escenarios Gherkin happy/corner/negative para una capacidad nueva),
> este change **no agrega funcionalidad**: revalida suites QA-owned ya
> existentes contra un stack cuyo único cambio, por diseño de la US (§8), es
> "los números de versión de sus dependencias". Por eso los "casos de prueba"
> de este plan son del tipo **"correr la suite X existente contra las
> versiones nuevas, confirmar que N escenarios/specs siguen pasando"**, no
> Gherkin nuevo — se documenta explícitamente por qué el formato difiere,
> per instrucción del coordinador, en vez de inventar escenarios Gherkin que
> no aportarían señal nueva sobre un bump de versión.

> **Service tier**: **derivado** (no hay `service-catalog.yaml` en el repo).
> Las suites revalidadas cubren dos superficies de criticidad distinta: el
> storefront público (SSR/SEO, `qa/e2e/categoria-ssr-seo.spec.ts` +
> `pdp-ssr-seo.spec.ts`) hereda **Tier 1** — es el camino que el PRD §1.2
> ("que a DSM se la encuentre en Google") depende directamente, y es
> exactamente la superficie que motivó esta US (dos critical de `next` en el
> código que sirve ese camino); el resto de la suite (aceptación BDD
> transaccional, accesibilidad del panel admin) es **Tier 2** — valor
> funcional sin dependencia externa nueva. Se registra la derivación
> explícitamente (regla de tier-resolution: catálogo ausente → derivar de
> `proposal.md`/US), no se asume en silencio.

## 1. Riesgo de la revalidación e inventario de suites QA-owned

### Riesgo por paquete bumpeado (change de FE, mergeado)

| Paquete | Bump | Superficie QA-owned que lo ejercita | Riesgo si regresiona |
|---|---|---|---|
| `next` 15.1.6 → 15.5.21 | minor, línea 15.x | `qa/e2e/categoria-ssr-seo.spec.ts` (SSR/sitemap/metadatos), `qa/e2e/pdp-ssr-seo.spec.ts` (SSR/JSON-LD/404), toda la suite de aceptación (levanta el front real) | **Alto** — las dos critical de esta US son de `next`, en el código que sirve el storefront público; un cambio de comportamiento en SSR/middleware/caching sería indistinguible de una regresión funcional real |
| `sharp` (nueva, `^0.35.0`) | agregado explícito | `qa/e2e/pdp-ssr-seo.spec.ts` TC-306 (LCP de la ficha, que renderiza `ProductImage` vía `next/image`) — cobertura **indirecta**, no hay ningún test QA-owned que golpee `/_next/image` directamente | Medio — si la optimización de imágenes se degrada, TC-306 (presupuesto de LCP < 2.5s) lo detectaría como síntoma, aunque no diagnosticaría la causa |
| `postcss` → 8.5.18 | build-time | Ninguna suite QA-owned corre contra CSS sin compilar — se verifica indirectamente por cualquier assert visual/estructural que dependa de clases Tailwind ya renderizadas (ninguna suite QA-owned asserta clases CSS) | Bajo — es tooling de build, no runtime |
| `@playwright/test` de `apps/web` → 1.55.1 | minor (Chromium nuevo) | **No aplica a `qa/`** — `qa/package.json` mantiene su propia copia en `1.49.1`, sin bumpear (fuera de alcance del change de FE) | Ver hallazgo §6 — asimetría de versión entre el runner que corre `qa/e2e/*` (1.49.1) y el que corre `apps/web/e2e/*` (1.55.1) |
| `undici` (override raíz, vía `testcontainers` de `apps/api`) | — | Ninguna — no toca ningún script de `qa/` (confirmado, `design.md` D-QA2) | N/A |
| `vitest` 2.1.8 → 3.2.6 | major, integrado | Ninguna — es dev-only de `apps/web`/`apps/api`, no de `qa/` | N/A |

### Inventario de suites QA-owned afectadas (las que la US §7 pide revalidar)

| Suite | Comando | Specs/Features | Escenarios/Tests | Golpea `apps/web` servido? |
|---|---|---|---|---|
| Aceptación BDD | `pnpm --filter @dsm/qa test:acceptance` | 14 `.feature` | ~~136~~ → **172** (`Escenario`/`Esquema del escenario`, contando Ejemplos; ver nota) | Sí (World levanta un browser real para escenarios de UI desde US-003+, y siempre habla con la API real) |
| E2E SSR/SEO/funcional | `pnpm --filter @dsm/qa test:e2e` | 16 specs (excluye `*a11y*` por `testMatch`) | **68** (confirmado) | Sí — es la suite que exige el front construido y servido (`categoria-ssr-seo.spec.ts`, `pdp-ssr-seo.spec.ts` explícitamente) |
| Accesibilidad WCAG AA | `pnpm --filter @dsm/qa test:a11y` | 9 specs (`*a11y*.spec.ts`) | **38** (confirmado) | Sí — axe-core corre contra el DOM renderizado del panel real |
| Contract testing | `pnpm --filter @dsm/qa test:contract*` | 9 scripts `tsx` | — | No — `fetch` directo a `QA_API_BASE_URL` (`design.md` D-QA2) |
| Carga (k6) | `pnpm --filter @dsm/qa test:load*` | 9 scripts | — | No — todos usan `QA_API_BASE_URL` (`design.md` D-QA2) |
| Funcional (Newman) | `pnpm --filter @dsm/qa test:functional` | 1 colección, 14 requests | — | No — API directa; el único paquete tocado (`handlebars`) ya se revalidó en el `tasks.md` de FE |

> **Corrección de conteo (ejecución 2026-09-06, `/develop-qa`)**: la cifra de
> 136 fue una foto de planificación; el conteo real medido con
> `cucumber-js --dry-run` es **178 escenarios totales** (incluye `Esquema del
> escenario` expandido por `Ejemplos`), de los cuales **6 están tageados
> `@blocked`** (5 en `enriquecimiento.feature` — necesitan un `GEMINI_API_KEY`
> real, sin el cual `SC-005-H1/H2/C3/N2/N3` no tienen nada que ejercitar — y 1
> en `pago-webhook.feature`, `SC-010-N2`, necesita una cuenta sandbox de
> MercadoPago). `tasks.md`/`qa-plan.md` originales sólo excluían `@deferred`
> (que hoy no matchea ningún escenario: verificado con
> `cucumber-js --tags "@deferred" --dry-run` → 0), no `@blocked` — así que el
> filtro correcto para "todo lo que es ejecutable en este entorno" es
> `--tags "not @deferred and not @blocked"` → **172 escenarios**. Los 6
> `@blocked` no son un hallazgo nuevo: ya estaban documentados como bloqueo de
> entorno pre-existente en el propio `.feature` (comentario de cabecera de
> `enriquecimiento.feature`/`pago-webhook.feature`), sólo faltaba reflejarlos
> en el filtro de este plan.

**Total revalidado por este plan: 278 escenarios/tests** (172 + 68 + 38),
across 3 suites, contra el stack ya mergeado a `main` — corrige el `242`
original (136+68+38) por la razón de arriba.

## 2. Mapeo de la pirámide de test (capas QA-owned en negrita)

| Capa | Dueño | Estado | Herramienta |
|---|---|---|---|
| Unit/Component/Integration/e2e-nest de `apps/web`/`apps/api` | Dev (TDD) | **Hecho** — `tasks.md` de FE, 996/996 + 1966/1966 + 58/58 (E2E dev-owned de `apps/web`) | Vitest, Jest, Playwright (dev-owned) |
| **Aceptación BDD (Layer 3, cross-stack, persistente)** | **QA** | Este plan — **revalidación**, no autoría nueva | Cucumber-js + Playwright `APIRequestContext`/browser |
| **E2E SSR/SEO (Layer 3)** | **QA** | Este plan — **revalidación** | Playwright |
| **Accesibilidad WCAG AA (Layer 3)** | **QA** | Este plan — **revalidación** | axe-core + Playwright |
| Contract testing / Carga / Funcional | QA | Sin cambios — fuera de la ruta de los paquetes bumpeados (`design.md` D-QA2) | tsx / k6 / Newman |
| Visual regression | N/A | Sin superficie visible que revalidar (US §8 — "nada cambia salvo versiones") | — |
| Exploratorio | N/A en este change | No hay comportamiento nuevo que explorar; el riesgo ya está acotado a "regresión sí/no" | — |

> **Nota de cobertura dev-owned (awareness, no se re-autora)**: el `tasks.md`
> de FE ya corrió y confirmó verde la suite dev-owned completa (unit +
> integration + E2E de `apps/web`/`apps/api`) contra las versiones nuevas,
> incluyendo la revalidación específica de topología/SSR
> (`e2e/auth-topology.spec.ts`, `e2e/cart-topology.spec.ts`,
> `e2e/checkout-topology.spec.ts`, `e2e/admin-noindex.spec.ts`,
> `e2e/cart-noindex.spec.ts`, `e2e/category-ssr.spec.ts`, `e2e/pdp-ssr.spec.ts`
> — todos contra un stub, `api-stub.mjs`, no contra el stack real). Este plan
> **no duplica** esa capa: construye la confirmación Layer 3 (contra el stack
> real, API + Postgres + front servidos) que sólo QA puede dar, per skill
> `qa-three-layer-regression`.

## 3. Matriz de trazabilidad AC → revalidación (autocheck F47)

| AC (US-022) | Título | Revalidación | Capa | Estado |
|---|---|---|---|---|
| AC-3 | El sitio sigue funcionando igual (SSR/sitemap/metadatos intactos) | `qa/e2e/categoria-ssr-seo.spec.ts` (TC-201..208), `qa/e2e/pdp-ssr-seo.spec.ts` (TC-301..306) | 3 | Ejecutable (T-QA2) |
| AC-4 | Dependencias de dev saneadas, suites siguen pasando con la misma cobertura | Las 3 suites completas (aceptación + E2E + a11y) | 3 | Ejecutable (T-QA1/T-QA2/T-QA3) |

Los demás AC de US-022 (AC-1, AC-2, AC-5, AC-6, AC-7) son responsabilidad
exclusiva del change de FE (auditoría de dependencias, gate ejecutable) — no
tienen contraparte QA-owned per la propia asignación de tareas de la US (§7:
sólo AC-3 y AC-4 dependen de que "las suites sigan pasando", que es
exactamente lo que QA revalida). No hay AC de US-022 asignado a QA sin
cobertura en esta matriz.

## 4. "Escenarios" de revalidación (formato adaptado)

No hay Gherkin nuevo. Cada "caso" es una corrida completa de una suite ya
existente, con un criterio de éxito binario y comparable:

```yaml
id: QA-022-REV-1
execution_mode: automated
test_layer: 3
target_tooling: Cucumber-js + Playwright
qué_revalida: 14 features / 136 escenarios de aceptación, sin modificar ningún .feature
criterio_de_éxito: exit 0, 136/136 escenarios verdes (excluyendo @deferred), ningún conteo por debajo del baseline
```

```yaml
id: QA-022-REV-2
execution_mode: automated
test_layer: 3
target_tooling: Playwright
qué_revalida: 16 specs / 68 tests de test:e2e (SSR/SEO/funcional), incluye específicamente categoria-ssr-seo.spec.ts y pdp-ssr-seo.spec.ts
criterio_de_éxito: exit 0, 68/68 tests verdes, TC-305 observado por el hallazgo de §6
```

```yaml
id: QA-022-REV-3
execution_mode: automated
test_layer: 3
target_tooling: axe-core + Playwright
qué_revalida: 9 specs / 38 tests de test:a11y (WCAG 2a + 2aa)
criterio_de_éxito: exit 0, 38/38 tests verdes, cero violaciones nuevas
```

**Tooling**: Cucumber-js (`@cucumber/cucumber@11.2.0`) + Playwright
(`@playwright/test@1.49.1`, la copia propia de `qa/`, sin bumpear — ver §6).
**Location**: sin cambios — `qa/acceptance/features/*.feature`,
`qa/e2e/*.spec.ts`.
**Test layer**: 3 (cross-stack) para las tres, per skill
`qa-three-layer-regression`.

## 5. Test infrastructure

No se requiere ninguna SUT factory, builder ni matcher nuevo — este plan no
escribe código de test. Se reusa toda la infraestructura existente:

- `qa/support/qa-env.ts` (`verificarEntornoQA()`), `qa/scripts/api-up.sh`
  (levanta el entorno con las variables corregidas).
- `qa/acceptance/steps/world.ts` (`CatalogWorld`, browser perezoso).
- Todos los `qa/support/seed-*.ts`/`*.smoke.ts` existentes.

## 6. Hallazgos (no se resuelven en este change)

### Hallazgo 1 — bump de `@playwright/test` propio de `qa/`: evaluar, no aplicar a ciegas

`qa/package.json` fija `@playwright/test` en `1.49.1`, sin bumpear (fuera de
alcance del change de FE). El change de FE ya midió, con diagnóstico
exhaustivo, que ese mismo bump (a `1.55.1`, Chromium más nuevo) angostó una
carrera preexistente en `apps/web/e2e/pdp-invalidation.spec.ts` — de ~33% de
flakiness histórica a reproducible 100% en modo serie (2/5 en paralelo, el
modo real de CI). Bumpear la copia de `qa/` "por consistencia" sin medir
repetiría el mismo riesgo, potencialmente sobre `qa/e2e/pdp-ssr-seo.spec.ts`
TC-305 (ver Hallazgo 2, mismo patrón estructural). **Decisión diferida** —
`[Deferred — owner: usuario, ...]` en `proposal.md`. Ver `design.md` D-QA1.

### Hallazgo 2 — TC-305 comparte el mecanismo de carrera de `pdp-invalidation.spec.ts`

`qa/e2e/pdp-ssr-seo.spec.ts` TC-305 edita el precio desde el panel real,
espera la confirmación del PATCH, y reintenta con `expect.poll` hasta que la
ficha pública muestre el precio nuevo — la invalidación es fire-and-forget
del lado del servidor, exactamente el mismo mecanismo que
`apps/web/e2e/pdp-invalidation.spec.ts` diagnosticó a fondo. TC-305 usa
`{ timeout: 10_000 }` sin `intervals` explícitos; `apps/web` necesitó
`{ timeout: 20_000, intervals: [...] }` para estabilizarse con el Chromium
nuevo. Mientras `qa/` siga en `@playwright/test@1.49.1` es plausible que la
ventana de carrera no se angoste todavía — pero un bump futuro (Hallazgo 1)
la expondría de la misma forma. **No se ensancha el timeout de TC-305 en
este change** — no hay evidencia todavía de que falle con la versión actual
de Playwright; T-QA2 (`tasks.md`) observa específicamente este test y agrega
evidencia a la entrada `[Deferred]` si se reproduce alguna falla
intermitente. Ver `design.md` D-QA1.

### Hallazgo 3 — el gate nightly `qa.yml` está roto desde antes de esta US

Verificado con `gh run list --workflow=qa.yml` (8 corridas nightly,
2026-08-30 → 2026-09-06): todas fallan en el paso "Aceptación BDD
(Cucumber)" porque el paso "Build + arranque de la API" arranca el proceso a
mano en vez de usar `qa/scripts/api-up.sh`, y no exporta
`CORS_ALLOWED_ORIGINS`. Los pasos "Build + arranque del front", "E2E
cross-stack (Playwright)" y "Accesibilidad (axe-core)" — las tres suites que
esta US pide revalidar — quedan `skipped` desde antes del merge de FE. La
revalidación de este change corre **localmente** (mismo mecanismo que
`qa/scripts/api-up.sh` ya provee correctamente), sin depender de este gate.
**No se corrige `qa.yml`** — es un defecto de pipeline preexistente, fuera de
alcance (mismo criterio que el change de FE aplicó a "endurecer la CI... es
US-019"). Ver `design.md` D-QA3.

## 7. Datos y fixtures

Sin cambios — se reusa toda la estrategia de datos sintéticos ya vigente en
`qa/support/` (100% sintético, defaults determinísticos, cada escenario
siembra su propia cuenta/orden). Este plan no agrega ningún dato de test
nuevo.

## 8. Coverage targets

| Suite | Target | Rationale |
|---|---|---|
| Aceptación BDD | ≥172 escenarios verdes (corregido de 136, ver nota §1) | Conteo real medido al ejecutar; "igual o mayor, nunca menor" (US §9 / AC-4, mismo criterio que `tasks.md` de FE T3.1) |
| E2E SSR/SEO/funcional | ≥68 tests verdes | Ídem — incluye específicamente AC-3 (SSR/sitemap/metadatos) |
| Accesibilidad WCAG AA | ≥38 tests verdes | Ídem — ninguna violación WCAG AA nueva |

No se derivan targets nuevos de service-tier (§ tier derivado arriba): el
criterio de esta revalidación es puramente "no regresión", no un umbral de
cobertura de líneas — no hay código nuevo que cubrir.

## 9. Quality gates

| Gate | Bloquea | Disparador |
|---|---|---|
| Aceptación BDD (`QA-022-REV-1`) | cierre de este change (US-022 → Done) | ejecución de `/develop-qa` |
| E2E SSR/SEO (`QA-022-REV-2`) | cierre de este change | ejecución de `/develop-qa` |
| Accesibilidad WCAG AA (`QA-022-REV-3`) | cierre de este change | ejecución de `/develop-qa` |
| Gate nightly `qa-cross-stack` (`qa.yml`) | **no aplica** — roto desde antes de esta US (Hallazgo 3), no se usa como evidencia | — |

## 10. Anti-patterns evitados

- ❌ `testing-standards.md` §18 (tests que no prueban nada nuevo): en vez de
  inventar Gherkin happy/corner/negative sin superficie nueva que cubrir, se
  documenta explícitamente por qué el formato de este plan es "revalidar
  suite existente" (§ nota al inicio del documento).
- ❌ `testing-standards.md` §9.1 (zero tolerance para flakiness, silenciada):
  el hallazgo de TC-305 (§6, Hallazgo 2) se documenta con el mecanismo
  concreto, no se ignora ni se re-etiqueta `@flaky` sin ticket de
  remediación (`bdd-scenario-quality`/`flakiness-detection` — tag `@flaky`
  exige ticket de remediación, y este plan no lo aplica porque no hay
  evidencia todavía de que falle con la versión vigente).
- ❌ `qa-frontend-standards.md` §2.1 ("QA writes all the tests"): no se
  re-autora ninguna capa dev-owned (unit/integration/e2e-nest ya verde en el
  `tasks.md` de FE).
- ❌ Delegar en un gate de CI roto sin verificarlo (`design.md` D-QA3): se
  confirmó con evidencia (`gh run view --log-failed`) que `qa.yml` no corre
  las tres suites que esta US pide revalidar, en vez de asumir que "CI ya lo
  prueba".
- ❌ Bumpear `@playwright/test` de `qa/` "ya que se está revisando todo" sin
  medir blast radius (mismo criterio que `k6-load-scaffolding`/
  `flakiness-detection` aplican a cualquier cambio de tooling de test que
  pueda introducir flakiness nueva): se difiere con el riesgo concreto
  documentado (§6, Hallazgo 1), no se aplica a ciegas.

## 11. Preguntas abiertas / hallazgos

Las tres entradas `[Deferred — owner: usuario, ...]` de este plan viven en
`proposal.md` §Preguntas abiertas / hallazgos, con su análisis completo en
`design.md` D-QA1/D-QA3. Ninguna bloquea la ejecución de la revalidación en
sí (§1-§4 de este plan son 100% ejecutables hoy).

**Linear MCP**: no conectado en esta sesión — sin sub-task de tracker que
anotar. Per `tracker-handoff` §2.4, se deja constancia acá en vez de
omitirlo en silencio.

## 12. Dependencias declaradas

| Dependencia | Estado | Efecto |
|---|---|---|
| `US-022-actualizacion-dependencias-frontend-web` | Mergeado (PR #95, 24/24 tasks), pendiente de su propio `/archive-change` | Desbloquea toda la revalidación de este plan — el stack a revalidar ya está en `main` |
| `qa/scripts/api-up.sh` | Existente, sin cambios | Entorno correcto para revalidar localmente (Hallazgo 3) |
| `.github/workflows/qa.yml` | Roto desde antes de esta US (Hallazgo 3) | No se usa como evidencia de este plan; revalidación 100% local |

## 13. Standards consultados

- `docs/base-standards.md`
- `docs/quality/testing-standards.md` §2 (pirámide), §8 (coverage policy),
  §9.1 (zero tolerance para flakiness), §18 (anti-patterns)
- `docs/quality/qa-frontend-standards.md` §2.1 (ownership matrix), §12
  (regression suite — mecanismo reusado tal cual), §19 (accesibilidad),
  §23.4 (E2E con Playwright), §24 (BDD y Gherkin)
- Skills: `qa-three-layer-regression` (Layer 3, criterio de no-duplicación
  con dev-owned), `playwright-stability` (vocabulario del hallazgo de
  TC-305 — auto-waiting vs. `expect.poll` contra efecto fire-and-forget),
  `flakiness-detection` (criterio de severidad del hallazgo), `bdd-scenario-quality`
  (tag `@flaky` exige ticket, no aplicado sin evidencia), `openspec-workflow`,
  `tracker-handoff` (constancia de MCP no conectado, §11)

## 14. Referencias

- User Story: `docs/user-stories/US-022-actualizacion-dependencias-frontend.md`
- Change de FE (mergeado, PR #95, pendiente de archive): `proposal.md`,
  `design.md`, `tasks.md`
- Evidencia de Hallazgo 3: `gh run list --workflow=qa.yml`,
  `gh run view 34021954006 --log-failed`
- Precedente de mismo mecanismo de carrera (Hallazgo 2):
  `apps/web/e2e/pdp-invalidation.spec.ts`
- Precedente de formato de change QA hermano (Mode A, variante sibling):
  `openspec/changes/archive/US-010-orden-webhook-stock-qa/qa-plan.md`,
  `openspec/changes/archive/US-015-historial-compras-qa/qa-plan.md`
