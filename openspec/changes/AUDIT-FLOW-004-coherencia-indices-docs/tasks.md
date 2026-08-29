## Traceability matrix

| Finding ID | Title | Task IDs | Status |
|---|---|---|---|
| AUDIT-FLOW-004 | Tres US sin plan QA (US-005, US-006, US-014) | T1.1 | in this change |
| AUDIT-FLOW-006 | US-019 sin AC de negative-space | T2.1 | in this change |
| AUDIT-FLOW-008 | `prd-capacity` no existe en frontmatter de US | T3.1 | in this change |
| AUDIT-FLOW-009 | `assignee` de changes nuevos es `sin-asignar` | — | **no action required** (valor correcto) |
| AUDIT-FLOW-010 | Cadena crítica US-007→010 sin construir | T4.1 | in this change |
| AUDIT-FLOW-011 | 5 changes nuevos correctamente reflejados | — | **no action required** (confirmación) |
| AUDIT-FLOW-012 | US-021 correctamente reflejada en us-status | — | **no action required** (confirmación) |
| AUDIT-FLOW-013 | ADR-0014 existe en disco y en el índice | — | **no action required** (confirmación) |
| AUDIT-DOC-007 | Índice vs fuente (us-status ↔ directorio) | T5.1 | in this change |

---

## Fase 1 — QA plan gap

- [ ] T1.1 Documentar skip-rationale de QA para US-005, US-006 y US-014

En cada `openspec/changes/US-{005,006,014}-*-backend/design.md` (o `proposal.md` si no hay design), agregar una sección `## QA coverage rationale` explicando que la cobertura QA se absorbe en: (a) tests dev-owned de cada change (suite ≥90%), (b) qa-plans cross-stack existentes (US-007 QA cubre carrito + auth parcial), (c) plan-qa futuro al completar la cadena. Alternativa: si el PO decide planificar QA, este task queda como la documentación de la decisión.

  - **Exit criterion**: Los 3 design/proposal de US-005/006/014 backend contienen la sección de rationale o existe un `-qa` change para cada uno.
  - **Verify**: `for us in 005 006 014; do grep -ql "QA\|qa.*coverage\|skip-rationale" openspec/changes/US-${us}-*-backend/*.md || test -d openspec/changes/US-${us}-*-qa; done`

---

## Fase 2 — Negative-space AC

- [ ] T2.1 Agregar AC negative-space a US-019

Añadir al menos 1 AC de negative-space en formato Gherkin a `docs/user-stories/US-019-provision-plataforma-cloud.md`. Ejemplo: "Given un secreto obligatorio falta en las variables de entorno, When se intenta desplegar, Then el deploy falla con error explícito antes de arrancar".

  - **Exit criterion**: US-019 contiene al menos 1 escenario Gherkin con la etiqueta o keyword "no" / "falta" / "falla" / "rechaza" que constituye negative-space.
  - **Verify**: `grep -iE "(no debe|falla|rechaza|sin.*secreto|Given.*falta)" docs/user-stories/US-019-provision-plataforma-cloud.md | wc -l` devuelve ≥1

---

## Fase 3 — prd-capacity en frontmatters

- [ ] T3.1 Agregar `prd-capacity` a los frontmatters de las 21 US

Recorrer `docs/user-stories/US-*.md`, extraer la capacidad PRD que cada US cubre (del índice `us-status.yaml` o del §2 de cada US), y agregar `prd-capacity: N` al frontmatter YAML. Alternativa aceptada: documentar en `docs/_index/index-conventions.md` que es un campo derivado y no se exige en el markdown fuente.

  - **Exit criterion**: ≥19 de las 21 US tienen `prd-capacity:` en su frontmatter, O existe documentación explícita en index-conventions de que es campo derivado.
  - **Verify**: `count=$(grep -rl "prd-capacity:" docs/user-stories/ | wc -l); test $count -ge 19 || grep -q "prd-capacity.*derived\|derivado" docs/_index/index-conventions.md 2>/dev/null || grep -q "prd-capacity.*derived\|derivado" docs/ai/index-conventions.md 2>/dev/null`

---

## Fase 4 — Documentar cadena crítica

- [ ] T4.1 Registrar riesgo de cadena crítica en build-order o estado

Agregar una nota en `docs/_index/build-order.yaml` (campo `notes` o comentario YAML) o en un doc de estado del proyecto indicando que la cadena US-007→US-008→US-009→US-010 (~35 h AI) es el bottleneck del MVP y ningún change pasado US-007 BE está construido.

  - **Exit criterion**: Existe documentación explícita de la cadena crítica como riesgo/bottleneck.
  - **Verify**: `grep -qi "cadena.*crít\|critical.*path\|bottleneck\|US-008.*US-009.*US-010" docs/_index/build-order.yaml docs/_index/project-status.md 2>/dev/null || grep -qi "cadena.*crít\|critical.*path" docs/product/*.md 2>/dev/null`

---

## Fase 5 — Validar us-status vs directorio

- [ ] T5.1 Verificar sincronización us-status ↔ directorio de user stories

Contar archivos en `docs/user-stories/US-*.md` y entries en `docs/_index/us-status.yaml`. Si hay diferencia, agregar la entry faltante. Documentar el resultado.

  - **Exit criterion**: La cantidad de archivos `US-*.md` en el directorio es igual a la cantidad de entries en `us-status.yaml`.
  - **Verify**: `test $(ls docs/user-stories/US-*.md 2>/dev/null | wc -l) -eq $(python3 -c "import yaml; print(len(yaml.safe_load(open('docs/_index/us-status.yaml'))))")`
