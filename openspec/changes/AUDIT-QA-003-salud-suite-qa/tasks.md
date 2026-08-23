## Traceability matrix

| Finding ID | Title | Task IDs | Status |
|---|---|---|---|
| AUDIT-QA-003 | Cobertura funcional ausente (checkout/payments/orders) | T1.1 | in this change |
| AUDIT-QA-004 | Cobertura funcional ausente (búsqueda semántica) | T1.2 | in this change |
| AUDIT-QA-005 | Balance de pirámide (e2e-nest pesado) | T2.1 | in this change |
| AUDIT-QA-006 | Cobertura negative-space (concurrencia stock) | T1.1 | in this change |
| AUDIT-QA-007 | Accesibilidad panel admin ausente | T3.1 | in this change |
| AUDIT-QA-008 | Quality gates de CI sin coverage threshold | T4.1 | in this change |
| AUDIT-QA-010 | E2E Playwright loop compra ausente | T1.1 | in this change |
| AUDIT-QA-011 | Test data management (sin factories) | T5.1 | in this change |

---

## Fase 1 — Cobertura funcional crítica (bloqueada por implementación)

- [ ] T1.1 Planificar e implementar tests del núcleo transaccional

Crear `qa/e2e/checkout-loop.spec.ts` (o equivalente) con escenarios: (a) happy path búsqueda→carrito→checkout→pago simulado→confirmación→stock decrementado, (b) test de concurrencia: 10 requests por la última unidad → sólo 1 éxito + stock ≥ 0, (c) webhook idempotente: doble envío no decrementa dos veces. **Bloqueado hasta que US-008+009+010 estén construidos.**

  - **Exit criterion**: Existe al menos un archivo de test que ejercita el loop completo con pago simulado Y un test de concurrencia de stock con ≥5 requests paralelos.
  - **Verify**: `test -f qa/e2e/checkout-loop.spec.ts || test -f qa/e2e/compra-completa.spec.ts` `&& grep -qi "Promise.all\|concurrent\|paralel" qa/e2e/*.spec.ts`

- [ ] T1.2 Planificar e implementar batería de relevancia IA

Crear `qa/relevance/` con script que ejecute ≥30 consultas NL contra `/v1/search`, valide ≥1 producto correcto en top-5, y reporte cobertura. Gate: ≥70% de las consultas con resultado relevante. **Bloqueado hasta que US-004+005 estén construidos y haya embeddings.**

  - **Exit criterion**: Existe `qa/relevance/` con al menos un script ejecutable y ≥30 casos de consulta, con gate de 70%.
  - **Verify**: `test -d qa/relevance && find qa/relevance -name "*.ts" -o -name "*.js" | head -1 | xargs grep -c "query\|consulta"` devuelve ≥30

---

## Fase 2 — Balance de pirámide

- [ ] T2.1 Identificar y documentar candidatos a migrar de e2e-nest a unit

Crear `docs/qa/pyramid-rebalance.md` con la lista de archivos `e2e-*.spec.ts` candidatos a migrar a unit (aquellos que sólo validan DTO transformation, rate-limit config, o mapping sin necesitar DB real). Incluir el ratio objetivo (≥3:1 unit:integration).

  - **Exit criterion**: El doc existe, lista ≥10 archivos candidatos con justificación, y declara el ratio objetivo.
  - **Verify**: `test -f docs/qa/pyramid-rebalance.md && grep -c "e2e-" docs/qa/pyramid-rebalance.md` devuelve ≥10

---

## Fase 3 — Accesibilidad panel admin

- [ ] T3.1 Agregar tests axe-core para vistas principales del panel

Crear tests axe (Playwright o Vitest+RTL) para `/admin/productos`, `/admin/categorias` y formularios de alta/edición. Asegurar que pasan axe con zero violations serias.

  - **Exit criterion**: Existen tests axe que cubren ≥3 rutas del panel admin y pasan sin critical/serious violations.
  - **Verify**: `find apps/web qa -name "*admin*a11y*" -o -name "*admin*axe*" | wc -l` devuelve ≥1 `&& grep -rq "axe\|a11y" $(find apps/web qa -name "*admin*")`

---

## Fase 4 — Quality gates de CI

- [ ] T4.1 Configurar coverage threshold y separar steps

En `.github/workflows/ci.yml` (o `qa.yml`): (a) agregar `--coverage --coverageThreshold='{"global":{"statements":60}}'` al step de test backend, (b) separar en steps: unit → integration → e2e (para debug más rápido).

  - **Exit criterion**: El workflow de CI tiene threshold de cobertura ≥60% para statements y los steps de test están separados.
  - **Verify**: `grep -q "coverageThreshold\|coverage-threshold\|--coverage" .github/workflows/ci.yml && grep -c "pnpm.*test" .github/workflows/ci.yml` devuelve ≥2 (separación)

---

## Fase 5 — Test data management

- [ ] T5.1 Crear factories compartidas en apps/api/test/

Crear `apps/api/test/factories/` con builders para al menos: product, category, customer, cart. Migrar ≥3 specs existentes para usarlos como demostración.

  - **Exit criterion**: El directorio `test/factories/` existe con ≥4 builders y al menos 3 specs los usan.
  - **Verify**: `test -d apps/api/test/factories && ls apps/api/test/factories/*.ts | wc -l` devuelve ≥4 `&& grep -rl "factories/" apps/api/src/**/*.spec.ts | wc -l` devuelve ≥3
